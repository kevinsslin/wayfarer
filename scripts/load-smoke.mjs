// Loads the built main.js against a stub `obsidian` module and drives onload()
// to verify the shipped bundle registers its view, commands, ribbon, settings
// tab, editor extension and post processor without throwing.
//
// Usage: node scripts/load-smoke.mjs [path-to-main.js]   (default: ./main.js)
import Module from "node:module";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = process.argv[2] ?? "main.js";
const cjs = join(mkdtempSync(join(tmpdir(), "wf-smoke-")), "main.cjs");
copyFileSync(src, cjs);

const fakeEl = () => ({
  style: { setProperty() {} },
  createDiv: () => fakeEl(),
  createEl: () => fakeEl(),
  createSpan: () => fakeEl(),
  empty() {},
  addClass() {},
  removeClass() {},
  toggleClass() {},
  setText() {},
  setAttr() {},
  addEventListener() {},
  setCssProps() {},
});

class Component {
  cleanups = [];
  register(cleanup) { this.cleanups.push(cleanup); }
  registerEvent() {}
  registerDomEvent() {}
  registerInterval() {}
}
class PluginStub extends Component {
  constructor(app, manifest) {
    super();
    this.app = app;
    this.manifest = manifest;
    this.commands = [];
    this.ribbons = [];
    this.views = {};
    this.settingTabs = [];
    this.editorExtensions = [];
    this.postProcessors = [];
  }
  addCommand(c) { this.commands.push(c); return c; }
  addRibbonIcon(icon, title, cb) { this.ribbons.push({ icon, title, cb }); return fakeEl(); }
  registerView(type, factory) { this.views[type] = factory; }
  registerEditorExtension(ext) { this.editorExtensions.push(ext); }
  registerMarkdownPostProcessor(pp) { this.postProcessors.push(pp); }
  addSettingTab(tab) { this.settingTabs.push(tab); }
  async loadData() { return null; }
  async saveData(data) { this.savedData = data; }
}
class ItemViewStub extends Component {
  constructor(leaf) { super(); this.leaf = leaf; this.containerEl = fakeEl(); this.contentEl = fakeEl(); }
}
class PluginSettingTabStub { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = fakeEl(); } }
const chain = () => new Proxy(() => chain(), { get: () => chain() });
class SettingStub {
  setName() { return this; } setDesc() { return this; } setHeading() { return this; }
  addToggle(cb) { cb(chain()); return this; } addDropdown(cb) { cb(chain()); return this; } addText(cb) { cb(chain()); return this; }
}

let obsidianLanguage = "en";
const googleRequests = [];
let debounceCancellations = 0;
const obsidianStub = {
  Plugin: PluginStub,
  ItemView: ItemViewStub,
  PluginSettingTab: PluginSettingTabStub,
  Setting: SettingStub,
  getLanguage: () => obsidianLanguage,
  Notice: class {},
  Modal: class { constructor(app) { this.app = app; this.contentEl = fakeEl(); } setTitle() {} open() {} close() {} },
  MarkdownView: class {},
  TFile: class {},
  Platform: { isMobile: false, isDesktopApp: true },
  setIcon() {},
  WorkspaceLeaf: class {},
  debounce: (fn) => Object.assign(fn, { cancel: () => { debounceCancellations++; } }),
  normalizePath: (path) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
  requestUrl: async (request) => { googleRequests.push(request); return { status: 200, json: { places: [], routes: [] }, text: "" }; },
};
const codemirrorStateStub = { RangeSetBuilder: class { ranges = []; add(from, to) { this.ranges.push({ from, to }); } finish() { return this.ranges; } } };
const codemirrorViewStub = {
  Decoration: { replace: () => ({}) },
  EditorView: {},
  ViewPlugin: { fromClass: (cls, spec) => ({ cls, spec }) },
  WidgetType: class {},
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return obsidianStub;
  if (request === "@codemirror/state") return codemirrorStateStub;
  if (request === "@codemirror/view") return codemirrorViewStub;
  return origLoad.call(this, request, parent, isMain);
};

// Leaflet touches `window` and `document` at import time.
globalThis.window = globalThis;
globalThis.screen = { deviceXDPI: 96, logicalXDPI: 96 };
globalThis.devicePixelRatio = 1;
globalThis.document = {
  documentElement: { style: {} },
  createElement: () => ({ style: {}, getElementsByTagName: () => [], getContext: () => null }),
  createElementNS: () => ({ style: {} }),
};
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node", platform: "node", maxTouchPoints: 0 }, configurable: true });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
// Another plugin's Leaflet (Map View with Geoman attached) already owns the global.
const otherLeaflet = { PM: { optIn: false } };
globalThis.L = otherLeaflet;

const { createRequire } = await import("node:module");
const mod = createRequire(import.meta.url)(cjs);
const PluginClass = mod.default ?? mod;

const app = {
  workspace: {
    on: () => ({}),
    onLayoutReady: (cb) => cb(),
    getActiveViewOfType: () => null,
    getLeavesOfType: () => [],
    getRightLeaf: () => null,
    getMostRecentLeaf: () => null,
    iterateAllLeaves: () => {},
  },
  metadataCache: { on: () => ({}) },
};
const plugin = new PluginClass(app, { id: "wayfarer", version: "0.0.0-smoke" });
await plugin.onload();

