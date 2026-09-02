import React, { useState } from 'react';
import {
  CONTEXT_WINDOW_TOKENS,
  REQUEST_TIMEOUT_SECONDS,
  STREAM_IDLE_TIMEOUT_SECONDS,
  diffCharBudgetFromWindow,
  type AIProviderConfig,
} from '../types';
import { DEFAULT_PROMPTS } from '../constants/defaultPrompts';
import {
  Settings,
  X,
  Check,
  Key,
  Globe,
  Cpu,
  Brain,
  Sliders,
  Clock,
  RotateCcw,
  FileCode2,
  Search,
  MessageSquareQuote,
  Sparkles,
  ShieldCheck,
  Zap,
  TestTube,
  Flame,
  Gamepad2,
  Code2,
  BookOpen,
  Database,
  Trash2,
  Maximize2,
} from 'lucide-react';

const CONTEXT_WINDOW_PRESETS = [
  { value: 32_768, label: '32k', hint: '本地小模型' },
  { value: 64_000, label: '64k', hint: 'DeepSeek' },
  { value: 128_000, label: '128k', hint: 'GPT-4o' },
  { value: 200_000, label: '200k', hint: 'Claude' },
  { value: 1_000_000, label: '1M', hint: '默认 · 推荐' },
  { value: 2_000_000, label: '2M', hint: '超长上下文' },
  { value: 4_000_000, label: '4M', hint: '新一代长上下文' },
] as const;
import { aiCache } from '../services/aiCache';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AIProviderConfig;
  onSaveConfig: (config: AIProviderConfig) => void;
}

