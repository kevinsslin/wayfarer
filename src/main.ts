import { MarkdownView, Notice, Platform, Plugin, TFile, debounce, getLanguage, normalizePath, type Editor, type MarkdownFileInfo, type WorkspaceLeaf } from "obsidian";
import { isGoogleMapsUrl } from "./core/gmaps-url";
import { dayAtLine, moveBlock, parseItinerary, patchLineMeta, setTransportOnLine, stopStillAt, type Itinerary, type PlaceMeta, type Stop } from "./core/itinerary";
import type { Transport } from "./core/category";
import { ResolveError, distanceM, resolveMapsUrl, type ResolveDeps } from "./core/resolve";
import { GoogleApiError, expandShortUrl, googlePlaces } from "./net";
import { DEFAULT_SETTINGS, WayfarerSettingTab, type WayfarerSettings } from "./settings";
import { findMapsUrl, metaDecorations, replaceUrlInEditor, stopText } from "./ui/editor";
import { WayfarerView, VIEW_TYPE_WAYFARER } from "./ui/map-view";
import { readingPostProcessor } from "./ui/reading";
import { NewTripModal } from "./ui/new-trip-modal";
import { tripSkeleton } from "./core/gmaps-out";
import { tripKml } from "./core/kml";
import { firstEmoji } from "./core/category";
import { dateForDay, LegRouter, transitContext } from "./routing";
import { PhotoCache, photoFor, type StopPhoto } from "./photos";
import { getLocale, localeFor, setLocale, t } from "./core/i18n";
import { bareLeg } from "./core/legs";
import { googleLanguageFor } from "./core/google-language";

/**
 * Wayfarer: the note is the plan, the pane is the map.
 *
 * `src/core` is Obsidian-free and unit tested. This file wires it to the
 * editor (paste conversion, cursor tracking), the map view, and settings.
 */
