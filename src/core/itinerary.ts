/**
 * Parses a note into days and stops.
 *
 * Stops keep their original Google Maps link with saved coordinates in a
 * `%%wf:{...}%%` metadata comment. Map View compatible `[Name](geo:lat,lng)`
 * links remain supported.
 *
 * Days are headings. Every stop belongs to the nearest heading above it; stops
 * before the first heading land in an unnamed group.
 */

export interface PlaceMeta {
  /** Coordinates for a stop whose visible link keeps its original Google Maps URL. */
  lat?: number;
  lng?: number;
  /** Link these coordinates were resolved for; editing the href invalidates the pin. */
  locationUrl?: string;
  /** Google rating, 1 to 5. */
  rating?: number;
  /** Weekday opening hours as printed by Google, e.g. "Monday: 9:00 AM – 5:00 PM". */
  hours?: string[];
  address?: string;
  website?: string;
  placeId?: string;
  /** Google primaryType, e.g. "shinto_shrine". */
  type?: string;
  /** Google photo resource name (`places/…/photos/…`), fetched with the user's key at render time. */
  photo?: string;
  /** The place's UTC offset in minutes from Google, so a written time here means local time. */
  utc?: number;
  /** How the user gets here, chosen in the timeline or written as an emoji before the link. */
  via?: Transport;
  /**
   * The route Google returned for the leg into this stop, kept so companions
   * without a key see the same numbers. Endpoints, mode and transit departure
   * context must still match after edits; incomplete legacy identities are
   * ignored until they can be refreshed.
   */
  leg?: LegMeta;
}

export interface LegMeta {
  from: string;
  via: Transport;
  /** Both endpoints and transit departure context validate this saved result. */
  to?: string;
  departure?: string;
  /** Duration in seconds and distance in metres. */
  s: number;
  m: number;
  /** Transit line names, when any. */
  line?: string;
  /** The route's shape as an encoded polyline, simplified to a few dozen points, so the map can draw the road without asking again. */
  p?: string;
}

export interface Stop {
  name: string;
  /** Original Google Maps link, when retained during import. */
  url?: string;
  lat: number;
  lng: number;
  /** Zero-based line in the note. */
  line: number;
  /** Character offsets of the whole Markdown link within the line. */
  from: number;
  to: number;
  /** Where the text before this link starts on the line (line start, or the end of the previous link). */
  beforeFrom: number;
  meta?: PlaceMeta;
  /** Emoji the user wrote before the link on this line, if any. */
  emoji?: string;
  category: Category;
  /** Leading "HH:MM" on the line, if any. */
  time?: string;
  /** How one gets here: chosen in the timeline, or a transport emoji the user wrote before the link. Otherwise unknown. */
  transport?: Transport;
  /** The line's prose with links reduced to their names and markup removed. */
  note: string;
  /** Indented lines right under the stop, verbatim: the user's notes for it. */
  notes: string[];
  /** Image on the same line or the line after: a vault `![[file]]` link or a URL. */
  image?: string;
  /** Index within its day, zero-based. */
  index: number;
  dayIndex: number;
}

export interface Day {
  /** Heading text without the leading `#`s. Empty for stops above the first heading. */
  title: string;
  /** Zero-based line of the heading, or -1 for the unnamed group. */
  headingLine: number;
  /** First line after this day's range (exclusive). */
  endLine: number;
  stops: Stop[];
  /** Zero-based position among days that have at least one stop. */
  index: number;
  /** Short label such as "9/17" if the heading carries a date, else the title. */
  label: string;
  /** The full date in the heading (`2026-09-17`), or null when the heading has none. */
  date: { year: number; month: number; day: number } | null;
  /**
   * Last date of a range heading (`2026-09-19 ~ 2026-09-26 東京`), or null.
   * A range is one block on the map; since the day is not certain, nothing is checked against a weekday.
   */
  dateEnd: { year: number; month: number; day: number } | null;
}

export interface Itinerary {
  days: Day[];
  /** Every stop in document order. */
  stops: Stop[];
}

export interface ParseOptions {
  /**
   * Heading level that starts a day. Default 2 (`##`). Shallower headings
   * (the note's title) do not start days. When the note has no heading at this
   * level, any heading up to it counts, so a note written with `#` days works.
   */
  maxHeadingLevel?: number;
}

