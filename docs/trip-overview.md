# Optional trip overview

Long trips can need an overall route between cities or bases as well as the
normal daily excursions. The optional overview is a second view of the same
Markdown. **All** in the daily view continues to show daily stops only.

## Enable two levels

In Settings, under Advanced, set **Heading level that starts a day** to `###`
and **Trip overview heading level** to `##`.

The overview defaults to **Off**. Existing settings and parsing keep their
previous behavior until it is enabled. The parent level must be shallower
than the day level; an invalid combination uses the existing flat parser.
Other levels, for example `#` parents and `##` days, are supported too.
This is an explicit change of scope, not a migration of notes.

```markdown
# Sri Lanka

## 2026-12-26 Colombo
- [Colombo base](geo:6.9271,79.8612)

### 2026-12-26 Colombo excursions
- [Airport](geo:7.1808,79.8841)
- 🚗 [City](geo:6.9271,79.8612)

## 2026-12-27 - 2026-12-28 Negombo
- 🚗 [Negombo base](geo:7.2083,79.8358)

### 2026-12-27 Market and mangroves
- [Market](geo:7.2100,79.8400)
- 🚗 [Mangroves](geo:7.2300,79.8500)

### 2026-12-28 Beach
- [Beach](geo:7.2200,79.8300)
```

These coordinates illustrate the format, not researched hotel or excursion
recommendations. Existing imported Google stops work at either level too.

## Views and navigation

**Day plans** retain the normal cards, times, dates, transport, routes, source
navigation and drag and drop. Parent pins are not automatically added to any
day; include the hotel again if it belongs to that day's route. Subheadings
inside a day retain the existing daily behavior.

**Trip overview** uses pins directly under a configured parent heading, before
its child headings. A stage can have one or several pins and one or several
child days. Its card keeps the original remarks, images, facts and date or
date range, and lists clickable child daily plans. Repeated places on separate
stages remain distinct. A stage without its own pins adds no marker; its child
days still work.

On desktop, use the **Trip overview** chip. On a narrow pane or phone, the
day/stage selector offers **Trip overview** or **Day plans**. Switching layers
opens **All**, so a previous day or stage filter cannot narrow the overall
route. The last browsed stop is remembered separately for each view on this
device; restoring it does not select a date filter. Another note starts in
its daily view, or its overview if it contains parent pins only. Switching
views and drilling down do not write into the note.

Clicking a child daily plan switches to that day and reveals its original
heading in the note, at the top where space permits. A normal stop card or
marker selects that stop; on desktop it also reveals an already-open copy of
the note without stealing focus. **Go to line** explicitly focuses or opens
the note, including on mobile. Both source/Live Preview and Reading mode are
supported. Stop jumps are centered in both modes where scroll space permits.
Reading mode first uses native line navigation to reveal folded headings and
highlight the destination, then centers the stop after rendering. Headings
keep their top alignment. No Markdown mode is forced.

Cursor following works in source/Live Preview on desktop. A parent heading,
city pin or its remarks selects the overview; a child heading or its stops
opens the daily view. **All** stays selected while the current stop/day is
emphasised, and the list retains the whole route. Browsing cities from map
cards or the previous/next controls follows the same rule. Only explicitly
selecting a date/stage pins that filter; **All** releases it. A pinned stage
does not follow a child of another stage. Child-plan buttons deliberately
select a specific day and reveal its heading.

The **Follow cursor** setting controls camera movement, including when the
cursor changes layers. Reading-mode selections and scrolling do not supply
an editor cursor. Mobile retains explicit map/list controls rather than
automatic editor cursor following. Geo and Google helper links keep their
external-map action. With overview disabled, the original flat navigation
and selection behavior is unchanged.

## Routes and dates

Connections run from the previous mapped stage's last pin to the next stage's
first pin, in document order. Dates do not sort the note or expand a stay into
duplicated pins. Within each stage the usual routing behavior applies.
Upstream's research-section rule applies independently to each layer: if any
group has a full date, undated groups at that level are omitted from the map.
An entirely undated layer works. Keep full dates on all route groups when
mixing dated plans with research headings.
Dates are read anywhere in the heading, for example `## Colombo - 2026-12-27`.
Dated parents with entirely undated child headings work, as do undated
parents with dated children. Dates are not inherited or guessed: an undated
excursion under a dated stay has no specific weekday or departure date.
Heading links remain ordinary Markdown links, not map pins; put the city
link directly below its heading.
The existing shared router, caches, photos and place details are reused.
Without a mode or key, connections show straight-line distance.

Across stages, neither a departure date nor a same-day clock gap is known.
There is no clock-based lateness check on those bridges. Non-transit routing
can supply road geometry; train, bus, metro and tram bridges stay straight-line
connections without requesting or reusing a guessed timetable. Plan those
services in a dated daily plan. Single-date stages retain the normal weekday
checks for their own stops. Date ranges retain unknown-weekday behavior.

## Editing and compatibility

Source navigation, Google links, details and transport edits refer to the
original note. Overview dragging is disabled: moving only a pin would detach
it from its child headings. Whole-stage reordering is outside this feature.
Daily drag and drop retains its existing behavior.

Turning overview off restores the original flat interpretation. Notes are
never automatically rewritten, moved or reformatted. Existing link formats,
metadata comments, plugin ID, version and default behavior are preserved.
KML continues to export daily folders and placemarks; no overview geometry
or second export format is introduced.

This feature is independent of geo/source-pair imports and the option to
disable metadata persistence. Upstream can adopt it on its own.
