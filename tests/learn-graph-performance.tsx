// Isolated fixture: real graph component, generated data, no backend or AI requests.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LearnGraphCanvas } from '../src/components/Learn/LearnGraphCanvas';
import type { LearnGraph, LearnNode } from '../src/types';
import '../src/index.css';

const counters = { draws: 0, curves: 0, textMeasures: 0, callbacks: 0, callbackMs: 0, bitmapBlits: 0, backgroundDraws: 0 };
const workers = { started: 0, completed: 0, active: 0, errors: 0 };
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  private running = true;
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    workers.started++;
    workers.active++;
    this.addEventListener('message', () => { workers.completed++; });
    this.addEventListener('error', () => { workers.errors++; });
  }
  terminate() {
    if (this.running) { this.running = false; workers.active--; }
    super.terminate();
  }
};
const lastPaint = { curves: 0, originX: 0, originY: 0, firstNode: [] as number[] };
let paintedNodes: number[][] = [];
let focusedCurves: string[] = [];
const densityMeasurements: { mode: string; alreadyActive: boolean; draws: number; firstPaintMs: number | null; firstNode: number[] }[] = [];
let densityStart: { start: number; firstPaintMs: number | null } | null = null;
document.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  const mode = button?.textContent?.trim();
  if (mode !== '简化' && mode !== '丰富') return;
  const alreadyActive = button!.getAttribute('aria-pressed') === 'true';
  const measurement = { start: performance.now(), firstPaintMs: null as number | null };
  densityStart = measurement;
  const before = counters.draws;
  setTimeout(() => {
    densityMeasurements.push({ mode, alreadyActive, draws: counters.draws - before,
      firstPaintMs: measurement.firstPaintMs, firstNode: [...lastPaint.firstNode] });
    if (densityStart === measurement) densityStart = null;
  }, 1200);
}, true);
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback) => nativeRaf((time) => {
  const start = performance.now();
  callback(time);
  counters.callbacks++;
  counters.callbackMs += performance.now() - start;
});
const context = CanvasRenderingContext2D.prototype;
const clearRect = context.clearRect;
context.clearRect = function (...args) {
  if (!this.canvas.isConnected) {
    counters.backgroundDraws++;
    return clearRect.apply(this, args);
  }
  counters.draws++;
  lastPaint.curves = 0;
  lastPaint.firstNode = [];
  paintedNodes = [];
  focusedCurves = [];
  if (densityStart && densityStart.firstPaintMs === null) {
    densityStart.firstPaintMs = Math.round((performance.now() - densityStart.start) * 10) / 10;
  }
  return clearRect.apply(this, args);
};
const arc = context.arc;
context.arc = function (...args) {
  if (this.canvas.isConnected) {
    if (!lastPaint.firstNode.length) lastPaint.firstNode = args.slice(0, 3) as number[];
    paintedNodes.push([args[0] + lastPaint.originX, args[1] + lastPaint.originY]);
  }
  return arc.apply(this, args);
};
const translate = context.translate;
context.translate = function (x, y) {
  if (this.canvas.isConnected) {
    lastPaint.originX = x;
    lastPaint.originY = y;
  }
  return translate.call(this, x, y);
};
const quadraticCurveTo = context.quadraticCurveTo;
context.quadraticCurveTo = function (...args) {
  counters.curves++;
  if (this.canvas.isConnected) {
    lastPaint.curves++;
    if (Math.abs(this.lineWidth - 2.4) < 0.01) focusedCurves.push(`${this.strokeStyle}:${this.getLineDash()}:${args}`);
  }
  return quadraticCurveTo.apply(this, args);
};
const measureText = context.measureText;
context.measureText = function (...args) {
  counters.textMeasures++;
  return measureText.apply(this, args);
};
const drawImage = context.drawImage;
context.drawImage = function (image: CanvasImageSource, ...args: number[]) {
  counters.bitmapBlits++;
  return Reflect.apply(drawImage, this, [image, ...args]);
};

