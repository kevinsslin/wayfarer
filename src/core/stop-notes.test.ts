import { describe, expect, it } from "vitest";
import { formatStop, parseItinerary, stopNotes, stopStillAt } from "./itinerary";

const link = "[Fortress](geo:7.95694,80.75972)";

describe("card descriptions without a repeated leading place label", () => {
  it.each([
    [`- ${link}`, []],
    [`- 🏯 ${link}`, []],
    [`- 🚶 🏯 ${link}`, []],
    [`- 09:00 ${link}`, []],
    [`- 09:00 🏯 ${link}`, []],
    [`- 09:00 🚶 🏯 ${link}`, []],
    [`- ${link} Visit the gardens`, ["Visit the gardens"]],
    [`- 09:00 🚶 🏯 ${link} Visit the gardens`, ["Visit the gardens"]],
    [`- 🚶‍♂️ 🏯 ${link} Visit the gardens`, ["Visit the gardens"]],
    [`- 🚶🏽 🏯 ${link} Visit the gardens`, ["Visit the gardens"]],
    ["- [🏯 Fortress](geo:7.95694,80.75972)", []],
    ["- [**Fortress**](geo:7.95694,80.75972) Visit the gardens", ["Visit the gardens"]],
  ])("renders %s", (line, expected) => {
    const stop = parseItinerary(line).stops[0];
    expect(stopNotes(stop, true)).toEqual(expected);
  });

  it("retains indented notes and their order without changing the parsed line", () => {
    const text = `- 09:00 🚶 🏯 ${link} Visit the gardens\n    Bring water\n    Keep the afternoon free`;
    const stop = parseItinerary(text).stops[0];
    const before = JSON.stringify(stop);
    expect(stopNotes(stop, true)).toEqual(["Visit the gardens", "Bring water", "Keep the afternoon free"]);
    expect(JSON.stringify(stop)).toBe(before);
    expect(stopStillAt(text.split("\n")[0], stop)).toBe(true);
  });

  it("preserves prose before a place and references to other places", () => {
    const text = "- From [Hotel](geo:1,2) to [Fortress](geo:3,4), bring water";
    const stop = parseItinerary(text).stops[1];
    expect(stopNotes(stop, true)).toEqual(["From Hotel to Fortress, bring water"]);
  });

  it("removes the leading label once and retains later genuine mentions", () => {
    const stop = parseItinerary(`- ${link} Fortress tickets at the gate`).stops[0];
    expect(stopNotes(stop, true)).toEqual(["Fortress tickets at the gate"]);
  });

  it("does not remove a name that is only the prefix of another word", () => {
    const stop = parseItinerary("- [Fort](geo:1,2)ress tour").stops[0];
    expect(stopNotes(stop, true)).toEqual(["Fortress tour"]);
  });

  it("keeps emoji and times that belong to the description", () => {
    const stop = parseItinerary(`- 09:00 🏯 ${link} ☕ Coffee after 09:00`).stops[0];
    expect(stopNotes(stop, true)).toEqual(["☕ Coffee after 09:00"]);
  });

  it("handles literal place names and imported Google stops without changing their metadata", () => {
    const url = "https://www.google.com/maps/place/Cafe/data=!3d35!4d139";
    const place = formatStop("Café $& (Altstadt)", 35, 139, { rating: 4.5 }, undefined, url);
    const line = `- ${place} Coffee and cake`;
    const stop = parseItinerary(line).stops[0];
    expect(stopNotes(stop, true)).toEqual(["Coffee and cake"]);
    expect(stop.meta).toMatchObject({ rating: 4.5, locationUrl: url });
    expect(stopStillAt(line, stop)).toBe(true);
  });

  it("keeps the original prose for consumers such as KML export", () => {
    const stop = parseItinerary(`- 09:00 🚶 🏯 ${link} Visit the gardens`).stops[0];
    expect(stopNotes(stop)).toEqual(["🚶 🏯 Fortress Visit the gardens"]);
  });

  it("omits the place link after arbitrary prefix text, as in the reported card", () => {
    const text = "- 🚗 gg [Galle Fort](geo:6.026,80.217)\n    Eine Basis für Altstadt und Strand";
    const stop = parseItinerary(text).stops[0];
    expect(stopNotes(stop, true)).toEqual(["gg", "Eine Basis für Altstadt und Strand"]);
    expect(stopNotes(stop)).toEqual(["gg Galle Fort", "Eine Basis für Altstadt und Strand"]);
    expect(stopStillAt(text.split("\n")[0], stop)).toBe(true);
  });

  it.each([
    [`- Meet at ${link} before lunch`, ["Meet at before lunch"]],
    [`- 09:00 🚶 🏯 Optional: ${link} Visit the gardens`, ["Optional: Visit the gardens"]],
    [`- Fortress before ${link} Fortress afterwards`, ["Fortress before Fortress afterwards"]],
    [`- ${link}, bring water`, [", bring water"]],
    [`- ${link}Fortress tickets`, ["FortressFortress tickets"]],
  ])("removes only the standalone place link in %s", (line, expected) => {
    expect(stopNotes(parseItinerary(line).stops[0], true)).toEqual(expected);
  });

  it("handles prefixed imported Google places without losing source metadata", () => {
    const url = "https://www.google.com/maps/place/Cafe/data=!3d35!4d139";
    const place = formatStop("Café $& (Altstadt)", 35, 139, { rating: 4.5 }, undefined, url);
    const line = `- gg ${place} Coffee and cake`;
    const stop = parseItinerary(line).stops[0];
    expect(stopNotes(stop, true)).toEqual(["gg Coffee and cake"]);
    expect(stop.meta).toMatchObject({ rating: 4.5, locationUrl: url });
    expect(stopStillAt(line, stop)).toBe(true);
  });
});