import { isGoogleMapsUrl, isValidLatLng } from "./gmaps-url";
import { TRANSPORT_EMOJI, firstEmoji, isTransportEmoji, pickCategory, transportEmoji, type Category, type Transport } from "./category";

const STOP_LINK = /\[([^\]]*)\]\((geo:[^)]*|https?:\/\/[^)\s]+)\)/g;
const GEO_TARGET = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;
const META = /%%wf:(\{.*?\})%%/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
// list marker, optional task box, optional emoji (with its variation selector or joined sequence), then the time
const TIME = /^\s*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?(?:\S(?:\uFE0F|\u200D\S)*\s+)?(\d{1,2}:\d{2})/u;
const IMAGE = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\((\S+?)\)/;

export function parseItinerary(markdown: string, opts: ParseOptions = {}): Itinerary {
  const maxLevel = opts.maxHeadingLevel ?? 2;
  const lines = markdown.split("\n");
  const hasExact = headingLevels(lines).has(maxLevel);
  const isDayHeading = (level: number) => (hasExact ? level === maxLevel : level <= maxLevel);
  const days: Day[] = [];
  let current: Day = { title: "", headingLine: -1, endLine: lines.length, stops: [], index: -1, label: "", date: null, dateEnd: null };
  let fence = "";
  let inComment = false;
  let inFrontmatter = lines[0] === "---";
  // Indent of the last stop line; deeper lines right under it are its notes, whatever they contain.
  let noteBase: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (inFrontmatter) {
      if (i > 0 && raw.trim() === "---") inFrontmatter = false;
      continue;
    }
    const f = FENCE.exec(raw)?.[1];
    if (f && (fence ? closesFence(f, fence) : true)) {
      fence = fence ? "" : f;
      continue;
    }
    if (fence) continue;
    // Obsidian comments are not part of the plan; the plugin's own `%%wf:{}%%` comments are kept.
    const stripped = stripComments(raw, inComment);
    inComment = stripped.inComment;
    const line = stripped.text;
    if (!raw.trim()) noteBase = null;

    const h = HEADING.exec(line);
    if (h && isDayHeading(h[1].length)) {
      current.endLine = i;
      days.push(current);
      current = { title: h[2], headingLine: i, endLine: lines.length, stops: [], index: -1, label: dayLabel(h[2]), date: dayDate(h[2]), dateEnd: dayDateEnd(h[2]) };
      noteBase = null;
      continue;
    }
    const indent = indentWidth(line);
    if (noteBase !== null && indent > noteBase) continue;
    noteBase = null;

    let prevEnd = 0;
    const time = TIME.exec(line)?.[1];
    let image: RegExpExecArray | null | undefined;
    for (const link of stopLinks(line)) {
      const { lat, lng, meta } = link;
      noteBase = indent;
      if (image === undefined) image = IMAGE.exec(line) ?? imageBelow(lines, i);
      const before = maskMeta(line.slice(prevEnd, link.from));
      prevEnd = link.to;
      const name = link.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const emojiBefore = firstEmoji(before.replace(/\d{1,2}:\d{2}/, ""));
      current.stops.push({
        name,
        url: link.url,
        lat,
        lng,
        line: i,
        from: link.from,
        beforeFrom: link.from - before.length,
        to: link.to,
        meta,
        emoji: emojiBefore && !isTransportEmoji(emojiBefore) ? emojiBefore : undefined,
        category: pickCategory({ googleType: meta?.type, name }),
        time,
        // The emoji in the text is what everyone reads, so it wins; `via` is only read from older notes.
        transport: transportEmoji(before) ?? meta?.via ?? undefined,
        note: plainNote(line),
        notes: continuationLines(lines, i),
        image: image ? (image[1] ?? image[2]) : undefined,
        index: current.stops.length,
        dayIndex: -1,
      });
    }
  }
  days.push(current);

  // Once a note has dated headings, the undated sections are notes (research, to-dos, candidates):
  // their links stay in the text but are not part of the trip on the map.
  const dated = days.some((d) => d.date);
  const withStops = days.filter((d) => d.stops.length > 0 && (!dated || d.date));
  withStops.forEach((d, i) => {
    d.index = i;
    d.stops.forEach((s) => (s.dayIndex = i));
  });
  return { days: withStops, stops: withStops.flatMap((d) => d.stops) };
}

export interface StopLink {
  name: string;
  lat: number;
  lng: number;
  url?: string;
  from: number;
  to: number;
  meta?: PlaceMeta;
  metaFrom?: number;
  metaTo?: number;
}

