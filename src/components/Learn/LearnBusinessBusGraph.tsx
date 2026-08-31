import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { LearnBusinessStepKind } from '../../types';
import {
  BUSINESS_BUS_NODE_HEIGHT,
  BUSINESS_BUS_NODE_WIDTH,
  layoutLearnBusinessBus,
  truncateBusinessBusText,
  type LearnBusinessBus,
  type LearnBusinessBusOccurrence,
  type PositionedLearnBusinessBusNode,
} from '../../utils/learnBusinessBus';

interface LearnBusinessBusGraphProps {
  bus: LearnBusinessBus;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onDrillNode?: (occurrence: LearnBusinessBusOccurrence) => void;
  hideTestNodes: boolean;
  testNodeCount: number;
  onHideTestNodesChange: (hide: boolean) => void;
  emptyLabel?: string;
}

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

const KIND_META: Record<LearnBusinessStepKind, { label: string; fill: string; stroke: string }> = {
  entry: { label: '入口', fill: '#123047', stroke: '#38bdf8' },
  process: { label: '处理', fill: '#25244a', stroke: '#a78bfa' },
  decision: { label: '判断', fill: '#4a3213', stroke: '#fbbf24' },
  state: { label: '状态', fill: '#14392f', stroke: '#34d399' },
  external: { label: '外部边界', fill: '#44213b', stroke: '#f472b6' },
  result: { label: '结果', fill: '#183b28', stroke: '#4ade80' },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const NODE_TEXT_WIDTH = BUSINESS_BUS_NODE_WIDTH - 28;
const ROUTE_LABEL_WIDTH = 108;
const EDGE_LABEL_WIDTH = 68;

function edgePath(
  source: PositionedLearnBusinessBusNode,
  target: PositionedLearnBusinessBusNode
): { d: string; labelX: number; labelY: number; back: boolean } {
  const sx = source.x + BUSINESS_BUS_NODE_WIDTH;
  const sy = source.y + BUSINESS_BUS_NODE_HEIGHT / 2;
  const tx = target.x;
  const ty = target.y + BUSINESS_BUS_NODE_HEIGHT / 2;
  const back = tx <= sx;
  if (back) {
    const lift = Math.max(72, Math.abs(ty - sy) * 0.35 + 48);
    return {
      d: `M ${sx} ${sy} C ${sx + 76} ${sy - lift}, ${tx - 76} ${ty - lift}, ${tx} ${ty}`,
      labelX: (sx + tx) / 2,
      labelY: Math.min(sy, ty) - lift * 0.72,
      back,
    };
  }
  const mid = (sx + tx) / 2;
  return {
    d: `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`,
    labelX: mid,
    labelY: (sy + ty) / 2 - 7,
    back,
  };
}

function NodeShape({ node, selected }: { node: PositionedLearnBusinessBusNode; selected: boolean }) {
  const meta = KIND_META[node.kind];
  const common = {
    fill: meta.fill,
    stroke: selected ? '#f8fafc' : meta.stroke,
    strokeWidth: selected ? 3 : 1.6,
  };
  if (node.kind === 'decision') {
    return <polygon {...common} points={`${node.x + 14},${node.y} ${node.x + BUSINESS_BUS_NODE_WIDTH - 14},${node.y} ${node.x + BUSINESS_BUS_NODE_WIDTH},${node.y + BUSINESS_BUS_NODE_HEIGHT / 2} ${node.x + BUSINESS_BUS_NODE_WIDTH - 14},${node.y + BUSINESS_BUS_NODE_HEIGHT} ${node.x + 14},${node.y + BUSINESS_BUS_NODE_HEIGHT} ${node.x},${node.y + BUSINESS_BUS_NODE_HEIGHT / 2}`} />;
  }
  return (
    <>
      <rect
        {...common}
        x={node.x}
        y={node.y}
        width={BUSINESS_BUS_NODE_WIDTH}
        height={BUSINESS_BUS_NODE_HEIGHT}
        rx={node.kind === 'entry' || node.kind === 'result' ? 28 : node.kind === 'state' ? 4 : 10}
        strokeDasharray={node.kind === 'external' ? '7 4' : undefined}
      />
      {node.kind === 'state' && (
        <rect x={node.x + 5} y={node.y + 5} width={BUSINESS_BUS_NODE_WIDTH - 10}
          height={BUSINESS_BUS_NODE_HEIGHT - 10} rx={2} fill="none" stroke={meta.stroke} strokeOpacity={0.45} />
      )}
    </>
  );
}

export const LearnBusinessBusGraph: React.FC<LearnBusinessBusGraphProps> = ({
  bus,
  selectedNodeId,
  onSelectNode,
  onDrillNode,
  hideTestNodes,
  testNodeCount,
  onHideTestNodesChange,
  emptyLabel,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const markerId = useId().replace(/:/g, '');
  const layout = useMemo(() => layoutLearnBusinessBus(bus), [bus]);
  const positionedById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const [activeRouteId, setActiveRouteId] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: ViewTransform;
  } | null>(null);
  const suppressCanvasClickRef = useRef(false);

  const activeRoute = bus.routes.find((route) => route.id === activeRouteId) || null;
  const activeNodeIds = useMemo(
    () => new Set(activeRoute?.nodeIds.filter((id): id is string => Boolean(id)) || []),
    [activeRoute]
  );

  useEffect(() => {
    if (activeRouteId && !bus.routes.some((route) => route.id === activeRouteId && route.visibleStepCount > 0)) {
      setActiveRouteId('');
    }
    if (selectedNodeId && !bus.nodes.some((node) => node.id === selectedNodeId)) onSelectNode(null);
  }, [activeRouteId, bus.nodes, bus.routes, onSelectNode, selectedNodeId]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitView = useCallback(() => {
    if (!size.width || !size.height || !layout.width || !layout.height) return;
    const k = clamp(Math.min((size.width - 24) / layout.width, (size.height - 24) / layout.height), 0.18, 1.2);
    setView({
      k,
      x: (size.width - layout.width * k) / 2,
      y: (size.height - layout.height * k) / 2,
    });
  }, [layout.height, layout.width, size.height, size.width]);

  useEffect(() => {
    fitView();
  }, [fitView]);

  const setRoute = (routeId: string) => {
    setActiveRouteId(routeId);
    if (routeId && selectedNodeId) {
      const route = bus.routes.find((item) => item.id === routeId);
      if (!route?.nodeIds.includes(selectedNodeId)) onSelectNode(null);
    }
  };

  const drillOccurrence = (node: PositionedLearnBusinessBusNode) => {
    if (!onDrillNode) return;
    const occurrence = activeRouteId
      ? node.occurrences.find((item) => item.routeId === activeRouteId)
      : node.occurrences.length === 1 ? node.occurrences[0] : undefined;
    if (occurrence) onDrillNode(occurrence);
  };

  return (
    <div ref={wrapRef} className="relative h-full min-h-0 overflow-hidden bg-[#11131A]">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        role="img"
        aria-label="AI 源码分析业务总线节点图"
        onClick={() => {
          if (suppressCanvasClickRef.current) {
            suppressCanvasClickRef.current = false;
            return;
          }
          onSelectNode(null);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          const target = event.target as Element;
          if (event.button === 0 && target.closest('[data-bus-node="true"]')) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            origin: view,
          };
          suppressCanvasClickRef.current = false;
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) {
            suppressCanvasClickRef.current = true;
          }
          setView({
            ...drag.origin,
            x: drag.origin.x + event.clientX - drag.startX,
            y: drag.origin.y + event.clientY - drag.startY,
          });
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        }}
        onPointerCancel={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const px = event.clientX - rect.left;
          const py = event.clientY - rect.top;
          const nextK = clamp(view.k * Math.exp(-event.deltaY * 0.0012), 0.18, 2.5);
          setView({
            k: nextK,
            x: px - ((px - view.x) / view.k) * nextK,
            y: py - ((py - view.y) / view.k) * nextK,
          });
        }}
      >
        <defs>
          <marker id={`${markerId}-edge`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
          </marker>
          <marker id={`${markerId}-active`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#34d399" />
          </marker>
          <clipPath id={`${markerId}-route-labels`}>
            <rect x={16} y={0} width={ROUTE_LABEL_WIDTH} height={layout.height} />
          </clipPath>
          {layout.nodes.map((node, index) => (
            <clipPath key={node.id} id={`${markerId}-node-text-${index}`}>
              <rect x={node.x + 12} y={node.y + 8}
                width={BUSINESS_BUS_NODE_WIDTH - 24} height={BUSINESS_BUS_NODE_HEIGHT - 16} />
            </clipPath>
          ))}
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {bus.routes.map((route, index) => {
            const active = !activeRouteId || activeRouteId === route.id;
            const y = layout.laneY[index] || 0;
            return (
              <g key={route.id} opacity={active ? 1 : 0.2}>
                <line x1={132} y1={y} x2={layout.width - 16} y2={y} stroke="#293241" strokeWidth={1} strokeDasharray="4 8" />
                <text data-bus-route-label="true" x={16} y={y - 7} fill="#cbd5e1" fontSize={12} fontWeight={500}
                  clipPath={`url(#${markerId}-route-labels)`}>
                  <title>{route.label}</title>
                  {truncateBusinessBusText(route.label, ROUTE_LABEL_WIDTH, 12)}
                </text>
                <text x={16} y={y + 12} fill="#64748b" fontSize={10}>{route.visibleStepCount}/{route.totalStepCount} 步</text>
              </g>
            );
          })}

          {bus.edges.map((edge) => {
            const source = positionedById.get(edge.source);
            const target = positionedById.get(edge.target);
            if (!source || !target) return null;
            const geometry = edgePath(source, target);
            const active = !activeRouteId || edge.routeIds.includes(activeRouteId);
            return (
              <g key={edge.id} opacity={active ? 1 : 0.12}>
                <path d={geometry.d} fill="none" stroke={activeRouteId && active ? '#34d399' : '#64748b'}
                  strokeWidth={activeRouteId && active ? 2.8 : 1.6}
                  markerEnd={`url(#${markerId}-${activeRouteId && active ? 'active' : 'edge'})`} />
                <text x={geometry.labelX} y={geometry.labelY} textAnchor="middle" fill={geometry.back ? '#fbbf24' : '#94a3b8'}
                  fontSize={10} paintOrder="stroke" stroke="#11131A" strokeWidth={4}>
                  {truncateBusinessBusText(`${edge.relation}${geometry.back ? ' · 回边' : ''}`, EDGE_LABEL_WIDTH, 10)}
                </text>
              </g>
            );
          })}

          {layout.nodes.map((node, nodeIndex) => {
            const meta = KIND_META[node.kind];
            const active = !activeRouteId || activeNodeIds.has(node.id);
            const selected = selectedNodeId === node.id;
            return (
              <g
                key={node.id}
                data-bus-node="true"
                role="button"
                tabIndex={0}
                aria-label={`${meta.label}节点 ${node.label}，${node.classSymbol}.${node.methodSymbol}。单击查看证据，双击深入子图`}
                opacity={active ? 1 : 0.16}
                className="cursor-pointer outline-none"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode(selected ? null : node.id);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  drillOccurrence(node);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  if (event.key === 'Enter' && event.shiftKey) {
                    drillOccurrence(node);
                    return;
                  }
                  onSelectNode(selected ? null : node.id);
                }}
              >
                <title>{`${node.label}\n${node.classSymbol}.${node.methodSymbol}\n${node.file}`}</title>
                <NodeShape node={node} selected={selected} />
                <g data-bus-node-text="true" clipPath={`url(#${markerId}-node-text-${nodeIndex})`}>
                  <text x={node.x + 14} y={node.y + 22} fill={meta.stroke} fontSize={10} fontWeight={500}>
                    {truncateBusinessBusText(
                      `${meta.label}${node.routeIds.length > 1 ? ` · 共享 ${node.routeIds.length} 条路线` : ''}`,
                      NODE_TEXT_WIDTH,
                      10
                    )}
                  </text>
                  <text x={node.x + 14} y={node.y + 45} fill="#f1f5f9" fontSize={13} fontWeight={500}>
                    {truncateBusinessBusText(node.label, NODE_TEXT_WIDTH, 13)}
                  </text>
                  <text x={node.x + 14} y={node.y + 65} fill="#94a3b8" fontSize={10}>
                    {truncateBusinessBusText(`${node.classSymbol}.${node.methodSymbol}`, NODE_TEXT_WIDTH, 10)}
                  </text>
                  <text x={node.x + 14} y={node.y + 82} fill="#64748b" fontSize={9}>
                    {truncateBusinessBusText(node.file, NODE_TEXT_WIDTH, 9)}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5 pointer-events-none">
        <span className="pointer-events-auto rounded-md border border-emerald-400/30 bg-black/65 px-2 py-1 text-[10px] text-emerald-200">
          源码分析 · 非运行时证明
        </span>
        <select
          aria-label="聚焦业务总线路线"
          value={activeRouteId}
          onChange={(event) => setRoute(event.target.value)}
          title={activeRoute?.summary || '默认合并展示所有证据闭环路线'}
          className="pointer-events-auto max-w-60 rounded-md border border-white/10 bg-black/65 px-2 py-1 text-[10px] text-slate-200"
        >
          <option value="">全部业务路线</option>
          {bus.routes.map((route) => (
            <option key={route.id} value={route.id} disabled={route.visibleStepCount === 0}>
              {route.label} · {route.visibleStepCount}/{route.totalStepCount} 步
              {route.visibleStepCount === 0 ? '（测试步骤已隐藏）' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="隐藏测试节点"
          aria-pressed={hideTestNodes}
          onClick={() => onHideTestNodesChange(!hideTestNodes)}
          className={`pointer-events-auto rounded-md border bg-black/65 px-2 py-1 text-[10px] ${
            hideTestNodes ? 'border-sky-400/40 text-sky-200' : 'border-white/10 text-slate-400'
          }`}
        >
          隐藏测试节点{hideTestNodes ? ' ✓' : ''} · {testNodeCount}
        </button>
        <button type="button" onClick={fitView} title="适应视图"
          className="pointer-events-auto rounded-md border border-white/10 bg-black/65 p-1 text-slate-300 hover:text-white">
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {bus.routes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs leading-relaxed text-slate-400">
          {emptyLabel || '尚无 AI 业务总线。点击右上角“开始 AI 分析”，AI 会从源码入口追到状态变化、外部边界和结果落点。'}
        </div>
      )}
      {bus.routes.length > 0 && bus.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-slate-400">
          当前业务路线的节点都已按测试规则隐藏，关闭“隐藏测试节点”即可恢复。
        </div>
      )}
      {bus.nodes.length > 0 && (
        <div className="pointer-events-none absolute bottom-2 left-2 text-[10px] text-slate-500">
          {bus.nodes.length} 个业务节点 · {bus.edges.length} 条有向边 · 滚轮缩放 · 左键/中键拖动画布 · 单击看证据 · 双击单路线节点深入子图
        </div>
      )}
    </div>
  );
};
