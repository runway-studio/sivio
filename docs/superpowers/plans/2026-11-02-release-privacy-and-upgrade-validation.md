# Release Privacy and Native Upgrade Validation Implementation Plan

> **For agentic workers:** Follow this plan task-by-task. The writing-plans review is required; execution stays in this session under the user's explicit instruction. The referenced superpowers execution skills are not installed, so repository workflows provide execution and verification.

**Goal:** Remove exposed development metadata, block sensitive release contents, and record a real signed native application upgrade using disposable data.

**Architecture:** A shared Python privacy gate scans tracked source, commit metadata and release archive members, with narrowly fingerprinted upstream fixture exceptions and redacted findings. Source packaging uses tracked-file allowlisting. Cleanup of existing history/assets is prepared with a private rollback bundle before any destructive remote replacement. A test prerelease remains outside the stable feed; native testing exercises production download, verification, replacement and restart with synthetic state.

**Tech Stack:** Python unittest, Git/GitHub Actions, Tauri/Rust, macOS codesign, existing release signing identities.

---

## Task 1: Remove current metadata and prevent recurrence

Files: `experiments/m0-host/pnpm-lock.yaml`, `openspec/changes/add-unified-ai-macos-app/design/design-system.md`, `scripts/release/privacy.py`, `scripts/release/privacy-allowlist.json`, `scripts/release/test_privacy.py`, `scripts/release/test_build.py`, `scripts/build-app.py`.

- [x] Replace internal mirror URLs with public npm tarballs; verify integrity for the affected public packages without contacting internal hosts.
- [x] Replace personal absolute references with an honest description of the external design reference, without inventing a repository file.
- [x] Add failing scanner tests for company hosts/email, personal home paths, private key blocks, token formats, forbidden runtime/credential filenames, archive nesting and exception digest changes. Diagnostics contain only path/rule, never secret values.
- [x] Implement source/history/ZIP/TAR scans. Allow known public upstream fixtures by exact path and SHA256; reject changed exceptions. Skip descriptive placeholder paths, not arbitrary personal paths.
- [x] Package only tracked approved paths; normalize tar ownership metadata. Test that ignored `.env`, untracked files and local caches cannot be packaged.
- [x] Run `python3 -m unittest discover -s scripts/release -p 'test_*.py'` and scan current source. Expected: clean source, negative fixtures rejected.

## Task 2: Enforce build/publication gates

Files: `.github/workflows/release.yml`, `.github/workflows/privacy.yml`, `scripts/release/build.py`, `scripts/release/manifest.py`, `scripts/release/publish.py`, `docs/implementation/releases.md`.

- [x] Run source/history checks before secret-bearing build steps and asset upload; run artifact checks before publishing. PR checks are read-only and receive no signing secrets.
- [x] Exclude unsafe diagnostic uploads or scan them before publication.
- [x] Set repository-local commit identity to the authenticated GitHub noreply address; do not modify global identity.
- [x] Re-run focused release tests and workflow syntax checks; commit only the scoped files.

## Task 3: Prepare and apply public-history cleanup

Files: ignored `build/privacy-cleanup/` manifests and rollback backup; no raw exposed values in new public reports.

- [x] Read remote refs/releases/runs and record exact expected SHAs and affected immutable artifacts.
- [x] Create private local rollback bundle, then rewrite a disposable mirror: replace only the known internal registry host/personal path, replace this project's author/committer email with GitHub noreply, preserve commit structure.
- [x] Scan rewritten reachable history and review ref mapping and exact source changes.
- [x] Present the concrete history/tag/old-Release replacement plan before force-pushing or deleting assets; these actions invalidate old commit references/checksums and require explicit confirmation.
- [x] After approval use leases/expected SHAs, update source-linked assets consistently, remove obsolete public artifacts containing old source, and verify anonymous downloads. State any provider-cached/unreachable copies requiring GitHub support.

## Task 4: Real native upgrade with isolated test state

Files: optional `scripts/validation/native-upgrade.py`, feature-gated native driver if UI automation cannot safely isolate the installed app; `.github/workflows/` validation workflow as needed; acceptance record in the existing release proposal.

- [x] Inspect process/data paths and helper ownership first. Prefer an isolated runner or dedicated test app/data; never stop or replace the user's installed app or adopt its live network lease.
- [x] Build a signed higher test version with the existing identities; publish only as prerelease (never stable/latest). Validate privacy, source binding, architecture and signature first.
- [x] Use native app commands or UI to check the HTTPS test feed, download, verify, install and restart. Do not substitute filesystem swap tests for this path.
- [x] Seed a synthetic database record and preferences before upgrade; verify them after native restart. Capture old/new version, hashes, process restart, retained recovery bundle and signature identity.
- [x] Exercise signature/network failure without replacing the old app. Check network cleanup and helper acceptance where safely isolated; mark any unavailable privileged case explicitly unverified.
- [x] Record concrete evidence and remaining limits; clean up only owned test processes/resources. Keep stable feed unchanged unless separately approved for a cleaned stable release.