const assert = (cond, msg) => { if (!cond) { console.error(`smoke: FAIL ${msg}`); process.exit(1); } };
assert(globalThis.L === otherLeaflet, "loading the bundle leaves another plugin's window.L in place");
assert(plugin.views["wayfarer"], "map view registered");
assert(plugin.commands.some((c) => c.id === "open-map"), "open-map command");
assert(plugin.commands.some((c) => c.id === "convert-maps-link"), "convert command");
assert(plugin.commands.some((c) => c.id === "convert-all-maps-links"), "convert-all command");
assert(plugin.commands.some((c) => c.id === "new-trip"), "new-trip command");
assert(plugin.commands.some((c) => c.id === "export-kml"), "export-kml command");
assert(plugin.commands.some((c) => c.id === "fetch-details"), "fetch-details command");
assert(plugin.ribbons.length === 1, "ribbon icon");
assert(plugin.settingTabs.length === 1, "settings tab");
assert(plugin.editorExtensions.length === 1, "editor extension");
assert(plugin.postProcessors.length === 1, "post processor");
// Deferred/closed leaves are excluded without a plugin-owned view registry.
const mapView = plugin.views["wayfarer"]({});
app.workspace.getLeavesOfType = () => [{ view: mapView }];
assert(plugin.mapViews.length === 0, "deferred map views are not rendered");
mapView.map = {};
assert(plugin.mapViews[0] === mapView, "ready views are queried from the workspace");
mapView.map = null;
assert(plugin.mapViews.length === 0, "closed views are excluded immediately");
app.workspace.getLeavesOfType = () => [];
assert(plugin.settings.dayHeadingLevel === 2, "default settings loaded");
assert(plugin.settings.languageCode === "auto", "new installs follow language automatically");
assert(plugin.googleLanguageCode === "en", "automatic English Google content");
obsidianLanguage = "ja";
assert(plugin.googleLanguageCode === "ja", "automatic Google content follows untranslated Obsidian language");
plugin.settings.googleApiKey = "smoke-key";
await plugin.resolveDeps().places.searchText("Tokyo Station");
assert(JSON.parse(googleRequests.at(-1).body).languageCode === "ja", "Places search receives resolved language");
await plugin.resolveDeps().places.details("smoke-place");
assert(new URL(googleRequests.at(-1).url).searchParams.get("languageCode") === "ja", "Places details receive resolved language");
plugin.router.legsFor({ stops: [{lat:35.68,lng:139.76}, {lat:35.69,lng:139.77,transport:"walk"}] }, null);
await new Promise((resolve) => setImmediate(resolve));
assert(JSON.parse(googleRequests.at(-1).body).languageCode === "ja", "Routes receive resolved language");
plugin.loadData = async () => ({languageCode:"zh-TW", uiLanguage:"auto"});
await plugin.loadSettings();
assert(plugin.googleLanguageCode === "zh-TW", "existing language preference preserved");
await plugin.settingTabs[0].setControlValue("languageCode", "auto");
assert(plugin.googleLanguageCode === "ja", "existing users can opt into automatic language");
plugin.settings.uiLanguage = "en";
assert(plugin.googleLanguageCode === "en", "explicit interface language overrides Obsidian");
// Exercise the actual bundled plugin against a reused MarkdownView, as Obsidian
// does when another file opens in the same pane. No Google network calls.
plugin.settings.autoOpen = false;
plugin.settings.googleApiKey = "smoke-key";
const md = new obsidianStub.MarkdownView();
let source = "";
md.getMode = () => "preview";
md.editor = {
  getValue: () => source,
  lineCount: () => source.split("\n").length,
  getLine: (line) => source.split("\n")[line] ?? "",
  getCursor: () => ({ line: 1, ch: 0 }),
  replaceRange: (text, from, to) => {
    const lines = source.split("\n");
    lines.splice(from.line, to.line - from.line + 1, ...(lines[from.line].slice(0, from.ch) + text + lines[to.line].slice(to.ch)).split("\n"));
    source = lines.join("\n");
  },
  setCursor: () => {},
};
app.workspace.getActiveViewOfType = () => md;
app.workspace.getLeavesOfType = (type) => type === "markdown" ? [{ view: md }] : [];
const files = new Map();
const openNote = (path, text) => {
  if (!files.has(path)) files.set(path, Object.assign(new obsidianStub.TFile(), { path }));
  md.file = files.get(path);
  source = text;
  plugin.refresh();
};
const writes = [];
app.vault = { process: async (file, transform) => { writes.push(file.path); source = transform(source); } };
const note = "## 2027-01-01\n- [Hotel](geo:35,139)";
const details = { status: 200, json: { places: [{ id: "smoke-place", displayName: { text: "Hotel" }, location: { latitude: 35, longitude: 139 }, rating: 4.5 }] } };
for (const mode of ["preview", "source"]) {
  md.getMode = () => mode;
  let resolveRequest;
  obsidianStub.requestUrl = () => new Promise((resolve) => { resolveRequest = resolve; });
  openNote("A.md", note);
  const pending = plugin.fetchDetails();
  openNote("B.md", note);
  resolveRequest(details);
  await pending;
  assert(source === note, `${mode}: pending details cannot edit a different note`);
  openNote("A.md", note);
  const normal = plugin.fetchDetails();
  resolveRequest(details);
  await normal;
  assert(source.includes('"placeId":"smoke-place"'), `${mode}: details still save in the original note`);
}

// File identity is checked again inside vault.process, which may run later.
md.getMode = () => "preview";
openNote("A.md", note);
let processLater;
app.vault.process = (file, transform) => new Promise((resolve) => {
  processLater = () => { assert(transform(note) === note, "queued file write is discarded after switching"); resolve(); };
});
const queued = plugin.rewriteLine(md, 1, (line) => line + " SHOULD NOT WRITE");
openNote("B.md", note);
processLater();
await queued;

for (const bulk of [false, true]) {
  let resolveRequest;
  obsidianStub.requestUrl = () => new Promise((resolve) => { resolveRequest = resolve; });
  const url = "https://www.google.com/maps/place/Hotel/@35,139,17z";
  openNote("A.md", "## 2027-01-01\n- " + url);
  const pending = bulk ? plugin.convertAll(md.editor) : plugin.convert(md.editor, 1, url, "- ");
  openNote("B.md", "## 2027-01-01\n- " + url);
  resolveRequest(details);
  await pending;
  assert(source.includes(url), `${bulk ? "bulk" : "single"} conversion cannot edit the replacement note`);
}

