# Pinned rolling-release input

The upstream `Prerelease-Alpha` asset for the already pinned Apple Silicon build `alpha-94b13ae` returned HTTP 404 on the clean GitHub runner (2026-11-02). This directory preserves the original downloaded gzip, unchanged, so releases never silently substitute a newer core.

Its original URL, byte size and publisher SHA256 remain in `build/reports/upstream-manifest.json`; `scripts/fetch-mihomo.py` verifies the same values when reading this copy. The corresponding source and license are in `vendor/upstream/mihomo-alpha`, with source provenance in the existing upstream/source manifests. No user configuration is included.
