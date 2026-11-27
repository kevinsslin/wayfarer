import type { PlaceMeta, Stop } from "./core/itinerary";
import { distanceM } from "./core/resolve";
import { GoogleApiError, googlePlaces } from "./net";
import type { WayfarerSettings } from "./settings";

/** Only Google place facts, never the note's coordinates, source, transport or route. */
export function placeFacts(meta: PlaceMeta): PlaceMeta {
  const { rating, hours, address, website, placeId, type, photo, utc } = meta;
  return { rating, hours, address, website, placeId, type, photo, utc };
}

interface Entry {
  meta?: PlaceMeta;
  pending?: Promise<PlaceMeta | null>;
  retryAt?: number;
}

/** Session-only place details. Redraws only read; the explicit command requests or refreshes them. */
export class PlaceDetailsCache {
  private entries = new Map<string, Entry>();
  private context = "";
  private generation = 0;
  private disposed = false;

  constructor(private settings: () => Pick<WayfarerSettings, "googleApiKey" | "languageCode">) {}

  key(stop: Stop): string {
    const s = this.settings();
    const context = JSON.stringify([s.googleApiKey, s.languageCode]);
    if (context !== this.context) {
      this.entries.clear();
      this.generation++;
      this.context = context;
    }
    // Stable on reorder/reparse, separate when a name/query, exact pin or source changes.
    return JSON.stringify([stop.lat, stop.lng, stop.googleUrl ?? stop.url ?? "", stop.name]);
  }

  get(stop: Stop): PlaceMeta | undefined {
    return this.entries.get(this.key(stop))?.meta;
  }

  remember(stop: Stop, meta: PlaceMeta): void {
    if (!this.disposed) this.entries.set(this.key(stop), { meta: placeFacts(meta) });
  }

  fetch(stop: Stop, refresh = false): Promise<PlaceMeta | null> {
    const key = this.key(stop);
    const old = this.entries.get(key);
    if (old?.pending) return old.pending;
    if (this.disposed || !this.settings().googleApiKey || (old?.retryAt ?? 0) > Date.now()) return Promise.resolve(null);
    if (old?.meta && !refresh) return Promise.resolve(old.meta);
    const generation = this.generation;
    const { googleApiKey, languageCode } = this.settings();
    const current = () => {
      this.key(stop); // Detect a credential/language change even without a redraw.
      return !this.disposed && this.generation === generation;
    };
    const entry: Entry = { meta: old?.meta };
    const pending = googlePlaces(googleApiKey, languageCode).searchText(stop.name, stop).then((place) => {
      if (!current()) return null;
      if (!place?.meta || distanceM(place, stop) > 300) {
        entry.retryAt = Date.now() + 60_000;
        return null;
      }
      entry.meta = placeFacts(place.meta);
      return entry.meta;
    }).catch((e: unknown) => {
      if (!current()) return null;
      entry.retryAt = Date.now() + (e instanceof GoogleApiError ? e.status === 429 ? 60_000 : 10 * 60_000 : 30_000);
      throw e;
    }).finally(() => { if (entry.pending === pending) entry.pending = undefined; });
    entry.pending = pending;
    this.entries.set(key, entry);
    return pending;
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.entries.clear();
  }
}
