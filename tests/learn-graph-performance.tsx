// Isolated fixture: real graph component, generated data, no backend or AI requests.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LearnGraphCanvas } from '../src/components/Learn/LearnGraphCanvas';
import type { LearnGraph, LearnNode } from '../src/types';
import '../src/index.css';

const counters = { draws: 0, curves: 0, textMeasures: 0, callbacks: 0, callbackMs: 0 };
const lastPaint = { curves: 0, originX: 0, originY: 0, firstNode: [] as number[] };
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
  counters.draws++;
  lastPaint.curves = 0;
  lastPaint.firstNode = [];
  if (densityStart && densityStart.firstPaintMs === null) {
    densityStart.firstPaintMs = Math.round((performance.now() - densityStart.start) * 10) / 10;
  }
  return clearRect.apply(this, args);
};
const arc = context.arc;
context.arc = function (...args) {
  if (!lastPaint.firstNode.length) lastPaint.firstNode = args.slice(0, 3) as number[];
  return arc.apply(this, args);
};
const translate = context.translate;
context.translate = function (x, y) {
  lastPaint.originX = x;
  lastPaint.originY = y;
  return translate.call(this, x, y);
};
const quadraticCurveTo = context.quadraticCurveTo;
context.quadraticCurveTo = function (...args) {
  counters.curves++;
  lastPaint.curves++;
  return quadraticCurveTo.apply(this, args);
};
const measureText = context.measureText;
context.measureText = function (...args) {
  counters.textMeasures++;
  return measureText.apply(this, args);
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
    <p data-testid="counters">{JSON.stringify({ draws: counters.draws, lastPaint })}</p>
    <pre data-testid="density-measurements">{JSON.stringify(densityMeasurements)}</pre>
    <div style={{ display: hidden ? 'none' : 'block', height: small ? '330px' : '680px' }}>
      {mounted && <LearnGraphCanvas key={revision} graph={graph} selectedNodeId={selected}
        selectedCommunityId={community} onSelectNode={setSelected} onSelectCommunity={setCommunity} />}
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
