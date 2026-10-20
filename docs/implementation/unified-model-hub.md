# Unified model picker and routing decisions

## Scope and reference

This implementation follows Magpie's client → gateway → provider workflow and routing transparency, using Sivio's existing guarded configuration writers. Reference: https://github.com/yetone/magpie and https://github.com/yetone/magpie/blob/main/docs/reference.md (local study: `magpie-study-2026-10-19.md`).

The picker and routing decisions are dedicated pages in the Models directory under Model management. Overview and client provider pages do not duplicate these action buttons. It supports Claude Code, Codex, Gemini CLI and Grok Build. Each client uses its own configured providers; credentials are not converted between clients. Search covers provider names and configured models, including Claude model options and published Codex models. An explicit custom model ID handles models absent from the configured catalog. This is not an upstream-wide model discovery service.

## Selection behavior

- Selection keeps the current direct/routing/aggregation mode. Aggregation remains limited to clients that already support it (Claude and Codex). Selecting another provider also sets that mode's default provider.
- Catalogs include a revision of provider configuration, mode and current model. A stale selection is rejected and the dialog keeps its input/error; refresh retrieves the latest configuration.
- Writes use the settled per-client mode lock and existing projection/recovery logic. Unsupported official accounts are disabled with a reason. Detached proxy configurations must be reattached before selecting a model.
- Claude routing/aggregation choices are stored in device-local selection state. The provider's direct default is preserved; restart, reconnect and resynchronization reuse the routed choice. Existing Claude `/model` persistence remains in place.
- Codex, Gemini and Grok model fields use their existing provider projections. Other provider fields and credentials are preserved. Already open client processes may require a new session/restart to read changed files.
- The model page disables editing while catalog data is loading and blocks navigation during an active write. Write failures stay visible; success updates the current configuration in place. The catalog and application panel use two columns when the content area is wide, and stack vertically in narrower windows. Client selections and route-record filters survive page changes in UI memory. The Connections page in Models retains the default three-column diagram.

## Routing evidence

The forwarder records the request model, available candidate order, actual provider attempts, final outgoing model, sanitized result/HTTP code and time to upstream response. Rectifier retries and failover attempts are individual entries. Explicit aggregation routing and default aggregation routing have distinct reasons. Failed forwarding is persisted even when no usage tokens are available.

An observer passes response bytes through unchanged and optionally reads the upstream-reported model from bounded JSON/SSE buffers. HTTP acceptance, body reading completion, read errors and interruption are separate states. Reading to EOF does not prove that the model completed its task. Compressed, oversized or unsupported response shapes can leave the reported model unavailable.

SQLite schema v21 adds a metadata-only table. It retains at most 500 requests, with up to 100 candidates/attempts and 256 characters per identifier. The viewer shows the latest 200 entries and supports client filtering. No prompts, response text, credentials, headers, URLs or upstream error bodies are stored in these records. Entries survive restart, stay local during configuration sync, and do not trigger configuration backup/sync on every request. Local database backups include the table.

Direct traffic bypasses Sivio and cannot appear here. Requests rejected before forwarding context creation (for example malformed request envelopes) are not represented as routing attempts. Recording is best effort; abrupt process termination can leave body status incomplete. These records supplement existing cost/usage logs.

## Validation

Evidence is in `build/reports/unified-*`:
- Isolated HOME tests exercise all four clients in their supported modes, provider/model changes, invalid IDs, stale revisions, restart persistence and absence of invented traffic.
- Actual loopback HTTP tests exercise Claude selected model before/after restart, 429 → backup provider, outgoing/reported model identity and an all-failed request. They assert that private request/response text and error bodies are absent from routing records.
- Trace tests exercise split SSE chunks without byte changes, dropped streams, client filtering and bounded retention. Database tests exercise v20 → v21 upgrade/reopen and sync preservation.
- Frontend tests exercise search, provider identity, custom IDs, failure handling, saving-state dismissal protection, disabled providers, trace ordering and filtering.
- Chromium runs the actual application frame with mocked Tauri IPC for Chinese/English/Japanese, light/dark and 960/1021/1280 window widths. It checks modal bounds, scrolling, selections, refresh, reopen and trace details. This is renderer validation, not a claim of live remote-provider or native Claude Code acceptance.

Final regression and packaging results are recorded in the corresponding report files. The rebuilt Apple Silicon app uses the existing internal stable local signing identity; it is not a notarized public release and does not replace the installed application automatically.

## Final verification (2026-10-19)

- Connection mode regression: 173 passed.
- Proxy regression: 1,606 passed, 1 pre-existing ignored test.
- Unified integration filter: 26 passed (includes 5 new model/trace/migration/sync tests).
- Database schema regression: 8 passed.
- Frontend component regression: 24 passed; TypeScript check passed.
- Browser: 18 modal language/theme/width combinations and interactions passed; existing three-column matrix: 234 layouts passed.
- OpenSpec strict validation passed.
- Package verification report: `build/reports/unified-model-hub-package-verified.json`.

## Model menu redesign (2026-10-19)

The user's follow-up explicitly moves both tools into the Models menu and requests a redesign. The model directory now starts with a Model management group containing Model selection and Routing decisions, followed by client configuration entries. Both are full pages with standard page headers, sidebar selection, breadcrumbs and persisted navigation. The former Overview and client-page button strips were removed.

Validation: 54 frontend/integration/navigation tests passed, including actual App navigation protection, saving in place and remembered client/filter state. Browser coverage uses real Sidebar, WorkspaceFrame and model pages with mocked IPC: 144 layout combinations across three languages, normal/long names, two sidebar states, three widths and two themes. Backend behavior is unchanged from the previous verified build. Evidence: `build/reports/model-menu-tests.log`, `model-menu-browser.json`, and `model-menu-package-verified.json`.

## Connection overview migration (2026-10-19)

The entire client → gateway → provider diagram now lives in Models → Model management → Connections, before Model selection and Routing decisions. Overview retains its workspace summary and client shortcuts, without the diagram. Provider and mode queries mount with the new page; client links, gateway/routing settings, MCP and app-management links retain their existing destinations. The page uses the standard header, breadcrumb and persisted model-domain navigation. Existing diagram CSS and measured SVG connections are unchanged.

Validation evidence: `build/reports/model-connections-tests.log` (55 related tests), `model-connections-typecheck.log`, `model-connections-browser.json` (real shell/pages with mocked IPC), and `model-connections-package-verified.json`. Browser checks cover three languages, normal/long/empty data, expanded/collapsed sidebar and 13 window widths, plus light/dark screenshots, page ownership, navigation restoration, diagram links and gateway status updates. Backend model-selection and route-record behavior is unchanged.
