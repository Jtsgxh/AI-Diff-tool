// Real workbench, hook, cache keys, report validation and SSE client. All data and
// AI requests are intercepted here; no backend/model calls or user-cache writes.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LearnWorkbench } from '../src/components/Learn/LearnWorkbench';
import { aiCache, type CachedReviewItem } from '../src/services/aiCache';
import { storage } from '../src/constants/storage';
import type { AIProviderConfig, LearnGraph } from '../src/types';
import '../src/index.css';

const cache = new Map<string, CachedReviewItem>();
let savedReports = 0;
aiCache.get = (key) => cache.get(key) || null;
aiCache.set = (key, item) => {
  savedReports++;
  cache.set(key, { ...item, key, timestamp: Date.now() });
};
aiCache.remove = (key) => { cache.delete(key); };
storage.get = () => null;
storage.set = () => true;

const config: AIProviderConfig = { provider: 'custom', apiKey: '', baseUrl: '', model: 'fixture-model' };
const graph: LearnGraph = {
  nodes: ['Entry', 'Service'].map((label) => ({ id: label, label, kind: 'class', file: `src/${label}.ts`, communityId: '0', degree: 1 })),
  edges: [{ source: 'Entry', target: 'Service', relation: 'calls' }],
  communities: [{ id: '0', label: '候选代码社区', summary: '', files: ['src/Entry.ts', 'src/Service.ts'], godNodes: ['Entry'], nodeCount: 2, cohesion: 1 }],
  businessRoutes: [], runtimePath: [], godNodes: [], bridges: [],
  stats: { filesParsed: 2, symbolCount: 2, edgeCount: 1, truncated: false, sourceFingerprint: 'fixture-source' },
};
const report = '```learn-graph\n' + JSON.stringify({
  communities: [{ id: '0', label: '测试业务社区', summary: '测试缓存恢复', files: ['src/Entry.ts', 'src/Service.ts'] }],
  businessRoutes: [{ id: 'route', label: '测试业务路线', summary: '完整调用链',
    steps: graph.nodes.map((node) => ({ label: node.label, file: node.file, classSymbol: node.label,
      description: '测试步骤', relation: '调用', evidence: `${node.file}:1` })) }],
  runtimePath: ['0'],
}) + '\n```\n\n这是测试业务路线讲解。';
const requests: { repoPath: string; model: string; question?: string }[] = [];
let aborted = 0;
let responseMode: 'ok' | 'error' | 'hold' = 'ok';
let sourceRevision = 0;
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  if (url.pathname === '/api/repo/overview') {
    return Response.json({ fileCount: 2, languages: [], topDirs: [], manifests: [], entryCandidates: [] });
  }
  if (url.pathname === '/api/repo/learn-graph') {
    const source = { ...graph, stats: { ...graph.stats, sourceFingerprint: `fixture-source-${sourceRevision}` } };
    await new Promise((resolve) => setTimeout(resolve, 40));
    return Response.json(source);
  }
  if (url.pathname === '/api/ai/agent/explain/stream') {
    const body = JSON.parse(String(init?.body));
    requests.push({ repoPath: body.repoPath, model: body.config.model, question: body.userPrompt });
    if (responseMode === 'hold') {
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => {
          aborted++;
          reject(new DOMException('Fixture cancelled', 'AbortError'));
        }, { once: true });
      });
    }
    if (responseMode === 'error') return Response.json({ error: 'fixture AI failure' }, { status: 500 });
    return new Response([
      `data: ${JSON.stringify({ type: 'chunk', text: body.userPrompt ? '这是测试追问回答。' : report })}\n\n`,
      'data: {"type":"done"}\n\n',
    ].join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  throw new Error(`Unexpected fixture request: ${url.pathname}`);
};

