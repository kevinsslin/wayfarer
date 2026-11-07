/**
 * Turns a pasted Google Maps URL into a named coordinate, using whichever
 * network dependencies are available. Pure orchestration: every I/O step is
 * injected so this can be tested with fakes.
 */
import { isValidLatLng, parseGoogleMapsUrl, type ParsedMapsUrl } from "./gmaps-url";
import type { PlaceMeta } from "./itinerary";

export interface ResolvedPlace {
  /** Original link remains the note's clickable target after conversion. */
  url?: string;
  name: string;
  lat: number;
  lng: number;
  meta?: PlaceMeta;
  /** Which step produced the coordinates, for the status message. */
  source: "url" | "places";
}

export interface ResolveDeps {
  /** Follows redirects of a short link and returns the final URL. Undefined where unsupported (mobile). */
  expandShortUrl?: (url: string) => Promise<string>;
  /** Google Places (New) lookups. Undefined when no API key is configured. */
  places?: {
    details(placeId: string): Promise<ResolvedPlace | null>;
    /** Text lookup, biased to `near` when the link carries a pin. */
    searchText(query: string, near?: { lat: number; lng: number }): Promise<ResolvedPlace | null>;
  };
}

export class ResolveError extends Error {}

export async function resolveMapsUrl(input: string, deps: ResolveDeps): Promise<ResolvedPlace> {
  let parsed = parseGoogleMapsUrl(input);
  if (!parsed) throw new ResolveError("Not a Google Maps link");

  let expanded = input;
  if (parsed.isShort) {
    if (!deps.expandShortUrl) throw new ResolveError("Short links are expanded on the desktop app. Paste the full Google Maps link, or convert this one on your computer.");
    expanded = await deps.expandShortUrl(input);
    parsed = parseGoogleMapsUrl(expanded);
    if (!parsed || parsed.isShort) throw new ResolveError("Could not expand the short link");
  }

  const originalUrl = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const keepLink = (place: ResolvedPlace): ResolvedPlace => {
    const meta = parsed?.placeId && !place.meta?.placeId ? { ...place.meta, placeId: parsed.placeId } : place.meta;
    return { ...place, ...(meta ? { meta } : {}), url: originalUrl };
  };

  const urlPin = parsed.lat !== undefined && parsed.lng !== undefined && isValidLatLng(parsed.lat, parsed.lng) ? { lat: parsed.lat, lng: parsed.lng } : null;

  // The link is the source of truth. With a key, Google adds the canonical
  // name, hours, rating and photo: by place id when the link has one, else
  // by looking the name up near the link's pin. A result that lands
  // elsewhere is a different place and is dropped; the pin itself is never
  // moved away from an exact `!3d…!4d…` coordinate.
  if (deps.places) {
    if (parsed.placeId) {
      const p = await deps.places.details(parsed.placeId);
      if (p) return keepLink(p);
    }
    const text = parsed.name ?? parsed.query;
    if (text) {
      const p = await deps.places.searchText(text, urlPin ?? undefined);
      if (p && !urlPin) return keepLink(p);
      if (p && urlPin && distanceM(p, urlPin) <= (parsed.exact ? 300 : 3000)) return keepLink(parsed.exact ? { ...p, ...urlPin } : p);
    }
  }

  if (urlPin) return keepLink({ name: nameFor(parsed), ...urlPin, source: "url" });

  throw new ResolveError(
    parsed.placeId || parsed.ftid
      ? "This link only carries a place id. Add a Google API key in settings to resolve it."
      : "This link has no coordinates. Share the place from Google Maps instead of typing a search.",
  );
}

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function nameFor(p: ParsedMapsUrl): string {
  return p.name ?? p.query ?? `${p.lat!.toFixed(4)}, ${p.lng!.toFixed(4)}`;
}
