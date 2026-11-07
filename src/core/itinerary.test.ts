import { describe, expect, it } from "vitest";
import { dayAtLine, dayDateEnd, dayLabel, formatStop, moveBlock, parseItinerary, parseMeta, patchLineMeta, setTransportOnLine, stopStillAt } from "./itinerary";

const NOTE = `---
locations:
---
# 日本 2026

[羽田](geo:35.5494,139.7798) 先到

## 9/16 週三 日光市區

搭 19:19 的車。
- [東武日光站](geo:36.7509,139.6187)
- [日光ステーションホテル](geo:36.7512,139.6201) %%wf:{"rating":4.1,"hours":["Monday: Open 24 hours"]}%%

## 9/17 週四 上山

\`\`\`
[not a stop](geo:1,2)
\`\`\`
1. [湯滝](geo:36.7938,139.4316)
2. [赤沼](geo:36.7754,139.4432) 然後 [中禪寺湖](geo:36.7358,139.4685)

### 補充（三級標題不分天）
[華嚴瀑布](geo:36.7383,139.5031)

## 沒有地點的一天
只有文字。
`;

describe("parseItinerary", () => {
  const it_ = parseItinerary(NOTE);

  it("groups stops under ## headings and keeps document order", () => {
    expect(it_.days.map((d) => d.title)).toEqual(["", "9/16 週三 日光市區", "9/17 週四 上山"]);
    expect(it_.days[1].stops.map((s) => s.name)).toEqual(["東武日光站", "日光ステーションホテル"]);
    expect(it_.days[2].stops.map((s) => s.name)).toEqual(["湯滝", "赤沼", "中禪寺湖", "華嚴瀑布"]);
  });
  it("drops days without stops and numbers the remaining ones", () => {
    expect(it_.days.map((d) => d.index)).toEqual([0, 1, 2]);
    expect(it_.stops.map((s) => s.dayIndex)).toEqual([0, 1, 1, 2, 2, 2, 2]);
    expect(it_.days[2].stops.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });
  it("skips fenced code and frontmatter", () => {
    expect(it_.stops.some((s) => s.name === "not a stop")).toBe(false);
  });
  it("parses metadata", () => {
    const hotel = it_.days[1].stops[1];
    expect(hotel.meta).toEqual({ rating: 4.1, hours: ["Monday: Open 24 hours"] });
    expect(it_.days[1].stops[0].meta).toBeUndefined();
  });
  it("records positions so the map can jump back into the note", () => {
    const akanuma = it_.days[2].stops[1];
    const lines = NOTE.split("\n");
    expect(lines[akanuma.line].slice(akanuma.from, akanuma.to)).toBe("[赤沼](geo:36.7754,139.4432)");
  });
  it("labels days from dates in the heading", () => {
    expect(it_.days[1].label).toBe("9/16");
    expect(it_.days[0].label).toBe("");
  });
  it("maps a cursor line to its day", () => {
    const lines = NOTE.split("\n");
    const line = lines.findIndex((l) => l.includes("搭 19:19"));
    expect(dayAtLine(it_, line)).toBe(1);
    expect(dayAtLine(it_, lines.findIndex((l) => l.includes("華嚴")))).toBe(2);
    expect(dayAtLine(it_, lines.findIndex((l) => l.includes("只有文字")))).toBe(-1);
  });
  it("honours a different heading level", () => {
    const one = parseItinerary(NOTE, { maxHeadingLevel: 1 });
    expect(one.days.length).toBe(1);
    expect(one.days[0].stops.length).toBe(7);
  });
});

describe("dayLabel", () => {
  it("handles the common date spellings", () => {
    expect(dayLabel("2026-09-17 Thu")).toBe("9/17");
    expect(dayLabel("9月17日 上山")).toBe("9/17");
    expect(dayLabel("Sep 17, hike")).toBe("9/17");
    expect(dayLabel("Day 3: Kyoto")).toBe("D3");
    expect(dayLabel("Arrival")).toBe("Arrival");
  });
  it("labels a range heading with both ends", () => {
    expect(dayLabel("2026-09-19 ~ 2026-09-26 東京")).toBe("9/19~9/26");
    expect(dayLabel("2026-09-19～2026-09-26")).toBe("9/19~9/26");
    expect(dayLabel("2026-09-19 to 2026-09-26")).toBe("9/19~9/26");
  });
});

describe("dayDateEnd", () => {
  it("reads the end of a range and rejects a backwards or missing one", () => {
    expect(dayDateEnd("2026-09-19 ~ 2026-09-26 東京")).toEqual({ year: 2026, month: 9, day: 26 });
    expect(dayDateEnd("2026-09-19 到 2026-10-02")).toEqual({ year: 2026, month: 10, day: 2 });
    expect(dayDateEnd("2026-09-26 ~ 2026-09-19")).toBeNull();
    expect(dayDateEnd("2026-09-19 週六")).toBeNull();
    expect(dayDateEnd("2026-09-19 ~ 2026-02-30")).toBeNull();
  });
  it("a range is one block whose weekday is unknown", () => {
    const it = parseItinerary("## 2026-09-19 ~ 2026-09-26 東京\n- [A](geo:35.68,139.76)\n");
    expect(it.days[0].date).toEqual({ year: 2026, month: 9, day: 19 });
    expect(it.days[0].dateEnd).toEqual({ year: 2026, month: 9, day: 26 });
    expect(it.days[0].label).toBe("9/19~9/26");
  });
  it("only a full date is a date", () => {
    expect(parseItinerary("## 2026-09-17 週四\n- [A](geo:1,2)").days[0].date).toEqual({ year: 2026, month: 9, day: 17 });
    expect(parseItinerary("## 9/17 週四\n- [A](geo:1,2)").days[0].date).toBeNull();
    expect(parseItinerary("## 2026-02-30\n- [A](geo:1,2)").days[0].date).toBeNull();
  });
});

describe("formatStop", () => {
  it("round-trips through the parser", () => {
    const text = formatStop("千光寺 [本堂]", 34.40891234567, 133.20445678, { rating: 4.55, hours: ["Mon: 9–17"], website: "https://x" });
    expect(text).toBe('[千光寺 本堂](geo:34.408912,133.204457) %%wf:{"rating":4.6,"hours":["Mon: 9–17"],"website":"https://x"}%%');
    const parsed = parseItinerary(text);
    expect(parsed.stops[0]).toMatchObject({ name: "千光寺 本堂", lat: 34.408912, lng: 133.204457 });
    expect(parsed.stops[0].meta?.rating).toBe(4.6);
  });
  it("omits empty metadata", () => {
    expect(formatStop("A", 1, 2, {})).toBe("[A](geo:1,2)");
  });
});

describe("meta placement and day headings", () => {
  it("reads meta anywhere after the link and patches it", () => {
    const it2 = parseItinerary(`## 9/17\n- 走到 [赤沼](geo:1,2) 備註 %%wf:{"via":"bus"}%%`);
    const st = it2.stops[0];
    expect(st.transport).toBe("bus");
    const patched = patchLineMeta(`- [赤沼](geo:1,2) 備註`, { via: "walk" });
    expect(patched).toBe(`- [赤沼](geo:1,2) %%wf:{"via":"walk"}%% 備註`);
    expect(patchLineMeta(patched, { via: undefined })).toBe(`- [赤沼](geo:1,2) 備註`);
    expect(patchLineMeta(`    - [赤沼](geo:1,2)  兩個空格 %%wf:{"via":"bus"}%%`, { via: "walk" })).toBe(`    - [赤沼](geo:1,2)  兩個空格 %%wf:{"via":"walk"}%%`);
    expect(patchLineMeta(`- [赤沼](geo:1,2) %%wf:{"rating":4.4}%%`, { via: "train" })).toBe(`- [赤沼](geo:1,2) %%wf:{"rating":4.4,"via":"train"}%%`);
  });
  it("treats only the configured level as days when it exists", () => {
    const it2 = parseItinerary(`# Trip\n[A](geo:1,1)\n## 9/16\n[B](geo:2,2)\n## 9/17\n[C](geo:3,3)`);
    expect(it2.days.map((d) => d.title)).toEqual(["", "9/16", "9/17"]);
    const single = parseItinerary(`# 9/16\n[B](geo:2,2)\n# 9/17\n[C](geo:3,3)`);
    expect(single.days.map((d) => d.title)).toEqual(["9/16", "9/17"]);
  });
});

describe("continuation lines", () => {
  it("collects indented lines under a stop as its notes, skipping image-only lines", () => {
    const it2 = parseItinerary(`## 9/27
- 🚌 [中洲屋台](geo:33.5930,130.4062) 晚上才熱鬧
    上船前先買玉米
    ![[nakasu.jpg]]
    - 船 40 分一班
- [根津神社](geo:35.7203,139.7610)`);
    const [yatai, nezu] = it2.stops;
    expect(yatai.notes).toEqual(["上船前先買玉米", "船 40 分一班"]);
    expect(yatai.image).toBe("nakasu.jpg");
    expect(yatai.transport).toBe("bus");
    expect(yatai.emoji).toBeUndefined();
    expect(nezu.notes).toEqual([]);
  });
});

describe("setTransportOnLine", () => {
  const stopOf = (md: string, i = 0) => parseItinerary(`## 2026-09-17\n${md}\n`).days[0].stops[i];
  it("replaces the transport emoji already before the link", () => {
    const line = "- 12:52 🚌 [中禅寺温泉](geo:36.7389,139.4995) 下山";
    expect(setTransportOnLine(line, stopOf(line), "walk")).toBe("- 12:52 🚶 [中禅寺温泉](geo:36.7389,139.4995) 下山");
  });
  it("inserts one before the link when there is none and keeps a category emoji", () => {
    const line = "- ⛩️ [根津神社](geo:35.72,139.7607) 例大祭";
    expect(setTransportOnLine(line, stopOf(line), "metro")).toBe("- ⛩️ 🚇 [根津神社](geo:35.72,139.7607) 例大祭");
  });
  it("only touches the segment before its own link", () => {
    const line = "- 🚆 [A](geo:1,2) 到 🚌 [B](geo:3,4)";
    expect(setTransportOnLine(line, stopOf(line, 1), "taxi")).toBe("- 🚆 [A](geo:1,2) 到 🚕 [B](geo:3,4)");
  });
  it("drops a legacy via so the text is the only source", () => {
    const line = `- [A](geo:1,2) %%wf:{"via":"bus","rating":4.1}%%`;
    expect(setTransportOnLine(line, stopOf(line), "walk")).toBe(`- 🚶 [A](geo:1,2) %%wf:{"rating":4.1}%%`);
  });
  it("drops a route saved for another mode and keeps one for the same mode", () => {
    const line = `- 🚌 [A](geo:1,2) %%wf:{"leg":{"from":"1.0000,2.0000","via":"bus","s":600,"m":3000}}%%`;
    expect(setTransportOnLine(line, stopOf(line), "walk")).toBe("- 🚶 [A](geo:1,2)");
    expect(setTransportOnLine(line, stopOf(line), "bus")).toBe(line);
  });
  it("the emoji wins over an older via when both are present", () => {
    expect(stopOf(`- 🚶 [A](geo:1,2) %%wf:{"via":"bus"}%%`).transport).toBe("walk");
  });
});

describe("undated sections beside dated days", () => {
  it("are notes, not days on the map", () => {
    const md = "## 2026-09-17 上山\n- [A](geo:1,2)\n## 候選\n- [B](geo:3,4)\n## 待辦\n- [ ] 訂房\n";
    const it = parseItinerary(md);
    expect(it.days.map((d) => d.title)).toEqual(["2026-09-17 上山"]);
    expect(it.stops.map((s) => s.name)).toEqual(["A"]);
  });
  it("stay days when the note has no dates at all", () => {
    const it = parseItinerary("## Day 1\n- [A](geo:1,2)\n## Day 2\n- [B](geo:3,4)\n");
    expect(it.days.length).toBe(2);
  });
});

describe("moveBlock", () => {
  const lines = ["## d", "- A", "    a1", "- B", "- C", "    c1", "    c2", "- D"];
  it("moves a stop with its notes up before the target", () => {
    expect(moveBlock(lines, 4, 1)).toEqual(["## d", "- C", "    c1", "    c2", "- A", "    a1", "- B", "- D"]);
  });
  it("moves a stop with its notes down after the target's block", () => {
    expect(moveBlock(lines, 1, 4)).toEqual(["## d", "- B", "- C", "    c1", "    c2", "- A", "    a1", "- D"]);
  });
  it("moves to the very end", () => {
    expect(moveBlock(lines, 3, 7)).toEqual(["## d", "- A", "    a1", "- C", "    c1", "    c2", "- D", "- B"]);
  });
  it("leaves the lines alone for a no-op or bad index", () => {
    expect(moveBlock(lines, 3, 3)).toBe(lines);
    expect(moveBlock(lines, 3, 99)).toBe(lines);
  });
});

describe("two stops on one line", () => {
  const line = '- [A](geo:1,2) %%wf:{"rating":4}%% 到 🚌 [B](geo:3,4)';
  it("patches the comment of the stop it was given", () => {
    const [a, b] = parseItinerary(`## 2026-09-16\n${line}`).stops;
    const outB = patchLineMeta(line, { placeId: "B_ID" }, b);
    expect(outB).toBe('- [A](geo:1,2) %%wf:{"rating":4}%% 到 🚌 [B](geo:3,4) %%wf:{"placeId":"B_ID"}%%');
    const outA = patchLineMeta(line, { placeId: "A_ID" }, a);
    expect(outA).toBe('- [A](geo:1,2) %%wf:{"rating":4,"placeId":"A_ID"}%% 到 🚌 [B](geo:3,4)');
    const again = parseItinerary(`## 2026-09-16\n${outB}`).stops;
    expect(again[0].meta?.placeId).toBeUndefined();
    expect(again[1].meta?.placeId).toBe("B_ID");
  });
  it("does not read an emoji inside the previous stop's saved address as transport", () => {
    const l = '- [A](geo:1,2) %%wf:{"address":"🚆 駅前"}%% [B](geo:3,4)';
    const [, b] = parseItinerary(`## 2026-09-16\n${l}`).stops;
    expect(b.transport).toBeUndefined();
    expect(setTransportOnLine(l, b, "walk")).toBe('- [A](geo:1,2) %%wf:{"address":"🚆 駅前"}%% 🚶 [B](geo:3,4)');
  });
  it("knows whether a stop's link is still at its offsets", () => {
    const [a, b] = parseItinerary(`## 2026-09-16\n${line}`).stops;
    expect(stopStillAt(line, a)).toBe(true);
    expect(stopStillAt(line, b)).toBe(true);
    expect(stopStillAt("- x " + line, b)).toBe(false);
    expect(stopStillAt(line.replace("geo:3,4", "geo:3,5"), b)).toBe(false);
  });
});

describe("time at line start", () => {
  const timeOf = (l: string) => parseItinerary(`## 2026-09-16\n${l}`).stops[0].time;
  it("is read after an emoji with a variation selector, a joined sequence or a task box", () => {
    expect(timeOf("- ⛩️ 12:52 [A](geo:1,2)")).toBe("12:52");
    expect(timeOf("- 🚶‍♀️ 12:52 [A](geo:1,2)")).toBe("12:52");
    expect(timeOf("- [ ] 12:52 [A](geo:1,2)")).toBe("12:52");
    expect(parseItinerary("## 2026-09-16\n- [ ] 12:52 [A](geo:1,2) 帶傘").stops[0].note).toBe("12:52 A 帶傘");
  });
});

describe("what is not a stop", () => {
  it("ignores headings inside fences when choosing the day level", () => {
    const it = parseItinerary("# Day 1\n- [A](geo:1,2)\n```\n## example\n```\n# Day 2\n- [B](geo:3,4)");
    expect(it.days.map((d) => d.title)).toEqual(["Day 1", "Day 2"]);
  });
  it("ignores links inside Obsidian comments", () => {
    const it = parseItinerary("## 2026-09-16\n- [A](geo:1,2)\n%%\n- [B](geo:3,4)\n%%\n- [C](geo:5,6) %% [D](geo:7,8) %%");
    expect(it.stops.map((s) => s.name)).toEqual(["A", "C"]);
  });
  it("keeps an indented geo link under a stop as that stop's note", () => {
    const it = parseItinerary("## 2026-09-16\n- [A](geo:1,2)\n    備案 [B](geo:3,4)\n- [C](geo:5,6)");
    expect(it.stops.map((s) => s.name)).toEqual(["A", "C"]);
    expect(it.stops[0].notes).toEqual(["備案 [B](geo:3,4)"]);
  });
  it("keeps the place's UTC offset when it is a whole number of minutes", () => {
    expect(parseMeta('{"utc":540}')).toEqual({ utc: 540 });
    expect(parseMeta('{"utc":"540"}')).toEqual({});
  });
});

describe("parseMeta", () => {
  it("drops values of the wrong type instead of throwing later", () => {
    expect(parseMeta('{"rating":"4.5","hours":"Mon","address":"x","leg":{"from":"1,2","via":"bus","s":"9","m":1}}')).toEqual({ address: "x" });
    expect(parseMeta("[1]")).toBeUndefined();
    expect(parseMeta("nope")).toBeUndefined();
  });
});

describe("moveBlock onto its own notes", () => {
  it("does nothing", () => {
    const lines = ["## d", "- [A](geo:1,2)", "    note 1", "    note 2", "- [B](geo:3,4)"];
    expect(moveBlock(lines, 1, 2)).toEqual(lines);
    expect(moveBlock(lines, 1, 3)).toEqual(lines);
  });
});

describe("fences and comments in heading discovery", () => {
  it("keeps a triple fence inside a four-backtick fence hidden", () => {
    const it = parseItinerary("## 2026-09-16\n- [A](geo:1,2)\n````\n```\n- [B](geo:3,4)\n```\n````\n- [C](geo:5,6)");
    expect(it.stops.map((s) => s.name)).toEqual(["A", "C"]);
  });
  it("does not let a commented-out heading pick the day level", () => {
    const it = parseItinerary("# Day 1\n- [A](geo:1,2)\n%%\n## hidden\n%%\n# Day 2\n- [B](geo:3,4)");
    expect(it.days.map((d) => d.title)).toEqual(["Day 1", "Day 2"]);
  });
  it("only accepts a known transport in metadata", () => {
    expect(parseMeta('{"via":"walking"}')).toEqual({});
    expect(parseMeta('{"via":"walk","leg":{"from":"1,2","via":"driving","s":1,"m":2}}')).toEqual({ via: "walk" });
  });
});


describe("retained Google Maps links", () => {
  const url = "https://www.google.com/maps/place/Cafe/@35,139,17z";
  it("round-trips the actual clickable URL, facts, notes and transport", () => {
    const text = formatStop("Cafe", 35, 139, { placeId: "ChIJcafe", rating: 4.6 }, undefined, url);
    expect(text).toContain(`[Cafe](${url})`);
    expect(text).not.toContain("geo:");
    const stop = parseItinerary(`## 2027-01-01\n- 10:00 🚶 ${text} coffee\n    Bring cash`).stops[0];
    expect(stop).toMatchObject({ name: "Cafe", url, lat: 35, lng: 139, time: "10:00", transport: "walk", notes: ["Bring cash"], meta: { placeId: "ChIJcafe", rating: 4.6 } });
    expect(stopStillAt(`- ${text}`, { ...stop, from: 2, to: 2 + `[Cafe](${url})`.length })).toBe(true);
  });
  it("keeps per-stop metadata separate on mixed Google and geo link lines", () => {
    const first = formatStop("Cafe", 35, 139, { placeId: "CAFE" }, undefined, url);
    const line = `- ${first} 🚆 [Station](geo:36,140) %%wf:{"placeId":"STATION"}%%`;
    const [a, b] = parseItinerary(line).stops;
    expect(a.meta?.placeId).toBe("CAFE");
    expect(b.meta?.placeId).toBe("STATION");
    const changed = setTransportOnLine(line, a, "bus");
    expect(parseItinerary(changed).stops[0]).toMatchObject({ url, transport: "bus", lat: 35, lng: 139 });
    expect(parseItinerary(patchLineMeta(line, { rating: 4.9 }, b)).stops[0].meta?.rating).toBeUndefined();
    expect(stopStillAt(line.replace("Cafe/@", "Shop/@"), a)).toBe(false);
  });
  it("requires valid saved coordinates and ignores unconverted or unrelated links", () => {
    expect(parseItinerary(`[Cafe](${url})`).stops).toHaveLength(0);
    expect(parseItinerary(`[Cafe](${url}) %%wf:{"lat":91,"lng":139}%%`).stops).toHaveLength(0);
    expect(parseItinerary('[Site](https://example.com) %%wf:{"lat":35,"lng":139}%%').stops).toHaveLength(0);
  });
  it("encodes parentheses without changing which place the link identifies", () => {
    const target = "https://www.google.com/maps/place/Cafe+(Annex)/@35,139,17z";
    const text = formatStop("Cafe (Annex)", 35, 139, undefined, undefined, target);
    const stop = parseItinerary(text).stops[0];
    expect(stop.name).toBe("Cafe (Annex)");
    expect(decodeURI(stop.url!)).toBe(target);
    expect(stop.lat).toBe(35);
  });
});


it("patches a stop's metadata after an unrelated website link", () => {
  const line = '- [A](geo:35,139) [website](https://example.com) %%wf:{"rating":4.2}%%';
  const stop = parseItinerary(line).stops[0];
  const result = patchLineMeta(line, { placeId: "ChIJcafe" }, stop);
  expect(result.match(/%%wf:/g)).toHaveLength(1);
  expect(parseItinerary(result).stops[0].meta).toMatchObject({ rating: 4.2, placeId: "ChIJcafe" });
});

it("reads an imported short link from saved coordinates without expanding it again", () => {
  const url = "https://maps.app.goo.gl/originalCafe";
  const text = formatStop("Cafe", 35, 139, undefined, undefined, url);
  expect(parseItinerary(text).stops[0]).toMatchObject({ url, lat: 35, lng: 139 });
});


it("invalidates saved coordinates when the original href is edited", () => {
  const original = "https://www.google.com/maps/place/Cafe/@35,139,17z";
  const changed = "https://www.google.com/maps/place/Shop/@35,139,17z";
  const text = formatStop("Cafe", 35, 139, undefined, undefined, original);
  expect(parseItinerary(text.replace(`[Cafe](${original})`, `[Cafe](${changed})`)).stops).toHaveLength(0);
});
