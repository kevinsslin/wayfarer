/**
 * UI strings. The locale follows Obsidian's language unless the user picks
 * one in settings. Core formatting (durations, trailers) reads the same
 * table so text written into notes matches the interface.
 */
export type Locale = "en" | "zh-TW";

const TABLE = {
  en: {
    transport_unset: "Transport unset", straight_distance: "Straight line", change_transport: "Change transport",
    journey_previous: "← Previous", journey_nav_short: "Navigate ↗",
    journey: "Current trip", journey_manual: "Manual progress · this device", journey_start: "Start here",
    journey_next: "Next stop", journey_finish: "Finish trip", journey_done: "Trip complete",
    journey_reset: "Reset progress", journey_here: "Set as current stop", journey_return: "Back to current stop",
    journey_info: "Stop details", journey_nav: "Navigate to next", journey_nav_start: "Navigate here",
    journey_missing: "Saved stop changed. Select a stop to continue.", journey_ready: "Ready to start", journey_current: "Current",
    journey_more: "Progress options", journey_collapse: "Collapse current trip", view_map: "Map",
    view_list: "List", choose_day: "Choose a day", overview: "Overview",
    trip_overview: "Trip overview", day_plans: "Day plans", choose_stage: "Choose a stage", stage: "Stage {n}",
    all: "All", follow_on: "Map follows the cursor (click to stop)", follow_off: "Map stays put (click to follow the cursor)",
    min: "{n} min", hours: "{h} h", hours_min: "{h} h {m} min",
    from_prev: "from {name}", routed_by: "Google Routes", late_by: "{n} min late", late_vs: "{n} min after {t}",
    open_gmaps: "Google Maps ↗", from_prev_dir: "from previous stop ↗", website: "Website ↗", to_line: "Go to line",
    closed_day: "closed that day", opens_at: "opens {t}", closed_at: "closed at {t}", empty: "No stops in this note yet. Paste a Google Maps link under a day heading.",
    day: "Day {n}", other: "Other", via_hint: "Click to change how you get there", pick_mode: "how do you get there?",
    m_walk: "walk", m_bike: "bike", m_car: "car", m_taxi: "taxi", m_bus: "bus", m_train: "train", m_metro: "metro / MRT", m_tram: "tram / light rail", m_boat: "boat / ferry", m_flight: "flight",
    list_hide: "Hide the timeline", list_show: "Show the timeline", key_needed: "add a Google key for the route",
    kml_written: "Wrote {f}. In Google My Maps: Create a new map → Import → pick this file. Re-export replaces it; delete the old layer there.",
  },
  "zh-TW": {
    transport_unset: "交通方式未設定", straight_distance: "直線距離", change_transport: "更改交通方式",
    journey_previous: "← 上一站", journey_nav_short: "導航 ↗",
    journey: "目前行程", journey_manual: "手動進度 · 僅此裝置", journey_start: "從這站開始",
    journey_next: "下一站", journey_finish: "完成行程", journey_done: "行程已完成",
    journey_reset: "重設進度", journey_here: "設為目前這站", journey_return: "回到目前這站",
    journey_info: "地點資訊", journey_nav: "導航到下一站", journey_nav_start: "導航到這站",
    journey_missing: "原本的站點已變更，請重新選站繼續。", journey_ready: "尚未開始", journey_current: "目前",
    journey_more: "進度選項", journey_collapse: "收合目前行程", view_map: "地圖",
    view_list: "清單", choose_day: "選擇日期", overview: "總覽",
    trip_overview: "旅程路線", day_plans: "每日行程", choose_stage: "選擇旅程階段", stage: "第 {n} 階段",
    all: "全部", follow_on: "地圖跟著游標（點一下停止）", follow_off: "地圖不動（點一下開始跟隨）",
    min: "{n} 分", hours: "{h} 時", hours_min: "{h} 時 {m} 分",
    from_prev: "從 {name}", routed_by: "Google Routes 路線", late_by: "晚到 {n} 分", late_vs: "比 {t} 晚 {n} 分",
    open_gmaps: "Google Maps ↗", from_prev_dir: "從上一站導航 ↗", website: "網站 ↗", to_line: "到這行",
    closed_day: "當天休", opens_at: "{t} 才開", closed_at: "{t} 已關", empty: "這份筆記還沒有地點。在某一天的標題下貼一個 Google Maps 連結。",
    day: "第 {n} 天", other: "其他", via_hint: "點一下換交通方式", pick_mode: "怎麼去？",
    m_walk: "走路", m_bike: "單車", m_car: "開車", m_taxi: "計程車", m_bus: "巴士", m_train: "火車 / 新幹線", m_metro: "地鐵 / 捷運", m_tram: "路面電車 / 輕軌", m_boat: "船", m_flight: "飛機",
    list_hide: "收起時間軸", list_show: "展開時間軸", key_needed: "填 Google key 才有路線",
    kml_written: "已寫入 {f}。到 Google My Maps：建立新地圖 → 匯入 → 選這個檔。重新匯出會整份重產，舊圖層請在那邊刪掉。",
  },
} as const;

export type StringKey = keyof typeof TABLE.en;

let current: Locale = "en";

export function setLocale(l: Locale): void {
  current = l;
}
export function getLocale(): Locale {
  return current;
}

/** Picks the closest supported locale for an Obsidian language code such as "zh-TW", "zh", "ja", "en". */
export function localeFor(code: string | null | undefined): Locale {
  if (!code) return "en";
  if (code.startsWith("zh")) return "zh-TW";
  return "en";
}

export function t(key: StringKey, vars: Record<string, string | number> = {}): string {
  let s: string = TABLE[current][key] ?? TABLE.en[key];
  // split/join rather than replace: a value with `$&` or `$'` in it (a stop name) must come through as written
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
