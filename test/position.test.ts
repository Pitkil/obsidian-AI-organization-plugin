import { describe, it, expect } from "vitest";
import {
  posAfterFlatOffset,
  posFromOffset,
  offsetOfPos,
  computeQuoteAnchor,
  resolveQuoteRange,
  findBestPartialMatch,
  isSubstantialMatch,
} from "../src/utils/position";

describe("posAfterFlatOffset / posFromOffset / offsetOfPos", () => {
  it("posFromOffset 在单行内推进", () => {
    expect(posFromOffset("hello", 2)).toEqual({ line: 0, ch: 2 });
  });

  it("posFromOffset 跨行", () => {
    expect(posFromOffset("ab\ncd\nef", 5)).toEqual({ line: 1, ch: 2 }); // a b \n c d
  });

  it("posFromOffset 超过文档长度时停在末尾", () => {
    expect(posFromOffset("ab", 100)).toEqual({ line: 0, ch: 2 });
  });

  it("offsetOfPos 是 posFromOffset 的逆运算", () => {
    const doc = "line one\nline two\nline three";
    for (const off of [0, 3, 8, 9, 12, 18, 27]) {
      expect(offsetOfPos(doc, posFromOffset(doc, off))).toBe(Math.min(off, doc.length));
    }
  });

  it("offsetOfPos 行号越界返回文档长度", () => {
    expect(offsetOfPos("ab\ncd", { line: 99, ch: 0 })).toBe(5);
  });

  it("posAfterFlatOffset 从非零起始位置推进", () => {
    // 从 {line:1, ch:0} 推进 3 个字符："cd\nef" 中 c→1, d→2, \n→换行到 line2 ch0
    expect(posAfterFlatOffset({ line: 1, ch: 0 }, "cd\nef", 3)).toEqual({ line: 2, ch: 0 });
  });
});

describe("computeQuoteAnchor", () => {
  it("在选区内定位 quote", () => {
    // text="前缀\nab cdef"，"cd" 的扁平偏移是 6（前缀2 + \n1 + "ab "3）
    // 从 {2,4} 推进 6：前→5，缀→6，\n→line3 ch0，a→1，b→2，空格→3 → {3,3}
    const anchor = computeQuoteAnchor({ line: 2, ch: 4 }, "前缀\nab cdef", "cd");
    expect(anchor).toEqual({ from: { line: 3, ch: 3 }, to: { line: 3, ch: 5 } });
  });

  it("跨行的 quote 定位", () => {
    const anchor = computeQuoteAnchor({ line: 0, ch: 0 }, "a\nbc", "bc");
    expect(anchor).toEqual({ from: { line: 1, ch: 0 }, to: { line: 1, ch: 2 } });
  });

  it("quote 不在 text 中返回 null", () => {
    expect(computeQuoteAnchor({ line: 0, ch: 0 }, "abc", "xyz")).toBeNull();
  });

  it("空 quote 返回 null", () => {
    expect(computeQuoteAnchor({ line: 0, ch: 0 }, "abc", "")).toBeNull();
  });
});

describe("resolveQuoteRange", () => {
  const doc = "# 标题\n\n这是一段正文，包含需要定位的文字。\n结尾";

  it("quote 长度 <= 1 返回 null", () => {
    expect(resolveQuoteRange(doc, { quote: "a" })).toBeNull();
  });

  it("没有锚点时全文搜索", () => {
    const r = resolveQuoteRange(doc, { quote: "需要定位" });
    expect(r).not.toBeNull();
    expect(doc.slice(r!.from, r!.to)).toBe("需要定位");
  });

  it("锚点有效时优先按锚点定位", () => {
    const r = resolveQuoteRange(doc, { quote: "正文", anchorFrom: { line: 2, ch: 5 }, anchorTo: { line: 2, ch: 7 } });
    expect(r).not.toBeNull();
    expect(doc.slice(r!.from, r!.to)).toBe("正文");
  });

  it("锚点区域与 quote 不匹配时回退全文搜索", () => {
    // 锚点指向第一行标题区域，那里没有「正文」
    const r = resolveQuoteRange(doc, {
      quote: "正文",
      anchorFrom: { line: 0, ch: 0 },
      anchorTo: { line: 0, ch: 4 },
    });
    expect(r).not.toBeNull();
    expect(doc.slice(r!.from, r!.to)).toBe("正文");
  });

  it("找不到时返回 null", () => {
    expect(resolveQuoteRange(doc, { quote: "不存在的文字" })).toBeNull();
  });

  it("锚点跨多行仍然有效", () => {
    const multi = "第一行\n第二行内容\n第三行";
    const r = resolveQuoteRange(multi, {
      quote: "第二行内容",
      anchorFrom: { line: 1, ch: 0 },
      anchorTo: { line: 1, ch: 5 },
    });
    expect(r).not.toBeNull();
    expect(multi.slice(r!.from, r!.to)).toBe("第二行内容");
  });
});

