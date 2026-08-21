import React, { useState } from 'react';
import { AIProviderConfig } from '../types';
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
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AIProviderConfig;
  onSaveConfig: (config: AIProviderConfig) => void;
}

const PROMPT_PRESETS = [
  {
    id: 'expert_deep',
    title: '🎯 深度代码剖析与前后对比 (专家级·默认推荐)',
    icon: Code2,
    desc: '清晰对比改动前后行为差异（Before vs After），深入剖析核心语句实现机制、参数语义与跨模块调用。',
    prompt: `你是一位顶级资深架构师与代码审查专家。请对给定的 Git Diff 进行深度、精确的技术剖析。

【审查原则与要求】：
1. 直击核心代码细节：严禁空洞套话，严禁简单复述语法。必须精确指出涉及的类名、方法名、参数类型、数据结构与关键算法。
2. 改动前后行为对比 (Before vs After)：清晰对比改动前的旧逻辑与改动后的新逻辑，说明代码执行路径、状态流转或计算方式的具体差异。
3. 深入解释实现机制与原因：透彻解析“为什么这样改”（底层机制、内存/并发模型、解耦或调用约定）。
4. 跨模块调用与依赖影响：若涉及接口变更、公共方法签名或命名空间，明确指出对下游调用方的影响。

【输出排版参考】：
### 🔄 核心改动前后对比 (Before vs After)
- **改动前旧逻辑**：说明先前代码的行为与局限
- **改动后新逻辑**：说明本次改动后的实现与改变

### 🔬 关键代码实现深度拆解 (Implementation Mechanics)
深入剖析每一处核心修改语句、状态迁移、数据流转与参数语义。

### 🌐 跨模块影响与下游调用 (Callers & Impact)
明确说明修改对外部依赖、调用方或工程配置的实际影响（若无则简要说明）。`,
  },
  {
    id: 'concise_tech',
    title: '⚡ 极简技术直解 (纯逻辑·极速干练)',
    icon: Zap,
    desc: '直奔技术主题，用最干练精辟的语言直解每行改动逻辑与实际影响，零套话。',
    prompt: `你是一位顶级代码专家。请直接对代码改动进行详实、紧凑的技术解析：
1. 深入拆解核心语句、方法调用与参数变更的具体逻辑；
2. 清晰对比改动前后的行为差异；
3. 说明对外部调用方的实际影响。
文字干练精辟，直击技术要害，零套话。`,
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
    customSystemPrompt: config.customSystemPrompt || PROMPT_PRESETS[0].prompt,
    maxExplorationTurns: config.maxExplorationTurns || 5,
    timeoutSeconds: config.timeoutSeconds || 35,
    maxRetries: config.maxRetries !== undefined ? config.maxRetries : 2,
    maxReadFileLines: config.maxReadFileLines || 300,
    maxSearchResults: config.maxSearchResults || 30,
  });

  const [activeTab, setActiveTab] = useState<'model' | 'agent' | 'prompts'>('model');
  const [savedMessage, setSavedMessage] = useState(false);

  if (!isOpen) return null;

  const handleProviderSelect = (provider: AIProviderConfig['provider']) => {
    let baseUrl = '';
    let model = '';

    if (provider === 'deepseek') {
      baseUrl = 'https://api.deepseek.com/v1';
      model = 'deepseek-chat';
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
      maxExplorationTurns: 5,
      timeoutSeconds: 35,
      maxRetries: 2,
      maxReadFileLines: 300,
      maxSearchResults: 30,
    }));
  };

  const handleApplyPresetPrompt = (prompt: string) => {
    setForm((prev) => ({
      ...prev,
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
                      form.provider === 'ollama' ? 'Ollama 本地运行无需填 Key' : 'sk-...'
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
                    placeholder="https://api.deepseek.com/v1"
                    className="w-full bg-[#13141A] border border-white/10 rounded-lg px-3 py-2 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-purple-500/50"
                  />
                </div>

                {/* Model */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                    <span>模型名称 (Model)</span>
                  </label>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="deepseek-chat / gpt-4o-mini / gemini-1.5-flash / qwen2.5-coder"
                    className="w-full bg-[#13141A] border border-white/10 rounded-lg px-3 py-2 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-purple-500/50"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Custom Prompts Settings */}
          {activeTab === 'prompts' && (
            <div className="space-y-4">
              <div className="p-3 bg-purple-950/25 border border-purple-500/30 rounded-lg text-slate-300 text-xs">
                <div className="flex items-center space-x-2 font-semibold text-purple-200 mb-1">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span>专家级审查指令 (Prompt Presets & Editor)</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  点击下方预设可一键加载专业审查模板，或在下方文本框中自由调整为您的专属提示词。
                </p>
              </div>

              {/* One-Click Presets */}
              <div>
                <label className="block text-slate-300 font-semibold mb-2">
                  ⚡ 常用审查偏好一键预设 (点击即可填充到下方编辑)
                </label>
                <div className="grid grid-cols-1 gap-1.5">
                  {PROMPT_PRESETS.map((preset) => {
                    const isSelected = form.customSystemPrompt === preset.prompt;
                    const Icon = preset.icon;

                    return (
                      <button
                        type="button"
                        key={preset.id}
                        onClick={() => handleApplyPresetPrompt(preset.prompt)}
                        className={`p-2.5 rounded-lg border text-left transition flex items-start space-x-3 ${
                          isSelected
                            ? 'bg-purple-600/20 border-purple-500 text-white shadow-sm'
                            : 'bg-[#15161E] border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'
                        }`}
                      >
                        <Icon className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
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
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                            {preset.desc}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Prompt Textarea */}
              <div className="space-y-1.5 pt-2 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <label className="block text-slate-300 font-semibold">
                    生效的审查指令内容 (可自由编辑)
                  </label>
                  {form.customSystemPrompt && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, customSystemPrompt: '' })}
                      className="text-[10px] text-slate-500 hover:text-rose-400 transition"
                    >
                      清空自定义指令
                    </button>
                  )}
                </div>
                <textarea
                  rows={6}
                  value={form.customSystemPrompt}
                  onChange={(e) => setForm({ ...form, customSystemPrompt: e.target.value })}
                  placeholder="可在此手写任意审查指令..."
                  className="w-full bg-[#13141A] border border-white/10 rounded-lg p-3 text-slate-200 text-xs focus:outline-none focus:border-purple-500/50 leading-relaxed font-sans"
                />
                <p className="text-[10px] text-slate-500">
                  后台代码不会强塞任何固化死板的套话，所有审查行为 100% 由上方这段 Prompt 决定。
                </p>
              </div>
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

              {/* 1. Max Exploration Turns */}
              <div className="p-3 bg-[#13141A] border border-white/5 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-purple-400" />
                    <span>最大探查决策轮数 (Max Exploration Turns)</span>
                  </label>
                  <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {form.maxExplorationTurns || 5} 轮
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={12}
                  step={1}
                  value={form.maxExplorationTurns || 5}
                  onChange={(e) =>
                    setForm({ ...form, maxExplorationTurns: parseInt(e.target.value, 10) })
                  }
                  className="w-full accent-purple-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span className={form.maxExplorationTurns! <= 3 ? 'text-amber-400 font-bold' : ''}>
                    1~3 轮 (⚡ 极速 ~15s)
                  </span>
                  <span
                    className={
                      form.maxExplorationTurns! >= 4 && form.maxExplorationTurns! <= 6
                        ? 'text-emerald-400 font-bold'
                        : ''
                    }
                  >
                    4~6 轮 (🧠 深度均衡 ~35s)
                  </span>
                  <span className={form.maxExplorationTurns! >= 7 ? 'text-purple-400 font-bold' : ''}>
                    7~12 轮 (🔬 穷尽全库 ~60s+)
                  </span>
                </div>
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
