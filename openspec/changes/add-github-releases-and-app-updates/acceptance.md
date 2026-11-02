# Release/update acceptance — 2026-11-02

## Implemented and locally verified

- Apple Silicon only; stable internal macOS identity plus a separate Tauri update identity. Private material stays in ignored caches and authorized GitHub Actions Secrets.
- Official/custom/disabled channel migration; candidate-bound download/verification/confirmation; shared unsaved-draft gate; cleanup before same-volume replacement; old bundle retained and rename failure restored.
- Release scripts: **10 tests passed**, including real signature verifier vectors, tampering, archive path/link rejection, source reference, complete asset set, old stable/RC policies and source packaging exclusions.
- Renderer: **37 tests passed** across update UI, existing App integration and unsaved changes; TypeScript check passed.
- Native: **7 targeted tests passed** (channel migration 1, installation replacement/rollback 1, update candidate/signature/package 5). Package test builds and checks a real codesigned fixture; it is not a full app upgrade.
- Local release-mode Apple Silicon build succeeded, with embedded renderer/offline cores, stable codesign, final `.app.tar.gz` signing and production verifier. Product/version/architecture and bundled source filename/hash were independently checked. Diagnostic report: `build/reports/app-aarch64-artifact.json`; build log: `/tmp/sivio-update-package.log`. This build has `sourceDirty=true` and publication correctly rejects it.
- Workflow YAML, scoped permissions, action SHA pins, four product versions and OpenSpec strict validated.

## Remote state

- GitHub login restored; repository admin access verified.
- User explicitly authorized `runway-studio/sivio` to become public; API readback confirms `private=false`.
- User explicitly authorized the existing macOS certificate/private key/password and Tauri private key/password to be stored in this repository's Actions Secrets. P12 export was canceled at its interactive password prompt. An encrypted project-keychain snapshot was used instead: metadata inspection showed exactly one private key and one certificate, zero password records. An isolated copy unlocked, signed a fixture and passed the original certificate fingerprint requirement. The four signing/update secrets were successfully configured without disclosing values. CI portability remains a separate check.

## Not yet verified

- NOT_VERIFIED: clean GitHub runner build and final artifact set. Manual `validate_only=true` runs can validate a clean commit without creating a release tag or publishing.
- NOT_VERIFIED: isolated native N→N+1 with user database/settings preserved, real network cleanup/recovery and same-identity privileged helper recognition.
- NOT_VERIFIED: published Release, anonymous asset/manifest readback and latest selection. No actual version tag/Release is authorized solely by this acceptance record.
- Existing dependency inventory still records missing standalone notices for `seahash@4.1.0` and `html-parse-stringify@3.0.1`; public cached supplements are now versioned for consistent clean builds. This work does not claim legal clearance.

## Release boundary

Current product version is `0.1.0`. An existing internal 0.1.0 installation requires a manual first installation; it will not automatically upgrade to the same version. Before the first publication, present the exact commit, version, asset hashes and remaining native acceptance limits. Do not label a local dirty build or filesystem rollback test as a verified production upgrade.
