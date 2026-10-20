import { memo, useEffect, useId, useRef } from "react";
import {
  trafficPath,
  TRAFFIC_INTERVAL_MS,
  type TrafficSample,
} from "./networkTraffic";

// Only these two bounded SVG paths change on animation frames. React, the
// metric cards and network workspace stay on the one-sample-per-second path.
export const NetworkTrafficChart = memo(function NetworkTrafficChart({
  history,
  animate,
  label,
}: {
  history: TrafficSample[];
  animate: boolean;
  label: string;
}) {
  const clip = useId();
  const up = useRef<SVGPathElement>(null);
  const down = useRef<SVGPathElement>(null);
  const display = useRef({ end: 0, max: 1, generation: -1 });
  useEffect(() => {
    const latest = history.at(-1);
    if (!latest) {
      up.current?.setAttribute("d", "");
      down.current?.setAttribute("d", "");
      display.current = { end: 0, max: 1, generation: -1 };
      return;
    }
    const targetMax = Math.max(
      1,
      ...history.flatMap((sample) => [sample.traffic.up, sample.traffic.down]),
    );
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const paint = (end: number, max: number) => {
      up.current?.setAttribute("d", trafficPath(history, "up", end, max));
      down.current?.setAttribute("d", trafficPath(history, "down", end, max));
      display.current = { end, max, generation: latest.generation };
    };
    const start = () => {
      cancelAnimationFrame(frame);
      const before = display.current;
      if (
        !animate ||
        document.visibilityState === "hidden" ||
        motion.matches ||
        before.generation !== latest.generation ||
        latest.sampledAt - before.end > 2_500
      ) {
        paint(latest.sampledAt, targetMax);
        return;
      }
      const started = performance.now();
      const draw = (now: number) => {
        const progress = Math.min(1, (now - started) / TRAFFIC_INTERVAL_MS);
        // Smooth vertical rescaling as peaks enter/leave the rolling window.
        const scaleProgress = Math.min(1, (now - started) / 250);
        paint(
          before.end + (latest.sampledAt - before.end) * progress,
          before.max + (targetMax - before.max) * scaleProgress,
        );
        if (progress < 1) frame = requestAnimationFrame(draw);
      };
      draw(started);
    };
    start();
    motion.addEventListener("change", start);
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", start);
      document.removeEventListener("visibilitychange", start);
    };
  }, [history, animate]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 600 104"
      className="h-40 w-full overflow-hidden"
      preserveAspectRatio="none"
    >
      <defs>
        <clipPath id={clip}>
          <rect width="600" height="104" />
        </clipPath>
      </defs>
      <line x1="0" y1="100" x2="600" y2="100" className="stroke-border" />
      <g clipPath={`url(#${clip})`}>
        <path
          ref={up}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          className="text-primary"
        />
        <path
          ref={down}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          className="text-emerald-500"
        />
      </g>
    </svg>
  );
});
