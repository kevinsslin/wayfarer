/** The placeholders Leaflet fills in a tile URL; any other `{name}` throws while tiles load. */
const KNOWN = new Set(["s", "z", "x", "y", "r", "-y"]);

/** True when Leaflet can load tiles from `url`: http(s), with only the placeholders it knows. */
export function isValidTileUrl(url: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(url.trim())) return false;
  // Leaflet reads placeholders with this pattern (`L.Util.template`).
  for (const m of url.matchAll(/\{ *([\w_ -]+) *\}/g)) if (!KNOWN.has(m[1])) return false;
  try { new URL(url.trim().replace(/\{ *([\w_ -]+) *\}/g, "0")); }
  catch { return false; }
  return true;
}
