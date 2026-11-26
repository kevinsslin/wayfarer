import { describe, expect, it } from "vitest";
import { formatStop, moveBlockAt, parseItinerary, patchLineMeta, plainNote, setTransportOnLine, stopLinks, stopStillAt } from "./itinerary";
import { navigateUrl, placeUrl } from "./gmaps-out";

const url = "https://maps.app.goo.gl/original";
const pair = `[Cafe](geo:35,139) ([Google Maps](${url}))`;

describe("geo stops with a Google source", () => {
  it("reads one stop without metadata, uses the original source and omits the helper from prose", () => {
    const [stop] = parseItinerary(`- 09:00 🚶 🍜 ${pair} book ahead\n    Bring cash`).stops;
    expect(parseItinerary(pair).stops).toHaveLength(1);
    expect(stop).toMatchObject({ name: "Cafe", lat: 35, lng: 139, googleUrl: url, time: "09:00", transport: "walk", emoji: "🍜", notes: ["Bring cash"] });
    expect(stop.url).toBeUndefined();
    expect(stop.note).toBe("09:00 🚶 🍜 Cafe book ahead");
    expect(placeUrl(stop)).toBe(url);
    expect(new URL(navigateUrl(stop)).searchParams.get("destination")).toBe("35,139");
  });

  it("associates facts before each helper with its own geo stop", () => {
    const a = formatStop("Cafe", 35, 139, { rating: 4.5, placeId: "cafe" });
    const b = formatStop("Park", 36, 140, { rating: 4.1 });
    const line = `${a} ([Karte](${url})) then ${b} ([地圖](https://maps.app.goo.gl/park))`;
    const [first, second] = parseItinerary(line).stops;
    expect(first).toMatchObject({ googleUrl: url, meta: { rating: 4.5, placeId: "cafe" } });
    expect(second).toMatchObject({ googleUrl: "https://maps.app.goo.gl/park", meta: { rating: 4.1 } });
    expect(plainNote(line)).toBe("Cafe then Park");
    const updated = patchLineMeta(line, { address: "Park address" }, second);
    expect(parseItinerary(updated).stops[0].meta?.address).toBeUndefined();
    expect(parseItinerary(updated).stops[1].meta?.address).toBe("Park address");
  });

  it("does not guess across prose, a newline, an intervening link or several sources in parentheses", () => {
    for (const line of [
      `[A](geo:1,2) visit ([Maps](${url}))`,
      `[A](geo:1,2)\n([Maps](${url}))`,
      `[A](geo:1,2) [web](https://example.com) ([Maps](${url}))`,
      `[A](geo:1,2) ([Maps](${url}) [Other](https://maps.app.goo.gl/other))`,
    ]) expect(stopLinks(line)[0].googleUrl).toBeUndefined();
    expect(stopLinks(`[A](geo:1,2) ([Other](https://example.com))`)[0].googleUrl).toBeUndefined();
  });

  it("keeps helpers with moved blocks and rejects late writes after a source edit", () => {
    const note = `- ${pair}\n    Bring cash\n- [Park](geo:36,140)`;
    const [before] = parseItinerary(note).stops;
    const moved = moveBlockAt(note.split("\n"), 0, 2)!;
    const after = parseItinerary(moved.lines.join("\n")).stops[1];
    expect(after.googleUrl).toBe(url);
    expect(after.notes).toEqual(["Bring cash"]);
    expect(stopStillAt(note.split("\n")[0], before)).toBe(true);
    expect(stopStillAt(note.split("\n")[0].replace("/original", "/changed"), before)).toBe(false);
    expect(setTransportOnLine(`- ${pair}`, before, "bike")).toContain(pair);
  });
});