/** Shared source spans for parsing, note edits and both rendered note surfaces. */
export function stopLinks(line: string): StopLink[] {
  const links = stopCandidates(line);
  const out: StopLink[] = [];
  for (let i = 0; i < links.length; i++) {
    const m = links[i];
    const from = m.index;
    const to = from + m[0].length;
    const newline = line.indexOf("\n", to);
    const end = Math.min(links[i + 1]?.index ?? line.length, newline === -1 ? line.length : newline);
    const mm = META.exec(line.slice(to, end));
    const meta = mm ? parseMeta(mm[1]) : undefined;
    const geo = GEO_TARGET.exec(m[2]);
    if (!geo && meta?.locationUrl !== m[2]) continue;
    const lat = geo ? Number(geo[1]) : meta?.lat;
    const lng = geo ? Number(geo[2]) : meta?.lng;
    if (lat === undefined || lng === undefined || !isValidLatLng(lat, lng)) continue;
    out.push({ name: m[1], lat, lng, url: geo ? undefined : m[2], from, to, meta,
      metaFrom: mm ? to + mm.index : undefined, metaTo: mm ? to + mm.index + mm[0].length : undefined });
  }
  return out;
}

function stopCandidates(text: string): RegExpExecArray[] {
  return [...maskMeta(text).matchAll(STOP_LINK)].filter((m) => m[2].startsWith("geo:") || isGoogleMapsUrl(m[2]));
}

/** Blanks every `%%wf:{}%%` comment in `s`, keeping offsets, so emoji inside saved data are not read as the user's. */
function maskMeta(s: string): string {
  return s.replace(/%%wf:\{.*?\}%%/g, (m) => " ".repeat(m.length));
}

/**
 * Blanks Obsidian `%%…%%` comments (keeping offsets) while leaving `%%wf:{}%%`
 * intact. A comment left open at the end of the line continues on the next.
 */
export function stripComments(line: string, inComment: boolean): { text: string; inComment: boolean } {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (inComment) {
      const close = line.indexOf("%%", i);
      if (close === -1) { out += " ".repeat(line.length - i); i = line.length; break; }
      out += " ".repeat(close + 2 - i);
      i = close + 2;
      inComment = false;
      continue;
    }
    const open = line.indexOf("%%", i);
    if (open === -1) { out += line.slice(i); break; }
    if (line.startsWith("%%wf:", open)) {
      const close = line.indexOf("%%", open + 5);
      const end = close === -1 ? line.length : close + 2;
      out += line.slice(i, end);
      i = end;
      continue;
    }
    out += line.slice(i, open) + "  ";
    i = open + 2;
    inComment = true;
  }
  return { text: out, inComment };
}

function indentWidth(l: string): number {
  return (/^\s*/.exec(l) as RegExpExecArray)[0].replace(/\t/g, "    ").length;
}

/** A fence closes on the same character, at least as long as the one that opened it. */
function closesFence(candidate: string, open: string): boolean {
  return candidate[0] === open[0] && candidate.length >= open.length;
}

/** Heading levels present outside fenced blocks, comments and frontmatter. */
function headingLevels(lines: string[]): Set<number> {
  const out = new Set<number>();
  let fence = "";
  let inComment = false;
  let inFrontmatter = lines[0] === "---";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (inFrontmatter) { if (i > 0 && l.trim() === "---") inFrontmatter = false; continue; }
    const f = FENCE.exec(l)?.[1];
    if (f && (fence ? closesFence(f, fence) : true)) { fence = fence ? "" : f; continue; }
    if (fence) continue;
    const stripped = stripComments(l, inComment);
    inComment = stripped.inComment;
    const h = HEADING.exec(stripped.text);
    if (h) out.add(h[1].length);
  }
  return out;
}

/**
 * Lines directly under `line` that are indented deeper than it, with list
 * markers and leading whitespace removed. Image-only lines are left out
 * (they become the stop's picture instead).
 */
export function continuationLines(lines: string[], line: number): string[] {
  const indentOf = (l: string) => /^\s*/.exec(l)![0].replace(/\t/g, "    ").length;
  const base = indentOf(lines[line]);
  const out: string[] = [];
  for (let j = line + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim()) break;
    if (indentOf(l) <= base || HEADING.test(l)) break;
    const text = l.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "").trim();
    if (IMAGE.test(text) && text.replace(IMAGE, "").trim() === "") continue;
    out.push(text);
  }
  return out;
}

