import { Router } from 'express';
import { agentEngine } from '../agentEngine';
import { aiService } from '../aiService';
import { asyncHandler, badRequest } from '../http/errors';
import { resolveRepoPath } from '../utils/paths';
import type { AgentExplainRequest, ExplainRequest } from '../../shared/types';

export const aiRouter = Router();

/** Both engines accept the same body; only the agent one needs a repo root. */
function readExplainRequest(body: any): ExplainRequest {
  const { scopeType, targetLine, diff, filePath, commitMessage, userPrompt, task,
    learnRequestMode, existingBusinessRoutes, config } =
    body ?? {};

  const isLearn = task === 'learn' || scopeType === 'repo';
  if (learnRequestMode !== undefined && learnRequestMode !== 'question' && learnRequestMode !== 'expand_graph') {
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
  if (!diff && !targetLine && !isLearn) {
    throw badRequest('Diff content or targetLine is required');
  }

  return {
    scopeType,
    targetLine,
    diff: diff || targetLine?.content || '',
    filePath,
    commitMessage,
    userPrompt,
    task,
    learnRequestMode,
    existingBusinessRoutes,
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
