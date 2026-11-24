import { CATEGORY_EMOJI, TRANSPORT_EMOJI } from "./category";
import { dayColor } from "./colors";
import { placeUrl } from "./gmaps-out";
import { stopNotes, type Itinerary, type Stop } from "./itinerary";

/**
 * The trip as KML for Google My Maps: one folder per day (My Maps shows it
 * as a layer you can toggle), one placemark per stop named with its number
 * and time, the notes and a Google Maps link in the description, pins in
 * the day's colour. Deterministic: the same note gives the same file.
 */
const MARKER = "<!-- Exported by Wayfarer. Each export replaces this file. -->";

/**
 * True for a file an earlier export wrote, which the next export may replace.
 * Exports before the marker are known by their per-day pin styles.
 */
export function isWayfarerKml(text: string): boolean {
  return text.includes(MARKER) || /<Style id="day\d+"><IconStyle><color>[0-9a-f]{8}<\/color><scale>1\.1<\/scale><Icon><href>https:\/\/maps\.google\.com\/mapfiles\/kml\/paddle\/wht-blank\.png/.test(text);
}

export function tripKml(it: Itinerary, title: string, dayNameTemplate = "Day {n}"): string {
  const days = it.days.filter((d) => d.stops.length > 0);
  const styles = days.map((d) => `    <Style id="day${d.index}"><IconStyle><color>${kmlColor(dayColor(d.index))}</color><scale>1.1</scale><Icon><href>https://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>`);
  const folders = days.map((d) => {
    const name = d.title || (d.headingLine === -1 ? "" : dayNameTemplate.replace("{n}", String(d.index + 1))) || title;
    const marks = d.stops.map((s, i) => placemark(s, i + 1, `#day${d.index}`)).join("\n");
    return `    <Folder>\n      <name>${esc(name)}</name>\n${marks}\n    </Folder>`;
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    MARKER,
    `<kml xmlns="http://www.opengis.net/kml/2.2">`,
    `  <Document>`,
    `    <name>${esc(title)}</name>`,
    ...styles,
    ...folders,
    `  </Document>`,
    `</kml>`,
    ``,
  ].join("\n");
}

function placemark(s: Stop, n: number, styleUrl: string): string {
  const name = [String(n) + ".", s.time, `${s.emoji ?? CATEGORY_EMOJI[s.category]} ${s.name}`].filter(Boolean).join(" ");
  const lines: string[] = [...stopNotes(s)];
  if (s.transport && !lines[0]?.includes(TRANSPORT_EMOJI[s.transport])) lines.unshift(TRANSPORT_EMOJI[s.transport]);
  if (s.meta?.hours?.length) lines.push(...s.meta.hours);
  if (s.meta?.address) lines.push(s.meta.address);
  lines.push(placeUrl(s));
  return [
    `      <Placemark>`,
    `        <name>${esc(name)}</name>`,
    `        <description>${esc(lines.join("\n"))}</description>`,
    `        <styleUrl>${styleUrl}</styleUrl>`,
    `        <Point><coordinates>${s.lng},${s.lat},0</coordinates></Point>`,
    `      </Placemark>`,
  ].join("\n");
}

/** KML colours are aabbggrr. */
function kmlColor(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `ff${m[3]}${m[2]}${m[1]}`.toLowerCase() : "ffffffff";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