/** An image on one of the indented lines under `line`. */
function imageBelow(lines: string[], line: number): RegExpExecArray | null {
  const indentOf = (l: string) => /^\s*/.exec(l)![0].replace(/\t/g, "    ").length;
  const base = indentOf(lines[line]);
  for (let j = line + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim() || indentOf(l) <= base || HEADING.test(l)) return null;
    const m = IMAGE.exec(l);
    if (m) return m;
  }
  return null;
}

/** The line as prose: list marker, time, links (kept as names), meta and images removed. */
export function plainNote(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .replace(/%%wf:\{.*?\}%%/g, "")
    .replace(IMAGE, "")
    .replace(/\[([^\]]*)\]\(geo:[^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, a: string, b?: string) => b ?? a)
    .replace(/[*_`]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*\s*/u, "");
}

/** Which day (by index) contains the given zero-based line, or -1. */
export function dayAtLine(it: Itinerary, line: number): number {
  for (const d of it.days) {
    const start = d.headingLine === -1 ? 0 : d.headingLine;
    if (line >= start && line < d.endLine) return d.index;
  }
  return -1;
}

/**
 * The date of a day heading. Only a full `YYYY-MM-DD` counts: anything
 * shorter would need a guessed year, and the weekday, hours and departure
 * checks all hang on the date being certain.
 */
export function dayDate(title: string): Day["date"] {
  return validDate(/(\d{4})-(\d{2})-(\d{2})/.exec(title));
}

/**
 * The end of a range heading: a second full date after the first, joined by
 * `~`, `～`, `-`, `–`, `to` or `到` (`2026-09-19 ~ 2026-09-26 東京`). Null when
 * there is none or it is not after the start.
 */
export function dayDateEnd(title: string): Day["date"] {
  const m = /(\d{4})-(\d{2})-(\d{2})\s*(?:[~～\-–]|to|到)\s*(\d{4})-(\d{2})-(\d{2})/.exec(title);
  if (!m) return null;
  const start = validDate([m[0], m[1], m[2], m[3]] as unknown as RegExpExecArray);
  const end = validDate([m[0], m[4], m[5], m[6]] as unknown as RegExpExecArray);
  if (!start || !end) return null;
  const key = (d: NonNullable<Day["date"]>) => d.year * 10000 + d.month * 100 + d.day;
  return key(end) > key(start) ? end : null;
}

function validDate(m: RegExpExecArray | null): Day["date"] {
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? { year, month, day } : null;
}

/** Pulls a compact date label out of a heading, e.g. "2026-09-17 週四 上山" -> "9/17", a range -> "9/19~9/26". */
export function dayLabel(title: string): string {
  const end = dayDateEnd(title);
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(title);
  if (iso && end) return `${Number(iso[2])}/${Number(iso[3])}~${end.month}/${end.day}`;
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}`;
  const slash = /(?:^|\D)(\d{1,2})\/(\d{1,2})(?!\d)/.exec(title);
  if (slash) return `${Number(slash[1])}/${Number(slash[2])}`;
  const cjk = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(title);
  if (cjk) return `${Number(cjk[1])}/${Number(cjk[2])}`;
  const mon = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/i.exec(title);
  if (mon) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    return `${months.indexOf(mon[1].slice(0, 3).toLowerCase()) + 1}/${Number(mon[2])}`;
  }
  const dayWord = /\bday\s*(\d{1,2})\b/i.exec(title);
  if (dayWord) return `D${dayWord[1]}`;
  return title.length > 12 ? title.slice(0, 12) : title;
}

const TRANSPORT_TOKEN = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

/**
 * Returns the line with the stop's transport written as the emoji before its
 * link: the transport emoji already there is replaced in place, otherwise
 * one is inserted right before the link. A legacy `via` in the metadata is
 * dropped so the text is the only place the choice lives. Nothing else moves.
 */
export function setTransportOnLine(line: string, stop: Pick<Stop, "from" | "to" | "beforeFrom">, mode: Transport): string {
  const emoji = TRANSPORT_EMOJI[mode];
  const before = maskMeta(line.slice(stop.beforeFrom, stop.from));
  let out: string | null = null;
  for (const m of before.matchAll(TRANSPORT_TOKEN)) {
    if (!isTransportEmoji(m[0])) continue;
    const at = stop.beforeFrom + (m.index ?? 0);
    out = line.slice(0, at) + emoji + line.slice(at + m[0].length);
    break;
  }
  if (out === null) out = line.slice(0, stop.from) + emoji + " " + line.slice(stop.from);
  // The edit sits before the link, so the link end moves by the size difference.
  const at = { to: stop.to + (out.length - line.length) };
  // A route saved for another mode is stale now; drop it rather than leave it behind.
  const savedVia = metaSpan(out, at.to)?.meta.leg?.via;
  return patchLineMeta(out, savedVia && savedVia !== mode ? { via: undefined, leg: undefined } : { via: undefined }, at);
}

/** The `%%wf:{}%%` comment that belongs to the link ending at `linkEnd`: the first one before the next link. */
export function metaSpan(line: string, linkEnd: number): { start: number; end: number; meta: PlaceMeta } | null {
  const rest = line.slice(linkEnd);
  const nextLink = stopCandidates(rest)[0];
  const scope = nextLink ? rest.slice(0, nextLink.index) : rest;
  const mm = META.exec(scope);
  if (!mm) return null;
  return { start: linkEnd + mm.index, end: linkEnd + mm.index + mm[0].length, meta: parseMeta(mm[1]) ?? {} };
}

/**
 * True when the stop's link is still at the offsets the pane parsed it
 * from, so a write computed earlier lands on the stop it was meant for.
 */
export function stopStillAt(line: string, stop: Pick<Stop, "from" | "to" | "lat" | "lng"> & Partial<Pick<Stop, "url">>): boolean {
  return stopLinks(line).some((link) => link.from === stop.from && link.to === stop.to && link.lat === stop.lat && link.lng === stop.lng && link.url === stop.url);
}

/**
 * Returns the line with `patch` merged into its `%%wf:{}%%` comment, adding
 * one after the link (and tags) when the line has none. Used when the user
 * changes transport in the timeline. Everything outside the comment is kept byte for byte.
 */
export function patchLineMeta(line: string, patch: Partial<PlaceMeta>, at?: Pick<Stop, "to">): string {
  // With a stop given, only the comment that belongs to its link is touched; a line may hold several stops.
  let mm: { start: number; end: number; meta: PlaceMeta } | null = null;
  if (at) mm = metaSpan(line, at.to);
  else {
    const m = META.exec(line);
    if (m) mm = { start: m.index, end: m.index + m[0].length, meta: parseMeta(m[1]) ?? {} };
  }
  const meta: PlaceMeta = mm?.meta ?? {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) delete (meta as Record<string, unknown>)[k];
    else (meta as Record<string, unknown>)[k] = v;
  }
  const text = Object.keys(meta).length ? `%%wf:${JSON.stringify(compactMeta(meta))}%%` : "";
  if (mm) {
    // Replace only the metadata span; when it goes away take one adjacent space with it.
    let { start, end } = mm;
    if (!text) {
      if (start > 0 && line[start - 1] === " ") start--;
      else if (line[end] === " ") end++;
    }
    return line.slice(0, start) + text + line.slice(end);
  }
  if (!text) return line;
  let after = at?.to;
  if (after === undefined) {
    const links = stopLinks(line);
    const last = links[links.length - 1];
    if (!last) return line;
    after = last.to;
  }
  return `${line.slice(0, after)} ${text}${line.slice(after)}`;
}

