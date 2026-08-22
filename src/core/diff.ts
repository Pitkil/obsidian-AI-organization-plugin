// ============================================================
// 行级 Diff（LCS 算法）
// 用于 AI 排版前后的差异预览
// ============================================================

export type DiffOp = { type: "equal" | "add" | "remove"; text: string };

/** 基于 LCS 的行级 diff */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;

  // 构建 LCS 表
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // 回溯生成操作序列
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "remove", text: a[i] });
      i++;
    } else {
      ops.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "remove", text: a[i] });
    i++;
  }
  while (j < m) {
    ops.push({ type: "add", text: b[j] });
    j++;
  }

  return ops;
}

/** 统计改动行数 */
export function countChanges(ops: DiffOp[]): { add: number; remove: number } {
  let add = 0;
  let remove = 0;
  for (const op of ops) {
    if (op.type === "add") add++;
    else if (op.type === "remove") remove++;
  }
  return { add, remove };
}
