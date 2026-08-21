import { Router } from 'express';
import { gitService } from '../gitService';
import { asyncHandler, badRequest } from '../http/errors';
import { resolveRepoPath } from '../utils/paths';

const DEFAULT_COMMIT_LIMIT = 100;

export const repoRouter = Router();

repoRouter.get(
  '/info',
  asyncHandler(async (req, res) => {
    const info = await gitService.getRepoInfo(resolveRepoPath(req.query.path as string));
    res.json(info);
  })
);

/** Commit list with parent hashes, used to lay out the DAG client-side. */
repoRouter.get(
  '/commits',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string, 10) || DEFAULT_COMMIT_LIMIT;
    const commits = await gitService.getCommits(
      resolveRepoPath(req.query.path as string),
      limit
    );
    res.json({ commits });
  })
);

repoRouter.get(
  '/diff/commit',
  asyncHandler(async (req, res) => {
    const hash = req.query.hash as string;
    if (!hash) throw badRequest('Commit hash is required');

    const diff = await gitService.getCommitDiff(
      resolveRepoPath(req.query.path as string),
      hash
    );
    res.json(diff);
  })
);

repoRouter.get(
  '/diff/compare',
  asyncHandler(async (req, res) => {
    const base = req.query.base as string;
    const target = req.query.target as string;
    if (!base || !target) {
      throw badRequest('Both base and target are required for comparison');
    }

    const diff = await gitService.getCompareDiff(
      resolveRepoPath(req.query.path as string),
      base,
      target
    );
    res.json(diff);
  })
);

repoRouter.get(
  '/diff/working-tree',
  asyncHandler(async (req, res) => {
    const diff = await gitService.getWorkingTreeDiff(resolveRepoPath(req.query.path as string));
    res.json(diff);
  })
);

/** Consolidated net diff across an arbitrary set of selected commits. */
repoRouter.post(
  '/diff/batch',
  asyncHandler(async (req, res) => {
    const { repoPath, commitHashes } = req.body ?? {};
    if (!Array.isArray(commitHashes) || commitHashes.length === 0) {
      throw badRequest('commitHashes array is required');
    }

    const diff = await gitService.getBatchCommitsDiff(resolveRepoPath(repoPath), commitHashes);
    res.json(diff);
  })
);