describe("findBestPartialMatch（引文被破坏时的兜底定位）", () => {
  const doc = "人工智能正在改变我们的生活方式。";

  it("引文完整存在时找到最长片段", () => {
    const r = findBestPartialMatch(doc, "正在改变");
    expect(r).not.toBeNull();
    expect(doc.slice(r!.from, r!.to)).toBe("正在改变");
  });

  it("引文被删除一部分后找到剩余的最长连续片段", () => {
    // 引文「人工智能正在改变世界」中的「世界」被删/改了
    const r = findBestPartialMatch(doc, "人工智能正在改变世界");
    expect(r).not.toBeNull();
    expect(doc.slice(r!.from, r!.to)).toBe("人工智能正在改变");
  });

  it("引文中多段文字被打散时仍能匹配到较长一段", () => {
    // 引文两段都被改，但「正在改变」保留
    const r = findBestPartialMatch(doc, "未来已来\n正在改变\n世界");
    expect(r).not.toBeNull();
    expect(doc.slice(r!.from, r!.to)).toBe("正在改变");
  });

  it("找不到足够长的片段返回 null", () => {
    expect(findBestPartialMatch(doc, "完全不存在的文字xyz")).toBeNull();
  });

  it("引文太短（< minLen）返回 null", () => {
    expect(findBestPartialMatch(doc, "短")).toBeNull();
  });

  it("自定义 minLen 生效", () => {
    // 「XYZ」不在文档中，引文「XYZ生活」只有「生活」(2字)能匹配
    // minLen=3 时 2 字太短 → null；minLen=2 时能找到「生活」
    expect(findBestPartialMatch(doc, "XYZ生活", 3)).toBeNull();
    const r = findBestPartialMatch(doc, "XYZ生活", 2);
    expect(r).not.toBeNull();
    expect(doc.slice(r!.from, r!.to)).toBe("生活");
  });

  it("跨行引文部分匹配", () => {
    const multi = "第一行内容\n第二行内容\n第三行";
    const r = findBestPartialMatch(multi, "第一行内容\n被改掉\n第二行内容");
    expect(r).not.toBeNull();
    // 最长片段可能是「第一行内容」(或带尾随换行)，也可能是「第二行内容」
    const matched = multi.slice(r!.from, r!.to).replace(/\n/g, "");
    expect(matched === "第一行内容" || matched === "第二行内容").toBe(true);
  });
});

describe("isSubstantialMatch（引文主体是否仍在）", () => {
  it("片段达一半以上视为主体仍在", () => {
    expect(isSubstantialMatch(20, 10)).toBe(true);
    expect(isSubstantialMatch(20, 9)).toBe(false);
  });

  it("短引文用 4 字符下限", () => {
    expect(isSubstantialMatch(6, 4)).toBe(true);
    expect(isSubstantialMatch(6, 3)).toBe(false);
  });

  it("边界：恰好一半 / 刚好 4 字符", () => {
    expect(isSubstantialMatch(8, 4)).toBe(true);
    expect(isSubstantialMatch(4, 4)).toBe(true);
    expect(isSubstantialMatch(4, 3)).toBe(false);
  });
});
