import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

type PanelButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type PanelButtonSize = 'xs' | 'sm' | 'md' | 'icon';

interface PanelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  size?: PanelButtonSize;
  variant?: PanelButtonVariant;
}

const variantClasses: Record<PanelButtonVariant, string> = {
  primary: 'border-accent/45 bg-accent/15 text-white shadow-sm shadow-black/20 hover:border-accent/70 hover:bg-accent/25',
  secondary: 'border-panel-border bg-panel-bg text-gray-300 hover:border-accent/70 hover:text-accent',
  ghost: 'border-panel-border bg-canvas-bg text-gray-400 hover:border-gray-600 hover:bg-panel-bg hover:text-white',
  danger: 'border-red-500/25 bg-red-500/10 text-red-300 hover:border-red-400/70 hover:bg-red-500/15',
};

const sizeClasses: Record<PanelButtonSize, string> = {
  xs: 'min-h-[28px] px-2 py-1 text-[10px]',
  sm: 'min-h-[32px] px-3 py-1.5 text-xs',
  md: 'min-h-[36px] px-3 py-2 text-xs',
  icon: 'h-8 w-8 p-0',
};

export function PanelButton({
  children,
  className,
  size = 'sm',
  type = 'button',
  variant = 'secondary',
  ...props
}: PanelButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'panel-button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:border-panel-border disabled:bg-canvas-bg disabled:text-gray-500 disabled:opacity-65',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
