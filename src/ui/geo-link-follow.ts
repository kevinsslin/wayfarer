import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { editorGeoLink, plainLinkClick, type GeoLinkTarget } from "../core/geo-link-follow";
import type WayfarerPlugin from "../main";
import { readingGeoLinks } from "./reading";

/** Use source coordinates too: mobile editors can dispatch to the line/content element. */
function editorTarget(element: HTMLElement, point: { x: number; y: number }): GeoLinkTarget | undefined {
  if (!element.closest(".markdown-source-view")) return;
  try {
    const view = EditorView.findFromDOM(element);
    const file = view?.state.field(editorInfoField, false)?.file;
    if (!view || !file) return;
    const link = element.closest("a, .cm-link, .cm-url");
    const pos = view.posAtCoords(point) ?? (link ? view.posAtDOM(link) : null);
    if (pos === null) return;
    const line = view.state.doc.lineAt(pos);
    return editorGeoLink(view.state.doc.toString(), line.number - 1, pos - line.from, file.path) ?? undefined;
  } catch { return; }
}

/** Preserve real hrefs and long-press menus; only completed short editor taps are consumed. */
export function registerGeoLinkClicks(plugin: WayfarerPlugin, doc: Document): void {
  const follow = (event: Event, target: GeoLinkTarget) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    void plugin.followGeoLink(target);
  };
  plugin.registerDomEvent(doc, "click", (event) => {
    if (!plugin.settings.followGeoLinks || !plainLinkClick(event)) return;
    const element = event.target as HTMLElement | null;
    if (!element?.closest) return;
    const link = element.closest<HTMLElement>("a");
    const target = (link && readingGeoLinks.get(link)) ?? editorTarget(element, { x: event.clientX, y: event.clientY });
    if (target) follow(event, target);
  }, true);

  let tap: { id: number; x: number; y: number; time: number; target: GeoLinkTarget } | null = null;
  const cancel = () => { tap = null; };
  plugin.registerDomEvent(doc, "touchstart", (event) => {
    cancel();
    if (!plugin.settings.followGeoLinks || event.touches.length !== 1 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const element = event.target as HTMLElement | null;
    if (!element?.closest) return;
    const touch = event.touches[0];
    const target = editorTarget(element, { x: touch.clientX, y: touch.clientY });
    if (target) tap = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp, target };
  }, { capture: true, passive: true });
  plugin.registerDomEvent(doc, "touchmove", (event) => {
    const touch = event.touches[0];
    if (tap && (event.touches.length !== 1 || touch.identifier !== tap.id || Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > 8)) cancel();
  }, { capture: true, passive: true });
  plugin.registerDomEvent(doc, "touchend", (event) => {
    const start = tap;
    cancel();
    if (!start || !plugin.settings.followGeoLinks || event.touches.length || event.timeStamp - start.time >= 500) return;
    const touch = Array.from(event.changedTouches).find((t) => t.identifier === start.id);
    const element = event.target as HTMLElement | null;
    if (!touch || !element?.closest || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8) return;
    const target = editorTarget(element, { x: touch.clientX, y: touch.clientY });
    if (!target || target.path !== start.target.path || target.line !== start.target.line || target.from !== start.target.from
      || target.lat !== start.target.lat || target.lng !== start.target.lng) return;
    // Cancelling touchend suppresses the compatibility click and the editor's own link action.
    follow(event, target);
  }, { capture: true, passive: false });
  plugin.registerDomEvent(doc, "touchcancel", cancel, true);
  plugin.registerDomEvent(doc, "contextmenu", cancel, true);
}