// A route result must still belong to the live departure and destination.
md.getMode = () => "source";
const routeNote = "## 2027-01-01\n- 08:00 [A](geo:35,139)\n- 🚆 [B](geo:35.1,139.1)";
const savedLeg = { from: "35.0000,139.0000", to: "35.1000,139.1000", via: "train", s: 600, m: 10000, departure: "2026-12-31T23:00:00.000Z" };
for (const changed of [routeNote.replace("08:00", "20:00"), routeNote.replace("35.1,139.1", "36,140"), routeNote.replace("35,139", "34,138")]) {
  openNote("A.md", routeNote);
  const oldStop = plugin.current.itinerary.stops[1];
  source = changed; // Also exercise edits before the editor-change debounce fires.
  plugin.setStopMeta(oldStop, { leg: savedLeg }, true);
  assert(source === changed, "stale route result is discarded after an itinerary edit");
}
openNote("A.md", routeNote);
plugin.setStopMeta(plugin.current.itinerary.stops[1], { leg: savedLeg }, true);
assert(source.includes('"departure"'), "a matching route still saves to the original stop");

// A converted stop retains its actual href, including after transport edits
// and another conversion pass. This also works without any API key.
for (const apiKey of ["", "smoke-key"]) {
  plugin.settings.googleApiKey = apiKey;
  let requests = 0;
  obsidianStub.requestUrl = async () => { requests++; return details; };
  const url = "https://www.google.com/maps/place/Hotel/@35,139,17z";
  openNote("A.md", `## 2027-01-01\n- [My $& hotel](${url})`);
  assert(await plugin.convert(md.editor, 1, url, "- [My $& hotel]("), "place link converts to a mapped stop");
  assert(source.includes(`[My $& hotel](${url})`) && !source.includes("geo:"), "original href and user label survive conversion");
  plugin.refresh();
  const stop = plugin.current.itinerary.stops[0];
  assert(stop?.url === url && stop.lat === 35 && stop.lng === 139, "reopening the note reads the preserved link's pin");
  plugin.setStopTransport(stop, "walk");
  assert(source.includes(`[My $& hotel](${url})`) && source.includes("🚶"), "transport edits keep the original href");
  const before = source, count = requests;
  await plugin.convertAll(md.editor);
  assert(source === before && requests === count, "a converted link is not fetched or converted again");

  const doc = {
    sliceString: (from, to) => source.slice(from, to),
    lineAt: (at) => ({ number: source.slice(0, at).split("\n").length }),
  };
  const view = { visibleRanges: [{ from: 0, to: source.length }], state: { doc, selection: { main: { head: 0 } } } };
  const decorations = new plugin.editorExtensions[0].cls(view).decorations;
  assert(decorations.length === 1 && source.slice(decorations[0].from, decorations[0].to).startsWith("%%wf:"), "Live Preview decorates the metadata while keeping the original link");

  const changedUrl = url.replace("/Hotel/", "/Store/");
  source = source.replace(`[My $& hotel](${url})`, () => `[My $& hotel](${changedUrl})`);
  plugin.refresh();
  assert(plugin.current.itinerary.stops.length === 0, "editing a place href invalidates its old pin");
  await plugin.convertAll(md.editor);
  plugin.refresh();
  assert(plugin.current.itinerary.stops[0]?.url === changedUrl && (source.match(/%%wf:/g) ?? []).length === 1, "reconversion replaces stale metadata instead of duplicating it");
  source = before;

  // Reading view leaves new links alone and resolves legacy geo links by ID.
  const anchor = (name, href) => ({
    textContent: name, attrs: { href },
    getAttribute(key) { return this.attrs[key]; },
    setAttribute(key, value) { this.attrs[key] = value; },
    setAttr(key, value) { this.attrs[key] = value; },
    addClass() {}, insertAdjacentElement() {},
  });
  globalThis.createSpan = () => ({ textContent: "", title: "" });
  const original = anchor("My $& hotel", url);
  plugin.postProcessors[0]({ querySelectorAll: () => [original] }, { getSectionInfo: () => ({ text: source, lineStart: 0, lineEnd: 1 }) });
  assert(original.attrs.href === url, "Reading view preserves the store href");
  const legacy = anchor("Cafe", "geo:35,139");
  plugin.postProcessors[0]({ querySelectorAll: () => [legacy] }, { getSectionInfo: () => ({ text: '- [Cafe](geo:35,139) %%wf:{"placeId":"ChIJcafe"}%%', lineStart: 0, lineEnd: 0 }) });
  assert(new URL(legacy.attrs.href).searchParams.get("query_place_id") === "ChIJcafe", "legacy Reading-view links open the business by Place ID");
}
plugin.settings.googleApiKey = "";
obsidianStub.Platform.isMobile = true;
const shortUrl = "https://maps.app.goo.gl/cafe";
obsidianStub.requestUrl = async () => ({ status: 200, text: '<link rel="canonical" href="https://www.google.com/maps/place/Cafe/data=!3d35!4d139">' });
openNote("A.md", `## 2027-01-01\n- ${shortUrl}`);
assert(await plugin.convert(md.editor, 1, shortUrl, "- "), "short links resolve through requestUrl on mobile without Node");
plugin.refresh();
assert(plugin.current.itinerary.stops[0]?.url === shortUrl, "mobile short-link conversion keeps the original business href");
obsidianStub.Platform.isMobile = false;
plugin.settings.googleApiKey = "smoke-key";
console.log("smoke: OK (original Maps href, keyless import, transport, repeat conversion and Reading view)");

