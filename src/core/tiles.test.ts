import { describe, expect, it } from "vitest";
import { isValidTileUrl } from "./tiles";

describe("isValidTileUrl", () => {
  it("accepts the usual providers", () => {
    expect(isValidTileUrl("https://tile.openstreetmap.org/{z}/{x}/{y}.png")).toBe(true);
    expect(isValidTileUrl("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png")).toBe(true);
    expect(isValidTileUrl("https://example.com/tms/{z}/{x}/{-y}.png")).toBe(true);
  });
  it("rejects what would stop the map from loading", () => {
    expect(isValidTileUrl("https://[invalid]/{z}/{x}/{y}.png")).toBe(false);
    expect(isValidTileUrl("https://:bad/{z}/{x}/{y}.png")).toBe(false);
    expect(isValidTileUrl("https://tiles.example.com/{z}/{x}/{y}.png?key={apikey}")).toBe(false);
    expect(isValidTileUrl("tile.openstreetmap.org/{z}/{x}/{y}.png")).toBe(false);
    expect(isValidTileUrl("https://tile.openstreetmap.org/{z} /{x}/{y}.png")).toBe(false);
  });
});
