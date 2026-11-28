# Follow geo links on the map

Enable **Follow geo link on map** in Wayfarer's settings to select a mapped
stop by clicking or tapping its geo link. It works in Reading view and the
editor, on desktop and mobile. The option is off by default and is separate
from desktop cursor following. Short editor taps are handled before the
editor's own link action; scrolling, pinching and long presses stay native.

An existing map is reused, preferring one already showing the note. A new
map opens on All. A compatible day filter stays selected; a filter that would
hide the clicked stop is cleared. On mobile the map tab is revealed. Repeated
visits to the same coordinates select the occurrence clicked in the note.
The ready mobile map takes focus directly. Returning to the note cancels
pending link navigation, including a slow read or map creation.

Only an ordinary primary click/tap is handled. The real external link target
is retained: right-click, middle-click, modified clicks and Android long-press
are left to Obsidian. Menu choices depend on the host and platform. The small
external-link arrow is part of the same link, not a separate external button.
Google Maps links, including a separate companion link, keep their normal
external action. There is no change to Markdown or saved location data.

Only geo stops included in the mapped plan can be selected. Links in code,
comments or unmapped research sections do not create temporary pins. A stale
rendered source reference is rejected rather than selecting another visit.
No dependency on another fork feature, Google key or new package is needed.