/** Serialises a stop back to its inline form. */
export function formatStop(name: string, lat: number, lng: number, meta?: PlaceMeta, emoji?: string, mapsUrl?: string): string {
  const url = mapsUrl && isGoogleMapsUrl(mapsUrl) ? mapsUrl.replace(/\(/g, "%28").replace(/\)/g, "%29") : undefined;
  if (url) meta = { ...meta, lat: Number(round(lat)), lng: Number(round(lng)), locationUrl: url };
  const target = url ?? `geo:${round(lat)},${round(lng)}`;
  const parts = [`${emoji ? emoji + " " : ""}[${name.replace(/[[\]]/g, "")}](${target})`];
  if (meta && Object.keys(meta).length > 0) parts.push(`%%wf:${JSON.stringify(compactMeta(meta))}%%`);
  return parts.join(" ");
}

/**
 * Reads a `%%wf:{…}%%` payload. The note is the user's, so a hand-edited or
 * foreign value of the wrong type is dropped rather than left to throw later
 * (`rating.toFixed` inside the editor extension would disable every chip).
 */
export function parseMeta(json: string): PlaceMeta | undefined {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return undefined; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: PlaceMeta = {};
  if (typeof r.lat === "number" && typeof r.lng === "number" && isValidLatLng(r.lat, r.lng)) { out.lat = r.lat; out.lng = r.lng; }
  if (typeof r.locationUrl === "string") out.locationUrl = r.locationUrl;
  if (typeof r.rating === "number" && Number.isFinite(r.rating)) out.rating = r.rating;
  if (typeof r.utc === "number" && Number.isInteger(r.utc)) out.utc = r.utc;
  if (Array.isArray(r.hours) && r.hours.every((h) => typeof h === "string")) out.hours = r.hours;
  for (const k of ["address", "website", "placeId", "type", "photo"] as const) {
    if (typeof r[k] === "string") (out as Record<string, unknown>)[k] = r[k];
  }
  if (typeof r.via === "string" && r.via in TRANSPORT_EMOJI) out.via = r.via as Transport;
  const leg = r.leg;
  if (leg && typeof leg === "object" && !Array.isArray(leg)) {
    const l = leg as Record<string, unknown>;
    if (typeof l.from === "string" && typeof l.via === "string" && l.via in TRANSPORT_EMOJI && typeof l.s === "number" && typeof l.m === "number") {
      const saved: LegMeta = { from: l.from, via: l.via as Transport, s: l.s, m: l.m };
      if (typeof l.to === "string") saved.to = l.to;
      if (typeof l.departure === "string") saved.departure = l.departure;
      if (typeof l.line === "string") saved.line = l.line;
      if (typeof l.p === "string") saved.p = l.p;
      out.leg = saved;
    }
  }
  return out;
}

