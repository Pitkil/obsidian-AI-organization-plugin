<div align="center">

# AI Organizer for Obsidian

**An all-in-one AI workspace for Obsidian** — contextual chat, selection actions, translation, OCR-assisted image understanding, smart note formatting, attachment organization, Zotero-style annotations, metadata generation, inbox sorting, link suggestions, and batch processing, all inside your note-taking workflow.

<p>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.2-0f766e">
  <img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.8%2B-6b7280">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6">
  <img alt="Tests" src="https://img.shields.io/badge/tests-Vitest-22c55e">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-111827">
</p>

<p>
  <a href="#features">Features</a>
  ·
  <a href="#screenshots">Screenshots</a>
  ·
  <a href="#installation">Installation</a>
  ·
  <a href="#model-setup">Model Setup</a>
  ·
  <a href="#usage">Usage</a>
  ·
  <a href="#commands">Commands</a>
</p>

<p>
  <strong>🌐 Language</strong>：
  <a href="README.md"><strong>English</strong></a>
  ·
  <a href="README.zh-CN.md">中文</a>
</p>

</div>

---

### 📦 About this repository

| | |
| --- | --- |
| **GitHub repository** | [Pitkil/obsidian-AI-organization-plugin](https://github.com/Pitkil/obsidian-AI-organization-plugin) |
| **Obsidian plugin page** | <https://obsidian.md/plugins?id=ai-organizer> |
| **Obsidian community plugins** | `Settings → Community plugins → Browse → search "AI Organizer"` |
| **Install via BRAT** | `Obsidian://brat?plugin=Pitkil/obsidian-AI-organization-plugin` |
| **Releases** | <https://github.com/Pitkil/obsidian-AI-organization-plugin/releases> |
| **Issue tracker** | <https://github.com/Pitkil/obsidian-AI-organization-plugin/issues> |
| **Author** | [Wang Yilai](https://github.com/Pitkil) |

> 📌 **Not yet in the official marketplace?** Install manually or via [BRAT](https://github.com/TfTHacker/obsidian42-brat) using the links above. See [Installation](#installation) for step-by-step instructions.

---

<p align="center">
  <img src="docs/screenshots/01-chat-workspace.png" alt="AI Organizer chat workspace" width="100%">
</p>

AI Organizer is designed for people who work inside long notes and knowledge bases. Instead of forcing every task into a separate chatbot, it lets you act on selected text, ask questions about the current note, process images, keep reading annotations, and organize attachments without leaving Obsidian.

## Features

| Feature | Description |
| --- | --- |
| Multi-model profiles | Configure multiple model profiles with independent provider, base URL, API key, model ID, model type, context window, temperature, and max tokens. |
| Text and vision model separation | Use text models for writing tasks and choose a separate vision model for image-aware chat. |
| OpenAI-compatible endpoints | Works with OpenAI, DeepSeek, Qwen, GLM, Kimi, Ollama, LM Studio, vLLM, and other compatible services. |
| Selection toolbar | Select text in the editor to translate, explain, polish, expand, summarize, annotate, or ask about it. |
| Translation popover | Review translations before replacing text, copying the result, or saving it as an annotation. |
| Annotation workflow | Store reading notes, thoughts, questions, and translation notes outside the Markdown body, with lightweight anchors in the editor. |
| Contextual chat sidebar | Chat with the current note, selected text, pasted images, note images, and prior conversation history. |
| Context usage meter | Estimate how much of the selected model context is being used before sending a message. |
| Image understanding | Read images from notes or chat attachments with a configured vision model, with OCR fallback when vision is unavailable. |
| Smart formatting | Format long Markdown notes with preview, diff view, and safety checks before applying changes. |
| Image organization | Move referenced images into a chosen folder and rewrite Wiki links and Markdown image links automatically. |
| Metadata generation | Generate frontmatter tags, summaries, and aliases for the active note. |
| Inbox organization | Review AI-suggested destinations for inbox notes before moving files. |
| Link suggestions | Suggest related notes and insert them into a related-notes section. |
| Batch processing | Run formatting, metadata generation, or translation across multiple notes with pacing controls. |
| Scroll restoration | Return to the last reading position when reopening a note. |

## Screenshots

### Chat workspace

The chat sidebar understands the active note, selected text, image attachments, and configured model profiles. The workbench controls can be collapsed so the conversation stays focused.

<p align="center">
  <img src="docs/screenshots/01-chat-workspace.png" alt="AI Organizer chat workspace" width="100%">
</p>

### Selection toolbar

The editor selection toolbar appears near selected text and exposes the actions that make sense in reading and editing context.

<p align="center">
  <img src="docs/screenshots/02-selection-toolbar.png" alt="Selection toolbar" width="88%">
</p>

### Translation popover

Translations stay in a small review panel. You can replace the original text, copy the result, or save the translation and your own thought as annotations.

<p align="center">
  <img src="docs/screenshots/04-translation-popover.png" alt="Translation popover" width="88%">
</p>

### Annotations

Annotations are stored by the plugin instead of being inserted into the Markdown body. They can be edited, deleted, located, and exported.

<p align="center">
  <img src="docs/screenshots/07-annotation-panel.png" alt="Annotation panel" width="72%">
</p>

### Model settings

Each model profile is configured independently. You can define text models and vision models, including local OpenAI-compatible services.

<p align="center">
  <img src="docs/screenshots/08-model-settings.png" alt="Model settings" width="80%">
</p>

### Image context

When a note or selected text contains images, AI Organizer can pass them to the selected vision model. If that fails or no vision model is configured, OCR can extract visible text for the text model.

<p align="center">
  <img src="docs/screenshots/10-image-context.png" alt="Image context" width="100%">
</p>

### Image organization

Choose the destination folder for each image organization run and decide whether images should be renamed for the current note.

<p align="center">
  <img src="docs/screenshots/11-image-organize.png" alt="Image organization modal" width="70%">
</p>

### Formatting preview

Formatting results are reviewed before writing to the note. The plugin blocks empty, suspiciously short, or image-dropping results.

<p align="center">
  <img src="docs/screenshots/09-format-preview.png" alt="Formatting preview" width="72%">
</p>

## Installation

### Option 1 — Official community plugin marketplace

1. Open Obsidian and go to `Settings → Community plugins`.
2. Turn off `Restricted mode` if it is on.
3. Click `Browse`, search for **AI Organizer**, and click `Install`.
4. After installation, click `Enable`.

Direct link once listed: <https://obsidian.md/plugins?id=ai-organizer>

### Option 2 — Install via BRAT (beta releases)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs plugins directly from a GitHub repository.

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. Open its settings and choose `Add a beta plugin for testing`.
3. Enter the repository: `Pitkil/obsidian-AI-organization-plugin`
4. Click `Add Plugin` and enable **AI Organizer** afterwards.

You can also open the pre-filled link: `Obsidian://brat?plugin=Pitkil/obsidian-AI-organization-plugin`

### Option 3 — Manual installation

1. Download the latest `main.js`, `manifest.json`, and `styles.css` from the [Releases](https://github.com/Pitkil/obsidian-AI-organization-plugin/releases) page (or from the repository root for the latest build).
2. Create this folder in your vault:

   ```text
   <your-vault>/.obsidian/plugins/ai-organizer/
   ```

3. Copy these files into the folder:

   ```text
   manifest.json
   main.js
   styles.css
   ```

4. Open Obsidian, go to `Settings -> Community plugins`, disable Restricted mode if needed, and enable `AI Organizer`.

### Build from source

```bash
npm install
npm run build
```

The build creates `main.js` in the repository root. Obsidian needs `main.js`, `manifest.json`, and `styles.css` to load the plugin.

### Development

```bash
npm run dev
```

Using Obsidian's Hot Reload plugin is recommended during development.

## Model Setup

AI Organizer uses model profiles. Each profile has its own provider, endpoint, credentials, model ID, model type, context window, temperature, and max-token setting.

| Field | Meaning |
| --- | --- |
| Name | Display name shown in the chat input. |
| Provider | OpenAI-compatible, Anthropic Claude, or Google Gemini. |
| Model type | Text model or vision model. |
| Base URL | API endpoint. OpenAI-compatible profiles can point to local or third-party services. |
| API Key | Usually required for remote services. Local Ollama or LM Studio endpoints may leave it empty. |
| Model ID | The actual model name sent to the API. |
| Context window | Used to estimate the context usage meter. |
| Temperature and Max Token | Control randomness and maximum output length. |

### Text and vision models

- Text models handle chat, translation, explanation, polishing, formatting, summarization, metadata, and link suggestions.
- Vision models handle image-aware questions, screenshots, diagrams, and document images.
- If multiple vision models are configured, AI Organizer uses the currently selected default vision model.
- If no vision model is available or the vision request fails, OCR can extract text from images and pass it to the text model.

### OCR fallback

AI Organizer includes `tesseract.js` as a local OCR fallback. OCR is useful for screenshots, scans, and text-heavy diagrams, but it is not a full vision-language model. For screenshots, layouts, photographs, or visual reasoning tasks, configure a real vision model when possible.

## Usage

### Selection actions

Select text in the editor to open the floating toolbar.

| Action | Result |
| --- | --- |
| Translate | Opens a translation popover with language switching, copy, replace, and annotation actions. |
| Explain | Explains the selected text. |
| Polish | Improves wording while preserving meaning. |
| Expand | Adds more detail to the selected text. |
| Summarize | Condenses selected text into key points. |
| Note | Adds your own thought, question, or TODO as an annotation. |
| Ask | Sends the selected text into the chat context. |

When AI replaces text, the modified range is briefly highlighted and an undo control is shown. Obsidian undo also works.

### Chat workflow

- Uses the current note and selected text as context.
- Supports pasted or dragged image attachments.
- Detects images referenced by the active note or selected text.
- Shows the current context source in the input area.
- Shows a context usage meter in the input corner.
- Lists only configured and usable models.
- Restores recent chat history when the sidebar is reopened.
- Can save conversations as Markdown notes.

### Image organization

The image organizer scans images referenced by the current note, asks for a destination folder for the current run, optionally renames files, moves them, and rewrites `![[image.png]]` and `![alt](image.png)` links.

Unused attachments are moved to an `未引用附件` folder instead of being deleted.

### Formatting

Formatting is preview-first. You can compare the original note, the formatted result, and the diff before applying changes. If a model returns empty content, truncates too aggressively, or drops image references, AI Organizer refuses to apply the result.

## Commands

| Command | Description |
| --- | --- |
| Open AI chat panel | Open or focus the AI chat sidebar. |
| Close AI chat sidebar | Close the AI Organizer chat view. |
| Open AI Organizer settings | Open plugin settings. |
| Restore last reading position | Return to the last recorded scroll position for the active note. |
| Format active note | Format the active note and open a preview. |
| Organize images in active note | Move referenced images and rewrite links. |
| Scan orphan attachments | Find unused attachments and move them to an archive folder. |
| Generate tags, summary, and aliases | Generate frontmatter metadata. |
| Organize inbox | Review and apply AI-suggested destinations for inbox notes. |
| Suggest related notes | Recommend related notes and insert links. |
| Batch AI processing | Run formatting, metadata, or translation across selected notes. |
| Translate selected text | Translate the current editor selection. |
| Edit selected text | Polish, expand, continue, or compress selected text. |
| Export current note annotations | Export annotations for the current note as Markdown. |

## Privacy

AI Organizer reads the active note, selected text, referenced images, and necessary vault file paths only for actions you trigger. Content sent to remote model providers depends on the selected provider and operation. If you use local services such as Ollama or LM Studio, processing can stay on your machine or local network.

The plugin may enumerate notes or attachments for features such as inbox organization, link suggestions, batch processing, and unused attachment scanning. It may also write to the clipboard when you explicitly copy a generated result.

## Limitations

- Long note context is truncated to keep requests manageable.
- Image context has a configurable per-request limit. This does not mean a document can only contain that many images.
- Only the selected default vision model is used for image-aware requests.
- OCR extracts visible text; it does not understand non-text visual content.
- Local OpenAI-compatible endpoints can omit API keys, but remote services usually require one.
- Annotation data is stored in plugin data, so sync plugin data if you use multiple devices.
- AI-generated formatting and edits should be reviewed before applying to important notes.

## Development

```bash
npm install
npm run build
npm test
```

| Script | Description |
| --- | --- |
| `npm run dev` | Watch source files and rebuild. |
| `npm run build` | Run TypeScript checks and bundle with esbuild. |
| `npm test` | Run Vitest tests. |
| `npm run test:watch` | Run tests in watch mode. |

## Project Structure

```text
src/
├── main.ts                  # Plugin entry, commands, editor interactions
├── settings.ts              # Settings schema, defaults, normalization
├── types.ts                 # Shared types
├── providers/               # OpenAI-compatible, Claude, Gemini, HTTP helpers
├── core/                    # Chat, formatting, OCR, images, metadata, inbox, links
├── ui/                      # Chat view, settings, modals, previews
└── utils/                   # Markdown, paths, notifications, anchors

test/                        # Vitest tests
```

## License

MIT License. See [LICENSE](LICENSE).

---

## 中文

完整的简体中文文档见 **[README.zh-CN.md](README.zh-CN.md)**。

For the full English documentation, see **[README.md](README.md)**.