export default class WayfarerPlugin extends Plugin {
  settings: WayfarerSettings = { ...DEFAULT_SETTINGS };
  /** Let Obsidian own view lifetimes, including deferred leaves after reload. */
  private get mapViews(): WayfarerView[] {
    if (this.unloaded) return [];
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_WAYFARER)
      .map((leaf) => leaf.view)
      .filter((view): view is WayfarerView => view instanceof WayfarerView && view.isReady);
  }
  readonly router = new LegRouter(
    () => ({ ...this.settings, languageCode: this.googleLanguageCode }),
    () => { for (const v of this.mapViews) v.redraw(); },
    (to, leg, file) => { if (file === this.current?.file.path) this.setStopMeta(to, { leg }, true); },
    (e) => this.googleRefused(e),
  );
  private refusals = new Set<string>();

  /** Tells the user once per session why Google refused, instead of quietly showing distance only. */
  googleRefused(e: GoogleApiError): void {
    if (this.refusals.has(e.message)) return;
    this.refusals.add(e.message);
    new Notice(`Wayfarer: Google refused the request (${e.status}). ${e.message}`, 15000);
  }
  /** Google photos are downloaded once per session and shared by every card and popup, so a redraw costs no request. */
  readonly photos = new PhotoCache(() => this.settings.googleApiKey);
  photoFor(stop: Stop): StopPhoto | null {
    return photoFor(stop, this.settings, this.photos, (link) => {
      const from = this.current?.file.path ?? "";
      const f = this.app.metadataCache.getFirstLinkpathDest(link, from);
      return f ? this.app.vault.getResourcePath(f) : null;
    });
  }
  private current: { file: TFile; itinerary: Itinerary } | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyLocale();
    this.addSettingTab(new WayfarerSettingTab(this.app, this));

    this.registerView(VIEW_TYPE_WAYFARER, (leaf) => new WayfarerView(leaf, this));
    this.registerEditorExtension(metaDecorations);
    this.registerMarkdownPostProcessor(readingPostProcessor);

    this.addRibbonIcon("map", "Open itinerary map", () => void this.openMap());
    this.addCommand({ id: "open-map", name: "Open itinerary map", callback: () => void this.openMap() });
    this.addCommand({
      id: "convert-maps-link",
      name: "Convert the map link on this line to a stop",
      editorCheckCallback: (checking, editor) => {
        const line = editor.getCursor().line;
        const found = findMapsUrl(editor.getLine(line));
        if (!found) return false;
        if (!checking) void this.convert(editor, line, found.url);
        return true;
      },
    });
    this.addCommand({
      id: "new-trip",
      name: "Insert day headings for a trip",
      editorCallback: (editor) =>
        new NewTripModal(this.app, (start, days) => {
          const skeleton = tripSkeleton(start, days, getLocale() === "en" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : undefined, this.settings.dayHeadingLevel);
          // A heading has to start its own line.
          editor.replaceSelection(editor.getCursor().ch > 0 ? "\n" + skeleton : skeleton);
        }).open(),
    });
    this.addCommand({
      id: "export-kml",
      name: "Export the trip as a map file",
      editorCallback: (editor, ctx) => void this.exportKml(editor, ctx),
    });
    this.addCommand({
      id: "convert-all-maps-links",
      name: "Convert every map link in this note",
      editorCallback: (editor) => void this.convertAll(editor),
    });
    this.addCommand({
      id: "fetch-details",
      name: "Fetch Google details for stops without them",
      checkCallback: (checking) => {
        if (!this.activeMarkdown()?.file) return false;
        if (!checking) void this.fetchDetails();
        return true;
      },
    });

    this.registerEvent(this.app.workspace.on("editor-paste", (evt, editor) => this.onPaste(evt, editor)));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
    // A different note opened in the same pane changes no leaf, only the file.
    this.registerEvent(this.app.workspace.on("file-open", () => this.refresh()));
    const onEditorChange = debounce((editor: Editor, info: MarkdownFileInfo) => this.onEdit(editor, info), 250, true);
    this.registerEvent(this.app.workspace.on("editor-change", onEditorChange));
    this.register(() => onEditorChange.cancel());
    this.registerEvent(this.app.metadataCache.on("changed", (file) => { if (file.path === this.current?.file.path) this.refresh(); }));
    const documents = new WeakSet<Document>();
    const trackDocument = (doc: Document) => {
      if (documents.has(doc)) return;
      documents.add(doc);
      this.registerDomEvent(doc, "selectionchange", () => this.trackCursor());
      this.registerDomEvent(doc, "keyup", () => this.trackCursor());
      this.registerDomEvent(doc, "mouseup", () => this.trackCursor());
    };
    trackDocument(document);
    this.app.workspace.iterateAllLeaves((leaf) => trackDocument(leaf.view.containerEl.doc));
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => trackDocument(win.document)));

    this.app.workspace.onLayoutReady(() => this.refresh());
  }

  private unloaded = false;
  onunload(): void {
    this.unloaded = true;
    if (this.autoOpenTimer !== null) window.clearTimeout(this.autoOpenTimer);
    this.router.dispose();
    this.photos.clear();
  }

  /* ---------- settings ---------- */

  get googleLanguageCode(): string {
    return googleLanguageFor(this.settings.languageCode, this.settings.uiLanguage, getLanguage());
  }

  applyLocale(): void {
    let code: string | null = this.settings.uiLanguage;
    if (code === "auto") {
      code = getLanguage();
    }
    setLocale(localeFor(code));
  }

  async loadSettings(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Partial<WayfarerSettings> & Record<string, unknown>;
    // Settings that no longer exist (photo cache, routing toggles) are dropped on the next save.
    const known = Object.fromEntries(Object.entries(data).filter(([k]) => k in DEFAULT_SETTINGS));
    this.settings = { ...DEFAULT_SETTINGS, ...known };
  }
  /** Bumped on every save, so a pane whose note did not change still redraws for a changed setting. */
  settingsRev = 0;
  async saveSettings(): Promise<void> {
    this.settingsRev++;
    await this.saveData(this.settings);
  }

  /* ---------- map pane ---------- */

  async openMap(): Promise<void> {
    const existing = this.mapLeaf();
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    // A phone has no room beside the note: the map is its own tab there.
    const leaf = Platform.isMobile ? this.app.workspace.getLeaf("tab") : this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_WAYFARER, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /**
   * The pane holding our view. Checked by saved view state, not live type,
   * because right after a plugin reload the leaf is still a placeholder that
   * `getLeavesOfType` does not return, and opening another would stack panes.
   */
  private mapLeaf(): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!found && leaf.getViewState().type === VIEW_TYPE_WAYFARER) found = leaf;
    });
    return found;
  }

  /** Re-parses the active markdown note and pushes it to every map pane. */
  refresh(): void {
    if (this.unloaded) return;
    const md = this.activeMarkdown();
    if (!md?.file) {
      // Keep showing the last note while the user is in the map pane or settings.
      if (this.current) this.pushToViews();
      return;
    }
    const itinerary = parseItinerary(md.editor.getValue(), { maxHeadingLevel: this.settings.dayHeadingLevel });
    this.current = { file: md.file, itinerary };
    this.pushToViews();
    if (this.settings.autoOpen && itinerary.stops.length > 0 && this.mapViews.length === 0 && !Platform.isMobile) this.autoOpenSoon();
  }

  /**
   * Obsidian restores a plugin's saved panes shortly after the plugin loads,
   * so opening one immediately at startup or reload would leave two. Wait a
   * moment and open only if no pane has appeared.
   */
  private autoOpenTimer: number | null = null;
  private autoOpenSoon(): void {
    if (this.autoOpenTimer !== null) return;
    this.autoOpenTimer = window.setTimeout(() => {
      this.autoOpenTimer = null;
      if (this.mapViews.length === 0 && !this.mapLeaf()) void this.openMap();
    }, 600);
  }

  private pushToViews(): void {
    if (!this.current) return;
    const md = this.activeMarkdown();
    const day = md?.file?.path === this.current.file.path ? dayAtLine(this.current.itinerary, md.editor.getCursor().line) : -1;
    for (const v of this.mapViews) v.render(this.current.file, this.current.itinerary, day, md?.editor.getCursor().line ?? -1);
  }

  private onEdit(editor: Editor, info: MarkdownFileInfo): void {
    if (!info.file) return;
    // The debounce can deliver an edit from a note the user has already left.
    const md = this.activeMarkdown();
    if (md?.file && md.file.path !== info.file.path) return;
    this.current = { file: info.file, itinerary: parseItinerary(editor.getValue(), { maxHeadingLevel: this.settings.dayHeadingLevel }) };
    this.pushToViews();
  }

  private trackCursor(): void {
    if (this.mapViews.length === 0 || !this.current) return;
    const md = this.activeMarkdown();
    if (!md?.file || md.file.path !== this.current.file.path) return;
    const line = md.editor.getCursor().line;
    const day = dayAtLine(this.current.itinerary, line);
    for (const v of this.mapViews) v.onCursor(line, day);
  }

  /**
   * The note the map should show: the active markdown view, or, when the
   * active leaf is the map pane itself (as it is right after startup or a
   * click on the map), the most recently used markdown leaf.
   */
  private activeMarkdown(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const recent = this.app.workspace.getMostRecentLeaf();
    if (recent?.view instanceof MarkdownView) return recent.view;
    const first = this.app.workspace.getLeavesOfType("markdown")[0];
    return first?.view instanceof MarkdownView ? first.view : null;
  }

  /* ---------- export ---------- */

  /**
   * Writes `<note title>.kml` next to the note, one folder per day, for
   * importing into Google My Maps. Every export regenerates the whole file:
   * the note is the plan, the map on Google is a copy of it.
   */
  private async exportKml(editor: Editor, ctx: MarkdownView | MarkdownFileInfo): Promise<void> {
    const file = ctx.file;
    if (!file) return;
    const it = parseItinerary(editor.getValue(), { maxHeadingLevel: this.settings.dayHeadingLevel });
    if (it.stops.length === 0) {
      new Notice(t("empty"));
      return;
    }
    const kml = tripKml(it, file.basename, getLocale() === "en" ? "Day {n}" : "第 {n} 天");
    const path = normalizePath(`${file.parent && file.parent.path !== "/" ? file.parent.path + "/" : ""}${file.basename}.kml`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    try {
      if (existing instanceof TFile) await this.app.vault.modify(existing, kml);
      else await this.app.vault.create(path, kml);
    } catch (e) {
      new Notice(`Wayfarer: could not write ${path} (${(e as Error).message ?? e})`, 8000);
      return;
    }
    new Notice(t("kml_written", { f: path }), 12000);
  }

  /* ---------- state chosen on the map ---------- */

  /**
   * Merges `patch` into the `%%wf:{}%%` comment of `stop`. The stop may have
   * been parsed a while ago (a route arrives after the network call), so it
   * is looked up again in the current parse and written only where its link
   * still is.
   */
  setStopMeta(stop: Stop, patch: Partial<PlaceMeta>, quiet = false): void {
    const md = this.activeMarkdown();
    if (!md?.file || !this.current || md.file.path !== this.current.file.path) return;
    // The same place can appear twice (the hotel at the end of every day), so the line it was parsed from is tried first.
    const itinerary = parseItinerary(md.editor.getValue(), { maxHeadingLevel: this.settings.dayHeadingLevel });
    const stops = itinerary.stops;
    const live = stops.find((s) => s.line === stop.line && s.from === stop.from && s.lat === stop.lat && s.lng === stop.lng)
      ?? stops.find((s) => s.lat === stop.lat && s.lng === stop.lng && s.name === stop.name)
      ?? (quiet ? null : stop);
    if (!live) return;
    if (patch.leg) {
      const day = itinerary.days[live.dayIndex];
      const from = day?.stops[live.index - 1];
      if (!from || !bareLeg(from, { ...live, meta: { ...live.meta, leg: patch.leg } }, transitContext(dateForDay(day), from, live)).routed) return;
    }
    const expectedText = md.editor.getValue();
    void this.rewriteLine(md, live.line, (text) => (md.editor.getValue() === expectedText && stopStillAt(text, live) ? patchLineMeta(text, patch, live) : text));
  }

  /**
   * Replaces one line of the note. In editing mode through the editor, so undo
   * works. In Reading view the editor is hidden and Obsidian does not save
   * what is typed into it, so the change goes to the file instead.
   */
  private async rewriteLine(md: MarkdownView, line: number, fn: (text: string) => string, file = md.file): Promise<boolean> {
    // A result that arrives after the plugin was disabled is dropped.
    if (!file || this.unloaded || md.file !== file) return false;
    const valid = () => !this.unloaded && md.file === file;
    let changed = false;
    if (md.getMode() === "preview" && md.file) {
      await this.app.vault.process(file, (data) => {
        if (!valid()) return data;
        const lines = data.split("\n");
        if (line >= lines.length) return data;
        // The line was chosen from the editor's buffer; if the file on disk reads differently there, the two are out of step and nothing is written.
        if (line < md.editor.lineCount() && md.editor.getLine(line) !== lines[line]) return data;
        const next = fn(lines[line]);
        if (next === lines[line]) return data;
        changed = true;
        lines[line] = next;
        return lines.join("\n");
      });
      this.refresh();
    } else {
      // The editor change reaches the pane through the editor-change handler; a refresh here would parse and draw once more per write.
      if (line >= md.editor.lineCount()) return false;
      const text = md.editor.getLine(line);
      const next = fn(text);
      if (next !== text) { md.editor.replaceRange(next, { line, ch: 0 }, { line, ch: text.length }); changed = true; }
    }
    return changed;
  }

  /** Writes the transport picked in the pane as the emoji before the stop's link, so the text says what the map says. */
  setStopTransport(stop: Stop, mode: Transport): void {
    const md = this.activeMarkdown();
    if (!md) return;
    // The link must still be where the pane saw it; otherwise the note changed under us.
    void this.rewriteLine(md, stop.line, (text) => (stopStillAt(text, stop) ? setTransportOnLine(text, stop, mode) : text));
  }

  /**
   * Stops written by hand (or by an assistant) carry coordinates only. This
   * asks Google Places once per such stop for the place at that pin, and saves
   * rating, hours, address, website and photo on the line. The pin itself never
   * moves, and a result more than 300 m from it is not taken.
   */
  private async fetchDetails(): Promise<void> {
    const md = this.activeMarkdown();
    const cur = this.current;
    if (!md?.file || !cur || md.file.path !== cur.file.path) { new Notice(t("empty")); return; }
    if (!this.settings.googleApiKey) { new Notice(`Wayfarer: ${t("key_needed")}`); return; }
    const file = md.file;
    const valid = () => !this.unloaded && md.file === file;
    const places = googlePlaces(this.settings.googleApiKey, this.googleLanguageCode);
    const todo = cur.itinerary.stops.filter((s) => !s.meta?.placeId);
    if (todo.length === 0) { new Notice("Wayfarer: every stop already has its details"); return; }
    let done = 0;
    let missed = 0;
    for (const stop of todo) {
      if (!valid()) return;
      try {
        const p = await places.searchText(stop.name, stop);
        if (!valid()) return;
        if (!p?.meta || distanceM(p, stop) > 300) { missed++; continue; }
        const { rating, hours, address, website, placeId, type, photo, utc } = p.meta;
        // Only when the same link is still on that line; the note may have changed while Google answered.
        if (await this.rewriteLine(md, stop.line, (text) => (stopStillAt(text, stop) ? patchLineMeta(text, { rating, hours, address, website, placeId, type, photo, utc }, stop) : text), file)) done++;
      } catch (e) {
        if (!valid()) return;
        if (e instanceof GoogleApiError) { this.googleRefused(e); return; }
        missed++;
      }
    }
    new Notice(`Wayfarer: details saved for ${done} stop${done === 1 ? "" : "s"}${missed ? `, ${missed} not found at the pin` : ""}`, 8000);
  }

  /** Moves the stop line at `from` to sit where `to` is (before it when moving up, after it when moving down). */
  async moveStopLine(from: number, to: number): Promise<void> {
    const md = this.activeMarkdown();
    if (!md || this.unloaded) return;
    if (md.getMode() === "preview" && md.file) {
      // Reading view: the hidden editor is not saved, so reorder the file itself.
      await this.app.vault.process(md.file, (data) => moveBlock(data.split("\n"), from, to).join("\n"));
      this.refresh();
      return;
    }
    const editor = md.editor;
    // The stop's block: its line plus every deeper-indented line under it (notes, images).
    const indentOf = (l: string) => /^\s*/.exec(l)![0].replace(/\t/g, "    ").length;
    const takeWith = (ln: number): number => {
      const base = indentOf(editor.getLine(ln));
      let n = 1;
      while (ln + n < editor.lineCount()) {
        const l = editor.getLine(ln + n);
        if (!l.trim() || indentOf(l) <= base) break;
        n++;
      }
      return n;
    };
    const count = takeWith(from);
    // Dropped onto one of its own notes: nowhere to go.
    if (to > from && to < from + count) return;
    const lines = Array.from({ length: count }, (_, i) => editor.getLine(from + i));
    const total = editor.lineCount();
    const endLine = from + count;
    const removeTo = endLine < total ? { line: endLine, ch: 0 } : { line: from + count - 1, ch: editor.getLine(from + count - 1).length };
    const removeFrom = endLine < total ? { line: from, ch: 0 } : { line: from - 1, ch: editor.getLine(from - 1).length };
    editor.replaceRange("", removeFrom, removeTo);
    let target = to;
    if (from < to) target = to - count + takeWith(to - count);
    else target = to;
    const insertAt = Math.min(target, editor.lineCount());
    const text = lines.join("\n") + "\n";
    if (insertAt >= editor.lineCount()) editor.replaceRange("\n" + lines.join("\n"), { line: editor.lineCount() - 1, ch: editor.getLine(editor.lineCount() - 1).length });
    else editor.replaceRange(text, { line: insertAt, ch: 0 });
    editor.setCursor({ line: insertAt, ch: 0 });
    this.refresh();
  }

  /* ---------- paste conversion ---------- */

  private onPaste(evt: ClipboardEvent, editor: Editor): void {
    if (!this.settings.convertOnPaste || evt.defaultPrevented) return;
    const raw = evt.clipboardData?.getData("text/plain")?.trim() ?? "";
    // A link copied out of a sentence often brings its full stop along.
    const text = raw.replace(/[),.;!?]+$/, "");
    if (!text || /\s/.test(text) || !isGoogleMapsUrl(text)) return;
    evt.preventDefault();
    // Insert the URL right away so typing is never blocked, then swap it once resolved.
    const cursor = editor.getCursor();
    editor.replaceSelection(raw);
    void this.convert(editor, cursor.line, text);
  }

  private resolveDeps(): ResolveDeps {
    return {
      expandShortUrl,
      places: this.settings.googleApiKey ? googlePlaces(this.settings.googleApiKey, this.googleLanguageCode) : undefined,
    };
  }

  /** Editor instances can be reused by a pane when it opens a different note. */
  private editorFile(editor: Editor): TFile | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.editor === editor) return leaf.view.file;
    }
    return null;
  }

  /** Resolves one link and swaps it for a stop; true when the note was changed. */
  private async convert(editor: Editor, line: number, url: string): Promise<boolean> {
    const file = this.editorFile(editor);
    const valid = () => !this.unloaded && !!file && this.editorFile(editor) === file;
    if (!valid()) return false;
    try {
      const place = await resolveMapsUrl(url, this.resolveDeps());
      if (!valid()) return false;
      const lineText = editor.getLine(line);
      const hasEmoji = firstEmoji(lineText.slice(0, Math.max(0, lineText.indexOf(url)))) !== null;
      if (replaceUrlInEditor(editor, line, url, stopText(place, this.settings.addEmoji && !hasEmoji))) return true;
      new Notice(`Wayfarer: the link moved before it resolved. ${place.name} is at ${place.lat}, ${place.lng}.`);
    } catch (e) {
      if (!valid()) return false;
      const msg = e instanceof ResolveError ? e.message : `Could not resolve the link (${(e as Error).message ?? e})`;
      new Notice(`Wayfarer: ${msg}`, 8000);
    }
    return false;
  }

  private async convertAll(editor: Editor): Promise<void> {
    const file = this.editorFile(editor);
    const valid = () => !this.unloaded && !!file && this.editorFile(editor) === file;
    let n = 0;
    const failed = new Set<string>();
    for (let line = 0; line < editor.lineCount(); line++) {
      // A line may hold several links; each conversion changes the line, so look again after each.
      for (let guard = 0; guard < 20; guard++) {
        if (!valid()) return;
        const found = findMapsUrl(editor.getLine(line), failed);
        if (!found) break;
        if (await this.convert(editor, line, found.url)) n++;
        else failed.add(found.url);
      }
    }
    new Notice(n ? `Wayfarer: converted ${n} link${n === 1 ? "" : "s"}` : "Wayfarer: no Google Maps links in this note");
  }
}
