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
const preferences = new Map<string, string>();
storage.get = (key) => preferences.get(key) ?? null;
storage.set = (key, value) => { preferences.set(key, value); return true; };

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
    steps: graph.nodes.map((node, index, nodes) => ({ label: node.label, file: node.file, classSymbol: node.label,
      methodSymbol: 'run', communityId: node.communityId, kind: index === 0 ? 'entry' : index === nodes.length - 1 ? 'result' : 'process',
      description: '测试步骤', relation: '调用', evidence: `${node.file}:1`,
      inputs: [], outputs: [], stateChanges: [], failurePaths: [] })) }],
  runtimePath: ['0'],
}) + '\n```\n\n这是测试业务路线讲解。';
const expansionReport = '```learn-graph\n' + JSON.stringify({
  communities: [{ id: '0', label: '测试业务社区', summary: '手动补图', files: ['src/Entry.ts', 'src/Service.ts'] }],
  businessRoutes: [{ id: 'manual-route', label: '手动补充路线', summary: '用户主动补充的业务闭环',
    steps: graph.nodes.map((node, index, routeNodes) => ({ label: `补图${node.label}`, file: node.file, classSymbol: node.label,
      methodSymbol: index === 0 ? 'manualStart' : 'manualFinish', communityId: node.communityId,
      kind: index === 0 ? 'entry' : index === routeNodes.length - 1 ? 'result' : 'process',
      description: '手动问题核实出的步骤', relation: index === 0 ? '入口' : '返回', evidence: `${node.label}.manual(...)`,
      inputs: [], outputs: [], stateChanges: [], failurePaths: [] })) }],
  runtimePath: ['0'],
}) + '\n```\n\n已根据手动问题补充业务路线。';
const drilldownReport = '```learn-graph\n' + JSON.stringify({
  communities: [{ id: '0', label: '测试业务社区', summary: '节点内部执行', files: ['src/Entry.ts', 'src/Service.ts'] }],
  businessRoutes: [{ id: 'drill-route', label: '节点内部执行', summary: '所选步骤内部的更细执行链',
    steps: graph.nodes.map((node, index, routeNodes) => ({ label: index === 0 ? '内部入口' : '内部结果',
      file: node.file, classSymbol: node.label, methodSymbol: index === 0 ? 'prepare' : 'complete',
      communityId: node.communityId, kind: index === 0 ? 'entry' : index === routeNodes.length - 1 ? 'result' : 'process',
      description: '节点内部源码步骤', relation: index === 0 ? '进入' : '返回', evidence: `${node.label}.${index === 0 ? 'prepare' : 'complete'}(...)`,
      inputs: [], outputs: [], stateChanges: [], failurePaths: [] })) }],
  runtimePath: ['0'],
}) + '\n```\n\n这是所选节点内部的细化执行路线。';
const drilldownLeafReport = '```learn-graph\n' + JSON.stringify({
  communities: [{ id: '0', label: '测试业务社区', summary: '源码粒度终点', files: ['src/Entry.ts', 'src/Service.ts'] }],
  businessRoutes: [],
  runtimePath: ['0'],
}) + '\n```\n\n该节点已到源码证据粒度，未生成猜测节点。';
const filterNodes: LearnGraph['nodes'] = [
  ...['Entry', 'Service', 'AbilitySpec', 'LatestSnapshot', 'ContestReward', 'CombatTestPipelineAbilitySpec']
    .map((label) => ({ id: label, label, kind: 'class' as const, file: `src/${label}.cs`, communityId: '0', degree: 0 })),
  { id: 'Helper', label: 'Helper', kind: 'class', file: 'src/__tests__/Helper.ts', communityId: '1', degree: 0 },
  { id: 'Probe', label: 'Probe', kind: 'class', file: 'src/Demo.Tests/Probe.cs', communityId: '1', degree: 0 },
];
const filterGraph: LearnGraph = {
  ...graph, nodes: filterNodes,
  edges: [['Entry', 'Service'], ['Entry', 'AbilitySpec'], ['AbilitySpec', 'LatestSnapshot'], ['LatestSnapshot', 'ContestReward'],
    ['Entry', 'CombatTestPipelineAbilitySpec'], ['CombatTestPipelineAbilitySpec', 'Service'], ['Service', 'Helper'], ['Helper', 'Probe']]
    .map(([source, target]) => ({ source, target, relation: 'calls' })),
  communities: ['0', '1'].map((id) => ({ id, label: id === '0' ? '业务社区' : '仅测试社区', summary: '',
    files: filterNodes.filter((node) => node.communityId === id).map((node) => node.file!),
    godNodes: [], nodeCount: filterNodes.filter((node) => node.communityId === id).length, cohesion: 1 })),
  stats: { ...graph.stats, filesParsed: 8, symbolCount: 8, edgeCount: 8 },
};
for (const edge of filterGraph.edges) {
  filterNodes.find((node) => node.id === edge.source)!.degree++;
  filterNodes.find((node) => node.id === edge.target)!.degree++;
}
const filterReport = '```learn-graph\n' + JSON.stringify({
  communities: filterGraph.communities,
  businessRoutes: [
    { id: 'mixed', label: '跨测试节点路线', ids: ['Entry', 'CombatTestPipelineAbilitySpec', 'Service'] },
    { id: 'test-only', label: '纯测试路线', ids: ['Helper', 'Probe'] },
  ].map((route) => ({ id: route.id, label: route.label, summary: '过滤回归', steps: route.ids.map((id, index) => {
    const node = filterNodes.find((item) => item.id === id)!;
    return { label: node.label, file: node.file, classSymbol: node.label, methodSymbol: 'run', communityId: node.communityId,
      kind: index === 0 ? 'entry' : index === route.ids.length - 1 ? 'result' : 'process',
      description: '步骤', relation: '调用', evidence: `${node.file}:1`, inputs: [], outputs: [], stateChanges: [], failurePaths: [] };
  }) })),
  runtimePath: ['0', '1'],
}) + '\n```\n\n过滤回归讲解。';
let useFilterGraph = false;
let allTestNodes = false;
// Observe actual foreground route submissions, not React state or expected data.
let lastRouteCurves = 0;
const originalClear = CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect = function (...args) {
  if (this.canvas.isConnected) lastRouteCurves = 0;
  return originalClear.apply(this, args);
};
const originalCurve = CanvasRenderingContext2D.prototype.quadraticCurveTo;
CanvasRenderingContext2D.prototype.quadraticCurveTo = function (...args) {
  if (this.canvas.isConnected && Math.abs(this.lineWidth - 3.5) < 0.01) lastRouteCurves++;
  return originalCurve.apply(this, args);
};
const requests: { repoPath: string; model: string; question?: string; mode?: string; drillDepth?: number }[] = [];
let aborted = 0;
let responseMode: 'ok' | 'error' | 'hold' = 'ok';
let sourceRevision = 0;
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  if (url.pathname === '/api/repo/overview') {
    return Response.json({ fileCount: 2, languages: [], topDirs: [], manifests: [], entryCandidates: [] });
  }
  if (url.pathname === '/api/repo/learn-graph') {
    const base = useFilterGraph ? filterGraph : graph;
    const source = { ...base,
      nodes: allTestNodes ? base.nodes.map((node) => ({ ...node, file: `tests/${node.file}` })) : base.nodes,
      communities: allTestNodes ? base.communities.map((community) => ({ ...community, files: community.files.map((file) => `tests/${file}`) })) : base.communities,
      stats: { ...base.stats, sourceFingerprint: `fixture-source-${sourceRevision}` } };
    await new Promise((resolve) => setTimeout(resolve, 40));
    return Response.json(source);
  }
  if (url.pathname === '/api/ai/agent/explain/stream') {
    const body = JSON.parse(String(init?.body));
    requests.push({ repoPath: body.repoPath, model: body.config.model, question: body.userPrompt,
      mode: body.learnRequestMode, drillDepth: body.drillPath?.length });
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
      `data: ${JSON.stringify({ type: 'chunk', text: body.learnRequestMode === 'expand_graph'
        ? expansionReport : body.learnRequestMode === 'drilldown_graph'
          ? body.drillPath.length > 1 ? drilldownLeafReport : drilldownReport
          : body.userPrompt ? '这是测试追问回答。' : useFilterGraph ? filterReport : report })}\n\n`,
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
    const enterQuestion = async (value: string) => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="workbench"] input[type="text"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await delay();
    };
    const selectFirstBusinessNode = async () => {
      const node = document.querySelector<SVGGElement>('[data-testid="workbench"] [data-bus-node="true"]');
      if (!node) throw new Error('找不到业务总线节点');
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await delay();
    };
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
      useFilterGraph = false; allTestNodes = false; preferences.clear();
      setRepoPath('fixture/repo-a'); setHead('head-a'); setRevision(0); setConfig(config); setAskFile(null);
      setMounted(true);
      await until(ready);
      await delay();
      check('首次进入默认业务总线且不调用 AI', requests.length === 0 &&
        button('业务总线')?.getAttribute('aria-pressed') === 'true' && content().includes('尚无 AI 业务总线'));
      await reopen();
      check('无缓存反复进入仍不调用 AI', requests.length === 0 && ready());
      button('开始 AI 分析')!.click();
      await until(() => savedReports === 1 && Boolean(button('重新分析')));
      check('手动开始仅调用一次并保存完整结果', requests.length === 1 && cache.size === 1 &&
        content().includes('这是测试业务路线讲解') && content().includes('源码分析 · 非运行时证明'));
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
      await enterQuestion('补充自动分析遗漏的管理流程');
      button('补图')!.click();
      await until(() => savedReports === 3 && content().includes('已根据手动问题补充业务路线'));
      const busRouteOptions = () => [...document.querySelectorAll<HTMLOptionElement>('select[aria-label="聚焦业务总线路线"] option')];
      check('手动提问以补图模式追加路线并更新缓存', requests.length === 3 && requests[2].mode === 'expand_graph' &&
        busRouteOptions().some((option) => option.value === 'manual-route') && cache.size === 1);
      await reopen();
      check('手动补充路线可从合并缓存恢复且不重复请求', requests.length === 3 &&
        busRouteOptions().some((option) => option.value === 'manual-route'));
      await selectFirstBusinessNode();
      const firstDrillButton = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="workbench"] button')]
        .find((item) => item.textContent?.trim().startsWith('深入：测试业务路线'));
      if (!firstDrillButton) throw new Error('找不到顶层节点深入按钮');
      firstDrillButton.click();
      await until(() => requests.length === 4 && content().includes('递归业务子图 · 第 1 层'));
      check('按具体路线步骤请求第一层业务子图', requests[3].mode === 'drilldown_graph' &&
        requests[3].drillDepth === 1 && content().includes('这是所选节点内部的细化执行路线'));
      await selectFirstBusinessNode();
      const secondDrillButton = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="workbench"] button')]
        .find((item) => item.textContent?.trim().startsWith('深入：节点内部执行'));
      if (!secondDrillButton) throw new Error('找不到子节点深入按钮');
      secondDrillButton.click();
      await until(() => requests.length === 5 && content().includes('递归业务子图 · 第 2 层'));
      check('子节点可继续递归且证据到底时显示空子图', requests[4].mode === 'drilldown_graph' &&
        requests[4].drillDepth === 2 && content().includes('该节点已到源码证据粒度'));
      button('Entry')!.click();
      await until(() => content().includes('递归业务子图 · 第 1 层'));
      button('顶层业务总线')!.click();
      await until(() => !content().includes('递归业务子图 · 第 1 层') && content().includes('测试业务路线'));
      check('面包屑可逐层返回且恢复顶层总线', requests.length === 5);
      await selectFirstBusinessNode();
      [...document.querySelectorAll<HTMLButtonElement>('[data-testid="workbench"] button')]
        .find((item) => item.textContent?.trim().startsWith('深入：测试业务路线'))!.click();
      await until(() => content().includes('递归业务子图 · 第 1 层'));
      check('相同钻取路径从独立缓存立即进入且不再请求模型', requests.length === 5 && savedReports === 5);
      button('顶层业务总线')!.click();
      await until(() => !content().includes('递归业务子图 · 第 1 层'));
      setConfig((previous) => ({ ...previous, learnPrompt: 'fixture new prompt' }));
      await until(ready); await delay();
      check('换提示词不自动分析也不复用旧报告', requests.length === 5 && !content().includes('这是测试业务路线讲解'));
      setConfig((previous) => ({ ...previous, model: 'fixture-model-2' }));
      await delay();
      check('换模型不自动分析', requests.length === 5 && ready());
      sourceRevision++;
      setRevision((previous) => previous + 1);
      await delay(); await until(ready);
      check('源码变化刷新不自动分析', requests.length === 5 && ready());
      setHead('head-b');
      await delay(); await until(ready);
      check('切换提交不自动分析', requests.length === 5 && ready());
      setRepoPath('fixture/repo-b');
      await delay(); await until(ready);
      check('切换仓库不自动分析', requests.length === 5 && ready());
      responseMode = 'error';
      button('开始 AI 分析')!.click();
      await until(() => content().includes('fixture AI failure'));
      await delay();
      check('手动分析失败后不自动重试', requests.length === 6);
      await reopen();
      check('失败后重新进入不自动重试', requests.length === 6 && ready());
      responseMode = 'ok';
      setAskFile('src/Entry.ts');
      await until(() => content().includes('这是测试追问回答'));
      check('主动询问文件仅发出文字追问请求', requests.length === 7 && Boolean(requests[6].question) && requests[6].mode === 'question');
      responseMode = 'hold';
      button('开始 AI 分析')!.click();
      await until(() => requests.length === 8 && Boolean(button('取消分析')));
      setConfig((previous) => ({ ...previous, learnPrompt: 'fixture prompt during stream' }));
      await delay();
      check('进行中修改提示词不另开 AI 请求', requests.length === 8 && Boolean(button('取消分析')));
      button('取消分析')!.click();
      await until(() => aborted === 1 && content().includes('已取消本次 AI 分析'));
      check('用户可取消卡住的分析并恢复操作', aborted === 1 && !button('取消分析'));
      (button('重新分析') || button('开始 AI 分析'))!.click();
      await until(() => requests.length === 9 && Boolean(button('取消分析')));
      setMounted(false);
      await until(() => aborted === 2);
      check('离开页面取消未完成请求', aborted === 2);
      responseMode = 'ok';
      setMounted(true);
      await until(ready); await delay();
      check('中断后重新进入不自动续跑', requests.length === 9 && ready());
      setResult(JSON.stringify({ passed: checks.length, requests: requests.length, aborted, checks }, null, 2));
    } catch (error) {
      setResult(JSON.stringify({ passed: checks.length, failed: String(error), requests, checks }, null, 2));
    } finally {
      setRunning(false);
    }
  };
  const runFilter = async () => {
    const checks: string[] = [];
    const workbench = () => document.querySelector('[data-testid="workbench"]')!;
    const content = () => workbench().textContent || '';
    const button = (name: string) => [...workbench().querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.getAttribute('aria-label') === name || item.textContent?.trim() === name);
    const routeSelect = () => workbench().querySelector<HTMLSelectElement>('select[aria-label="聚焦业务路线"]')!;
    const option = (value: string) => [...routeSelect().options].find((item) => item.value === value)!;
    const busRouteSelect = () => workbench().querySelector<HTMLSelectElement>('select[aria-label="聚焦业务总线路线"]')!;
    const busOption = (value: string) => [...busRouteSelect().options].find((item) => item.value === value)!;
    const delay = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (condition: () => boolean) => {
      const deadline = performance.now() + 5000;
      while (!condition()) {
        if (performance.now() > deadline) throw new Error('等待过滤界面超时');
        await delay(20);
      }
      await delay();
    };
    const check = (name: string, condition: boolean) => {
      if (!condition) throw new Error(name);
      checks.push(name);
    };
    const toggle = async () => { button('隐藏测试节点')!.click(); await delay(); };
    const ready = () => Boolean(button('开始 AI 分析') && !button('开始 AI 分析')!.disabled);
    setRunning(true); setResult('正在验证测试节点过滤，所有数据与 AI 均为模拟');
    try {
      setMounted(false); await delay();
      cache.clear(); preferences.clear(); savedReports = 0; requests.length = 0;
      useFilterGraph = true; allTestNodes = false; sourceRevision = 0; responseMode = 'ok';
      setRepoPath('fixture/filter'); setHead('head-a'); setRevision(0); setConfig(config); setAskFile(null);
      setMounted(true); await until(ready);
      check('默认隐藏测试节点且不调用 AI', button('隐藏测试节点')?.getAttribute('aria-pressed') === 'true' && requests.length === 0);
      check('默认页签是业务总线空状态', button('业务总线')?.getAttribute('aria-pressed') === 'true' && content().includes('尚无 AI 业务总线'));
      button('代码结构')!.click(); await delay();
      button('丰富')!.click(); await delay();
      check('丰富视图只剩 5 个业务类和 4 条边', content().includes('丰富 · 5 类级节点 · 4 边'));
      check('纯测试社区被隐藏', ![...workbench().querySelectorAll('button')].some((item) => item.textContent?.includes('仅测试社区')));
      button('业务社区5')!.click(); await delay();
      check('社区详情保留 Spec/Latest/Contest，不含测试类', ['AbilitySpec.cs', 'LatestSnapshot.cs', 'ContestReward.cs'].every((name) => content().includes(name)) && !content().includes('CombatTestPipelineAbilitySpec.cs'));
      await toggle();
      check('关闭过滤恢复全部节点和连线', content().includes('丰富 · 8 类级节点 · 8 边') && content().includes('仅测试社区'));
      setMounted(false); await delay(); setMounted(true); await until(ready);
      check('重新进入记住关闭状态且不调用 AI', button('隐藏测试节点')?.getAttribute('aria-pressed') === 'false' && requests.length === 0);
      button('代码结构')!.click(); await delay();
      await toggle();
      button('简化')!.click(); await delay();
      check('简化模式同样过滤测试节点', content().includes('/5 类级节点') && content().includes('已隐藏 3 个测试节点'));
      button('开始 AI 分析')!.click(); await until(() => savedReports === 1 && Boolean(button('重新分析')));
      check('过滤不会影响完整报告解析与缓存', requests.length === 1 && cache.size === 1 && content().includes('过滤回归讲解'));
      check('路线正确标注隐藏步骤而非映射失败', option('mixed').text.includes('2/3') && option('test-only').disabled && option('test-only').text.includes('测试步骤已隐藏'));
      button('业务总线')!.click(); await delay();
      check('业务总线同样保留隐藏步骤缺口', busOption('mixed').text.includes('2/3') && busOption('test-only').disabled &&
        content().includes('2 个业务节点 · 0 条有向边'));
      button('代码结构')!.click(); await delay();
      button('丰富')!.click();
      routeSelect().value = 'mixed'; routeSelect().dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => !content().includes('正在后台整理社区布局'));
      check('隐藏中间步骤不画虚假直连', content().includes('2/3 步可见') && lastRouteCurves === 0);
      await toggle(); await until(() => lastRouteCurves === 2);
      check('恢复测试节点后原路线两段连线恢复', option('mixed').text.includes('3/3') && !option('test-only').disabled && lastRouteCurves === 2);
      button('业务总线')!.click(); await delay();
      check('恢复后业务总线原始相邻边也恢复', busOption('mixed').text.includes('3/3') && content().includes('5 个业务节点 · 3 条有向边'));
      button('代码结构')!.click(); await delay();
      await toggle();
      check('反复切换不请求 AI 或改写 AI 缓存', requests.length === 1 && savedReports === 1);
      allTestNodes = true; sourceRevision++; setRevision((previous) => previous + 1);
      await until(() => content().includes('所有节点都已按测试规则隐藏'));
      check('全隐藏时开关仍可用且不调用 AI', Boolean(button('隐藏测试节点')) && requests.length === 1);
      await toggle();
      button('丰富')!.click(); await delay();
      check('空图能关闭过滤恢复所有节点', content().includes('丰富 · 8 类级节点 · 8 边') && !content().includes('所有节点都已按测试规则隐藏'));
      // Leave the normal mixed graph available for manual pointer/selection checks.
      allTestNodes = false; sourceRevision++; setRevision((previous) => previous + 1);
      await until(ready);
      setResult(JSON.stringify({ passed: checks.length, requests: requests.length, checks }, null, 2));
    } catch (error) {
      setResult(JSON.stringify({ passed: checks.length, failed: String(error), requests, checks }, null, 2));
    } finally {
      setRunning(false);
    }
  };
  return <main className="flex h-screen flex-col bg-[#12131a] text-slate-200">
    <header className="flex gap-4 p-3">
      <button disabled={running} onClick={run}>验证手动分析</button>
      <button disabled={running} onClick={runFilter}>验证测试节点过滤</button>
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
