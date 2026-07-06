import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type FloatingWindowPlacement = 'center' | 'bottom-right' | 'bottom-left' | 'right';

interface FloatingWindowProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  placement?: FloatingWindowPlacement;
}

export function FloatingWindow({
  children,
  className,
  contentClassName,
  placement = 'center',
}: FloatingWindowProps) {
  return (
    <div className={cn('floating-window-layer', `floating-window-layer--${placement}`, className)}>
      <section className={cn('floating-window', contentClassName)}>
        {children}
      </section>
    </div>
  );
}
