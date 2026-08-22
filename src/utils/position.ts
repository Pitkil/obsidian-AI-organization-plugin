// ============================================================
// 便签锚点定位工具（Zotero 式：位置优先、文字兜底）
// 纯函数模块，便于单元测试
// ============================================================

export interface PlainPos {
  line: number;
  ch: number;
}

/** 从起始位置向后推进 offset 个字符，得到新位置 */
export function posAfterFlatOffset(start: PlainPos, text: string, offset: number): PlainPos {
  let line = start.line;
  let ch = start.ch;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      ch = 0;
    } else {
      ch++;
    }
  }
  return { line, ch };
}

/** 扁平 offset → 行列位置 */
export function posFromOffset(doc: string, offset: number): PlainPos {
  return posAfterFlatOffset({ line: 0, ch: 0 }, doc, offset);
}

/** 行列位置 → 扁平 offset */
export function offsetOfPos(doc: string, pos: PlainPos): number {
  let offset = 0;
  let line = 0;
  while (line < pos.line) {
    const nl = doc.indexOf("\n", offset);
    if (nl === -1) return doc.length;
    offset = nl + 1;
    line++;
  }
  return Math.min(offset + pos.ch, doc.length);
}

/** 在选区中定位 quote 的精确位置（保存便签时记录锚点） */
export function computeQuoteAnchor(
  from: PlainPos,
  text: string,
  quote: string
): { from: PlainPos; to: PlainPos } | null {
  if (!quote) return null;
  const idx = text.indexOf(quote);
  if (idx === -1) return null;
  return {
    from: posAfterFlatOffset(from, text, idx),
    to: posAfterFlatOffset(from, text, idx + quote.length),
  };
}

/** 优先按锚点定位，其次全文搜索；返回 quote 的扁平范围。找不到返回 null */
export function resolveQuoteRange(
  doc: string,
  item: { quote: string; anchorFrom?: PlainPos; anchorTo?: PlainPos }
): { from: number; to: number } | null {
  const quote = (item.quote || "").trim();
  if (quote.length <= 1) return null;
  if (item.anchorFrom && item.anchorTo) {
    const fromFlat = offsetOfPos(doc, item.anchorFrom);
    const toFlat = offsetOfPos(doc, item.anchorTo);
    const region = doc.slice(fromFlat, Math.min(toFlat, doc.length));
    const idx = region.indexOf(quote);
    if (idx !== -1) return { from: fromFlat + idx, to: fromFlat + idx + quote.length };
  }
  const idx = doc.indexOf(quote);
  if (idx === -1) return null;
  return { from: idx, to: idx + quote.length };
}

/**
 * 引文被破坏时，在文档中找「最长连续匹配片段」（最长公共子串近似）。
 * 用于把失效的便签仍在正文中可见地标出来（灰色失效高亮），而不是整条消失。
 * 找不到足够长（>= minLen）的片段时返回 null。
 */
export function findBestPartialMatch(
  doc: string,
  quote: string,
  minLen = 4
): { from: number; to: number } | null {
  const q = quote.trim();
  if (q.length < minLen) return null;
  let best: { from: number; to: number; len: number } | null = null;
  // 对引文的每个起点，从最长后缀开始找；命中即该起点下的最优
  for (let start = 0; start < q.length; start++) {
    if (q.length - start < minLen) break;
    for (let end = q.length; end - start >= minLen; end--) {
      const sub = q.slice(start, end);
      const idx = doc.indexOf(sub);
      if (idx !== -1) {
        if (!best || sub.length > best.len) {
          best = { from: idx, to: idx + sub.length, len: sub.length };
        }
        break;
      }
    }
  }
  return best ? { from: best.from, to: best.to } : null;
}

/**
 * 匹配片段是否「足够」：引文主体仍可辨认（片段长度 >= 引文长度的一半，至少 4 字符）。
 * 主体还在 → 便签自动跟随剩余文字保持正常高亮；否则才视为失效（灰色）。
 */
export function isSubstantialMatch(quoteLen: number, matchedLen: number): boolean {
  return matchedLen >= Math.max(4, Math.floor(quoteLen * 0.5));
}