// Phone or tablet: the map is a tab or split in the main area, so once it is
// focused the most recent leaf is the map itself, and an unrelated note sits
// in the first tab. The map keeps its own note, and its writes never land in
// another one, even after its note is closed.
{
  const saved = { workspace: { ...app.workspace }, vault: app.vault, mode: md.getMode };
  const texts = new Map([["Trip.md", "## 2027-01-01\n- [Hotel](geo:35,139)\n- [Shrine](geo:35.01,139.01)"], ["Other.md", "## 2027-02-02\n- [Far](geo:10,10)\n- [Away](geo:11,11)"]]);
  const other = Object.assign(new obsidianStub.MarkdownView(), { file: Object.assign(new obsidianStub.TFile(), { path: "Other.md" }), getMode: () => "preview" });
  other.editor = { getValue: () => texts.get("Other.md"), lineCount: () => texts.get("Other.md").split("\n").length, getLine: (l) => texts.get("Other.md").split("\n")[l] ?? "", getCursor: () => ({ line: 0, ch: 0 }) };
  const mobileWrites = [];
  app.vault = { process: async (file, transform) => {
    mobileWrites.push(file.path);
    const next = transform(file.path === "Other.md" ? texts.get("Other.md") : source);
    if (file.path === "Other.md") texts.set("Other.md", next); else source = next;
  } };
  md.getMode = () => "preview";
  openNote("Trip.md", texts.get("Trip.md"));
  app.workspace.getActiveViewOfType = () => null;
  app.workspace.getMostRecentLeaf = () => ({ view: { getViewType: () => "wayfarer" } });
  app.workspace.getLeavesOfType = (type) => type === "markdown" ? [{ view: other }, { view: md }] : [];
  app.workspace.getLastOpenFiles = () => [];
  plugin.refresh();
  assert(plugin.current.file.path === "Trip.md", "focusing the map tab keeps its note instead of the first markdown tab");
  await plugin.moveStopLine(plugin.current.itinerary.stops[1], plugin.current.itinerary.stops[0], "Trip.md");
  assert(source.split("\n")[1].includes("Shrine") && !mobileWrites.includes("Other.md"), "reordering on a focused map edits the map's note only");
  plugin.setStopTransport(plugin.current.itinerary.stops[1], "walk");
  await Promise.resolve();
  assert(source.includes("🚶") && !mobileWrites.includes("Other.md"), "transport picked on a focused map edits the map's note only");

  app.workspace.getLeavesOfType = (type) => type === "markdown" ? [{ view: other }] : [];
  plugin.refresh();
  assert(plugin.current.file.path === "Trip.md", "closing the map's note does not swap in another note");
  // With no editor holding it, a change from sync or another app is read from the vault.
  const synced = "## 2027-01-01\n- [Hotel](geo:35,139)\n- [Shrine](geo:35.01,139.01)\n- [Onsen](geo:35.02,139.02)";
  app.vault.cachedRead = async (file) => (file.path === "Trip.md" ? synced : texts.get(file.path));
  plugin.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert(plugin.current.file.path === "Trip.md" && plugin.current.itinerary.stops.length === 3, "a closed note changed elsewhere is read again from the vault");
  const otherBefore = texts.get("Other.md");
  await plugin.moveStopLine(plugin.current.itinerary.stops[1], plugin.current.itinerary.stops[0], "Trip.md");
  plugin.setStopTransport(plugin.current.itinerary.stops[0], "car");
  await Promise.resolve();
  assert(texts.get("Other.md") === otherBefore && !mobileWrites.includes("Other.md"), "map writes never reach a note the map does not show");

  plugin.current = null;
  app.workspace.getLeavesOfType = (type) => type === "markdown" ? [{ view: other }, { view: md }] : [];
  app.workspace.getLastOpenFiles = () => ["Trip.md", "Other.md"];
  plugin.refresh();
  assert(plugin.current.file.path === "Trip.md", "a map restored in front of its note shows the most recently opened note");

  app.workspace = saved.workspace;
  app.vault = saved.vault;
  md.getMode = saved.mode;
}
console.log("smoke: OK (map tab keeps its note on phones and tablets)");

