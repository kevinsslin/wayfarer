import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseItinerary } from "./core/itinerary";
import { PlaceDetailsCache } from "./place-details";
import { GoogleApiError, googlePlaces } from "./net";

const searchText = vi.hoisted(() => vi.fn());
vi.mock("./net", () => ({
  GoogleApiError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  googlePlaces: vi.fn(() => ({ searchText })),
}));

const note = "- [Cafe](geo:35,139) ([Maps](https://maps.app.goo.gl/cafe))";
const stop = () => parseItinerary(note).stops[0];
const result = (rating = 4.5) => ({ name: "Cafe", lat: 35, lng: 139, source: "places", meta: { rating, placeId: "cafe", type: "cafe", photo: "places/cafe/photos/1", utc: 540 } });
const settings = () => ({ googleApiKey: "key", languageCode: "en" });

beforeEach(() => { vi.clearAllMocks(); searchText.mockReset(); });

describe("session place details", () => {
  it("deduplicates pending requests and keeps results through reparses and reordering", async () => {
    let release!: (value: ReturnType<typeof result>) => void;
    searchText.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const cache = new PlaceDetailsCache(settings);
    const a = cache.fetch(stop()), b = cache.fetch(stop(), true);
    expect(a).toBe(b);
    expect(searchText).toHaveBeenCalledTimes(1);
    release(result());
    await a;
    const moved = parseItinerary(`- [Other](geo:36,140)\n${note}`).stops[1];
    expect(cache.get(moved)).toMatchObject({ rating: 4.5, photo: "places/cafe/photos/1", utc: 540 });
    await cache.fetch(moved);
    expect(searchText).toHaveBeenCalledTimes(1);
    expect(cache.get({ ...moved, name: "Changed" })).toBeUndefined();
    expect(cache.get({ ...moved, googleUrl: "https://maps.app.goo.gl/other" })).toBeUndefined();
    expect(cache.get({ ...moved, lat: 35.001 })).toBeUndefined();
    expect(new PlaceDetailsCache(settings).get(moved)).toBeUndefined();
  });

  it("only keeps place facts and lets an explicit request refresh them", async () => {
    searchText.mockResolvedValue(result(4.7));
    const cache = new PlaceDetailsCache(settings);
    cache.remember(stop(), { rating: 4.1, lat: 99, lng: 10, locationUrl: "wrong", via: "walk" });
    expect(cache.get(stop())).toMatchObject({ rating: 4.1 });
    expect(cache.get(stop())).not.toHaveProperty("lat");
    expect(cache.get(stop())).not.toHaveProperty("via");
    expect(cache.get(stop())).not.toHaveProperty("locationUrl");
    await cache.fetch(stop(), true);
    expect(cache.get(stop())?.rating).toBe(4.7);
  });

  it("rejects a far-away search result and preserves the stored pin", async () => {
    searchText.mockResolvedValue({ ...result(), lat: 40 });
    const cache = new PlaceDetailsCache(settings);
    const saved = stop();
    expect(await cache.fetch(saved)).toBeNull();
    expect(cache.get(saved)).toBeUndefined();
    expect(saved).toMatchObject({ lat: 35, lng: 139 });
    await cache.fetch(saved, true);
    expect(searchText).toHaveBeenCalledTimes(1);
  });

  it("backs off after offline/API errors and can retry later", async () => {
    let now = 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      for (const [error, delay] of [[new Error("offline"), 30_000], [new GoogleApiError(429, "quota"), 60_000], [new GoogleApiError(403, "denied"), 600_000]] as const) {
        const cache = new PlaceDetailsCache(settings);
        searchText.mockRejectedValueOnce(error);
        await expect(cache.fetch(stop())).rejects.toThrow(error.message);
        const count = searchText.mock.calls.length;
        for (let i = 0; i < 10; i++) expect(await cache.fetch(stop(), true)).toBeNull();
        expect(searchText).toHaveBeenCalledTimes(count);
        now += delay;
        searchText.mockResolvedValueOnce(result());
        expect(await cache.fetch(stop())).toMatchObject({ rating: 4.5 });
      }
    } finally { clock.mockRestore(); }
  });

  it("discards late results after a key/language change or unload", async () => {
    for (const change of ["key", "language", "unload"]) {
      const config = settings();
      const cache = new PlaceDetailsCache(() => config);
      let release!: (value: ReturnType<typeof result>) => void;
      searchText.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      const pending = cache.fetch(stop());
      if (change === "key") config.googleApiKey = "new-key";
      if (change === "language") config.languageCode = "de";
      if (change === "unload") cache.dispose();
      release(result());
      expect(await pending).toBeNull();
      expect(cache.get(stop())).toBeUndefined();
    }
    expect(googlePlaces).toHaveBeenCalled();
  });

  it("does not request places without a key", async () => {
    const cache = new PlaceDetailsCache(() => ({ ...settings(), googleApiKey: "" }));
    expect(await cache.fetch(stop())).toBeNull();
    expect(searchText).not.toHaveBeenCalled();
  });
});
