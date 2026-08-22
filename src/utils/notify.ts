// ============================================================
// 统一提示条（toast）—— 替代裸用 Obsidian Notice
// 沿用 PunditRAG 设计语言：暖白卡片 + 便签式圆角 + 状态色边条
// 类型：success(墨绿) / error(红) / info(中性) / loading(琥珀·常驻转圈)
// ============================================================
import { Notice } from "obsidian";

export type ToastType = "info" | "success" | "error" | "loading";

export interface ToastHandle {
  /** 更新提示文本（loading 常驻条常用） */
  setMessage(message: string): void;
  /** 立即关闭 */
  hide(): void;
}

/** 各类型默认时长（毫秒）：成功/提示 3.2s，错误 6s，loading 常驻 */
const DEFAULT_DURATION: Record<ToastType, number> = {
  info: 3200,
  success: 3200,
  error: 6000,
  loading: 0,
};

/**
 * 显示一条提示。按语义传 type，自动配时长与样式。
 * 返回 handle 可用于 loading 条更新进度/关闭。
 */
export function notify(
  message: string,
  opts: { type?: ToastType; duration?: number } = {}
): ToastHandle {
  const type = opts.type ?? "info";
  const duration = opts.duration ?? DEFAULT_DURATION[type];
  const notice = new Notice(message, duration);
  const el = notice.noticeEl;
  el.addClass("aio-toast");
  el.addClass(`is-${type}`);
  el.setAttr("role", type === "error" ? "alert" : "status");

  // 前置状态图标：loading 用转圈，其余用状态圆点
  const icon = el.createSpan({ cls: `aio-toast-icon is-${type}` });
  el.insertBefore(icon, el.firstChild);

  return {
    setMessage: (text) => {
      notice.setMessage(text);
    },
    hide: () => {
      notice.hide();
    },
  };
}

/** 便捷：成功提示 */
export function notifySuccess(message: string, duration?: number): ToastHandle {
  return notify(message, { type: "success", duration });
}

/** 便捷：错误提示 */
export function notifyError(message: string, duration?: number): ToastHandle {
  return notify(message, { type: "error", duration });
}

/** 便捷：进行中提示（常驻，需手动 hide） */
export function notifyLoading(message: string): ToastHandle {
  return notify(message, { type: "loading" });
}
