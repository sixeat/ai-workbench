import {
  proxyListModelCapabilities,
  type ProxyModelCapabilities,
  type ProxyModelCapabilityListOptions,
  type ProxyModelCapabilityListResponse,
} from './apiProxy';

let cachedRecords: ProxyModelCapabilities[] | null = null;
let pendingRequest: Promise<ProxyModelCapabilities[]> | null = null;

const MODEL_CAPABILITY_PAGE_SIZE = 500;

type ModelCapabilityPageLoader = (
  options: ProxyModelCapabilityListOptions
) => Promise<ProxyModelCapabilityListResponse>;

export async function loadAllModelCapabilities(
  fetchPage: ModelCapabilityPageLoader = proxyListModelCapabilities
): Promise<ProxyModelCapabilities[]> {
  const records: ProxyModelCapabilities[] = [];
  const seenIds = new Set<string>();
  let offset = 0;
  let total: number | null = null;

  while (total === null || records.length < total) {
    const page = await fetchPage({ limit: MODEL_CAPABILITY_PAGE_SIZE, offset });
    const items = Array.isArray(page.capabilities) ? page.capabilities : [];

    for (const item of items) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      records.push(item);
    }

    total = Number.isFinite(page.total) ? Number(page.total) : records.length;
    const nextOffset = Number(page.offset ?? offset) + Number(page.limit || MODEL_CAPABILITY_PAGE_SIZE);
    if (items.length === 0 || nextOffset <= offset) break;
    offset = nextOffset;
  }

  return records;
}

export async function loadCachedModelCapabilities(): Promise<ProxyModelCapabilities[]> {
  if (cachedRecords) return cachedRecords;
  if (!pendingRequest) {
    pendingRequest = loadAllModelCapabilities()
      .then((data) => {
        cachedRecords = data;
        return cachedRecords;
      })
      .finally(() => {
        pendingRequest = null;
      });
  }
  return pendingRequest;
}

export function clearModelCapabilityCache(): void {
  cachedRecords = null;
  pendingRequest = null;
}

export function clearModelCapabilityCacheForTests(): void {
  clearModelCapabilityCache();
}
