import { Modal, Notice, Setting, type DropdownComponent } from "obsidian";
import { DEFAULT_MAP_SOURCE, type MapSource } from "../core/map-sources";
import { isValidTileUrl } from "../core/tiles";
import type WayfarerPlugin from "../main";

/** Edit a draft; only Save changes settings or requests tiles. */
export class MapSourcesModal extends Modal {
  private sources: MapSource[];
  private defaultId: string;
  private selected: string;

  constructor(private plugin: WayfarerPlugin) {
    super(plugin.app);
    this.sources = plugin.settings.mapSources.map((s) => ({ ...s, subdomains: s.subdomains?.slice() }));
    this.defaultId = plugin.settings.defaultMapSource;
    this.selected = this.sources[0].id;
  }

  onOpen(): void { this.render(); }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.createEl("h2", { text: "Map sources" });
    root.createEl("p", { text: "Raster tiles over http or https. Tile addresses, including API keys, are stored in the vault's plugin settings and may sync with them." });
    const source = this.sources.find((s) => s.id === this.selected) ?? this.sources[0];
    const index = this.sources.indexOf(source);
    const selects: DropdownComponent[] = [];
    new Setting(root).setName("Default map").setDesc("Used until a source is chosen on this device.")
      .addDropdown((d) => { selects.push(d); for (const s of this.sources) d.addOption(s.id, s.name); d.setValue(this.defaultId).onChange((id) => { this.defaultId = id; }); });
    new Setting(root).setName("Edit source")
      .addDropdown((d) => { selects.push(d); for (const s of this.sources) d.addOption(s.id, s.name); d.setValue(source.id).onChange((id) => { this.selected = id; this.render(); }); });
    new Setting(root)
      .addButton((b) => b.setButtonText("Add").onClick(() => {
        const s = { ...DEFAULT_MAP_SOURCE, id: `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, name: `Map ${this.sources.length + 1}` };
        this.sources.push(s); this.selected = s.id; this.render();
      }))
      .addButton((b) => b.setButtonText("Remove").setDisabled(this.sources.length === 1).onClick(() => {
        this.sources.splice(index, 1); this.selected = this.sources[Math.min(index, this.sources.length - 1)].id;
        if (this.defaultId === source.id) this.defaultId = this.sources[0].id;
        this.render();
      }))
      .addButton((b) => b.setIcon("arrow-up").setTooltip("Move source up").setDisabled(index === 0).onClick(() => { this.move(index, -1); }))
      .addButton((b) => b.setIcon("arrow-down").setTooltip("Move source down").setDisabled(index === this.sources.length - 1).onClick(() => { this.move(index, 1); }));
    new Setting(root).setName("Name").addText((t) => t.setValue(source.name).onChange((value) => {
      source.name = value;
      for (const d of selects) for (const option of Array.from(d.selectEl.options)) if (option.value === source.id) option.text = value;
    }));
    new Setting(root).setName("Tile URL").setDesc("Use {z}, {x}, {y}; optional {s} and {r}. Replace API-key placeholders with your own key.")
      .addText((t) => t.setValue(source.url).onChange((v) => { source.url = v; }));
    new Setting(root).setName("Attribution").setDesc("Provider credit; links are supported.")
      .addTextArea((t) => { t.inputEl.rows = 2; t.setValue(source.attribution).onChange((v) => { source.attribution = v; }); });
    new Setting(root).setName("Minimum zoom").setDesc("Optional lower bound; blank means 0.")
      .addText((t) => { t.inputEl.type = "number"; t.inputEl.setAttribute("aria-label", "Minimum zoom"); t.setValue(String(source.minZoom ?? 0)).onChange((v) => { source.minZoom = v === "" ? 0 : Number(v); }); });
    new Setting(root).setName("Maximum zoom").setDesc("Highest zoom supported by the source (0–30).")
      .addText((t) => { t.inputEl.type = "number"; t.inputEl.setAttribute("aria-label", "Maximum zoom"); t.setValue(String(source.maxZoom)).onChange((v) => { source.maxZoom = v === "" ? Number.NaN : Number(v); }); });
    new Setting(root).setName("Subdomains").setDesc("Optional, comma-separated: a,b,c or maps1,maps2. Blank uses a,b,c.")
      .addText((t) => t.setValue(source.subdomains?.join(",") ?? "").onChange((v) => { source.subdomains = v.split(",").map((s) => s.trim()).filter(Boolean); }));
    new Setting(root)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Save").setCta().onClick(async () => {
        if (this.sources.some((s) => !s.name.trim() || !isValidTileUrl(s.url) || !Number.isInteger(s.maxZoom) || !Number.isInteger(s.minZoom ?? 0)
          || (s.minZoom ?? 0) < 0 || s.maxZoom > 30 || (s.minZoom ?? 0) > s.maxZoom || s.subdomains?.some((d) => !/^[a-z\d-]+$/i.test(d)))) {
          new Notice("Wayfarer: check source names, tile templates, zoom ranges and subdomains."); return;
        }
        b.setDisabled(true);
        try { await this.plugin.saveMapSources(this.sources, this.defaultId); this.close(); }
        catch { new Notice("Wayfarer: could not save map sources. Please try again."); b.setDisabled(false); }
      }));
  }

  private move(index: number, delta: number): void {
    [this.sources[index], this.sources[index + delta]] = [this.sources[index + delta], this.sources[index]];
    this.render();
  }
}
