import { googlePlaces, googleRoute } from "./net";
import { Notice, PluginSettingTab, Setting, type App, type TextComponent, type SettingDefinitionItem } from "obsidian";
import type WayfarerPlugin from "./main";
import { DEFAULT_MAP_SOURCE, type MapSource } from "./core/map-sources";
import { MapSourcesModal } from "./ui/map-sources-modal";

export interface WayfarerSettings {
  /** Google API key with Places API (New) and Routes API enabled. Without it: pins from the link only, no routes, no photos. */
  googleApiKey: string;
  /** "auto" follows the interface/Obsidian language; otherwise a Google-supported language code. */
  languageCode: string;
  /** Interface language: "auto" follows Obsidian. */
  uiLanguage: "auto" | "en" | "zh-TW";
  /** Width of the timeline column in pixels. */
  listWidth: number;
  /** Whether the timeline column is shown beside the map. */
  listOpen: boolean;
  /** Headings at this level or shallower start a new day. */
  dayHeadingLevel: number;
  /** Convert Google Maps links automatically on paste. */
  convertOnPaste: boolean;
  /** Prefix converted stops with a category emoji (⛩️ 🍜 🏨 ...). */
  addEmoji: boolean;
  /** The map flies to the stop on the cursor line. */
  followCursor: boolean;
  /** Raster tile URL template. */
  tileUrl: string;
  tileAttribution: string;
  mapSources: MapSource[];
  defaultMapSource: string;
  /** Draw a line through each day's stops in order. */
  drawRoutes: boolean;
  /** Open the map pane when a note with stops becomes active. */
  autoOpen: boolean;
}

export const DEFAULT_SETTINGS: WayfarerSettings = {
  googleApiKey: "",
  languageCode: "auto",
  uiLanguage: "auto",
  listWidth: 260,
  listOpen: true,
  dayHeadingLevel: 2,
  convertOnPaste: true,
  addEmoji: true,
  followCursor: true,
  tileUrl: DEFAULT_MAP_SOURCE.url,
  tileAttribution: DEFAULT_MAP_SOURCE.attribution,
  mapSources: [DEFAULT_MAP_SOURCE],
  defaultMapSource: DEFAULT_MAP_SOURCE.id,
  drawRoutes: true,
  autoOpen: true,
};

const GOOGLE_LANGUAGES: Record<string, string> = {
  auto: "Follow interface language", en: "English", "zh-TW": "繁體中文", "zh-CN": "简体中文",
  ja: "日本語", ko: "한국어", fr: "Français", de: "Deutsch", es: "Español",
};
const GOOGLE_LANGUAGE_DESC = "By default, follow your interface language (Obsidian when set to automatic). Override it for place names and opening hours. Applies to new Google requests; saved details and map tile labels are unchanged.";

const KEY_DESC = "Your own key. It unlocks exact pins with ratings, opening hours and photos, and routes between stops (walking, cycling, driving and transit with line names). Without it the plugin still reads pins from pasted links, and legs show their distance only. Stored in this vault's plugin data, never in a note. ";
const AGENT_DESC = "Teaches an AI coding agent to research a trip and write the note in the format this plugin reads, planning notes included. ";

function keyDesc(): DocumentFragment {
  return createFragment((f) => {
    f.appendText(KEY_DESC);
    f.createEl("a", { text: "How to get one", href: "https://github.com/kevinsslin/wayfarer#google-api-key" });
    f.appendText(".");
  });
}

function agentDesc(): DocumentFragment {
  return createFragment((f) => {
    f.appendText(AGENT_DESC);
    f.createEl("a", { text: "Install the skill", href: "https://github.com/kevinsslin/wayfarer#planning-with-an-ai-assistant" });
    f.appendText(".");
  });
}

