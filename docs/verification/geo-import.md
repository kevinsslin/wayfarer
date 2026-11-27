# Optional geo imports

Base: upstream `238332f6c910e9153e22cd7fda5b62380369140a` (0.1.14).

Feature branch: `feature/google-to-geo`. `googleToGeo` defaults to false;
old settings and imported Google stops retain their previous behavior.

`pnpm install --frozen-lockfile` with pnpm 9.12.3 succeeded. The lockfile and
dependencies are unchanged. `pnpm check` passed on the untouched base
(161 tests), then on this branch (175 tests, plus extended bundle smoke):
ESLint, CSS lint, TypeScript, unit tests, production build and load smoke.

The geo-pair unit tests cover source identity, localized helper labels,
several stops on one line, metadata ownership, ambiguous arrangements,
moving a stop with notes and rejecting writes after its source changes.
Bundle smoke exercises named and bare URL conversion with/without a key,
one editor edit per conversion, repeat conversion with the option off,
independent unresolved links alongside helpers, preserved times/emoji/prose,
Reading-view source links and facts placed before the helper. Existing
short-link, stale response, mobile-host and default-mode checks still pass.
Network responses are mocks; no paid Google key was used.

The planning instructions now preserve geo/source pairs when producing portable
Markdown or revising an existing plan; the worked example includes one such
pair. Example Markdown is parsed to check that the helper remains one stop.

New imports use `[Name](geo:lat,lng) [🗺️](original URL)`. The label is configurable
in both settings UIs and applies to new conversions only. Empty labels fall back
to the map emoji; syntax-breaking characters are removed. Detection is based on
adjacent same-line links, not their labels. Legacy outer parentheses, either
single remaining parenthesis and parentheses inside a label remain readable.
No notes are automatically reformatted. Tests cover source spans, plain remarks,
metadata edits, stale source checks and repeat conversion for these variants.
An independently imported Google stop with its own saved coordinates or source
identity is not swallowed by an unwrapped pair. Prose, intervening links,
newlines and ambiguous lists of sources still do not associate.

Not executed: real desktop Obsidian, Android, Nextcloud rendering/sync and
physical-device undo. The single editor replacement is checked in smoke,
but the actual host's undo grouping still needs a device pass.