// Writes computed from an earlier parse land only on the stop they were computed for.
const deferredVault = app.vault;
app.vault = { process: async (file, transform) => { source = transform(source); } };
for (const mode of ["preview", "source"]) {
  md.getMode = () => mode;
  const trip = "## 2027-01-01\n- [A](geo:35,139)\n- [B](geo:35.1,139.1)\n- [C](geo:35.2,139.2)";
  openNote("A.md", trip);
  let [a, , c] = plugin.current.itinerary.stops;
  source = trip.replace("## 2027-01-01\n", "## 2027-01-01\nCall the hotel\n"); // a sync lands before the drop
  const synced = source;
  await plugin.moveStopLine(a, c, "A.md");
  assert(source === synced, `${mode}: a drag computed before an edit moves nothing`);
  openNote("A.md", trip);
  [a, , c] = plugin.current.itinerary.stops;
  await plugin.moveStopLine(a, c, "A.md");
  assert(source === "## 2027-01-01\n- [B](geo:35.1,139.1)\n- [C](geo:35.2,139.2)\n- [A](geo:35,139)", `${mode}: a current drag still moves the stop`);
  await plugin.moveStopLine(plugin.current.itinerary.stops[0], plugin.current.itinerary.stops[1], "B.md");
  assert(source.startsWith("## 2027-01-01\n- [B]"), `${mode}: a drag from another note's map moves nothing`);

  openNote("A.md", "## 2027-01-01\n- [Cafe](geo:35,139)");
  const cafe = plugin.current.itinerary.stops[0];
  source = "## 2027-01-01\n- [Park](geo:35,139)";
  plugin.setStopTransport(cafe, "walk", "A.md");
  await Promise.resolve();
  assert(source === "## 2027-01-01\n- [Park](geo:35,139)", `${mode}: transport picked for a stop that was renamed is not written`);
}
md.getMode = () => "source";
{
  // The same walk on two days: a late route for day 2 must not land on day 1 once lines moved.
  const twoDays = "## 2027-01-01\n- [Station](geo:35,139)\n- 🚶 [Hotel](geo:35.01,139.01)\n## 2027-01-02\n- [Station](geo:35,139)\n- 🚶 [Hotel](geo:35.01,139.01)";
  openNote("A.md", twoDays);
  const hotel2 = plugin.current.itinerary.stops[3];
  source = twoDays.replace("## 2027-01-02\n", "## 2027-01-02\nBreakfast first\n");
  const shifted = source;
  plugin.setStopMeta(hotel2, { leg: { from: "35.0000,139.0000", to: "35.0100,139.0100", via: "walk", s: 600, m: 1400 } }, true);
  assert(source === shifted, "a route whose stop moved is dropped when the same leg is on another day");

  // A pending conversion converts its own occurrence, not a copy of the link elsewhere.
  let resolveRequest;
  obsidianStub.requestUrl = () => new Promise((resolve) => { resolveRequest = resolve; });
  const url = "https://www.google.com/maps/place/Hotel/@35,139,17z";
  openNote("A.md", `## 2027-01-01\n- Morning ${url}\n- Afternoon ${url}`);
  const pending = plugin.convert(md.editor, 1, url, "- Morning ");
  source = `## 2027-01-01\n- Afternoon ${url}`; // the morning line is deleted while it resolves
  resolveRequest(details);
  await pending;
  assert(source === `## 2027-01-01\n- Afternoon ${url}`, "a pending conversion does not take another copy of its link");
  openNote("A.md", `## 2027-01-01\n- ${url}`);
  const extended = plugin.convert(md.editor, 1, url, "- ");
  source = `## 2027-01-01\n- ${url}/data=more`; // the URL is still being typed
  resolveRequest(details);
  await extended;
  assert(source === `## 2027-01-01\n- ${url}/data=more`, "a pending conversion does not replace the start of a longer URL");

  // Links in code or a comment are examples: converting every link in the note leaves them alone.
  let asked = 0;
  obsidianStub.requestUrl = async () => { asked++; return details; };
  const examples = `## 2027-01-01\n\`\`\`\n- ${url}\n\`\`\`\n- %% ${url} %%\n- \`${url}\``;
  openNote("A.md", examples);
  await plugin.convertAll(md.editor);
  assert(source === examples && asked === 0, "bulk conversion skips links in fenced code, comments and inline code");
}
app.vault = deferredVault;
console.log("smoke: OK (stale drags, renamed stops, duplicate legs and link copies)");

