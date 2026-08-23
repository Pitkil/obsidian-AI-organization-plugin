import { describe, expect, it, beforeEach } from "vitest";
import { setUILang, getUILang, t, tpl } from "../src/i18n";

describe("i18n", () => {
  beforeEach(() => {
    // 每个用例前重置为中文，避免用例间互相污染
    setUILang("zh");
  });

  it("getUILang 默认返回 zh", () => {
    expect(getUILang()).toBe("zh");
  });

  it("setUILang 切换语言", () => {
    setUILang("en");
    expect(getUILang()).toBe("en");
    setUILang("zh");
    expect(getUILang()).toBe("zh");
  });

  it("t 默认返回中文文案", () => {
    expect(t("common.cancel")).toBe("取消");
    expect(t("chat.title")).toBe("笔记助手");
  });

  it("t 在 en 语言下返回英文文案", () => {
    setUILang("en");
    expect(t("common.cancel")).toBe("Cancel");
    expect(t("chat.title")).toBe("Note Assistant");
  });

  it("t 对未知键回退到中文再回退到键名", () => {
    expect(t("not.exist.key")).toBe("not.exist.key");
  });

  it("tpl 替换占位符（中文）", () => {
    expect(tpl("notify.formattingDone", { name: "测试笔记" })).toBe("已排版：测试笔记");
  });

  it("tpl 替换占位符（英文）", () => {
    setUILang("en");
    expect(tpl("notify.formattingDone", { name: "Test Note" })).toBe("Formatted: Test Note");
  });

  it("tpl 支持数字占位符", () => {
    expect(tpl("notify.movedOrphans", { n: 3 })).toBe("已移动 3 个附件至「未引用附件」");
  });

  it("tpl 可替换同一占位符多处出现", () => {
    expect(tpl("modal.charsChange", { a: 10, b: 20 })).toBe("10 → 20 字符");
  });
});
