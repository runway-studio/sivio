# Release/update acceptance — 2026-11-02

## Implemented and locally verified

- Apple Silicon only; stable internal macOS identity plus a separate Tauri update identity. Private material stays in ignored caches and authorized GitHub Actions Secrets.
- Official/custom/disabled channel migration; candidate-bound download/verification/confirmation; shared unsaved-draft gate; cleanup before same-volume replacement; old bundle retained and rename failure restored.
- Release scripts: **10 tests passed**, including real signature verifier vectors, tampering, archive path/link rejection, source reference, complete asset set, old stable/RC policies and source packaging exclusions.
- Renderer: **39 tests passed** across update UI, recovery candidate binding/retry, existing App integration and unsaved changes (targeted runs). TypeScript check and final production renderer build passed.
- Native: **7 targeted tests passed** (channel migration 1, installation replacement/rollback 1, update candidate/signature/package 5). Package test builds and checks a real codesigned fixture; it is not a full app upgrade.
- Local release-mode Apple Silicon build succeeded, with embedded renderer/offline cores, stable codesign, final `.app.tar.gz` signing and production verifier. Product/version/architecture and bundled source filename/hash were independently checked. Diagnostic report: `build/reports/app-aarch64-artifact.json`; build log: `/tmp/sivio-update-package.log`. This build has `sourceDirty=true` and publication correctly rejects it.
- Workflow YAML, scoped permissions, action SHA pins, four product versions and OpenSpec strict validated.

## Remote state

- GitHub login restored; repository admin access verified.
- User explicitly authorized `runway-studio/sivio` to become public; API readback confirms `private=false`.
- User explicitly authorized the existing macOS certificate/private key/password and Tauri private key/password to be stored in this repository's Actions Secrets. P12 export was canceled at its interactive password prompt. An encrypted project-keychain snapshot was used instead: metadata inspection showed exactly one private key and one certificate, zero password records. An isolated copy unlocked, signed a fixture and passed the original certificate fingerprint requirement. The four signing/update secrets were successfully configured and their names/timestamps read back without disclosing values.
- Cross-machine signing probe **passed** on GitHub's macOS ARM64 runner in [run 41407960081](https://github.com/runway-studio/sivio/actions/runs/41407960081). The runner temporarily adds its private keychain copy to certificate discovery, restores the key partition list, signs a native fixture and verifies the existing leaf fingerprint; it removes the temporary entry afterward. The developer's login keychain is not used or changed.
- Clean-runner issues corrected: seven internal npm tarball URLs replaced with public URLs after independent SHA512 matching; the removed rolling alpha artifact preserved byte-for-byte under `vendor/cores` with the original publisher digest and corresponding source; all native manifests fetched before offline license metadata collection.

## Not yet verified

- NOT_VERIFIED: isolated native N→N+1 with user database/settings preserved, real network cleanup/recovery and same-identity privileged helper recognition.
- Existing dependency inventory still records missing standalone notices for `seahash@4.1.0` and `html-parse-stringify@3.0.1`; public cached supplements are now versioned for consistent clean builds. This work does not claim legal clearance.

## Clean runner candidate

[Run 41408804190](https://github.com/runway-studio/sivio/actions/runs/41408804190) **passed** on a clean GitHub macOS ARM64 runner. Source: `a2a0bdfb3e5a21c228bd3a655c3c6949370bf611`; version: `0.1.0`; `sourceDirty=false`. Build/sign, final archive verification, manifest assembly and artifact upload succeeded. `publish` was skipped because this was an explicit `validate_only=true` dispatch; no release/tag was created.

| Candidate | SHA256 |
|---|---|
| `Sivio-0.1.0-aarch64.zip` (41,571,446 bytes) | `5e3c84a8e5b87732f3180165ea8797bcffd8ba84319ffba0b6c453f698322eb7` |
| `Sivio-0.1.0-aarch64.app.tar.gz` | `9b75a34500626b175bbe975bca1b855bed715fd42be2ad60977e8718fb2e6789` |
| `Sivio-0.1.0-aarch64.app.tar.gz.sig` | `a96d2e63b292d934898d1a8ee5857442d9e751225212b66489abf305318c7ea5` |
| `Sivio-0.1.0-source-3147a1702fc4.tar.gz` | `3147a1702fc49df6c7ce9820746f33745159df5fd26e130cf476cc7c178a3200` |

The [Actions artifact](https://github.com/runway-studio/sivio/actions/runs/41408804190/artifacts/13125515959) is 165,452,760 bytes, SHA256 `e045ca39031755d2c869eb46d87092cd5652c6aa0a1eb776f011258f9aaaaeaf`. It contains the above assets plus `latest.json`, `SHA256SUMS`, `release-evidence.json` and release notes. This temporary CI artifact is not a published Release or an anonymously available updater feed.

The complete eight-file set was downloaded and independently rechecked with `publish.verify_local`: all hashes, the production updater signature verifier, product/version/architecture and bundled source reference passed. Extracted App codesign deep/strict verification and the original certificate leaf requirement passed with normal macOS permissions (the tool sandbox alone cannot access the required Security services). Source archive inputs and signing-cache exclusions were also checked. The retained local candidate is `dist/ci-release-0.1.0-a2a0bdf/`; no installed App or user data was replaced.

## Release boundary

Current product version is `0.1.0`. An existing internal 0.1.0 installation requires a manual first installation; it will not automatically upgrade to the same version. Do not label a local dirty build or filesystem rollback test as a verified production upgrade.

## Published first release

The user explicitly requested publication at the same current version. [Sivio v0.1.0](https://github.com/runway-studio/sivio/releases/tag/v0.1.0) was published on 2026-11-02 at 17:00:25 Asia/Shanghai, with `draft=false`, `prerelease=false`, and selected as latest. Tag source: `81d2caa5b17924534bdb9fbdb43cad819494f8ac`.

[Release run 41415402515](https://github.com/runway-studio/sivio/actions/runs/41415402515) completed both build and publish successfully. The publish job independently verified the asset set, signatures and source binding, uploaded all eight files, and anonymously downloaded/hash-checked every published asset plus the latest feed. Local follow-up confirmed the public Release HTML, installer HTTP 200, latest version `0.1.0`, feed signature contents, and checksums matching GitHub asset digests. Local anonymous API quota was exhausted, so only metadata used authenticated API access; the page/feed/download checks did not use authentication.

| Published asset | SHA256 |
|---|---|
| `Sivio-0.1.0-aarch64.zip` (41,571,455 bytes) | `7d3d546f50c49cf24cafbade8413838ad20da4ce757dcdeb246afc102f72a8ee` |
| `Sivio-0.1.0-aarch64.app.tar.gz` | `88e2b40e2ed53b41bcdd1cb5fcf5f3bbad63a24861282be3ee3255bcdd0d5ac7` |
| `Sivio-0.1.0-source-adadaea852d0.tar.gz` | `adadaea852d079935ff0eb2662038f644f65ff71d5f7e53ece243ac1be1f8c85` |

This published build supersedes the earlier validation candidate hashes above. Official feed: `https://github.com/runway-studio/sivio/releases/latest/download/latest.json`. Full local readback evidence: `build/reports/v0.1.0-publication.json` (ignored diagnostic output). Native N→N+1/helper behavior remains NOT_VERIFIED; publication of this first manually installed version does not claim that test was performed.
