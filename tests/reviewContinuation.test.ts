import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendReviewContinuation,
  buildReviewContinuationPrompt,
} from '../src/utils/reviewContinuation';

const config = {
  provider: 'custom' as const,
  apiKey: '',
  baseUrl: '',
  model: 'fixture',
  contextWindowTokens: 8_000,
};

test('continuation output is appended without replacing the partial report', () => {
  assert.equal(
    appendReviewContinuation('已经完成的报告', '后续报告'),
    '已经完成的报告\n\n后续报告'
  );
});

test('continuation prompt keeps the interruption tail and forbids repetition', () => {
  const report = `HEAD_ONLY_TOKEN\n${'old'.repeat(2_000)}\nUNIQUE_INTERRUPTION_TAIL`;
  const prompt = buildReviewContinuationPrompt(report, config);
  assert.match(prompt, /UNIQUE_INTERRUPTION_TAIL/);
  assert.match(prompt, /只输出尚未完成的后续正文/);
  assert.doesNotMatch(prompt, /HEAD_ONLY_TOKEN/);
});
