// ============================================================
// 通用工具函数
// ============================================================

/** 去除 AI 返回内容外面包裹的 ``` 代码围栏（如 ```markdown ... ```） */
export function stripCodeFence(text: string): string {
  const t = text.trim();
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/;
  const m = t.match(fence);
  return m ? m[1].trim() : t;
}

/** 从 AI 返回中提取第一个 JSON 对象/数组（容忍前后文字） */
export function extractJson<T>(text: string): T | null {
  const t = text.trim();
  // 尝试直接解析
  try {
    return JSON.parse(t) as T;
  } catch {
    // 尝试提取 ```json 围栏
    const fenced = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]) as T;
      } catch {
        /* fallthrough */
      }
    }
    // 尝试提取第一个 {...} 或 [...] 块
    const objMatch = t.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]) as T;
      } catch {
        /* fallthrough */
      }
    }
    const arrMatch = t.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        return JSON.parse(arrMatch[0]) as T;
      } catch {
        /* fallthrough */
      }
    }
  }
  return null;
}

/** 截断文本到最大长度（保留头尾） */
export function truncate(text: string, maxLen: number, tail = 400): string {
  if (text.length <= maxLen) return text;
  const headLen = maxLen - tail;
  if (headLen < 0) return text.slice(0, maxLen);
  return text.slice(0, headLen) + "\n\n…[内容过长已截断]…\n\n" + text.slice(-tail);
}

/** 文件名安全化 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

/** 获取安全的目标路径（处理重名，自动加 (1)、(2)） */
export function uniquePath(vaultPath: string, exists: (p: string) => boolean): string {
  if (!exists(vaultPath)) return vaultPath;
  const dot = vaultPath.lastIndexOf(".");
  const base = dot > 0 ? vaultPath.slice(0, dot) : vaultPath;
  const ext = dot > 0 ? vaultPath.slice(dot) : "";
  let i = 1;
  while (exists(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

/** 将 Obsidian 内部路径转换为平台文件路径 */
export function vaultPathToFs(root: string, vaultPath: string): string {
  return (root + "/" + vaultPath).replace(/\//g, "\\").replace(/\\/g, "\\");
}

/** 简单等待 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 数字格式化（千分位） */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** 当前时间戳字符串，用于对话保存文件名 */
export function timestamp(): string {
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 提取首个 Markdown 标题作为对话标题 */
export function firstHeading(content: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim().slice(0, 30) : "";
}

/**
 * 限制浏览位置缓存条数，防止无限增长。
 * 依赖调用方把「最近访问」的记录放在后面（delete 后重新 set 可更新插入顺序）。
 */
export function capScrollPositions<T>(
  positions: Record<string, T>,
  max = 1000
): Record<string, T> {
  const entries = Object.entries(positions);
  if (entries.length <= max) return positions;
  return Object.fromEntries(entries.slice(entries.length - max));
}

/**
 * 选中工具栏的选区签名：用于「手动关闭后，同一选区不再自动弹出」。
 * 文本统一 trim，保证关闭时记录与弹出时检查完全一致（否则选区首尾空白会让签名对不上）。
 */
export function selectionSignature(
  filePath: string,
  from: { line: number; ch: number },
  to: { line: number; ch: number },
  text: string
): string {
  return `${filePath}\u0000${from.line}:${from.ch}-${to.line}:${to.ch}\u0000${text.trim()}`;
}
