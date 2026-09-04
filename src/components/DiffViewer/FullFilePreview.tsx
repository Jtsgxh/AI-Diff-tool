import React from 'react';
import { AlertCircle, FileQuestion, LoaderCircle } from 'lucide-react';
import type { FilePreview } from '../../types';

interface FullFilePreviewProps {
  preview: FilePreview | null;
  isLoading: boolean;
  error: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const FullFilePreview = React.memo<FullFilePreviewProps>(
  ({ preview, isLoading, error, scrollRef, children }) => {
    if (isLoading) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-zinc-600">
          <LoaderCircle className="w-4 h-4 mr-2 animate-spin" />
          正在读取完整文件…
        </div>
      );
    }

    if (error) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-sm text-rose-700 p-8 text-center">
          <AlertCircle className="w-8 h-8 mb-3 stroke-1.5" />
          <p className="font-medium">完整文件读取失败</p>
          <p className="text-xs text-rose-600 mt-1 max-w-xl">{error}</p>
        </div>
      );
    }

    if (!preview) return null;

    if (preview.isBinary || preview.isTooLarge) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-sm text-zinc-600 p-8 text-center">
          <FileQuestion className="w-9 h-9 mb-3 text-zinc-500 stroke-1.5" />
          <p className="font-medium text-zinc-800">
            {preview.isBinary ? '二进制文件无法文本预览' : '文件过大，未加载完整内容'}
          </p>
          <p className="text-xs mt-1">文件大小 {formatBytes(preview.byteSize)}</p>
        </div>
      );
    }

    const sourceLabel =
      preview.source === 'working-tree'
        ? '工作区'
        : `提交 ${preview.revision?.slice(0, 7) || ''}`;

    return (
      <div className="h-full flex flex-col bg-[#ECECE8]">
        <div className="h-8 shrink-0 px-3 flex items-center gap-2 border-b border-black/10 bg-[#E7E7E3] text-[11px] text-zinc-600 font-mono sticky top-0 z-30">
          <span>{sourceLabel}</span>
          <span>·</span>
          <span>{preview.lineCount ?? 0} 行</span>
          <span>·</span>
          <span>{formatBytes(preview.byteSize)}</span>
          {preview.encoding && (
            <>
              <span>·</span>
              <span>{preview.encoding.toUpperCase()}</span>
            </>
          )}
        </div>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto pb-16">
          {children}
        </div>
      </div>
    );
  }
);

FullFilePreview.displayName = 'FullFilePreview';
