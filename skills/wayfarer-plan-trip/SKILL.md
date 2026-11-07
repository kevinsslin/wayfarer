---
name: wayfarer-plan-trip
description: Research and write a complete day-by-day trip plan as an Obsidian note that the Wayfarer plugin renders as a map, with stops, times, transport, and a to-do list of what is still unbooked. Use when the user asks to plan a trip, add or move stops or days, compare options for a stretch, or turn research (places, hours, transport, bookings) into an itinerary note.
---

# Plan a trip in Obsidian

The user keeps trips as Markdown notes. The Wayfarer plugin shows a map beside the note: headings are days, imported Google Maps links or `[Name](geo:lat,lng)` links are stops, the line carries a time, a transport emoji and a remark. Your job is the whole plan, not just the list of stops: the research, the day structure, the reasoning and the fallbacks, written into one note the plugin reads. Read [FORMAT.md](FORMAT.md) before writing; consult [EXAMPLE.md](EXAMPLE.md) when a complete example would help.

## 1. Intake

Find in the conversation, or ask once, briefly:

- Dates, arrival and departure times, and where each night is spent (or whether that is still open).
- Who is going and the pace they tolerate: stops per day, early starts or not, walking limits, children, mobility.
- Fixed things: flights, trains, tickets and reservations already bought, and which of them are still only intentions. Never invent a booking or a price.
- Must-sees, must-avoids, food priorities, budget ceiling.
- Season and weather risk (typhoon, snow closures, rainy season, heat), and what the user does if the weather turns.

Do not stall on missing answers. Plan on stated assumptions and put each one in the to-do checklist as a line to confirm.

## 2. Research before placing anything

For every candidate place:

- **Coordinates.** From the place's Google Maps page (the `!3d…!4d…` pair in the URL, or the pin), 4 to 6 decimals. When you have the original Google Maps place URL, keep it in the note for the user to convert with **Convert every map link in this note** in Obsidian. Conversion keeps the original clickable place URL and saves coordinates separately. Use a `geo:` link when you have verified coordinates but no original place URL. Never guess numbers; never write a search URL (`?q=name`), it has no pin.
- **Opening days and hours, last entry, seasonal closure.** The single most common planning error is a museum, temple hall, shop or restaurant closed on the planned weekday. Check the weekday of every visit.
- **Getting there and back.** Which bus or train, how often it runs, first and last departures that matter (last bus down the mountain, last ferry), whether a pass covers it, how long it takes.
- **Time needed on site**, and the cost of tickets.
- **What is nearby**, so a day can be walked or covered by one ride.

Prefer official sites and current timetables. Name a source only where the user would have to check it again (a timetable that changes, a closure notice), on the line it affects.

## 3. Structure the days

- Cluster by geography and by opening hours. A day's stops should be walkable or one transit ride apart.
- Anchor each day on its fixed-time items (a departure, a reservation, a last entry) and fill around them, moving outward in the morning and back toward the night's hotel.
- Give each day a theme in its heading (`## 2026-09-17 Thu Up to Senjogahara, sleep at Yumoto`) and make the night's hotel its last stop.
- Four to six stops is a full day for most people. Leave slack after long transfers and before fixed times.
- A stretch the user has not decided yet stays one range heading (`## 2026-09-19 ~ 2026-09-26 Tokyo`) with a line saying what is undecided. Do not invent a per-day schedule to fill it.
- For any stretch with a real choice (this base or that one, mountain or coast, day trip or not), decide, and keep the runner-up as a written backup with the trigger that would switch to it (weather, a closure, a sold-out train).

## 4. Write the note

Three parts, one note, in this order: the to-do checklist, the days, then a short fallback section only if a fork is still open. The plugin reads the days.

**The to-do checklist comes first**, as `## To do` directly under the title. It is what the user opens the week before and the morning of the trip, so it belongs above the days, never at the end. Group it, and order each group by urgency:

- `### Book now`, most urgent first. **Every bed, seat, ticket and pass not yet booked is a line here**, with the price, where to book, and the cost of leaving it. A night with nowhere to sleep outranks any sightseeing ticket. If the trip departs in two days and two nights are unbooked, that is the first thing in the note.
- `### Only if you want to go`: optional things that still need booking ahead (timed entry, a concert, a sumo ticket).
- `### Buy or pack before you go`.
- `### On the ground`: passes and tickets bought at the destination, each tied to the day that needs it.
- `### Recheck before you go`: anything unconfirmed, or that will have moved by departure (engineering works, a ferry timetable, a closure, the weather).