export class WayfarerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WayfarerPlugin) {
    super(app, plugin);
  }

  /**
   * The same settings as `display()` below, declared for Obsidian 1.13+, where
   * they feed the settings search. Rendering stays in `display()` because the
   * plugin still runs on 1.11.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const p = this.plugin;
    return [
      { name: "Language", control: { type: "dropdown", key: "uiLanguage", options: { auto: "Follow Obsidian", en: "English", "zh-TW": "繁體中文" } } },
      { name: "Convert map links when pasted", desc: "A pasted link (including maps.app.goo.gl) becomes a place with a pin.", control: { type: "toggle", key: "convertOnPaste" } },
      { name: "Add an emoji to converted places", desc: "⛩️ 🍜 🏨 🚉 based on what the place is. An emoji you typed before the link is kept.", control: { type: "toggle", key: "addEmoji" } },
      { name: "Map follows the line you edit", control: { type: "toggle", key: "followCursor" } },
      { name: "Open the map when a note has places", control: { type: "toggle", key: "autoOpen" } },
      {
        type: "group",
        heading: "Google",
        items: [
          { name: "Google API key", desc: KEY_DESC, aliases: ["places", "routes", "photos"], render: (setting) => this.renderKey(setting, p.settings) },
          { name: "Language for Google results", desc: GOOGLE_LANGUAGE_DESC, render: (setting) => this.renderGoogleLanguage(setting) },
        ],
      },
      {
        type: "group",
        heading: "Plan with an AI agent",
        items: [{ name: "Trip planning skill", desc: AGENT_DESC, aliases: ["skill", "claude", "codex"], render: (setting) => { setting.setDesc(agentDesc()); } }],
      },
      {
        type: "group",
        heading: "Advanced",
        items: [
          { name: "Heading level that starts a day", desc: "Default ## . If the note has none at this level, larger headings count.", control: { type: "dropdown", key: "dayHeadingLevel", options: { 1: "#", 2: "##", 3: "###", 4: "####" } } },
          { name: "Draw lines between places", control: { type: "toggle", key: "drawRoutes" } },
          { name: "Map sources", desc: "Configure raster tile backgrounds and their default.", aliases: ["tiles", "satellite", "basemap"], render: (setting) => this.renderMapSources(setting) },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    const v = this.plugin.settings[key as keyof WayfarerSettings];
    return typeof v === "number" ? String(v) : v;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    if (key === "dayHeadingLevel") s[key] = Number(value);
    else if (key === "tileUrl") s[key] = String(value).trim() || DEFAULT_SETTINGS.tileUrl;
    else if (key === "languageCode") s[key] = String(value).trim() || "auto";
    else s[key] = value;
    if (key === "tileUrl" || key === "tileAttribution") {
      const source = this.plugin.settings.mapSources.find((m) => m.id === this.plugin.settings.defaultMapSource);
      if (source) source[key === "tileUrl" ? "url" : "attribution"] = String(s[key]);
    }
    await this.plugin.saveSettings();
    if (key === "uiLanguage") this.plugin.applyLocale();
    this.plugin.refresh();
  }

  private renderMapSources(setting: Setting): void {
    setting.addButton((b) => b.setButtonText("Manage map sources").onClick(() => new MapSourcesModal(this.plugin).open()));
  }

  private renderGoogleLanguage(setting: Setting): void {
    const s = this.plugin.settings;
    let custom: TextComponent;
    const isPreset = Object.prototype.hasOwnProperty.call(GOOGLE_LANGUAGES, s.languageCode);
    setting.setDesc(GOOGLE_LANGUAGE_DESC)
      .addDropdown((d) => {
        for (const [value, label] of Object.entries(GOOGLE_LANGUAGES)) d.addOption(value, label);
        d.addOption("custom", "Other language…");
        d.setValue(isPreset ? s.languageCode : "custom").onChange((value) => {
          custom.inputEl.hidden = value !== "custom";
          if (value === "custom") {
            s.languageCode = custom.getValue().trim() || "auto";
            void this.plugin.saveSettings();
            custom.inputEl.focus();
            return;
          }
          s.languageCode = value;
          void this.plugin.saveSettings();
        });
      })
      .addText((t) => {
        custom = t;
        t.setPlaceholder("Language code").setValue(isPreset ? "" : s.languageCode);
        t.inputEl.setAttribute("aria-label", "Custom Google results language");
        t.inputEl.hidden = isPreset;
        t.onChange((value) => {
          s.languageCode = value.trim() || "auto";
          void this.plugin.saveSettings();
        });
      });
  }

  /** The key field and its test button, shared by both renderers. */
  private renderKey(setting: Setting, s: WayfarerSettings): void {
    const save = () => void this.plugin.saveSettings();
    setting
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("Paste your key").setValue(s.googleApiKey).onChange((v) => { s.googleApiKey = v.trim(); save(); });
      })
      .addButton((b) => {
        b.setButtonText("Test key").onClick(async () => {
          if (!s.googleApiKey) { new Notice("Wayfarer: paste a key first"); return; }
          b.setDisabled(true);
          const out: string[] = [];
          try {
            const p = await googlePlaces(s.googleApiKey, this.plugin.googleLanguageCode).searchText("Tokyo Station");
            out.push(p ? `Places OK (${p.name})` : "Places: no result");
          } catch (e) {
            out.push(`Places refused: ${(e as Error).message}`);
          }
          try {
            const r = await googleRoute(s.googleApiKey, this.plugin.googleLanguageCode, { lat: 35.6812, lng: 139.7671 }, { lat: 35.7101, lng: 139.8107 }, "WALK");
            out.push(r ? `Routes OK (${Math.round(r.distanceM / 100) / 10} km)` : "Routes: no result");
          } catch (e) {
            out.push(`Routes refused: ${(e as Error).message}`);
          }
          b.setDisabled(false);
          new Notice(`Wayfarer key test\n${out.join("\n")}`, 20000);
        });
      });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = () => void this.plugin.saveSettings();

    new Setting(containerEl)
      .setName("Language")
      .addDropdown((d) => {
        d.addOption("auto", "Follow Obsidian").addOption("en", "English").addOption("zh-TW", "繁體中文");
        d.setValue(s.uiLanguage).onChange((v) => { s.uiLanguage = v as WayfarerSettings["uiLanguage"]; save(); this.plugin.applyLocale(); this.plugin.refresh(); });
      });

    new Setting(containerEl)
      .setName("Convert map links when pasted")
      .setDesc("A pasted link (including maps.app.goo.gl) becomes a place with a pin.")
      .addToggle((t) => t.setValue(s.convertOnPaste).onChange((v) => { s.convertOnPaste = v; save(); }));

    new Setting(containerEl)
      .setName("Add an emoji to converted places")
      .setDesc("⛩️ 🍜 🏨 🚉 based on what the place is. An emoji you typed before the link is kept.")
      .addToggle((t) => t.setValue(s.addEmoji).onChange((v) => { s.addEmoji = v; save(); }));

    new Setting(containerEl)
      .setName("Map follows the line you edit")
      .addToggle((t) => t.setValue(s.followCursor).onChange((v) => { s.followCursor = v; save(); }));

    new Setting(containerEl)
      .setName("Open the map when a note has places")
      .addToggle((t) => t.setValue(s.autoOpen).onChange((v) => { s.autoOpen = v; save(); }));

    new Setting(containerEl).setName("Google").setHeading();
    this.renderKey(new Setting(containerEl).setName("Google API key").setDesc(keyDesc()), s);
    this.renderGoogleLanguage(new Setting(containerEl).setName("Language for Google results"));

    new Setting(containerEl).setName("Plan with an AI agent").setHeading();
    new Setting(containerEl).setName("Trip planning skill").setDesc(agentDesc());

    new Setting(containerEl).setName("Advanced").setHeading();
    new Setting(containerEl)
      .setName("Heading level that starts a day")
      .setDesc("Default ## . If the note has none at this level, larger headings count.")
      .addDropdown((d) => {
        for (const n of [1, 2, 3, 4]) d.addOption(String(n), "#".repeat(n));
        d.setValue(String(s.dayHeadingLevel)).onChange((v) => { s.dayHeadingLevel = Number(v); save(); this.plugin.refresh(); });
      });
    new Setting(containerEl)
      .setName("Draw lines between places")
      .addToggle((t) => t.setValue(s.drawRoutes).onChange((v) => { s.drawRoutes = v; save(); this.plugin.refresh(); }));
    this.renderMapSources(new Setting(containerEl).setName("Map sources").setDesc("Configure raster tile backgrounds and their default."));
  }
}
