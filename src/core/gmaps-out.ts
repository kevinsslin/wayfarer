import { isGoogleMapsUrl } from "./gmaps-url";
import type { Stop } from "./itinerary";
import type { Transport } from "./category";

/** Omit origin so Maps uses the traveller's actual position. Opening this never advances progress. */
export function navigateUrl(stop: PlaceTarget, mode?: Transport): string {
  const params = new URLSearchParams({ api: "1", destination: `${stop.lat},${stop.lng}`, dir_action: "navigate" });
  if (stop.meta?.placeId) params.set("destination_place_id", stop.meta.placeId);
  if (mode) params.set("travelmode", mode === "walk" ? "walking" : mode === "bike" ? "bicycling" : mode === "car" || mode === "taxi" ? "driving" : "transit");
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

type PlaceTarget = Pick<Stop, "lat" | "lng"> & Partial<Pick<Stop, "name" | "meta" | "url">>;
/** Prefer the original business link, then Place ID, then a coordinate-only fallback. */
export function placeUrl(stop: PlaceTarget): string {
  if (stop.url && isGoogleMapsUrl(stop.url)) return stop.url;
  if (!stop.meta?.placeId) return `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`;
  const params = new URLSearchParams({ api: "1", query: `${stop.lat},${stop.lng}` });
  params.set("query", stop.name || `${stop.lat},${stop.lng}`);
  params.set("query_place_id", stop.meta.placeId);
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * Directions through a day's stops in order. Google caps waypoints at 9 on the
 * URL API, so a longer day keeps the first, last and an even spread between.
 */
export function directionsUrl(stops: Pick<Stop, "lat" | "lng">[], mode: "transit" | "walking" | "driving" | "bicycling" = "transit"): string | null {
  if (stops.length === 0) return null;
  if (stops.length === 1) return placeUrl(stops[0]);
  const pt = (s: Pick<Stop, "lat" | "lng">) => `${s.lat},${s.lng}`;
  const middle = stops.slice(1, -1);
  const kept = middle.length <= 9 ? middle : Array.from({ length: 9 }, (_, i) => middle[Math.round((i * (middle.length - 1)) / 8)]);
  const params = new URLSearchParams({ api: "1", origin: pt(stops[0]), destination: pt(stops[stops.length - 1]), travelmode: mode });
  if (kept.length) params.set("waypoints", kept.map(pt).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Day headings for a trip, one per day: `## 2026-09-16 週三`. The full date
 * keeps the year, so weekday and hours checks stay right after the trip and
 * across New Year; the pane shows it as `9/16`.
 */
export function tripSkeleton(start: Date, days: number, weekdayNames = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"], level = 2): string {
  const out: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push(`${"#".repeat(level)} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${weekdayNames[d.getDay()]}`, "", "- ", "");
  }
  return out.join("\n");
}
