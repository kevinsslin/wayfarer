import { t } from "./i18n";

/** Minutes from midnight of a written "HH:MM", formatted back. */
export function fmtMin(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}

/* ---------- opening hours ---------- */

export interface DayHours {
  /** No recognisable hours on the line (e.g. "Hours unavailable"): nothing can be checked. */
  unknown?: boolean;
  closed: boolean;
  allDay: boolean;
  /** [open, close] in minutes; close may exceed 1440 for past-midnight closing. */
  ranges: [number, number][];
}

const WEEKDAY_WORDS: string[][] = [
  ["sunday", "星期日", "週日", "周日", "日曜日", "sun"],
  ["monday", "星期一", "週一", "周一", "月曜日", "mon"],
  ["tuesday", "星期二", "週二", "周二", "火曜日", "tue"],
  ["wednesday", "星期三", "週三", "周三", "水曜日", "wed"],
  ["thursday", "星期四", "週四", "周四", "木曜日", "thu"],
  ["friday", "星期五", "週五", "周五", "金曜日", "fri"],
  ["saturday", "星期六", "週六", "周六", "土曜日", "sat"],
];

/** Finds the weekdayDescriptions line for a weekday (0 = Sunday). */
export function hoursForWeekday(hours: string[] | undefined, weekday: number): string | null {
  if (!hours?.length) return null;
  const words = WEEKDAY_WORDS[weekday];
  return hours.find((h) => words.some((w) => h.toLowerCase().startsWith(w))) ?? hours[(weekday + 6) % 7] ?? null;
}

/** Parses "Monday: 9:00 AM – 5:00 PM", "星期一: 09:00 – 17:00, 18:00 – 22:00", "Closed", "Open 24 hours". */
export function parseDayHours(desc: string): DayHours {
  const body = desc.replace(/^[^:：]*[:：]\s*/, "").trim()
    // Google uses prefix day periods in Chinese, suffix periods in English.
    .replace(/(上午|下午)\s*(\d{1,2}(?::\d{2})?)/g, "$2 $1");
  const lower = body.toLowerCase();
  if (!body || /closed|休息|休業|定休|公休|休み/.test(lower)) return { closed: true, allDay: false, ranges: [] };
  if (/24\s*hours|24\s*小時|24\s*時間|營業 24/.test(lower)) return { closed: false, allDay: true, ranges: [[0, 1440]] };
  const ranges: [number, number][] = [];
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|上午|下午)?\s*(?:[–—-]|至|到)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|上午|下午)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const open = toMin(m[1], m[2], m[3] ?? m[6]);
    let close = toMin(m[4], m[5], m[6]);
    if (close <= open) close += 1440;
    ranges.push([open, close]);
  }
  if (ranges.length === 0) return { unknown: true, closed: false, allDay: false, ranges };
  return { closed: false, allDay: false, ranges };
}

function toMin(h: string, mm: string | undefined, ap: string | undefined): number {
  let hour = Number(h);
  const min = Number(mm ?? 0);
  const a = ap?.toLowerCase();
  if (a === "pm" || a === "下午") hour = hour % 12 + 12;
  if (a === "am" || a === "上午") hour = hour % 12;
  return hour * 60 + min;
}

export type HoursStatus =
  | { kind: "ok" }
  | { kind: "closed-day" }
  | { kind: "not-open-yet"; opensAt: number }
  | { kind: "already-closed"; closedAt: number };

/** Checks an arrival (minutes) against that weekday's hours. Null when there is nothing to check. */
export function checkHours(hours: string[] | undefined, weekday: number, arrive: number | undefined): HoursStatus | null {
  const line = hoursForWeekday(hours, weekday);
  if (!line || arrive === undefined) return null;
  const dh = parseDayHours(line);
  if (dh.unknown) return null;
  // A place open past midnight the day before is open now, whatever today's line says.
  const prev = hoursForWeekday(hours, (weekday + 6) % 7);
  if (prev) {
    const pd = parseDayHours(prev);
    if (!pd.unknown && !pd.closed && !pd.allDay && pd.ranges.some(([o, c]) => c > 1440 && arrive + 1440 >= o && arrive + 1440 < c)) return { kind: "ok" };
  }
  if (dh.closed) return { kind: "closed-day" };
  if (dh.allDay) return { kind: "ok" };
  const inside = dh.ranges.find(([o, c]) => arrive >= o && arrive < c);
  if (inside) return { kind: "ok" };
  const next = dh.ranges.find(([o]) => o > arrive);
  if (next) return { kind: "not-open-yet", opensAt: next[0] };
  return { kind: "already-closed", closedAt: dh.ranges[dh.ranges.length - 1][1] };
}

export function describeHours(s: HoursStatus): string | null {
  switch (s.kind) {
    case "ok": return null;
    case "closed-day": return t("closed_day");
    case "not-open-yet": return t("opens_at", { t: fmtMin(s.opensAt) });
    case "already-closed": return t("closed_at", { t: fmtMin(s.closedAt) });
  }
}
