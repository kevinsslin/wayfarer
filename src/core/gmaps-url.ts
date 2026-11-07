/**
 * Google Maps URL parsing. Pure functions, no network.
 *
 * A pasted link can be one of many shapes. We extract whatever it carries
 * (coordinates, a place name, a place id, or a free-text query) and let the
 * resolver decide what still needs a network call.
 */

export interface ParsedMapsUrl {
  /** True for maps.app.goo.gl / goo.gl/maps / g.co links that must be expanded first. */
  isShort: boolean;
  lat?: number;
  lng?: number;
  /** True when lat/lng are the place pin (`!3d…!4d…`, `q=lat,lng`), false for a viewport centre. */
  exact?: boolean;
  /** Human-readable place name taken from the `/maps/place/<name>/` path segment. */
  name?: string;
  /** Places API place id (`ChIJ...`). */
  placeId?: string;
  /** Feature id in `0x...:0x...` form, found in the `!1s` data token or `ftid=`. */
  ftid?: string;
  /** Free-text search query (`/maps/search/<text>` or `?q=<text>`). */
  query?: string;
}

const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl", "g.co"];
const MAPS_HOST = /(^|\.)google\.[a-z.]+$|^maps\.google\./i;

export function isGoogleMapsUrl(text: string): boolean {
  const url = tryUrl(text);
  if (!url) return false;
  if (SHORT_HOSTS.includes(url.hostname)) return true;
  return MAPS_HOST.test(url.hostname) && url.pathname.startsWith("/maps");
}

export function isShortMapsUrl(text: string): boolean {
  const url = tryUrl(text);
  return !!url && SHORT_HOSTS.includes(url.hostname);
}

const COORD = "(-?\\d{1,3}(?:\\.\\d+)?)";
const LATLNG_PAIR = new RegExp(`^\\s*${COORD}\\s*,\\s*\\+?${COORD}\\s*$`);

export function parseGoogleMapsUrl(text: string): ParsedMapsUrl | null {
  const url = tryUrl(text.trim());
  if (!url) return null;
  if (SHORT_HOSTS.includes(url.hostname)) return { isShort: true };
  if (!MAPS_HOST.test(url.hostname)) return null;

  const out: ParsedMapsUrl = { isShort: false };
  const path = decodeURIComponent(url.pathname);
  const params = url.searchParams;

  // Exact place coordinates live in the data blob as !3d<lat>!4d<lng>.
  // The @lat,lng in the path is the viewport center, so it is only a fallback.
  const exact = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url.href);
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(path);
  if (exact) {
    out.lat = Number(exact[1]);
    out.lng = Number(exact[2]);
    out.exact = true;
  } else if (at) {
    out.lat = Number(at[1]);
    out.lng = Number(at[2]);
  }

  const ftid = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(url.href) ?? /(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(params.get("ftid") ?? "");
  if (ftid) out.ftid = ftid[1];

  const placeId =
    params.get("query_place_id") ??
    params.get("place_id") ??
    /place_id:([A-Za-z0-9_-]+)/.exec(params.get("q") ?? "")?.[1] ??
    /!1s(ChIJ[A-Za-z0-9_-]+)/.exec(url.href)?.[1];
  if (placeId) out.placeId = placeId;

  const place = /\/maps\/place\/([^/@]+)/.exec(path);
  if (place) out.name = cleanSegment(place[1]);

  const search = /\/maps\/(?:search|dir)\/([^/@]+)/.exec(path);
  const q = params.get("q") ?? params.get("query") ?? params.get("ll") ?? params.get("destination");
  const searchText = search ? cleanSegment(search[1]) : q ?? undefined;
  if (searchText) {
    const pair = LATLNG_PAIR.exec(searchText);
    if (pair && out.lat === undefined) {
      out.exact = true;
      out.lat = Number(pair[1]);
      out.lng = Number(pair[2]);
    } else if (!pair && !searchText.startsWith("place_id:")) {
      out.query = searchText;
    }
  }

  const cid = params.get("cid");
  if (cid && !out.ftid && /^\d+$/.test(cid)) out.ftid = `0x0:0x${BigInt(cid).toString(16)}`;

  if (out.lat !== undefined && !isValidLatLng(out.lat, out.lng!)) {
    delete out.lat;
    delete out.lng;
  }
  return out;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function cleanSegment(seg: string): string {
  return seg.replace(/\+/g, " ").replace(/\s+/g, " ").trim();
}

function tryUrl(text: string): URL | null {
  try {
    const t = text.trim();
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
}


/** Recover a Maps destination after requestUrl follows a short link's redirect.
 * Only read URLs from the response; never execute Google's page scripts or use
 * the map's viewport as an invented place pin.
 */
export function mapsUrlFromHtml(html: string): string | null {
  const decoded = html.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\//g, "/").replace(/&amp;/g, "&").replace(/&quot;|&#34;/g, '"').replace(/&#39;/g, "'");
  // Prefer explicit destination metadata. Other Maps links in a page can be
  // related places, so they must never become the imported stop's pin.
  const canonical = [...decoded.matchAll(/<(?:link|meta)\b[^>]*>/gi)]
    .filter(([tag]) => /(?:rel\s*=\s*["']canonical["']|property\s*=\s*["']og:url["'])/i.test(tag))
    .map(([tag]) => /(?:href|content)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1])
    .filter((url): url is string => !!url);
  const continuation = [...decoded.matchAll(/[?&]continue=(https?(?::\/\/|%3a%2f%2f)[^\s"'<>\\]+)/gi)].map((m) => m[1]);
  const urls = canonical.length ? canonical : continuation;
  let best: { url: string; score: number } | null = null;
  for (const raw of urls) {
    const variants = [raw];
    try { variants.push(decodeURIComponent(raw)); } catch { /* Keep an otherwise usable URL. */ }
    for (const candidate of variants) {
      let parsed: ParsedMapsUrl | null;
      try { parsed = parseGoogleMapsUrl(candidate); } catch { continue; }
      if (!isGoogleMapsUrl(candidate) || !parsed || parsed.isShort) continue;
      const score = parsed.exact && parsed.lat !== undefined ? 4 : parsed.placeId ? 3 : parsed.name && parsed.lat !== undefined ? 2 : parsed.name ? 1 : 0;
      if (score && (!best || score > best.score)) best = { url: candidate, score };
    }
  }
  return best?.url ?? null;
}
