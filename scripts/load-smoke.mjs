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
  register() {}
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
  WorkspaceLeaf: class {},
  debounce: (fn) => fn,
  requestUrl: async (request) => { googleRequests.push(request); return { status: 200, json: { places: [], routes: [] }, text: "" }; },
};
const codemirrorStateStub = { RangeSetBuilder: class { add() {} finish() { return {}; } } };
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
    lines[from.line] = lines[from.line].slice(0, from.ch) + text + lines[to.line].slice(to.ch);
    source = lines.join("\n");
  },
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
  const pending = bulk ? plugin.convertAll(md.editor) : plugin.convert(md.editor, 1, url);
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

openNote("A.md", note);
let resolveRequest;
obsidianStub.requestUrl = () => new Promise((resolve) => { resolveRequest = resolve; });
const unloading = plugin.fetchDetails();
plugin.onunload();
resolveRequest(details);
await unloading;
assert(source === note, "details arriving after unload cannot edit the note");
assert(!writes.includes("B.md"), "no writes were directed to the replacement note");
console.log("smoke: OK (async note identity, preview/source writes, conversion and unload)");
console.log("smoke: OK (view, 6 commands, ribbon, settings tab, editor extension, post processor)");
