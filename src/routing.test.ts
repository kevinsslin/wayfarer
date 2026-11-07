import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseItinerary, type Stop, type LegMeta } from "./core/itinerary";
import { LegRouter, dateForDay } from "./routing";
import { GoogleApiError, googleRoute } from "./net";
import type { WayfarerSettings } from "./settings";

vi.mock("./net", () => ({
  GoogleApiError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  googleRoute: vi.fn(),
}));
const route = { distanceM: 1000, durationS: 600, geometry: [[35, 139], [35.1, 139.1]] as [number, number][] };
const day = (date = "2027-01-01", time = "08:00") => parseItinerary(`## ${date}\n- ${time} [A](geo:35,139)\n- 🚆 [B](geo:35.1,139.1)`).days[0];
const many = () => parseItinerary("## 2027-01-01\n" + Array.from({ length: 10 }, (_, i) => `- 🚶 [P${i}](geo:${35 + i * 0.01},139)`).join("\n")).days[0];

beforeEach(() => { vi.mocked(googleRoute).mockReset(); });

describe("LegRouter", () => {
  const settings = () => ({ googleApiKey: "test-key", languageCode: "en" }) as WayfarerSettings;

  it("separates departures and reuses only an identical query", async () => {
    vi.mocked(googleRoute).mockResolvedValue(route);
    const update = vi.fn();
    const routed = vi.fn<(to: Stop, leg: LegMeta, file: string) => void>();
    const router = new LegRouter(settings, update, routed);
    for (const d of [day(), day("2027-01-02"), day("2027-01-02", "20:00")]) {
      router.legsFor(d, dateForDay(d), "trip.md");
      await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(vi.mocked(googleRoute).mock.calls.length));
    }
    expect(googleRoute).toHaveBeenCalledTimes(3);
    expect(new Set(vi.mocked(googleRoute).mock.calls.map((args) => args[5]?.toISOString())).size).toBe(3);
    const d = day();
    expect(router.legsFor(d, dateForDay(d), "other.md")[0].routed).toBe(true);
    expect(googleRoute).toHaveBeenCalledTimes(3);
    const saved = { ...d.stops[1], meta: { leg: routed.mock.calls[0][1] } };
    expect(router.legsFor({ ...d, stops: [d.stops[0], saved] }, dateForDay(d))[0].routed).toBe(true);
    expect(googleRoute).toHaveBeenCalledTimes(3);
    router.dispose();
  });

  it("shares a concurrency limit across days and deduplicates redraws", async () => {
    const releases: Array<() => void> = [];
    vi.mocked(googleRoute).mockImplementation(() => new Promise((resolve) => releases.push(() => resolve(route))));
    const router = new LegRouter(settings, vi.fn());
    const d = many();
    router.legsFor(d, dateForDay(d));
    router.legsFor(d, dateForDay(d));
    router.legsFor(day(), new Date(2027, 0, 1));
    expect(googleRoute).toHaveBeenCalledTimes(3);
    releases.shift()!();
    await vi.waitFor(() => expect(googleRoute).toHaveBeenCalledTimes(4));
    router.dispose();
    releases.forEach((release) => release());
  });

  it("drops queued requests after a refusal and permits a corrected key", async () => {
    vi.mocked(googleRoute).mockRejectedValue(new GoogleApiError(403, "refused"));
    let key = "bad-key";
    const router = new LegRouter(() => ({ ...settings(), googleApiKey: key }), vi.fn());
    const d = many();
    router.legsFor(d, dateForDay(d));
    await vi.waitFor(() => expect(vi.mocked(googleRoute).mock.settledResults).toHaveLength(3));
    router.legsFor(d, dateForDay(d));
    expect(googleRoute).toHaveBeenCalledTimes(3);
    key = "corrected-key";
    vi.mocked(googleRoute).mockResolvedValue(route);
    router.legsFor(d, dateForDay(d));
    expect(googleRoute).toHaveBeenCalledTimes(6);
    router.dispose();
  });

  it("suppresses active results and callbacks after unload", async () => {
    const releases: Array<() => void> = [];
    vi.mocked(googleRoute).mockImplementation(() => new Promise((resolve) => releases.push(() => resolve(route))));
    const update = vi.fn(), routed = vi.fn();
    const router = new LegRouter(settings, update, routed);
    const d = many();
    router.legsFor(d, dateForDay(d));
    router.dispose();
    releases.forEach((release) => release());
    await Promise.resolve();
    await Promise.resolve();
    router.legsFor(d, dateForDay(d));
    expect(googleRoute).toHaveBeenCalledTimes(3);
    expect(update).not.toHaveBeenCalled();
    expect(routed).not.toHaveBeenCalled();
  });

  it("discards queued work and results when the API key is removed", async () => {
    let key = "old-key";
    const releases: Array<() => void> = [];
    vi.mocked(googleRoute).mockImplementation(() => new Promise((resolve) => releases.push(() => resolve(route))));
    const routed = vi.fn();
    const router = new LegRouter(() => ({ ...settings(), googleApiKey: key }), vi.fn(), routed);
    const d = many();
    router.legsFor(d, dateForDay(d));
    key = "";
    releases.forEach((release) => release());
    await Promise.resolve();
    await Promise.resolve();
    expect(googleRoute).toHaveBeenCalledTimes(3);
    expect(routed).not.toHaveBeenCalled();
    router.dispose();
  });

});
