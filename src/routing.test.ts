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

  it("reuses routing for overview bridges without comparing clocks from different days", async () => {
    vi.mocked(googleRoute).mockResolvedValue({ ...route, durationS: 7200 });
    const plan = parseItinerary("## 2027-01-01\n- 08:00 [A](geo:35,139)\n## 2027-01-05\n- 08:30 🚗 [B](geo:35.1,139.1)", { maxHeadingLevel: 3, overviewHeadingLevel: 2 }).overview!;
    const routed = vi.fn<(to: Stop, leg: LegMeta, file: string) => void>();
    const update = vi.fn();
    const router = new LegRouter(settings, update, routed);
    const from = plan.stops[0], to = plan.stops[1];
    expect(router.overviewLeg(from, plan.days[1], "trip.md")?.routed).toBe(false);
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    const leg = router.overviewLeg(from, plan.days[1], "trip.md")!;
    expect(leg).toMatchObject({ routed: true, durationS: 7200, lateBy: 0 });
    expect(leg.from).toBe(from);
    expect(leg.to).toBe(to);
    expect(from.time).toBe("08:00");
    expect(to.time).toBe("08:30");
    expect(googleRoute).toHaveBeenCalledOnce();
    expect(vi.mocked(googleRoute).mock.calls[0][5]).toBeUndefined();
    expect(routed.mock.calls[0][0]).toMatchObject({ overview: true, line: to.line, from: to.from });
    expect(routed.mock.calls[0][2]).toBe("trip.md");
    router.dispose();
  });

  it("does not invent or reuse an unrelated transit timetable across stages", () => {
    const plan = parseItinerary("## 2027-01-01\n- 08:00 [A](geo:35,139)\n## 2027-01-05\n- 08:30 🚆 [B](geo:35.1,139.1)", { maxHeadingLevel: 3, overviewHeadingLevel: 2 }).overview!;
    plan.stops[1].meta = { leg: { from: "35.0000,139.0000", to: "35.1000,139.1000", via: "train", s: 7200, m: 20000, departure: "undated:untimed" } };
    const router = new LegRouter(settings, vi.fn());
    expect(router.overviewLeg(plan.stops[0], plan.days[1], "trip.md")).toMatchObject({ mode: "train", routed: false, lateBy: 0 });
    expect(googleRoute).not.toHaveBeenCalled();
    router.dispose();
  });

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

  it("drops queued legs of a note the map no longer shows", async () => {
    const releases: Array<() => void> = [];
    vi.mocked(googleRoute).mockImplementation(() => new Promise((resolve) => releases.push(() => resolve(route))));
    const router = new LegRouter(settings, vi.fn());
    const left = many();
    router.legsFor(left, dateForDay(left), "left.md");
    expect(googleRoute).toHaveBeenCalledTimes(3);
    const shown = day();
    router.legsFor(shown, dateForDay(shown), "shown.md");
    releases.shift()!();
    await vi.waitFor(() => expect(googleRoute).toHaveBeenCalledTimes(4));
    // The next request is the shown note's leg, not the left note's fourth.
    expect(vi.mocked(googleRoute).mock.calls[3][3]).toMatchObject({ lat: 35.1, lng: 139.1 });
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
    expect(googleRoute).toHaveBeenCalledTimes(4);
    router.dispose();
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
