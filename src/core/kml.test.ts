import { describe, expect, it } from "vitest";
import { formatStop, parseItinerary } from "./itinerary";
import { tripKml } from "./kml";

describe("tripKml", () => {
  const it2 = parseItinerary(`# Japan 2026
## 2026-09-17 週四 上山
1. 07:53 🚌 [湯滝](geo:36.7938,139.4316) 看瀑布
    早點到
2. [赤沼 <b>](geo:36.7754,139.4432) %%wf:{"via":"walk","address":"栃木県"}%%
## 2026-09-18 下山
- [東武日光站](geo:36.7509,139.6187)
`);
  const kml = tripKml(it2, "Japan 2026");
  it("names the document after the note and makes one folder per day", () => {
    expect(kml).toContain("<name>Japan 2026</name>");
    expect(kml.match(/<Folder>/g)).toHaveLength(2);
    expect(kml).toContain("<name>2026-09-17 週四 上山</name>");
  });
  it("writes numbered placemarks with lng,lat and the notes", () => {
    expect(kml).toContain("<name>1. 07:53 🏞️ 湯滝</name>");
    expect(kml).toContain("<coordinates>139.4316,36.7938,0</coordinates>");
    expect(kml).toContain("🚌 湯滝 看瀑布\n早點到\nhttps://www.google.com/maps/search/?api=1&amp;query=36.7938,139.4316");
    expect(kml).toContain("赤沼 &lt;b&gt;");
    expect(kml).toContain("栃木県");
  });
  it("is deterministic", () => {
    expect(tripKml(it2, "Japan 2026")).toBe(kml);
  });
});


it("exports the original store link alongside the stop's coordinates", () => {
  const url = "https://www.google.com/maps/search/?api=1&query=Cafe&query_place_id=ChIJcafe";
  const note = "## 2027-01-01\n- " + formatStop("Cafe", 35, 139, undefined, undefined, url);
  const result = tripKml(parseItinerary(note), "Trip");
  expect(result).toContain(url.replace(/&/g, "&amp;"));
  expect(result).toContain("<coordinates>139,35,0</coordinates>");
});
