import type { ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SidebarProps {
  children: ReactNode;
  position: 'left' | 'right';
  width?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  title?: string;
  className?: string;
}

export function Sidebar({
  children,
  position,
  width = 280,
  collapsed = false,
  onToggle,
  title,
  className,
}: SidebarProps) {
  const isLeft = position === 'left';
  const Icon = collapsed ? (isLeft ? ChevronsRight : ChevronsLeft) : (isLeft ? ChevronsLeft : ChevronsRight);

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col border-panel-border bg-panel-bg transition-all duration-200',
        isLeft ? 'border-r' : 'border-l',
        collapsed && 'items-center',
        className
      )}
      style={{ width: collapsed ? 44 : width }}
    >
      {onToggle && (
        <button
          onClick={onToggle}
          className={cn(
            'absolute top-3 z-20 flex h-7 w-7 items-center justify-center rounded-lg border border-panel-border bg-canvas-bg text-gray-400 shadow-lg transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-white',
            collapsed
              ? 'left-1/2 -translate-x-1/2'
              : isLeft
                ? 'right-2 top-1/2 -translate-y-1/2'
                : 'left-2 top-1/2 -translate-y-1/2'
          )}
          title={collapsed ? `展开${title || ''}` : `收起${title || ''}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      )}

      {collapsed ? (
        <div className="mt-12 flex flex-1 items-center justify-start">
          {title && (
            <div className="whitespace-nowrap text-[11px] font-medium tracking-[0.3em] text-gray-500 [writing-mode:vertical-rl]">
              {title}
            </div>
          )}
        </div>
      ) : (
        children
      )}
    </aside>
  );
}

interface SidebarSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function SidebarSection({ title, children, className }: SidebarSectionProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="border-b border-panel-border px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          {title}
        </h3>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {children}
      </div>
    </div>
  );
}
