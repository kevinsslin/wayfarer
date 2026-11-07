import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type { Editor } from "obsidian";
import { isGoogleMapsUrl } from "../core/gmaps-url";
import { CATEGORY_EMOJI, pickCategory } from "../core/category";
import { formatStop, metaSpan, stopLinks, type PlaceMeta } from "../core/itinerary";
import type { ResolvedPlace } from "../core/resolve";
import { todayHours } from "./map-view";

/** Finds a Google Maps URL in a line, returning its character span. Links in `skip` are passed over. */
export function findMapsUrl(line: string, skip?: Set<string>): { url: string; from: number; to: number } | null {
  const converted = stopLinks(line);
  const re = /https?:\/\/\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const url = m[0].replace(/[),.;!?]+$/, "");
    const index = m.index;
    if (converted.some((link) => link.url && index >= link.from && index < link.to)) continue;
    if (isGoogleMapsUrl(url) && !skip?.has(url)) return { url, from: m.index, to: m.index + url.length };
  }
  return null;
}

/** The line should be replaced in place; returns the new text for the span. */
export function stopText(place: ResolvedPlace, withEmoji = true): string {
  const cat = pickCategory({ googleType: place.meta?.type, name: place.name });
  const emoji = withEmoji && cat !== "place" ? CATEGORY_EMOJI[cat] : undefined;
  return formatStop(place.name, place.lat, place.lng, place.meta, emoji, place.url);
}

/**
 * Swaps the URL on `line` for the resolved stop if the URL is still there.
 * The user may have kept typing while the network call ran, so we search the
 * current line text again rather than trusting the original offsets.
 */
export function replaceUrlInEditor(editor: Editor, line: number, url: string, replacement: string): boolean {
  const search = (ln: number): boolean => {
    if (ln < 0 || ln >= editor.lineCount()) return false;
    const text = editor.getLine(ln);
    const idx = text.indexOf(url);
    if (idx === -1) return false;
    // `[label](url)`: the whole link goes, and the user's label stays as the stop's name.
    const link = /\[([^\]]*)\]\($/.exec(text.slice(0, idx));
    if (link && text[idx + url.length] === ")") {
      const named = link[1] ? replacement.replace(/\[[^\]]*\]\(/, () => `[${link[1].replace(/[[\]]/g, "")}](`) : replacement;
      const linkEnd = idx + url.length + 1;
      const existing = metaSpan(text, linkEnd);
      // Re-resolving an edited href replaces the stale coordinates and facts.
      const between = existing ? text.slice(linkEnd, existing.start) : "";
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
