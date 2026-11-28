import * as L from "leaflet";
import { setIcon } from "obsidian";
import { DEFAULT_MAP_SOURCE, pickMapSource, type MapSource } from "../core/map-sources";
import { isValidTileUrl } from "../core/tiles";

/** Only owns background layers. The itinerary, camera and popup belong to the map view. */
export class Basemaps {
  private layers = new Map<L.LayerGroup, MapSource>();
  private control: L.Control.Layers | null = null;
  private activeId: string | null = null;
  private key = "";

  constructor(private map: L.Map, private readChoice: () => unknown, private saveChoice: (id: string) => void) {
    map.on("baselayerchange", this.changed);
  }

  apply(configured: MapSource[], defaultId: string): void {
    let sources = configured.filter((s) => isValidTileUrl(s.url));
    if (!sources.length) sources = [DEFAULT_MAP_SOURCE];
    const key = JSON.stringify([sources, defaultId]);
    if (key === this.key) return;
    this.key = key;
    const chosen = pickMapSource(sources, defaultId, this.activeId ?? this.readChoice());
    this.clear();
    const control = sources.length > 1 ? L.control.layers(undefined, undefined, { position: "topright" }) : null;
    for (const source of sources) {
      const tile = L.tileLayer(source.url.trim(), {
        attribution: source.attribution, maxZoom: source.maxZoom, minZoom: source.minZoom ?? 0,
        ...(source.subdomains?.length ? { subdomains: source.subdomains } : {}),
      });
      // The group lets the native control offer sources outside the current zoom;
      // the single tile layer supplies the new bounds when selected.
      const layer = L.layerGroup([tile]);
      this.layers.set(layer, source);
      const name = createSpan({ text: source.name });
      control?.addBaseLayer(layer, name.innerHTML);
      if (source.id === chosen.id) layer.addTo(this.map);
    }
    this.activeId = chosen.id;
    this.limitZoom(chosen);
    this.control = control;
    control?.addTo(this.map);
    const toggle = control?.getContainer()?.querySelector<HTMLElement>(".leaflet-control-layers-toggle");
    if (toggle) { toggle.title = "Map source"; toggle.setAttribute("aria-label", "Map source"); setIcon(toggle, "layers"); }
  }

  private changed = (event: { layer: L.LayerGroup }): void => {
    const source = this.layers.get(event.layer);
    if (!source) return;
    this.activeId = source.id;
    this.limitZoom(source);
    this.saveChoice(source.id);
  };

  private limitZoom(source: MapSource): void {
    const current = this.map.getZoom();
    const next = Math.max(source.minZoom ?? 0, Math.min(source.maxZoom, current));
    if (next !== current) this.map.setZoom(next);
  }

  private clear(): void {
    if (this.control) {
      // Leaflet 1.9's collapsed control leaves this map listener on removal.
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Leaflet binds the supplied context.
      this.map.off("click", this.control.collapse, this.control);
      this.control.remove();
      this.control = null;
    }
    for (const layer of this.layers.keys()) layer.remove();
    this.layers.clear();
  }

  dispose(): void {
    this.map.off("baselayerchange", this.changed);
    this.clear();
  }
}
