import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // obsidian 包无有效入口（main 为空），运行环境由宿主提供。
      // 测试中把 "obsidian" 直接指向 mock 实现，避免包解析失败。
      obsidian: resolve(__dirname, "test/mocks/obsidian.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
