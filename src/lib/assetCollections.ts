export interface CollectionTemplate {
  category: string;
  label: string;
  description: string;
  placeholder: string;
  roles: string[];
}

export interface AssetCollectionLike {
  assets: Array<{ id: string }>;
}

export interface LibraryAssetLike {
  id: string;
  fileName?: string;
  prompt?: string;
  model?: string;
  providerId?: string;
  libraryRole?: string;
  libraryNote?: string;
  type?: string;
  url?: string;
}

export const COLLECTION_TEMPLATES: CollectionTemplate[] = [
  {
    category: 'character',
    label: '角色',
    description: '用于保存角色三视图、脸部特写、表情、服装和动作参考。',
    placeholder: '例如：女主 A - 三视图素材',
    roles: ['三视图', '正面', '侧面', '背面', '脸部特写', '表情', '服装', '动作', '姿态', '道具'],
  },
  {
    category: 'scene',
    label: '场景',
    description: '用于保存场景概念图、环境氛围、机位、光照和道具参考。',
    placeholder: '例如：雨夜街区 - 场景参考',
    roles: ['概念图', '环境', '远景', '中景', '特写', '机位', '光照', '道具', '氛围', '平面图'],
  },
  {
    category: 'product',
    label: '产品',
    description: '用于保存产品主图、细节、包装、材质和广告参考。',
    placeholder: '例如：苹果果茶 - 产品素材',
    roles: ['主图', '细节', '包装', '材质', '使用场景', '广告', '尺寸参考', '卖点图'],
  },
  {
    category: 'reference-group',
    label: '参考图组',
    description: '用于图生图、图生视频和风格一致性的通用参考图组。',
    placeholder: '例如：国风电影感 - 参考图组',
    roles: ['首帧', '尾帧', '风格', '构图', '色彩', '角色参考', '场景参考', '产品参考'],
  },
  {
    category: 'general',
    label: '通用',
    description: '用于保存暂时无法归类的图片、视频和文本资产。',
    placeholder: '例如：项目素材包',
    roles: ['参考', '成品', '草稿', '备选'],
  },
];

export type CollectionCategory = string;

export function templateFor(category: string, templates: readonly CollectionTemplate[] = COLLECTION_TEMPLATES): CollectionTemplate {
  return templates.find((template) => template.category === category) ||
    templates.find((template) => template.category === 'general') ||
    COLLECTION_TEMPLATES[0];
}

export function categoryLabel(category: string, templates: readonly CollectionTemplate[] = COLLECTION_TEMPLATES): string {
  return templateFor(category, templates).label;
}

export function normalizeSuggestedRoles(values: readonly unknown[], fallback: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const roles: string[] = [];

  for (const value of values) {
    const role = String(value || '').trim();
    if (!role || seen.has(role)) continue;
    seen.add(role);
    roles.push(role);
  }

  return roles.length > 0 ? roles : [...fallback];
}

export function parseSuggestedRolesText(value: string, fallback: readonly string[] = []): string[] {
  const parts = value.split(/[\n,，、/]+/);
  return normalizeSuggestedRoles(parts, fallback);
}

export function formatSuggestedRolesText(roles: readonly string[]): string {
  return normalizeSuggestedRoles(roles).join('\n');
}

export function getSuggestedRoles(
  collection: { category: string; metadata?: Record<string, unknown> },
  templates: readonly CollectionTemplate[] = COLLECTION_TEMPLATES
): string[] {
  const metadataRoles = Array.isArray(collection.metadata?.suggestedRoles)
    ? normalizeSuggestedRoles(collection.metadata.suggestedRoles)
    : [];
  return metadataRoles.length ? metadataRoles : [...templateFor(collection.category, templates).roles];
}

function assetMatchesSearch(asset: LibraryAssetLike, query: string): boolean {
  if (!query) return true;
  return [
    asset.id,
    asset.fileName,
    asset.prompt,
    asset.model,
    asset.providerId,
    asset.libraryRole,
    asset.libraryNote,
    asset.type,
    asset.url,
  ].some((value) => String(value || '').toLowerCase().includes(query));
}

export function listCollectionLibraryAssets<T extends LibraryAssetLike>(
  assets: readonly T[],
  options: { search?: string; role?: string } = {}
): T[] {
  const query = String(options.search || '').trim().toLowerCase();
  const role = String(options.role || '').trim();

  return assets
    .filter((asset) => !role || role === 'all' || asset.libraryRole === role)
    .filter((asset) => assetMatchesSearch(asset, query));
}

export function listUngroupedLibraryAssets<T extends LibraryAssetLike>(
  collections: readonly AssetCollectionLike[],
  assets: readonly T[],
  options: { search?: string; limit?: number } = {}
): T[] {
  const groupedIds = new Set(collections.flatMap((collection) => collection.assets.map((asset) => asset.id)));
  const query = String(options.search || '').trim().toLowerCase();
  const limit = Number.isFinite(options.limit) && Number(options.limit) > 0 ? Number(options.limit) : 48;

  return assets
    .filter((asset) => !groupedIds.has(asset.id))
    .filter((asset) => assetMatchesSearch(asset, query))
    .slice(0, limit);
}

export function mergeLibraryAssetPages<T extends LibraryAssetLike>(current: readonly T[], next: readonly T[]): T[] {
  const seen = new Set<string>();
  return [...current, ...next].filter((asset) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}

export function formatAssetLibraryPageSummary(visible: number, loaded: number, total: number, query = ''): string {
  const safeTotal = Math.max(total, loaded);
  if (query.trim()) return `${visible}/${loaded} 个匹配，已加载 ${loaded}/${safeTotal}`;
  return `已加载 ${loaded}/${safeTotal} 个素材`;
}
