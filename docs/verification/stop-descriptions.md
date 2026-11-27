# Stop description verification

Base: upstream `238332f6c910e9153e22cd7fda5b62380369140a` (0.1.14).
Branch: `fix/stop-card-description`, independent of the optional fork features.

This is a cosmetic fix for popup and timeline descriptions. Cards already
show the place name as their heading. A display-only description omits the
single place link's label using its source span, including when arbitrary
text precedes it: `- 🚗 gg [Galle Fort](geo:6.026,80.217)` shows `gg` below the
title. Leading time/emoji decoration is omitted too. Other prose and indented
notes remain; later name mentions are not removed. Multi-place sentences and
labels joined to words retain their original prose.

Only the card callers opt into the `stopNotes` display option. KML keeps its
existing prose. The Markdown, existing parsed fields, source offsets, place
names, saved comments and source identity checks are unchanged. No migration
or setting is required.

All 26 focused regression cases pass. Six of the seven added prefix/position
cases fail with the earlier cosmetic fix. Coverage includes multiple emoji, ZWJ and
skin-tone variants, times, formatted link labels, literal punctuation, Google
imports, prefix collisions, multiple links and unchanged raw stop objects.
The full check passes 187 unit tests, lint, CSS lint, TypeScript, production build
and bundled plugin load smoke. Network and Obsidian host surfaces are mocked;
no physical desktop or mobile UI is exercised.
