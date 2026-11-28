# Geo-link navigation verification

Base: upstream `238332f6c910e9153e22cd7fda5b62380369140a` (0.1.14).
Branch: `feature/follow-geo-links`, independent of the other fork changes.

[Current full checks and native run](https://github.com/crispyduck00/wayfarer/actions/runs/46125860254)
passed on 28 November 2026: **178 unit tests standalone, 260 combined**,
ESLint, CSS lint, TypeScript, production build and built-bundle smoke.

Bundle tests cover exact source occurrences, external/native actions, short
editor touches versus scroll/pinch/long-press/cancel, settings, current/new
mobile maps and filters. Delayed reads and map creation are cancelled when
the user returns to the note, disables the option or unloads the plugin.
A ready mobile map is activated synchronously and takes focus directly,
without a second deferred reveal.

The official Obsidian **1.15.1** desktop renderer passes **28 native checks
standalone and 35 combined**. These include real Reading/Live Preview/Source
clicks, editor touch taps without duplicate compatibility clicks, and repeated
actual note-tab taps that stay on the note without moving the map first.
Source notes remain byte-identical; no renderer errors occur.

Touch editor checks use the desktop editor with touch input. A 412px viewport
and the host Platform flag separately exercise the mobile map-tab branch,
including opening/reuse, focus and note-tab return. Combined checks also
cover overview parents/children and basemap/zoom control visibility.
This is emulation, not an Android binary or physical-device test.

Native hrefs remain intact. The fixture observes modified/middle/right and
contextmenu events before preventing OS/browser launch; it does not execute
every OS menu command. Physical Android editor/keyboard behaviour, long-press
menus, tab switching and suspend/resume still need a device trial.

[Harness and raw reports](https://github.com/crispyduck00/wayfarer/tree/781b4b56989ed95ec2b395b7842ab4105abf8cfd)
are retained outside the feature diff. Runtime candidates:
standalone `fedde931eda7f927b3ff34bd2318d7cc2c90a612`,
combined `59b05cfa0b83f47da215004d0127c044c1e21d2d`.
Final source changes after these candidates are documentation/examples only.
The earlier [24/31-check run](https://github.com/crispyduck00/wayfarer/actions/runs/46120839384)
did not cover editor touch or returning to the note; those cases are included above.