Tick a line only when the user said it is done. Bookings already confirmed go in one line under the title (flight numbers and times), not in the checklist.

**The days**: one heading per day in date order, full `YYYY-MM-DD` first, then weekday and theme. Under it, the stops as a list in visiting order (numbered when the sequence is fixed, bullets when loose). Each stop line:

```
- 07:53 🚌 [Yudaki Falls](geo:36.7959,139.4285) bus from Tobu-Nikko, buy the two-day pass
    Falls are at the bus stop; the trail down to the lake starts left of the tea house
```

- Time first, only when the stop has a fixed time (departure, entry slot, last entry).
- A transport emoji before the link only when the user said how they get there or it follows from the plan (🚶 🚲 🚗 🚕 🚌 🚆 🚇 🚊 ⛴️ ✈️). The plugin routes that leg and draws it. Do not guess a mode; leave it out and the user picks it on the map.
- A category emoji before the link when the name does not say what it is (🍜 food, ☕ cafe, 🏨 stay, ⛩️ shrine, 🛕 temple, 🖼️ museum, 🏞️ nature, ♨️ onsen, 🛍️ shop, 🚉 station, 🛬 airport, ⚓ port, 🔭 view, 🏯 castle, 🎭 event).
- The rest of the line is the one-line remark: why go, what to order, the catch (`last entry 16:30`, `closed Mondays`, `cash only`). Longer notes go on indented lines directly below; the plugin shows them verbatim on the stop's card. **This is where the detail for a day lives**, including the fallback times, the local rules and the thing that will go wrong.
- A day heading can carry a short paragraph under it for what applies to the whole day (a weather call, a warning, the shape of the day). Keep it to a few lines.
- Names in the script the user will see on signs, optionally followed by a familiar name.
- A stretch not yet planned day by day stays one range heading, with the dated facts that will decide how it splits as plain bullets under it.

**The tail**: nothing, unless a real fork is still live. Then one `## Fallback: ...` of a few lines, saying what triggers the switch and what changes. Delete it once the fork closes.

Write in the user's language. Keep sentences short and concrete; the user reads this on a phone at a bus stop.

## 5. Hand back

Keep the handback brief. Open the note with the Wayfarer map beside it; run **Convert every map link in this note** for any URLs you left. With a Google API key, **Fetch Google details for stops without them** adds hours and photos. Choose transport on the desktop timeline arrows or via **Change transport** in a stop’s details on mobile. Start with the to-do list, unbooked nights first. Point out red legs (two written times too close for the leg between them), "closed that day" chips, and what you could not confirm.

## Rules

- Never write `%%wf:{…}%%` comments; the plugin owns them.
- No frontmatter. A written time is local time at that place; the plugin handles time zones per stop.
- Never write ` · 🚶 34 min · 2.5 km` trailers by hand; the plugin computes legs.
- No em dashes or en dashes anywhere. Use commas, full stops, or parentheses.
- Do not pad days with filler stops, and do not move or delete stops the user placed without saying so.
- **The note is a working document, not a research report.** A fact that matters on a day goes on that day's stop line or its indented notes, where the map shows it. Never repeat it in a section at the end.
- **Do not write down the reasoning that produced the plan.** No comparison tables of places you rejected, no section arguing the costs of the plan you chose, no log of mistakes you corrected along the way, no list of sources. The user asked for a plan, not for the working. Keep at most one sentence of why, and only when it changes what they would do.
- **Research you could not place in a day and cannot act on does not go in the note.** Either it becomes a stop, a line on a day, a to-do item, or it is dropped.
- Everything you were unsure about becomes a `### Recheck before you go` line, not a fact in a day.

## Revising an existing note

Read the whole note first, the to-do checklist included. Keep the user's headings, order and wording. Add stops on new lines in the form above. When reordering a day, move whole lines (a stop's indented notes travel with it). When a place turns out closed or wrong, explain it and propose a replacement. If removing it from the schedule is authorized, move the original stop block with its notes and metadata into an undated planning section with the reason; strikethrough alone does not remove a geo link from the map. Update the to-do checklist in the same edit: a change that needs a new booking adds a line, and a booking the user says is done gets ticked.
