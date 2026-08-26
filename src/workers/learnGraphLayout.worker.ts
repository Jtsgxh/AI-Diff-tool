import type { LearnEdge } from '../types';
import { settleLearnCommunityLayout, type LearnCommunityLayout } from '../utils/learnCommunityLayout';

self.onmessage = ({ data }: MessageEvent<{ layout: LearnCommunityLayout; edges: LearnEdge[] }>) => {
  self.postMessage(settleLearnCommunityLayout(data.layout, data.edges));
};
