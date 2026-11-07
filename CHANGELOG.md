# Changelog

## [0.1.12] - 2026-11-07

- Imported Google Maps stops keep their original clickable business URL, with validated coordinates saved separately. Reading view, map cards and KML use the original URL or a saved Place ID. Editing a URL invalidates its old pin until reconverted. The planning skill preserves source links as well.
- Short links expand through Obsidian's network API on desktop and mobile, with no Node or Electron runtime dependency. If Google blocks expansion, the original link stays intact and the plugin asks for the full place URL.
- In-flight place details and link conversions cannot write into another note after a same-pane file switch. Late writes and queued work are discarded after unload.
- Saved routes validate both endpoints, transport and transit departure context. Google route requests share a three-request limit and pause after refusals.
- Chinese opening-hours checks accept prefix day periods and additional range separators.
- View references follow Obsidian workspace ownership, pending editor debounce is canceled on unload, and map chrome and interactions use the view's own document and window.
- Updated test tooling and patched vulnerable development dependencies.

Compatibility: existing `geo:` notes remain readable. Newly imported Google Maps stops require 0.1.12 or newer on each device for map display. Older route metadata shows straight-line distance until refreshed with a Google API key; coordinate-only legacy stops cannot automatically recover a lost business URL.

## [0.1.5] - 2026-09-14

