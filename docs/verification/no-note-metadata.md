# Optional note metadata persistence

Base: `feature/google-to-geo` at `7327b2f` (upstream PR #12). This feature depends on the geo
import format and its parser/source association. Its isolated diff is
`feature/google-to-geo...feature/no-note-metadata`; against upstream main the
second PR also includes A until A is merged. Do not describe it as independent.

## Behavior

`storeMetadata` defaults to true. Turning it off enables `googleToGeo` and
keeps that toggle disabled. Loading inconsistent settings and both settings
interfaces enforce the same invariant. Turning storage on leaves geo import on.
No notes change merely because either setting changes.

Import, fetched place details, routed legs and transport cleanup are all
covered. Existing comments are still read and left byte for byte as written.
An explicit conversion of an edited Google href preserves an existing comment
before the resulting source helper, with the new pin taken from the geo link.

Place facts use a small session cache keyed by exact pin, source and query/name,
scoped to the Google key and resolved request language. Import seeds it; the
details command explicitly refreshes it. Identical inflight requests share one
promise. Offline failures pause for 30 s, quota refusals for 60 s, other API
refusals for 10 min, and unmatched/far search results for 60 s. Cached facts are
overlaid on fresh parses and never serialized. Photos and routes reuse the
existing session caches. No cache framework, dependency or lockfile change.

Inline chips still read saved comments only. No new inline UI was added.
The map's existing cards/timeline use session facts, including photo references,
opening hours and timezone offsets. Routing still supplies durations, geometry
and lateness checks without writing notes. A restart drops session facts;
ordinary geo pins, source links, text, headings and times survive. There is no
automatic details request on redraw, hover or reopening a note.

## Verification

Node 24.22.3, pnpm 9.12.3; frozen lockfile installation. `pnpm check` passes:
ESLint, CSS lint, TypeScript, 181 unit tests, production build and bundle smoke.
The upstream baseline passed 161 tests; feature A passed 175 separately.
Google responses are mocked. No real key or private vault was used.

- Cache unit tests: concurrent deduplication, reparse/reorder identity, explicit
  refresh, exact pin/source/query isolation, far-away result rejection, offline
  and API backoff/recovery, credential/language changes, unload and restart.
- Bundle smoke: both settings UIs and invalid settings, keyless short URLs,
  unresolved ID-only URLs, offline failures, named imports, RAM details after
  reparsing/moving, actual route callback plus geometry/lateness, no note writes,
  existing comments, transport edits, late responses after rename/delete/source
  or file changes, queued Reading-view writes when storage is switched off,
  and a fresh plugin instance with the same settings and durable plan.
- Follow-up review: reconversion with user prose before an old comment keeps
  that prose outside the geo/source pair, preserves the comment verbatim and
  remains a single stop through repeated bulk conversion.
- Late import facts are discarded when the Google key is changed/removed or
  request language changes before the response. The geo/source pair still
  imports without comments; those old facts cannot enter the new context.
- The AI planning guide and format reference distinguish durable Markdown
  from session facts and describe explicit place refresh, session reuse and
  older saved comments without promising continuously live Google data.
- Existing default-mode tests, Reading view, Live Preview decoration tests,
  stale-write and mobile-host stubs remain green. `git diff --check` passes.

Not executed: real desktop Obsidian, physical Android, actual host undo,
Nextcloud preview or a real sync round trip. The runtime has no Obsidian or
Android device tooling. A mobile-host stub is not an Android device test.
These checks remain manual acceptance work; no device pass is claimed.

## Manual installation / acceptance

Use a copied test vault. The build keeps plugin ID `wayfarer` and upstream
version `0.1.14`: it replaces the original in `.obsidian/plugins/wayfarer`,
and an official update can replace this test build. Disable the plugin before
replacing `main.js`, `manifest.json` and `styles.css`. Keep existing `data.json`;
it contains the key and settings. Do not install a second copy under the same ID.
No new Community release or release tag is part of this change.

Set **Store metadata in notes** off. Paste a full place link and a short link;
check name, pin, original Maps action, one-step undo, automatic and command
conversion. Open the map, fetch details with a key, choose transport and check
the note stays free of new `%%wf` comments. Reopen/reorder, go offline, restart
and reconnect. Check Reading / Live Preview / Source on desktop and Android.
Sync the same note to Nextcloud and check readable text and the clickable
Google source there; fetching session details should create no file versions.

Rebased on the configurable source-label update in the geo-import branch. New
imports use the same unwrapped map-emoji helper, while legacy wrappers and
missing outer parentheses remain readable. Both features pass the complete
check together (181 unit tests plus expanded bundle smoke).
