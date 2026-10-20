# Network Usability Implementation Plan

> **For agentic workers:** Execute inline in this already-authorized implementation session. One plan-document-reviewer reviews this plan; no implementation delegation or commits are requested. The optional superpowers execution skills are not available in this workspace; follow the explicit steps and project checks here.

**Goal:** Fix horizontal sidebar scrolling, centralize network start/stop, enable content-top window dragging, repair proxy-group delay testing with sticky/pinned groups, and reduce repeated macOS Keychain prompts without weakening credential access.

**Architecture:** Preserve the existing Tauri/React Query application, runtime generation boundary and Keychain reference format. A network runtime provider owns the sidebar control and shared snapshot; a local nodes panel owns bounded delay batches and display state. Keychain successful reads are cached by immutable reference, while stable internal code signing prevents each rebuilt executable from becoming a different Keychain client.

**Tech Stack:** React 18, TanStack Query 5, Tailwind/Radix, Rust, Security.framework, existing pinned Mihomo and helper, Python build script.

---

This request directly authorizes the five improvements below within approved F01/F03/F21/F29. It does not authorize deleting Keychain entries, broadening their ACL to all apps, removing helper authentication, replacing installed services, or publishing a release. The internal signing identity stays private in excluded `build/cache`; no developer identity is silently selected.

### Task 1: Shared network control and sidebar layout

**Files:** Modify `app/src/App.tsx`, `app/src/components/shell/Sidebar.tsx`, `app/src/components/network/NetworkWorkspace.tsx`; create `NetworkRuntime.tsx` / `networkTypes.ts` in the same network directory. Test shell/navigation and NetworkWorkspace suites.

- [x] Add regression tests for exactly one start/stop control in the network secondary menu, expanded and collapsed layouts, and no control duplicated in page headers.
- [x] Move shared Settings/Profile/Snapshot types to `networkTypes.ts`, retaining compatibility exports for existing type consumers as needed. Keep domain-specific types local.
- [x] Mount `NetworkRuntimeProvider` around shell children, active only when network domain is selected. Own query key `["network", "snapshot"]`, runtime event invalidation and start/stop mutation here. Expose query state, pending/error, and toggle; `phase === failed` selects cleanup/stop. Preserve current unsaved/pending mutation guard and invalidation behavior.
- [x] Render `NetworkControl` at the bottom of network secondary navigation, before global settings. Full-width content shows state/port and start/stop; collapsed view has tooltip/accessibility labels. Keep failure visible and retryable. Retain an isolated-workspace fallback control only where no shell is provided.
- [x] Ensure all scrollable secondary directories have `overflow-x-hidden`, children `min-w-0`, and row sizing fits the actual inner width. Replace fixed 202px plus margins where classic scrollbars consume width. Verify 960×720, expanded/collapsed, and vertical overflow.

### Task 2: Window dragging across content tops

**Files:** `App.tsx`, `NetworkWorkspace.tsx`, existing `AppPageHeader.tsx` / platform drag constants; shell tests.

- [x] Add `DRAG_REGION_ATTR` and `DRAG_REGION_STYLE` to the persistent breadcrumb top bar and its noninteractive text/blank children; Tauri checks the actual pointer target.
- [x] Reuse `AppPageHeader` for network titles instead of an independent unmarked header. Keep buttons/inputs/selectors explicitly outside drag regions. Do not change Linux suppression.
- [x] Test drag attributes on content top/title and absence on interactive controls. Record the native movement limitation: actual physical dragging was not tested; browser/DOM evidence does not stand in for native movement.

### Task 3: Group delay testing and node UI

**Files:** Create `NetworkNodesPanel.tsx`, `useProxyDelays.ts`, optional local pure `proxyNodes.ts`; modify `ProxyNodeGrid.tsx`, `NetworkWorkspace.tsx`, `networkText.ts`, Rust controller path only as required. Tests in `app/tests/components` and native network/helper tests.

