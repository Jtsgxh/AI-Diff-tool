import React, { useState } from 'react';
import { AIProviderConfig } from '../types';
import { Settings, X, Check, Key, Globe, Cpu } from 'lucide-react';

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
  const [form, setForm] = useState<AIProviderConfig>(config);
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
      <div className="bg-[#181922] border border-white/10 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-5 py-4 bg-[#14151B] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">AI 真实模型配置</h2>
              <p className="text-[11px] text-slate-400">连接您的真实 LLM 大模型（DeepSeek / Gemini / OpenAI / 本地 Ollama）</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
          {/* Provider Selection Buttons */}
          <div>
            <label className="block text-slate-300 font-semibold mb-2">选择 AI 大模型提供商</label>
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
                placeholder={form.provider === 'ollama' ? 'Ollama 本地运行无需填 Key' : 'sk-...'}
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

          {/* Footer */}
          <div className="pt-3 border-t border-white/10 flex items-center justify-between">
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
                <span>{savedMessage ? '已保存！' : '保存配置'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
