import { describe, expect, it } from "vitest";
import { DEFAULT_MAP_SOURCE, mapSourcesFrom, pickMapSource } from "./map-sources";

describe("map source settings", () => {
  it("keeps the previous default for a new installation", () => {
    expect(mapSourcesFrom(undefined, undefined, undefined)).toEqual([DEFAULT_MAP_SOURCE]);
  });

  it("migrates a custom URL and attribution verbatim, without duplicating on reload", () => {
    const url = "https://private.example.com/style/{z}/{x}/{y}.png?key=a%2Bb&user=custom";
    const credit = 'Own map & <a href="https://example.com">provider</a>';
    const sources = mapSourcesFrom(undefined, url, credit);
    expect(sources[0]).toMatchObject({ url, attribution: credit, name: "Custom map", maxZoom: 19 });
    const again = mapSourcesFrom(sources, url, credit);
    expect(again).toEqual(sources);
    expect(mapSourcesFrom(again, url, credit)).toEqual(again);
    expect(again).toHaveLength(1);
    expect(again[0]).not.toBe(sources[0]);
  });

  it.each([null, false, 123, "invalid", {}, [], [null, 1, {}]])("recovers malformed sources %j using the old custom map", (value) => {
    const sources = mapSourcesFrom(value, "http://192.168.1.3/{z}/{x}/{y}.png", "Local tiles");
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("http://192.168.1.3/{z}/{x}/{y}.png");
    expect(sources[0].attribution).toBe("Local tiles");
  });

  it("retains invalid templates for repair rather than losing their keys", () => {
    expect(mapSourcesFrom([{ id: "x", name: "Needs repair", url: "https://host/{bad}?key=KEEP" }], null, null)[0].url)
      .toBe("https://host/{bad}?key=KEEP");
  });

  it("retains source order and resolves missing/duplicate IDs deterministically", () => {
    const value = [
      { ...DEFAULT_MAP_SOURCE, id: "same", name: "Z" },
      { ...DEFAULT_MAP_SOURCE, id: "same", name: "A" },
      { url: "https://local/{z}/{x}/{y}.png" },
    ];
    const result = mapSourcesFrom(value, null, null);
    expect(result.map((s) => s.name)).toEqual(["Z", "A", "Map 3"]);
    expect(new Set(result.map((s) => s.id)).size).toBe(3);
    expect(mapSourcesFrom(result, null, null)).toEqual(result);
  });

  it("normalizes corrupt zoom ranges without affecting valid limits", () => {
    const result = mapSourcesFrom([
      { ...DEFAULT_MAP_SOURCE, minZoom: 8, maxZoom: 4 },
      { ...DEFAULT_MAP_SOURCE, id: "b", minZoom: -1, maxZoom: Number.NaN },
      { ...DEFAULT_MAP_SOURCE, id: "c", minZoom: 0, maxZoom: 0 },
      { ...DEFAULT_MAP_SOURCE, id: "d", minZoom: 3, maxZoom: 22 },
    ], null, null);
    expect(result.map((s) => [s.minZoom, s.maxZoom])).toEqual([[4, 4], [0, 19], [0, 0], [3, 22]]);
  });

  it("keeps optional provider subdomains without sharing mutable settings", () => {
    const raw = [{ ...DEFAULT_MAP_SOURCE, subdomains: ["maps1", "maps2"] }];
    const result = mapSourcesFrom(raw, null, null);
    expect(result[0].subdomains).toEqual(["maps1", "maps2"]);
    result[0].subdomains?.push("maps3");
    expect(raw[0].subdomains).toEqual(["maps1", "maps2"]);
    expect(mapSourcesFrom([{ ...DEFAULT_MAP_SOURCE, subdomains: "1,2,3" }], null, null)[0].subdomains).toEqual(["1", "2", "3"]);
  });
});

describe("map source selection", () => {
  const sources = [{ ...DEFAULT_MAP_SOURCE, id: "street" }, { ...DEFAULT_MAP_SOURCE, id: "satellite" }];
  it("prefers a valid pane/device selection to the shared default", () => {
    expect(pickMapSource(sources, "street", "satellite").id).toBe("satellite");
  });
  it("uses the configured default after removing a selected source", () => {
    expect(pickMapSource(sources, "satellite", "deleted").id).toBe("satellite");
    expect(pickMapSource(sources, "deleted", { malformed: true }).id).toBe("street");
  });
  it("always has a fallback for an empty configuration", () => {
    expect(pickMapSource([], "missing", null)).toEqual(DEFAULT_MAP_SOURCE);
  });
});
