import { beforeAll, describe, expect, it } from "vitest";
import { setLocale } from "./i18n";
import { parseItinerary } from "./itinerary";
import { bareLeg, coordKey, decodePolyline, encodePolyline, finishLeg, formatDuration, haversineM, legMetaFor, legText, minutesOf, shortWayLng, simplifyLine } from "./legs";

beforeAll(() => setLocale("zh-TW"));

const it2 = parseItinerary(`## 9/17
1. 07:53 [湯滝](geo:36.7938,139.4316)
2. 08:10 🚶 [赤沼](geo:36.7754,139.4432)
3. [中禪寺湖](geo:36.7345,139.4823) %%wf:{"via":"bus"}%%
4. [福岡機場](geo:33.5859,130.4507)
`);
const [yudaki, akanuma, chuzenji, fuk] = it2.stops;

describe("legs", () => {
  it("measures distance", () => {
    expect(Math.round(haversineM(yudaki, akanuma) / 100)).toBe(23);
  });
  it("knows the mode only when the user said so", () => {
    expect(bareLeg(yudaki, akanuma).mode).toBe("walk");
    expect(akanuma.emoji).toBeUndefined();
    expect(bareLeg(akanuma, chuzenji).mode).toBe("bus");
    expect(bareLeg(chuzenji, fuk).mode).toBeUndefined();
  });
  it("has no duration and no lateness until routed", () => {
    const leg = bareLeg(yudaki, akanuma);
    expect(leg.durationS).toBeUndefined();
    expect(leg.lateBy).toBe(0);
    const routed = finishLeg({ ...leg, durationS: 34 * 60, routed: true, source: "google" });
    expect(routed.lateBy).toBe(17);
  });
  it("formats", () => {
    expect(minutesOf("07:53")).toBe(473);
    expect(minutesOf(undefined)).toBeNull();
    expect(formatDuration(59 * 60)).toBe("59 分");
    expect(formatDuration(125 * 60)).toBe("2 時 5 分");
    expect(legText(bareLeg(yudaki, akanuma))).toBe("2.3 km");
  });
  it("uses a saved route only for the same previous stop and mode", () => {
    const saved = parseItinerary(`## 2026-09-17
1. [湯滝](geo:36.7938,139.4316)
2. [赤沼](geo:36.7754,139.4432) %%wf:{"via":"bus","leg":{"from":"36.7938,139.4316","to":"36.7754,139.4432","departure":"test-departure","via":"bus","s":900,"m":4100,"line":"日光 2 號"}}%%
3. [中禪寺湖](geo:36.7345,139.4823) %%wf:{"via":"bus","leg":{"from":"0,0","via":"bus","s":900,"m":4100}}%%
`).stops;
    const ok = bareLeg(saved[0], saved[1], "test-departure");
    expect(ok).toMatchObject({ routed: true, durationS: 900, distanceM: 4100, summary: "日光 2 號", source: "google" });
    const stale = bareLeg(saved[1], saved[2]);
    expect(stale.routed).toBe(false);
    expect(stale.durationS).toBeUndefined();
    expect(legMetaFor(saved[0], saved[1], { durationS: 899.6, distanceM: 4100.4, summary: "X" }, "bus")).toEqual({ from: coordKey(saved[0]), to: coordKey(saved[1]), via: "bus", s: 900, m: 4100, line: "X" });
    expect(legMetaFor(saved[0], saved[1], { durationS: undefined, distanceM: 1 }, "bus")).toBeNull();
  });
  it("decodes a polyline", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });
});

describe("shortWayLng", () => {
  it("crosses the antimeridian when that is shorter", () => {
    expect(shortWayLng(139.77, -122.38)).toBeCloseTo(237.62);
    expect(shortWayLng(-122.38, 139.77)).toBeCloseTo(-220.23);
    expect(shortWayLng(121.55, 139.77)).toBe(139.77);
  });
});

describe("saved route shape", () => {
  it("encodes what decodePolyline reads back", () => {
    const pts: [number, number][] = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
    expect(encodePolyline(pts)).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });
  it("simplifies a long line to the point budget and keeps the ends", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 200; i++) pts.push([35 + i * 0.001, 139 + Math.sin(i / 7) * 0.002]);
    const out = simplifyLine(pts, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.length).toBeGreaterThan(5);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[200]);
  });
  it("saves the shape on the leg and a later read draws it", () => {
    const from = { name: "A", lat: 35.0, lng: 139.0, line: 1, from: 0, to: 1, beforeFrom: 0, index: 0, dayIndex: 0, category: "other", note: "", notes: [] } as unknown as import("./itinerary").Stop;
    const geometry: [number, number][] = [[35.0, 139.0], [35.01, 139.02], [35.02, 139.05]];
    const dest = { ...from, lat: 35.02, lng: 139.05 };
    const meta = legMetaFor(from, dest, { durationS: 600, distanceM: 5000, geometry }, "bus", "departure");
    expect(meta?.p).toBeTruthy();
    const to = { ...from, name: "B", lat: 35.02, lng: 139.05, line: 2, transport: "bus", meta: { leg: meta } } as unknown as import("./itinerary").Stop;
    const leg = bareLeg(from, to, "departure");
    expect(leg.routed).toBe(true);
    expect(leg.geometry.length).toBe(3);
    expect(leg.geometry[1][0]).toBeCloseTo(35.01, 4);
  });
});


describe("saved route identity", () => {
  const [from, to] = parseItinerary("## 2027-01-01\n- [A](geo:35,139)\n- 🚆 [B](geo:35.1,139.1)").stops;
  const meta = legMetaFor(from, to, { durationS: 600, distanceM: 10000 }, "train", "morning");
  const saved = { ...to, meta: { leg: meta! } };
  it("invalidates changed destination, origin, mode and departure", () => {
    expect(bareLeg(from, saved, "morning").routed).toBe(true);
    expect(bareLeg(from, { ...saved, lat: 36 }, "morning").routed).toBe(false);
    expect(bareLeg({ ...from, lng: 140 }, saved, "morning").routed).toBe(false);
    expect(bareLeg(from, { ...saved, transport: "walk" }, "morning").routed).toBe(false);
    expect(bareLeg(from, saved, "evening").routed).toBe(false);
    expect(bareLeg(from, saved).routed).toBe(false);
  });
  it("reads modern identity through the note serializer", () => {
    const parsed = parseItinerary(`## 2027-01-01\n- [A](geo:35,139)\n- 🚆 [B](geo:35.1,139.1) %%wf:${JSON.stringify({ leg: meta })}%%`).stops;
    expect(bareLeg(parsed[0], parsed[1], "morning").routed).toBe(true);
  });
  it("does not trust legacy routes without a destination", () => {
    const legacy = { ...saved, meta: { leg: { ...meta!, to: undefined } } };
    expect(bareLeg(from, legacy, "morning").routed).toBe(false);
  });
});
