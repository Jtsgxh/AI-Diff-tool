import { Router } from 'express';
import { agentEngine } from '../agentEngine';
import { aiService } from '../aiService';
import { repositoryConversations } from '../repositoryConversation';
import { asyncHandler, badRequest } from '../http/errors';
import { resolveRepoPath } from '../utils/paths';
import { LEARN_BUSINESS_STEP_KINDS } from '../../shared/types';
import type { AgentExplainRequest, ExplainRequest } from '../../shared/types';

export const aiRouter = Router();

/** 两种引擎都接收仓库路径，以便将所有分析写入同一条仓库对话。 */
function readExplainRequest(body: any): ExplainRequest {
  const { scopeType, targetLine, diff, filePath, commitMessage, userPrompt, task,
    learnRequestMode, existingBusinessRoutes, drillPath, config } =
    body ?? {};

  const isLearn = task === 'learn' || scopeType === 'repo';
  if (learnRequestMode !== undefined &&
      learnRequestMode !== 'question' &&
      learnRequestMode !== 'expand_graph' &&
      learnRequestMode !== 'drilldown_graph') {
    throw badRequest('Invalid learnRequestMode');
  }
  if (learnRequestMode !== undefined && (typeof userPrompt !== 'string' || !userPrompt.trim())) {
    throw badRequest('userPrompt is required for learn requests');
  }
  if (existingBusinessRoutes !== undefined && (!Array.isArray(existingBusinessRoutes) ||
      !existingBusinessRoutes.every((route: any) => route && typeof route.id === 'string' &&
        typeof route.label === 'string' && Array.isArray(route.steps) && route.steps.every((step: any) =>
          step && ['file', 'classSymbol', 'methodSymbol', 'kind'].every((field) =>
            typeof step[field] === 'string' && step[field].trim()))))) {
    throw badRequest('Invalid existingBusinessRoutes');
  }
  const stringArray = (value: unknown) => Array.isArray(value) && value.every((item) =>
    typeof item === 'string' && item.trim());
  const validDrillPath = Array.isArray(drillPath) && drillPath.length > 0 && drillPath.every((target: any) =>
    target && typeof target === 'object' &&
    ['routeId', 'routeLabel', 'label', 'file', 'classSymbol', 'methodSymbol', 'relation',
      'description', 'evidence', 'communityId'].every((field) =>
      typeof target[field] === 'string' && target[field].trim()) &&
    Number.isInteger(target.stepIndex) && target.stepIndex >= 0 &&
    LEARN_BUSINESS_STEP_KINDS.includes(target.kind) &&
    ['inputs', 'outputs', 'stateChanges', 'failurePaths'].every((field) => stringArray(target[field])));
  if (learnRequestMode === 'drilldown_graph' && !validDrillPath) {
    throw badRequest('Valid drillPath is required for drilldown_graph');
  }
  if (learnRequestMode !== 'drilldown_graph' && drillPath !== undefined) {
    throw badRequest('drillPath is only valid for drilldown_graph');
  }
  if (!diff && !targetLine && !isLearn) {
    throw badRequest('Diff content or targetLine is required');
  }

  return {
    repoPath: resolveRepoPath(body?.repoPath),
    scopeType,
    targetLine,
    diff: diff || targetLine?.content || '',
    filePath,
    commitMessage,
    userPrompt,
    task,
    learnRequestMode,
    existingBusinessRoutes,
    drillPath,
    config,
  };
}

/** Fast mode: straight diff explanation, no codebase exploration. */
aiRouter.post(
  '/explain/stream',
  asyncHandler(async (req, res) => {
    await aiService.streamExplainDiff(readExplainRequest(req.body), res);
  })
);

/** 清除指定仓库的审查或学习对话，同时取消该条对话的在途及排队请求。 */
aiRouter.post('/conversation/clear', asyncHandler(async (req, res) => {
  if (typeof req.body?.repoPath !== 'string' || !req.body.repoPath.trim()) {
    throw badRequest('repoPath is required');
  }
  const lane = req.body?.lane ?? 'review';
  if (lane !== 'review' && lane !== 'learn') throw badRequest('Invalid conversation lane');
  repositoryConversations.clear(resolveRepoPath(req.body?.repoPath), lane);
  res.json({ cleared: true });
}));

/** Agent mode: autonomous ReAct exploration of the repository. */
aiRouter.post(
  '/agent/explain/stream',
  asyncHandler(async (req, res) => {
    const request: AgentExplainRequest = {
      ...readExplainRequest(req.body),
      repoPath: resolveRepoPath(req.body?.repoPath),
    };
    await agentEngine.streamAgentExplain(request, res);
  })
);
