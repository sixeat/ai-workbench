export function parseOptionalNumberInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseOptionalRatioInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const ratioMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (ratioMatch) {
    const width = Number(ratioMatch[1]);
    const height = Number(ratioMatch[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height;
    }
    return undefined;
  }

  return parseOptionalNumberInput(trimmed);
}