function compactMeta(meta: PlaceMeta): PlaceMeta {
  const out: PlaceMeta = {};
  if (meta.lat !== undefined && meta.lng !== undefined) { out.lat = meta.lat; out.lng = meta.lng; }
  if (meta.locationUrl) out.locationUrl = meta.locationUrl;
  if (meta.rating !== undefined) out.rating = Math.round(meta.rating * 10) / 10;
  if (meta.hours?.length) out.hours = meta.hours;
  if (meta.address) out.address = meta.address;
  if (meta.website) out.website = meta.website;
  if (meta.placeId) out.placeId = meta.placeId;
  if (meta.type) out.type = meta.type;
  if (meta.photo) out.photo = meta.photo;
  if (meta.utc !== undefined) out.utc = meta.utc;
  if (meta.via) out.via = meta.via;
  if (meta.leg) out.leg = meta.leg;
  return out;
}

function round(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/**
 * The user's notes for a stop, verbatim: its line as prose (time removed,
 * the place name kept where it was written), then the indented lines under
 * it. A line that is nothing but the name adds nothing.
 */
export function stopNotes(stop: Stop): string[] {
  let line = stop.note;
  if (stop.time) line = line.replace(stop.time, " ");
  line = line.replace(/\s+/g, " ").trim();
  return line && line !== stop.name ? [line, ...stop.notes] : [...stop.notes];
}

/**
 * Moves the block starting at line `from` (the line plus every deeper-indented
 * line under it) to sit where line `to` is: before it when moving up, after
 * its block when moving down. Same rule as the drag in the timeline.
 */
export function moveBlock(lines: string[], from: number, to: number): string[] {
  const indentOf = (l: string) => (/^\s*/.exec(l) as RegExpExecArray)[0].replace(/\t/g, "    ").length;
  const blockLen = (ls: string[], ln: number): number => {
    const base = indentOf(ls[ln]);
    let n = 1;
    while (ln + n < ls.length && ls[ln + n].trim() && indentOf(ls[ln + n]) > base) n++;
    return n;
  };
  if (from < 0 || from >= lines.length || to < 0 || to >= lines.length || from === to) return lines;
  const count = blockLen(lines, from);
  // A target inside the block itself (one of the stop's own notes) is nowhere to go.
  if (to > from && to < from + count) return lines;
  const block = lines.slice(from, from + count);
  const rest = [...lines.slice(0, from), ...lines.slice(from + count)];
  // Moving down: the target line has shifted up by the removed block; land after the target's own block.
  const at = from < to ? Math.min(rest.length, to - count + blockLen(rest, to - count)) : to;
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}
