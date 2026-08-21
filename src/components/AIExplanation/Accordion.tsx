import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface AccordionProps {
  title: React.ReactNode;
  badge?: React.ReactNode;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  /** Tailwind classes for the outer shell, header, and body respectively. */
  tone: { shell: string; header: string; body: string; text: string };
  showToggleLabel?: boolean;
  children: React.ReactNode;
}

/**
 * Shared shell for the drawer's three collapsible panels (batch manifest,
 * thinking chain, exploration trail), which were previously three copies of
 * the same 30-line header/chevron markup.
 */
export const Accordion: React.FC<AccordionProps> = ({
  title,
  badge,
  icon,
  isOpen,
  onToggle,
  tone,
  showToggleLabel = true,
  children,
}) => (
  <div className={`rounded-xl overflow-hidden ${tone.shell}`}>
    <div
      onClick={onToggle}
      className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer select-none transition border-b border-white/5 ${tone.header}`}
    >
      <div className={`flex items-center space-x-2 text-xs font-semibold ${tone.text}`}>
        {icon}
        <span>{title}</span>
        {badge}
      </div>

      <div className={`flex items-center space-x-1.5 text-xs ${tone.text}`}>
        {showToggleLabel && (
          <span className="text-[10px] font-mono opacity-70">{isOpen ? '收起' : '展开'}</span>
        )}
        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </div>
    </div>

    {isOpen && <div className={`border-t border-white/5 ${tone.body}`}>{children}</div>}
  </div>
);
