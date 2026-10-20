#!/usr/bin/env python3
"""Read-only macOS sampling of Sivio, owned helpers, and its launchd PID-domain XPCs.
CPU uses cumulative process-time deltas as percent of ONE CPU core. No unrelated
WebKit process is included; launchctl output is parsed in memory, not persisted.
"""
import argparse
import json
import re
import subprocess
import time
from pathlib import Path


def seconds(value):
    parts = value.split(":")
    total = 0.0
    for part in parts:
        total = total * 60 + float(part)
    return total


def sample():
    rows = subprocess.check_output(
        ["ps", "-axo", "pid=,rss=,time=,comm="], text=True
    ).splitlines()
    parsed = [row.strip().split(None, 3) for row in rows]
    apps = [pid for pid, _, _, exe in parsed if "Sivio.app/Contents/MacOS/" in exe]
    if len(apps) != 1:
        raise RuntimeError(f"Expected one Sivio app, found {len(apps)}")
    domain = subprocess.check_output(["launchctl", "print", f"pid/{apps[0]}"], text=True)
    services = domain.split("\tservices = {", 1)[1].split("\n\t}", 1)[0]
    xpc = set(re.findall(r"^\s*(\d+)\s+\S+\s+\S+", services, re.M)) - {"0"}
    result = {}
    for pid, rss, cpu, executable in parsed:
        owned = ("Sivio.app/Contents/MacOS/" in executable
                 or "/si-assist-service/" in executable
                 or "/local.siassist.desktop.service.bundle/" in executable
                 or executable.endswith("/si-network-supervisor"))
        if owned or pid in xpc:
            result[pid] = {"rssKiB": int(rss), "cpuSeconds": seconds(cpu),
                           "scope": "owned" if owned else "app-launchd-xpc"}
    if not any(p["scope"] == "owned" for p in result.values()):
        raise RuntimeError("No Sivio process found; cannot measure empty scope")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=600)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rss-limit-mib", type=float, default=600)
    parser.add_argument("--settle-seconds", type=float, default=0)
    args = parser.parse_args()
    if args.settle_seconds:
        print(f"Settling for {args.settle_seconds:g}s before sampling", flush=True)
        time.sleep(args.settle_seconds)
    started = time.monotonic()
    wall_started = time.time()
    rows = []
    cpu = 0.0
    previous = {}
    changed = False
    while True:
        processes = sample()
        elapsed = time.monotonic() - started
        wall_elapsed = time.time() - wall_started
        if previous:
            changed |= set(previous) != set(processes)
            cpu += sum(max(0, p["cpuSeconds"] - previous[pid]["cpuSeconds"])
                       for pid, p in processes.items() if pid in previous)
        rows.append({"elapsedSeconds": elapsed, "wallElapsedSeconds": wall_elapsed,
                     "processes": processes,
                     "rssMiB": sum(p["rssKiB"] for p in processes.values()) / 1024})
        previous = processes
        if elapsed >= args.seconds:
            break
        time.sleep(min(5, args.seconds - elapsed))
    # macOS monotonic time can pause during sleep. A wake or wall-clock change
    # invalidates continuous idle acceptance instead of silently diluting CPU.
    clock_discontinuity = any(abs(row["wallElapsedSeconds"] - row["elapsedSeconds"]) > 2
                              for row in rows)
    report = {"method": __doc__, "durationSeconds": elapsed,
              "wallStartedAt": wall_started, "wallDurationSeconds": wall_elapsed,
              "settleSeconds": args.settle_seconds,
              "clockDiscontinuity": clock_discontinuity,
              "machine": subprocess.check_output(["sysctl", "-n", "hw.model"], text=True).strip(),
              "memoryBytes": int(subprocess.check_output(["sysctl", "-n", "hw.memsize"])),
              "cpuPercentOneCore": 100 * cpu / elapsed,
              "peakRssMiB": max(row["rssMiB"] for row in rows),
              "processSetChanged": changed,
              "rssLimitMiB": args.rss_limit_mib,
              "pass": not changed and not clock_discontinuity and elapsed >= 600 and 100 * cpu / elapsed <= 5
                      and max(row["rssMiB"] for row in rows) <= args.rss_limit_mib,
              "samples": rows}
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "samples"}, indent=2))


if __name__ == "__main__":
    main()
