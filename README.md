# AI Organizer (obsidian-ai-organizer)

> 一个「排版 · 整理 · 对话」三位一体的 Obsidian AI 插件，支持多种模型。

![GitHub release](https://img.shields.io/badge/version-0.1.0-blue)
![Obsidian](https://img.shields.io/badge/Obsidian-1.0%2B-purple)

## ✨ 功能总览

| 模块 | 说明 |
| --- | --- |
| 🤖 **AI 排版** | 全面排版 / Markdown 语法规范 / 标题结构优化 / 中英混排，支持**自定义排版模板**，应用前提供原文·排版后·差异三视图预览 |
| ✍️ **AI 编辑选中文本** | 润色 / 扩写 / 续写 / 压缩选中文本，生成后可预览再应用到编辑器 |
| 🖼️ **一键图片整理** | 扫描笔记引用的图片 → 移动到指定附件目录（可按笔记分子文件夹）→ 自动重命名 → 自动更新链接 |
| 💬 **AI 多模型对话** | 侧边栏对话面板，流式输出，可注入当前笔记与选中文本，对话可保存为笔记 |
| 🏷️ **AI 标签/摘要** | 一键为笔记生成 tags、summary、aliases 写入 frontmatter |
| 📥 **智能收件箱整理** | 一键将 Inbox 草稿按内容自动分类到对应文件夹（可手动修正） |
| 🔗 **AI 双链建议** | 根据笔记内容推荐相关笔记，一键建立双向链接 |
| ⚡ **批量 AI 处理** | 对多篇笔记批量执行排版 / 生成元数据 / 翻译 |
| 🌐 **AI 翻译** | 选中文本一键翻译，保留 Markdown 结构 |

## 🧠 支持的模型

插件采用统一的提供商架构，**OpenAI 兼容接口**一个配置即可覆盖绝大多数服务：

| 提供商 | 说明 | Base URL 预设 |
| --- | --- | --- |
| **OpenAI 兼容接口** | 统一覆盖 OpenAI / DeepSeek / 通义千问 / 智谱 GLM / Kimi(Moonshot) / Ollama 本地 / vLLM 等 | ✅ 设置页一键填充 |
| **Anthropic Claude** | 原生 Messages API | — |
| **Google Gemini** | 原生 GenerateContent API | — |

> 只需填 `Base URL + API Key + 模型名`，设置页提供 DeepSeek、通义、智谱、Kimi、Ollama 等常用预设。

## 📦 安装

### 手动安装（开发/自用）

1. 构建插件：`npm install && npm run build`
2. 将仓库拷贝到库目录：`<你的Vault>/.obsidian/plugins/ai-organizer/`
3. 在 Obsidian → 设置 → 第三方插件 → 启用 **AI Organizer**

### 从源码开发调试

```bash
npm install
npm run dev     # 监听模式，改动自动重新打包
```

然后安装 [Hot Reload](https://github.com/pjeby/hot-reload) 插件即可热更新。

## ⚙️ 快速开始

1. 打开 **设置 → AI Organizer**，选择提供商并填写 API Key（可用「快速预设」一键填充）
2. 点击左侧功能区 🤖 图标或命令面板输入 **打开 AI 对话面板**，开始对话
3. 更多命令见下方「命令面板」

## ⌨️ 命令面板

| 命令 | 说明 |
| --- | --- |
| 打开 AI 对话面板 | 打开/聚焦右侧对话侧边栏 |
| AI 排版当前笔记 | 对当前笔记执行排版（默认先预览，支持自定义模板） |
| 一键整理当前笔记的图片 | 移动图片到附件目录并更新链接 |
| 扫描未引用附件 | 找出未被任何笔记引用的附件 |
| AI 生成标签/摘要/别名 | 写入 frontmatter |
| 智能整理收件箱 | AI 分类收件箱笔记并确认移动 |
| AI 推荐相关笔记（双链） | 推荐并添加 `[[链接]]` |
| 批量 AI 处理 | 选择多篇笔记 + 操作类型 |
| AI 翻译选中文本 | 翻译编辑器中选中的文本 |
| AI 编辑选中文本 | 润色 / 扩写 / 续写 / 压缩选中文本 |

## 🛠️ 开发

```text
src/
├── main.ts               # 主入口：命令注册与功能接线
├── settings.ts           # 设置结构与持久化
├── types.ts              # 共享类型
├── providers/            # 多模型提供商（OpenAI兼容 / Claude / Gemini / 流式解析）
├── core/                 # 核心服务
│   ├── chatService.ts    #   对话（上下文注入 / 保存）
│   ├── formatting.ts     #   AI 排版
│   ├── imageOrganizer.ts #   图片整理 / 孤儿扫描
│   ├── metadataGenerator.ts # 标签摘要
│   ├── inboxOrganizer.ts #   收件箱整理
│   ├── linkSuggester.ts  #   双链建议
│   ├── batchProcessor.ts #   批量处理
│   ├── translator.ts     #   翻译
│   ├── textEditor.ts     #   润色/扩写/续写/压缩
│   └── diff.ts           #   LCS 行级 diff
└── ui/                   # 对话面板 / 设置页 / 各功能模态框（含模板编辑）
```

### 构建

```bash
npm run build     # 类型检查 + 打包 main.js
```

## 🗺️ Roadmap

- [ ] 排版模式自定义提示词模板
- [ ] 图片压缩 / 转 WebP（减小库体积）
- [ ] 每日回顾：自动汇总库内新增/修改笔记
- [ ] 对话上下文注入更多来源（标签、日记、搜索结果）
- [ ] 多语言本地化（i18n）

## 📄 License

MIT
