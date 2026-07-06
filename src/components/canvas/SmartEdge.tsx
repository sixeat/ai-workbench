import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

function edgeColor(label: string, selected?: boolean): string {
  if (selected) return '#f59e0b';
  if (label.includes('image') || label.includes('Image')) return '#22c55e';
  if (label.includes('prompt') || label.includes('text') || label === 'content') return '#38bdf8';
  if (label.includes('video')) return '#ef4444';
  if (['size', 'quality', 'seed', 'count', 'style', 'strength'].includes(label)) return '#f59e0b';
  return '#6366f1';
}

export function SmartEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const label = String((data as any)?.targetKey || '');
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const color = edgeColor(label, selected);

  return (
    <g className="group/edge">
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: selected ? 4 : 2,
          filter: selected ? 'drop-shadow(0 0 6px rgba(245, 158, 11, 0.45))' : undefined,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-md border border-panel-border bg-panel-bg/95 px-2 py-1 text-[10px] font-semibold text-gray-100 opacity-0 shadow-lg transition-opacity group-hover/edge:opacity-100"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              opacity: selected ? 1 : undefined,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
