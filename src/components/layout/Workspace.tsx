import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface WorkspaceProps {
  children: ReactNode;
  className?: string;
}

export function Workspace({ children, className }: WorkspaceProps) {
  return (
    <div className={cn("flex-1 flex overflow-hidden bg-canvas-bg", className)}>
      {children}
    </div>
  );
}

interface PanelProps {
  children: ReactNode;
  className?: string;
}

export function Panel({ children, className }: PanelProps) {
  return (
    <div className={cn("flex-1 relative flex flex-col", className)}>
      {children}
    </div>
  );
}
