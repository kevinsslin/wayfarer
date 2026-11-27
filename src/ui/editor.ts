import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type { Editor } from "obsidian";
import { isGoogleMapsUrl } from "../core/gmaps-url";
import { CATEGORY_EMOJI, pickCategory } from "../core/category";
import { formatStop, maskMeta, metaSpan, stopLinks, visibleLines, type PlaceMeta } from "../core/itinerary";
import type { ResolvedPlace } from "../core/resolve";
import { todayHours } from "./map-view";

/**
 * The URL tokens on a line a conversion may take: only what the reader sees
 * as text (`visible`, the line from `visibleLines`: not fenced or inline code,
 * not a comment), not inside `%%wf:{}%%` metadata, not a link already a stop.
 */
function urlSpans(visible: string | null): { url: string; from: number; to: number }[] {
  if (visible === null) return [];
  const converted = stopLinks(visible);
  const re = /https?:\/\/\S+/g;
  const out: { url: string; from: number; to: number }[] = [];
  const text = maskMeta(visible);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const url = m[0].replace(/[),.;!?]+$/, "");
    const index = m.index;
    if (converted.some((link) => (link.url && index >= link.from && index < link.to)
      || (link.googleFrom !== undefined && index >= link.googleFrom && index < link.googleTo!))) continue;
    out.push({ url, from: index, to: index + url.length });
  }
  return out;
}

/** Line `line` of the note as the reader sees it, offsets kept; null inside frontmatter or fenced code. */
export function visibleLine(note: string, line: number): string | null {
  return visibleLines(note.split("\n")).bare[line] ?? null;
}

/** Finds a Google Maps URL in a line (`visible`, from `visibleLine`), returning its character span. Links in `skip` are passed over. */
export function findMapsUrl(visible: string | null, skip?: Set<string>): { url: string; from: number; to: number } | null {
  return urlSpans(visible).find((span) => isGoogleMapsUrl(span.url) && !skip?.has(span.url)) ?? null;
}

/** The line should be replaced in place; returns the new text for the span. */
export function stopText(place: ResolvedPlace, withEmoji = true, googleToGeo = false, googleLinkLabel = "🗺️", storeMetadata = true): string {
  const cat = pickCategory({ googleType: place.meta?.type, name: place.name });
  const emoji = withEmoji && cat !== "place" ? CATEGORY_EMOJI[cat] : undefined;
  if (!storeMetadata) googleToGeo = true;
  if (!googleToGeo || !place.url) return formatStop(place.name, place.lat, place.lng, place.meta, emoji, place.url);
  // The geo link owns its facts; coordinates and the source already live in ordinary links.
  const { lat: _lat, lng: _lng, locationUrl: _url, ...meta } = storeMetadata ? place.meta ?? {} : {};
  const stop = formatStop(place.name, place.lat, place.lng, meta, emoji);
  const url = place.url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  // Keep a label from introducing a new link, line, code span or hidden comment.
  const label = googleLinkLabel.replace(/[\r\n\t]+/g, " ").replace(/[[\]\\`%<>]/g, "").trim() || "🗺️";
  return `${stop} [${label}](${url})`;
}

/**
 * Swaps the URL on `line` for the resolved stop if the URL is still there.
 * The user may have kept typing while the network call ran, so the line is
 * searched again, and its neighbours in case a line was added or removed
 * above. Only the same occurrence is taken: the whole URL, with the same text
 * before it on its line (`prefix`). Another copy of the link, or a longer URL
 * that starts the same way, is left alone.
 */
export function replaceUrlInEditor(editor: Editor, line: number, url: string, prefix: string, replacement: string, storeMetadata = true): boolean {
  const visible = visibleLines(editor.getValue().split("\n")).bare;
  const search = (ln: number): boolean => {
    if (ln < 0 || ln >= editor.lineCount()) return false;
    const text = editor.getLine(ln);
    const idx = prefix.length;
    if (!text.startsWith(prefix) || !urlSpans(visible[ln] ?? null).some((span) => span.from === idx && span.url === url)) return false;
    // `[label](url)`: the whole link goes, and the user's label stays as the stop's name.
    const link = /\[([^\]]*)\]\($/.exec(prefix);
    if (link && text[idx + url.length] === ")") {
      let named = link[1] ? replacement.replace(/\[[^\]]*\]\(/, () => `[${link[1].replace(/[[\]]/g, "")}](`) : replacement;
      const linkEnd = idx + url.length + 1;
      const existing = metaSpan(text, linkEnd);
      const between = existing ? text.slice(linkEnd, existing.start) : "";
      if (existing && !storeMetadata) {
        // An explicit reconversion may replace a stale href, but must leave
        // existing comments as written and attached to the primary geo link.
        const end = stopLinks(named)[0]?.to ?? named.length;
        named = named.slice(0, end) + " " + text.slice(existing.start, existing.end) + named.slice(end);
      }
      // Re-resolving an edited href replaces the stale coordinates and facts.
      editor.replaceRange(named + between, { line: ln, ch: idx - link[0].length }, { line: ln, ch: existing?.end ?? linkEnd });
      return true;
    }
    editor.replaceRange(replacement, { line: ln, ch: idx }, { line: ln, ch: idx + url.length });
    return true;
  };
  return search(line) || search(line + 1) || search(line - 1);
}

/* ---------- Live Preview decorations ---------- */

class MetaWidget extends WidgetType {
  /** Keeps the raw JSON: comparing strings is what CodeMirror does on every update, parsing happens once per drawn widget. */
  constructor(private json: string, private meta: PlaceMeta) {
    super();
  }
  eq(other: MetaWidget): boolean {
    return other.json === this.json;
  }
  toDOM(): HTMLElement {
    const el = createSpan({ cls: "wf-meta" });
    const bits: string[] = [];
    if (this.meta.rating) bits.push(`★ ${this.meta.rating.toFixed(1)}`);
    const today = todayHours(this.meta.hours);
    if (today) bits.push(today.replace(/^[^:]+:\s*/, ""));
    el.textContent = bits.join(" · ");
    if (!bits.length) el.className = "wf-meta wf-meta-empty";
    if (this.meta.hours?.length || this.meta.address) {
      el.title = [this.meta.address, ...(this.meta.hours ?? [])].filter(Boolean).join("\n");
    }
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Hides the `%%wf:{...}%%` metadata comment and shows a compact
 * "★ 4.5 · 9:00 AM – 5:00 PM" chip in its place, except on the line being
 * edited so the raw text stays reachable.
 */
export const metaDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private cursorLine = -1;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate): void {
      // The cursor line is the one line shown raw, so a move within the same line changes nothing.
      const line = u.view.state.doc.lineAt(u.view.state.selection.main.head).number;
      if (u.docChanged || u.viewportChanged || (u.selectionSet && line !== this.cursorLine)) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
      this.cursorLine = cursorLine;
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        for (const link of stopLinks(text)) {
          if (!link.meta || link.metaFrom === undefined || link.metaTo === undefined) continue;
          const start = from + link.metaFrom;
          const end = from + link.metaTo;
          if (view.state.doc.lineAt(start).number === cursorLine) continue;
          b.add(start, end, Decoration.replace({ widget: new MetaWidget(text.slice(link.metaFrom, link.metaTo), link.meta) }));
        }
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);
