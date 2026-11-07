import type { MarkdownPostProcessor } from "obsidian";
import { todayHours } from "./map-view";
import { stopLinks, type StopLink } from "../core/itinerary";
import { placeUrl } from "../core/gmaps-out";
import { isGoogleMapsUrl } from "../core/gmaps-url";

/** Keep original Maps links and expose saved facts. Legacy geo links prefer Place IDs. */
export const readingPostProcessor: MarkdownPostProcessor = (el, ctx) => {
  const links = [...el.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) => {
    const href = a.getAttribute("href") ?? "";
    return href.startsWith("geo:") || isGoogleMapsUrl(href);
  });
  if (links.length === 0) return;
  const section = ctx.getSectionInfo(el);
  const occurrences = section ? linksIn(section.text, section.lineStart, section.lineEnd) : [];

  links.forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    const geo = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(href);
    const name = a.textContent ?? "";
    const hit = occurrences.find((o) => !o.used && o.name === name && (geo
      ? !o.url && o.lat === Number(geo[1]) && o.lng === Number(geo[2])
      : o.url === href));
    if (hit) hit.used = true;
    if (geo) {
      a.setAttribute("href", placeUrl(hit ?? { lat: Number(geo[1]), lng: Number(geo[2]) }));
      a.addClass("wf-geo-link");
    }
    a.setAttr("target", "_blank");
    a.setAttr("rel", "noopener");

    const meta = hit?.meta;
    if (!meta) return;
    const chip = createSpan({ cls: "wf-meta" });
    const bits: string[] = [];
    if (meta.rating) bits.push(`★ ${meta.rating.toFixed(1)}`);
    const today = todayHours(meta.hours);
    if (today) bits.push(today.replace(/^[^:]+:\s*/, ""));
    if (bits.length === 0) return;
    chip.textContent = bits.join(" · ");
    chip.title = [meta.address, ...(meta.hours ?? [])].filter(Boolean).join("\n");
    a.insertAdjacentElement("afterend", chip);
  });
};

interface Occurrence extends StopLink { used: boolean }
let lastText = "";
let lastLines: string[] = [];

function linksIn(text: string, lineStart: number, lineEnd: number): Occurrence[] {
  if (text !== lastText) {
    lastText = text;
    lastLines = text.split("\n");
  }
  return lastLines.slice(lineStart, lineEnd + 1).flatMap((line) => stopLinks(line).map((link) => ({ ...link, used: false })));
}