function makeGraph(): LearnGraph {
  const nodes: LearnNode[] = Array.from({ length: 2400 }, (_, index) => ({
    id: `src/Example.Game.Backend/Business/Community${Math.floor(index / 100)}/Services/BusinessService${index}.cs:class:BusinessService${index}`,
    label: `BusinessService${index}`,
    kind: 'class',
    file: `src/BusinessService${index}.cs`,
    communityId: String(Math.floor(index / 100)),
    degree: 0,
  }));
  const edges: LearnGraph['edges'] = [];
  for (let index = 0; index < nodes.length; index++) {
    for (let offset = 1; offset <= 6; offset++) {
      const target = offset <= 4
        ? Math.floor(index / 100) * 100 + (index + offset * 7) % 100
        : (index + offset * 101) % nodes.length;
      edges.push({
        source: nodes[index].id, target: nodes[target].id,
        relation: offset <= 3 ? 'calls' : offset === 4 ? 'inherits' : offset === 5 ? 'imports' : 'references',
      });
      nodes[index].degree++;
      nodes[target].degree++;
    }
  }
  return {
    nodes, edges,
    communities: Array.from({ length: 24 }, (_, index) => ({
      id: String(index), label: `业务社区${index}`, summary: '', files: [],
      godNodes: nodes.slice(index * 100, index * 100 + 4).map((node) => node.label),
      cohesion: 0.8, nodeCount: 100,
    })),
    businessRoutes: [{
      id: 'fixture-route', label: '测试业务路线', summary: '跨社区类级路线',
      steps: [0, 7, 100, 200].map((index) => ({
        label: nodes[index].label, file: nodes[index].file!, classSymbol: nodes[index].label,
        nodeId: nodes[index].id, description: '测试步骤', relation: '调用', evidence: 'fixture',
      })),
    }],
    runtimePath: [], godNodes: [], bridges: [],
    stats: { filesParsed: 2400, symbolCount: 2400, edgeCount: edges.length, truncated: false, sourceFingerprint: 'fixture' },
  };
}
const initialGraph = makeGraph();

