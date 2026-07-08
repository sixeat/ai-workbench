import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface DarkSelectOption {
  description?: string;
  disabled?: boolean;
  label: string;
  value: string;
}

export interface DarkSelectGroup {
  label?: string;
  options: DarkSelectOption[];
}

interface DarkSelectProps {
  buttonClassName?: string;
  className?: string;
  disabled?: boolean;
  emptyLabel?: string;
  groups?: DarkSelectGroup[];
  label?: string;
  menuClassName?: string;
  onChange: (value: string) => void;
  options?: DarkSelectOption[];
  placeholder?: string;
  title?: string;
  value: string;
}

function normalizeGroups(options?: DarkSelectOption[], groups?: DarkSelectGroup[]): DarkSelectGroup[] {
  if (groups) return groups;
  return [{ options: options || [] }];
}

export function DarkSelect({
  buttonClassName,
  className,
  disabled,
  emptyLabel = '暂无可选项',
  groups,
  label,
  menuClassName,
  onChange,
  options,
  placeholder = '请选择',
  title,
  value,
}: DarkSelectProps) {
  const [open, setOpen] = useState(false);
  const normalizedGroups = useMemo(() => normalizeGroups(options, groups), [groups, options]);
  const flatOptions = useMemo(() => normalizedGroups.flatMap((group) => group.options), [normalizedGroups]);
  const selectedOption = flatOptions.find((option) => option.value === value);

  return (
    <div
      className={cn('relative block', label && 'space-y-1', className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {label && <span className="block text-[10px] text-gray-500">{label}</span>}
      <button
        type="button"
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-left text-xs text-white shadow-sm shadow-black/10 transition-colors',
          'hover:border-gray-600 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/10',
          'disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500 disabled:opacity-70',
          buttonClassName
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selectedOption && 'text-gray-500')}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && !disabled && (
        <div className={cn('absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-panel-border bg-[#111821] shadow-2xl shadow-black/40', menuClassName)}>
          {flatOptions.length === 0 ? (
            <div className="px-3 py-2.5 text-[10px] leading-4 text-gray-500">{emptyLabel}</div>
          ) : (
            <div className="max-h-56 overflow-auto p-1.5">
              {normalizedGroups.map((group, groupIndex) => {
                if (group.options.length === 0) return null;
                return (
                  <div key={`${group.label || 'group'}-${groupIndex}`} className={groupIndex > 0 ? 'mt-1.5 border-t border-panel-border pt-1.5' : ''}>
                    {group.label && <div className="px-2 py-1 text-[9px] font-medium text-gray-500">{group.label}</div>}
                    {group.options.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={option.disabled}
                        onClick={() => {
                          if (option.disabled) return;
                          onChange(option.value);
                          setOpen(false);
                        }}
                        className={cn(
                          'flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-45',
                          option.value === value && 'bg-accent/10 text-accent'
                        )}
                      >
                        <span className="truncate text-[11px] text-current">{option.label}</span>
                        {option.description && <span className="mt-0.5 truncate text-[9px] text-gray-500">{option.description}</span>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
