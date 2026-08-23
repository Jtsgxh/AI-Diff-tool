import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LearnGraph, LearnNode } from '../../types';
import { communityColor } from '../../utils/learnGraph';

interface LearnGraphCanvasProps {
  graph: LearnGraph;
  selectedNodeId: string | null;
  selectedCommunityId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectCommunity: (id: string | null) => void;
}

interface SimNode extends LearnNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const EDGE_COLOR: Record<string, string> = {
  contains: 'rgba(148,163,184,0.18)',
  imports: 'rgba(56,189,248,0.28)',
  inherits: 'rgba(251,191,36,0.35)',
  references: 'rgba(255,255,255,0.10)',
};

export const LearnGraphCanvas: React.FC<LearnGraphCanvasProps> = ({
  graph,
  selectedNodeId,
  selectedCommunityId,
  onSelectNode,
  onSelectCommunity,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimNode[]>([]);
  const camRef = useRef({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ lx: number; ly: number } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const rafRef = useRef(0);
  const ticksRef = useRef(0);
  const neighborRef = useRef<Set<string>>(new Set());

  const maxDegree = useMemo(
    () => Math.max(1, ...graph.nodes.map((n) => n.degree)),
    [graph.nodes]
  );
  const layoutKey = useMemo(
    () => graph.nodes.map((n) => n.id).join('\n') + `#${graph.edges.length}`,
    [graph.nodes, graph.edges.length]
  );

  const searchHit = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      graph.nodes.filter((n) => n.label.toLowerCase().includes(q) || (n.file || '').toLowerCase().includes(q)).map((n) => n.id)
    );
  }, [graph.nodes, query]);

  useEffect(() => {
    const maxD = Math.max(1, ...graph.nodes.map((n) => n.degree));
    const groups = new Map<string, LearnNode[]>();
    for (const n of graph.nodes) {
      const c = n.communityId;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(n);
    }
    const keys = [...groups.keys()];
    const R = 220 + Math.min(140, graph.nodes.length);
    const sim: SimNode[] = [];
    keys.forEach((cid, i) => {
      const ang = (2 * Math.PI * i) / Math.max(1, keys.length) - Math.PI / 2;
      const cx = Math.cos(ang) * R;
      const cy = Math.sin(ang) * R;
      for (const n of groups.get(cid)!) {
        const jitter = 40 + Math.random() * 50;
        const a = Math.random() * Math.PI * 2;
        sim.push({
          ...n,
          x: cx + Math.cos(a) * jitter,
          y: cy + Math.sin(a) * jitter,
          vx: 0,
          vy: 0,
          r: 4 + 11 * Math.sqrt(n.degree / maxD),
        });
      }
    });
    simRef.current = sim;
    ticksRef.current = 0;
    camRef.current = { x: 0, y: 0, k: 1 };
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const nbs = new Set<string>();
    if (selectedNodeId) {
      nbs.add(selectedNodeId);
      for (const e of graph.edges) {
        if (e.source === selectedNodeId) nbs.add(e.target);
        if (e.target === selectedNodeId) nbs.add(e.source);
      }
    }
    neighborRef.current = nbs;
  }, [graph.edges, selectedNodeId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const step = () => {
      const sim = simRef.current;
      const tickCap = sim.length > 220 ? 180 : 420;
      const alpha = Math.max(0.015, 0.12 * Math.pow(0.985, ticksRef.current));
      if (ticksRef.current < tickCap && sim.length) {
        const centroid = new Map<string, { x: number; y: number; n: number }>();
        for (const n of sim) {
          let c = centroid.get(n.communityId);
          if (!c) {
            c = { x: 0, y: 0, n: 0 };
            centroid.set(n.communityId, c);
          }
          c.x += n.x;
          c.y += n.y;
          c.n++;
        }
        for (const c of centroid.values()) {
          c.x /= c.n;
          c.y /= c.n;
        }

        const range = sim.length > 220 ? 240 : 2000;
        for (let i = 0; i < sim.length; i++) {
          for (let j = i + 1; j < sim.length; j++) {
            const a = sim[i];
            const b = sim[j];
            if (Math.abs(a.x - b.x) > range || Math.abs(a.y - b.y) > range) continue;
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) {
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              d2 = dx * dx + dy * dy;
            }
            const dist = Math.sqrt(d2);
            const f = (alpha * 900) / d2;
            const fx = (dx / dist) * f;
            const fy = (dy / dist) * f;
            a.vx += fx;
            a.vy += fy;
            b.vx -= fx;
            b.vy -= fy;
          }
        }

        const byId = new Map(sim.map((n) => [n.id, n]));
        for (const e of graph.edges) {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const rest = e.relation === 'contains' ? 36 : 58;
          const f = alpha * 0.08 * (dist - rest);
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }

        for (const n of sim) {
          const c = centroid.get(n.communityId);
          if (c) {
            n.vx += (c.x - n.x) * 0.012;
            n.vy += (c.y - n.y) * 0.012;
          }
          n.vx += -n.x * 0.004;
          n.vy += -n.y * 0.004;
          n.vx *= 0.72;
          n.vy *= 0.72;
          n.x += n.vx;
          n.y += n.vy;
        }
        ticksRef.current++;
      }

      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#12131A';
      ctx.fillRect(0, 0, w, h);

      const cam = camRef.current;
      const toScreen = (x: number, y: number) => ({
        x: (x + cam.x) * cam.k + w / 2,
        y: (y + cam.y) * cam.k + h / 2,
      });

      const hiddenComms = hidden;
      const selected = selectedNodeId;
      const neighbors = neighborRef.current;
      const byId = new Map(sim.map((n) => [n.id, n]));

      ctx.lineWidth = 1;
      for (const e of graph.edges) {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) continue;
        if (hiddenComms.has(a.communityId) || hiddenComms.has(b.communityId)) continue;
        const pa = toScreen(a.x, a.y);
        const pb = toScreen(b.x, b.y);
        const hot =
          selected && (e.source === selected || e.target === selected);
        ctx.strokeStyle = hot ? 'rgba(251,191,36,0.7)' : EDGE_COLOR[e.relation] || EDGE_COLOR.references;
        ctx.globalAlpha = selected && !hot ? 0.18 : 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const showLabels = cam.k > 1.35;
      for (const n of sim) {
        if (hiddenComms.has(n.communityId)) continue;
        const p = toScreen(n.x, n.y);
        const r = n.r * Math.sqrt(cam.k);
        const isSel = n.id === selected;
        const isNb = neighbors.has(n.id);
        const isHover = n.id === hoverRef.current;
        const commSel = selectedCommunityId && n.communityId === selectedCommunityId;
        const dim = Boolean((selected && !isNb) || (selectedCommunityId && !commSel));
        const hitSearch = searchHit?.has(n.id);
        ctx.globalAlpha = dim && !hitSearch ? 0.22 : 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = communityColor(n.communityId);
        ctx.fill();
        if (n.kind !== 'file' && n.degree >= maxDegree * 0.55) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (n.kind === 'file') {
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (isSel || isHover || hitSearch) {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        const label =
          isSel || isHover || hitSearch || n.degree >= maxDegree * 0.42 || (showLabels && r > 5);
        if (label) {
          ctx.font = `${isSel || isHover ? 12 : 10}px ui-sans-serif, system-ui`;
          ctx.fillStyle = '#e2e8f0';
          ctx.globalAlpha = dim && !hitSearch ? 0.35 : 1;
          ctx.fillText(n.label, p.x + r + 4, p.y + 3);
        }
        ctx.globalAlpha = 1;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [graph, maxDegree, searchHit, selectedCommunityId, selectedNodeId, hidden]);

  const hitTest = (sx: number, sy: number): SimNode | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const cam = camRef.current;
    const wx = (sx - w / 2) / cam.k - cam.x;
    const wy = (sy - h / 2) / cam.k - cam.y;
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of simRef.current) {
      if (hidden.has(n.communityId)) continue;
      const dx = n.x - wx;
      const dy = n.y - wy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < n.r + 4 / cam.k && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const cam = camRef.current;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    cam.k = Math.min(4, Math.max(0.25, cam.k * factor));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = hitTest(x, y);
    if (node) {
      onSelectNode(node.id);
      onSelectCommunity(node.communityId);
    } else {
      onSelectNode(null);
    }
    dragRef.current = { lx: x, ly: y };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const drag = dragRef.current;
    if (drag) {
      const cam = camRef.current;
      cam.x += (x - drag.lx) / cam.k;
      cam.y += (y - drag.ly) / cam.k;
      drag.lx = x;
      drag.ly = y;
      return;
    }
    const node = hitTest(x, y);
    const id = node?.id || null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      setHover(id);
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const hovered = hover ? graph.nodes.find((n) => n.id === hover) : null;

  return (
    <div className="relative w-full h-full min-h-[280px] bg-[#12131A]" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="absolute top-2 left-2 right-2 flex flex-wrap items-center gap-1.5 pointer-events-none">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索节点"
          className="pointer-events-auto w-36 bg-black/50 border border-white/10 rounded-md px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-500"
        />
        {graph.communities.map((c) => {
          const on = !hidden.has(c.id);
          const active = selectedCommunityId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={(ev) => {
                if (ev.shiftKey) {
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  });
                  return;
                }
                onSelectCommunity(selectedCommunityId === c.id ? null : c.id);
              }}
              className={`pointer-events-auto text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                active ? 'text-white border-white/40' : 'text-slate-300 border-white/10'
              } ${on ? 'bg-black/50' : 'bg-black/20 opacity-40'}`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: communityColor(c.id) }}
              />
              {c.label}
              <span className="text-slate-500">{c.nodeCount}</span>
            </button>
          );
        })}
      </div>
      <div className="absolute bottom-2 left-2 text-[10px] text-slate-500 pointer-events-none">
        {graph.stats.symbolCount} 符号 · {graph.nodes.length} 节点 · {graph.edges.length} 边
        {graph.stats.truncated ? ' · 已裁大图' : ''}
        <span className="ml-2 text-slate-600">滚轮缩放 · 拖动画布 · 点击节点</span>
      </div>
      {hovered && (
        <div className="absolute bottom-2 right-2 max-w-[240px] bg-black/70 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 pointer-events-none">
          <div className="font-semibold text-slate-100">{hovered.label}</div>
          <div className="text-slate-400">
            {hovered.kind} · 度 {hovered.degree}
            {hovered.file ? ` · ${hovered.file}` : ''}
          </div>
        </div>
      )}
    </div>
  );
};
