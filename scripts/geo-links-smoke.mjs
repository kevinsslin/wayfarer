// Built-bundle checks for click routing and async source identity; real host UI is checked separately.
export async function runGeoLinksSmoke({ plugin, app, md, files, openNote, getSource, setSource, obsidianStub, codemirrorViewStub, assert }) {
  const saved = { workspace: { ...app.workspace }, vault: app.vault, settings: { ...plugin.settings }, mode: md.getMode, follow: plugin.followGeoLink, openMap: plugin.openMap };
  const text = "## 2027-01-01\n- [Hotel](geo:35,139)\n## 2027-01-02\n- [Hotel](geo:35,139)";
  const event = (target, patch = {}) => ({ button: 0, target, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...patch });
  try {
    plugin.settings.googleApiKey = "";
    plugin.settings.dayHeadingLevel = 2;
    if ("overviewHeadingLevel" in plugin.settings) plugin.settings.overviewHeadingLevel = 0;
    openNote("Geo.md", text);
    const click = plugin.domEvents.find((e) => e.type === "click" && e.options === true)?.callback;
    assert(click, "geo activation is captured once on each host document");
    assert(plugin.settingTabs[0].getSettingDefinitions().some((s) => s.control?.key === "followGeoLinks"), "geo-follow setting is searchable");
    let selected;
    plugin.followGeoLink = async (target) => { selected = target; };
    const anchor = { textContent: "Hotel", attrs: { href: "geo:35,139" }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; }, setAttr(k, v) { this.attrs[k] = v; }, addClass() {}, closest() { return this; } };
    plugin.postProcessors[0]({ querySelectorAll: () => [anchor] }, { sourcePath: "Geo.md", getSectionInfo: () => ({ text, lineStart: 3, lineEnd: 3 }) });
    const href = anchor.attrs.href;
    plugin.settings.followGeoLinks = false;
    const disabled = event(anchor); click(disabled);
    assert(!disabled.defaultPrevented && !selected, "disabled geo-follow retains native external activation");
    plugin.settings.followGeoLinks = true;
    const ordinary = event(anchor); click(ordinary);
    assert(ordinary.defaultPrevented && ordinary.stopped && selected.line === 3 && selected.from === 2, "Reading click follows the exact repeated source occurrence");
    assert(anchor.attrs.href === href && href.startsWith("https://"), "Reading links retain a real external href for native menus");
    for (const patch of [{ button: 1 }, { button: 2 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      selected = null; const e = event(anchor, patch); click(e);
      assert(!e.defaultPrevented && !selected, "modified, middle and right clicks remain external");
    }
    const sourceLink = { closest: (selector) => selector === ".markdown-source-view" ? {} : sourceLink };
    codemirrorViewStub.EditorView.findFromDOM = () => ({
      state: { field: () => ({ file: md.file }), doc: { toString: getSource, lineAt: () => ({ number: 4, from: text.lastIndexOf("- [Hotel]") }) } },
      posAtDOM: () => text.lastIndexOf("Hotel"),
      posAtCoords: () => text.lastIndexOf("Hotel"),
    });
    selected = null; const sourceClick = event(sourceLink); click(sourceClick);
    assert(sourceClick.defaultPrevented && selected?.line === 3 && selected.path === "Geo.md", "editor click uses the public CodeMirror source position and file");
    const touchHandlers = Object.fromEntries(plugin.domEvents.filter((e) => e.type.startsWith("touch") || e.type === "contextmenu").map((e) => [e.type, e.callback]));
    const finger = { identifier: 7, clientX: 40, clientY: 50 };
    const touch = (type, time, patch = {}) => event(sourceLink, { timeStamp: time, touches: type === "touchend" ? [] : [finger], changedTouches: [finger], ...patch });
    selected = null;
    touchHandlers.touchstart(touch("touchstart", 0));
    const tap = touch("touchend", 100); touchHandlers.touchend(tap);
    assert(tap.defaultPrevented && selected?.line === 3, "a short editor touch selects its geo link before the editor action");
    for (const setup of [
      () => touchHandlers.touchmove(touch("touchmove", 40, { touches: [{ ...finger, clientX: 70 }] })),
      () => touchHandlers.touchstart(touch("touchstart", 40, { touches: [finger, { ...finger, identifier: 8 }] })),
      () => touchHandlers.contextmenu(event(sourceLink)),
      () => touchHandlers.touchcancel(event(sourceLink)),
    ]) {
      selected = null; touchHandlers.touchstart(touch("touchstart", 0)); setup();
      const end = touch("touchend", 100); touchHandlers.touchend(end);
      assert(!selected && !end.defaultPrevented, "scroll, multi-touch, context menu and cancelled touches keep native handling");
    }
    selected = null; touchHandlers.touchstart(touch("touchstart", 0));
    const longPress = touch("touchend", 650); touchHandlers.touchend(longPress);
    assert(!selected && !longPress.defaultPrevented, "a long editor press is not a Wayfarer jump");
    selected = null; plugin.settings.followGeoLinks = false; touchHandlers.touchstart(touch("touchstart", 0));
    const offTap = touch("touchend", 100); touchHandlers.touchend(offTap);
    assert(!selected && !offTap.defaultPrevented, "disabled geo following leaves editor taps alone");
    plugin.settings.followGeoLinks = true;
    codemirrorViewStub.EditorView.findFromDOM = () => null;
    plugin.followGeoLink = saved.follow;

    let maps = [], opened = 0, revealed = 0, activated = 0, focusedMap = 0;
    app.workspace.getLeavesOfType = (type) => type === "markdown" ? [{ view: md }] : type === "wayfarer" ? maps.map((view) => ({ view })) : [];
    app.workspace.revealLeaf = async () => { revealed++; };
    app.workspace.setActiveLeaf = () => { activated++; };
    app.vault = { ...saved.vault, getAbstractFileByPath: (path) => files.get(path), cachedRead: async () => getSource() };
    const view = plugin.views.wayfarer({}); view.app = app;
    view.map = { closePopup() {} };
    view.mapEl = { focus() { focusedMap++; } };
    const flights = [];
    view.draw = () => {}; view.openPopup = () => {}; view.flyToStop = (stop) => flights.push(stop);
    view.render = (file, itinerary) => { view.file = file; view.itinerary = itinerary; view.sourceItinerary = itinerary; };
    view.file = md.file; view.itinerary = plugin.current.itinerary; view.sourceItinerary = plugin.current.itinerary;
    maps = [view];
    const first = { path: "Geo.md", line: 1, from: 2, lat: 35, lng: 139 };
    const second = { ...first, line: 3 };
    md.getMode = () => "source";
    view.pinnedDay = 1; view.pinnedHeading = 2;
    await plugin.followGeoLink(second);
    assert(view.focused.line === 3 && view.pinnedDay === 1 && !opened && !revealed, "desktop geo click preserves a compatible map and day selection");
    await plugin.followGeoLink(first);
    assert(view.focused.line === 1 && view.pinnedDay === -1 && view.activeDay === -1, "an incompatible day filter opens All rather than hiding the clicked stop");
    plugin.openMap = async () => { opened++; maps = [view]; view.pinnedDay = 1; view.pinnedHeading = 2; };
    maps = []; obsidianStub.Platform.isMobile = true;
    await plugin.followGeoLink(second);
    assert(opened === 1 && activated === 1 && focusedMap === 1 && revealed === 0 && view.pinnedDay === -1 && view.focused.line === 3, "mobile opens one map on All and reveals the intended stop");
    await plugin.followGeoLink(first);
    assert(opened === 1 && activated === 2 && focusedMap === 2 && revealed === 0, "mobile reuses its open map");
    obsidianStub.Platform.isMobile = false;
    md.getMode = () => "preview";
    const before = flights.length;
    setSource(text.replace("## 2027-01-02\n", "## 2027-01-02\nAdded elsewhere\n"));
    await plugin.followGeoLink(second);
    assert(flights.length === before, "a stale rendered link never chooses another repeated visit");
    setSource(text);
    const reads = [];
    app.vault.cachedRead = () => new Promise((resolve) => reads.push(resolve));
    const earlier = plugin.followGeoLink(first), latest = plugin.followGeoLink(second);
    reads[1](text); await latest; reads[0](text); await earlier;
    assert(flights.length === before + 1 && view.focused.line === 3, "rapid clicks finish at the latest target despite read order");
    const pending = plugin.followGeoLink(first);
    plugin.settings.followGeoLinks = false; reads[2](text); await pending;
    assert(flights.length === before + 1, "disabling the option cancels a pending geo jump");
    plugin.settings.followGeoLinks = true;
    const unloading = plugin.followGeoLink(first);
    plugin.unloaded = true; reads[3](text); await unloading; plugin.unloaded = false;
    assert(flights.length === before + 1 && getSource() === text, "unload cancels a pending jump and source text is unchanged");
    const activeChanged = plugin.events.find(e => e.name === "active-leaf-change").callback;
    const returning = plugin.followGeoLink(first);
    activeChanged({ getViewState: () => ({ type: "markdown" }) });
    reads[4](text); await returning;
    assert(flights.length === before + 1, "returning to the note cancels a delayed link read");
    const afterReads = reads.length;
    md.getMode = () => "source";
    obsidianStub.Platform.isMobile = true;
    maps = [];
    let finishOpening;
    app.workspace.iterateAllLeaves = () => {};
    app.workspace.getLeaf = () => ({ setViewState: () => new Promise(resolve => { finishOpening = resolve; }) });
    plugin.openMap = saved.openMap;
    const opening = plugin.followGeoLink(first);
    activeChanged({ getViewState: () => ({ type: "markdown" }) });
    finishOpening(); await opening;
    assert(revealed === 0 && activated === 2 && reads.length === afterReads, "returning during map creation cancels the pending reveal");
    const disabledOpening = plugin.followGeoLink(first);
    plugin.settings.followGeoLinks = false;
    finishOpening(); await disabledOpening;
    assert(revealed === 0 && activated === 2, "disabling the option during map creation cancels the pending reveal");
  } finally {
    app.workspace = saved.workspace; app.vault = saved.vault; plugin.settings = saved.settings;
    md.getMode = saved.mode; plugin.followGeoLink = saved.follow; plugin.openMap = saved.openMap;
    obsidianStub.Platform.isMobile = false;
  }
  console.log("smoke: OK (geo click defaults, external menus, exact occurrences, current/new mobile maps and async guards)");
}
