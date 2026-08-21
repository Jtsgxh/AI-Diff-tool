import React, { useMemo } from 'react';
import { marked } from 'marked';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown once per distinct `content` string.
 *
 * Parsing is memoized because these components sit directly under streaming
 * state: without it, every token re-parses the entire accumulated document,
 * turning a long report into quadratic work.
 */
export const MarkdownRenderer = React.memo<MarkdownRendererProps>(({ content, className }) => {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      return marked.parse(content) as string;
    } catch {
      return content;
    }
  }, [content]);

  return (
    <div
      className={className || 'prose prose-invert prose-xs max-w-none'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';
