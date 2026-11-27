import { describe, expect, it } from "vitest";
import { dayAtLine, formatStop, parseItinerary, stopStillAt } from "./itinerary";
import { nextStop, stopRef, resolveStop } from "./journey";

const options = { maxHeadingLevel: 3, overviewHeadingLevel: 2 };
const trip = `# Sri Lanka
## 2026-12-26 Colombo
- [Hotel Colombo](geo:6.93,79.86)
### 2026-12-26 Colombo excursions
- 09:00 [Airport](geo:7.18,79.88)
- 🚗 [City](geo:6.94,79.85)
## 2026-12-27 - 2026-12-28 Negombo
- 🚗 [Hotel Negombo](geo:7.21,79.84)
### 2026-12-27 Mangroves
- [Market](geo:7.20,79.85)
- 🚌 [Mangroves](geo:7.23,79.86)
### 2026-12-28 Beach
- [Hotel Negombo](geo:7.21,79.84)
- 🚶 [Beach](geo:7.22,79.83)`;

describe("optional trip overview", () => {
  it("keeps parent pins separate from the original daily routes", () => {
    const plan = parseItinerary(trip, options);
    expect(plan.days).toHaveLength(3);
    expect(plan.stops.map((s) => s.name)).toEqual(["Airport", "City", "Market", "Mangroves", "Hotel Negombo", "Beach"]);
    expect(plan.overview?.stops.map((s) => s.name)).toEqual(["Hotel Colombo", "Hotel Negombo"]);
    expect(plan.overview?.stops.every((s) => s.overview)).toBe(true);
    expect(plan.stops.every((s) => !s.overview)).toBe(true);
    expect(nextStop(plan, plan.days[0].stops[1])).toBe(plan.days[1].stops[0]);
  });

  it("retains source lines, offsets, times, transport, notes and metadata", () => {
    const pin = formatStop("Hotel $&", 6.930001, 79.860002, { rating: 4.5, address: "Colombo" });
    const markdown = `## 2026-12-26 Colombo\n- 18:00 🚗 🏨 ${pin} check in\n    Bring passport\n### 2026-12-26 Day\n- [Airport](geo:7.18,79.88)`;
    const stop = parseItinerary(markdown, options).overview!.stops[0];
    expect(stop).toMatchObject({ line: 1, time: "18:00", transport: "car", emoji: "🏨", notes: ["Bring passport"], lat: 6.930001, lng: 79.860002, meta: { rating: 4.5 } });
    const line = markdown.split("\n")[stop.line];
    expect(line.slice(stop.from, stop.to)).toBe("[Hotel $&](geo:6.930001,79.860002)");
    expect(stopStillAt(line, stop)).toBe(true);
    expect(stopStillAt(line.replace("6.930001", "6.930002"), stop)).toBe(false);
  });

  it("closes daily scope at parent headings and preserves the parent range for drilldown", () => {
    const plan = parseItinerary(trip, options);
    const parentLine = trip.split("\n").findIndex((l) => l.startsWith("## 2026-12-27"));
    expect(plan.days[0].endLine).toBe(parentLine);
    expect(dayAtLine(plan, parentLine)).toBe(-1);
    expect(dayAtLine(plan.overview!, parentLine)).toBe(1);
    const stages = plan.overview!.days;
    expect(stages[0].endLine).toBe(parentLine);
    expect(plan.days.filter((d) => d.headingLine > stages[1].headingLine && d.headingLine < stages[1].endLine)).toHaveLength(2);
  });

  it("preserves dates, ranges and document order without duplicating overnight stays", () => {
    const plan = parseItinerary(trip, options);
    expect(plan.overview!.days[1]).toMatchObject({ date: { year: 2026, month: 12, day: 27 }, dateEnd: { year: 2026, month: 12, day: 28 }, label: "12/27~12/28" });
    expect(plan.days[2]).toMatchObject({ date: { year: 2026, month: 12, day: 28 }, dateEnd: null });
    const reversed = parseItinerary("## 2027-01-02 Second\n[A](geo:1,2)\n## 2027-01-01 First\n[B](geo:3,4)", options);
    expect(reversed.overview!.stops.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("retains repeated places on distinct stages and resolves selection within that layer", () => {
    const plan = parseItinerary("## 2027-01-01\n[Hotel](geo:1,2)\n## 2027-01-03\n[Hotel](geo:1,2)", options).overview!;
    expect(plan.stops).toHaveLength(2);
    expect(plan.stops.map((s) => s.dayIndex)).toEqual([0, 1]);
    expect(resolveStop(plan, stopRef(plan, plan.stops[1]))).toBe(plan.stops[1]);
  });

  it("allows ungrouped days and stages without daily stops or their own pins", () => {
    const plan = parseItinerary("### 2027-01-01\n[A](geo:1,2)\n## 2027-01-02 Only stage\n[B](geo:3,4)\n## 2027-01-03 Only day\n### 2027-01-03\n[C](geo:5,6)", options);
    expect(plan.stops.map((s) => s.name)).toEqual(["A", "C"]);
    expect(plan.overview!.stops.map((s) => s.name)).toEqual(["B"]);
    expect(parseItinerary("## 2027-01-01\n[A](geo:1,2)", options).stops).toEqual([]);
  });

  it("excludes child research from parent pins and retains subheadings within a day", () => {
    const plan = parseItinerary("## 2027-01-01\n[A](geo:1,2)\n#### Research\n[B](geo:3,4)\n### 2027-01-01\n[C](geo:5,6)\n#### Afternoon\n[D](geo:7,8)\n# Other\n[E](geo:9,10)", options);
    expect(plan.overview!.stops.map((s) => s.name)).toEqual(["A"]);
    expect(plan.stops.map((s) => s.name)).toEqual(["C", "D"]);
  });

  it("uses only visible headings and links across both layers", () => {
    const markdown = ["---", "example: '## 2027-01-01'", "---", "## 2027-01-01", "[Hotel](geo:1,2)", "```md", "### 2027-01-02", "[Code](geo:3,4)", "```", "%%", "## 2027-01-03", "[Hidden](geo:5,6)", "%%", "### 2027-01-01", "[Day](geo:7,8)", "`[Example](geo:9,10)`"].join("\n");
    const plan = parseItinerary(markdown, options);
    expect(plan.overview!.stops.map((s) => s.name)).toEqual(["Hotel"]);
    expect(plan.stops.map((s) => s.name)).toEqual(["Day"]);
    expect(plan.stops[0].line).toBe(14);
  });

  it("keeps undated research out of each dated layer", () => {
    const plan = parseItinerary("## Research\n[A](geo:1,2)\n### To do\n[B](geo:3,4)\n## 2027-01-01\n[C](geo:5,6)\n### 2027-01-01\n[D](geo:7,8)\n### Candidates\n[E](geo:9,10)", options);
    expect(plan.overview!.stops.map((s) => s.name)).toEqual(["C"]);
    expect(plan.stops.map((s) => s.name)).toEqual(["D"]);
  });

  it("allows dated city stages with undated excursion headings", () => {
    const plan = parseItinerary("## Colombo - 2026-12-27\n[Colombo](geo:6.93,79.86)\n### Arrival\n[Airport](geo:7.18,79.88)\n## Negombo - 2026-12-28 - 2026-12-30\n[Negombo](geo:7.21,79.84)\n### Beach\n[Beach](geo:7.22,79.83)\n### Mangroves\n[Mangroves](geo:7.23,79.85)", options);
    expect(plan.overview!.days.map((d) => [d.date?.day, d.dateEnd?.day])).toEqual([[27, undefined], [28, 30]]);
    expect(plan.stops.map((s) => s.name)).toEqual(["Airport", "Beach", "Mangroves"]);
    expect(plan.days.every((d) => !d.date && !d.dateEnd)).toBe(true);
  });

  it("allows undated city stages with dated daily plans", () => {
    const plan = parseItinerary("## Colombo\n[Colombo](geo:6.93,79.86)\n### Arrival - 2026-12-27\n[Airport](geo:7.18,79.88)\n## Negombo\n[Negombo](geo:7.21,79.84)\n### 2026-12-28\n[Beach](geo:7.22,79.83)\n### 2026-12-29\n[Mangroves](geo:7.23,79.85)", options);
    expect(plan.overview!.stops.map((s) => s.name)).toEqual(["Colombo", "Negombo"]);
    expect(plan.overview!.days.every((d) => !d.date)).toBe(true);
    expect(plan.days.map((d) => d.date?.day)).toEqual([27, 28, 29]);
  });

  it.each([undefined, 0, 3, 4, -1, 1.5])("retains legacy parsing when overview level is %s", (level) => {
    expect(parseItinerary(trip, { maxHeadingLevel: 3, overviewHeadingLevel: level })).toEqual(parseItinerary(trip, { maxHeadingLevel: 3 }));
    expect(parseItinerary(trip, { maxHeadingLevel: 3, overviewHeadingLevel: level }).overview).toBeUndefined();
  });

  it("supports other heading levels without relying on hotel names", () => {
    const plan = parseItinerary("# 2027-01-01 Coast\n[City](geo:1,2)\n#### 2027-01-01 Walk\n[Park](geo:3,4)", { maxHeadingLevel: 4, overviewHeadingLevel: 1 });
    expect(plan.stops.map((s) => s.name)).toEqual(["Park"]);
    expect(plan.overview!.stops.map((s) => s.name)).toEqual(["City"]);
  });
});
