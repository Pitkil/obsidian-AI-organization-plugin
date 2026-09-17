<div align="center">

# AI Organizer for Obsidian

**真正理解笔记上下文的 AI 工作台：写作、阅读、图片理解与知识库整理，都在 Obsidian 内完成。**

<p>
  <a href="https://obsidian.md/plugins?id=ai-organizer"><img alt="从 Obsidian 安装" src="https://img.shields.io/badge/Obsidian-安装_AI_Organizer-7c3aed?logo=obsidian&logoColor=white"></a>
  <a href="https://github.com/Pitkil/obsidian-AI-organization-plugin/releases"><img alt="版本" src="https://img.shields.io/badge/release-0.1.3-0f766e"></a>
  <img alt="Obsidian 版本" src="https://img.shields.io/badge/Obsidian-1.8%2B-59636e">
  <a href="LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/badge/license-MIT-111827"></a>
</p>

<p>
  <a href="#为什么选择-ai-organizer">核心优势</a> ·
  <a href="#界面与交互">界面</a> ·
  <a href="#安装">安装</a> ·
  <a href="#配置">配置</a> ·
  <a href="#功能参考">功能参考</a> ·
  <a href="#隐私与限制">隐私</a>
</p>

<table>
  <tr>
    <th>安装</th>
    <td><a href="https://obsidian.md/plugins?id=ai-organizer"><strong>插件主页</strong></a> · <a href="obsidian://show-plugin?id=ai-organizer">在 Obsidian 中打开</a> · <a href="obsidian://brat?plugin=Pitkil/obsidian-AI-organization-plugin">BRAT</a></td>
  </tr>
  <tr>
    <th>项目</th>
    <td><a href="https://github.com/Pitkil/obsidian-AI-organization-plugin">GitHub 仓库</a> · <a href="https://github.com/Pitkil/obsidian-AI-organization-plugin/releases">发行版</a> · <a href="https://github.com/Pitkil/obsidian-AI-organization-plugin/issues">问题反馈</a> · <a href="https://github.com/Pitkil">作者主页</a></td>
  </tr>
  <tr>
    <th>语言</th>
    <td><a href="README.md">English</a> · <strong>简体中文</strong></td>
  </tr>
</table>

<img src="docs/screenshots/00-readme-hero.png" alt="AI Organizer for Obsidian" width="100%">

</div>

AI Organizer 把 AI 放进笔记本身。你可以直接翻译或改写选中的段落，结合当前笔记及其中图片进行对话，把阅读想法保存为不污染 Markdown 正文的锚点便签，并通过排版、元数据、双链、收件箱、附件和批处理工具维护整个知识库。

插件同时支持远程 API 与本地 OpenAI 兼容服务。文本模型和视觉模型独立配置；未配置视觉模型或调用失败时，还可以使用内置 OCR 提取图片中的可见文字。

## 为什么选择 AI Organizer

| | 能力 | 实际价值 |
| --- | --- | --- |
| **写作** | 选中文本快捷操作 | 不离开编辑器即可翻译、解释、润色、扩写、总结、添加便签或继续询问。 |
| **翻译** | 先审阅再应用 | 随时切换目标语言，可指定专用小模型；结果可复制、替换原文或保存为便签。 |
| **思考** | 锚点便签 | 翻译、想法、疑问和待办保存在 Markdown 正文之外，同时在原文旁留下可定位的轻量标识。 |
| **对话** | 真正的笔记上下文 | 可结合当前笔记、稳定选区、笔记内图片、粘贴/拖入图片与最近对话历史提问。 |
| **看图** | 视觉模型 + OCR 兜底 | 视觉模型负责图片理解；不可用时由内置 OCR 提取文字，再交给文本模型处理。 |
| **模型** | 多个独立模型配置 | 每个模型分别保存提供商、URL、Key、模型 ID、用途、上下文、温度和输出上限。 |
| **定制** | Prompt 可配置 | 可修改对话系统 Prompt，也可创建、编辑并选用自己的排版 Prompt 模板。 |
| **安全** | 预览式排版 | 应用前查看原文、结果和差异；空结果、异常截断或丢失图片引用时自动阻止写入。 |
| **整理** | 知识库维护工具 | 整理图片、重写链接、归档孤儿附件、生成元数据、整理收件箱、推荐双链和批处理。 |
| **专注** | 可收纳工作台 | 工作台可折叠；显示上下文与估算占用；只展示可用模型，并恢复历史对话与阅读位置。 |
| **语言** | 中英双语界面 | 可在设置页随时切换中文与 English 界面。 |

