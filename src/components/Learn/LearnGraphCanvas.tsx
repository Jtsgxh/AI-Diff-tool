import React, { useMemo } from 'react';
import type { LearnGraph } from '../../types';
import { communityColor } from '../../utils/learnGraph';

interface LearnGraphCanvasProps {
  graph: LearnGraph;
  selectedNodeId: string | null;
  selectedCommunityId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectCommunity: (id: string | null) => void;
}

export const LearnGraphCanvas: React.FC<LearnGraphCanvasProps> = ({
  graph,
  selectedNodeId,
  selectedCommunityId,
  onSelectNode,
  onSelectCommunity,
}) => {
  const communityById = useMemo(
    () => new Map(graph.communities.map((community) => [community.id, community])),
    [graph.communities]
  );

  return (
    <div className="w-full h-full overflow-auto bg-[#12131A] p-3">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="text-xs font-semibold text-slate-100">AI 识别的主要业务路线</div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            只保留经源码核实的关键步骤；箭头表示业务先后关系，不代表全部静态引用。
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-slate-500 border border-white/10 rounded-full px-2 py-0.5">
          {graph.businessRoutes.length} 条路线
        </span>
      </div>

      <div className="space-y-3">
        {graph.businessRoutes.map((route) => (
          <section
            key={route.id}
            className="rounded-xl border border-white/10 bg-[#171822] px-3 py-2.5"
          >
            <div className="flex items-baseline gap-2 mb-2">
              <h3 className="text-xs font-bold text-slate-100">{route.label}</h3>
              {route.summary && (
                <p className="text-[10px] text-slate-500 leading-relaxed">{route.summary}</p>
              )}
            </div>

            <div className="overflow-x-auto pb-1">
              <div className="flex items-stretch gap-2 min-w-max">
                {route.steps.map((step, index) => {
                  const community = step.communityId
                    ? communityById.get(step.communityId)
                    : undefined;
                  const color = step.communityId
                    ? communityColor(step.communityId)
                    : '#64748b';
                  const nodeSelected = Boolean(step.nodeId && selectedNodeId === step.nodeId);
                  const communitySelected = Boolean(
                    !nodeSelected &&
                      step.communityId &&
                      selectedCommunityId === step.communityId
                  );
                  const canSelect = Boolean(step.nodeId || step.communityId);
                  return (
                    <React.Fragment key={`${route.id}-${index}-${step.file}-${step.symbol || ''}`}>
                      {index > 0 && (
                        <div className="self-center text-lg text-slate-600 px-0.5" aria-hidden="true">
                          →
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={!canSelect}
                        onClick={() => {
                          onSelectNode(step.nodeId || null);
                          onSelectCommunity(step.communityId || null);
                        }}
                        className={`w-[210px] shrink-0 rounded-lg border p-2.5 text-left transition ${
                          nodeSelected
                            ? 'bg-amber-500/15 border-amber-400'
                            : communitySelected
                              ? 'bg-white/[0.06] border-white/30'
                              : 'bg-black/20 border-white/10 hover:border-white/25'
                        } disabled:cursor-default`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-black/30 text-[10px] font-bold text-slate-200 flex items-center justify-center">
                            {index + 1}
                          </span>
                          <span className="text-[11px] font-bold text-slate-100 truncate">
                            {step.label}
                          </span>
                        </div>
                        <div
                          className="inline-flex mt-2 rounded-full border px-1.5 py-0.5 text-[9px]"
                          style={{
                            color,
                            borderColor: `${color}66`,
                            backgroundColor: `${color}12`,
                          }}
                        >
                          {community?.label || '未映射社区'}
                        </div>
                        <p className="mt-1.5 text-[10px] text-slate-300 leading-relaxed whitespace-normal">
                          {step.description || 'AI 未提供这一步的数据或状态说明'}
                        </p>
                        <p className="mt-2 text-[9px] font-mono text-slate-500 break-all">
                          {step.file}
                          {step.symbol ? ` :: ${step.symbol}` : ''}
                        </p>
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
