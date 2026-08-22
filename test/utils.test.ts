import { describe, it, expect } from "vitest";
import {
  stripCodeFence,
  extractJson,
  truncate,
  sanitizeFileName,
  uniquePath,
  formatNumber,
  firstHeading,
  capScrollPositions,
  selectionSignature,
} from "../src/utils";
import { diffLines, countChanges } from "../src/core/diff";

describe("stripCodeFence", () => {
  it("去掉 markdown 代码围栏", () => {
    expect(stripCodeFence("```markdown\n# 标题\n内容\n```")).toBe("# 标题\n内容");
  });

  it("去掉无语言代码围栏", () => {
    expect(stripCodeFence("```\nhello\n```")).toBe("hello");
  });

  it("没有围栏时原样返回", () => {
    const text = "# 标题\n普通内容";
    expect(stripCodeFence(text)).toBe(text);
  });

  it("围栏前后有空白也能处理", () => {
    expect(stripCodeFence("  ```json\n{\"a\":1}\n```  ")).toBe('{"a":1}');
  });
});

describe("extractJson", () => {
  it("直接解析 JSON 对象", () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it("解析 JSON 数组", () => {
    expect(extractJson<number[]>("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("解析 ```json 围栏包裹的内容", () => {
    expect(extractJson<{ a: number }>("```json\n{\"a\": 2}\n```")).toEqual({ a: 2 });
  });

  it("从前后有文字的文本中提取对象", () => {
    const raw = "好的，结果如下：\n{\"tags\": [\"a\"]}\n希望对你有帮助";
    expect(extractJson<{ tags: string[] }>(raw)).toEqual({ tags: ["a"] });
  });

  it("无法解析时返回 null", () => {
    expect(extractJson("完全不是 JSON")).toBeNull();
  });
});

describe("truncate", () => {
  it("短文本不截断", () => {
    expect(truncate("abc", 100)).toBe("abc");
  });

  it("长文本保留头尾并加提示", () => {
    const out = truncate("a".repeat(1000), 200, 100);
    expect(out).toContain("内容过长已截断");
    expect(out.length).toBeLessThan(400);
    expect(out.endsWith("a".repeat(100))).toBe(true);
  });

  it("maxLen 小于 tail 时只截头", () => {
    const out = truncate("b".repeat(100), 10, 400);
    expect(out).toBe("b".repeat(10));
  });
});

describe("sanitizeFileName", () => {
  it("替换非法字符", () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("压缩多余空白", () => {
    expect(sanitizeFileName("  a   b  ")).toBe("a b");
  });
});

describe("uniquePath", () => {
  it("路径不存在时直接返回", () => {
    expect(uniquePath("a/b.md", () => false)).toBe("a/b.md");
  });

  it("路径存在时自动加 (1)", () => {
    const exists = (p: string) => p === "a/b.md";
    expect(uniquePath("a/b.md", exists)).toBe("a/b (1).md");
  });

  it("连续冲突时递增序号", () => {
    const exists = (p: string) => ["a/b.md", "a/b (1).md"].includes(p);
    expect(uniquePath("a/b.md", exists)).toBe("a/b (2).md");
  });

  it("无扩展名文件也能处理", () => {
    const exists = (p: string) => p === "a/readme";
    expect(uniquePath("a/readme", exists)).toBe("a/readme (1)");
  });
});

describe("formatNumber", () => {
  it("千分位格式化", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });
});

describe("firstHeading", () => {
  it("提取首个一级标题", () => {
    expect(firstHeading("前言\n\n# 我的笔记\n\n正文")).toBe("我的笔记");
  });

  it("无标题返回空串", () => {
    expect(firstHeading("只有正文")).toBe("");
  });

  it("不匹配二级标题", () => {
    expect(firstHeading("## 二级标题")).toBe("");
  });
});

describe("diffLines (LCS)", () => {
  it("完全相同时全为 equal", () => {
    const ops = diffLines("a\nb", "a\nb");
    expect(ops.every((op) => op.type === "equal")).toBe(true);
    expect(countChanges(ops)).toEqual({ add: 0, remove: 0 });
  });

  it("新增一行", () => {
    const ops = diffLines("a\nb", "a\nx\nb");
    expect(ops.some((op) => op.type === "add" && op.text === "x")).toBe(true);
    expect(countChanges(ops)).toEqual({ add: 1, remove: 0 });
  });

  it("删除一行", () => {
    const ops = diffLines("a\nb\nc", "a\nc");
    expect(ops.some((op) => op.type === "remove" && op.text === "b")).toBe(true);
    expect(countChanges(ops)).toEqual({ add: 0, remove: 1 });
  });

  it("空文本", () => {
    expect(diffLines("", "")).toEqual([]);
    expect(diffLines("a", "")).toEqual([{ type: "remove", text: "a" }]);
    expect(diffLines("", "a")).toEqual([{ type: "add", text: "a" }]);
  });
});

describe("capScrollPositions", () => {
  it("未超过上限时原样返回", () => {
    const pos = { "a.md": { top: 0, line: 0, ch: 0 }, "b.md": { top: 1, line: 2, ch: 3 } };
    expect(capScrollPositions(pos, 100)).toEqual(pos);
  });

  it("超过上限时保留末尾（最近访问）的记录", () => {
    const pos: Record<string, number> = {};
    for (let i = 0; i < 10; i++) pos[`n${i}.md`] = i;
    const capped = capScrollPositions(pos, 5);
    expect(Object.keys(capped)).toEqual(["n5.md", "n6.md", "n7.md", "n8.md", "n9.md"]);
  });

  it("空对象返回空对象", () => {
    expect(capScrollPositions({}, 100)).toEqual({});
  });
});

describe("selectionSignature", () => {
  it("同一选区（含首尾空白差异）签名一致", () => {
    const from = { line: 1, ch: 2 };
    const to = { line: 3, ch: 4 };
    expect(selectionSignature("a.md", from, to, "  选中文字\n")).toBe(
      selectionSignature("a.md", from, to, "选中文字")
    );
  });

  it("不同选区签名不同", () => {
    expect(
      selectionSignature("a.md", { line: 1, ch: 0 }, { line: 1, ch: 5 }, "abcde")
    ).not.toBe(
      selectionSignature("a.md", { line: 1, ch: 0 }, { line: 1, ch: 6 }, "abcdef")
    );
  });

  it("不同文件签名不同", () => {
    const from = { line: 0, ch: 0 };
    const to = { line: 0, ch: 1 };
    expect(selectionSignature("a.md", from, to, "x")).not.toBe(
      selectionSignature("b.md", from, to, "x")
    );
  });
});
