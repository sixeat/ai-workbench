interface WorkflowSnapshotLike {
  nodes?: unknown[];
  edges?: unknown[];
}

interface DiffCount {
  added: number;
  removed: number;
  changed: number;
}

export interface WorkflowVersionDiffSummary {
  nodeDiff: DiffCount;
  edgeDiff: DiffCount;
  isSame: boolean;
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function itemId(item: unknown, fallback: string): string {
  return isRecord(item) && typeof item.id === 'string' && item.id ? item.id : fallback;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function diffItems(current: readonly unknown[] = [], version: readonly unknown[] = []): DiffCount {
  const currentMap = new Map(current.map((item, index) => [itemId(item, `current-${index}`), stableStringify(item)]));
  const versionMap = new Map(version.map((item, index) => [itemId(item, `version-${index}`), stableStringify(item)]));

  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const [id, versionValue] of versionMap) {
    if (!currentMap.has(id)) {
      added += 1;
    } else if (currentMap.get(id) !== versionValue) {
      changed += 1;
    }
  }

  for (const id of currentMap.keys()) {
    if (!versionMap.has(id)) removed += 1;
  }

  return { added, removed, changed };
}

function formatPart(label: string, diff: DiffCount): string {
  const parts = [
    diff.added ? `+${diff.added}` : '',
    diff.removed ? `-${diff.removed}` : '',
    diff.changed ? `改 ${diff.changed}` : '',
  ].filter(Boolean);
  return parts.length ? `${label} ${parts.join(' / ')}` : '';
}

export function summarizeWorkflowVersionDiff(
  current: WorkflowSnapshotLike,
  version: WorkflowSnapshotLike
): WorkflowVersionDiffSummary {
  const nodeDiff = diffItems(current.nodes || [], version.nodes || []);
  const edgeDiff = diffItems(current.edges || [], version.edges || []);
  const isSame = [nodeDiff, edgeDiff].every((diff) => diff.added === 0 && diff.removed === 0 && diff.changed === 0);
  const label = isSame
    ? '与当前版本一致'
    : [formatPart('节点', nodeDiff), formatPart('连线', edgeDiff)].filter(Boolean).join('，');

  return {
    nodeDiff,
    edgeDiff,
    isSame,
    label,
  };
}