function Fixture() {
  const [graph, setGraph] = useState(initialGraph);
  const [selected, setSelected] = useState<string | null>(null);
  const [community, setCommunity] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [small, setSmall] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  const [sample, setSample] = useState('尚未采样');
  const [interaction, setInteraction] = useState('尚未验证拖动');
  const [continuous, setContinuous] = useState('尚未连续采样');
  const [pinning, setPinning] = useState('尚未验证固定路线');
  const [sampling, setSampling] = useState(false);
  const [parentTicks, setParentTicks] = useState(0);
  // The real workbench also updates elapsed time while analysis streams.
  useEffect(() => {
    const timer = setInterval(() => setParentTicks((value) => value + 1), 500);
    return () => clearInterval(timer);
  }, []);
  const sampleTwoSeconds = () => {
    const before = { ...counters };
    const start = performance.now();
    setSample('正在采样');
    setTimeout(() => {
      const elapsed = performance.now() - start;
      const delta = Object.fromEntries(Object.entries(counters).map(([key, value]) => [key, value - before[key as keyof typeof before]]));
      setSample(JSON.stringify({
        ...delta, elapsedMs: Math.round(elapsed),
        callbackMs: Math.round(delta.callbackMs * 10) / 10,
        averageCallbackMs: Math.round(delta.callbackMs / Math.max(1, delta.callbacks) * 10) / 10,
      }));
    }, 2000);
  };
  const middleDrag = (distance: number) => {
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const before = { ...counters, ...lastPaint };
    const selectedBefore = document.querySelector('[data-testid="selection"]')!.textContent!.split('；')[0];
    // Synthetic pointers aren't registered with native pointer capture. Test React's
    // real event handlers without changing capture behavior in the production component.
    const capture = canvas.setPointerCapture;
    canvas.setPointerCapture = () => {};
    const pointer = (type: string, x: number) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 777, pointerType: 'mouse', button: 1, buttons: 4,
      clientX: rect.left + 200 + x, clientY: rect.top + 250,
    }));
    try {
      pointer('pointerdown', 0);
      for (let i = 1; i <= 100; i++) pointer('pointermove', distance * i / 100);
      pointer('pointerup', distance);
    } finally {
      canvas.setPointerCapture = capture;
    }
    setTimeout(() => {
      const unchanged = document.querySelector('[data-testid="selection"]')!.textContent!.split('；')[0] === selectedBefore;
      setInteraction(JSON.stringify({
        selectionUnchanged: unchanged, draws: counters.draws - before.draws,
        panPixels: Math.round(lastPaint.originX - before.originX),
        lastFrameCurves: lastPaint.curves,
        textMeasures: counters.textMeasures - before.textMeasures,
        callbackMs: Math.round((counters.callbackMs - before.callbackMs) * 10) / 10,
      }));
    }, 500);
  };
  const continuousInteraction = (kind: 'pan' | 'zoom' | 'hover') => {
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const targets = paintedNodes.filter(([x, y]) => x > 0 && x < rect.width && y > 110 && y < rect.height - 30);
    const before = { ...counters };
    const selectedBefore = document.querySelector('[data-testid="selection"]')!.textContent!.split('；')[0];
    const detailsBefore = document.querySelector('[aria-label="节点连接详情"]')?.textContent;
    let detailsUnchanged = true;
    const intervals: number[] = [];
    const capture = canvas.setPointerCapture;
    canvas.setPointerCapture = () => {};
    const pointer = (type: string, x: number, y = 250) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 777, pointerType: 'mouse', button: 1, buttons: kind === 'pan' ? 4 : 0,
      clientX: rect.left + x, clientY: rect.top + y,
    }));
    setSampling(true);
    setContinuous('连续采样中');
    if (kind === 'pan') pointer('pointerdown', 200);
    let frame = 0;
    let previous = performance.now();
    const start = previous;
    const advance = () => {
      detailsUnchanged &&= document.querySelector('[aria-label="节点连接详情"]')?.textContent === detailsBefore;
      const now = performance.now();
      intervals.push(now - previous);
      previous = now;
      if (frame++ < 40) {
        if (kind === 'pan') pointer('pointermove', 200 + Math.sin(frame / 40 * Math.PI * 2) * 80);
        if (kind === 'zoom') canvas.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, deltaY: frame % 10 < 5 ? -100 : 100,
          clientX: rect.left + 200, clientY: rect.top + 250,
        }));
        if (kind === 'hover' && targets.length) {
          const [x, y] = targets[(frame * 3) % targets.length];
          pointer('pointermove', x, y);
        }
        nativeRaf(advance);
        return;
      }
      if (kind === 'pan') pointer('pointerup', 200);
      canvas.setPointerCapture = capture;
      intervals.sort((a, b) => a - b);
      setContinuous(JSON.stringify({
        kind, frames: intervals.length, elapsedMs: Math.round(now - start),
        medianFrameMs: +intervals[Math.floor(intervals.length / 2)].toFixed(1),
        p95FrameMs: +intervals[Math.floor(intervals.length * 0.95)].toFixed(1),
        maxFrameMs: +intervals[intervals.length - 1].toFixed(1),
        draws: counters.draws - before.draws, curves: counters.curves - before.curves,
        bitmapBlits: counters.bitmapBlits - before.bitmapBlits,
        callbackMs: +(counters.callbackMs - before.callbackMs).toFixed(1),
        selectionUnchanged: document.querySelector('[data-testid="selection"]')!.textContent!.split('；')[0] === selectedBefore,
        detailsUnchanged,
      }));
      setSampling(false);
    };
    nativeRaf(advance);
  };
  const verifyPinning = async () => {
    const canvas = document.querySelector('canvas');
    const button = (name: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === name);
    if (!canvas || button('丰富')?.getAttribute('aria-pressed') !== 'true' || workers.active) {
      setPinning('请先切换丰富，并等待布局完成');
      return;
    }
    const capture = canvas.setPointerCapture;
    canvas.setPointerCapture = () => {};
    const painted = () => new Promise<void>((resolve) => nativeRaf(() => nativeRaf(() => resolve())));
    const selection = () => document.querySelector('[data-testid="selection"]')!.textContent!.split('；')[0];
    const details = () => document.querySelector('[aria-label="节点连接详情"]')?.textContent || '';
    const curves = () => JSON.stringify(focusedCurves);
    const point = (last = false) => {
      const rect = canvas.getBoundingClientRect();
      const candidates = paintedNodes.filter(([x, y]) => x > 20 && x < rect.width - 20 && y > 140 && y < rect.height - 40);
      if (!candidates.length) throw new Error('没有可点击的可见节点');
      return candidates[last ? candidates.length - 1 : 0];
    };
    const pointer = (type: string, [x, y]: number[], button = 0) => {
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 778, pointerType: 'mouse',
        button, buttons: type === 'pointerup' ? 0 : button === 1 ? 4 : 1,
        clientX: rect.left + x, clientY: rect.top + y }));
    };
    const passed: string[] = [];
    const check = (name: string, condition: boolean) => {
      if (!condition) throw new Error(name);
      passed.push(name);
    };
    setSampling(true);
    setPinning('正在验证固定路线');
    try {
      button('取消固定')?.click();
      button('适应视图')!.click();
      await painted();
      pointer('pointermove', point());
      await painted();
      check('未固定时悬停预览', Boolean(details()) && selection() === '选中：无');
      const first = point();
      pointer('pointerdown', first);
      await painted();
      check('按下尚未改变选择', selection() === '选中：无');
      pointer('pointerup', first);
      await painted();
      const pinnedSelection = selection(), pinnedDetails = details(), pinnedCurves = curves();
      check('单击固定实际路线', pinnedSelection !== '选中：无' && Boolean(pinnedDetails) && focusedCurves.length > 0 && Boolean(button('取消固定')));
      pointer('pointermove', point(true));
      await painted();
      check('悬停不替换详情或高亮曲线', selection() === pinnedSelection && details() === pinnedDetails && curves() === pinnedCurves);
      pointer('pointerout', point(true));
      await painted();
      check('移出画布仍固定', details() === pinnedDetails && curves() === pinnedCurves);
      for (const cancel of ['pointercancel', 'lostpointercapture']) {
        const target = point(true);
        pointer('pointerdown', target);
        pointer(cancel, target);
        pointer('pointerup', target);
        await painted();
        check(`${cancel}不误选节点`, selection() === pinnedSelection && details() === pinnedDetails);
      }
      for (const [name, fromNode, mouseButton, distance] of [
        ['空白单击', false, 0, 0],
        ['空白左键拖动', false, 0, 60],
        ['从其他节点左键拖动', true, 0, 40],
        ['从其他节点中键拖动', true, 1, 40],
        ['中键单击', true, 1, 0],
      ] as const) {
        const start = fromNode ? point(true) : [5, 5];
        const origin = lastPaint.originX;
        pointer('pointerdown', [...start], mouseButton);
        if (distance) pointer('pointermove', [start[0] + distance, start[1]], mouseButton);
        pointer('pointerup', [start[0] + distance, start[1]], mouseButton);
        await painted();
        check(`${name}保持路线`, selection() === pinnedSelection && details() === pinnedDetails && curves() === pinnedCurves);
        check(`${name}位移正确`, Math.abs(lastPaint.originX - origin - distance) < 0.01);
      }
      const backtrack = point(true);
      pointer('pointerdown', backtrack);
      pointer('pointermove', [backtrack[0] + 40, backtrack[1]]);
      pointer('pointermove', backtrack);
      pointer('pointerup', backtrack);
      await painted();
      check('拖回原位仍不是单击', selection() === pinnedSelection && details() === pinnedDetails && curves() === pinnedCurves);
      canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
      await painted();
      check('缩放保持路线并重画', selection() === pinnedSelection && details() === pinnedDetails && curves() !== pinnedCurves && focusedCurves.length > 0);
      button('适应视图')!.click();
      await painted();
      check('适应视图恢复相同曲线', details() === pinnedDetails && curves() === pinnedCurves);
      const other = point(true);
      pointer('pointerdown', other);
      pointer('pointermove', [other[0] + 1, other[1]]);
      pointer('pointerup', [other[0] + 1, other[1]]);
      await painted();
      check('轻微抖动的单击可切换节点', selection() !== pinnedSelection && selection() !== '选中：无' && details() !== pinnedDetails && curves() !== pinnedCurves);
      button('取消固定')!.click();
      await painted();
      check('主动取消清除详情与高亮', selection() === '选中：无' && !details() && focusedCurves.length === 0 && !button('取消固定'));
      pointer('pointermove', point());
      await painted();
      check('取消后恢复悬停预览', Boolean(details()) && selection() === '选中：无' && focusedCurves.length > 0);
      setPinning(JSON.stringify({ passed: passed.length, checks: passed }));
    } catch (error) {
      setPinning(JSON.stringify({ passed: passed.length, failed: error instanceof Error ? error.message : String(error),
        selection: selection(), details: details(), highlightedCurves: focusedCurves.length, checks: passed }));
    } finally {
      canvas.setPointerCapture = capture;
      setSampling(false);
    }
  };
  return <main style={{ background: '#12131a', color: 'white', height: '100vh' }}>
    <header style={{ padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <button onClick={sampleTwoSeconds}>采样 2 秒</button>
      <button onClick={() => setHidden(!hidden)}>{hidden ? '展开面板' : '关闭面板'}</button>
      <button onClick={() => setSmall(!small)}>调整面板大小</button>
      <button onClick={() => setSelected(graph.nodes[0].id)}>选中首个类</button>
      <button onClick={() => setSelected(null)}>清除选择</button>
      <button onClick={() => setRevision(revision + 1)}>重新布局</button>
      <button onClick={() => setMounted(!mounted)}>{mounted ? '卸载画布' : '挂载画布'}</button>
      <button onClick={() => middleDrag(100)}>批量中键拖动</button>
      <button onClick={() => middleDrag(100000)}>拖到视口外</button>
      <button disabled={sampling} onClick={() => continuousInteraction('pan')}>连续拖动采样</button>
      <button disabled={sampling} onClick={() => continuousInteraction('zoom')}>连续缩放采样</button>
      <button disabled={sampling} onClick={() => continuousInteraction('hover')}>连续悬停采样</button>
      <button disabled={sampling} onClick={verifyPinning}>固定路线回归</button>
      <button onClick={() => {
        const hubEdges = initialGraph.nodes.slice(300, 540).map((node) => ({
          source: initialGraph.nodes[0].id, target: node.id, relation: 'calls' as const,
        }));
        setGraph({ ...initialGraph,
          nodes: initialGraph.nodes.map((node, index) => ({ ...node,
            degree: node.degree + (index === 0 ? hubEdges.length : index >= 300 && index < 540 ? 1 : 0),
          })),
          edges: [...initialGraph.edges, ...hubEdges],
          stats: { ...initialGraph.stats, edgeCount: initialGraph.edges.length + hubEdges.length, sourceFingerprint: 'hub-fixture' },
        });
        setSelected(initialGraph.nodes[0].id);
        setCommunity('0');
      }}>聚焦高连接枢纽</button>
      <button onClick={() => setGraph((previous) => ({
        ...previous,
        nodes: previous.nodes.map((node, index) => index === 0
          ? { ...node, label: 'UpdatedService0', degree: 42, communityId: '23' } : node),
        stats: { ...previous.stats, sourceFingerprint: 'updated-fixture' },
      }))}>更新图数据</button>
    </header>
    <p data-testid="selection">选中：{selected || '无'}；父组件更新：{parentTicks}</p>
    <pre data-testid="sample">{sample}</pre>
    <pre data-testid="interaction">{interaction}</pre>
    <pre data-testid="continuous">{continuous}</pre>
    <pre data-testid="pinning" style={{ whiteSpace: 'pre-wrap' }}>{pinning}</pre>
    <p data-testid="counters">{JSON.stringify({ ...counters, lastPaint })}</p>
    <pre data-testid="density-measurements">{JSON.stringify(densityMeasurements)}</pre>
    <pre data-testid="workers">{JSON.stringify(workers)}</pre>
    <div style={{ display: hidden ? 'none' : 'block', height: small ? '330px' : '680px' }}>
      {mounted && <LearnGraphCanvas key={revision} graph={graph} selectedNodeId={selected}
        selectedCommunityId={community} onSelectNode={setSelected} onSelectCommunity={setCommunity} />}
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
