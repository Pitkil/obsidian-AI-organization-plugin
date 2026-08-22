import type { AIOrganizerSettings } from "../settings";
import type { ModelProfile, ModelProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider } from "./openaiCompatible";

// ============================================================
// 提供商工厂：根据设置创建各提供商实例
// ============================================================

export function createProviders(settings: () => AIOrganizerSettings): ModelProvider[] {
  return [
    new OpenAICompatibleProvider(() => settings().openaiCompatible),
    new AnthropicProvider(() => settings().anthropic),
    new GeminiProvider(() => settings().gemini),
  ];
}

/** 获取当前激活的提供商，若未启用/未配置返回 null */
export function getActiveProvider(
  settings: AIOrganizerSettings,
  providers: ModelProvider[]
): ModelProvider | null {
  const activeProfile = settings.modelProfiles.find(
    (profile) => profile.id === settings.activeModelProfileId && isProfileUsable(profile)
  );
  if (activeProfile) {
    return providers.find((x) => x.id === activeProfile.providerId) ?? null;
  }
  const fallbackProfile = settings.modelProfiles.find(isProfileUsable);
  if (fallbackProfile) {
    return providers.find((x) => x.id === fallbackProfile.providerId) ?? null;
  }
  const p = providers.find((x) => x.id === settings.activeProvider);
  if (p && p.isConfigured()) return p;
  // 回退：找第一个已配置的
  return providers.find((x) => x.isConfigured()) ?? null;
}

function isProfileUsable(profile: ModelProfile): boolean {
  if (!profile.enabled || !profile.model) return false;
  if (profile.providerId === "openaiCompatible") {
    if (!profile.baseUrl) return false;
    return !!profile.apiKey || isLocalEndpoint(profile.baseUrl);
  }
  return !!profile.apiKey;
}

function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** 便捷：获取当前激活提供商 */
export function getProviderById(
  id: string,
  providers: ModelProvider[]
): ModelProvider | undefined {
  return providers.find((x) => x.id === id);
}
