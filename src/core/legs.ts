import { TRANSIT_MODES, type Transport } from "./category";
import { t } from "./i18n";
import type { LegMeta, Stop } from "./itinerary";

/**
 * One move between consecutive stops of a day. The mode is known only when
 * the user chose it (in the timeline, or by writing a transport emoji before
 * the link); the duration is known only when a router answered for that
 * mode. Nothing here is estimated.
 */
export interface Leg {
  from: Stop;
  to: Stop;
  mode?: Transport;
  /** Straight-line distance until a router supplies the routed one. */
  distanceM: number;
  routed: boolean;
  durationS?: number;
  /** Route geometry when a router supplied one; otherwise the straight line. */
  geometry: [number, number][];
  /** Transit line names, e.g. "東武日光線 → 日光 2 號". */
  summary?: string;
  source?: "google";
  /** Minutes the leg overruns the gap between the two written times; 0 when on time or unknown. */
  lateBy: number;
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * A leg with what the note alone knows: the mode, the straight-line distance,
 * and, when the saved endpoints, mode and transit departure still match,
 * that route's duration, distance and line names. Legacy routes without a
 * destination cannot be validated and are refreshed by the router.
 */
export function bareLeg(from: Stop, to: Stop, departure?: string): Leg {
  const straight: [number, number][] = [[from.lat, from.lng], [to.lat, shortWayLng(from.lng, to.lng)]];
  const saved = to.meta?.leg;
  if (saved && to.transport && saved.via === to.transport && saved.from === coordKey(from) && saved.to === coordKey(to) && (!TRANSIT_MODES.has(to.transport) || (departure !== undefined && saved.departure === departure))) {
    const shape = saved.p ? decodePolyline(saved.p) : [];
    return finishLeg({ from, to, mode: to.transport, distanceM: saved.m, durationS: saved.s, summary: saved.line, routed: true, source: "google", geometry: shape.length >= 2 ? shape : straight });
  }
  return finishLeg({ from, to, mode: to.transport, distanceM: haversineM(from, to), routed: false, geometry: straight });
}

/** Rounded coordinates that identify a stop in saved leg metadata. */
export function coordKey(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
}

/** What to save on the destination stop after a route came back. The shape is kept to at most `maxPoints` points. */
export function legMetaFor(from: Stop, to: Stop, leg: Pick<Leg, "durationS" | "distanceM" | "summary"> & { geometry?: [number, number][] }, via: NonNullable<Stop["transport"]>, departure?: string, maxPoints = 40): LegMeta | null {
  if (leg.durationS === undefined) return null;
  const out: LegMeta = { from: coordKey(from), to: coordKey(to), via, s: Math.round(leg.durationS), m: Math.round(leg.distanceM) };
  if (TRANSIT_MODES.has(via)) out.departure = departure;
  if (leg.summary) out.line = leg.summary;
  if (leg.geometry && leg.geometry.length >= 2) out.p = encodePolyline(simplifyLine(leg.geometry, maxPoints));
  return out;
}

/**
 * Douglas-Peucker, tightened until the line has at most `maxPoints` points.
 * Ends are always kept.
 */
export function simplifyLine(pts: [number, number][], maxPoints: number): [number, number][] {
  if (pts.length <= maxPoints) return pts;
  let tol = 1e-5;
  let out = pts;
  for (let i = 0; i < 40 && out.length > maxPoints; i++, tol *= 1.5) out = douglasPeucker(pts, tol);
  return out.length > maxPoints ? [pts[0], pts[pts.length - 1]] : out;
}

function douglasPeucker(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    let far = -1;
    let farD = 0;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistance(pts[i], pts[a], pts[b]);
      if (d > farD) { farD = d; far = i; }
    }
    if (far >= 0 && farD > tol) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function pointSegmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const x = a[0] + u * dx - p[0];
  const y = a[1] + u * dy - p[1];
  return Math.sqrt(x * x + y * y);
}

/** Google's encoded polyline format, 1e-5 precision; the inverse of decodePolyline. */
export function encodePolyline(pts: [number, number][]): string {
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lat, lng] of pts) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    out += enc(la - prevLat) + enc(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

/** Fills in lateness from the stops' written times, when the duration is known. */
export function finishLeg(leg: Omit<Leg, "lateBy">): Leg {
  const a = minutesOf(leg.from.time);
  const b = minutesOf(leg.to.time);
  let lateBy = 0;
  if (a !== null && b !== null && leg.durationS !== undefined) {
    const gap = (b - a + 1440) % 1440;
    lateBy = Math.max(0, Math.round(leg.durationS / 60 - gap));
  }
  return { ...leg, lateBy };
}

export function minutesOf(time: string | undefined): number | null {
  const m = time && /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Route identity includes transit departure context, as well as mode and endpoints. */
export function legKey(from: Stop, to: Stop, mode: Transport, departure?: string): string {
  const r = (n: number) => n.toFixed(4);
  return `${mode}:${r(from.lat)},${r(from.lng)}>${r(to.lat)},${r(to.lng)}${TRANSIT_MODES.has(mode) ? `:${departure ?? "unspecified"}` : ""}`;
}

export function formatDuration(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return t("min", { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? t("hours_min", { h, m }) : t("hours", { h });
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** Numbers for a leg, without the mode: duration when routed, distance, transit lines. */
export function legText(leg: Leg): string {
  const bits: string[] = [];
  if (leg.durationS !== undefined) bits.push(formatDuration(leg.durationS));
  bits.push(formatDistance(leg.distanceM));
  if (leg.summary) bits.push(leg.summary);
  return bits.join(" · ");
}

/** Decodes a Google encoded polyline into [lat, lng] pairs. */
export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/**
 * The destination longitude shifted by a full turn when that is the shorter
 * way round, so a straight line 羽田 to SFO crosses the Pacific instead of
 * being drawn the long way over Eurasia.
 */
export function shortWayLng(fromLng: number, toLng: number): number {
  const d = toLng - fromLng;
  if (d > 180) return toLng - 360;
  if (d < -180) return toLng + 360;
  return toLng;
}
