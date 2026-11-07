import { ItemView, MarkdownView, Menu, Platform, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import * as L from "leaflet";
import { CATEGORY_EMOJI, TRANSPORT_EMOJI, type Transport } from "../core/category";
import { dayColor } from "../core/colors";
import { directionsUrl, navigateUrl, placeUrl } from "../core/gmaps-out";
import { stopNotes, type Day, type Itinerary, type Stop } from "../core/itinerary";
import { legText, type Leg } from "../core/legs";
import { checkHours, describeHours, hoursForWeekday } from "../core/schedule";
import { minutesOf } from "../core/legs";
import { dateForDay, routable } from "../routing";
import { t } from "../core/i18n";
import type WayfarerPlugin from "../main";
import { attachPhoto } from "../photos";
import { mapClearance } from "../core/map-layout";
import { nextStop, previousStop, readProgress, resolveStop, stopRef } from "../core/journey";


export const VIEW_TYPE_WAYFARER = "wayfarer";

const MODES: Transport[] = ["walk", "bike", "car", "taxi", "bus", "train", "metro", "tram", "boat", "flight"];

/**
 * The map pane. Three bands: day chips on top, the map, and a strip of the
 * active day's stops along the bottom. The day under the editor cursor is
 * drawn at full strength; when the cursor sits on a stop the map flies there.
 */
export class WayfarerView extends ItemView {
  private map: L.Map | null = null;
  private tiles: L.TileLayer | null = null;
  private layer: L.LayerGroup = L.layerGroup();
  /** Arrowheads live apart from the rest: they sit a fixed number of pixels before the pin, so only they move with the zoom. */
  private arrows: L.LayerGroup = L.layerGroup();
  private arrowSpecs: Array<[L.LatLng[], string, string]> = [];
  private markers = new Map<Stop, L.Marker>();
  /** Legs and dates per day, computed once per draw and reused by the map, the strip and the popups. */
  private plans = new Map<Day, { legs: Leg[]; date: Date | null }>();
  private tilesKey = "";
  private legendEl!: HTMLElement;
  private mapEl!: HTMLElement;
  private stripEl!: HTMLElement;
  private narrowOpen = false;
  private journeyEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private file: TFile | null = null;
  private itinerary: Itinerary | null = null;
  private activeDay = -1;
  /** Day pinned by clicking the legend; -1 follows the cursor. */
  private pinnedDay = -1;
  /** The pinned day's heading line: the index shifts when days appear or vanish, the heading does not. */
  private pinnedHeading: number | null = null;
  private focused: Stop | null = null;
  private fittedFor: string | null = null;
  private cameraRevision = 0;
  /** Set while the user pans; cleared when the cursor moves to another line. */
  private userMoved = false;
  private flying = false;
  private lastCursorLine = -1;

  constructor(leaf: WorkspaceLeaf, private plugin: WayfarerPlugin) {
    super(leaf);
  }

  get isReady(): boolean { return this.map !== null; }

  getViewType(): string {
    return VIEW_TYPE_WAYFARER;
  }
  getDisplayText(): string {
    return this.file ? `Map: ${this.file.basename}` : "Wayfarer map";
  }
  getIcon(): string {
    return "map";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("wayfarer-view");
    this.legendEl = root.createDiv({ cls: "wf-legend" });
    const body = root.createDiv({ cls: "wf-body" });
    this.stripEl = body.createDiv({ cls: "wf-strip" });
    const divider = body.createDiv({ cls: "wf-divider" });
    const toggle = divider.createEl("button", { cls: "wf-divider-toggle" });
    toggle.onpointerdown = (e) => e.stopPropagation();
    toggle.onclick = (e) => {
      e.stopPropagation();
      if (this.isNarrow()) this.narrowOpen = !this.narrowOpen;
      else {
        this.plugin.settings.listOpen = !this.plugin.settings.listOpen;
        void this.plugin.saveSettings();
      }
      this.applySplit();
      this.stripEl.empty();
      if (this.itinerary) this.drawStrip(this.itinerary);
      this.map?.invalidateSize();
    };
    this.mapEl = body.createDiv({ cls: "wf-map" });
    // Set inline so Leaflet sees it at construction even before styles.css has loaded; otherwise it forces position: relative.
    this.mapEl.setCssProps({ position: "absolute", inset: "0" });
    this.journeyEl = body.createDiv({ cls: "wf-journey" });
    this.emptyEl = root.createDiv({ cls: "wf-empty" });
    this.emptyEl.setText(t("empty"));
    this.applySplit();
    divider.onpointerdown = (down) => {
      down.preventDefault();
      divider.setPointerCapture(down.pointerId);
      const move = (e: PointerEvent) => {
        const left = body.getBoundingClientRect().left + 10;
        this.plugin.settings.listWidth = Math.min(480, Math.max(180, Math.round(e.clientX - left)));
        this.applySplit();
        this.map?.invalidateSize();
      };
      const up = () => {
        divider.removeEventListener("pointermove", move);
        divider.removeEventListener("pointerup", up);
        void this.plugin.saveSettings();
      };
      divider.addEventListener("pointermove", move);
      divider.addEventListener("pointerup", up);
    };

    // The timeline floats over the map's left edge, so the zoom buttons go right.
    this.map = L.map(this.mapEl, { zoomControl: false, attributionControl: true, worldCopyJump: true });
    L.control.zoom({ position: "topright" }).addTo(this.map);
    this.map.setView([35.68, 139.76], 5);
    this.applyTiles();
    this.layer.addTo(this.map);
    this.arrows.addTo(this.map);
    this.map.on("dragstart", () => (this.userMoved = true));
    this.map.on("zoomstart", () => { if (!this.flying) this.userMoved = true; });
    this.map.on("moveend zoomend", () => (this.flying = false));
    this.map.on("zoomend", () => this.redrawArrows());
    this.map.on("popupopen", () => this.contentEl.addClass("has-popup"));
    this.map.on("popupclose", () => this.contentEl.removeClass("has-popup"));

    // Leaflet measures its container once; the pane can be resized or hidden.
    // The popup card is capped at the map's height (see styles), so a long note scrolls inside the card and the photo stays in view.
    const sizeVar = () => {
      this.mapEl.style.setProperty("--wf-map-h", `${this.mapEl.clientHeight}px`);
      this.contentEl.style.setProperty("--wf-journey-h", `${this.journeyEl.offsetHeight}px`);
    };
    sizeVar();
    const ro = new ResizeObserver(() => { sizeVar(); this.applySplit(); this.updateChromeClearance(); this.map?.invalidateSize(); });
    ro.observe(this.mapEl);
    ro.observe(this.journeyEl);
    ro.observe(this.legendEl);
    const observed = new WeakSet<Element>();
    const chromeAttributes = new MutationObserver(() => this.updateChromeClearance());
    this.register(() => chromeAttributes.disconnect());
    const observeChrome = () => {
      const header = root.parentElement?.querySelector(".view-header");
      const chrome = [...this.contentEl.doc.querySelectorAll(".mobile-navbar, .mobile-toolbar")];
      if (header) chrome.push(header);
      for (const el of chrome) {
        if (!observed.has(el)) { observed.add(el); ro.observe(el); chromeAttributes.observe(el, { attributes: true, attributeFilter: ["class", "style"] }); }
      }
      this.updateChromeClearance();
    };
    observeChrome();
    // Host navigation can be hidden, shown, moved or inserted without resizing the pane.
    const hostChanges = new MutationObserver(observeChrome);
    hostChanges.observe(this.contentEl.doc.body, { attributes: true, attributeFilter: ["class", "style"], childList: true });
    const chromeTree = new MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => node.instanceOf(Element) && (node.matches(".mobile-navbar, .mobile-toolbar, .view-header") || node.querySelector(".mobile-navbar, .mobile-toolbar, .view-header"))))) observeChrome();
    });
    chromeTree.observe(this.contentEl.doc.body, { childList: true, subtree: true });
    this.register(() => { hostChanges.disconnect(); chromeTree.disconnect(); });
    this.registerEvent(this.app.workspace.on("layout-change", observeChrome));
    this.registerDomEvent(document, "transitionend", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.instanceOf(HTMLElement) && target.matches(".mobile-navbar, .mobile-toolbar, .view-header")) this.updateChromeClearance();
    });
    this.registerDomEvent(window, "resize", observeChrome);
    const viewport = this.contentEl.win.visualViewport;
    if (viewport) {
      viewport.addEventListener("resize", observeChrome);
      viewport.addEventListener("scroll", observeChrome);
      this.register(() => { viewport.removeEventListener("resize", observeChrome); viewport.removeEventListener("scroll", observeChrome); });
    }
    this.register(() => ro.disconnect());

    // Popup anchors live inside Leaflet's DOM, outside Obsidian's link handling.
    this.registerDomEvent(this.mapEl, "click", (evt) => {
      const t = evt.target as HTMLElement;
      const a = t.closest?.("a.wf-ext");
      if (a?.instanceOf(HTMLAnchorElement)) {
        evt.preventDefault();
        this.contentEl.win.open(a.href);
        return;
      }
    });

    this.plugin.refresh();
  }

  async onClose(): Promise<void> {
    this.contentEl.win.clearTimeout(this.hoverClose);
    this.cameraRevision++;
    this.map?.remove();
    this.map = null;
  }

  /**
   * Narrow panes use separate map/list surfaces on every platform. Width only
   * controls layout; mobile interaction is determined by Platform.isMobile.
   * The saved list preference belongs to the wide layout.
   */
  private isNarrow(): boolean {
    return this.contentEl.clientWidth > 0 && this.contentEl.clientWidth < 560;
  }
  private listOpen(): boolean {
    return this.isNarrow() ? this.narrowOpen : this.plugin.settings.listOpen;
  }

  private applySplit(): void {
    const open = this.listOpen();
    this.contentEl.toggleClass("is-narrow", this.isNarrow());
    this.contentEl.toggleClass("is-list", open);
    const list = this.legendEl.querySelector(".wf-list-toggle");
    list?.setAttribute("aria-pressed", String(open));
    list?.toggleClass("is-active", open);
    const map = this.legendEl.querySelector(".wf-map-toggle");
    map?.setAttribute("aria-pressed", String(!open));
    map?.toggleClass("is-active", !open);
    const body = this.contentEl.querySelector<HTMLElement>(".wf-body");
    const width = this.isNarrow() ? Math.min(this.plugin.settings.listWidth, this.contentEl.clientWidth - 64) : this.plugin.settings.listWidth;
    body?.style.setProperty("--wf-list-width", `${width}px`);
    this.stripEl.toggleClass("is-hidden", !open);
    if (open && !this.stripEl.childElementCount && this.itinerary) this.drawStrip(this.itinerary);
    const divider = this.contentEl.querySelector(".wf-divider");
    divider?.toggleClass("is-closed", !open);
    const toggle = divider?.querySelector(".wf-divider-toggle");
    if (toggle) {
      toggle.textContent = open ? "‹" : "›";
      toggle.setAttribute("aria-label", open ? t("list_hide") : t("list_show"));
    }
    this.drawJourney();
  }

  private updateChromeClearance(): void {
    if (!this.isNarrow()) return;
    const root = this.contentEl.getBoundingClientRect();
    const visible = (el: Element) => {
      const style = this.contentEl.win.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const header = this.contentEl.parentElement?.querySelector(".view-header");
    const footers = [...this.contentEl.doc.querySelectorAll(".mobile-navbar, .mobile-toolbar")].filter(visible);
    const vv = this.contentEl.win.visualViewport;
    const viewport = { top: vv?.offsetTop ?? 0, left: vv?.offsetLeft ?? 0, bottom: (vv?.offsetTop ?? 0) + (vv?.height ?? this.contentEl.win.innerHeight), right: (vv?.offsetLeft ?? 0) + (vv?.width ?? this.contentEl.win.innerWidth) };
    const safeBottom = parseFloat(this.contentEl.win.getComputedStyle(this.contentEl.doc.body).getPropertyValue("--safe-area-inset-bottom")) || 0;
    const clearance = mapClearance(root, header && visible(header) ? [header.getBoundingClientRect()] : [], footers.map((el) => el.getBoundingClientRect()), viewport, safeBottom);
    const set = (key: string, value: number) => {
      const px = `${Math.ceil(value)}px`;
      if (this.contentEl.style.getPropertyValue(key) !== px) this.contentEl.style.setProperty(key, px);
    };
    set("--wf-controls-top", clearance.top + 8);
    set("--wf-controls-bottom", Math.max(24, clearance.bottom + 10));
    set("--wf-legend-bottom", clearance.top + 8 + this.legendEl.offsetHeight);
    set("--wf-journey-max-h", Math.max(80, root.height - clearance.top - this.legendEl.offsetHeight - Math.max(24, clearance.bottom + 10) - 28));
    set("--wf-popup-max-h", Math.max(80, this.mapEl.clientHeight - this.topInset() - this.bottomInset() - 50));
  }

  applyTiles(): void {
    if (!this.map) return;
    const key = `${this.plugin.settings.tileUrl}|${this.plugin.settings.tileAttribution}`;
    if (key === this.tilesKey) return;
    this.tilesKey = key;
    this.tiles?.remove();
    this.tiles = L.tileLayer(this.plugin.settings.tileUrl, {
      attribution: this.plugin.settings.tileAttribution,
      maxZoom: 19,
    }).addTo(this.map);
  }

  /** Replaces the rendered itinerary. `cursorDay` picks the day to emphasise. */
  render(file: TFile | null, itinerary: Itinerary | null, cursorDay: number, cursorLine = -1): void {
    if (!this.map) return;
    const fileChanged = file?.path !== this.file?.path;
    const prevItinerary = this.itinerary;
    const prevFocused = this.focused;
    this.file = file;
    this.itinerary = itinerary;
    if (fileChanged) {
      this.pinnedHeading = null;
      this.lastCursorLine = cursorLine;
      this.focused = file && itinerary
        ? resolveStop(itinerary, readProgress(this.app.loadLocalStorage(`wayfarer:selection:${file.path}`)).current)
        : null;
      if (this.focused) this.pinnedHeading = itinerary?.days.find((d) => d.index === this.focused?.dayIndex)?.headingLine ?? null;
      this.userMoved = false;
    }
    const pinned = this.pinnedHeading === null ? undefined : itinerary?.days.find((d) => d.headingLine === this.pinnedHeading);
    if (!pinned) this.pinnedHeading = null;
    this.pinnedDay = pinned ? pinned.index : -1;
    this.activeDay = this.pinnedDay >= 0 ? this.pinnedDay : cursorDay;
    if (this.focused) this.focused = this.sameStop(this.focused);
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
    this.emptyEl.setText(t("empty"));

    // A leaf change re-sends the same note. Rebuilding the pane then would swallow the click
    // that caused it (the chip under the pointer is replaced between mousedown and mouseup).
    // The drawn markers are keyed by the old stop objects, so those stay in use.
    if (this.signature() === this.lastSig) {
      this.itinerary = prevItinerary;
      this.focused = prevFocused;
      return;
    }
    this.draw();
    const stops = itinerary?.stops ?? [];
    this.emptyEl.toggleClass("is-hidden", stops.length > 0);
    if (!itinerary || stops.length === 0) return;

    if (fileChanged || this.fittedFor !== file?.path) {
      this.fitAll(stops);
      this.fittedFor = file?.path ?? null;
    }
  }

  /**
   * Cursor moved to `line`, which lies in day `day` (or -1). A stop on that
   * line becomes the focus and the map flies to it; a line elsewhere in a
   * day only switches the emphasised day.
   */
  onCursor(line: number, day: number): void {
    if (!this.itinerary || !this.map || Platform.isMobile) return;
    const lineChanged = line !== this.lastCursorLine;
    if (!lineChanged) return;
    this.lastCursorLine = line;
    if (lineChanged) this.userMoved = false;

    const stop = this.itinerary.stops.find((s) => s.line === line) ?? null;
    const dayChanged = this.pinnedDay < 0 && day !== this.activeDay;
    if (this.pinnedDay < 0) this.activeDay = day;
    if (stop === this.focused && !dayChanged) return;
    this.focused = stop;
    this.draw();

    if (!this.plugin.settings.followCursor || this.userMoved) return;
    if (stop) this.flyToStop(stop);
    else if (dayChanged && day >= 0) {
      const d = this.itinerary.days.find((x) => x.index === day);
      if (d) this.fitAll(d.stops);
    }
  }

  /** Redraw with the same data, e.g. when routed legs arrive. */
  redraw(): void {
    if (this.itinerary) this.draw();
  }

  private legsOf(day: Day): Leg[] {
    return this.plan(day).legs;
  }

  /** Legs for a day plus the date read from its heading. */
  plan(day: Day): { legs: Leg[]; date: Date | null } {
    let p = this.plans.get(day);
    if (!p) {
      const date = dateForDay(day);
      p = { legs: this.plugin.router.legsFor(day, date, this.file?.path ?? ""), date };
      this.plans.set(day, p);
    }
    return p;
  }

  /** Opening-hours problem for a stop with a written time, or null. */
  private hoursWarning(stop: Stop, date: Date | null): string | null {
    if (!date || !stop.meta?.hours) return null;
    const st = checkHours(stop.meta.hours, date.getDay(), minutesOf(stop.time) ?? undefined);
    return st ? describeHours(st) : null;
  }

  /* ---------- drawing ---------- */

  /**
   * Focus a stop without rebuilding the layers, so the popup that opened on
   * the click survives. If the stop's day is not the emphasised one, the
   * whole pane redraws and the popup reopens.
   */
  private setFocus(stop: Stop): void {
    const prev = this.focused;
    this.focused = stop;
    if (this.activeDay !== -1 && this.activeDay !== stop.dayIndex) {
      this.activeDay = stop.dayIndex;
      if (this.pinnedDay >= 0) {
        this.pinnedDay = stop.dayIndex;
        this.pinnedHeading = this.itinerary?.days.find((d) => d.index === stop.dayIndex)?.headingLine ?? null;
      }
      this.draw();
      this.openPopup(stop);
      return;
    }
    for (const s of [prev, stop]) {
      const el = s && this.markers.get(s)?.getElement();
      if (el) el.toggleClass("is-focus", s === stop);
    }
    this.stripEl.empty();
    if (this.itinerary) this.drawStrip(this.itinerary);
    this.drawJourney();
  }

  /** What the pane currently shows, as a string; `render` skips the rebuild when it has not changed. */
  private signature(): string {
    return `${this.file?.path}|${this.plugin.settingsRev}|${this.activeDay}|${this.pinnedDay}|${this.focused?.line ?? -1}|${signatureOf(this.itinerary)}`;
  }

  private draw(): void {
    this.lastSig = this.signature();
    this.plans.clear();
    this.layer.clearLayers();
    this.arrows.clearLayers();
    this.arrowSpecs = [];
    this.markers.clear();
    this.legendEl.empty();
    this.stripEl.empty();
    this.drawJourney();
    if (!this.itinerary || this.itinerary.stops.length === 0) return;
    for (const day of this.itinerary.days) this.drawDay(day);
    this.drawLegend(this.itinerary);
    this.drawStrip(this.itinerary);
    this.applySplit();
  }

  private drawDay(day: Day): void {
    const color = dayColor(day.index);
    const dim = this.activeDay >= 0 && this.activeDay !== day.index;
    const cls = dim ? "wf-dim" : "wf-active";

    if (this.plugin.settings.drawRoutes) {
      for (const leg of this.legsOf(day)) {
        const mode = leg.mode;
        const lineColor = leg.lateBy > 0 && !dim ? "#d0342c" : color;
        // A routed leg follows the road and is solid; a straight line stands for "no route known" and is dashed.
        const pts = leg.geometry.map(([a, b]) => L.latLng(a, b));
        const straight = pts.length <= 2;
        const line = L.polyline(pts, {
          color: lineColor,
          weight: dim ? 2 : straight ? 2.5 : mode === "walk" ? 3.5 : 4,
          opacity: dim ? 0.25 : straight ? 0.7 : 0.9,
          dashArray: straight ? "2 9" : undefined,
          lineCap: "round",
          lineJoin: "round",
          className: cls,
        }).addTo(this.layer);
        if (!dim) line.bindTooltip(() => tipEl(legTooltip(leg)), { sticky: true, className: "wf-tooltip" });
        this.drawArrow(pts, lineColor, cls);
        if (mode && !dim) {
          const mid = midpointOf(pts);
          L.marker(mid, {
            icon: L.divIcon({ className: `wf-leg-glyph ${cls}`, html: `<span style="--wf-color:${lineColor}">${TRANSPORT_EMOJI[mode]}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
            interactive: true,
            keyboard: false,
          }).bindTooltip(() => tipEl(legTooltip(leg)), { className: "wf-tooltip", direction: "top", offset: [0, -10] }).addTo(this.layer);
        }
      }
    }
    day.stops.forEach((stop, i) => {
      const focus = stop === this.focused;
      const glyph = stop.emoji ?? CATEGORY_EMOJI[stop.category];
      const icon = L.divIcon({
        className: `wf-pin ${cls}${focus ? " is-focus" : ""}`,
        html: `<span class="wf-pin-body" style="--wf-color:${color}"><span class="wf-pin-glyph">${glyph}</span><span class="wf-pin-n">${i + 1}</span></span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -16],
      });
      const marker = L.marker([stop.lat, stop.lng], { icon, title: stop.name, zIndexOffset: focus ? 2000 : dim ? 0 : 1000 });
      marker.bindTooltip(() => tipEl(stop.time ? `${stop.time} ${stop.name}` : stop.name), { direction: "top", offset: [0, -14], className: "wf-tooltip", permanent: focus });
      marker.bindPopup(() => this.popupEl(day, stop), { className: "wf-popup", closeButton: false, maxWidth: 280, minWidth: 280 });
      marker.on("click", () => {
        this.userMoved = true;
        this.setFocus(stop);
        void this.jumpTo(stop, false);
      });
      // Hovering a pin shows its card; it goes away with the pointer unless the stop is the focused one.
      marker.on("mouseover", () => {
        if (Platform.isMobile || !this.contentEl.win.matchMedia("(any-hover: hover)").matches || this.flying) return;
        this.contentEl.win.clearTimeout(this.hoverClose);
        if (!marker.isPopupOpen()) this.openPopup(stop);
      });
      marker.on("mouseout", () => this.closeHoverPopup(stop, marker));
      marker.on("popupopen", (e) => {
        const el = e.popup.getElement();
        if (!el) return;
        el.onmouseenter = () => this.contentEl.win.clearTimeout(this.hoverClose);
        el.onmouseleave = () => this.closeHoverPopup(stop, marker);
      });
      marker.addTo(this.layer);
      this.markers.set(stop, marker);
    });
  }

  private popupEl(day: Day, stop: Stop): HTMLElement {
    const root = createDiv({ cls: "wf-card" });
    const photo = this.plugin.photoFor(stop);
    if (photo) {
      const wrap = root.createDiv({ cls: "wf-card-imgwrap" });
      const el = wrap.createEl("img", { cls: "wf-card-img", attr: { alt: "" } });
      attachPhoto(el, photo, () => wrap.remove());
      if (photo.credit) wrap.createSpan({ cls: "wf-card-credit", text: photo.credit });
    }
    const body = root.createDiv({ cls: "wf-card-body" });
    const title = body.createDiv({ cls: "wf-card-title" });
    title.createSpan({ text: `${stop.emoji ?? CATEGORY_EMOJI[stop.category]} ` });
    title.createSpan({ text: stop.name });
    const sub = [day.label || t("day", { n: day.index + 1 }), `#${stop.index + 1}`];
    if (stop.time) sub.push(stop.time);
    body.createDiv({ cls: "wf-card-sub", text: sub.join(" · ") });
    const { date } = this.plan(day);
    const facts: string[] = [];
    const warn = this.hoursWarning(stop, date);
    if (warn) body.createDiv({ cls: "wf-card-warn", text: `⚠ ${warn}` });
    if (stop.meta?.rating) facts.push(`★ ${stop.meta.rating.toFixed(1)}`);
    const today = date ? hoursForWeekday(stop.meta?.hours, date.getDay()) : null;
    if (today) facts.push(today.replace(/^[^:]+:\s*/, ""));
    if (facts.length) body.createDiv({ cls: "wf-card-facts", text: facts.join(" · ") });
    for (const n of stopNotes(stop)) body.createDiv({ cls: "wf-card-note", text: n });
    if (stop.meta?.address) body.createDiv({ cls: "wf-card-addr", text: stop.meta.address });
    const actions = body.createDiv({ cls: "wf-card-actions" });
    actions.createEl("a", { cls: "wf-ext", text: t("open_gmaps"), attr: { href: placeUrl(stop) } });
    const prev = day.stops[stop.index - 1];
    const leg = prev ? this.legsOf(day)[stop.index - 1] : undefined;
    if (leg && prev) {
      // One line for the leg: mode, where from, numbers. With a mode it is also the directions link.
      const t2 = body.createDiv({ cls: `wf-card-leg${leg.lateBy > 0 ? " is-late" : ""}` });
      const text = `${leg.mode ? TRANSPORT_EMOJI[leg.mode] + " " : ""}${t("from_prev", { name: prev.name })} · ${legText(leg)}${leg.lateBy ? " · " + t("late_by", { n: leg.lateBy }) : ""}`;
      const url = leg.mode ? directionsUrl([prev, stop], leg.mode === "walk" ? "walking" : leg.mode === "bike" ? "bicycling" : leg.mode === "car" || leg.mode === "taxi" ? "driving" : "transit") : null;
      if (url) t2.createEl("a", { cls: "wf-ext", text: `${text} ↗`, attr: { href: url, "aria-label": t("from_prev_dir") } });
      else t2.setText(text);
      body.insertBefore(t2, actions);
      if (this.isNarrow()) {
        const transport = actions.createEl("button", { cls: "wf-inline-action", text: t("change_transport") });
        transport.onclick = () => this.pickTransport(transport, leg);
      }
    }
    if (stop.meta?.website && /^https?:\/\//i.test(stop.meta.website)) actions.createEl("a", { cls: "wf-ext", text: t("website"), attr: { href: stop.meta.website } });
    const jump = actions.createEl("a", { text: t("to_line"), attr: { href: "#" } });
    jump.onclick = (e) => { e.preventDefault(); void this.jumpTo(stop); };
    return root;
  }

  /** An arrowhead on the line, 22 px before the destination pin so the pin does not cover it. */
  private drawArrow(pts: L.LatLng[], color: string, cls: string): void {
    if (!this.map || pts.length < 2) return;
    this.arrowSpecs.push([pts, color, cls]);
    this.placeArrow(pts, color, cls);
  }

  /** Zoom changed: the pins and lines stay, the arrowheads are placed again. */
  private redrawArrows(): void {
    this.arrows.clearLayers();
    for (const [pts, color, cls] of this.arrowSpecs) this.placeArrow(pts, color, cls);
  }

  private placeArrow(pts: L.LatLng[], color: string, cls: string): void {
    if (!this.map) return;
    const px = pts.map((p) => this.map!.latLngToLayerPoint(p));
    let remaining = 22;
    let i = px.length - 1;
    let tip = px[i];
    while (i > 0) {
      const seg = px[i].distanceTo(px[i - 1]);
      if (seg >= remaining) {
        const f = remaining / seg;
        tip = L.point(px[i].x + (px[i - 1].x - px[i].x) * f, px[i].y + (px[i - 1].y - px[i].y) * f);
        break;
      }
      remaining -= seg;
      i--;
      tip = px[i];
    }
    if (i === 0) return;
    const from = px[i - 1];
    const angle = (Math.atan2(tip.y - from.y, tip.x - from.x) * 180) / Math.PI;
    L.marker(this.map.layerPointToLatLng(tip), {
      icon: L.divIcon({ className: `wf-arrow ${cls}`, html: `<span style="--wf-color:${color};transform:rotate(${angle}deg)"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
      interactive: false,
      keyboard: false,
    }).addTo(this.arrows);
  }

  private chooseDay(day: Day | null): void {
    this.pinnedHeading = day?.headingLine ?? null;
    this.pinnedDay = day?.index ?? -1;
    this.activeDay = this.pinnedDay;
    this.focused = null;
    this.draw();
    this.fitAll(day?.stops ?? this.itinerary?.stops ?? []);
  }

  private drawLegend(it: Itinerary): void {
    const dates = this.legendEl.createDiv({ cls: "wf-dates" });
    const all = dates.createEl("button", { cls: "wf-chip wf-chip-all", text: t("all") });
    all.toggleClass("is-active", this.activeDay === -1);
    all.setAttr("aria-pressed", String(this.activeDay === -1));
    all.onclick = () => this.chooseDay(null);
    for (const day of it.days) {
      const chip = dates.createEl("button", { cls: "wf-chip", text: day.label || t("day", { n: day.index + 1 }) });
      chip.style.setProperty("--wf-color", dayColor(day.index));
      chip.toggleClass("is-active", this.activeDay === day.index);
      chip.toggleClass("is-pinned", this.pinnedDay === day.index);
      chip.setAttr("aria-pressed", String(this.activeDay === day.index));
      chip.setAttr("aria-label", `${day.title} (${day.stops.length})`);
      chip.onclick = () => this.chooseDay(day);
    }
    const dayControl = this.legendEl.createDiv({ cls: "wf-day-control" });
    setIcon(dayControl.createSpan({ cls: "wf-day-chevron" }), "chevron-down");
    const select = dayControl.createEl("select", { cls: "wf-day-select", attr: { "aria-label": t("choose_day") } });
    select.createEl("option", { text: t("overview"), value: "-1" });
    for (const day of it.days) select.createEl("option", { text: `${day.label || t("other")} · ${t("day", { n: day.index + 1 })}`, value: String(day.index), attr: { title: day.title } });
    select.value = String(this.activeDay);
    select.onchange = () => this.chooseDay(it.days.find((d) => d.index === Number(select.value)) ?? null);
    const right = this.legendEl.createDiv({ cls: "wf-legend-right" });
    const map = right.createEl("button", { cls: "wf-chip wf-chip-icon wf-map-toggle", attr: { "aria-label": t("view_map") } });
    setIcon(map, "map");
    map.setAttr("title", t("view_map"));
    map.onclick = () => { this.narrowOpen = false; this.applySplit(); };
    const list = right.createEl("button", { cls: "wf-chip wf-chip-icon wf-list-toggle", attr: { "aria-label": t("view_list") } });
    setIcon(list, "list");
    list.setAttr("title", t("view_list"));
    list.onclick = () => {
      this.narrowOpen = true;
      this.drawJourney();
      // The phone uses one surface at a time; desktop keeps its original floating timeline.
      this.map?.closePopup();
      this.applySplit();
      this.stripEl.empty();
      this.drawStrip(it);
    };
    const follow = right.createEl("button", { cls: "wf-chip wf-chip-icon wf-follow" });
    setIcon(follow, "pin");
    follow.toggleClass("is-active", this.plugin.settings.followCursor);
    follow.setAttr("aria-pressed", String(this.plugin.settings.followCursor));
    follow.setAttr("aria-label", this.plugin.settings.followCursor ? t("follow_on") : t("follow_off"));
    follow.onclick = () => {
      this.plugin.settings.followCursor = !this.plugin.settings.followCursor;
      void this.plugin.saveSettings();
      this.draw();
    };
  }

  /** The last browsed stop is local to this vault/device, independent of trip completion. */
  private selectedStop(): Stop | null {
    return this.focused ?? this.itinerary?.days.find((d) => d.index === this.activeDay)?.stops[0] ?? this.itinerary?.stops[0] ?? null;
  }

  private browseStop(stop: Stop): void {
    if (!this.itinerary) return;
    this.pinnedHeading = this.itinerary.days.find((d) => d.index === stop.dayIndex)?.headingLine ?? null;
    this.pinnedDay = this.activeDay = stop.dayIndex;
    this.focused = stop;
    this.narrowOpen = false;
    this.map?.closePopup();
    this.draw();
    this.flyToStop(stop);
  }

  private drawJourney(): void {
    this.journeyEl.empty();
    this.journeyEl.removeClass("is-expanded");
    const it = this.itinerary;
    const stop = this.selectedStop();
    if (!it || !stop) return;
    if (this.file) {
      const key = `wayfarer:selection:${this.file.path}`;
      const selection = { current: stopRef(it, stop) };
      if (JSON.stringify(this.app.loadLocalStorage(key)) !== JSON.stringify(selection)) this.app.saveLocalStorage(key, selection);
    }
    if (this.isNarrow() && this.narrowOpen) return;
    this.journeyEl.addClass("is-expanded");
    const content = this.journeyEl.createDiv({ cls: "wf-journey-content" });
    const info = content.createEl("button", { cls: "wf-journey-stop", text: `${stop.time ? stop.time + " · " : ""}${stop.name}`, attr: { "aria-label": `${t("journey_info")}: ${stop.name}` } });
    info.onclick = () => {
      this.setFocus(stop);
      this.flyToStop(stop);
      this.openPopup(stop);
    };
    const actions = content.createDiv({ cls: "wf-journey-actions" });
    const previous = previousStop(it, stop);
    const back = actions.createEl("button", { cls: "wf-journey-previous", text: t("journey_previous") });
    back.disabled = !previous;
    back.onclick = () => { if (previous) this.browseStop(previous); };
    const nav = actions.createEl("button", { cls: "wf-journey-nav", text: t("journey_nav_short"), attr: { "aria-label": t("journey_nav_start"), title: t("journey_nav_start") } });
    nav.onclick = () => this.contentEl.win.open(navigateUrl(stop, stop.transport));
    const next = nextStop(it, stop);
    const advance = actions.createEl("button", { cls: "wf-journey-advance", text: t("journey_next") + " →" });
    advance.disabled = !next;
    advance.onclick = () => { if (next) this.browseStop(next); };
  }

  /** The active day's stops as a vertical timeline in the left column; the whole trip when no day is active. */
  private drawStrip(it: Itinerary): void {
    if (!this.listOpen()) return;
    const day = it.days.find((d) => d.index === this.activeDay);
    const days = day ? [day] : it.days;
    for (const d of days) {
      const color = dayColor(d.index);
      if (!day) {
        const h = this.stripEl.createDiv({ cls: "wf-strip-day", text: d.label || t("other") });
        h.style.setProperty("--wf-color", color);
      }
      const { legs, date } = this.plan(d);
      d.stops.forEach((stop, i) => {
        if (i > 0) this.drawLegRow(legs[i - 1], color);
        const card = this.stripEl.createEl("button", { cls: "wf-stop" });
        card.style.setProperty("--wf-color", color);
        card.toggleClass("is-focus", stop === this.focused);
        const photo = this.plugin.photoFor(stop);
        if (photo) {
          const th = card.createEl("img", { cls: "wf-stop-thumb", attr: { alt: "" } });
          attachPhoto(th, photo, () => { th.remove(); card.removeClass("has-thumb"); });
          card.addClass("has-thumb");
        }
        const body = card.createDiv({ cls: "wf-stop-body" });
        const top = body.createDiv({ cls: "wf-stop-top" });
        top.createSpan({ cls: "wf-stop-n", text: String(i + 1) });
        if (stop.time) top.createSpan({ cls: "wf-stop-time", text: stop.time });
        const main = body.createDiv({ cls: "wf-stop-main" });
        main.createSpan({ cls: "wf-stop-glyph", text: stop.emoji ?? CATEGORY_EMOJI[stop.category] });
        main.createSpan({ cls: "wf-stop-name", text: stop.name });
        const warn = this.hoursWarning(stop, date);
        const notes = stopNotes(stop);
        // The chosen card is the unfolded one; choosing another folds it back. No toggles to click.
        const open = stop === this.focused;
        card.toggleClass("is-open", open);
        const sub = body.createDiv({ cls: "wf-stop-sub" });
        if (warn) sub.createSpan({ cls: "is-late", text: `⚠ ${warn}` });
        else if (notes[0]) sub.createSpan({ text: notes[0] });
        else if (stop.meta?.rating) sub.createSpan({ text: `★ ${stop.meta.rating.toFixed(1)}` });
        if (open && notes.length > 0) {
          const box = body.createDiv({ cls: "wf-stop-notes" });
          if (warn) box.createDiv({ cls: "wf-stop-note is-late", text: `⚠ ${warn}` });
          for (const n of notes) box.createDiv({ cls: "wf-stop-note", text: n });
        }
        card.draggable = true;
        card.ondragstart = (e) => {
          // A private type: a card dropped on the editor by mistake must not type its line number into the note.
          e.dataTransfer?.setData(DRAG_TYPE, `${this.file?.path ?? ""}\n${stop.line}`);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          card.addClass("is-dragging");
        };
        card.ondragend = () => card.removeClass("is-dragging");
        card.ondragover = (e) => { e.preventDefault(); card.addClass("is-drop"); };
        card.ondragleave = () => card.removeClass("is-drop");
        card.ondrop = (e) => {
          e.preventDefault();
          card.removeClass("is-drop");
          const [path, line] = (e.dataTransfer?.getData(DRAG_TYPE) ?? "").split("\n");
          const src = Number(line);
          if (line !== undefined && path === (this.file?.path ?? "") && Number.isInteger(src) && src !== stop.line && this.itinerary?.stops.some((x) => x.line === src)) void this.plugin.moveStopLine(src, stop.line);
        };
        card.onclick = () => {
          if (this.isNarrow()) { this.narrowOpen = false; this.applySplit(); }
          this.focused = stop;
          this.userMoved = false;
          this.draw();
          this.flyToStop(stop);
          void this.jumpTo(stop, false);
          this.openPopup(stop);
        };
        if (stop === this.focused) this.contentEl.win.setTimeout(() => card.scrollIntoView({ block: "nearest", behavior: "smooth" }), 0);
      });
    }
  }

  /**
   * The arrow between two cards. The transport is the user's: chosen here,
   * or a transport emoji written before the link. Until chosen, the row
   * asks, and shows the straight-line distance only.
   */
  private drawLegRow(leg: Leg, color: string): void {
    const conn = this.stripEl.createDiv({ cls: `wf-leg${leg.lateBy > 0 ? " is-late" : ""}${leg.mode ? "" : " is-unknown"}` });
    conn.style.setProperty("--wf-color", color);
    const narrow = this.isNarrow();
    if (!narrow) {
      const mode = conn.createEl("button", { cls: "wf-leg-mode", text: leg.mode ? TRANSPORT_EMOJI[leg.mode] : "?" });
      mode.setAttr("aria-label", t("via_hint"));
      mode.onclick = (e) => { e.stopPropagation(); this.pickTransport(mode, leg); };
    }
    let text = narrow
      ? `${leg.mode ? `${TRANSPORT_EMOJI[leg.mode]} ${t(`m_${leg.mode}`)}` : t("transport_unset")} · ${!leg.routed ? t("straight_distance") + " " : ""}${legText(leg)}`
      : leg.mode ? legText(leg) : `${t("pick_mode")} · ${legText(leg)}`;
    if (!narrow && leg.mode && !leg.routed && routable(leg.mode) && !this.plugin.settings.googleApiKey) text += ` · ${t("key_needed")}`;
    conn.createSpan({ cls: "wf-leg-text", text });
    if (leg.lateBy) conn.createSpan({ cls: "wf-leg-late", text: t("late_by", { n: leg.lateBy }) });
    conn.setAttr("aria-label", legTooltip(leg));
  }

  private pickTransport(anchor: HTMLElement, leg: Leg): void {
    const menu = new Menu();
    for (const mode of MODES) {
      menu.addItem((item) => item.setTitle(`${TRANSPORT_EMOJI[mode]} ${t(`m_${mode}`)}`).setChecked(mode === leg.mode).onClick(() => this.plugin.setStopTransport(leg.to, mode)));
    }
    const bounds = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: bounds.left, y: bounds.bottom });
  }

  /* ---------- camera ---------- */

  /** Width of the map hidden under the floating timeline, so the camera centres on what is actually visible. */
  private leftInset(): number {
    return this.listOpen() && !this.isNarrow() ? this.plugin.settings.listWidth + 20 : 0;
  }

  /** The map centre that puts `target` in the middle of the uncovered part of the map at `zoom`. */
  private centreFor(target: L.LatLng, zoom: number): L.LatLng {
    if (!this.map) return target;
    return this.map.unproject(this.map.project(target, zoom).subtract([this.leftInset() / 2, (this.topInset() - this.bottomInset()) / 2]), zoom);
  }

  private hoverClose = 0;
  private lastSig = "";

  /** Closes a popup that was only open because the pointer was on the pin. */
  private closeHoverPopup(stop: Stop, marker: L.Marker): void {
    this.contentEl.win.clearTimeout(this.hoverClose);
    this.hoverClose = this.contentEl.win.setTimeout(() => {
      if (stop === this.focused || !marker.isPopupOpen()) return;
      marker.closePopup();
      // Hovering another pin had displaced the chosen stop's card; bring it back.
      if (this.focused) this.openPopup(this.focused);
    }, 180);
  }

  /** Opens a stop's popup, panning it clear of the floating timeline. */
  private openPopup(stop: Stop): void {
    // List selection restores the navigator synchronously, before ResizeObserver runs.
    // Measure its new height before Leaflet sizes and pans the details card.
    this.updateChromeClearance();
    const marker = this.markers.get(stop);
    if (!marker) return;
    const popup = marker.getPopup();
    // Room for the chip bar on top and the timeline on the left, so the card is never under either.
    if (popup) L.setOptions(popup, { autoPanPaddingTopLeft: L.point(this.leftInset() + 12, this.topInset() + 12), autoPanPaddingBottomRight: L.point(12, this.bottomInset() + 12) });
    // While the camera is still moving, the pan the popup asks for would be undone by the flight; open it on arrival.
    if (this.flying && this.map) this.map.once("moveend", () => { if (this.markers.get(stop) === marker) marker.openPopup(); });
    else marker.openPopup();
  }

  /** Height of the floating chip bar over the top of the map. */
  private topInset(): number {
    return this.isNarrow() ? Math.max(0, this.legendEl.getBoundingClientRect().bottom - this.mapEl.getBoundingClientRect().top) : 0;
  }

  private bottomInset(): number {
    if (!this.journeyEl.offsetHeight) return parseFloat(this.contentEl.win.getComputedStyle(this.contentEl).getPropertyValue("--wf-controls-bottom")) || 24;
    return Math.max(0, this.mapEl.getBoundingClientRect().bottom - this.journeyEl.getBoundingClientRect().top);
  }

  private flyToStop(stop: Stop): void {
    if (!this.map) return;
    this.cameraRevision++;
    this.map.stop();
    this.map.invalidateSize(false);
    const size = this.map.getSize();
    if (size.x === 0 || size.y === 0) return;
    const target = L.latLng(stop.lat, stop.lng);
    const zoom = Math.max(this.map.getZoom(), 14);
    this.flying = true;
    const visible = this.map.getBounds();
    const covered = this.map.containerPointToLatLng([this.leftInset(), 0]);
    const seen = L.latLngBounds(L.latLng(visible.getSouth(), covered.lng), visible.getNorthEast()).pad(-0.2);
    if (seen.contains(target) && this.map.getZoom() >= 13) this.map.panTo(this.centreFor(target, this.map.getZoom()), { animate: !this.contentEl.win.matchMedia("(prefers-reduced-motion: reduce)").matches, duration: 0.4 });
    else this.map.flyTo(this.centreFor(target, zoom), zoom, { animate: !this.contentEl.win.matchMedia("(prefers-reduced-motion: reduce)").matches, duration: 0.6 });
  }

  /**
   * Leaflet computes bounds against the container size, which is 0x0 while
   * the pane is still being laid out, so measure first and retry once the
   * container has a size.
   */
  private fitAll(stops: Stop[], attempt = 0, revision = ++this.cameraRevision): void {
    if (!this.map || stops.length === 0 || revision !== this.cameraRevision) return;
    this.map.stop();
    this.map.invalidateSize(false);
    const size = this.map.getSize();
    if ((size.x === 0 || size.y === 0) && attempt < 20) {
      this.contentEl.win.setTimeout(() => this.fitAll(stops, attempt + 1, revision), 50);
      return;
    }
    this.flying = true;
    if (stops.length === 1) {
      this.map.setView(this.centreFor(L.latLng(stops[0].lat, stops[0].lng), 14), 14);
      return;
    }
    this.map.fitBounds(L.latLngBounds(stops.map((s) => [s.lat, s.lng] as [number, number])), { paddingTopLeft: [this.leftInset() + 36, this.topInset() + 36], paddingBottomRight: [36, this.bottomInset() + 36], maxZoom: 15 });
  }

  private sameStop(s: Stop): Stop | null {
    return this.itinerary?.stops.find((x) => x.line === s.line && x.from === s.from && x.lat === s.lat && x.lng === s.lng) ?? this.itinerary?.stops.find((x) => x.name === s.name && x.lat === s.lat && x.lng === s.lng) ?? null;
  }

  /** Puts the editor cursor on the stop and scrolls it into view. */
  private async jumpTo(stop: Stop, focusEditor = true): Promise<void> {
    if (!this.file || (!focusEditor && Platform.isMobile)) return;
    let view = this.plugin.app.workspace.getLeavesOfType("markdown")
      .map((l) => l.view)
      .find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === this.file?.path);
    if (!view && !focusEditor) return;
    if (!view) {
      const leaf = this.plugin.app.workspace.getLeaf(false);
      await leaf.openFile(this.file);
      view = leaf.view instanceof MarkdownView ? leaf.view : undefined;
    }
    if (!view) return;
    this.lastCursorLine = stop.line;
    if (focusEditor) this.plugin.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    const pos = { line: stop.line, ch: stop.from };
    view.editor.setCursor(pos);
    view.editor.scrollIntoView({ from: pos, to: { line: stop.line, ch: stop.to } }, true);
  }
}

/** The point halfway along a polyline by length. */
function midpointOf(pts: L.LatLng[]): L.LatLng {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += pts[i - 1].distanceTo(pts[i]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = pts[i - 1].distanceTo(pts[i]);
    if (acc + seg >= total / 2) {
      const f = seg ? (total / 2 - acc) / seg : 0;
      return L.latLng(pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f, pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * f);
    }
    acc += seg;
  }
  return pts[Math.floor(pts.length / 2)];
}

/** Tooltip content as a node: Leaflet would otherwise set a string as innerHTML, and names come from the note. */
function tipEl(text: string): HTMLElement {
  return createSpan({ text });
}

function legTooltip(leg: Leg): string {
  const bits = [`${leg.mode ? TRANSPORT_EMOJI[leg.mode] + " " : ""}${leg.from.name} → ${leg.to.name}`, legText(leg)];
  if (leg.routed) bits.push(t("routed_by"));
  if (leg.lateBy) bits.push(t("late_vs", { t: leg.to.time ?? "", n: leg.lateBy }));
  return bits.join("\n");
}

/** Picks today's line from Google's weekdayDescriptions, e.g. "Wednesday: 9:00 AM – 5:00 PM". */
export function todayHours(hours: string[] | undefined, now = new Date()): string | null {
  return hoursForWeekday(hours, now.getDay());
}

/** Everything the pane draws from an itinerary, as a string, to skip a rebuild when nothing changed. */
const digests = new WeakMap<Itinerary, string>();
function signatureOf(it: Itinerary | null): string {
  if (!it) return "";
  let d = digests.get(it);
  if (d === undefined) {
    d = JSON.stringify([it.days.map((d) => [d.headingLine, d.title, d.stops.map((s) => [s.line, s.from, s.name, s.url, s.lat, s.lng, s.transport, s.time, s.emoji, s.image, s.note, s.notes, s.meta])])]);
    digests.set(it, d);
  }
  return d;
}

const DRAG_TYPE = "application/x-wayfarer-stop";
