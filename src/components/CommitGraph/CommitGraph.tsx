import React, { useState, useMemo, useRef } from 'react';
import { CommitNode, SelectionState } from '../../types';
import { computeGraphLayout } from '../../utils/graphLayout';
import { fillContiguousCommitSelection } from '../../utils/commitSelection';
import {
  GitCommit,
  GitBranch,
  Tag,
  Search,
  ArrowRightLeft,
  Sparkles,
  PanelLeftClose,
  CheckSquare,
  Square,
  Layers,
  Brain,
  X,
} from 'lucide-react';

interface CommitGraphProps {
  commits: CommitNode[];
  selection: SelectionState;
  onSelectCommit: (hash: string) => void;
  onCompareCommits: (baseHash: string, targetHash: string) => void;
  onExplainCommit: (hash: string, message: string) => void;
  onSelectBatchCommits: (hashes: string[]) => void;
  onExplainBatchCommits: (hashes: string[], title: string) => void;
  onCollapse?: () => void;
}

const ROW_HEIGHT = 44;
const LANE_WIDTH = 18;
const DOT_RADIUS = 5;

/**
 * Git DAG with lane layout. Memoized because it is the most expensive panel to
 * re-render and its inputs are unrelated to AI streaming state.
 */
export const CommitGraph = React.memo<CommitGraphProps>(({
  commits,
  selection,
  onSelectCommit,
  onCompareCommits,
  onExplainCommit,
  onSelectBatchCommits,
  onExplainBatchCommits,
  onCollapse,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHashA, setSelectedHashA] = useState<string | null>(null);
  const [selectedBatchSet, setSelectedBatchSet] = useState<Set<string>>(new Set());
  const lastClickedHashRef = useRef<string | null>(null);

  const commitOrder = useMemo(() => commits.map((commit) => commit.hash), [commits]);

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

  const applyBatchSelection = (hashes: string[]) => {
    setSelectedBatchSet(new Set(hashes));
    if (hashes.length >= 2) {
      onSelectBatchCommits(hashes);
    } else if (hashes.length === 1) {
      onSelectCommit(hashes[0]);
    }
  };

  const toggleBatchCommit = (hash: string) => {
    const candidate = new Set(selectedBatchSet);
    if (candidate.has(hash)) candidate.delete(hash);
    else candidate.add(hash);

    const contiguous = fillContiguousCommitSelection(commitOrder, candidate);
    // A commit must remain selected; the clear action handles leaving batch mode.
    const nextHashes = contiguous.length > 0 ? contiguous : [hash];
    const unchanged =
      nextHashes.length === selectedBatchSet.size &&
      nextHashes.every((selectedHash) => selectedBatchSet.has(selectedHash));
    if (!unchanged) applyBatchSelection(nextHashes);
    lastClickedHashRef.current = hash;
  };

  const handleRowClick = (hash: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedHashRef.current) {
      const candidate = new Set(selectedBatchSet);
      candidate.add(lastClickedHashRef.current);
      candidate.add(hash);
      applyBatchSelection(fillContiguousCommitSelection(commitOrder, candidate));
      lastClickedHashRef.current = hash;
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      toggleBatchCommit(hash);
      return;
    }

    // Normal Single Click
    setSelectedHashA(null);
    setSelectedBatchSet(new Set([hash]));
    lastClickedHashRef.current = hash;
    onSelectCommit(hash);
  };

  const handleToggleCheckbox = (hash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleBatchCommit(hash);
  };

  const handleClearBatch = () => {
    if (nodes.length > 0) {
      setSelectedBatchSet(new Set([nodes[0].hash]));
      lastClickedHashRef.current = nodes[0].hash;
      onSelectCommit(nodes[0].hash);
    } else {
      setSelectedBatchSet(new Set());
      lastClickedHashRef.current = null;
    }
  };

  const handleApplyBatchExplain = () => {
    if (selectedBatchSet.size >= 2) {
      const hashes = Array.from(selectedBatchSet);
      const title = `批量合并审查 (${hashes.length} 个提交)`;
      onExplainBatchCommits(hashes, title);
    }
  };

  const isSelected = (hash: string) => {
    if (selectedBatchSet.has(hash)) return true;
    if (selection.type === 'commit' && selection.commitHash === hash) return true;
    if (selection.type === 'compare' && (selection.baseHash === hash || selection.targetHash === hash))
      return true;
    if (selection.type === 'batch' && selection.commitHashes?.includes(hash)) return true;
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
            <span>提交历史图谱</span>
            <span className="text-[11px] bg-white/5 text-slate-400 px-1.5 py-0.2 rounded font-mono">
              {filteredCommits.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-[11px] text-slate-500 hidden xl:inline">多选自动补齐连续区间</span>
            {onCollapse && (
              <button
                onClick={onCollapse}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded transition flex items-center gap-1 text-[11px]"
                title="收起 Git 提交历史面板"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
                <span className="text-[11px]">收起</span>
              </button>
            )}
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
            className="w-full bg-[#1C1D24] text-xs text-slate-200 pl-8 pr-3 py-1.5 rounded-lg border border-white/5 focus:outline-none focus:border-purple-500/50 transition placeholder:text-slate-500"
          />
        </div>

        {/* Batch Selection Action Banner (Prominent Top Banner) */}
        {selectedBatchSet.size >= 2 && (
          <div className="flex flex-col space-y-2 bg-gradient-to-r from-purple-950/70 to-indigo-950/70 border border-purple-500/40 rounded-xl p-2.5 shadow-lg shadow-purple-950/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-purple-200">
                <Layers className="w-4 h-4 text-purple-400 animate-pulse" />
                <span>已合并选择 {selectedBatchSet.size} 个提交</span>
              </div>
              <button
                onClick={handleClearBatch}
                className="text-slate-400 hover:text-white p-0.5 rounded transition"
                title="取消多选"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="pt-1">
              <button
                onClick={handleApplyBatchExplain}
                className="w-full flex items-center justify-center space-x-1.5 py-1.5 px-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold transition shadow-md shadow-purple-600/30"
                title="使用 AI 对这一批提交的合并最终结果进行深度审查"
              >
                <Brain className="w-3.5 h-3.5 text-purple-200" />
                <span>AI 整体深度审查</span>
              </button>
            </div>
          </div>
        )}

        {/* Active Comparison Banner */}
        {selection.type === 'compare' && (
          <div className="flex items-center justify-between bg-purple-500/10 border border-purple-500/30 rounded-lg px-2.5 py-1.5 text-xs text-purple-300">
            <div className="flex items-center space-x-1.5 font-mono text-[11px]">
              <ArrowRightLeft className="w-3.5 h-3.5 text-purple-400" />
              <span>对比:</span>
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
      </div>

      {/* Commits List & SVG Graph */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative font-sans">
        <div className="relative" style={{ height: nodes.length * ROW_HEIGHT }}>
          {/* SVG Overlay for drawing branch lanes and bezier curves */}
          <svg
            className="absolute left-0 top-0 pointer-events-none z-10"
            style={{ width: svgWidth + 24, height: nodes.length * ROW_HEIGHT }}
          >
            {nodes.map((node, i) => {
              const currentX = (node.column + 0.8) * LANE_WIDTH + 24;
              const currentY = i * ROW_HEIGHT + ROW_HEIGHT / 2;

              // Draw curves to parents
              return node.parents.map((parentHash) => {
                const parentEntry = hashToNodeMap.get(parentHash);
                if (!parentEntry) return null;

                const parentX = (parentEntry.node.column + 0.8) * LANE_WIDTH + 24;
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
              const x = (node.column + 0.8) * LANE_WIDTH + 24;
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
            const isBatchChecked = selectedBatchSet.has(node.hash);

            return (
              <div
                key={node.hash}
                onClick={(e) => handleRowClick(node.hash, e)}
                style={{
                  top: i * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  paddingLeft: svgWidth + 30,
                }}
                className={`absolute left-0 right-0 flex items-center pr-3 cursor-pointer select-none transition border-b border-white/[0.04] group ${
                  isCurrSelected
                    ? 'bg-purple-600/20 border-purple-500/30'
                    : 'hover:bg-white/[0.04]'
                }`}
              >
                {/* Left Checkbox for Direct Multi-Select */}
                <div
                  onClick={(e) => handleToggleCheckbox(node.hash, e)}
                  style={{ left: 8 }}
                  className="absolute z-20 p-1 text-slate-500 hover:text-purple-300 transition"
                  title="勾选批量多选；中间提交会自动补齐"
                >
                  {isBatchChecked ? (
                    <CheckSquare className="w-3.5 h-3.5 text-purple-400" />
                  ) : (
                    <Square className="w-3.5 h-3.5 opacity-30 group-hover:opacity-100 hover:text-purple-300 transition" />
                  )}
                </div>

                {/* Commit Content */}
                <div className="flex-1 flex items-center justify-between min-w-0 pr-2 gap-2 overflow-hidden">
                  <div className="flex-1 flex items-center space-x-1.5 min-w-0 overflow-hidden">
                    {/* Refs / Branch / Tag badges */}
                    {node.refs.length > 0 && (
                      <div className="flex items-center space-x-1 shrink-0 max-w-[50%] overflow-hidden">
                        {node.refs.slice(0, 2).map((ref) => {
                          const isHeadRef = ref.includes('HEAD');
                          const isTagRef = ref.startsWith('tag:');
                          const cleanRef = ref.replace('tag: ', '').replace('HEAD -> ', '');
                          return (
                            <span
                              key={ref}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium flex items-center space-x-0.5 max-w-[130px] shrink-0 ${
                                isHeadRef
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : isTagRef
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                              }`}
                              title={cleanRef}
                            >
                              {isTagRef ? (
                                <Tag className="w-2.5 h-2.5 shrink-0 mr-0.5" />
                              ) : (
                                <GitBranch className="w-2.5 h-2.5 shrink-0 mr-0.5" />
                              )}
                              <span className="truncate">{cleanRef}</span>
                            </span>
                          );
                        })}
                        {node.refs.length > 2 && (
                          <span
                            className="text-[10px] px-1 py-0.5 rounded bg-white/10 text-slate-400 font-mono"
                            title={node.refs.slice(2).join(', ')}
                          >
                            +{node.refs.length - 2}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Commit Message */}
                    <span
                      className={`text-xs font-medium truncate flex-1 min-w-[50px] ${
                        isCurrSelected ? 'text-white font-semibold' : 'text-slate-200 group-hover:text-white'
                      }`}
                      title={node.message}
                    >
                      {node.message}
                    </span>
                  </div>

                  {/* Metadata: Author, Date, SHA */}
                  <div className="flex items-center space-x-2.5 shrink-0 text-[11px] text-slate-400 font-mono ml-auto">
                    <span className="hidden xl:inline text-slate-400 truncate max-w-[80px] font-sans">
                      {node.author}
                    </span>
                    <span className="text-slate-500 whitespace-nowrap text-[10px]">{node.date.slice(5, 16)}</span>
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
});

CommitGraph.displayName = 'CommitGraph';