function Fixture() {
  const [mounted, setMounted] = useState(true);
  const [repoPath, setRepoPath] = useState('fixture/repo-a');
  const [head, setHead] = useState('head-a');
  const [revision, setRevision] = useState(0);
  const [aiConfig, setConfig] = useState(config);
  const [askFile, setAskFile] = useState<string | null>(null);
  const [result, setResult] = useState('尚未验证');
  const [running, setRunning] = useState(false);
  const run = async () => {
    const checks: string[] = [];
    const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="workbench"] button')]
      .find((item) => item.textContent?.trim() === name);
    const content = () => document.querySelector('[data-testid="workbench"]')?.textContent || '';
    const delay = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (condition: () => boolean) => {
      const deadline = performance.now() + 5000;
      while (!condition()) {
        if (performance.now() > deadline) throw new Error('等待学习页状态超时');
        await delay(20);
      }
    };
    const ready = () => Boolean(button('开始 AI 分析') && !button('开始 AI 分析')!.disabled);
    const check = (name: string, condition: boolean) => {
      if (!condition) throw new Error(name);
      checks.push(name);
    };
    const reopen = async () => {
      setMounted(false);
      await delay();
      setMounted(true);
      await until(() => Boolean(button('开始 AI 分析') && !button('开始 AI 分析')!.disabled) || Boolean(button('重新分析')));
      await delay();
    };
    setRunning(true);
    setResult('正在验证：所有 AI 请求均为本地模拟');
    try {
      setMounted(false);
      await delay();
      cache.clear();
      savedReports = 0;
      requests.length = 0;
      aborted = 0;
      responseMode = 'ok';
      sourceRevision = 0;
      setRepoPath('fixture/repo-a'); setHead('head-a'); setRevision(0); setConfig(config); setAskFile(null);
      setMounted(true);
      await until(ready);
      await delay();
      check('首次进入无缓存不调用 AI', requests.length === 0 && content().includes('进入本页不会消耗模型 token'));
      await reopen();
      check('无缓存反复进入仍不调用 AI', requests.length === 0 && ready());
      button('开始 AI 分析')!.click();
      await until(() => savedReports === 1 && Boolean(button('重新分析')));
      check('手动开始仅调用一次并保存完整结果', requests.length === 1 && cache.size === 1 && content().includes('这是测试业务路线讲解'));
      await reopen();
      check('重新进入恢复缓存且不调用 AI', requests.length === 1 && content().includes('测试业务路线') && content().includes('这是测试业务路线讲解'));
      button('重新分析')!.click();
      await until(() => savedReports === 2 && Boolean(button('重新分析')));
      check('手动重新分析仍可调用 AI', requests.length === 2 && cache.size === 1);
      const [key, cached] = [...cache.entries()][0];
      cache.set(key, { ...cached, report: report.replace('"classSymbol":"Service"', '"classSymbol":"MissingClass"') });
      await reopen();
      check('无法映射的缓存被拒绝且不自动重跑', requests.length === 2 && cache.size === 0 && content().includes('已有分析结果无效'));
      cache.set(key, { ...cached, report: '未完成的分析正文' });
      await reopen();
      check('损坏缓存不触发 AI', requests.length === 2 && cache.size === 0 && content().includes('已有分析结果无效'));
      cache.set(key, cached);
      await reopen();
      check('有效缓存仍可恢复', requests.length === 2 && content().includes('这是测试业务路线讲解'));
      setConfig((previous) => ({ ...previous, learnPrompt: 'fixture new prompt' }));
      await until(ready); await delay();
      check('换提示词不自动分析也不复用旧报告', requests.length === 2 && !content().includes('这是测试业务路线讲解'));
      setConfig((previous) => ({ ...previous, model: 'fixture-model-2' }));
      await delay();
      check('换模型不自动分析', requests.length === 2 && ready());
      sourceRevision++;
      setRevision((previous) => previous + 1);
      await delay(); await until(ready);
      check('源码变化刷新不自动分析', requests.length === 2 && ready());
      setHead('head-b');
      await delay(); await until(ready);
      check('切换提交不自动分析', requests.length === 2 && ready());
      setRepoPath('fixture/repo-b');
      await delay(); await until(ready);
      check('切换仓库不自动分析', requests.length === 2 && ready());
      responseMode = 'error';
      button('开始 AI 分析')!.click();
      await until(() => content().includes('fixture AI failure'));
      await delay();
      check('手动分析失败后不自动重试', requests.length === 3);
      await reopen();
      check('失败后重新进入不自动重试', requests.length === 3 && ready());
      responseMode = 'ok';
      setAskFile('src/Entry.ts');
      await until(() => content().includes('这是测试追问回答'));
      check('主动询问文件仅发出追问请求', requests.length === 4 && Boolean(requests[3].question));
      responseMode = 'hold';
      button('开始 AI 分析')!.click();
      await until(() => requests.length === 5 && Boolean(button('分析中…')));
      setConfig((previous) => ({ ...previous, learnPrompt: 'fixture prompt during stream' }));
      await delay();
      check('进行中修改提示词不另开 AI 请求', requests.length === 5 && Boolean(button('分析中…')));
      setMounted(false);
      await until(() => aborted === 1);
      check('离开页面取消未完成请求', aborted === 1);
      responseMode = 'ok';
      setMounted(true);
      await until(ready); await delay();
      check('中断后重新进入不自动续跑', requests.length === 5 && ready());
      setResult(JSON.stringify({ passed: checks.length, requests: requests.length, aborted, checks }, null, 2));
    } catch (error) {
      setResult(JSON.stringify({ passed: checks.length, failed: String(error), requests, checks }, null, 2));
    } finally {
      setRunning(false);
    }
  };
  return <main className="flex h-screen flex-col bg-[#12131a] text-slate-200">
    <header className="flex gap-4 p-3">
      <button disabled={running} onClick={run}>验证手动分析</button>
      <button disabled={running} onClick={() => setMounted(!mounted)}>{mounted ? '离开学习' : '进入学习'}</button>
      <span>全部请求本地模拟，不使用真实仓库、模型或缓存</span>
    </header>
    <pre data-testid="result" className="max-h-56 overflow-auto px-3 text-xs whitespace-pre-wrap">{result}</pre>
    <div data-testid="workbench" className="flex-1 min-h-0">
      {mounted && <LearnWorkbench repoPath={repoPath} repoName="测试仓库" headHash={head}
        repositoryRevision={revision} aiConfig={aiConfig} askAboutFile={askFile}
        onAskAboutFileConsumed={() => setAskFile(null)} />}
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
