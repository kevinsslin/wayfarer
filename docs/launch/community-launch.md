# Wayfarer community launch

Checked on 2026-09-14. Draft material only; no community messages have been posted.

## Positioning

**Plan with your AI agent in Markdown. Follow your trip on a map, right from your phone.**

Start with people who already keep travel notes in Obsidian. Show one complete workflow: ask an assistant to plan, inspect and edit the note beside the map, then follow the same trip on a phone. Lead with the portable note and useful travel workflow. The AI skill is optional; basic maps need no Google API key.

## Where to launch

| Priority | Channel | Concrete next step |
|---|---|---|
| 1 | [Obsidian directory](https://community.obsidian.md/plugins/wayfarer) | Already listed. Use the direct install page in every introduction. Check its description and screenshots after the README refresh propagates. |
| 2 | [Forum: Share & showcase](https://forum.obsidian.md/c/share-showcase/9) | Post the draft below with a desktop capture and the three mobile states. Ask for feedback from people planning an actual trip. Keep follow-up releases in the same topic. |
| 3 | [Obsidian Discord](https://discord.gg/veuWUTm), `#updates` | The official release guide recommends this channel; posting requires the `developer` role. Use a short announcement linking to the forum topic and install page. |
| 4 | [r/ObsidianMD](https://www.reddit.com/r/ObsidianMD/) | Share a practical trip-planning walkthrough, identify yourself as the author, and check the current community rules/flair first. Reddit did not expose readable rules in this check, so permission to self-promote there is not verified. |
| 5 | [skills.sh](https://skills.sh/docs) and your existing AI-tool communities | Offer `npx skills add kevinsslin/wayfarer --skill wayfarer-plan-trip` with a realistic planning example. The leaderboard uses aggregated CLI installation telemetry; this is a distribution route, not a promised listing or ranking. |

The [official release guide](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) explicitly recommends the forum and Discord. The [Share & showcase category description](https://forum.obsidian.md/t/about-the-share-showcase-category/26) includes plugins and workflows. “Plugins ideas” is for ideas and is currently labelled as being archived; use Share & showcase for a working release.

### Current directory evidence

The [official registry](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json) contains `wayfarer` with repository `kevinsslin/wayfarer`. Its description says it has not been manually reviewed by Obsidian staff. The public page shows “Review Passed,” consistent with the current automatic review workflow; do not call that a manual endorsement. During this check the listing still displayed version 0.1.5 while GitHub had 0.1.7, so directory caching/version freshness must be checked separately from GitHub publication.

## What to show

A 30 to 45 second walkthrough is enough:

1. A short travel request and the resulting Markdown note.
2. Select a day or a stop and see it on the map.
3. On the phone: select a place, browse Previous / Next stop, and Navigate.
4. Switch to List to inspect the day, then return to the map.
5. End with the install link and optional skill command.

Use the English screenshots under `docs/screenshots/mobile-navigation/`. They show the real plugin in emulated phone panes with reconstructed host chrome; label them as mobile layout previews. Replace them with real device captures when available. Map tile labels remain in the tile provider's language. The [sample note](../../test-vault/Nikko%20demo.md) is illustrative and is not a verified travel schedule.

For the first week, ask for three kinds of feedback: first-install friction, phone layout problems (including device and text size), and whether the note format fits how someone already plans. Track concrete issues and completed trip-planning attempts before optimizing download counts. A small group of active travellers is more useful than a broad launch with no feedback.

## Ready-to-edit English forum post

**Title:** Wayfarer: plan a trip in Markdown, follow it on a map in Obsidian

I built Wayfarer because I wanted my travel plan to stay in an ordinary Obsidian note while still being useful on a map and on my phone.

Write days as headings and stops as links, or paste Google Maps place links. Wayfarer shows the itinerary beside the note, with day colours, stop details and a timeline. On a phone, you can switch between Map and List, browse the previous or next stop and open Google Maps directions to the selected place.

There is also an optional planning skill for Claude Code, Codex and other compatible agents. It helps research opening hours and transport, write the itinerary, and keep constraints, bookings and backup plans in the same note. You can use Wayfarer entirely without AI.

Basic pins and straight-line distances work without a Google API key. Your own key enables supported routes, place details and photos. Saved details and routes travel with the note. Browsing stops does not create a separate progress record. Map tiles and photos need a connection. Short Google Maps links are expanded on desktop and mobile.

[Install Wayfarer](https://community.obsidian.md/plugins/wayfarer) · [Source, screenshots and sample note](https://github.com/kevinsslin/wayfarer)

Optional AI skill:

```sh
npx skills add kevinsslin/wayfarer --skill wayfarer-plan-trip
```

[Attach a desktop screenshot and mobile layout previews here; label the previews as emulated layouts.]

If you already plan trips in Obsidian, I would love to hear where this fits or gets in the way, especially on a phone. Which part of moving from a written plan to the next place is still awkward?

## Short Discord version

I made **Wayfarer**, an Obsidian plugin for planning trips in Markdown and following them on a map. Desktop note + timeline, mobile Map / List, Previous / Next browsing and Google Maps navigation. Optional AI planning skill; basic maps work without a Google API key. Install and screenshots: https://community.obsidian.md/plugins/wayfarer
