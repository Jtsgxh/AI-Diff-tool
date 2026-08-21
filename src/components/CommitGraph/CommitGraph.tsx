import React, { useState, useMemo } from 'react';
import { CommitNode, SelectionState } from '../../types';
import { computeGraphLayout, BRANCH_COLORS } from '../../utils/graphLayout';
import {
  GitCommit,
  GitBranch,
  Tag,
  Search,
  ArrowRightLeft,
  Calendar,
  User,
  Hash,
  Sparkles,
} from 'lucide-react';

interface CommitGraphProps {
  commits: CommitNode[];
  selection: SelectionState;
  onSelectCommit: (hash: string) => void;
  onCompareCommits: (baseHash: string, targetHash: string) => void;
  onExplainCommit: (hash: string, message: string) => void;
}

const ROW_HEIGHT = 44;
const LANE_WIDTH = 18;
const DOT_RADIUS = 5;

export const CommitGraph: React.FC<CommitGraphProps> = ({
  commits,
  selection,
  onSelectCommit,
  onCompareCommits,
  onExplainCommit,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHashA, setSelectedHashA] = useState<string | null>(null);

  // Filter commits
  const filteredCommits = useMemo(() => {
    if (!searchTerm.trim()) return commits;
    const term = searchTerm.toLowerCase();
    return commits.filter(
      (c) =>
        c.message.toLowerCase().includes(term) ||
        c.author.toLowerCase().includes(term) ||
        c.shortHash.toLowerCase().includes(term) ||
        c.refs.some((r) => r.toLowerCase().includes(term))
    );
  }, [commits, searchTerm]);

  // Compute graph topological lanes
  const { nodes, maxColumns } = useMemo(() => {
    return computeGraphLayout(filteredCommits);
  }, [filteredCommits]);

  // Create hash to index lookup for SVG path drawing
  const hashToNodeMap = useMemo(() => {
    const map = new Map<string, { node: (typeof nodes)[0]; index: number }>();
    nodes.forEach((node, index) => {
      map.set(node.hash, { node, index });
    });
    return map;
  }, [nodes]);

  const handleRowClick = (hash: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      // Comparison multi-selection mode
      if (!selectedHashA || selectedHashA === hash) {
        setSelectedHashA(hash);
      } else {
        onCompareCommits(selectedHashA, hash);
        setSelectedHashA(null);
      }
    } else {
      setSelectedHashA(null);
      onSelectCommit(hash);
    }
  };

  const isSelected = (hash: string) => {
    if (selection.type === 'commit' && selection.commitHash === hash) return true;
    if (selection.type === 'compare' && (selection.baseHash === hash || selection.targetHash === hash))
      return true;
    if (selectedHashA === hash) return true;
    return false;
  };

  const svgWidth = Math.max(LANE_WIDTH * (maxColumns + 1), 32);

  return (
    <div className="flex flex-col h-full bg-[#181920] border-r border-white/10 text-slate-200">
      {/* Top Bar: Search & Compare Helper */}
      <div className="p-3 border-b border-white/10 flex flex-col space-y-2 bg-[#15161C]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
            <GitCommit className="w-4 h-4 text-purple-400" />
            <span>提交历史图谱 (Commit DAG)</span>
            <span className="text-[11px] bg-white/5 text-slate-400 px-1.5 py-0.2 rounded">
              {filteredCommits.length}
            </span>
          </div>

          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <span className="text-slate-500">按住 Ctrl/Cmd 单击两项对比</span>
          </div>
        </div>

        {/* Search Box */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索提交信息、作者、SHA、分支..."
            className="w-full bg-[#1C1D24] text-xs text-slate-200 pl-8 pr-3 py-1.5 rounded-md border border-white/5 focus:outline-none focus:border-purple-500/50 transition placeholder:text-slate-500"
          />
        </div>

        {/* Active Comparison Banner */}
        {selection.type === 'compare' && (
          <div className="flex items-center justify-between bg-purple-500/10 border border-purple-500/30 rounded px-2.5 py-1 text-xs text-purple-300">
            <div className="flex items-center space-x-1.5 font-mono text-[11px]">
              <ArrowRightLeft className="w-3.5 h-3.5 text-purple-400" />
              <span>对比模式:</span>
              <span className="font-semibold text-purple-200">{selection.baseHash?.slice(0, 7)}</span>
              <span>↔</span>
              <span className="font-semibold text-purple-200">{selection.targetHash?.slice(0, 7)}</span>
            </div>
            <button
              onClick={() => onSelectCommit(selection.targetHash || selection.baseHash || '')}
              className="text-[10px] text-purple-400 hover:text-purple-200 underline"
            >
              退出对比
            </button>
          </div>
        )}

        {selectedHashA && selection.type !== 'compare' && (
          <div className="bg-indigo-500/15 border border-indigo-500/30 rounded px-2 py-1 text-xs text-indigo-300 flex items-center justify-between animate-pulse">
            <span>已选基准 [{selectedHashA.slice(0, 7)}]，请点击另一个提交以进行对比</span>
            <button
              onClick={() => setSelectedHashA(null)}
              className="text-[10px] text-indigo-400 hover:text-white underline ml-2"
            >
              取消
            </button>
          </div>
        )}
      </div>

      {/* Commits List & SVG Graph */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative font-sans">
        <div className="relative" style={{ height: nodes.length * ROW_HEIGHT }}>
          {/* SVG Overlay for drawing branch lanes and bezier curves */}
          <svg
            className="absolute left-0 top-0 pointer-events-none z-10"
            style={{ width: svgWidth, height: nodes.length * ROW_HEIGHT }}
          >
            {nodes.map((node, i) => {
              const currentX = (node.column + 0.8) * LANE_WIDTH;
              const currentY = i * ROW_HEIGHT + ROW_HEIGHT / 2;

              // Draw curves to parents
              return node.parents.map((parentHash) => {
                const parentEntry = hashToNodeMap.get(parentHash);
                if (!parentEntry) return null;

                const parentX = (parentEntry.node.column + 0.8) * LANE_WIDTH;
                const parentY = parentEntry.index * ROW_HEIGHT + ROW_HEIGHT / 2;

                if (node.column === parentEntry.node.column) {
                  // Straight vertical line
                  return (
                    <line
                      key={`${node.hash}-${parentHash}`}
                      x1={currentX}
                      y1={currentY}
                      x2={parentX}
                      y2={parentY}
                      stroke={node.color}
                      strokeWidth="2.2"
                      strokeOpacity="0.85"
                    />
                  );
                }

                // Smooth Bezier curve for fork / merge
                const controlY1 = currentY + (parentY - currentY) * 0.5;
                const controlY2 = currentY + (parentY - currentY) * 0.5;

                const pathData = `M ${currentX} ${currentY} C ${currentX} ${controlY1}, ${parentX} ${controlY2}, ${parentX} ${parentY}`;

                return (
                  <path
                    key={`${node.hash}-${parentHash}`}
                    d={pathData}
                    fill="none"
                    stroke={node.color}
                    strokeWidth="2.2"
                    strokeOpacity="0.85"
                  />
                );
              });
            })}

            {/* Draw commit dot markers */}
            {nodes.map((node, i) => {
              const x = (node.column + 0.8) * LANE_WIDTH;
              const y = i * ROW_HEIGHT + ROW_HEIGHT / 2;
              const isCurrSelected = isSelected(node.hash);

              return (
                <g key={`dot-${node.hash}`}>
                  {/* Outer selection ring */}
                  {isCurrSelected && (
                    <circle cx={x} cy={y} r={DOT_RADIUS + 4} fill="none" stroke="#A855F7" strokeWidth="2" />
                  )}

                  {/* Commit Dot */}
                  <circle
                    cx={x}
                    cy={y}
                    r={node.isHead ? DOT_RADIUS + 1 : DOT_RADIUS}
                    fill={node.color}
                    stroke="#181920"
                    strokeWidth="2"
                  />

                  {/* HEAD Inner Dot */}
                  {node.isHead && <circle cx={x} cy={y} r={2.5} fill="#FFFFFF" />}
                </g>
              );
            })}
          </svg>

          {/* Rows */}
          {nodes.map((node, i) => {
            const isCurrSelected = isSelected(node.hash);

            return (
              <div
                key={node.hash}
                onClick={(e) => handleRowClick(node.hash, e)}
                style={{
                  top: i * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  paddingLeft: svgWidth + 8,
                }}
                className={`absolute left-0 right-0 flex items-center pr-3 cursor-pointer select-none transition border-b border-white/[0.04] group ${
                  isCurrSelected
                    ? 'bg-purple-600/15 border-purple-500/30'
                    : 'hover:bg-white/[0.04]'
                }`}
              >
                {/* Commit Content */}
                <div className="flex-1 flex items-center justify-between min-w-0 pr-2">
                  <div className="flex items-center space-x-2 min-w-0">
                    {/* Refs / Branch / Tag badges */}
                    {node.refs.length > 0 && (
                      <div className="flex items-center space-x-1 shrink-0">
                        {node.refs.map((ref) => {
                          const isHeadRef = ref.includes('HEAD');
                          const isTagRef = ref.startsWith('tag:');
                          return (
                            <span
                              key={ref}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium flex items-center space-x-1 ${
                                isHeadRef
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : isTagRef
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                              }`}
                            >
                              {isTagRef ? <Tag className="w-2.5 h-2.5 mr-0.5" /> : <GitBranch className="w-2.5 h-2.5 mr-0.5" />}
                              {ref.replace('tag: ', '').replace('HEAD -> ', '')}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Commit Message */}
                    <span
                      className={`text-xs font-medium truncate ${
                        isCurrSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'
                      }`}
                      title={node.message}
                    >
                      {node.message}
                    </span>
                  </div>

                  {/* Metadata: Author, Date, SHA */}
                  <div className="flex items-center space-x-3 shrink-0 text-[11px] text-slate-400 font-mono ml-2">
                    <span className="hidden xl:inline text-slate-400 truncate max-w-[100px] font-sans">
                      {node.author}
                    </span>
                    <span className="text-slate-500 whitespace-nowrap">{node.date.slice(5, 16)}</span>
                    <span className="bg-white/5 px-1.5 py-0.5 rounded text-slate-400 text-[10px]">
                      {node.shortHash}
                    </span>

                    {/* Quick AI Explain Button on Hover */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onExplainCommit(node.hash, node.message);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-purple-500/20 text-purple-300 rounded transition"
                      title="使用 AI 语义分析该提交"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