const PROMPT_PRESETS = [
  {
    id: 'expert_deep',
    title: '🏗️ 资深架构师深度技术剖析 (默认推荐)',
    icon: Code2,
    desc: '深度剖析改动前后行为差异（Before vs After）、底层机制原理、跨模块调用与工程契约影响。',
    prompt: DEFAULT_PROMPTS.reviewPrompt,
  },
  {
    id: 'concise_tech',
    title: '⚡ 极简技术直解 (纯逻辑·极速干练)',
    icon: Zap,
    desc: '直奔技术主题，用最干练精辟的语言直解每行改动逻辑与实际影响，零套话。',
    prompt: DEFAULT_PROMPTS.fastDiffPrompt,
  },
  {
    id: 'gamedev_unity',
    title: '🎮 游戏与实时系统审查 (Unity / C# / 后端)',
    icon: Gamepad2,
    desc: '聚焦帧率性能、高频 GC 内存分配、状态机闭环、Update 轮询开销及网络同步协议。',
    prompt: `你是一位资深游戏引擎与高并发系统架构师。请针对 Diff 进行代码审查：
1. 深入拆解核心语句与状态迁移逻辑；
2. 严格排查 GC 内存分配（避免每帧堆分配/装箱）、协程生命周期、Update 轮询开销；
3. 检查状态机切换闭环、网络同步数据协议一致性与对象生命周期管理。`,
  },
  {
    id: 'testing_edge_cases',
    title: '🧪 缺陷推演与单元测试用例',
    icon: TestTube,
    desc: '深度推演 Null、越界、并发竞态等边界隐患，并输出针对性的 Given-When-Then 测试代码。',
    prompt: `你是一位资深质量架构师与测试专家。请深入审查：
1. 深入剖析修改代码的实现逻辑与关键状态流转；
2. 深度推演所有边界条件与潜在缺陷（空指针 Null、集合越界、数值溢出、并发交错）；
3. 为修改的代码编写具体的单元测试用例（Given-When-Then 格式与测试代码样例）。`,
  },
  {
    id: 'cleancode_refactor',
    title: '🧼 Clean Code 与重构治理',
    icon: Flame,
    desc: '把关单一职责（SRP）、开闭原则（OCP）、设计模式应用、命名语义与代码坏味道。',
    prompt: `你是一位 Clean Code 专家与重构大师。请针对 Diff 审查：
1. 剖析代码核心改动；
2. 检查函数是否符合单一职责原则（SRP）、抽象与解耦程度；
3. 检查命名自解释性，指出代码坏味道（Code Smells）与重构优化方案。`,
  },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [form, setForm] = useState<AIProviderConfig>({
    ...config,
    reviewPrompt:
      config.reviewPrompt || config.customSystemPrompt || DEFAULT_PROMPTS.reviewPrompt,
    learnPrompt: config.learnPrompt || DEFAULT_PROMPTS.learnPrompt,
    fastDiffPrompt: config.fastDiffPrompt || DEFAULT_PROMPTS.fastDiffPrompt,
    pseudocodePrompt: config.pseudocodePrompt || DEFAULT_PROMPTS.pseudocodePrompt,
    naturalLanguagePrompt:
      config.naturalLanguagePrompt || DEFAULT_PROMPTS.naturalLanguagePrompt,
    customSystemPrompt:
      config.reviewPrompt || config.customSystemPrompt || DEFAULT_PROMPTS.reviewPrompt,
    maxExplorationTurns:
      config.maxExplorationTurns !== undefined ? config.maxExplorationTurns : 0,
    timeoutSeconds: config.timeoutSeconds || REQUEST_TIMEOUT_SECONDS.default,
    streamIdleTimeoutSeconds:
      config.streamIdleTimeoutSeconds || STREAM_IDLE_TIMEOUT_SECONDS.default,
    maxRetries: config.maxRetries !== undefined ? config.maxRetries : 2,
    maxReadFileLines: config.maxReadFileLines || 2000,
    maxSearchResults: config.maxSearchResults || 200,
    contextWindowTokens: config.contextWindowTokens ?? CONTEXT_WINDOW_TOKENS.default,
  });

  const [activeTab, setActiveTab] = useState<'model' | 'agent' | 'prompts'>('model');
  const [promptCategory, setPromptCategory] = useState<
    'review' | 'learn' | 'fastDiff' | 'pseudocode' | 'naturalLanguage'
  >('review');
  const [savedMessage, setSavedMessage] = useState(false);

  if (!isOpen) return null;

  const windowTokens = form.contextWindowTokens ?? CONTEXT_WINDOW_TOKENS.default;
  const agentChars = diffCharBudgetFromWindow(windowTokens, 'agent');
  const fastChars = diffCharBudgetFromWindow(windowTokens, 'fast');

  const handleProviderSelect = (provider: AIProviderConfig['provider']) => {
    let baseUrl = '';
    let model = '';

    if (provider === 'deepseek') {
      baseUrl = 'https://api.deepseek.com/v1';
      model = 'deepseek-chat';
    } else if (provider === 'openrouter') {
      baseUrl = 'https://openrouter.ai/api/v1';
      model = 'anthropic/claude-3.5-sonnet';
    } else if (provider === 'openai') {
      baseUrl = 'https://api.openai.com/v1';
      model = 'gpt-4o-mini';
    } else if (provider === 'gemini') {
      baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
      model = 'gemini-1.5-flash';
    } else if (provider === 'ollama') {
      baseUrl = 'http://localhost:11434/v1';
      model = 'qwen2.5-coder';
    }

    setForm((prev) => ({
      ...prev,
      provider,
      baseUrl: baseUrl || prev.baseUrl,
      model: model || prev.model,
    }));
  };

  const handleResetAgentDefaults = () => {
    setForm((prev) => ({
      ...prev,
      maxExplorationTurns: 0,
      timeoutSeconds: REQUEST_TIMEOUT_SECONDS.default,
      streamIdleTimeoutSeconds: STREAM_IDLE_TIMEOUT_SECONDS.default,
      maxRetries: 2,
      maxReadFileLines: 2000,
      maxSearchResults: 200,
    }));
  };

  const handleResetAllPrompts = () => {
    setForm((prev) => ({
      ...prev,
      reviewPrompt: DEFAULT_PROMPTS.reviewPrompt,
      customSystemPrompt: DEFAULT_PROMPTS.reviewPrompt,
      learnPrompt: DEFAULT_PROMPTS.learnPrompt,
      fastDiffPrompt: DEFAULT_PROMPTS.fastDiffPrompt,
      pseudocodePrompt: DEFAULT_PROMPTS.pseudocodePrompt,
      naturalLanguagePrompt: DEFAULT_PROMPTS.naturalLanguagePrompt,
    }));
  };

  const handleApplyPresetPrompt = (prompt: string) => {
    setForm((prev) => ({
      ...prev,
      reviewPrompt: prompt,
      customSystemPrompt: prompt,
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig(form);
    setSavedMessage(true);
    setTimeout(() => {
      setSavedMessage(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/25 flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] border border-black/10 rounded-xl w-full max-w-2xl shadow-xl overflow-hidden text-zinc-900 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-[#FFFFFF] border-b border-black/10 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-zinc-100 text-zinc-700">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-950">AI 引擎与提示词配置</h2>
              <p className="text-[11px] text-zinc-600">
                配置模型连接、代码审查、仓库学习提示词与 Codex 智能体运行参数
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-900">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-[#FAFAF9] px-5 pt-2 border-b border-black/5 space-x-4 text-xs font-semibold select-none shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('model')}
            className={`pb-2.5 flex items-center space-x-1.5 border-b-2 transition ${
              activeTab === 'model'
                ? 'border-zinc-400 text-zinc-700 font-bold'
                : 'border-transparent text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>AI 大模型与密钥</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('prompts')}
            className={`pb-2.5 flex items-center space-x-1.5 border-b-2 transition ${
              activeTab === 'prompts'
                ? 'border-zinc-400 text-zinc-700 font-bold'
                : 'border-transparent text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <MessageSquareQuote className="w-3.5 h-3.5 text-zinc-600" />
            <span>提示词定制</span>
            {form.customSystemPrompt && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('agent')}
            className={`pb-2.5 flex items-center space-x-1.5 border-b-2 transition ${
              activeTab === 'agent'
                ? 'border-zinc-400 text-zinc-700 font-bold'
                : 'border-transparent text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <Brain className="w-3.5 h-3.5 text-zinc-600" />
            <span>Codex 探查与运行上限</span>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
          {/* TAB 1: Model Provider Settings */}
          {activeTab === 'model' && (
            <div className="space-y-4">
              <div>
                <label className="block text-zinc-700 font-semibold mb-2">
                  选择 AI 大模型提供商
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'deepseek', label: 'DeepSeek', desc: '官方推荐 / 超强推理' },
                    { id: 'openrouter', label: 'OpenRouter', desc: '全模型聚合 / Claude / Llama' },
                    { id: 'gemini', label: 'Google Gemini', desc: '超大上下文' },
                    { id: 'openai', label: 'OpenAI', desc: 'GPT-4o / Mini' },
                    { id: 'ollama', label: 'Ollama 本地模型', desc: '本地私有 / 免Key' },
                    { id: 'custom', label: '自定义端点', desc: '中转站 / 兼容接口' },
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => handleProviderSelect(item.id as any)}
                      className={`p-2.5 rounded-lg border text-left transition flex flex-col justify-between ${
                        form.provider === item.id
                          ? 'bg-zinc-100 border-zinc-400 text-zinc-950 shadow-sm'
                          : 'bg-[#F1F1EF] border-black/5 text-zinc-600 hover:text-zinc-900 hover:border-black/10'
                      }`}
                    >
                      <span className="font-semibold text-zinc-900 text-xs">{item.label}</span>
                      <span className="text-[10px] text-zinc-500 mt-1">{item.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-black/5">
                {/* API Key */}
                <div>
                  <label className="block text-zinc-700 font-semibold mb-1 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-zinc-600" />
                    <span>API 密钥 (API Key)</span>
                  </label>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder={
                      form.provider === 'ollama' ? 'Ollama 本地运行无需填 Key' : form.provider === 'openrouter' ? 'sk-or-v1-...' : 'sk-...'
                    }
                    className="w-full bg-[#FAFAF9] border border-black/10 rounded-lg px-3 py-2 text-zinc-900 focus:outline-none focus:border-zinc-400"
                  />
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-zinc-700 font-semibold mb-1 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-sky-700" />
                    <span>接口地址 (Base URL)</span>
                  </label>
                  <input
                    type="text"
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    placeholder={form.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.deepseek.com/v1'}
                    className="w-full bg-[#FAFAF9] border border-black/10 rounded-lg px-3 py-2 text-zinc-900 font-mono text-[11px] focus:outline-none focus:border-zinc-400"
                  />
                </div>

                {/* Model */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-zinc-700 font-semibold flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-emerald-700" />
                      <span>模型名称 (Model)</span>
                    </label>
                    {form.provider === 'openrouter' && (
                      <span className="text-[10px] text-zinc-700">💡 点击下方推荐模型快捷填入</span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="deepseek-chat / anthropic/claude-3.5-sonnet / gpt-4o-mini"
                    className="w-full bg-[#FAFAF9] border border-black/10 rounded-lg px-3 py-2 text-zinc-900 font-mono text-[11px] focus:outline-none focus:border-zinc-400"
                  />

                  {/* OpenRouter Model Quick Presets */}
                  {form.provider === 'openrouter' && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[
                        { name: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
                        { name: 'deepseek/deepseek-chat', label: 'DeepSeek V3' },
                        { name: 'openai/gpt-4o', label: 'GPT-4o' },
                        { name: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
                        { name: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
                      ].map((m) => (
                        <button
                          key={m.name}
                          type="button"
                          onClick={() => setForm({ ...form, model: m.name })}
                          className={`text-[10px] px-2 py-0.5 rounded border transition font-mono ${
                            form.model === m.name
                              ? 'bg-zinc-900 text-white border-zinc-900'
                              : 'bg-black/[0.03] text-zinc-600 border-black/5 hover:text-zinc-900 hover:bg-black/[0.06]'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-black/5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-zinc-700 font-semibold flex items-center gap-1.5">
                    <Maximize2 className="w-3.5 h-3.5 text-amber-700" />
                    <span>上下文窗口</span>
                  </label>
                  <span className="font-mono text-xs text-amber-800">
                    {windowTokens >= 1_000_000
                      ? `${windowTokens / 1_000_000}M`
                      : `${Math.round(windowTokens / 1000)}k`}{' '}
                    tokens
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {CONTEXT_WINDOW_PRESETS.map((preset) => {
                    const active = windowTokens === preset.value;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => setForm({ ...form, contextWindowTokens: preset.value })}
                        className={`p-2 rounded-lg border text-left transition ${
                          active
                            ? 'bg-amber-100 border-amber-300 text-amber-900 shadow-sm'
                            : 'bg-[#F1F1EF] border-black/5 text-zinc-600 hover:text-zinc-900 hover:border-black/10'
                        }`}
                      >
                        <div className="flex items-center justify-between font-semibold text-xs">
                          <span>{preset.label}</span>
                          {active && <Check className="w-3 h-3 text-amber-700" />}
                        </div>
                        <p className="text-[10px] text-zinc-600 mt-0.5">{preset.hint}</p>
                      </button>
                    );
                  })}
                </div>
                <input
                  type="number"
                  min={CONTEXT_WINDOW_TOKENS.min}
                  step={1000}
                  value={windowTokens}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      contextWindowTokens:
                        parseInt(e.target.value, 10) || CONTEXT_WINDOW_TOKENS.default,
                    })
                  }
                  className="w-full bg-[#FAFAF9] border border-black/10 rounded-lg px-2.5 py-1.5 text-zinc-900 font-mono text-xs focus:outline-none focus:border-amber-300"
                />
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  不设应用上限，请按模型文档填写真实窗口。Agent 初始 Diff 约{' '}
                  {agentChars.toLocaleString()} 字符，快速解释约 {fastChars.toLocaleString()} 字符；其余空间留给工具结果和输出。
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: Custom Prompts Settings (Separated Default vs User Config for All Scenarios) */}
          {activeTab === 'prompts' && (
            <div className="space-y-4">
              {/* Category Sub-Tabs */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center bg-[#FAFAF9] border border-black/10 rounded-lg p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setPromptCategory('review')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1 ${
                      promptCategory === 'review'
                        ? 'bg-zinc-900 text-white shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <Brain className="w-3 h-3" />
                    <span>1. 深度审查</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPromptCategory('learn')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1 ${
                      promptCategory === 'learn'
                        ? 'bg-zinc-900 text-white shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <BookOpen className="w-3 h-3" />
                    <span>2. 业务分析</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPromptCategory('fastDiff')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1 ${
                      promptCategory === 'fastDiff'
                        ? 'bg-zinc-900 text-white shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <Zap className="w-3 h-3" />
                    <span>3. 直接 Diff</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPromptCategory('pseudocode')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1 ${
                      promptCategory === 'pseudocode'
                        ? 'bg-zinc-900 text-white shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>4. 概括伪代码</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPromptCategory('naturalLanguage')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1 ${
                      promptCategory === 'naturalLanguage'
                        ? 'bg-zinc-900 text-white shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <BookOpen className="w-3 h-3" />
                    <span>5. 自然语言</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleResetAllPrompts}
                  className="text-[11px] text-zinc-600 hover:text-zinc-700 flex items-center gap-1 shrink-0 ml-2"
                  title="恢复所有 5 个场景的内置推荐提示词"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>恢复全部默认</span>
                </button>
              </div>

              {/* Sub-Category 1: Codex Deep Review Prompt */}
              {promptCategory === 'review' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  {/* One-Click Presets */}
                  <div>
                    <label className="block text-zinc-700 font-semibold mb-1.5">
                      ⚡ 常用审查偏好一键预设 (点击即可填充)
                    </label>
                    <div className="grid grid-cols-1 gap-1.5">
                      {PROMPT_PRESETS.map((preset) => {
                        const isSelected = form.reviewPrompt === preset.prompt;
                        const Icon = preset.icon;

                        return (
                          <button
                            type="button"
                            key={preset.id}
                            onClick={() => handleApplyPresetPrompt(preset.prompt)}
                            className={`p-2 rounded-lg border text-left transition flex items-start space-x-2.5 ${
                              isSelected
                                ? 'bg-zinc-100 border-zinc-400 text-zinc-950 shadow-sm'
                                : 'bg-[#FAFAF9] border-black/5 text-zinc-600 hover:text-zinc-900 hover:border-black/10'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-zinc-900 text-xs">
                                  {preset.title}
                                </span>
                                {isSelected && (
                                  <span className="text-[10px] text-zinc-700 font-mono flex items-center gap-0.5">
                                    <Check className="w-3 h-3" /> 当前选中
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-zinc-600 mt-0.5 leading-relaxed">
                                {preset.desc}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Textarea */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="block text-zinc-700 font-semibold">
                        当前生效的 Codex 深度审查指令 (可自由编辑)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            reviewPrompt: DEFAULT_PROMPTS.reviewPrompt,
                            customSystemPrompt: DEFAULT_PROMPTS.reviewPrompt,
                          })
                        }
                        className="text-[10px] text-zinc-600 hover:text-zinc-700 transition flex items-center gap-1"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>恢复此项默认</span>
                      </button>
                    </div>
                    <textarea
                      rows={6}
                      value={form.reviewPrompt || form.customSystemPrompt || ''}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          reviewPrompt: e.target.value,
                          customSystemPrompt: e.target.value,
                        })
                      }
                      placeholder="可在此手写任意审查指令..."
                      className="w-full bg-[#FAFAF9] border border-black/10 rounded-lg p-3 text-zinc-900 text-xs focus:outline-none focus:border-zinc-400 leading-relaxed font-sans"
                    />
                    <p className="text-[10px] text-zinc-500">
                      用于「🧠 关联解释 (Codex)」和全文件审查，100% 由上方这段 Prompt 决定。
                    </p>
                  </div>
                </div>
              )}

              {/* Sub-Category 2: Repository Business Analysis Prompt */}
              {promptCategory === 'learn' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <div className="p-3 bg-[#F7F7F5] border border-black/5 rounded-lg text-zinc-700 text-xs">
                    <span className="font-semibold text-zinc-700">💡 功能说明：</span>
                    <span className="text-zinc-600 ml-1">
                      用于「学习此仓库」的首次业务路线分析和后续追问。您可以调整分析重点、展开深度和表达方式；社区与业务路线的机器数据协议仍由系统固定。
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-zinc-700 font-semibold">
                        仓库业务路线分析提示词 (可自由编辑)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({ ...form, learnPrompt: DEFAULT_PROMPTS.learnPrompt })
                        }
                        className="text-[10px] text-zinc-600 hover:text-zinc-700 transition flex items-center gap-1"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>恢复此项默认</span>
                      </button>
                    </div>
                    <textarea
                      rows={15}
                      value={form.learnPrompt || ''}
                      onChange={(e) => setForm({ ...form, learnPrompt: e.target.value })}
                      placeholder="写下您希望 AI 如何分析和讲解仓库业务路线..."
                      className="w-full bg-[#FAFAF9] border border-black/10 rounded-lg p-3 text-zinc-900 text-xs focus:outline-none focus:border-zinc-400 leading-relaxed font-sans"
                    />
                    <p className="text-[10px] text-zinc-500">
                      保存不会自动调用 AI。下次手动分析时使用新的提示词；旧提示词生成的学习缓存不会复用。
                    </p>
                  </div>
                </div>
              )}

              {/* Sub-Category 3: Fast Direct Diff Prompt */}
              {promptCategory === 'fastDiff' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <div className="p-3 bg-[#F7F7F5] border border-black/5 rounded-lg text-zinc-700 text-xs">
                    <span className="font-semibold text-zinc-700">💡 功能说明：</span>
                    <span className="text-zinc-600 ml-1">
                      当您在改动块或文件工具栏中点击「⚡ 直接解释」时，大模型将执行此提示词进行快速技术剖析。
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-zinc-700 font-semibold">
                        直接 Diff 解释提示词 (可自由编辑)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({ ...form, fastDiffPrompt: DEFAULT_PROMPTS.fastDiffPrompt })
                        }
                        className="text-[10px] text-zinc-600 hover:text-zinc-700 transition flex items-center gap-1"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>恢复此项默认</span>
                      </button>
                    </div>
                    <textarea
                      rows={6}
                      value={form.fastDiffPrompt || ''}
                      onChange={(e) => setForm({ ...form, fastDiffPrompt: e.target.value })}
                      placeholder="手写直接 Diff 解释指令..."
                      className="w-full bg-[#FAFAF9] border border-black/10 rounded-lg p-3 text-zinc-900 text-xs focus:outline-none focus:border-zinc-400 leading-relaxed font-sans"
                    />
                  </div>
                </div>
              )}

              {/* Sub-Category 4: Conceptual Pseudocode Prompt */}
              {promptCategory === 'pseudocode' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <div className="p-3 bg-[#F7F7F5] border border-black/5 rounded-lg text-zinc-700 text-xs">
                    <span className="font-semibold text-zinc-700">💡 功能说明：</span>
                    <span className="text-zinc-600 ml-1">
                      当您点击改动块上的「🤖 AI 伪代码」时，大模型将按照此提示词提炼出高层语义、通俗精炼的伪代码对照步骤。
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-zinc-700 font-semibold">
                        概括性伪代码提炼提示词 (可自由编辑)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({ ...form, pseudocodePrompt: DEFAULT_PROMPTS.pseudocodePrompt })
                        }
                        className="text-[10px] text-zinc-600 hover:text-zinc-700 transition flex items-center gap-1"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>恢复此项默认</span>
                      </button>
                    </div>
                    <textarea
                      rows={8}
                      value={form.pseudocodePrompt || ''}
                      onChange={(e) => setForm({ ...form, pseudocodePrompt: e.target.value })}
                      placeholder="手写概括性伪代码提炼指令..."
                      className="w-full bg-[#FAFAF9] border border-black/10 rounded-lg p-3 text-zinc-900 text-xs focus:outline-none focus:border-zinc-400 leading-relaxed font-sans"
                    />
                  </div>
                </div>
              )}

              {/* Sub-Category 5: Natural Language Narrative Prompt */}
              {promptCategory === 'naturalLanguage' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <div className="p-3 bg-[#F7F7F5] border border-black/5 rounded-lg text-zinc-700 text-xs">
                    <span className="font-semibold text-zinc-700">💡 功能说明：</span>
                    <span className="text-zinc-600 ml-1">
                      当您在改动块点击「📖 块释义」或右上角开启「📖 自然语言直读」时，大模型将按照此提示词将 Diff 叙述为通俗的业务故事。
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-zinc-700 font-semibold">
                        自然语言转译提示词 (可自由编辑)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            naturalLanguagePrompt: DEFAULT_PROMPTS.naturalLanguagePrompt,
                          })
                        }
                        className="text-[10px] text-zinc-600 hover:text-zinc-700 transition flex items-center gap-1"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>恢复此项默认</span>
                      </button>
                    </div>
                    <textarea
                      rows={8}
                      value={form.naturalLanguagePrompt || ''}
                      onChange={(e) => setForm({ ...form, naturalLanguagePrompt: e.target.value })}
                      placeholder="手写自然语言直读叙述指令..."
                      className="w-full bg-[#FAFAF9] border border-black/10 rounded-lg p-3 text-zinc-900 text-xs focus:outline-none focus:border-zinc-400 leading-relaxed font-sans"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Agent Exploration & Limits Configuration */}
          {activeTab === 'agent' && (
            <div className="space-y-4">
              <div className="p-3 bg-zinc-100 border border-zinc-300 rounded-lg text-zinc-700 text-xs flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Brain className="w-4 h-4 text-zinc-600 shrink-0" />
                  <span>在此微调 Codex 智能体对代码库探查的深度、超时保护与步数控制。</span>
                </div>
                <button
                  type="button"
                  onClick={handleResetAgentDefaults}
                  className="text-[11px] text-zinc-600 hover:text-zinc-700 flex items-center gap-1 shrink-0 ml-2"
                  title="恢复默认推荐值"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>恢复默认</span>
                </button>
              </div>

              {/* 1. Autonomous Planning vs Fixed Turns */}
              <div className="p-3 bg-[#FAFAF9] border border-black/5 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-zinc-900 flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-zinc-600" />
                    <span>探查模式与轮数上限 (Autonomous Planning)</span>
                  </label>
                  <span
                    className={`font-mono font-bold text-xs px-2 py-0.5 rounded border ${
                      !form.maxExplorationTurns || form.maxExplorationTurns === 0
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                        : 'bg-zinc-100 text-zinc-700 border-zinc-300'
                    }`}
                  >
                    {!form.maxExplorationTurns || form.maxExplorationTurns === 0
                      ? '✨ 自动规划（最多 10 轮）'
                      : `${form.maxExplorationTurns} 轮限制`}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, maxExplorationTurns: 0 })}
                    className={`p-2.5 rounded-lg border text-left transition ${
                      !form.maxExplorationTurns || form.maxExplorationTurns === 0
                        ? 'bg-zinc-100 border-zinc-400 text-zinc-950 shadow-sm'
                        : 'bg-[#FFFFFF] border-black/5 text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold text-xs">
                      <span>🤖 自动规划 (推荐)</span>
                      {(!form.maxExplorationTurns || form.maxExplorationTurns === 0) && (
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-1">
                      由 Codex 自主决定何时收敛；安全上限使用 Agents SDK 默认的 10 轮，达到后自动进入综合阶段。
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, maxExplorationTurns: form.maxExplorationTurns || 5 })}
                    className={`p-2.5 rounded-lg border text-left transition ${
                      form.maxExplorationTurns && form.maxExplorationTurns > 0
                        ? 'bg-zinc-100 border-zinc-400 text-zinc-950 shadow-sm'
                        : 'bg-[#FFFFFF] border-black/5 text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold text-xs">
                      <span>⚙️ 手动设定步数上限</span>
                      {form.maxExplorationTurns && form.maxExplorationTurns > 0 ? (
                        <Check className="w-3.5 h-3.5 text-zinc-600" />
                      ) : null}
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-1">
                      设定明确的探查轮数阈值，适合严苛控制 API 消耗。
                    </p>
                  </button>
                </div>

                {form.maxExplorationTurns && form.maxExplorationTurns > 0 ? (
                  <div className="space-y-1.5 pt-2 border-t border-black/5">
                    <div className="flex justify-between text-[11px] text-zinc-700">
                      <span>手动步数上限滑块：</span>
                      <span className="font-mono font-bold text-zinc-700">
                        {form.maxExplorationTurns} 轮
                      </span>
                    </div>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={form.maxExplorationTurns}
                      onChange={(e) =>
                        setForm({ ...form, maxExplorationTurns: parseInt(e.target.value, 10) })
                      }
                      className="w-full bg-[#FFFFFF] border border-black/10 rounded-lg px-2.5 py-1.5 text-zinc-900 font-mono text-xs focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                ) : null}
              </div>

              {/* 2. Timeout & Retries */}
              <div className="grid grid-cols-2 gap-3">
                {/* Timeout */}
                <div className="p-3 bg-[#FAFAF9] border border-black/5 rounded-lg space-y-1.5">
                  <label className="font-semibold text-zinc-700 text-xs flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-700" />
                    <span>首包等待超时 (TTFB)</span>
                  </label>
                  <input
                    type="number"
                    min={REQUEST_TIMEOUT_SECONDS.min}
                    max={REQUEST_TIMEOUT_SECONDS.max}
                    step={30}
                    value={form.timeoutSeconds || REQUEST_TIMEOUT_SECONDS.default}
                    onChange={(e) =>
                      setForm({ ...form, timeoutSeconds: parseInt(e.target.value, 10) })
                    }
                    className="w-full bg-[#FFFFFF] border border-black/10 rounded-lg px-2.5 py-1.5 text-zinc-900 font-mono text-xs focus:outline-none focus:border-zinc-400"
                  />
                  <p className="text-[10px] text-zinc-500">
                    只限制模型迟迟不开始响应；开始流式输出后不会按总时长截断
                  </p>
                </div>

                {/* Stream idle timeout */}
                <div className="p-3 bg-[#FAFAF9] border border-black/5 rounded-lg space-y-1.5">
                  <label className="font-semibold text-zinc-700 text-xs flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                    <span>流式静默超时</span>
                  </label>
                  <input
                    type="number"
                    min={STREAM_IDLE_TIMEOUT_SECONDS.min}
                    max={STREAM_IDLE_TIMEOUT_SECONDS.max}
                    step={30}
                    value={form.streamIdleTimeoutSeconds || STREAM_IDLE_TIMEOUT_SECONDS.default}
                    onChange={(e) =>
                      setForm({ ...form, streamIdleTimeoutSeconds: parseInt(e.target.value, 10) })
                    }
                    className="w-full bg-[#FFFFFF] border border-black/10 rounded-lg px-2.5 py-1.5 text-zinc-900 font-mono text-xs focus:outline-none focus:border-zinc-400"
                  />
                  <p className="text-[10px] text-zinc-500">
                    流式开始后连续无真实 AI 进度才中止；正常持续输出可运行任意时长
                  </p>
                </div>

                {/* Retries */}
                <div className="p-3 bg-[#FAFAF9] border border-black/5 rounded-lg space-y-1.5">
                  <label className="font-semibold text-zinc-700 text-xs flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                    <span>网络断线/超时重试</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={form.maxRetries !== undefined ? form.maxRetries : 2}
                    onChange={(e) => setForm({ ...form, maxRetries: parseInt(e.target.value, 10) })}
                    className="w-full bg-[#FFFFFF] border border-black/10 rounded-lg px-2.5 py-1.5 text-zinc-900 font-mono text-xs focus:outline-none focus:border-zinc-400"
                  />
                  <p className="text-[10px] text-zinc-500">遇到 504/网络抖动时自动指数退避重试</p>
                </div>
              </div>

              {/* 3. Read Lines & Search Results */}
              <div className="grid grid-cols-2 gap-3">
                {/* Max File Read Lines */}
                <div className="p-3 bg-[#FAFAF9] border border-black/5 rounded-lg space-y-1.5">
                  <label className="font-semibold text-zinc-700 text-xs flex items-center gap-1.5">
                    <FileCode2 className="w-3.5 h-3.5 text-emerald-700" />
                    <span>单文件最大阅读行数</span>
                  </label>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={form.maxReadFileLines || 2000}
                    onChange={(e) =>
                      setForm({ ...form, maxReadFileLines: parseInt(e.target.value, 10) || 2000 })
                    }
                    className="w-full bg-[#FFFFFF] border border-black/10 rounded-lg px-2.5 py-1.5 text-zinc-900 font-mono text-xs focus:outline-none focus:border-zinc-400"
                  />
                  <p className="text-[10px] text-zinc-500">默认 2000 行；大文件会返回下一页行号，可继续读取</p>
                </div>

                {/* Max Search Results */}
                <div className="p-3 bg-[#FAFAF9] border border-black/5 rounded-lg space-y-1.5">
                  <label className="font-semibold text-zinc-700 text-xs flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5 text-sky-700" />
                    <span>全库符号搜索上限</span>
                  </label>
                  <input
                    type="number"
                    min={10}
                    step={10}
                    value={form.maxSearchResults || 200}
                    onChange={(e) =>
                      setForm({ ...form, maxSearchResults: parseInt(e.target.value, 10) || 200 })
                    }
                    className="w-full bg-[#FFFFFF] border border-black/10 rounded-lg px-2.5 py-1.5 text-zinc-900 font-mono text-xs focus:outline-none focus:border-zinc-400"
                  />
                  <p className="text-[10px] text-zinc-500">默认每页 200 条；可由 Agent 使用 offset 继续翻页</p>
                </div>
              </div>

              {/* 5. Cache Storage Manager */}
              <div className="p-3 bg-[#FAFAF9] border border-black/5 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-zinc-900 text-xs flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-sky-700" />
                    <span>💾 本地审查与伪代码持久化缓存 (AI Review Cache)</span>
                  </label>
                  <span className="font-mono text-xs text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">
                    已保存 {aiCache.getCount()} 处审查结果
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 leading-relaxed">
                  系统会自动为已分析过的改动块与 Codex 报告建立指纹缓存，再次查看时 0ms 瞬间加载，0 额外 Token 消耗。
                </p>
                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      aiCache.clear();
                      alert('已成功清空所有本地 AI 审查与伪代码缓存！');
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>清空所有已缓存的 AI 结果</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="pt-3 border-t border-black/10 flex items-center justify-between shrink-0">
            <span className="text-[11px] text-zinc-500">配置将持久化保存在本地浏览器</span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-zinc-200 hover:bg-zinc-300 text-zinc-700 transition"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-semibold transition flex items-center space-x-1 shadow-sm"
              >
                {savedMessage ? <Check className="w-4 h-4" /> : null}
                <span>{savedMessage ? '已保存！' : '保存全部配置'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
