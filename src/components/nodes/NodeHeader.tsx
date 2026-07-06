import type { ComponentType, ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

interface NodeHeaderProps {
  label: string;
  color: string;
  icon: ComponentType<{ className?: string }>;
  statusIcon: ReactNode;
}

export function NodeHeader({ label, color, icon: IconComponent, statusIcon }: NodeHeaderProps) {
  return (
    <div className="flex items-center gap-2 rounded-t-xl border-b border-panel-border px-3 py-2" style={{ backgroundColor: `${color}15` }}>
      <div className="flex h-6 w-6 items-center justify-center rounded-md" style={{ backgroundColor: color }}>
        <IconComponent className="h-3.5 w-3.5 text-white" />
      </div>
      <span className="flex-1 truncate text-xs font-medium text-gray-200">{label}</span>
      {statusIcon}
      <GripVertical className="h-3 w-3 cursor-grab text-gray-500" />
    </div>
  );
}
