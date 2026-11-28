import { stopLinks, visibleLines, type Stop } from "./itinerary";

/** An exact source occurrence; coordinates alone cannot distinguish repeated visits. */
export interface GeoLinkTarget {
  path: string;
  line: number;
  from: number;
  lat: number;
  lng: number;
}

export function plainLinkClick(event: Pick<MouseEvent, "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "defaultPrevented">): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

export function editorGeoLink(text: string, line: number, column: number, path: string): GeoLinkTarget | null {
  const prose = visibleLines(text.split("\n")).bare[line];
  if (prose === null || prose === undefined) return null;
  const link = stopLinks(prose).find((s) => !s.url && column >= s.from && column < s.to);
  return link ? { path, line, from: link.from, lat: link.lat, lng: link.lng } : null;
}

export function matchesGeoStop(stop: Stop, target: GeoLinkTarget): boolean {
  return !stop.url && stop.line === target.line && stop.from === target.from && stop.lat === target.lat && stop.lng === target.lng;
}