## 界面与交互

### 上下文会跟着你的操作走

侧边栏既可以读取整篇笔记，也可以固定当前选中的文字。插件会解析这个范围内引用的图片，通过当前视觉模型或 OCR 兜底进行分析，再把精简结果交给文本模型。输入框旁的圆环会根据当前模型设置的上下文窗口估算占用情况。

<p align="center">
  <img src="docs/screenshots/02-context-chat-and-ocr.png" alt="结合选中文本与图片 OCR 的上下文对话" width="100%">
</p>

### 工作台需要时展开，不用时收起

工作台集中放置笔记级操作，但不会一直挤占对话空间。只聊天时可以收起；需要排版、便签、元数据、双链、图片整理或收件箱时再展开。

<p align="center">
  <img src="docs/screenshots/03-collapsible-workbench.png" alt="可折叠对话工作台" width="42%"><br>
  <sub>可折叠的笔记工作台</sub>
</p>

在编辑器中选中文字，操作会直接出现在段落旁。目标语言可在工具栏中随时切换，其余常用操作保持一步可达。

<p align="center">
  <img src="docs/screenshots/04-selection-toolbar.png" alt="选中文本快捷工具栏" width="88%"><br>
  <sub>翻译、解释、润色、扩写、总结、便签和询问</sub>
</p>

### 便签附着在原文，而不是插入正文

便签由插件单独保存，不会追加到 Markdown 正文。你可以记录自己的想法，也可以保存翻译结果，之后从标识处回到对应段落。便签支持编辑、删除、定位和导出。

<p align="center">
  <img src="docs/screenshots/05-annotation-compose.png" alt="编写便签" width="48%"><br>
  <sub>记录想法、疑问或待办</sub>
</p>

<p align="center">
  <img src="docs/screenshots/06-annotation-anchor.png" alt="正文旁的便签锚点" width="76%"><br>
  <sub>轻量锚点标记对应原文</sub>
</p>

### 模型是独立配置，不是共用一套 Key

每个模型都拥有自己的接口和密钥。你可以保存多个文本或视觉模型，分别指定当前文本模型和当前视觉模型，也可以让翻译走更快、更便宜的小文本模型。

<p align="center">
  <img src="docs/screenshots/07-model-settings.png" alt="相互独立的文本与视觉模型配置" width="76%">
</p>

### 笔记中的图片也是上下文

可以把图片粘贴或拖入对话，也可以让插件读取当前笔记或选区引用的图片。单次请求的图片数量和文件大小均可配置；这不是对一篇文档图片总数的限制。

<p align="center">
  <img src="docs/screenshots/08-note-image-context.png" alt="可供上下文对话读取的笔记图片" width="100%">
</p>

### 排版结果始终可以先审阅

排版采用非独占加载流程，模型完成后再打开专用审阅窗口。应用前可以查看原文、排版结果和差异，确认无误后再写回笔记。

<p align="center">
  <img src="docs/screenshots/01-formatting-workflow.gif" alt="带预览与差异对比的排版流程" width="82%">
</p>

## 安装

### Obsidian 社区插件

1. 在 Obsidian 中打开 `设置 -> 第三方插件`。
2. 点击 `浏览`，搜索 **AI Organizer**。
3. 点击 `安装`，安装完成后点击 `启用`。

也可以直接打开 [AI Organizer 插件页面](https://obsidian.md/plugins?id=ai-organizer)。

### 通过 BRAT 安装

安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)，选择 `Add a beta plugin for testing`，然后输入：