- Clean CSS lint (stylelint with Obsidian's config, now part of `pnpm check`). The flagged lines were Leaflet's vendored stylesheet: its duplicate prefixed properties, `!important` tile rules, `text-indent` hack and IE-only rules are gone, with the tile and attribution rules scoped to the plugin's pane instead. The route arrowhead is a CSS border triangle rather than a `clip-path`, and the stop popup pins its width through Leaflet's options rather than an override. Tiles force `border-radius: 0` so themes that round every image no longer leave gaps between tiles. Release assets are now attested with GitHub artifact attestations (`gh attestation verify main.js --repo kevinsslin/wayfarer`). The settings tab declares its settings through `getSettingDefinitions()` so they appear in the settings search on Obsidian 1.13+, while still rendering the classic tab on 1.11.

## [0.1.4] - 2026-09-14

- The trip-planning skill now covers the whole job (intake, research, day structure, the note, and the planning notes with constraints, bookings, per-stretch reasoning with a backup, and open questions), comes with a finished example note, and installs with `npx skills add kevinsslin/wayfarer` or as a Claude Code plugin marketplace (`.claude-plugin/`). Settings point to it. The plugin now passes Obsidian's plugin lint (eslint-plugin-obsidianmd): command and setting names in sentence case without brand words, Obsidian's element helpers instead of raw DOM calls, `getLanguage()` for the UI language, no inline styles from code, and the Node https guard written as `Platform.isDesktop`. Command names changed: "Convert the map link on this line to a stop", "Convert every map link in this note", "Export the trip as a map file".

## [0.1.3] - 2026-09-14

- Runs on mobile. The map opens as its own tab on a phone, and on any pane narrower than a phone landscape the timeline is an overlay, closed until asked for, that does not touch the saved desktop layout. Short-link expansion stays desktop only (it needs Node's https); the message says so and suggests pasting the full link.

## [0.1.2] - 2026-09-14

- No frontmatter needed. A written time is local time at that place: transit departures use the place's UTC offset from Google details (saved as `utc` in the stop's metadata), or a guess from the longitude, so a trip across countries needs no `timezone:` key and the new-trip skeleton no longer adds a `locations:` key. Repository renamed to `kevinsslin/wayfarer`.

## [0.1.0] - 2026-09-14

First release.

- Desktop only for now: short-link expansion uses Node's https, and Obsidian's submission rules require `isDesktopOnly` for any Node use. The map follows a note opened in the same pane, not only a change of pane. A long card scrolls its text under a fixed photo and stays clear of the chip bar.

- Second audit pass, performance: zooming moves only the arrowheads instead of rebuilding every pin, line and card; legs are computed once per draw; the tile layer is only replaced when its URL changes; a route arriving no longer forces a parse and draw per leg; editor chips compare raw text and skip cursor moves within a line; tooltips are built when shown; a failed photo is not asked for again on every redraw and the photo cache is bounded. Bugs: a route for a place that appears twice in the note (the hotel every evening) goes to the right line; a timeline card dropped on the editor no longer types its line number; the pinned day follows its heading when days are added or removed; "Go to line" on a hovered card goes to that card's stop; a pasted link keeps its trailing full stop out of the URL; the new-trip date defaults to the local day; a heading inserted mid-line starts on its own line; opening hours running past midnight count for the small hours of the next day; `[label](maps url)` and `$` in names survive conversion and messages; four-backtick fences and commented-out headings are ignored.
- Pre-release audit: a `%%wf:{}%%` comment is written to the stop it belongs to when a line holds several stops; a route that arrives after the note changed or the pane moved to another note is dropped, not written to the wrong line or file; a leg Google has no route for, or a refused key, is not asked again on every redraw; Google photos are downloaded once per session and shared by cards and popups; a `timezone:` frontmatter key makes transit departures local to the trip; a time is read after an emoji with a variation selector or a task box; headings inside code fences and links inside `%%` comments are not part of the plan; indented geo links under a stop are notes, as documented; hand-edited metadata of the wrong type is ignored instead of breaking the editor chips; changing a setting redraws the pane; Japanese opening hours pick the right weekday; bike legs open bicycling directions; "Convert every link" handles several links per line and counts only the converted ones; converting a link inside `[label](url)` keeps the label.

- Google Maps link conversion on paste and by command, including `maps.app.goo.gl` short links on desktop. With a Google key, exact pins with rating, opening hours, address, website and photo; a text lookup is only accepted when it lands where the link points.
- Timeline cards show one summary line; the chosen card unfolds its notes and folds again when another is chosen. The camera and popups centre on the part of the map not covered by the floating timeline. "All" is the first chip.
- A refused Google request (API not enabled, key restricted) is reported once with Google's message; a **Test key** button in settings makes one Places and one Routes call. A leg whose result is already saved on the stop is never asked again.
- Command **Fetch Google details for stops without them** enriches hand-written stops (rating, hours, address, photo) one Places call each, pin unchanged.
- Writes from the pane (transport, routed legs, drag reorder) go to the file when the note is in Reading view; before, they landed in the hidden editor and were never saved.
- Undated sections in a note that has dated days are notes, not days: to-dos, research and candidates live in the same note and stay off the map. Straight legs are dashed, routed ones solid; the route shape is saved with the leg so the road is drawn without asking again. Hovering a pin shows its card; choosing a card in the timeline shows the same card on the map. Chips switch on the first click.
- Range headings (`## 2026-09-19 ~ 2026-09-26 東京`) keep several days as one block for a stretch not yet planned day by day: one chip, one section, no weekday checks.
- Map pane beside the note: pins coloured and numbered per day heading, category emoji on pins, lines with arrowheads between a day's stops, click a pin for a card.
- Cursor follow: the map flies to the stop under the cursor and reframes the day; pauses while you drag.
- Timeline column: the day's stops top to bottom with thumbnails, times and notes; a transport picker on each arrow; drag to reorder (the stop's notes move with it); resizable and collapsible.
- Transport is the emoji before the link, written by you or by picking on the arrow in the pane (the pick replaces the emoji in the text, so note and map never disagree). Nothing is guessed.
- Routes between stops from Google Routes when a key is set (walk, bike, drive, transit with line names), drawn along the way with the mode's emoji at the midpoint; distance only otherwise. Late warning when a routed leg cannot fit between two written times.
- Opening-hours check against the written time for the heading's weekday.
- Indented lines under a stop are its notes, shown verbatim.
- Routed times, distances and line names are saved on the stop so companions without a key see them; stale after a reorder, then refetched.
- "Export to Google My Maps (KML)": one folder per day, named after the note, regenerated in full each time.
- `%%wf:{…}%%` metadata shown as a small chip in Live Preview and Reading view.
- "Insert day headings for a trip" command writing `## YYYY-MM-DD 週X` headings.
- Interface in English or Traditional Chinese, following Obsidian by default.
- `skills/wayfarer-plan-trip` skill for AI assistants, with the note format reference.
