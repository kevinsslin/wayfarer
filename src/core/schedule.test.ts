import { beforeAll, describe, expect, it } from "vitest";
import { setLocale } from "./i18n";
beforeAll(() => setLocale("zh-TW"));
import { checkHours, fmtMin, parseDayHours } from "./schedule";

describe("hours", () => {
  it("parses english and chinese lines", () => {
    expect(parseDayHours("Monday: 9:00 AM – 5:00 PM").ranges).toEqual([[540, 1020]]);
    expect(parseDayHours("星期一: 09:00 – 17:00, 18:00 – 22:00").ranges).toEqual([[540, 1020], [1080, 1320]]);
    expect(parseDayHours("Tuesday: Closed").closed).toBe(true);
    expect(parseDayHours("Monday: Hours unavailable").unknown).toBe(true);
    expect(checkHours(["Monday: Hours unavailable"], 1, 600)).toBeNull();
    expect(parseDayHours("星期三: 24 小時營業").allDay).toBe(true);
    expect(parseDayHours("Friday: 6:00 PM – 2:00 AM").ranges).toEqual([[1080, 1560]]);
  });
  it("checks arrivals", () => {
    const hours = ["Monday: 9:00 AM – 5:00 PM", "Tuesday: Closed", "Wednesday: 9:00 AM – 5:00 PM", "Thursday: 9:00 AM – 5:00 PM", "Friday: 9:00 AM – 5:00 PM", "Saturday: 9:00 AM – 5:00 PM", "Sunday: 9:00 AM – 5:00 PM"];
    expect(checkHours(hours, 2, 600)).toEqual({ kind: "closed-day" });
    expect(checkHours(hours, 1, 600)).toEqual({ kind: "ok" });
    expect(checkHours(hours, 1, 480)).toEqual({ kind: "not-open-yet", opensAt: 540 });
    expect(checkHours(hours, 1, 1100)).toEqual({ kind: "already-closed", closedAt: 1020 });
    expect(checkHours(hours, 1, undefined)).toBeNull();
  });
  it("formats minutes", () => {
    expect(fmtMin(605)).toBe("10:05");
  });
});

describe("checkHours across midnight", () => {
  const hours = ["Monday: 6:00 PM – 2:00 AM", "Tuesday: Closed", "Wednesday: 9:00 AM – 5:00 PM"];
  it("is open at 01:00 Tuesday because Monday runs past midnight", () => {
    expect(checkHours(hours, 2, 60)).toEqual({ kind: "ok" });
    expect(checkHours(hours, 2, 3 * 60)).toEqual({ kind: "closed-day" });
    expect(checkHours(hours, 3, 8 * 60)).toEqual({ kind: "not-open-yet", opensAt: 9 * 60 });
  });
});


describe("Chinese prefix day periods", () => {
  it("checks morning to afternoon ranges with Google separators", () => {
    for (const separator of ["–", "至", "到"]) {
      const hours = [`星期一: 上午9:00 ${separator} 下午5:00`];
      expect(parseDayHours(hours[0]).ranges).toEqual([[540, 1020]]);
      expect(checkHours(hours, 1, 600)).toEqual({ kind: "ok" });
      expect(checkHours(hours, 1, 1080)).toEqual({ kind: "already-closed", closedAt: 1020 });
    }
  });
  it("handles overnight and split hours", () => {
    expect(parseDayHours("星期一：下午6:00 – 上午2:00").ranges).toEqual([[1080, 1560]]);
    expect(parseDayHours("星期一: 上午9:00 – 上午11:00, 下午1:00 – 下午5:00").ranges).toEqual([[540, 660], [780, 1020]]);
  });
});
