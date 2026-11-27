# Trip overview verification

Base: upstream `238332f6c910e9153e22cd7fda5b62380369140a` (0.1.14).
Branch: `feature/trip-overview`, independent of the geo-import and session-only
metadata features. One feature commit includes code, tests and documentation.

`overviewHeadingLevel` defaults to 0 (off). The original parser path is retained
when off or invalid. When enabled, the same parser produces two projections
of the original Markdown. There are no synthetic source offsets, generated
hierarchy files, separate notes or migrations. Existing link/comment formats
and the plugin identity remain supported.

The untouched upstream passes `pnpm check` with 161 unit tests. This feature
passes with 181 unit tests, ESLint, CSS lint, TypeScript, production build and
expanded bundle smoke. The frozen lockfile and dependencies are unchanged.

Unit coverage includes parent/day ownership, exact source spans, date ranges,
repeated places and selection references, source boundaries, ungrouped days,
stages without days or pins, nested daily headings, research sections,
dated parents with undated children and the reverse (without date inheritance),
frontmatter, code and comments, disabled/invalid options and other heading
levels. Router tests cover shared-cache reuse, source identity, suppressed
cross-day clock comparisons and no guessed transit timetable across stages.

Built-bundle smoke drives actual map-view handlers with real Leaflet layers
and stubbed host surfaces, layout and camera. It checks marker/connection
counts, desktop and mobile layer selectors, child-plan drilldown, exact source
navigation, separate per-layer selection, daily drag availability, disabled
overview dragging, overview-only details, correct repeated-hotel occurrence
and rejection of stale route writes. View switching and drilldown preserve
the Markdown verbatim.

Navigation regression coverage also checks the child heading's exact source
line and top scroll state, retained centering for editor stop jumps, visible
Reading-view line navigation requests without changing the hidden editor cursor, focus
preservation on passive desktop clicks, explicit mobile source navigation and
suppression of stale Reading-mode cursor events. The original drilldown test
passes before the fix, while the new source-heading assertion fails there.
Preview navigation sends `{ line }` through Obsidian's ephemeral view state;
unlike a bare `{ scroll }` restore, this reveals folded headings, highlights
the destination and synchronizes the view after rendering. Line zero is also
covered. Async source opening is checked
against the requested file before moving or focusing a view.
The smoke also reproduces and fixes a focused stop from another stage while
a stage is pinned. Reopening an overview after a saved stage selection failed
the new regression assertion before the navigation change. It now verifies
that entering a layer opens All, cursor emphasis does not select a date tab
or narrow the list, parent sections stay in overview, child sections open
daily All, and explicit filters still limit following. Map browsing, refresh,
the narrow mobile selector and disabled camera following are covered too.

The [overview navigation run](https://github.com/crispyduck00/wayfarer/actions/runs/46051939024)
also passes 22 native UI checks each for the standalone feature and the
combined fork in Obsidian 1.15.1. Actual source-line, date-chip, marker, card
and child-plan clicks cover All, explicit filters, layer transitions and
disabled camera following. A 412px touch pass covers the narrow selector and
city cards. Both builds retain all pins and leave the Markdown byte-identical,
with no renderer errors. The ten Reading cases below were repeated successfully
for both builds. [Exact harnesses and tested refs](https://github.com/crispyduck00/wayfarer/tree/805b1be2728b49c46572b498a39c3930aa7211f8/.github)
are retained on the fork; JSON results accompany the test package. Marker
and card selections also assert the same stage emphasis as source selection.
The card-emphasis assertion fails against the preceding build and passes
after the scoped view correction.

The [Reading navigation suite](https://github.com/crispyduck00/wayfarer/actions/runs/46036576971)
ran in the unmodified official Obsidian 1.15.1 desktop application/renderer,
headless, with an isolated vault and actual DOM clicks. The target is on
source line 308. [Harness, raw results and screenshot](https://github.com/crispyduck00/wayfarer/tree/2f7f0124ebde2ba48508a239cd68e4d8326c68a5/native-reading)
are preserved on the fork.

| Reading navigation | Previous overview build | Centered build |
| --- | --- | --- |
| Go to line, expanded section | Visible near the top | Visible at 50% of the note viewport |
| Go to line, folded section | Reveals at the top | Reveals and centers |
| Passive map-pin click | Reveals at the top; map keeps focus | Centers; map keeps focus |
| Child heading | At the top | At the top |
| Rapid successive jumps | Ends at the latest target | Ends at the latest target |
| Line zero | Visible at note start | Visible at note start, scroll clamped |
| 412px touch emulation | Visible near the top | Centered in the visible note pane |

All ten checks passed for the previous build, the standalone overview and the
combined fork. The hidden editor cursor remains unchanged in Reading mode;
Markdown stays byte-identical and the source scenarios raise no renderer errors.
Touch emulation collapses both desktop sidebars, so it measures a real note
viewport rather than a leftover 64px pane.

Expanded bundle smoke additionally checks delayed native rendering, heading
alignment, cancellation on newer jumps, file/mode changes, bounded waiting,
note-start clamping and explicit mobile navigation when opening the source
replaces the map leaf. Centering uses public preview APIs and DOM scrolling;
no private renderer internals, mode switch, new setting or link-click handler
is added. Source/Live Preview retains upstream's centered editor jump.

These are desktop-renderer checks, including a narrow touch viewport, not a
physical Android test. Unit/bundle tests still mock host surfaces and network
replies. Real Google replies, device undo and Nextcloud rendering/sync are not
exercised. Whole-stage reordering, arbitrary-depth hierarchy and overview KML
export remain outside this feature.
