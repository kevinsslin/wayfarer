import { describe, expect, it } from "vitest";
import { editorGeoLink, matchesGeoStop, plainLinkClick } from "./geo-link-follow";
import { parseItinerary } from "./itinerary";

const plain = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

describe("geo link activation", () => {
  it("accepts an ordinary primary click or tap", () => expect(plainLinkClick(plain)).toBe(true));
  it.each([{ button: 1 }, { button: 2 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }])("preserves native activation for %j", (patch) => {
    expect(plainLinkClick({ ...plain, ...patch })).toBe(false);
  });

  it("resolves the link label and URL to the same original source span", () => {
    const note = "## 2027-01-01\n- [Cafe](geo:35,139)";
    expect(editorGeoLink(note, 1, 4, "Trip.md")).toEqual(editorGeoLink(note, 1, 13, "Trip.md"));
    expect(editorGeoLink(note, 1, 4, "Trip.md")).toEqual({ path: "Trip.md", line: 1, from: 2, lat: 35, lng: 139 });
  });

  it("does not capture a Google helper or another external link", () => {
    const note = "- [Cafe](geo:35,139) [🗺️](https://www.google.com/maps?q=35,139) [Info](https://example.com)";
    expect(editorGeoLink(note, 0, note.indexOf("🗺️"), "Trip.md")).toBeNull();
    expect(editorGeoLink(note, 0, note.indexOf("Info"), "Trip.md")).toBeNull();
  });

  it.each(["`[Cafe](geo:35,139)`", "%% [Cafe](geo:35,139) %%", "```md\n[Cafe](geo:35,139)\n```", "---\nexample: '[Cafe](geo:35,139)'\n---"]) ("ignores examples in code, comments and frontmatter: %s", (note) => {
    const lines = note.split("\n");
    lines.forEach((line, i) => expect(editorGeoLink(note, i, line.indexOf("Cafe"), "Trip.md")).toBeNull());
  });

  it("retains the exact occurrence when coordinates repeat", () => {
    const note = "## 2027-01-01\n[Hotel](geo:35,139)\n## 2027-01-02\n[Hotel](geo:35,139)";
    const target = editorGeoLink(note, 3, 3, "Trip.md")!;
    const plan = parseItinerary(note);
    expect(matchesGeoStop(plan.stops[0], target)).toBe(false);
    expect(matchesGeoStop(plan.stops[1], target)).toBe(true);
    expect(matchesGeoStop({ ...plan.stops[1], line: 4 }, target)).toBe(false);
    expect(matchesGeoStop({ ...plan.stops[1], lng: 140 }, target)).toBe(false);
  });

  it("keeps independently imported Google stops external", () => {
    const note = '[Cafe](https://www.google.com/maps/place/Cafe) %%wf:{"lat":35,"lng":139,"locationUrl":"https://www.google.com/maps/place/Cafe"}%%';
    expect(editorGeoLink(note, 0, 3, "Trip.md")).toBeNull();
  });

  it("distinguishes two geo links on one line and rejects text outside them", () => {
    const note = "[A](geo:35,139) then [B](geo:36,140)";
    expect(editorGeoLink(note, 0, note.indexOf("B"), "Trip.md")?.lat).toBe(36);
    expect(editorGeoLink(note, 0, note.indexOf("then"), "Trip.md")).toBeNull();
    expect(editorGeoLink(note, 9, 0, "Trip.md")).toBeNull();
  });
});
