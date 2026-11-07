import { TRANSIT_MODES, type Transport } from "./core/category";
import type { Day, Stop } from "./core/itinerary";
import { bareLeg, finishLeg, legKey, legMetaFor, type Leg } from "./core/legs";
import type { LegMeta } from "./core/itinerary";
import { GoogleApiError, googleRoute } from "./net";
import type { WayfarerSettings } from "./settings";

/**
 * Turns a day's stops into legs. Answers synchronously with what is known
 * (distance, and cached routes), then asks Google Routes for legs whose mode
 * the user has chosen and calls `onUpdate` as results arrive so the pane
 * redraws. Without a Google key nothing is fetched: a leg is its distance.
 */
interface RouteRequest {
  from: Stop;
  to: Stop;
  mode: Transport;
  key: string;
  departure?: Date;
  context?: string;
  file: string;
  apiKey: string;
  languageCode: string;
}

export class LegRouter {
  private cache = new Map<string, Pick<Leg, "distanceM" | "durationS" | "geometry" | "summary" | "source"> | null>();
  /** Includes queued requests, so repeated legs and redraws cannot enqueue duplicates. */
  private inflight = new Set<string>();
  private queue: RouteRequest[] = [];
  private running = 0;
  private disposed = false;
  private pausedUntil = 0;
  private pausedKey = "";
  private written = new Set<string>();

  constructor(
    private settings: () => WayfarerSettings,
    private onUpdate: () => void,
    private onRouted?: (to: Stop, leg: LegMeta, file: string) => void,
    private onError?: (e: GoogleApiError) => void,
  ) {}

  legsFor(day: Day, dayDate: Date | null, file = ""): Leg[] {
    const settings = this.settings();
    const legs: Leg[] = [];
    for (let i = 1; i < day.stops.length; i++) {
      const from = day.stops[i - 1];
      const to = day.stops[i];
      const context = transitContext(dayDate, from, to);
      const leg = bareLeg(from, to, context);
      if (this.disposed || (leg.routed && to.meta?.leg?.p) || !leg.mode || !routable(leg.mode) || !settings.googleApiKey) {
        legs.push(leg);
        continue;
      }
      const key = `${settings.languageCode}:${legKey(from, to, leg.mode, context)}`;
      const hit = this.cache.get(key);
      if (hit) {
        legs.push(finishLeg({ ...leg, ...hit, routed: true }));
        const meta = legMetaFor(from, to, hit, leg.mode, context);
        const writeKey = `${file}:${to.line}:${to.from}:${key}`;
        if (meta && this.onRouted && !sameLeg(to.meta?.leg, meta) && !this.written.has(writeKey)) {
          this.written.add(writeKey);
          this.onRouted(to, meta, file);
        }
      } else {
        legs.push(leg);
        if (hit === undefined && !this.inflight.has(key) && !this.paused()) {
          this.inflight.add(key);
          this.queue.push({ from, to, mode: leg.mode, key, departure: departureFor(dayDate, from, to), context, file, apiKey: settings.googleApiKey, languageCode: settings.languageCode });
        }
      }
    }
    this.drain();
    return legs;
  }

  /** requestUrl cannot abort an active request; discard its result and cancel queued work. */
  dispose(): void {
    this.disposed = true;
    this.dropQueue();
  }

  private dropQueue(): void {
    for (const item of this.queue) this.inflight.delete(item.key);
    this.queue = [];
  }

  private paused(): boolean {
    const key = this.settings().googleApiKey;
    if (key !== this.pausedKey) { this.pausedKey = key; this.pausedUntil = 0; }
    return Date.now() < this.pausedUntil;
  }

  private drain(): void {
    if (this.disposed || this.paused()) { this.dropQueue(); return; }
    // One queue per plugin, shared by every day and map view.
    while (this.running < 3 && this.queue.length) {
      const item = this.queue.shift()!;
      if (!this.currentSettings(item)) { this.inflight.delete(item.key); continue; }
      this.running++;
      void this.fetch(item);
    }
  }

  private currentSettings(item: RouteRequest): boolean {
    const settings = this.settings();
    return item.apiKey === settings.googleApiKey && item.languageCode === settings.languageCode;
  }

  private async fetch(item: RouteRequest): Promise<void> {
    try {
      const r = await googleRoute(item.apiKey, item.languageCode, item.from, item.to, googleMode(item.mode), item.departure);
      if (this.disposed || !this.currentSettings(item)) return;
      this.cache.set(item.key, r ? { ...r, source: "google" } : null);
      if (r) {
        const meta = legMetaFor(item.from, item.to, r, item.mode, item.context);
        if (meta && !sameLeg(item.to.meta?.leg, meta)) this.onRouted?.(item.to, meta, item.file);
        this.onUpdate();
      }
    } catch (e) {
      if (this.disposed || !this.currentSettings(item)) return;
      this.pausedKey = item.apiKey;
      this.pausedUntil = Date.now() + (e instanceof GoogleApiError ? e.status === 429 ? 60_000 : 10 * 60_000 : 30_000);
      this.dropQueue();
      if (e instanceof GoogleApiError) this.onError?.(e);
    } finally {
      this.inflight.delete(item.key);
      this.running--;
      this.drain();
      // A settings refresh may have skipped an identity that was still in flight.
      if (!this.disposed && !this.currentSettings(item)) this.onUpdate();
    }
  }
}

function sameLeg(a: LegMeta | undefined, b: LegMeta): boolean {
  return !!a && a.from === b.from && a.to === b.to && a.departure === b.departure && a.via === b.via && a.s === b.s && a.m === b.m && a.line === b.line && a.p === b.p;
}

/** An undated or untimed transit plan must not borrow another plan's timetable. */
export function transitContext(dayDate: Date | null, from: Stop, to?: Stop): string {
  const departure = departureFor(dayDate, from, to);
  if (departure) return departure.toISOString();
  const date = dayDate ? `${dayDate.getFullYear()}-${dayDate.getMonth() + 1}-${dayDate.getDate()}` : "undated";
  return `${date}:${from.time ?? "untimed"}`;
}

/** Flights and boats have no router; everything else goes to Google Routes. */
export function routable(mode: Transport): boolean {
  return mode !== "flight" && mode !== "boat";
}

function googleMode(mode: Transport): "TRANSIT" | "WALK" | "DRIVE" | "BICYCLE" {
  if (TRANSIT_MODES.has(mode)) return "TRANSIT";
  if (mode === "walk") return "WALK";
  if (mode === "bike") return "BICYCLE";
  return "DRIVE";
}

/**
 * Departure for a transit query: the day's date with the stop's written time,
 * else undefined. A written time is local to the place, so the instant is
 * built with the place's UTC offset (from Google details on either end of the
 * leg, else a guess from the longitude), never the computer's zone.
 */
export function departureFor(dayDate: Date | null, from: Stop, to?: Stop): Date | undefined {
  if (!dayDate || !from.time) return undefined;
  const [h, m] = from.time.split(":").map(Number);
  const offset = from.meta?.utc ?? to?.meta?.utc ?? Math.round(from.lng / 15) * 60;
  return new Date(Date.UTC(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), h, m) - offset * 60_000);
}

/**
 * The calendar date of a day heading, or null when the heading has no full
 * date or spans a range (then the weekday is unknown, so nothing is checked).
 */
export function dateForDay(day: { date: { year: number; month: number; day: number } | null; dateEnd?: { year: number; month: number; day: number } | null }): Date | null {
  return day.date && !day.dateEnd ? new Date(day.date.year, day.date.month - 1, day.date.day) : null;
}
