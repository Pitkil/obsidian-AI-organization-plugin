import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import { notify } from "../utils/notify";
import { setUILang, t, tpl } from "../i18n";
import type { UILang } from "../i18n";
import type AIOrganizerPlugin from "../main";
import type { CustomPromptTemplate, ModelKind, ModelProfile, ProviderId } from "../types";
import { TemplateEditModal } from "./templateModal";

// ============================================================
// AI Organizer 设置页
// ============================================================

/** 解析换行/逗号分隔的模型或语言列表 */
function parseModelList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export class AIOrganizerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AIOrganizerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("aio-settings");

    this.renderLanguage();
    this.renderProviders();
    this.renderFormatting();
    this.renderImageOrg();
    this.renderMetadata();
    this.renderInbox();
    this.renderLinks();
    this.renderBatch();
    this.renderTranslate();
    this.renderChat();
    this.renderScrollRestore();
  }

  /** 界面语言切换（位于设置页顶部） */
  private renderLanguage(): void {
    const plugin = this.plugin;
    new Setting(this.containerEl)
      .setName(t("settings.language"))
      .setDesc(t("settings.languageDesc"))
      .addDropdown((dd) => {
        dd.addOption("zh", t("settings.languageZh"));
        dd.addOption("en", t("settings.languageEn"));
        dd.setValue(plugin.settings.uiLanguage);
        dd.onChange(async (value) => {
          const lang = value === "en" ? "en" : "zh";
          plugin.settings.uiLanguage = lang as UILang;
          await plugin.saveSettings();
          setUILang(lang as UILang);
          notify(lang === "en" ? "Language switched. Reload the plugin to refresh command names." : "已切换语言，重载插件后命令名生效。");
          this.display();
        });
      });
  }

  private createSection(
    title: string,
    desc: string,
    icon: string,
    tone: "primary" | "default" = "default"
  ): HTMLElement {
    const section = this.containerEl.createEl("section", {
      cls: `aio-settings-section aio-settings-section-${tone}`,
    });
    const header = section.createDiv({ cls: "aio-settings-section-header" });
    const iconEl = header.createSpan({ cls: "aio-settings-section-icon" });
    setIcon(iconEl, icon);
    const text = header.createDiv({ cls: "aio-settings-section-copy" });
    text.createDiv({ cls: "aio-settings-section-title", text: title });
    text.createDiv({ cls: "aio-settings-section-desc", text: desc });
    return section;
  }

  // ---------- 模型提供商 ----------
  private renderProviders(): void {
    const containerEl = this.createSection(t("st.modelSection"), t("st.modelSectionDesc"), "key-round", "primary");
    this.renderModelProfiles(containerEl);
  }

  // ---------- 排版 ----------
  private renderModelProfiles(containerEl: HTMLElement): void {
    const s = this.plugin.settings;
    const textProfiles = this.plugin.chatService.getConfiguredProfiles("text");
    const visionProfiles = this.plugin.chatService.getConfiguredProfiles("vision");

    const bar = containerEl.createDiv({ cls: "aio-model-config-bar" });
    const copy = bar.createDiv({ cls: "aio-model-config-copy" });
    copy.createDiv({ cls: "aio-model-config-title", text: t("st.profileListTitle") });
    copy.createDiv({
      cls: "aio-model-config-desc",
      text: t("st.profileListDesc"),
    });
    const addBtn = bar.createEl("button", { cls: "aio-model-add-btn", text: t("st.addModel") });
    addBtn.addEventListener("click", async () => {
      s.modelProfiles.push(this.createEmptyProfile("openaiCompatible"));
      await this.plugin.saveSettings();
      this.display();
    });

    const localVision = containerEl.createDiv({ cls: "aio-local-vision-bar" });
    const localCopy = localVision.createDiv({ cls: "aio-local-vision-copy" });
    localCopy.createDiv({ cls: "aio-local-vision-title", text: t("st.localVisionTitle") });
    localCopy.createDiv({
      cls: "aio-local-vision-desc",
      text: t("st.localVisionDesc"),
    });
    const localActions = localVision.createDiv({ cls: "aio-local-vision-actions" });
    const ollamaVisionBtn = localActions.createEl("button", { cls: "aio-model-profile-btn", text: t("st.addOllamaVision") });
    ollamaVisionBtn.addEventListener("click", async () => {
      const profile = this.createLocalVisionProfile("ollama");
      s.modelProfiles.push(profile);
      s.activeVisionModelProfileId = profile.id;
      await this.plugin.saveSettings();
      this.display();
    });
    const lmStudioVisionBtn = localActions.createEl("button", { cls: "aio-model-profile-btn", text: t("st.addLmStudioVision") });
    lmStudioVisionBtn.addEventListener("click", async () => {
      const profile = this.createLocalVisionProfile("lmstudio");
      s.modelProfiles.push(profile);
      s.activeVisionModelProfileId = profile.id;
      await this.plugin.saveSettings();
      this.display();
    });

    new Setting(containerEl)
      .setName(t("st.currentTextModel"))
      .setDesc(textProfiles.length > 0 ? t("st.currentTextModelDesc") : t("st.noTextModelYet"))
      .addDropdown((dd) => {
        if (textProfiles.length === 0) {
          dd.addOption("", t("st.noTextModelConfigured"));
          dd.setValue("");
          return;
        }
        for (const profile of textProfiles) {
          dd.addOption(profile.id, this.profileDisplayName(profile));
        }
        const active = textProfiles.some((profile) => profile.id === s.activeTextModelProfileId)
          ? s.activeTextModelProfileId
          : textProfiles[0].id;
        dd.setValue(active);
        dd.onChange(async (value) => {
          const profile = s.modelProfiles.find((item) => item.id === value);
          if (!profile) return;
          s.activeTextModelProfileId = profile.id;
          s.activeModelProfileId = profile.id;
          s.activeProvider = profile.providerId;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(t("st.currentVisionModel"))
      .setDesc(t("st.currentVisionModelDesc"))
      .addDropdown((dd) => {
        dd.addOption("", t("st.noVisionModel"));
        for (const profile of visionProfiles) {
          dd.addOption(profile.id, this.profileDisplayName(profile));
        }
        dd.setValue(visionProfiles.some((profile) => profile.id === s.activeVisionModelProfileId) ? s.activeVisionModelProfileId : "");
        dd.onChange(async (value) => {
          s.activeVisionModelProfileId = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    const list = containerEl.createDiv({ cls: "aio-model-profile-list" });
    if (s.modelProfiles.length === 0) {
      list.createDiv({ cls: "aio-model-empty", text: t("st.noModelsYet") });
      return;
    }

    for (const profile of s.modelProfiles) {
      this.renderModelProfileCard(list, profile);
    }
  }

  private renderModelProfileCard(parent: HTMLElement, profile: ModelProfile): void {
    const card = parent.createDiv({ cls: "aio-model-profile-card" });
    if (
      profile.id === this.plugin.settings.activeTextModelProfileId ||
      profile.id === this.plugin.settings.activeVisionModelProfileId
    ) {
      card.addClass("is-active");
    }
    if (!this.profileReady(profile)) card.addClass("is-incomplete");

    const head = card.createDiv({ cls: "aio-model-profile-head" });
    const title = head.createDiv({ cls: "aio-model-profile-title" });
    title.createDiv({ cls: "aio-model-profile-name", text: profile.name || profile.model || t("st.unnamedModel") });
    title.createDiv({
      cls: "aio-model-profile-meta",
      text: `${this.providerName(profile.providerId)} · ${profile.model || t("st.noModelId")}`,
    });
    const actions = head.createDiv({ cls: "aio-model-profile-actions" });
    const activeBtn = actions.createEl("button", {
      cls: "aio-model-profile-btn",
      text: this.activeProfileButtonText(profile),
    });
    activeBtn.addEventListener("click", async () => {
      if (!this.profileReady(profile)) {
        notify(t("notify.fillProfile"));
        return;
      }
      if ((profile.kind ?? "text") === "vision") {
        this.plugin.settings.activeVisionModelProfileId = profile.id;
      } else {
        this.plugin.settings.activeTextModelProfileId = profile.id;
        this.plugin.settings.activeModelProfileId = profile.id;
        this.plugin.settings.activeProvider = profile.providerId;
      }
      await this.plugin.saveSettings();
      this.display();
    });
    const deleteBtn = actions.createEl("button", { cls: "aio-model-profile-btn is-danger", text: t("common.delete") });
    deleteBtn.addEventListener("click", async () => {
      this.plugin.settings.modelProfiles = this.plugin.settings.modelProfiles.filter((item) => item.id !== profile.id);
      if (this.plugin.settings.activeModelProfileId === profile.id) {
        const next = this.plugin.chatService.getConfiguredProfiles("text")[0];
        this.plugin.settings.activeModelProfileId = next?.id ?? "";
        this.plugin.settings.activeTextModelProfileId = next?.id ?? "";
        if (next) this.plugin.settings.activeProvider = next.providerId;
      }
      if (this.plugin.settings.activeTextModelProfileId === profile.id) {
        this.plugin.settings.activeTextModelProfileId = this.plugin.chatService.getConfiguredProfiles("text")[0]?.id ?? "";
      }
      if (this.plugin.settings.activeVisionModelProfileId === profile.id) {
        this.plugin.settings.activeVisionModelProfileId = this.plugin.chatService.getConfiguredProfiles("vision")[0]?.id ?? "";
      }
      await this.plugin.saveSettings();
      this.display();
    });

    new Setting(card)
      .setName(t("st.enabled"))
      .addToggle((toggle) =>
        toggle.setValue(profile.enabled).onChange(async (value) => {
          profile.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(card)
      .setName(t("st.displayName"))
      .addText((text) =>
        text.setPlaceholder(t("st.displayNamePlaceholder")).setValue(profile.name).onChange(async (value) => {
          profile.name = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(card)
      .setName(t("st.kind"))
      .setDesc(t("st.kindDesc"))
      .addDropdown((dd) =>
        dd
          .addOption("text", t("st.kindText"))
          .addOption("vision", t("st.kindVision"))
          .setValue(profile.kind ?? "text")
          .onChange(async (value) => {
            profile.kind = value as ModelKind;
            if (profile.kind === "vision" && this.plugin.settings.activeTextModelProfileId === profile.id) {
              this.plugin.settings.activeTextModelProfileId = "";
              this.plugin.settings.activeModelProfileId = "";
            }
            if (profile.kind === "text" && this.plugin.settings.activeVisionModelProfileId === profile.id) {
              this.plugin.settings.activeVisionModelProfileId = "";
            }
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(card)
      .setName(t("st.provider"))
      .addDropdown((dd) =>
        dd
          .addOption("openaiCompatible", t("st.providerOpenaiCompat"))
          .addOption("anthropic", "Anthropic Claude")
          .addOption("gemini", "Google Gemini")
          .setValue(profile.providerId)
          .onChange(async (value) => {
            profile.providerId = value as ProviderId;
            profile.baseUrl = this.defaultBaseUrl(profile.providerId);
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(card)
      .setName("Base URL")
      .setDesc(profile.providerId === "openaiCompatible" ? t("st.baseUrlDescCompat") : t("st.baseUrlDescOfficial"))
      .addText((text) =>
        text.setPlaceholder(this.defaultBaseUrl(profile.providerId)).setValue(profile.baseUrl ?? "").onChange(async (value) => {
          profile.baseUrl = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(card)
      .setName("API Key")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(this.keyPlaceholder(profile.providerId)).setValue(profile.apiKey).onChange(async (value) => {
          profile.apiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(card)
      .setName(t("st.modelId"))
      .addText((text) =>
        text.setPlaceholder(this.modelPlaceholder(profile.providerId, profile.kind ?? "text")).setValue(profile.model).onChange(async (value) => {
          profile.model = value.trim();
          if (!profile.name) profile.name = profile.model;
          await this.plugin.saveSettings();
        })
      );

    new Setting(card)
      .setName(t("st.temperature"))
      .addSlider((slider) =>
        slider.setLimits(0, 2, 0.1).setValue(profile.temperature ?? 0.7).onChange(async (value) => {
          profile.temperature = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(card)
      .setName(t("st.maxTokens"))
      .addText((text) =>
        text.setValue(String(profile.maxTokens ?? 4096)).onChange(async (value) => {
          profile.maxTokens = Math.max(256, parseInt(value) || 4096);
          await this.plugin.saveSettings();
        })
      );

    new Setting(card)
      .setName(t("st.contextWindow"))
      .setDesc(t("st.contextWindowDesc"))
      .addText((text) =>
        text.setValue(String(profile.contextWindowTokens ?? 32000)).onChange(async (value) => {
          profile.contextWindowTokens = Math.max(1024, parseInt(value) || 32000);
          await this.plugin.saveSettings();
        })
      );
  }

  private createEmptyProfile(providerId: ProviderId): ModelProfile {
    return {
      id: `model-${Date.now()}`,
      providerId,
      kind: "text",
      name: "",
      enabled: true,
      baseUrl: this.defaultBaseUrl(providerId),
      apiKey: "",
      model: "",
      temperature: 0.7,
      maxTokens: 4096,
      contextWindowTokens: 32000,
    };
  }

  private createLocalVisionProfile(kind: "ollama" | "lmstudio"): ModelProfile {
    const isOllama = kind === "ollama";
    return {
      id: `local-vision-${kind}-${Date.now()}`,
      providerId: "openaiCompatible",
      kind: "vision",
      name: isOllama ? t("st.ollamaLocalVision") : t("st.lmStudioLocalVision"),
      enabled: true,
      baseUrl: isOllama ? "http://localhost:11434/v1" : "http://localhost:1234/v1",
      apiKey: "",
      model: isOllama ? "moondream" : "local-vision-model",
      temperature: 0.2,
      maxTokens: 1024,
      contextWindowTokens: 8192,
    };
  }

  private profileReady(profile: ModelProfile): boolean {
    if (!profile.enabled || !profile.model) return false;
    if (profile.providerId === "openaiCompatible") {
      return !!profile.baseUrl && (!!profile.apiKey || this.isLocalEndpoint(profile.baseUrl));
    }
    return !!profile.apiKey;
  }

  private isLocalEndpoint(baseUrl: string): boolean {
    try {
      const host = new URL(baseUrl).hostname.toLowerCase();
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch {
      return false;
    }
  }

  private providerName(providerId: ProviderId): string {
    if (providerId === "openaiCompatible") return t("st.providerNameCompat");
    if (providerId === "anthropic") return "Claude";
    return "Gemini";
  }

  private defaultBaseUrl(providerId: ProviderId): string {
    if (providerId === "openaiCompatible") return "https://api.openai.com/v1";
    if (providerId === "anthropic") return "https://api.anthropic.com/v1/messages";
    return "https://generativelanguage.googleapis.com/v1beta";
  }

  private keyPlaceholder(providerId: ProviderId): string {
    if (providerId === "anthropic") return "sk-ant-...";
    if (providerId === "gemini") return "AIza...";
    return "sk-...";
  }

  private modelPlaceholder(providerId: ProviderId, kind: ModelKind = "text"): string {
    if (kind === "vision" && providerId === "openaiCompatible") return "moondream / llama3.2-vision / llava";
    if (providerId === "anthropic") return "claude-3-5-sonnet-latest";
    if (providerId === "gemini") return "gemini-1.5-pro";
    return "gpt-4o-mini / deepseek-chat / qwen-plus";
  }

  private profileDisplayName(profile: ModelProfile): string {
    return `${this.providerName(profile.providerId)} · ${profile.name || profile.model}`;
  }

  private activeProfileButtonText(profile: ModelProfile): string {
    if ((profile.kind ?? "text") === "vision") {
      return profile.id === this.plugin.settings.activeVisionModelProfileId ? t("st.currentVisionBtn") : t("st.setVisionBtn");
    }
    return profile.id === this.plugin.settings.activeTextModelProfileId ? t("st.currentTextBtn") : t("st.setTextBtn");
  }

  private renderFormatting(): void {
    const containerEl = this.createSection(t("st.formatSection"), t("st.formatSectionDesc"), "pilcrow");
    const s = this.plugin.settings;

    // 模式下拉框：内置 + 自定义模板
    new Setting(containerEl)
      .setName(t("st.defaultFormatMode"))
      .addDropdown((dd) => {
        dd.addOption("full", t("st.formatModeFull"))
          .addOption("markdown", t("st.formatModeMarkdown"))
          .addOption("structure", t("st.formatModeStructure"))
          .addOption("spacing", t("st.formatModeSpacing"));
        for (const t of s.formatting.customTemplates) {
          dd.addOption(t.name, tpl("st.customPrefix", { name: t.name }));
        }
        const current = s.formatting.mode;
        const valid =
          ["full", "markdown", "structure", "spacing"].includes(current) ||
          s.formatting.customTemplates.some((t) => t.name === current);
        dd.setValue(valid ? current : "full");
        dd.onChange(async (v) => {
          s.formatting.mode = v;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName(t("st.previewBeforeApply"))
      .setDesc(t("st.previewBeforeApplyDesc"))
      .addToggle((t) =>
        t.setValue(s.formatting.previewBeforeApply).onChange(async (v) => {
          s.formatting.previewBeforeApply = v;
          await this.plugin.saveSettings();
        })
      );

    // ---- 自定义模板管理 ----
    new Setting(containerEl)
      .setName(t("st.customTemplates"))
      .setDesc(t("st.customTemplatesDesc"))
      .addButton((btn) =>
        btn.setButtonText(t("st.newTemplate")).setCta().onClick(() => {
          new TemplateEditModal(this.app, null, async (template) => {
            if (s.formatting.customTemplates.some((x) => x.name === template.name)) {
              notify(t("notify.templateNameExists"));
              return;
            }
            s.formatting.customTemplates.push(template);
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );

    for (const tmpl of s.formatting.customTemplates) {
      const row = new Setting(containerEl)
        .setName(tpl("st.customPrefix", { name: tmpl.name }))
        .setDesc(this.previewPrompt(tmpl.prompt));
      row.addButton((btn) =>
        btn.setButtonText(t("st.edit")).onClick(() => {
          new TemplateEditModal(this.app, tmpl, async (updated) => {
            const idx = s.formatting.customTemplates.findIndex((x) => x.name === tmpl.name);
            if (idx >= 0) s.formatting.customTemplates[idx] = updated;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );
      row.addButton((btn) =>
        btn.setButtonText(t("common.delete")).onClick(async () => {
          s.formatting.customTemplates = s.formatting.customTemplates.filter(
            (x) => x.name !== tmpl.name
          );
          if (s.formatting.mode === tmpl.name) s.formatting.mode = "full";
          await this.plugin.saveSettings();
          this.display();
        })
      );
    }
  }

  private previewPrompt(prompt: string): string {
    const clean = prompt.replace(/\n+/g, " ").trim();
    return clean.length > 60 ? clean.slice(0, 60) + "…" : clean;
  }

  // ---------- 图片整理 ----------
  private renderImageOrg(): void {
    const containerEl = this.createSection(t("st.imageSection"), t("st.imageSectionDesc"), "image");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName(t("st.attachmentRoot"))
      .setDesc(t("st.attachmentRootDesc"))
      .addText((t) =>
        t.setPlaceholder("attachments").setValue(s.imageOrg.attachmentRoot).onChange(async (v) => {
          s.imageOrg.attachmentRoot = v.trim();
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.subfolderPerNote"))
      .setDesc(t("st.subfolderPerNoteDesc"))
      .addToggle((t) =>
        t.setValue(s.imageOrg.subfolderPerNote).onChange(async (v) => {
          s.imageOrg.subfolderPerNote = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.autoRename"))
      .setDesc(t("st.autoRenameDesc"))
      .addToggle((t) =>
        t.setValue(s.imageOrg.renameImages).onChange(async (v) => {
          s.imageOrg.renameImages = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.scanOrphans"))
      .setDesc(t("st.scanOrphansDesc"))
      .addToggle((t) =>
        t.setValue(s.imageOrg.checkOrphans).onChange(async (v) => {
          s.imageOrg.checkOrphans = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.visionMaxImages"))
      .setDesc(t("st.visionMaxImagesDesc"))
      .addText((t) =>
        t.setValue(String(s.imageOrg.visionMaxImages ?? 20)).onChange(async (v) => {
          s.imageOrg.visionMaxImages = Math.min(200, Math.max(1, parseInt(v) || 20));
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.visionMaxSize"))
      .setDesc(t("st.visionMaxSizeDesc"))
      .addText((t) =>
        t.setValue(String(s.imageOrg.visionMaxImageSizeMB ?? 5)).onChange(async (v) => {
          s.imageOrg.visionMaxImageSizeMB = Math.min(50, Math.max(1, parseInt(v) || 5));
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.ocrFallback"))
      .setDesc(t("st.ocrFallbackDesc"))
      .addToggle((t) =>
        t.setValue(s.imageOrg.ocrFallbackEnabled !== false).onChange(async (v) => {
          s.imageOrg.ocrFallbackEnabled = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.ocrLang"))
      .setDesc(t("st.ocrLangDesc"))
      .addText((t) =>
        t.setPlaceholder("chi_sim+eng").setValue(s.imageOrg.ocrLanguages ?? "chi_sim+eng").onChange(async (v) => {
          s.imageOrg.ocrLanguages = v.trim() || "chi_sim+eng";
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 元数据 ----------

  private renderMetadata(): void {
    const containerEl = this.createSection(t("st.metadataSection"), t("st.metadataSectionDesc"), "tags");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName(t("st.genTags"))
      .addToggle((t) =>
        t.setValue(s.metadata.generateTags).onChange(async (v) => {
          s.metadata.generateTags = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.genSummary"))
      .addToggle((t) =>
        t.setValue(s.metadata.generateSummary).onChange(async (v) => {
          s.metadata.generateSummary = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.genAliases"))
      .addToggle((t) =>
        t.setValue(s.metadata.generateAliases).onChange(async (v) => {
          s.metadata.generateAliases = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.metadataLang"))
      .addText((tc) =>
        tc.setPlaceholder(t("st.metadataLangPlaceholder")).setValue(s.metadata.language).onChange(async (v) => {
          s.metadata.language = v.trim() || t("st.metadataLangPlaceholder");
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.maxTags"))
      .addText((t) =>
        t.setValue(String(s.metadata.maxTags)).onChange(async (v) => {
          s.metadata.maxTags = Math.min(20, Math.max(1, parseInt(v) || 10));
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 收件箱 ----------
  private renderInbox(): void {
    const containerEl = this.createSection(t("st.inboxSection"), t("st.inboxSectionDesc"), "inbox");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName(t("st.inboxFolder"))
      .setDesc(t("st.inboxFolderDesc"))
      .addText((t) =>
        t.setPlaceholder("Inbox").setValue(s.inbox.inboxFolder).onChange(async (v) => {
          s.inbox.inboxFolder = v.trim();
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.allowCreateFolders"))
      .setDesc(t("st.allowCreateFoldersDesc"))
      .addToggle((t) =>
        t.setValue(s.inbox.allowCreateFolder).onChange(async (v) => {
          s.inbox.allowCreateFolder = v;
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 双链 ----------
  private renderLinks(): void {
    const containerEl = this.createSection(t("st.linksSection"), t("st.linksSectionDesc"), "link-2");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName(t("st.maxSuggestions"))
      .addText((t) =>
        t.setValue(String(s.links.maxSuggestions)).onChange(async (v) => {
          s.links.maxSuggestions = Math.min(15, Math.max(1, parseInt(v) || 5));
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.candidateLimit"))
      .setDesc(t("st.candidateLimitDesc"))
      .addText((t) =>
        t.setValue(String(s.links.candidateLimit)).onChange(async (v) => {
          s.links.candidateLimit = Math.min(2000, Math.max(10, parseInt(v) || 300));
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 批量 ----------
  private renderBatch(): void {
    const containerEl = this.createSection(t("st.batchSection"), t("st.batchSectionDesc"), "list-checks");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName(t("st.batchDelay"))
      .setDesc(t("st.batchDelayDesc"))
      .addText((t) =>
        t.setValue(String(s.batch.delayMs)).onChange(async (v) => {
          s.batch.delayMs = Math.max(0, parseInt(v) || 0);
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 翻译 ----------
  private renderTranslate(): void {
    const containerEl = this.createSection(t("st.translateSection"), t("st.translateSectionDesc"), "languages");
    const s = this.plugin.settings;
    const textProfiles = this.plugin.chatService.getConfiguredProfiles("text");

    new Setting(containerEl)
      .setName(t("st.translateDefaultModel"))
      .setDesc(t("st.translateDefaultModelDesc"))
      .addDropdown((dd) => {
        dd.addOption("", t("st.autoCurrentModel"));
        for (const profile of textProfiles) {
          dd.addOption(profile.id, this.profileDisplayName(profile));
        }
        dd.setValue(textProfiles.some((profile) => profile.id === s.translate.modelProfileId) ? s.translate.modelProfileId : "");
        dd.onChange(async (value) => {
          s.translate.modelProfileId = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("st.defaultTargetLang"))
      .addText((tc) =>
        tc.setPlaceholder(t("st.metadataLangPlaceholder")).setValue(s.translate.defaultTarget).onChange(async (v) => {
          s.translate.defaultTarget = v.trim() || "中文";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("st.commonTargetLangs"))
      .setDesc(t("st.commonTargetLangsDesc"))
      .addTextArea((ta) => {
        ta.setValue((s.translate.targetLanguages ?? []).join("\n")).onChange(async (v) => {
          s.translate.targetLanguages = parseModelList(v);
          if (!s.translate.targetLanguages.includes(s.translate.defaultTarget)) {
            s.translate.targetLanguages.unshift(s.translate.defaultTarget);
          }
          await this.plugin.saveSettings();
        });
        ta.inputEl.rows = 4;
        ta.inputEl.addClass("aio-textarea");
      });
  }

  // ---------- 对话 ----------
  private renderChat(): void {
    const containerEl = this.createSection(t("st.chatSection"), t("st.chatSectionDesc"), "messages-square");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName(t("st.chatSaveFolder"))
      .addText((tc) =>
        tc.setPlaceholder(t("st.chatSaveFolderPlaceholder")).setValue(s.chat.saveFolder).onChange(async (v) => {
          s.chat.saveFolder = v.trim() || t("st.chatSaveFolderPlaceholder");
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.injectNoteDefault"))
      .addToggle((t) =>
        t.setValue(s.chat.injectCurrentNote).onChange(async (v) => {
          s.chat.injectCurrentNote = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.injectSelectionDefault"))
      .addToggle((t) =>
        t.setValue(s.chat.injectSelection).onChange(async (v) => {
          s.chat.injectSelection = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("st.systemPrompt"))
      .setDesc(t("st.systemPromptDesc"))
      .addTextArea((ta) => {
        ta.setValue(s.chat.systemPrompt).onChange(async (v) => {
          s.chat.systemPrompt = v;
          await this.plugin.saveSettings();
        });
        ta.inputEl.rows = 4;
        ta.inputEl.addClass("aio-textarea");
      });
  }

  // ---------- 浏览位置记忆 ----------
  private renderScrollRestore(): void {
    const containerEl = this.createSection(t("st.scrollSection"), t("st.scrollSectionDesc"), "book-marked");
    const s = this.plugin.settings;
    new Setting(containerEl)
      .setName(t("st.scrollEnabled"))
      .setDesc(t("st.scrollEnabledDesc"))
      .addToggle((t) =>
        t.setValue(s.scrollRestore.enabled).onChange(async (v) => {
          s.scrollRestore.enabled = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
