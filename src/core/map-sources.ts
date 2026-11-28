export interface MapSource {
  id: string;
  name: string;
  url: string;
  attribution: string;
  maxZoom: number;
  minZoom?: number;
  subdomains?: string[];
}

export const DEFAULT_MAP_SOURCE: MapSource = {
  id: "default", name: "Street Map",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19, minZoom: 0,
};

/** Normalize saved sources without discarding an existing custom tile URL. */
export function mapSourcesFrom(value: unknown, legacyUrl: unknown, legacyAttribution: unknown): MapSource[] {
  const sources: MapSource[] = [];
  const ids = new Set<string>();
  if (Array.isArray(value)) for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.url !== "string") continue;
    let id = typeof raw.id === "string" && raw.id.trim() ? raw.id : `map-${sources.length + 1}`;
    while (ids.has(id)) id += "-copy";
    ids.add(id);
    const maxZoom = zoom(raw.maxZoom, 19);
    const domains = Array.isArray(raw.subdomains) ? raw.subdomains : typeof raw.subdomains === "string" ? raw.subdomains.split(",") : [];
    const subdomains = domains.filter((s): s is string => typeof s === "string" && /^[a-z\d-]+$/i.test(s));
    sources.push({
      id, name: typeof raw.name === "string" && raw.name.trim() ? raw.name : `Map ${sources.length + 1}`,
      url: raw.url, attribution: typeof raw.attribution === "string" ? raw.attribution : "",
      maxZoom, minZoom: Math.min(zoom(raw.minZoom, 0), maxZoom),
      ...(subdomains.length ? { subdomains } : {}),
    });
  }
  if (sources.length) return sources;
  const url = typeof legacyUrl === "string" && legacyUrl ? legacyUrl : DEFAULT_MAP_SOURCE.url;
  return [{ ...DEFAULT_MAP_SOURCE, url, name: url === DEFAULT_MAP_SOURCE.url ? DEFAULT_MAP_SOURCE.name : "Custom map",
    attribution: typeof legacyAttribution === "string" ? legacyAttribution : DEFAULT_MAP_SOURCE.attribution }];
}

function zoom(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 30 ? value : fallback;
}

/** An existing pane keeps its choice; an absent/deleted choice uses the configured default. */
export function pickMapSource(sources: MapSource[], defaultId: string, wanted: unknown): MapSource {
  return sources.find((s) => s.id === wanted) ?? sources.find((s) => s.id === defaultId) ?? sources[0] ?? DEFAULT_MAP_SOURCE;
}
