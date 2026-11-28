# Map sources verification

Base: upstream `238332f6c910e9153e22cd7fda5b62380369140a` (0.1.14).
Branch: `feature/map-sources`, independent of the other fork features/fixes.
No dependencies, plugin identity or Markdown format changed.

[Full CI](https://github.com/crispyduck00/wayfarer/actions/runs/46030043306)
passes with 177 unit tests standalone and 241 in the combined fork,
plus ESLint, CSS lint, TypeScript, production build and bundle smoke.
Upstream has 161 unit tests.

New unit coverage includes fresh installs, exact legacy URL/credit migration,
repeated loading without duplicates, malformed settings, stable order/IDs,
zoom ranges including zero, subdomains and selection/default/deletion
fallback. Bundle smoke checks modern settings registration, legacy-field
mirroring, unchanged Markdown/itinerary/revision on tile-only saves and
unchanged runtime configuration after a failed disk save.

## Native UI checks

The unmodified official Obsidian 1.15.1 desktop application/renderer ran
headless in isolated temporary vaults. **32 checks passed for each build**,
standalone and combined. The [harness and raw reports](https://github.com/crispyduck00/wayfarer/tree/75d308cfa6ca9fd91a906edd357f4f1e26b02c29/native-map-sources)
are preserved on the fork. Tests use actual DOM clicks/taps and deterministic
tile responses, HTTP failures and offline request aborts. No real API key or
user note is used.

| Scenario | Result |
| --- | --- |
| Legacy source / one source | URL retained; no unnecessary switcher |
| Native editor | Add/edit/reorder/default/remove, Cancel, invalid template and blank maximum checked |
| Subdomains | Clearing the optional field restores Leaflet defaults; actual `{s}` requests checked |
| Background switching | Same map, center, marker objects, route group, genuinely open popup and filter |
| Zoom | Maximum 16, maximum zero, minimum 18 and rapid disjoint ranges checked |
| Failure handling | 401/403/404/429/500, offline aborts and slow responses retain itinerary layers |
| Multiple panes | Independent choices; new panes use device-local selection |
| Reconfiguration | Active/default deletion falls back; repeated rebuilds do not add map listeners |
| Full application restart | Device selection persists |
| Narrow touch emulation | 412 × 915 viewport: native selector and settings editor usable |
| Integrity | Notes remain byte-identical; no renderer errors in the source scenarios |

The test fixture waits for upstream camera work before setting the initial
zoom and opening the popup; it asserts that the popup is really open.

## Design and inherited limitation

`Basemaps` owns only backgrounds and the native layers control. A group around
each single tile layer keeps out-of-range sources selectable; the active
child supplies zoom bounds. Unselected sources make no tile requests.
Reconfiguration/disposal removes old layers, the control and its listeners,
including Leaflet 1.9.4's otherwise retained collapsed-control click listener.
Source labels are escaped before entering Leaflet's HTML.

A separate [teardown comparison](https://github.com/crispyduck00/wayfarer/blob/75d308cfa6ca9fd91a906edd357f4f1e26b02c29/native-map-sources/teardown-comparison.json)
reproduces a Leaflet `_leaflet_pos` error when a pane is closed during a zoom
animation in both untouched upstream and this feature. It is an inherited
close-during-animation issue, outside this background-source change; no
additional upstream PR or unrelated lifecycle change is included.

## Manual follow-up

- Physical Android: touch/scroll, keyboard, rotation, host chrome and suspend/resume.
- Live paid/keyed imagery/hybrid providers: credit/logo, token restrictions,
  coverage and zoom limits.
- A real private/LAN server: reachability, TLS and platform HTTP rules.
- Physical desktop/Android plugin reload and real network interruptions.

Narrow touch emulation is not a physical Android test. No paid provider
account or actual Android device was exercised. Offline downloads, persistent
caching, vector tiles and overlays remain outside this feature.

## Narrow-control follow-up, 28 November 2026

The basemap selector now shares the existing zoom-control visibility rule
for narrow popups and the stop list. The standalone full check still passes
177 tests. In the [combined native run](https://github.com/crispyduck00/wayfarer/actions/runs/46120839384),
four targeted checks confirm hiding/restoring both controls for popup/list
changes; a separate wide-popup check retains the normal visible selector.
This is a two-selector CSS adjustment within this feature, without a new
fix PR or runtime dependency on geo-link navigation. Physical Android remains
manual; the native run uses a 412px touch viewport in the desktop renderer.
