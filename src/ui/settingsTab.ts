import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import { notify } from "../utils/notify";
import type AIOrganizerPlugin from "../main";
import type { CustomPromptTemplate, ModelKind, ModelProfile, ProviderId } from "../types";
import { TemplateEditModal } from "./templateModal";

// ============================================================
// AI Organizer 设置页
// ============================================================

/** OpenAI 兼容接口的常用预设（一键填充 baseUrl / model） */
const PRESETS: Record<string, { label: string; baseUrl: string; model: string }> = {
  custom: { label: "自定义", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  qwen: { label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  zhipu: { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  kimi: { label: "Kimi(Moonshot)", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  ollama: { label: "Ollama 本地", baseUrl: "http://localhost:11434/v1", model: "llama3" },
};

function parseModelList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ensureModelList(models: string[] | undefined, model: string): string[] {
  const result = Array.from(new Set([...(models ?? []), model].map((item) => item.trim()).filter(Boolean)));
  return result;
}

export class AIOrganizerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AIOrganizerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("aio-settings");

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
    const containerEl = this.createSection("模型配置", "先完成这里，后面的排版、翻译和归档才会可用。", "key-round", "primary");
    const s = this.plugin.settings;
    this.renderModelProfiles(containerEl);
    return;

    new Setting(containerEl)
      .setName("默认提供商")
      .addDropdown((dd) =>
        dd
          .addOption("openaiCompatible", "OpenAI 兼容接口")
          .addOption("anthropic", "Anthropic Claude")
          .addOption("gemini", "Google Gemini")
          .setValue(s.activeProvider)
          .onChange(async (v) => {
            s.activeProvider = v as any;
            await this.plugin.saveSettings();
          })
      );

    // ---- OpenAI 兼容 ----
    new Setting(containerEl).setName("OpenAI 兼容接口").setHeading().setDesc("支持 OpenAI / DeepSeek / 通义千问 / 智谱 GLM / Kimi / Ollama 等");

    new Setting(containerEl)
      .setName("启用")
      .addToggle((t) => t.setValue(s.openaiCompatible.enabled).onChange(async (v) => {
        s.openaiCompatible.enabled = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("快速预设")
      .setDesc("一键填充常用服务的 Base URL 与模型名")
      .addDropdown((dd) => {
        for (const key of Object.keys(PRESETS)) {
          dd.addOption(key, PRESETS[key].label);
        }
        dd.setValue("custom");
        dd.onChange(async (key) => {
          const p = PRESETS[key];
          s.openaiCompatible.baseUrl = p.baseUrl;
          s.openaiCompatible.model = p.model;
          s.openaiCompatible.models = ensureModelList(s.openaiCompatible.models, p.model);
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Base URL")
      .addText((t) =>
        t.setPlaceholder("https://api.openai.com/v1").setValue(s.openaiCompatible.baseUrl).onChange(async (v) => {
          s.openaiCompatible.baseUrl = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("留空则仅支持无需鉴权的本地服务（如 Ollama）")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("sk-…").setValue(s.openaiCompatible.apiKey).onChange(async (v) => {
          s.openaiCompatible.apiKey = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("模型")
      .addText((t) =>
        t.setPlaceholder("gpt-4o-mini").setValue(s.openaiCompatible.model).onChange(async (v) => {
          s.openaiCompatible.model = v.trim();
          s.openaiCompatible.models = ensureModelList(s.openaiCompatible.models, s.openaiCompatible.model);
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("模型列表")
      .setDesc("可配置多个模型，聊天输入框下方可切换。支持逗号或换行分隔。")
      .addTextArea((ta) => {
        ta.setValue(s.openaiCompatible.models.join("\n")).onChange(async (v) => {
          s.openaiCompatible.models = parseModelList(v);
          await this.plugin.saveSettings();
        });
        ta.inputEl.rows = 3;
        ta.inputEl.addClass("aio-textarea");
      });

    new Setting(containerEl)
      .setName("温度")
      .setDesc("0~2，越高越有创造性")
      .addSlider((sl) =>
        sl.setLimits(0, 2, 0.1).setValue(s.openaiCompatible.temperature).onChange(async (v) => {
          s.openaiCompatible.temperature = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("最大 Token")
      .addText((t) =>
        t.setValue(String(s.openaiCompatible.maxTokens)).onChange(async (v) => {
          s.openaiCompatible.maxTokens = Math.max(256, parseInt(v) || 4096);
          await this.plugin.saveSettings();
        })
      );

    // ---- Anthropic ----
    new Setting(containerEl).setName("Anthropic Claude").setHeading();
    new Setting(containerEl)
      .setName("启用")
      .addToggle((t) => t.setValue(s.anthropic.enabled).onChange(async (v) => {
        s.anthropic.enabled = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("API Key")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("sk-ant-…").setValue(s.anthropic.apiKey).onChange(async (v) => {
          s.anthropic.apiKey = v.trim();
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("模型")
      .addText((t) =>
        t.setPlaceholder("claude-3-5-sonnet-latest").setValue(s.anthropic.model).onChange(async (v) => {
          s.anthropic.model = v.trim();
          s.anthropic.models = ensureModelList(s.anthropic.models, s.anthropic.model);
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("模型列表")
      .setDesc("聊天输入框下方可切换。支持逗号或换行分隔。")
      .addTextArea((ta) => {
        ta.setValue(s.anthropic.models.join("\n")).onChange(async (v) => {
          s.anthropic.models = parseModelList(v);
          await this.plugin.saveSettings();
        });
        ta.inputEl.rows = 3;
        ta.inputEl.addClass("aio-textarea");
      });
    new Setting(containerEl)
      .setName("温度")
      .addSlider((sl) =>
        sl.setLimits(0, 2, 0.1).setValue(s.anthropic.temperature).onChange(async (v) => {
          s.anthropic.temperature = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("最大 Token")
      .addText((t) =>
        t.setValue(String(s.anthropic.maxTokens)).onChange(async (v) => {
          s.anthropic.maxTokens = Math.max(256, parseInt(v) || 4096);
          await this.plugin.saveSettings();
        })
      );

    // ---- Gemini ----
    new Setting(containerEl).setName("Google Gemini").setHeading();
    new Setting(containerEl)
      .setName("启用")
      .addToggle((t) => t.setValue(s.gemini.enabled).onChange(async (v) => {
        s.gemini.enabled = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("API Key")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("AIza…").setValue(s.gemini.apiKey).onChange(async (v) => {
          s.gemini.apiKey = v.trim();
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("模型")
      .addText((t) =>
        t.setPlaceholder("gemini-1.5-pro").setValue(s.gemini.model).onChange(async (v) => {
          s.gemini.model = v.trim();
          s.gemini.models = ensureModelList(s.gemini.models, s.gemini.model);
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("模型列表")
      .setDesc("聊天输入框下方可切换。支持逗号或换行分隔。")
      .addTextArea((ta) => {
        ta.setValue(s.gemini.models.join("\n")).onChange(async (v) => {
          s.gemini.models = parseModelList(v);
          await this.plugin.saveSettings();
        });
        ta.inputEl.rows = 3;
        ta.inputEl.addClass("aio-textarea");
      });
    new Setting(containerEl)
      .setName("温度")
      .addSlider((sl) =>
        sl.setLimits(0, 2, 0.1).setValue(s.gemini.temperature).onChange(async (v) => {
          s.gemini.temperature = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("最大 Token")
      .addText((t) =>
        t.setValue(String(s.gemini.maxTokens)).onChange(async (v) => {
          s.gemini.maxTokens = Math.max(256, parseInt(v) || 4096);
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 排版 ----------
  private renderModelProfiles(containerEl: HTMLElement): void {
    const s = this.plugin.settings;
    const textProfiles = this.plugin.chatService.getConfiguredProfiles("text");
    const visionProfiles = this.plugin.chatService.getConfiguredProfiles("vision");

    const bar = containerEl.createDiv({ cls: "aio-model-config-bar" });
    const copy = bar.createDiv({ cls: "aio-model-config-copy" });
    copy.createDiv({ cls: "aio-model-config-title", text: "模型列表" });
    copy.createDiv({
      cls: "aio-model-config-desc",
      text: "每个模型单独保存提供商、URL、Key 和模型 ID；聊天、翻译、排版等功能会使用当前选中的模型。",
    });
    const addBtn = bar.createEl("button", { cls: "aio-model-add-btn", text: "添加模型" });
    addBtn.addEventListener("click", async () => {
      s.modelProfiles.push(this.createEmptyProfile("openaiCompatible"));
      await this.plugin.saveSettings();
      this.display();
    });

    const localVision = containerEl.createDiv({ cls: "aio-local-vision-bar" });
    const localCopy = localVision.createDiv({ cls: "aio-local-vision-copy" });
    localCopy.createDiv({ cls: "aio-local-vision-title", text: "本地看图模型" });
    localCopy.createDiv({
      cls: "aio-local-vision-desc",
      text: "不打包模型文件；连接你本机的 Ollama / LM Studio。轻量默认用 moondream，可在卡片里改模型 ID。",
    });
    const localActions = localVision.createDiv({ cls: "aio-local-vision-actions" });
    const ollamaVisionBtn = localActions.createEl("button", { cls: "aio-model-profile-btn", text: "添加 Ollama 视觉" });
    ollamaVisionBtn.addEventListener("click", async () => {
      const profile = this.createLocalVisionProfile("ollama");
      s.modelProfiles.push(profile);
      s.activeVisionModelProfileId = profile.id;
      await this.plugin.saveSettings();
      this.display();
    });
    const lmStudioVisionBtn = localActions.createEl("button", { cls: "aio-model-profile-btn", text: "添加 LM Studio 视觉" });
    lmStudioVisionBtn.addEventListener("click", async () => {
      const profile = this.createLocalVisionProfile("lmstudio");
      s.modelProfiles.push(profile);
      s.activeVisionModelProfileId = profile.id;
      await this.plugin.saveSettings();
      this.display();
    });

    new Setting(containerEl)
      .setName("当前文本模型")
      .setDesc(textProfiles.length > 0 ? "对话、排版、翻译和元数据默认使用这个模型。" : "还没有可用文本模型。")
      .addDropdown((dd) => {
        if (textProfiles.length === 0) {
          dd.addOption("", "未配置文本模型");
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
      .setName("当前视觉模型")
      .setDesc("多个视觉模型时，只使用这里选中的一个；不使用视觉模型时走内置 OCR 兜底。")
      .addDropdown((dd) => {
        dd.addOption("", "不使用视觉模型");
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
      list.createDiv({ cls: "aio-model-empty", text: "还没有模型。点击“添加模型”开始配置。" });
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
    title.createDiv({ cls: "aio-model-profile-name", text: profile.name || profile.model || "未命名模型" });
    title.createDiv({
      cls: "aio-model-profile-meta",
      text: `${this.providerName(profile.providerId)} · ${profile.model || "未填写模型 ID"}`,
    });
    const actions = head.createDiv({ cls: "aio-model-profile-actions" });
    const activeBtn = actions.createEl("button", {
      cls: "aio-model-profile-btn",
      text: this.activeProfileButtonText(profile),
    });
    activeBtn.addEventListener("click", async () => {
      if (!this.profileReady(profile)) {
        notify("请填写完整的 URL、API Key 和模型 ID");
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
    const deleteBtn = actions.createEl("button", { cls: "aio-model-profile-btn is-danger", text: "删除" });
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
      .setName("启用")
      .addToggle((toggle) =>
        toggle.setValue(profile.enabled).onChange(async (value) => {
          profile.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(card)
      .setName("显示名称")
      .addText((text) =>
        text.setPlaceholder("例如：DeepSeek 写作").setValue(profile.name).onChange(async (value) => {
          profile.name = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(card)
      .setName("用途")
      .setDesc("文本模型用于对话和文档处理；视觉模型只在图片上下文时作为辅助分析。")
      .addDropdown((dd) =>
        dd
          .addOption("text", "文本模型")
          .addOption("vision", "视觉模型")
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
      .setName("提供商")
      .addDropdown((dd) =>
        dd
          .addOption("openaiCompatible", "OpenAI 兼容接口")
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
      .setDesc(profile.providerId === "openaiCompatible" ? "不同兼容服务填自己的接口地址，例如 DeepSeek、通义、Ollama。" : "官方服务可留空，使用默认接口；代理或中转服务可填写自定义地址。")
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
      .setName("模型 ID")
      .addText((text) =>
        text.setPlaceholder(this.modelPlaceholder(profile.providerId, profile.kind ?? "text")).setValue(profile.model).onChange(async (value) => {
          profile.model = value.trim();
          if (!profile.name) profile.name = profile.model;
          await this.plugin.saveSettings();
        })
      );

    new Setting(card)
      .setName("温度")
      .addSlider((slider) =>
        slider.setLimits(0, 2, 0.1).setValue(profile.temperature ?? 0.7).onChange(async (value) => {
          profile.temperature = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(card)
      .setName("最大 Token")
      .addText((text) =>
        text.setValue(String(profile.maxTokens ?? 4096)).onChange(async (value) => {
          profile.maxTokens = Math.max(256, parseInt(value) || 4096);
          await this.plugin.saveSettings();
        })
      );

    new Setting(card)
      .setName("上下文窗口")
      .setDesc("用于对话输入框右上角圆圈估算上下文占用；按实际模型填，例如 8192、32768、128000。")
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
      name: isOllama ? "Ollama 本地看图" : "LM Studio 本地看图",
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
    if (providerId === "openaiCompatible") return "OpenAI 兼容";
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
      return profile.id === this.plugin.settings.activeVisionModelProfileId ? "当前视觉" : "设为视觉";
    }
    return profile.id === this.plugin.settings.activeTextModelProfileId ? "当前文本" : "设为文本";
  }

  private renderFormatting(): void {
    const containerEl = this.createSection("排版", "统一 Markdown 结构、标点、空行和自定义排版模板。", "pilcrow");
    const s = this.plugin.settings;

    // 模式下拉框：内置 + 自定义模板
    new Setting(containerEl)
      .setName("默认排版模式")
      .addDropdown((dd) => {
        dd.addOption("full", "全面排版")
          .addOption("markdown", "Markdown 语法规范")
          .addOption("structure", "标题/结构优化")
          .addOption("spacing", "中英混排/标点");
        for (const t of s.formatting.customTemplates) {
          dd.addOption(t.name, `自定义：${t.name}`);
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
      .setName("排版前预览")
      .setDesc("应用前弹出预览（含差异视图），防止破坏原文")
      .addToggle((t) =>
        t.setValue(s.formatting.previewBeforeApply).onChange(async (v) => {
          s.formatting.previewBeforeApply = v;
          await this.plugin.saveSettings();
        })
      );

    // ---- 自定义模板管理 ----
    new Setting(containerEl)
      .setName("自定义排版模板")
      .setDesc("自定义模板会出现在「默认排版模式」下拉框中")
      .addButton((btn) =>
        btn.setButtonText("＋ 新建模板").setCta().onClick(() => {
          new TemplateEditModal(this.app, null, async (template) => {
            if (s.formatting.customTemplates.some((t) => t.name === template.name)) {
              notify("模板名称已存在，请更换名称");
              return;
            }
            s.formatting.customTemplates.push(template);
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );

    for (const t of s.formatting.customTemplates) {
      const row = new Setting(containerEl)
        .setName(`自定义：${t.name}`)
        .setDesc(this.previewPrompt(t.prompt));
      row.addButton((btn) =>
        btn.setButtonText("编辑").onClick(() => {
          new TemplateEditModal(this.app, t, async (updated) => {
            const idx = s.formatting.customTemplates.findIndex((x) => x.name === t.name);
            if (idx >= 0) s.formatting.customTemplates[idx] = updated;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );
      row.addButton((btn) =>
        btn.setButtonText("删除").onClick(async () => {
          s.formatting.customTemplates = s.formatting.customTemplates.filter(
            (x) => x.name !== t.name
          );
          if (s.formatting.mode === t.name) s.formatting.mode = "full";
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
    const containerEl = this.createSection("图片与附件", "把笔记图片移动到固定目录，按笔记整理并处理未引用附件。", "image");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("附件根目录")
      .setDesc("图片将移动到此目录（相对库根）")
      .addText((t) =>
        t.setPlaceholder("attachments").setValue(s.imageOrg.attachmentRoot).onChange(async (v) => {
          s.imageOrg.attachmentRoot = v.trim();
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("按笔记分子文件夹")
      .setDesc("移动到「附件根/笔记名/」而不是平铺在根目录")
      .addToggle((t) =>
        t.setValue(s.imageOrg.subfolderPerNote).onChange(async (v) => {
          s.imageOrg.subfolderPerNote = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("自动重命名")
      .setDesc("重命名为「笔记名-序号.ext」，避免重名冲突")
      .addToggle((t) =>
        t.setValue(s.imageOrg.renameImages).onChange(async (v) => {
          s.imageOrg.renameImages = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("检查未引用附件")
      .setDesc("整理时同时扫描未被任何笔记引用的图片")
      .addToggle((t) =>
        t.setValue(s.imageOrg.checkOrphans).onChange(async (v) => {
          s.imageOrg.checkOrphans = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("视觉上下文图片上限")
      .setDesc("当前笔记或选中文本含图片时，最多发送多少张给视觉模型。默认 20。")
      .addText((t) =>
        t.setValue(String(s.imageOrg.visionMaxImages ?? 20)).onChange(async (v) => {
          s.imageOrg.visionMaxImages = Math.min(200, Math.max(1, parseInt(v) || 20));
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("视觉单图大小上限（MB）")
      .setDesc("超过这个大小的图片不会发送给视觉模型，只把文件名作为文本上下文说明。默认 5MB。")
      .addText((t) =>
        t.setValue(String(s.imageOrg.visionMaxImageSizeMB ?? 5)).onChange(async (v) => {
          s.imageOrg.visionMaxImageSizeMB = Math.min(50, Math.max(1, parseInt(v) || 5));
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("内置 OCR 兜底")
      .setDesc("视觉模型未配置或调用失败时，插件内置 OCR 会先读图中文字，再交给文本模型理解。")
      .addToggle((t) =>
        t.setValue(s.imageOrg.ocrFallbackEnabled !== false).onChange(async (v) => {
          s.imageOrg.ocrFallbackEnabled = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("OCR 语言")
      .setDesc("内置 OCR 使用的语言包。中文+英文默认 chi_sim+eng；英文可用 eng；繁体可用 chi_tra+eng。")
      .addText((t) =>
        t.setPlaceholder("chi_sim+eng").setValue(s.imageOrg.ocrLanguages ?? "chi_sim+eng").onChange(async (v) => {
          s.imageOrg.ocrLanguages = v.trim() || "chi_sim+eng";
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 元数据 ----------

  private renderMetadata(): void {
    const containerEl = this.createSection("元数据", "生成标签、摘要和别名，写入笔记 frontmatter。", "tags");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("生成标签")
      .addToggle((t) =>
        t.setValue(s.metadata.generateTags).onChange(async (v) => {
          s.metadata.generateTags = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("生成摘要")
      .addToggle((t) =>
        t.setValue(s.metadata.generateSummary).onChange(async (v) => {
          s.metadata.generateSummary = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("生成别名")
      .addToggle((t) =>
        t.setValue(s.metadata.generateAliases).onChange(async (v) => {
          s.metadata.generateAliases = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("语言")
      .addText((t) =>
        t.setPlaceholder("中文").setValue(s.metadata.language).onChange(async (v) => {
          s.metadata.language = v.trim() || "中文";
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("标签数量上限")
      .addText((t) =>
        t.setValue(String(s.metadata.maxTags)).onChange(async (v) => {
          s.metadata.maxTags = Math.min(20, Math.max(1, parseInt(v) || 10));
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 收件箱 ----------
  private renderInbox(): void {
    const containerEl = this.createSection("收件箱", "分析 Inbox 中的笔记，并建议移动到更合适的目录。", "inbox");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("收件箱文件夹")
      .setDesc("此目录下的笔记将被一键分类")
      .addText((t) =>
        t.setPlaceholder("Inbox").setValue(s.inbox.inboxFolder).onChange(async (v) => {
          s.inbox.inboxFolder = v.trim();
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("允许创建新文件夹")
      .setDesc("没有合适目录时，AI 可建议新建")
      .addToggle((t) =>
        t.setValue(s.inbox.allowCreateFolder).onChange(async (v) => {
          s.inbox.allowCreateFolder = v;
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 双链 ----------
  private renderLinks(): void {
    const containerEl = this.createSection("双链建议", "基于当前笔记内容推荐相关笔记。", "link-2");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("建议数量上限")
      .addText((t) =>
        t.setValue(String(s.links.maxSuggestions)).onChange(async (v) => {
          s.links.maxSuggestions = Math.min(15, Math.max(1, parseInt(v) || 5));
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("候选笔记上限")
      .setDesc("参与推荐的笔记数量，过大可能超出模型上下文")
      .addText((t) =>
        t.setValue(String(s.links.candidateLimit)).onChange(async (v) => {
          s.links.candidateLimit = Math.min(2000, Math.max(10, parseInt(v) || 300));
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 批量 ----------
  private renderBatch(): void {
    const containerEl = this.createSection("批量处理", "对多篇笔记连续执行排版、元数据或翻译任务。", "list-checks");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("每篇间隔（毫秒）")
      .setDesc("避免请求过快触发限流")
      .addText((t) =>
        t.setValue(String(s.batch.delayMs)).onChange(async (v) => {
          s.batch.delayMs = Math.max(0, parseInt(v) || 0);
          await this.plugin.saveSettings();
        })
      );
  }

  // ---------- 翻译 ----------
  private renderTranslate(): void {
    const containerEl = this.createSection("翻译", "设置选中文本翻译的默认语言与专用小模型。", "languages");
    const s = this.plugin.settings;
    const textProfiles = this.plugin.chatService.getConfiguredProfiles("text");

    new Setting(containerEl)
      .setName("翻译默认模型")
      .setDesc("建议选择速度快、价格低的小文本模型；不选则回退到当前对话文本模型。")
      .addDropdown((dd) => {
        dd.addOption("", "自动：当前文本模型");
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
      .setName("默认目标语言")
      .addText((t) =>
        t.setPlaceholder("中文").setValue(s.translate.defaultTarget).onChange(async (v) => {
          s.translate.defaultTarget = v.trim() || "中文";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("常用目标语言")
      .setDesc("翻译小框里可快速切换。支持换行或逗号分隔。")
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
    const containerEl = this.createSection("对话", "控制工作台的上下文注入和对话保存位置。", "messages-square");
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("对话保存文件夹")
      .addText((t) =>
        t.setPlaceholder("AI 对话").setValue(s.chat.saveFolder).onChange(async (v) => {
          s.chat.saveFolder = v.trim() || "AI 对话";
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("默认注入当前笔记")
      .addToggle((t) =>
        t.setValue(s.chat.injectCurrentNote).onChange(async (v) => {
          s.chat.injectCurrentNote = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("默认注入选中文本")
      .addToggle((t) =>
        t.setValue(s.chat.injectSelection).onChange(async (v) => {
          s.chat.injectSelection = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("系统提示词")
      .setDesc("控制 AI 的默认行为与语气")
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
    const containerEl = this.createSection("浏览位置记忆", "打开笔记时自动回到上次浏览的滚动位置。", "book-marked");
    const s = this.plugin.settings;
    new Setting(containerEl)
      .setName("记住并恢复浏览位置")
      .setDesc("切换文档后重新打开，自动滚动到上次的位置并恢复光标行。")
      .addToggle((t) =>
        t.setValue(s.scrollRestore.enabled).onChange(async (v) => {
          s.scrollRestore.enabled = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