- [x] Compare local Clash Verge `proxy-groups.tsx`, `proxy-group-tools.tsx`, `services/delay.ts` and pinned Mihomo group route; document request/response, timeout and selection semantics before choosing the implementation.
- [x] Reproduce group delay failure with a delayed/partial fixture and actual pinned Mihomo + loopback HTTP target. Avoid requiring a user subscription or changing their active network.
- [x] Use bounded individual proxy reads for a group batch (as upstream does) so each node settles independently. Cap concurrency, deduplicate member names, prevent duplicate group runs, and retain per-node loading/success/timeout/error. Do not globally disable selection for the whole batch. Validate http(s) probe URL and bounded timeout.
- [x] Include runtime generation in query identities and delay requests/results. Cancel queued work and discard late responses on generation/URL change or unmount. Native slow read operations must not hold the app lifecycle mutex; privileged reads must preserve their authenticated boundary. Do not expand arbitrary control routes.
- [x] Show actual node type/current selection, measured colored latency and error status on cards; provide group test, default/name/delay sort, collapse, current-node locate, sticky group header, and manual pin/unpin group ordering. Preserve 60-node paging and hover navigation preferences. Persist only UI pin/collapse/sort settings, never credentials. Gracefully handle automatic groups that cannot be manually selected.
- [x] Test partial failure, encoded group/node names, current-generation selection, duplicate suppression, concurrency bound, URL/gen switch, late completion, disabled core, pin reload, sorting, collapse/locate, and 1000-node bounded DOM. Run real isolated proxy/delay tests.

### Task 4: Repeated credential prompts

**Files:** `app/src-tauri/src/credential_vault.rs`, optional private cache module; `scripts/build-app.py` and a private local-signing helper script; credential tests. Maintain existing service, item IDs and Keychain reference format.

- [x] Confirm the pictured service is `local.siassist.desktop.credentials`; inspect current ad-hoc signing and repeated catalog deserialization. Do not read real Keychain secret values during diagnosis.
- [x] Cache only successful immutable-reference reads/writes, with a bounded capacity and zeroized eviction/drop. Coalesce concurrent cache misses. Preserve failed-read errors and never introduce a plaintext disk fallback. Test repeat reads, new IDs, failed reads retry, concurrency and capacity.
- [x] For internal packaging, prefer an explicitly configured signing identity; otherwise prepare one stable local code-signing certificate/private key in private excluded cache. Use a separate custom build keychain and explicit signing requirement bound to certificate + bundle identifier, preserving security rather than trusting any app with the same bundle ID. Sign the final outer application consistently; keep helper identity/auth behavior unchanged.
- [x] Verify the stable signing requirement across two changed executable builds against an isolated temporary Keychain fixture with interaction disabled. Reject an unrelated/ad-hoc replacement. Do not modify login Keychain ACLs or store passwords in reports/source archives. Existing ad-hoc items may require a one-time user “Always Allow” for the newly signed identity; disclose this limit.

### Task 5: Validation, docs and package

**Files:** `docs/implementation/network-usability.md`, `progress.md`, approved spec scenarios and `build/reports/network-usability-*`.

- [x] Run targeted frontend tests, typecheck and scoped Prettier; run native network/credential/helper tests appropriate to changed boundaries. Avoid concurrent heavy suites when measuring time-sensitive native readiness.
- [x] Run isolated browser fixture using real shell/node components: no horizontal scroll at 960×720, one sidebar control, sticky headers and bounded large groups, latency/status display, drag target attributes, cleanup. Production must exclude fixtures and mocks.
- [x] Record measured results and any native drag/Keychain/installed-service limits honestly. Update approved F01/F21/F29 scenarios and run OpenSpec strict.
- [x] Build `python3 scripts/build-app.py --arch aarch64`; verify new frontend/native source in corresponding source archive, stable designated requirement, deep/strict signature and ZIP/TAR integrity. Do not install the app/service or create a Git commit.

## Execution evidence

Plan review: Approved. Implemented inline. Scoped UI 45/45, App/tray 33/33, network 62/62 plus helper compatibility gate 1/1, vault 8/8, helper 124 passed + 1 existing ignored. Typecheck, scoped format, strict OpenSpec and isolated real-core/Keychain/browser verification passed. Native physical movement, installed helper/TUN and real login Keychain item migration remain outside this acceptance. Final artifact verification is tracked in `build/reports/network-usability-packages-verified.json`.
