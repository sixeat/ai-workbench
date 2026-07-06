import {
  proxyListAssetCollections,
  type ProxyAssetCollection,
  type ProxyAssetCollectionListOptions,
  type ProxyAssetCollectionListResponse,
} from './apiProxy';

const ASSET_COLLECTION_PAGE_SIZE = 500;

type AssetCollectionPageLoader = (
  options: ProxyAssetCollectionListOptions
) => Promise<ProxyAssetCollectionListResponse>;

export async function loadAllAssetCollections(
  fetchPage: AssetCollectionPageLoader = proxyListAssetCollections
): Promise<ProxyAssetCollection[]> {
  const collections: ProxyAssetCollection[] = [];
  const seenIds = new Set<string>();
  let offset = 0;
  let total: number | null = null;

  while (total === null || collections.length < total) {
    const page = await fetchPage({ limit: ASSET_COLLECTION_PAGE_SIZE, offset });
    const items = Array.isArray(page.collections) ? page.collections : [];

    for (const item of items) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      collections.push(item);
    }

    total = Number.isFinite(page.total) ? Number(page.total) : collections.length;
    const nextOffset = Number(page.offset ?? offset) + Number(page.limit || ASSET_COLLECTION_PAGE_SIZE);
    if (items.length === 0 || nextOffset <= offset) break;
    offset = nextOffset;
  }

  return collections;
}