// Exercise actual bundled handlers and real Leaflet layers; only host surfaces and camera/layout are stubbed.
{
  const surface = (tag = "div", options = {}) => {
    const classes = new Set((options.cls ?? "").split(" ").filter(Boolean));
    return {
      tag, classes, children: [], attrs: { ...options.attr }, value: options.value ?? "", text: options.text ?? "", style: { setProperty() {} },
      win: globalThis, clientWidth: 1000, offsetHeight: 0,
      classList: { contains: (cls) => classes.has(cls) },
      createEl(t, o) { const child = surface(t, o); this.children.push(child); child.parent = this; return child; },
      createDiv(o) { return this.createEl("div", typeof o === "string" ? { cls: o } : o); },
      createSpan(o) { return this.createEl("span", o); },
      empty() { this.children = []; }, setText(t) { this.text = t; },
      addClass(cls) { classes.add(cls); }, removeClass(cls) { classes.delete(cls); },
      toggleClass(cls, value) { if (value) classes.add(cls); else classes.delete(cls); },
      setAttr(key, value) { this.attrs[key] = value; }, setCssProps() {}, scrollIntoView() {},
      insertBefore(child, before) { this.children.splice(this.children.indexOf(before), 0, child); },
      getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 1000 }),
    };
  };
  const descendants = (root) => [root, ...root.children.flatMap(descendants)];
  const byClass = (root, cls) => descendants(root).filter((el) => el.classes.has(cls));
  const local = new Map();
  app.loadLocalStorage = (key) => local.get(key);
  app.saveLocalStorage = (key, value) => local.set(key, value);
  app.workspace.setActiveLeaf = () => {};
  globalThis.createDiv = (o) => surface("div", o);
  globalThis.createSpan = (o) => surface("span", o);
  plugin.settings.googleApiKey = "";
  plugin.settings.autoOpen = false;
  assert(plugin.settings.overviewHeadingLevel === 0, "old settings keep the flat itinerary by default");
  assert(plugin.settingTabs[0].getSettingDefinitions().some((s) => s.items?.some((i) => i.control?.key === "overviewHeadingLevel")), "overview setting is discoverable");
  await plugin.settingTabs[0].setControlValue("dayHeadingLevel", "3");
  await plugin.settingTabs[0].setControlValue("overviewHeadingLevel", "2");
  assert(plugin.settings.overviewHeadingLevel === 2 && plugin.savedData.overviewHeadingLevel === 2, "overview setting is numeric and saved");
  const layered = "# Trip\n## 2027-01-01 Colombo\n- [Hotel A](geo:35,139)\n### 2027-01-01 City\n- [Airport](geo:35.1,139)\n- [City](geo:35.2,139)\n## 2027-01-02 - 2027-01-03 Negombo\n- 🚗 [Hotel B](geo:36,140)\n### 2027-01-02 Mangroves\n- [Market](geo:36.1,140)\n- [Mangroves](geo:36.2,140)\n### 2027-01-03 Beach\n- [Hotel B](geo:36,140)\n- [Beach](geo:36.3,140)";
  openNote("Overview.md", layered);
  const view = plugin.views["wayfarer"]({});
  view.app = app;
  view.map = { closePopup() {} };
  for (const name of ["contentEl", "legendEl", "stripEl", "journeyEl", "emptyEl"]) view[name] = surface();
  for (const name of ["applyTiles", "applySplit", "drawArrow", "fitAll", "flyToStop", "openPopup"]) view[name] = () => {};
  view.render(md.file, plugin.current.itinerary, -1);
  const lines = () => view.layer.getLayers().filter((layer) => typeof layer.getLatLngs === "function");
  assert(view.markers.size === 6 && lines().length === 3, "daily view retains its pins and within-day legs only");
  const dailySelection = app.loadLocalStorage("wayfarer:selection:Overview.md");
  assert(byClass(view.stripEl, "wf-stop").every((card) => card.draggable), "daily drag and drop stays available");
  byClass(view.legendEl, "wf-layer-toggle")[0].onclick();
  assert(view.showOverview && view.markers.size === 2 && lines().length === 1, "overview draws only parent pins and their connecting route");
  assert(byClass(view.stripEl, "wf-stop").every((card) => !card.draggable), "overview cannot move a pin out of its heading subtree");
  assert(byClass(view.stripEl, "wf-leg").length === 1, "timeline shows the connection between stages");
  assert(app.loadLocalStorage("wayfarer:selection:Overview.md") === dailySelection && local.has("wayfarer:selection:Overview.md:overview"), "overview selection cannot overwrite daily selection");
  assert(source === layered, "switching views leaves the Markdown intact");
  view.contentEl.clientWidth = 400;
  const select = byClass(view.legendEl, "wf-day-select")[0];
  assert(select.children.some((el) => el.value === "layer"), "mobile selector offers the other layer");
  select.value = "layer"; select.onchange();
  assert(!view.showOverview && view.markers.size === 6, "mobile layer selection returns to daily pins");
  view.contentEl.clientWidth = 1000;
  const cursor = md.editor.setCursor;
  let target, scrollRange, centered, scrollState;
  let activations = 0;
  md.editor.setCursor = (pos) => { target = pos; };
  md.editor.scrollIntoView = (range, center) => { scrollRange = range; centered = center; };
  md.setEphemeralState = (state) => { scrollState = state; };
  app.workspace.setActiveLeaf = () => { activations++; };
  md.getMode = () => "source";
  view.chooseLayer(true);
  assert(view.pinnedDay === -1 && byClass(view.stripEl, "wf-stop").length === 2, "reopening overview clears a saved stage filter and shows the whole route");
  const stage = view.itinerary.days[1];
  const popup = view.popupEl(stage, stage.stops[0]);
  const child = descendants(popup).find((el) => el.tag === "button" && el.text === "2027-01-03 Beach");
  assert(child, "stage card lists its child daily plans");
  child.onclick();
  assert(!view.showOverview && view.activeDay === 2, "child click opens the original daily plan");
  assert(target?.line === plugin.current.itinerary.days[2].headingLine && target.ch === 0 && scrollState?.scroll === target.line, "child drilldown reveals its heading at the top of the source view");
  assert(source === layered, "drilldown leaves the original plan untouched");
  view.chooseLayer(true);
  const selected = view.itinerary.stops[1];
  await view.jumpTo(selected);
  assert(target?.line === selected.line && target.ch === selected.from && scrollRange.to.ch === selected.to && centered === true, "stop jump retains the exact source span and upstream editor centering");
  md.getMode = () => "preview";
  target = undefined; scrollState = undefined;
  const activeBefore = activations;
  await view.jumpTo(selected, false);
  assert(scrollState?.line === selected.line && !target && activations === activeBefore, "passive map click requests native Reading-view line navigation without moving a hidden editor or stealing focus");
  obsidianStub.Platform.isMobile = true;
  scrollState = undefined;
  await view.jumpTo(selected, false);
  assert(!scrollState, "mobile map selection does not navigate away from the map");
  await view.jumpTo(selected);
  assert(scrollState?.line === selected.line && activations === activeBefore + 1, "explicit mobile Go to line requests native Reading-view line navigation");
  scrollState = undefined;
  await view.jumpTo({ line: 0, from: 0, to: 0 });
  assert(scrollState?.line === 0 && !target, "Reading-view line zero is a valid explicit navigation target");
  obsidianStub.Platform.isMobile = false;

  // Reading centering waits for the native line reveal and cancels stale frames.
  const previousPreview = md.previewMode;
  const frames = [];
  let previewLine = -1;
  const readingScroll = {
    scrollTop: 1500, clientHeight: 600, isConnected: true,
    querySelector: () => null, matches: () => true,
    win: {
      requestAnimationFrame: (fn) => frames.push(fn),
      getComputedStyle: () => ({ lineHeight: "24px" }),
    },
  };
  md.previewMode = { containerEl: readingScroll, getScroll: () => previewLine };
  obsidianStub.Platform.isMobile = false;
  await view.jumpTo(selected, false);
  frames.shift()();
  assert(readingScroll.scrollTop === 1500 && frames.length === 1, "Reading centering waits for the target source line");
  previewLine = selected.line;
  frames.shift()();
  assert(readingScroll.scrollTop === 1212 && !target, "Reading stop centers after reveal without touching the hidden editor");
  readingScroll.scrollTop = 1500;
  await view.jumpTo(selected, false);
  const staleFrame = frames.shift();
  await view.jumpTo({ line: 0, from: 0, to: 0 }, false, true);
  staleFrame();
  assert(readingScroll.scrollTop === 1500 && frames.length === 0, "heading navigation stays at the top and cancels earlier centering");
  await view.jumpTo(selected, false);
  const fileFrame = frames.shift(), oldFile = view.file;
  view.file = { path: "Other.md" }; fileFrame(); view.file = oldFile;
  assert(readingScroll.scrollTop === 1500 && frames.length === 0, "delayed centering cannot move another note");
  await view.jumpTo(selected, false);
  const modeFrame = frames.shift();
  md.getMode = () => "source"; modeFrame(); md.getMode = () => "preview";
  assert(readingScroll.scrollTop === 1500 && frames.length === 0, "a mode change cancels pending Reading centering");
  previewLine = -1;
  await view.jumpTo(selected, false);
  let ticks = 0;
  while (frames.length && ticks < 100) { ticks++; frames.shift()(); }
  assert(ticks <= 31 && !frames.length && readingScroll.scrollTop === 1500, "an unavailable preview target does not poll indefinitely");
  obsidianStub.Platform.isMobile = true;
  previewLine = selected.line; readingScroll.scrollTop = 1500;
  await view.jumpTo(selected);
  frames.shift()();
  assert(readingScroll.scrollTop === 1212, "explicit mobile source navigation uses the same Reading centering");

  // On a phone, opening the source may replace the map leaf itself.
  {
    const oldLeaves = app.workspace.getLeavesOfType, oldGetLeaf = app.workspace.getLeaf, oldMap = view.map;
    app.workspace.getLeavesOfType = (type) => type === "markdown" ? [] : oldLeaves(type);
    app.workspace.getLeaf = () => ({ view: md, openFile: async (file) => { md.file = file; view.map = null; } });
    readingScroll.scrollTop = 1500;
    await view.jumpTo(selected);
    frames.shift()();
    assert(readingScroll.scrollTop === 1212, "mobile Go to line still centers when opening the note closes the map");
    app.workspace.getLeavesOfType = oldLeaves; app.workspace.getLeaf = oldGetLeaf; view.map = oldMap;
  }
  obsidianStub.Platform.isMobile = false;
  readingScroll.scrollTop = 10; previewLine = 0;
  await view.jumpTo({ line: 0, from: 0, to: 0 }, false);
  frames.shift()();
  assert(readingScroll.scrollTop === 0, "centering near the note start clamps to the available space");
  md.previewMode = previousPreview;
  const leaves = app.workspace.getLeavesOfType;
  app.workspace.getLeavesOfType = (type) => type === "wayfarer" ? [{ view }] : leaves(type);
  let cursorCalls = 0;
  const onCursor = view.onCursor;
  view.onCursor = () => { cursorCalls++; };
  plugin.trackCursor();
  assert(cursorCalls === 0, "Reading-view selections cannot follow a stale hidden editor cursor");
  md.getMode = () => "source";
  plugin.trackCursor();
  assert(cursorCalls === 1, "editor cursor tracking is retained");
  view.onCursor = onCursor;
  app.workspace.getLeavesOfType = leaves;
  const allSelected = () => byClass(view.legendEl, "wf-chip-all").find((el) => !el.classes.has("wf-layer-toggle"))?.classes.has("is-active")
    && byClass(view.legendEl, "wf-day-select")[0]?.value === "-1";
  const dailyPlan = plugin.current.itinerary;
  view.chooseLayer(true);
  view.chooseDay(null);
  const firstStage = view.itinerary.days[0];
  view.onCursor(firstStage.stops[0].line, -1);
  assert(view.showOverview && view.focused === firstStage.stops[0] && allSelected(), "parent stop cursor stays in overview with All selected");
  view.onCursor(stage.stops[0].line, -1);
  assert(view.showOverview && view.focused === stage.stops[0] && allSelected() && byClass(view.stripEl, "wf-stop").length === 2, "overview All keeps the route visible while following another city");
  view.onCursor(dailyPlan.days[0].headingLine, 0);
  assert(!view.showOverview && view.activeDay === 0 && view.pinnedDay === -1 && allSelected(), "a child heading opens daily plans without pinning the cursor to that day");
  view.onCursor(dailyPlan.days[2].stops[1].line, 2);
  assert(!view.showOverview && view.focused === dailyPlan.days[2].stops[1] && allSelected() && byClass(view.stripEl, "wf-stop").length === 6, "daily All follows across days without selecting a date tab or narrowing the list");
  view.render(md.file, dailyPlan, 2, dailyPlan.days[2].stops[1].line);
  assert(allSelected(), "refreshing a cursor-focused plan does not change All into a date filter");
  view.chooseDay(dailyPlan.days[0]);
  view.onCursor(dailyPlan.days[1].stops[0].line, 1);
  assert(view.pinnedDay === 0 && view.activeDay === 0 && !view.focused, "an explicitly selected daily plan still ignores cursor stops in another day");
  view.chooseLayer(true);
  assert(view.pinnedDay === -1 && allSelected() && byClass(view.stripEl, "wf-stop").length === 2, "Trip overview opens All even after a fixed daily selection");
  view.onCursor(firstStage.headingLine, -1);
  assert(view.showOverview && view.activeDay === 0 && allSelected(), "parent heading highlights its stage while All remains selected");
  const secondCityCard = byClass(view.stripEl, "wf-stop").find((el) => byClass(el, "wf-stop-name").some((name) => name.text === stage.stops[0].name));
  secondCityCard.onclick();
  assert(view.activeDay === stage.index && view.focused === stage.stops[0] && allSelected(), "map card highlights the same stage as its source line without selecting a filter");
  view.chooseDay(null);
  view.setFocus(firstStage.stops[0]);
  assert(view.activeDay === firstStage.index && allSelected(), "a map pin also highlights its stage when starting from All");
  view.browseStop(stage.stops[0]);
  assert(view.showOverview && view.pinnedDay === -1 && allSelected(), "browsing overview cities from the map does not turn All into a stage filter");
  view.chooseDay(stage);
  view.onCursor(firstStage.stops[0].line, 0);
  assert(view.activeDay === stage.index && !view.focused, "a pinned stage cannot focus a hidden stop from another stage");
  view.onCursor(dailyPlan.days[0].stops[0].line, 0);
  assert(view.showOverview && view.pinnedDay === stage.index, "a pinned stage cannot drill into a child of another stage");
  view.onCursor(dailyPlan.days[1].stops[0].line, 1);
  assert(!view.showOverview && view.focused === dailyPlan.days[1].stops[0] && allSelected(), "a child stop within the selected stage opens daily All at that stop");
  let cursorCameraMoves = 0;
  const fit = view.fitAll, fly = view.flyToStop;
  view.fitAll = view.flyToStop = () => { cursorCameraMoves++; };
  plugin.settings.followCursor = false;
  view.onCursor(firstStage.stops[0].line, -1);
  assert(view.showOverview && view.focused === firstStage.stops[0] && allSelected() && cursorCameraMoves === 0, "cursor layer changes respect disabled camera following");
  plugin.settings.followCursor = true;
  view.onCursor(dailyPlan.days[2].stops[1].line, 2);
  assert(!view.showOverview && view.focused === dailyPlan.days[2].stops[1] && cursorCameraMoves === 1, "cursor drilldown moves the camera once when following is enabled");
  view.fitAll = fit; view.flyToStop = fly;
  view.chooseLayer(true);
  view.contentEl.clientWidth = 400;
  obsidianStub.Platform.isMobile = true;
  const mobileSelector = byClass(view.legendEl, "wf-day-select")[0];
  mobileSelector.value = "1"; mobileSelector.onchange();
  assert(view.pinnedDay === 1, "mobile selector can deliberately filter an overview stage");
  byClass(view.legendEl, "wf-day-select")[0].value = "layer";
  byClass(view.legendEl, "wf-day-select")[0].onchange();
  byClass(view.legendEl, "wf-day-select")[0].value = "layer";
  byClass(view.legendEl, "wf-day-select")[0].onchange();
  assert(view.showOverview && view.pinnedDay === -1 && allSelected(), "mobile layer switching also opens the full overview");
  view.onCursor(dailyPlan.days[0].stops[0].line, 0);
  assert(view.showOverview, "mobile retains upstream's explicit navigation rather than editor cursor following");
  obsidianStub.Platform.isMobile = false;
  view.contentEl.clientWidth = 1000;
  view.chooseDay(null);
  view.onCursor(firstStage.stops[0].line + 1, 0);
  view.onCursor(firstStage.stops[0].line, 0);
  assert(view.focused === firstStage.stops[0] && view.activeDay === firstStage.index, "All releases the pin and cursor selection resumes");
  const sourceFile = view.file;
  let finishOpen;
  const pendingLeaf = { view: md, openFile: () => new Promise((resolve) => { finishOpen = resolve; }) };
  app.workspace.getLeavesOfType = () => [];
  app.workspace.getLeaf = () => pendingLeaf;
  const beforeOpen = activations;
  target = undefined;
  const lateJump = view.jumpTo(selected);
  view.file = Object.assign(new obsidianStub.TFile(), { path: "Unrelated.md" });
  finishOpen();
  await lateJump;
  assert(!target && activations === beforeOpen, "a delayed source open cannot move or focus the new map source");
  view.file = sourceFile;
  app.workspace.getLeavesOfType = leaves;
  md.editor.setCursor = cursor;
  plugin.setStopMeta(selected, { leg: { from: "35.0000,139.0000", to: "36.0000,140.0000", via: "car", s: 7200, m: 20000 } }, true);
  plugin.refresh();
  assert(plugin.current.itinerary.overview.stops[1].meta?.leg?.s === 7200 && !plugin.current.itinerary.days[2].stops[0].meta?.leg, "overview route saves on its source occurrence, not a repeated daily hotel");
  const stale = plugin.current.itinerary.overview.stops[1];
  source = source.replace("[Hotel A](geo:35,139)", "[Hotel A](geo:34,138)");
  const changed = source;
  plugin.setStopMeta(stale, { leg: { from: "35.0000,139.0000", to: "36.0000,140.0000", via: "car", s: 600, m: 1000 } }, true);
  assert(source === changed, "late overview route is rejected after its predecessor changed");
  await plugin.settingTabs[0].setControlValue("overviewHeadingLevel", "0");
  plugin.refresh();
  view.render(md.file, plugin.current.itinerary, -1);
  assert(!view.showOverview && !byClass(view.legendEl, "wf-layer-toggle").length, "disabling overview restores the original parser and view");
  await plugin.settingTabs[0].setControlValue("overviewHeadingLevel", "2");
  plugin.settings.googleApiKey = "smoke-key";
  obsidianStub.requestUrl = async () => details;
  openNote("StagesOnly.md", "## 2027-01-01\n- [Hotel](geo:35,139)");
  view.render(md.file, plugin.current.itinerary, -1);
  assert(view.showOverview && view.markers.size === 1 && view.emptyEl.classes.has("is-hidden"), "stage-only note opens its available overview");
  await plugin.fetchDetails();
  plugin.refresh();
  assert(plugin.current.itinerary.overview.stops[0].meta?.placeId === "smoke-place", "details fetching includes overview-only notes");
  plugin.settings.overviewHeadingLevel = 0;
  plugin.settings.dayHeadingLevel = 2;
  console.log("smoke: OK (overview layers, real Leaflet connections, mobile selector, drilldown, source navigation and safe route writes)");
}

openNote("A.md", note);
let resolveRequest;
obsidianStub.requestUrl = () => new Promise((resolve) => { resolveRequest = resolve; });
const unloading = plugin.fetchDetails();
plugin.onunload();
for (const cleanup of plugin.cleanups) cleanup();
assert(debounceCancellations === 1, "pending editor debounce is canceled on unload");
resolveRequest(details);
await unloading;
assert(source === note, "details arriving after unload cannot edit the note");
assert(!writes.includes("B.md"), "no writes were directed to the replacement note");
console.log("smoke: OK (async note identity, preview/source writes, conversion and unload)");
console.log("smoke: OK (view, 6 commands, ribbon, settings tab, editor extension, post processor)");