```text
Pitkil/obsidian-AI-organization-plugin
```

### 手动安装

从最新 [Release](https://github.com/Pitkil/obsidian-AI-organization-plugin/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，放入：

```text
<你的仓库>/.obsidian/plugins/ai-organizer/
```

重新加载 Obsidian，然后在第三方插件中启用 **AI Organizer**。

## 配置

打开 `设置 -> AI Organizer`。使用对话及其他 AI 功能前，至少配置一个可用的文本模型。

### 模型配置

| 设置 | 用途 |
| --- | --- |
| 显示名称 | 对话输入框模型选择器中显示的名称。 |
| 用途 | 将模型标记为文本模型或视觉模型。 |
| 提供商 | OpenAI 兼容、Anthropic Claude 或 Google Gemini。 |
| Base URL | 每个模型独立的接口地址，适合代理、Ollama、LM Studio、vLLM 和第三方兼容接口。 |
| API Key | 每个模型独立保存；本机回环地址可以留空。 |
| 模型 ID | 实际发送给提供商的模型名称。 |
| 上下文窗口 | 用于计算对话中的上下文占用估算。 |
| 温度 / 最大 Token | 控制生成随机性和输出长度。 |

OpenAI 兼容配置可连接 OpenAI、DeepSeek、通义千问、智谱 GLM、Kimi、Ollama、LM Studio、vLLM 等提供兼容 Chat Completions API 的服务。插件也提供 Anthropic Claude 与 Google Gemini 的独立适配。

### 文本模型、视觉模型与 OCR

- 当前**文本模型**负责对话、写作、翻译、排版、元数据、收件箱分类和双链建议。
- 当前**视觉模型**负责笔记图片和对话附件。一次请求只使用当前选中的视觉模型。
- 设置页可快速新增 Ollama 或 LM Studio 的本地视觉模型配置；插件本身不打包视觉模型权重。
- 未配置视觉模型或视觉请求失败时，内置 `tesseract.js` 流程可提取图片中的可见文字，再交给文本模型。
- OCR 只是文字提取兜底，不等于视觉推理。公式、布局、图表和照片更适合使用真正的视觉模型。

### 自定义 Prompt

AI Organizer 提供两层实用的 Prompt 配置：

1. **对话系统 Prompt**：控制助手默认角色、语言、语气和回答方式。
2. **排版 Prompt 模板**：可以新建、编辑、删除具名模板，并把它选为默认排版模式。

同时保留全面排版、Markdown 语法、标题结构和中英混排/标点等内置模式。

### 翻译

可以设置默认目标语言、自定义常用语言列表，并选择专用的快速或低成本文本模型。没有指定翻译模型时，会自动回退到当前文本模型。

## 功能参考

### 选中文本

| 操作 | 行为 |
| --- | --- |
| 翻译 | 打开结果小窗，可切换语言、复制、替换原文或保存为便签。 |
| 解释 | 在保留原文的前提下解释选中内容。 |
| 润色 | 保留原意并优化表达。 |
| 扩写 | 为选中内容补充有用细节。 |
| 总结 | 把选中内容压缩为重点。 |
| 便签 | 把自己的想法、疑问或待办保存为锚点便签。 |
| 询问 | 将选中内容放入对话上下文，继续追问。 |

文本修改应用后会短暂高亮，并显示撤回操作；Obsidian 自带撤销历史仍然有效。

### 对话与上下文

- 当前笔记和选中文本可独立开关。
- 支持向输入框粘贴或拖入图片。
- 模型回复支持流式显示和停止生成。
- 输入框下方只显示已配置且可用的文本模型。
- 根据笔记/选区、历史、当前输入、图片和模型上下文窗口估算占用。
- 关闭后重新打开侧边栏，可恢复最近对话历史。
- 支持把对话保存为 Markdown，也可以清空当前历史。
- 工作台可折叠，避免占用对话空间。

### 排版与知识库整理

| 工具 | 功能 |
| --- | --- |
| 排版 | 使用内置模式或自定义 Prompt，并在应用前查看原文、结果和差异。 |
| 图片整理 | 将引用图片移动到本次选择的文件夹，可选重命名，并重写 Wiki/Markdown 图片链接。 |
| 孤儿附件 | 把未引用附件移动到归档文件夹，不直接删除。 |
| 元数据 | 按配置生成 frontmatter 标签、摘要和别名。 |
| 收件箱 | 文件移动前审阅 AI 推荐的目标目录，可允许创建新目录。 |
| 双链建议 | 审阅相关笔记候选项，并把接受的链接写入笔记。 |
| 批量处理 | 对选中的多篇笔记执行排版、元数据或翻译，可配置请求间隔。 |
| 浏览位置 | 重新打开笔记时恢复上次滚动位置与光标行。 |

### 命令

| 命令 | 说明 |
| --- | --- |
| 打开 AI 对话面板 | 打开或聚焦侧边栏。 |
| 关闭 AI 对话侧边栏 | 关闭 AI Organizer 视图。 |
| 打开 AI Organizer 设置 | 进入插件设置页。 |
| 回到上次浏览位置 | 返回当前笔记记录的位置。 |
| AI 排版当前笔记 | 执行排版并打开审阅预览。 |
| 一键整理当前笔记的图片 | 移动图片并重写引用。 |
| 扫描未引用附件 | 查找并归档未使用附件。 |
| AI 生成标签/摘要/别名 | 生成 frontmatter 元数据。 |
| 智能整理收件箱 | 审阅并应用收件箱目录建议。 |
| AI 推荐相关笔记（双链） | 审阅并插入相关笔记链接。 |
| 批量 AI 处理 | 处理多篇已选笔记。 |
| AI 翻译选中文本 | 对当前选区打开翻译流程。 |
| AI 编辑选中文本 | 润色、扩写、续写或压缩当前选区。 |
| 导出当前笔记的便签为笔记 | 将当前笔记便签导出为 Markdown。 |

## 隐私与限制

- AI 操作只在你主动触发时执行。根据功能不同，插件可能读取当前笔记、选区、引用图片、候选笔记标题或附件路径。
- 发送到远程提供商的内容受对方服务条款约束。使用 Ollama、LM Studio 等本地端点时，模型请求可以保留在本机或局域网。
- API Key 保存在 Obsidian 插件数据中，AI Organizer 不会额外加密；请妥善保护和同步该数据。
- OCR 使用 `tesseract.js`。本地识别运行前，OCR 运行时可能需要获取并缓存对应语言数据。
- 长笔记内容会在请求前截断。单次图片数量和大小可配置为 1–200 张、每张 1–50 MB，默认 20 张和 5 MB。
- 上下文圆环是估算值，不是提供商账单或精确 Token 统计；它依据配置的上下文窗口和近似 Token 数计算。
- 便签保存在插件数据中；多设备使用时需要同步插件数据才能同步便签。
- 对重要知识库应用生成的修改、元数据、双链和文件移动建议前，请先审阅。

## 开发

```bash
npm install
npm run dev
npm run build
npm test
```

| 脚本 | 说明 |
| --- | --- |
| `npm run dev` | 监听源码并持续构建。 |
| `npm run build` | 类型检查并打包生成 `main.js`。 |
| `npm test` | 运行 Vitest 测试。 |
| `npm run test:watch` | 以监听模式运行测试。 |

```text
src/
├── main.ts          插件生命周期、命令与编辑器交互
├── settings.ts      持久化设置、默认值与迁移
├── providers/       OpenAI 兼容、Claude、Gemini
├── core/            对话、排版、OCR、图片、元数据、收件箱、双链
├── ui/              侧边栏、设置与各类审阅弹窗
└── utils/           位置、Markdown 与通知工具
```

## 参与贡献

欢迎提交 Issue 与范围清晰的 Pull Request。请说明修改影响的用户流程，避免混入无关重构，并在提交前运行 `npm run build` 与 `npm test`。

## 许可证

[MIT](LICENSE) © [Wang Yilai](https://github.com/Pitkil)
