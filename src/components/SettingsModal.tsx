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
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AIProviderConfig;
  onSaveConfig: (config: AIProviderConfig) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [form, setForm] = useState<AIProviderConfig>({
    ...config,
    maxExplorationTurns: config.maxExplorationTurns || 5,
    timeoutSeconds: config.timeoutSeconds || 35,
    maxRetries: config.maxRetries !== undefined ? config.maxRetries : 2,
    maxReadFileLines: config.maxReadFileLines || 300,
    maxSearchResults: config.maxSearchResults || 30,
  });

  const [activeTab, setActiveTab] = useState<'model' | 'agent'>('model');
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
              <h2 className="text-sm font-bold text-white">AI 引擎与 Codex 运行配置</h2>
              <p className="text-[11px] text-slate-400">
                配置模型连接与智能体探查轮次、超时及代码库检索上限
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
            onClick={() => setActiveTab('agent')}
            className={`pb-2.5 flex items-center space-x-1.5 border-b-2 transition ${
              activeTab === 'agent'
                ? 'border-purple-500 text-purple-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Brain className="w-3.5 h-3.5 text-purple-400" />
            <span>Codex 探查与运行上限</span>
            <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.2 rounded-full font-mono">
              可调
            </span>
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

          {/* TAB 2: Agent Exploration & Limits Configuration */}
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
