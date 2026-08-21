import React, { useState } from 'react';
import { AIProviderConfig } from '../types';
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
} from 'lucide-react';
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
    fastDiffPrompt: config.fastDiffPrompt || DEFAULT_PROMPTS.fastDiffPrompt,
    pseudocodePrompt: config.pseudocodePrompt || DEFAULT_PROMPTS.pseudocodePrompt,
    naturalLanguagePrompt:
      config.naturalLanguagePrompt || DEFAULT_PROMPTS.naturalLanguagePrompt,
    customSystemPrompt:
      config.reviewPrompt || config.customSystemPrompt || DEFAULT_PROMPTS.reviewPrompt,
    maxExplorationTurns:
      config.maxExplorationTurns !== undefined ? config.maxExplorationTurns : 0,
    timeoutSeconds: config.timeoutSeconds || 45,
    maxRetries: config.maxRetries !== undefined ? config.maxRetries : 2,
    maxReadFileLines: config.maxReadFileLines || 300,
    maxSearchResults: config.maxSearchResults || 30,
  });

  const [activeTab, setActiveTab] = useState<'model' | 'agent' | 'prompts'>('model');
  const [promptCategory, setPromptCategory] = useState<
    'review' | 'fastDiff' | 'pseudocode' | 'naturalLanguage'
  >('review');
  const [savedMessage, setSavedMessage] = useState(false);

  if (!isOpen) return null;

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
      timeoutSeconds: 45,
      maxRetries: 2,
      maxReadFileLines: 300,
      maxSearchResults: 30,
    }));
  };

  const handleResetAllPrompts = () => {
    setForm((prev) => ({
      ...prev,
      reviewPrompt: DEFAULT_PROMPTS.reviewPrompt,
      customSystemPrompt: DEFAULT_PROMPTS.reviewPrompt,
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
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#181922] border border-white/10 rounded-xl w-full max-w-xl shadow-2xl overflow-hidden text-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-[#14151B] border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">AI 引擎与审查定制配置</h2>
              <p className="text-[11px] text-slate-400">
                配置模型连接、专业级审查提示词与 Codex 智能体运行参数
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-[#13141A] px-5 pt-2 border-b border-white/5 space-x-4 text-xs font-semibold select-none shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('model')}
            className={`pb-2.5 flex items-center space-x-1.5 border-b-2 transition ${
              activeTab === 'model'
                ? 'border-purple-500 text-purple-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
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
                ? 'border-purple-500 text-purple-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquareQuote className="w-3.5 h-3.5 text-purple-400" />
            <span>审查提示词定制</span>
            {form.customSystemPrompt && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('agent')}
            className={`pb-2.5 flex items-center space-x-1.5 border-b-2 transition ${
              activeTab === 'agent'
                ? 'border-purple-500 text-purple-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Brain className="w-3.5 h-3.5 text-purple-400" />
            <span>Codex 探查与运行上限</span>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
          {/* TAB 1: Model Provider Settings */}
          {activeTab === 'model' && (
            <div className="space-y-4">
              <div>
                <label className="block text-slate-300 font-semibold mb-2">
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
                          ? 'bg-purple-600/20 border-purple-500 text-white shadow-sm shadow-purple-500/20'
                          : 'bg-[#1D1F28] border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'
                      }`}
                    >
                      <span className="font-semibold text-slate-200 text-xs">{item.label}</span>
                      <span className="text-[10px] text-slate-500 mt-1">{item.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-white/5">
                {/* API Key */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-purple-400" />
                    <span>API 密钥 (API Key)</span>
                  </label>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder={
                      form.provider === 'ollama' ? 'Ollama 本地运行无需填 Key' : form.provider === 'openrouter' ? 'sk-or-v1-...' : 'sk-...'
                    }
                    className="w-full bg-[#13141A] border border-white/10 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-purple-500/50"
                  />
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-sky-400" />
                    <span>接口地址 (Base URL)</span>
                  </label>
                  <input
                    type="text"
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    placeholder={form.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.deepseek.com/v1'}
                    className="w-full bg-[#13141A] border border-white/10 rounded-lg px-3 py-2 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-purple-500/50"
                  />
                </div>

                {/* Model */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-slate-300 font-semibold flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                      <span>模型名称 (Model)</span>
                    </label>
                    {form.provider === 'openrouter' && (
                      <span className="text-[10px] text-purple-300">💡 点击下方推荐模型快捷填入</span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="deepseek-chat / anthropic/claude-3.5-sonnet / gpt-4o-mini"
                    className="w-full bg-[#13141A] border border-white/10 rounded-lg px-3 py-2 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-purple-500/50"
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
                              ? 'bg-purple-600/30 text-purple-200 border-purple-500/50'
                              : 'bg-white/5 text-slate-400 border-white/5 hover:text-slate-200 hover:bg-white/10'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Custom Prompts Settings (Separated Default vs User Config for All Scenarios) */}
          {activeTab === 'prompts' && (
            <div className="space-y-4">
              {/* Category Sub-Tabs */}
              <div className="flex items-center justify-between">
                <div className="flex items-center bg-[#13141A] border border-white/10 rounded-lg p-1 space-x-1">
                  <button
                    type="button"
                    onClick={() => setPromptCategory('review')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1 ${
                      promptCategory === 'review'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Brain className="w-3 h-3" />
                    <span>1. 深度审查</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPromptCategory('fastDiff')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1 ${
                      promptCategory === 'fastDiff'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Zap className="w-3 h-3" />
                    <span>2. 直接 Diff</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPromptCategory('pseudocode')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1 ${
                      promptCategory === 'pseudocode'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>3. 概括伪代码</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPromptCategory('naturalLanguage')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition flex items-center space-x-1 ${
                      promptCategory === 'naturalLanguage'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <BookOpen className="w-3 h-3" />
                    <span>4. 自然语言</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleResetAllPrompts}
                  className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1 shrink-0 ml-2"
                  title="恢复所有 4 个场景的内置推荐提示词"
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
                    <label className="block text-slate-300 font-semibold mb-1.5">
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
                                ? 'bg-purple-600/20 border-purple-500 text-white shadow-sm'
                                : 'bg-[#15161E] border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-slate-200 text-xs">
                                  {preset.title}
                                </span>
                                {isSelected && (
                                  <span className="text-[10px] text-purple-300 font-mono flex items-center gap-0.5">
                                    <Check className="w-3 h-3" /> 当前选中
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
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
                      <label className="block text-slate-300 font-semibold">
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
                        className="text-[10px] text-purple-400 hover:text-purple-300 transition flex items-center gap-1"
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
                      className="w-full bg-[#13141A] border border-white/10 rounded-lg p-3 text-slate-200 text-xs focus:outline-none focus:border-purple-500/50 leading-relaxed font-sans"
                    />
                    <p className="text-[10px] text-slate-500">
                      用于「🧠 关联解释 (Codex)」和全文件审查，100% 由上方这段 Prompt 决定。
                    </p>
                  </div>
                </div>
              )}

              {/* Sub-Category 2: Fast Direct Diff Prompt */}
              {promptCategory === 'fastDiff' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <div className="p-3 bg-[#14151E] border border-white/5 rounded-lg text-slate-300 text-xs">
                    <span className="font-semibold text-purple-300">💡 功能说明：</span>
                    <span className="text-slate-400 ml-1">
                      当您在改动块或文件工具栏中点击「⚡ 直接解释」时，大模型将执行此提示词进行快速技术剖析。
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-slate-300 font-semibold">
                        直接 Diff 解释提示词 (可自由编辑)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({ ...form, fastDiffPrompt: DEFAULT_PROMPTS.fastDiffPrompt })
                        }
                        className="text-[10px] text-purple-400 hover:text-purple-300 transition flex items-center gap-1"
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
                      className="w-full bg-[#13141A] border border-white/10 rounded-lg p-3 text-slate-200 text-xs focus:outline-none focus:border-purple-500/50 leading-relaxed font-sans"
                    />
                  </div>
                </div>
              )}

              {/* Sub-Category 3: Conceptual Pseudocode Prompt */}
              {promptCategory === 'pseudocode' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <div className="p-3 bg-[#14151E] border border-white/5 rounded-lg text-slate-300 text-xs">
                    <span className="font-semibold text-purple-300">💡 功能说明：</span>
                    <span className="text-slate-400 ml-1">
                      当您点击改动块上的「🤖 AI 伪代码」时，大模型将按照此提示词提炼出高层语义、通俗精炼的伪代码对照步骤。
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-slate-300 font-semibold">
                        概括性伪代码提炼提示词 (可自由编辑)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({ ...form, pseudocodePrompt: DEFAULT_PROMPTS.pseudocodePrompt })
                        }
                        className="text-[10px] text-purple-400 hover:text-purple-300 transition flex items-center gap-1"
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
                      className="w-full bg-[#13141A] border border-white/10 rounded-lg p-3 text-slate-200 text-xs focus:outline-none focus:border-purple-500/50 leading-relaxed font-sans"
                    />
                  </div>
                </div>
              )}

              {/* Sub-Category 4: Natural Language Narrative Prompt */}
              {promptCategory === 'naturalLanguage' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <div className="p-3 bg-[#14151E] border border-white/5 rounded-lg text-slate-300 text-xs">
                    <span className="font-semibold text-purple-300">💡 功能说明：</span>
                    <span className="text-slate-400 ml-1">
                      当您在改动块点击「📖 块释义」或右上角开启「📖 自然语言直读」时，大模型将按照此提示词将 Diff 叙述为通俗的业务故事。
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-slate-300 font-semibold">
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
                        className="text-[10px] text-purple-400 hover:text-purple-300 transition flex items-center gap-1"
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
                      className="w-full bg-[#13141A] border border-white/10 rounded-lg p-3 text-slate-200 text-xs focus:outline-none focus:border-purple-500/50 leading-relaxed font-sans"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Agent Exploration & Limits Configuration */}
          {activeTab === 'agent' && (
            <div className="space-y-4">
              <div className="p-3 bg-purple-950/25 border border-purple-500/30 rounded-lg text-slate-300 text-xs flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Brain className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>在此微调 Codex 智能体对代码库探查的深度、超时保护与步数控制。</span>
                </div>
                <button
                  type="button"
                  onClick={handleResetAgentDefaults}
                  className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1 shrink-0 ml-2"
                  title="恢复默认推荐值"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>恢复默认</span>
                </button>
              </div>

              {/* 1. Autonomous Planning vs Fixed Turns */}
              <div className="p-3 bg-[#13141A] border border-white/5 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-purple-400" />
                    <span>探查模式与规划上限 (Autonomous Planning)</span>
                  </label>
                  <span
                    className={`font-mono font-bold text-xs px-2 py-0.5 rounded border ${
                      !form.maxExplorationTurns || form.maxExplorationTurns === 0
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                    }`}
                  >
                    {!form.maxExplorationTurns || form.maxExplorationTurns === 0
                      ? '✨ 完全自主规划 (无上限)'
                      : `${form.maxExplorationTurns} 轮限制`}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, maxExplorationTurns: 0 })}
                    className={`p-2.5 rounded-lg border text-left transition ${
                      !form.maxExplorationTurns || form.maxExplorationTurns === 0
                        ? 'bg-purple-600/20 border-purple-500 text-white shadow-sm'
                        : 'bg-[#181924] border-white/5 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold text-xs">
                      <span>🤖 完全自主规划 (推荐)</span>
                      {(!form.maxExplorationTurns || form.maxExplorationTurns === 0) && (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      无任何人为步数限制，由 Codex 自主决定何时收集充足并产出报告。
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, maxExplorationTurns: form.maxExplorationTurns || 5 })}
                    className={`p-2.5 rounded-lg border text-left transition ${
                      form.maxExplorationTurns && form.maxExplorationTurns > 0
                        ? 'bg-purple-600/20 border-purple-500 text-white shadow-sm'
                        : 'bg-[#181924] border-white/5 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold text-xs">
                      <span>⚙️ 手动设定步数上限</span>
                      {form.maxExplorationTurns && form.maxExplorationTurns > 0 ? (
                        <Check className="w-3.5 h-3.5 text-purple-400" />
                      ) : null}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      设定明确的探查轮数阈值，适合严苛控制 API 消耗。
                    </p>
                  </button>
                </div>

                {form.maxExplorationTurns && form.maxExplorationTurns > 0 ? (
                  <div className="space-y-1.5 pt-2 border-t border-white/5">
                    <div className="flex justify-between text-[11px] text-slate-300">
                      <span>手动步数上限滑块：</span>
                      <span className="font-mono font-bold text-purple-300">
                        {form.maxExplorationTurns} 轮
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={1}
                      value={form.maxExplorationTurns}
                      onChange={(e) =>
                        setForm({ ...form, maxExplorationTurns: parseInt(e.target.value, 10) })
                      }
                      className="w-full accent-purple-500 cursor-pointer"
                    />
                  </div>
                ) : null}
              </div>

              {/* 2. Timeout & Retries */}
              <div className="grid grid-cols-2 gap-3">
                {/* Timeout */}
                <div className="p-3 bg-[#13141A] border border-white/5 rounded-lg space-y-1.5">
                  <label className="font-semibold text-slate-300 text-xs flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    <span>单轮请求超时控制</span>
                  </label>
                  <select
                    value={form.timeoutSeconds || 35}
                    onChange={(e) =>
                      setForm({ ...form, timeoutSeconds: parseInt(e.target.value, 10) })
                    }
                    className="w-full bg-[#181924] border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-purple-500/50"
                  >
                    <option value={20}>20 秒 (网络极快)</option>
                    <option value={30}>30 秒 (标准推荐)</option>
                    <option value={45}>45 秒 (复杂推理)</option>
                    <option value={60}>60 秒 (超长等待)</option>
                    <option value={90}>90 秒 (极慢网络)</option>
                  </select>
                  <p className="text-[10px] text-slate-500">超时将自动中止当前等待并触发重试</p>
                </div>

                {/* Retries */}
                <div className="p-3 bg-[#13141A] border border-white/5 rounded-lg space-y-1.5">
                  <label className="font-semibold text-slate-300 text-xs flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                    <span>网络断线/超时重试</span>
                  </label>
                  <select
                    value={form.maxRetries !== undefined ? form.maxRetries : 2}
                    onChange={(e) => setForm({ ...form, maxRetries: parseInt(e.target.value, 10) })}
                    className="w-full bg-[#181924] border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-purple-500/50"
                  >
                    <option value={0}>0 次 (不重试)</option>
                    <option value={1}>1 次</option>
                    <option value={2}>2 次 (推荐)</option>
                    <option value={3}>3 次</option>
                  </select>
                  <p className="text-[10px] text-slate-500">遇到 504/网络抖动时自动指数退避重试</p>
                </div>
              </div>

              {/* 3. Read Lines & Search Results */}
              <div className="grid grid-cols-2 gap-3">
                {/* Max File Read Lines */}
                <div className="p-3 bg-[#13141A] border border-white/5 rounded-lg space-y-1.5">
                  <label className="font-semibold text-slate-300 text-xs flex items-center gap-1.5">
                    <FileCode2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>单文件最大阅读行数</span>
                  </label>
                  <input
                    type="number"
                    min={100}
                    max={1000}
                    step={50}
                    value={form.maxReadFileLines || 300}
                    onChange={(e) =>
                      setForm({ ...form, maxReadFileLines: parseInt(e.target.value, 10) || 300 })
                    }
                    className="w-full bg-[#181924] border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-purple-500/50"
                  />
                  <p className="text-[10px] text-slate-500">建议 200~400 行，包含类核心结构</p>
                </div>

                {/* Max Search Results */}
                <div className="p-3 bg-[#13141A] border border-white/5 rounded-lg space-y-1.5">
                  <label className="font-semibold text-slate-300 text-xs flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5 text-sky-400" />
                    <span>全库符号搜索上限</span>
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={80}
                    step={5}
                    value={form.maxSearchResults || 30}
                    onChange={(e) =>
                      setForm({ ...form, maxSearchResults: parseInt(e.target.value, 10) || 30 })
                    }
                    className="w-full bg-[#181924] border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-purple-500/50"
                  />
                  <p className="text-[10px] text-slate-500">全库检索某函数/类名的最多调用行</p>
                </div>
              </div>

              {/* 3. Cache Storage Manager */}
              <div className="p-3 bg-[#13141A] border border-white/5 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 text-xs flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-sky-400" />
                    <span>💾 本地审查与伪代码持久化缓存 (AI Review Cache)</span>
                  </label>
                  <span className="font-mono text-xs text-sky-300 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded">
                    已保存 {aiCache.getCount()} 处审查结果
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  系统会自动为已分析过的改动块与 Codex 报告建立指纹缓存，再次查看时 0ms 瞬间加载，0 额外 Token 消耗。
                </p>
                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      aiCache.clear();
                      alert('已成功清空所有本地 AI 审查与伪代码缓存！');
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-xs transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>清空所有已缓存的 AI 结果</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="pt-3 border-t border-white/10 flex items-center justify-between shrink-0">
            <span className="text-[11px] text-slate-500">配置将持久化保存在本地浏览器</span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold transition flex items-center space-x-1 shadow-md shadow-purple-600/20"
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
