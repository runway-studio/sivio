# Supplemental dependency notices

These public notices were previously collected into the local build cache for the locked dependencies. They are now versioned so a clean release runner includes the same notices. Each package directory contains its provenance in `source.json`; these are license texts/source notices, not signing credentials.

`scripts/collect-dependency-licenses.py` prefers this directory over the optional local cache. The generated dependency inventory records the content hashes and provenance of bundled notices. Existing inventory gaps (`seahash@4.1.0`, `html-parse-stringify@3.0.1`) remain explicitly recorded; this snapshot does not assert legal clearance.
