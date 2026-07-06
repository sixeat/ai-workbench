import { categoryLabel } from './assetCollections';
import type { ProxyAsset, ProxyAssetCollection } from './apiProxy';

export const UNGROUPED_IMAGE_COLLECTION_ID = '__ungrouped_images__';

export interface SelectableImageAssetItem {
  asset: ProxyAsset;
  collectionId: string;
  collectionName: string;
  collectionCategoryId: string;
  collectionCategory: string;
  grouped: boolean;
}

export function isSelectableImageAsset(asset: ProxyAsset): boolean {
  return asset.type === 'image' || [asset.url, asset.fileName].some((value) => /\.(png|jpe?g|webp|gif|avif)$/i.test(value || ''));
}

function matchesQuery(item: SelectableImageAssetItem, query: string): boolean {
  if (!query) return true;
  return [
    item.asset.fileName,
    item.asset.prompt,
    item.asset.id,
    item.asset.libraryRole,
    item.collectionName,
    item.collectionCategory,
  ].some((value) => String(value || '').toLowerCase().includes(query));
}

export function buildSelectableImageAssetItems(
  collections: ProxyAssetCollection[],
  assets: ProxyAsset[],
  options: { category?: string; collectionId?: string; role?: string; search?: string } = {}
): SelectableImageAssetItem[] {
  const selectedCategory = options.category || 'all';
  const selectedCollectionId = options.collectionId || 'all';
  const selectedRole = options.role || 'all';
  const query = (options.search || '').trim().toLowerCase();
  const groupedIds = new Set<string>();
  const items: SelectableImageAssetItem[] = [];

  for (const collection of collections) {
    if (selectedCategory !== 'all' && selectedCategory !== collection.category) continue;
    for (const asset of collection.assets) {
      if (!isSelectableImageAsset(asset)) continue;
      groupedIds.add(asset.id);
      if (selectedCollectionId !== 'all' && selectedCollectionId !== collection.id) continue;
      if (selectedRole !== 'all' && asset.libraryRole !== selectedRole) continue;
      items.push({
        asset,
        collectionId: collection.id,
        collectionName: collection.name,
        collectionCategoryId: collection.category,
        collectionCategory: categoryLabel(collection.category),
        grouped: true,
      });
    }
  }

  if (
    selectedCategory === 'all' &&
    selectedRole === 'all' &&
    (selectedCollectionId === 'all' || selectedCollectionId === UNGROUPED_IMAGE_COLLECTION_ID)
  ) {
    for (const asset of assets) {
      if (!isSelectableImageAsset(asset) || groupedIds.has(asset.id)) continue;
      items.push({
        asset,
        collectionId: UNGROUPED_IMAGE_COLLECTION_ID,
        collectionName: '未分组资产',
        collectionCategoryId: 'ungrouped',
        collectionCategory: '最近资产',
        grouped: false,
      });
    }
  }

  return items.filter((item) => matchesQuery(item, query));
}

export function listImageCollectionCategories(collections: ProxyAssetCollection[]): Array<{ id: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const collection of collections) {
    const imageCount = collection.assets.filter(isSelectableImageAsset).length;
    if (imageCount === 0) continue;
    counts.set(collection.category, (counts.get(collection.category) || 0) + imageCount);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: categoryLabel(id), count }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN'));
}

export function listImageAssetRoles(items: SelectableImageAssetItem[]): string[] {
  return [...new Set(items.map((item) => item.asset.libraryRole).filter((role): role is string => Boolean(role)))]
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}
