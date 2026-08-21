import type { AIProvider, PartialAIProviderConfig } from '../../shared/types';

interface ProviderDefaults {
  baseUrl: string;
  model: string;
}

/**
 * Per-provider fallbacks. Previously these tables were duplicated verbatim in
 * aiService and agentEngine, so adding a provider meant editing two places and
 * the two engines could silently disagree on defaults.
 */
const PROVIDER_DEFAULTS: Record<Exclude<AIProvider, 'custom'>, ProviderDefaults> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-1.5-flash',
  },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder' },
};

export const FALLBACK_MODEL = 'deepseek-chat';

export interface ResolvedProvider {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Providers that authenticate by API key; ollama runs locally without one. */
  requiresApiKey: boolean;
  isOpenRouter: boolean;
}

/** Normalizes a request-supplied config into a fully resolved endpoint. */
export function resolveProvider(config?: PartialAIProviderConfig): ResolvedProvider {
  const provider = (config?.provider || 'deepseek') as AIProvider;
  const apiKey = config?.apiKey || process.env.AI_API_KEY || '';

  let baseUrl = config?.baseUrl || process.env.AI_BASE_URL || '';
  let model = config?.model || process.env.AI_MODEL || '';

  if (!baseUrl && provider !== 'custom') {
    const defaults = PROVIDER_DEFAULTS[provider];
    if (defaults) {
      baseUrl = defaults.baseUrl;
      model = model || defaults.model;
    }
  }

  const isOpenRouter = provider === 'openrouter' || baseUrl.includes('openrouter');

  return {
    provider,
    apiKey,
    baseUrl,
    model,
    requiresApiKey: provider !== 'ollama',
    isOpenRouter,
  };
}

/** Builds the chat-completions URL, tolerating base URLs with or without a trailing slash. */
export function chatCompletionsUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
}

/** OpenRouter attributes traffic via these headers; other providers ignore them. */
export function openRouterHeaders(): Record<string, string> {
  return {
    'HTTP-Referer': 'https://github.com/Jtsgxh/AI-Diff-tool',
    'X-Title': 'AI-Diff-tool',
  };
}

/** Extracts a reasoning/thinking delta across the many vendor-specific field names. */
export function extractReasoningDelta(delta: Record<string, any> | undefined | null): string {
  if (!delta) return '';
  return delta.reasoning_content || delta.reasoning || delta.thought || delta.thinking || '';
}

export const MISSING_API_KEY_MESSAGE =
  '### ⚠️ 未检测到 API Key\n请在右上角 **「⚙️ AI 引擎配置」** 中填入您的 API Key（如 DeepSeek, OpenRouter, OpenAI, Gemini 等）以启用大模型真实解释。';
