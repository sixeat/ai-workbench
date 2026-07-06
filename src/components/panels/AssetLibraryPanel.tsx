import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, CheckSquare, Copy, ExternalLink, FileVideo, FolderOpen, ImagePlus, Pencil, Plus, RefreshCw, Save, Square, Star, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FloatingWindow } from '../layout/FloatingWindow';
import {
  proxyAssetUrl,
  proxyAddAssetToCollection,
  proxyAddAssetsToCollection,
  proxyCreateAssetCollection,
  proxyDeleteAssetCollection,
  proxyListAssetCollectionTemplates,
  proxyListAssetCollections,
  proxyListAssets,
  proxyOpenAssetLocation,
  proxyReorderAssetCollectionItems,
  proxyRemoveAssetFromCollection,
  proxyRemoveAssetsFromCollection,
  proxyUpdateAssetCollection,
  type ProxyAsset,
  type ProxyAssetCollection,
} from '../../lib/apiProxy';
import {
  COLLECTION_TEMPLATES,
  categoryLabel,
  formatAssetLibraryPageSummary,
  formatSuggestedRolesText,
  getSuggestedRoles,
  listAssetCollectionsForLibrary,
  listCollectionLibraryAssets,
  listUngroupedLibraryAssets,
  mergeLibraryAssetPages,
  parseSuggestedRolesText,
  templateFor,
  type CollectionCategory,
  type CollectionTemplate,
} from '../../lib/assetCollections';
import { useImagePreviewStore } from '../../stores/imagePreviewStore';

interface AssetLibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ASSET_PAGE_SIZE = 80;
const COLLECTION_PAGE_SIZE = 80;

function coverFor(collection: ProxyAssetCollection): ProxyAsset | undefined {
  return collection.assets.find((asset) => asset.id === collection.coverAssetId) || collection.assets[0];
}

function isImageAsset(asset: ProxyAsset): boolean {
  return asset.type === 'image' || /\.(png|jpe?g|webp|gif|avif)$/i.test(asset.url || asset.fileName || '');
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function AssetLibraryPanel({ isOpen, onClose }: AssetLibraryPanelProps) {
  const [collections, setCollections] = useState<ProxyAssetCollection[]>([]);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const [assets, setAssets] = useState<ProxyAsset[]>([]);
  const [assetTotal, setAssetTotal] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMoreCollections, setLoadingMoreCollections] = useState(false);
  const [loadingMoreAssets, setLoadingMoreAssets] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDescription, setNewCollectionDescription] = useState('');
  const [newCollectionCategory, setNewCollectionCategory] = useState<CollectionCategory>('character');
  const [newCollectionRolesText, setNewCollectionRolesText] = useState('');
  const [editingCollection, setEditingCollection] = useState(false);
  const [editCollectionName, setEditCollectionName] = useState('');
  const [editCollectionDescription, setEditCollectionDescription] = useState('');
  const [editCollectionCategory, setEditCollectionCategory] = useState<CollectionCategory>('character');
  const [editCollectionRolesText, setEditCollectionRolesText] = useState('');
  const [collectionTemplates, setCollectionTemplates] = useState<CollectionTemplate[]>(COLLECTION_TEMPLATES);
  const [assetRole, setAssetRole] = useState('');
  const [collectionRoleFilter, setCollectionRoleFilter] = useState('all');
  const [selectedUngroupedAssetIds, setSelectedUngroupedAssetIds] = useState<string[]>([]);
  const [selectedCollectionAssetIds, setSelectedCollectionAssetIds] = useState<string[]>([]);
  const { openPreview } = useImagePreviewStore();

  const selectedCollection = collections.find((collection) => collection.id === selectedId) || collections[0] || null;
  const selectedRoles = useMemo(
    () => selectedCollection ? getSuggestedRoles(selectedCollection, collectionTemplates) : [],
    [collectionTemplates, selectedCollection]
  );

  const filteredCollections = useMemo(() => {
    return listAssetCollectionsForLibrary(collections, { search, templates: collectionTemplates });
  }, [collectionTemplates, collections, search]);

  const recentUngroupedAssets = useMemo(() => {
    return listUngroupedLibraryAssets(collections, assets, { search, limit: 48 });
  }, [assets, collections, search]);
  const selectedUngroupedAssetIdSet = useMemo(() => new Set(selectedUngroupedAssetIds), [selectedUngroupedAssetIds]);
  const visibleUngroupedAssetIds = useMemo(() => recentUngroupedAssets.map((asset) => asset.id), [recentUngroupedAssets]);
  const allVisibleUngroupedSelected = visibleUngroupedAssetIds.length > 0
    && visibleUngroupedAssetIds.every((assetId) => selectedUngroupedAssetIdSet.has(assetId));
  const assetSummary = formatAssetLibraryPageSummary(
    recentUngroupedAssets.length,
    assets.length,
    assetTotal,
    search
  );
  const hasMoreAssets = assets.length < assetTotal;
  const hasMoreCollections = collections.length < collectionTotal;

  const filteredCollectionAssets = useMemo(() => {
    return selectedCollection
      ? listCollectionLibraryAssets(selectedCollection.assets, { search, role: collectionRoleFilter })
      : [];
  }, [collectionRoleFilter, search, selectedCollection]);
  const selectedCollectionAssetIdSet = useMemo(() => new Set(selectedCollectionAssetIds), [selectedCollectionAssetIds]);
  const visibleCollectionAssetIds = useMemo(() => filteredCollectionAssets.map((asset) => asset.id), [filteredCollectionAssets]);
  const allVisibleCollectionSelected = visibleCollectionAssetIds.length > 0
    && visibleCollectionAssetIds.every((assetId) => selectedCollectionAssetIdSet.has(assetId));

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const assetLimit = Math.max(ASSET_PAGE_SIZE, assets.length || ASSET_PAGE_SIZE);
      const collectionSearch = search.trim();
      const [collectionData, assetData, templateData] = await Promise.all([
        proxyListAssetCollections({
          limit: COLLECTION_PAGE_SIZE,
          offset: 0,
          search: collectionSearch || undefined,
        }),
        proxyListAssets({ limit: assetLimit, offset: 0 }),
        proxyListAssetCollectionTemplates().catch(() => ({ templates: COLLECTION_TEMPLATES, count: COLLECTION_TEMPLATES.length })),
      ]);
      setCollections(collectionData.collections);
      setCollectionTotal(collectionData.total ?? collectionData.count);
      setAssets(assetData.assets);
      setAssetTotal(assetData.total ?? assetData.count);
      setCollectionTemplates(templateData.templates.length > 0 ? templateData.templates : COLLECTION_TEMPLATES);
      setSelectedId((current) => current || collectionData.collections[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '素材库加载失败');
    } finally {
      setLoading(false);
    }
  }, [assets.length, search]);

  const loadMoreCollections = useCallback(async () => {
    setLoadingMoreCollections(true);
    setError('');
    try {
      const collectionSearch = search.trim();
      const collectionData = await proxyListAssetCollections({
        limit: COLLECTION_PAGE_SIZE,
        offset: collections.length,
        search: collectionSearch || undefined,
      });
      setCollections((current) => {
        const seen = new Set(current.map((collection) => collection.id));
        return [
          ...current,
          ...collectionData.collections.filter((collection) => !seen.has(collection.id)),
        ];
      });
      setCollectionTotal(collectionData.total ?? collectionData.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '素材集合加载失败');
    } finally {
      setLoadingMoreCollections(false);
    }
  }, [collections.length, search]);

  const loadMoreAssets = useCallback(async () => {
    setLoadingMoreAssets(true);
    setError('');
    try {
      const assetData = await proxyListAssets({ limit: ASSET_PAGE_SIZE, offset: assets.length });
      setAssets((current) => mergeLibraryAssetPages(current, assetData.assets));
      setAssetTotal(assetData.total ?? assetData.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '素材库加载失败');
    } finally {
      setLoadingMoreAssets(false);
    }
  }, [assets.length]);

  useEffect(() => {
    if (!isOpen) return;
    void loadLibrary();
  }, [isOpen, loadLibrary]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 1600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const visibleIds = new Set(visibleUngroupedAssetIds);
    setSelectedUngroupedAssetIds((current) => current.filter((assetId) => visibleIds.has(assetId)));
  }, [visibleUngroupedAssetIds]);

  useEffect(() => {
    const visibleIds = new Set(visibleCollectionAssetIds);
    setSelectedCollectionAssetIds((current) => current.filter((assetId) => visibleIds.has(assetId)));
  }, [visibleCollectionAssetIds]);

  useEffect(() => {
    if (!selectedCollection) {
      setEditingCollection(false);
      return;
    }

    setEditCollectionName(selectedCollection.name);
    setEditCollectionDescription(selectedCollection.description || '');
    setEditCollectionCategory(selectedCollection.category);
    setEditCollectionRolesText(formatSuggestedRolesText(getSuggestedRoles(selectedCollection, collectionTemplates)));
    setEditingCollection(false);
  }, [collectionTemplates, selectedCollection]);

  useEffect(() => {
    if (!selectedCollection) {
      setAssetRole('');
      return;
    }
    const roles = getSuggestedRoles(selectedCollection, collectionTemplates);
    setAssetRole((current) => current && roles.includes(current) ? current : roles[0] || '');
    setCollectionRoleFilter((current) => current === 'all' || roles.includes(current) ? current : 'all');
  }, [collectionTemplates, selectedCollection]);

  const createCollection = async () => {
    const name = newCollectionName.trim();
    const template = templateFor(newCollectionCategory, collectionTemplates);
    const description = newCollectionDescription.trim() || template.description;
    const suggestedRoles = parseSuggestedRolesText(newCollectionRolesText, template.roles);
    if (!name) {
      setError('请输入素材集合名称。');
      return;
    }

    setError('');
    const { collection } = await proxyCreateAssetCollection({
      name,
      description,
      category: newCollectionCategory,
      metadata: {
        template: newCollectionCategory,
        suggestedRoles,
      },
    });
    await loadLibrary();
    setSelectedId(collection.id);
    setNewCollectionName('');
    setNewCollectionDescription('');
    setNewCollectionCategory('character');
    setNewCollectionRolesText('');
    setShowCreateForm(false);
    setNotice('已创建素材集合');
  };

  const saveCollectionEdits = async () => {
    if (!selectedCollection) return;
    const name = editCollectionName.trim();
    if (!name) {
      setError('请输入素材集合名称。');
      return;
    }

    const template = templateFor(editCollectionCategory, collectionTemplates);
    const suggestedRoles = parseSuggestedRolesText(editCollectionRolesText, template.roles);
    setError('');
    const { collection } = await proxyUpdateAssetCollection(selectedCollection.id, {
      name,
      description: editCollectionDescription.trim() || template.description,
      category: editCollectionCategory,
      metadata: {
        ...(selectedCollection.metadata || {}),
        template: editCollectionCategory,
        suggestedRoles,
      },
    });
    await loadLibrary();
    setSelectedId(collection.id);
    setEditingCollection(false);
    setNotice('已更新素材集合');
  };

  const deleteSelectedCollection = async () => {
    if (!selectedCollection) return;
    const confirmed = window.confirm(`删除「${selectedCollection.name}」？集合会被移除，素材文件本身不会删除。`);
    if (!confirmed) return;

    setError('');
    await proxyDeleteAssetCollection(selectedCollection.id);
    setSelectedId('');
    await loadLibrary();
    setNotice('已删除素材集合');
  };

  const addAssetToCurrentCollection = async (asset: ProxyAsset) => {
    if (!selectedCollection) return;
    await proxyAddAssetToCollection(selectedCollection.id, { assetId: asset.id, role: assetRole || undefined });
    await loadLibrary();
    setNotice('已加入当前集合');
  };

  const toggleUngroupedAssetSelection = (assetId: string) => {
    setSelectedUngroupedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((item) => item !== assetId)
        : [...current, assetId]
    );
  };

  const selectVisibleUngroupedAssets = () => {
    setSelectedUngroupedAssetIds((current) => [...new Set([...current, ...visibleUngroupedAssetIds])]);
  };

  const clearUngroupedAssetSelection = () => {
    setSelectedUngroupedAssetIds([]);
  };

  const addSelectedAssetsToCurrentCollection = async () => {
    if (!selectedCollection || selectedUngroupedAssetIds.length === 0) return;

    setError('');
    try {
      const { added, skipped } = await proxyAddAssetsToCollection(selectedCollection.id, {
        assetIds: selectedUngroupedAssetIds,
        role: assetRole || undefined,
      });
      await loadLibrary();
      clearUngroupedAssetSelection();
      setNotice(skipped > 0 ? `已加入 ${added} 个素材，跳过 ${skipped} 个` : `已加入 ${added} 个素材`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量加入素材失败');
    }
  };

  const toggleCollectionAssetSelection = (assetId: string) => {
    setSelectedCollectionAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((item) => item !== assetId)
        : [...current, assetId]
    );
  };

  const selectVisibleCollectionAssets = () => {
    setSelectedCollectionAssetIds((current) => [...new Set([...current, ...visibleCollectionAssetIds])]);
  };

  const clearCollectionAssetSelection = () => {
    setSelectedCollectionAssetIds([]);
  };

  const removeSelectedAssetsFromCollection = async () => {
    if (!selectedCollection || selectedCollectionAssetIds.length === 0) return;
    const confirmed = window.confirm(`从集合移出选中的 ${selectedCollectionAssetIds.length} 个素材？素材文件本身不会被删除。`);
    if (!confirmed) return;

    setError('');
    try {
      const { removed, skipped } = await proxyRemoveAssetsFromCollection(selectedCollection.id, {
        assetIds: selectedCollectionAssetIds,
      });
      await loadLibrary();
      clearCollectionAssetSelection();
      setNotice(skipped > 0 ? `已移出 ${removed} 个素材，跳过 ${skipped} 个` : `已移出 ${removed} 个素材`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量移出素材失败');
    }
  };

  const setCollectionCover = async (asset: ProxyAsset) => {
    if (!selectedCollection) return;
    setError('');
    try {
      const { collection } = await proxyUpdateAssetCollection(selectedCollection.id, {
        coverAssetId: asset.id,
      });
      await loadLibrary();
      setSelectedId(collection.id);
      setNotice('已设为集合封面');
    } catch (err) {
      setError(err instanceof Error ? err.message : '设置封面失败');
    }
  };

  const moveCollectionAsset = async (asset: ProxyAsset, direction: 'up' | 'down') => {
    if (!selectedCollection) return;
    const currentIds = selectedCollection.assets.map((item) => item.id);
    const index = currentIds.indexOf(asset.id);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= currentIds.length) return;

    const nextIds = [...currentIds];
    [nextIds[index], nextIds[targetIndex]] = [nextIds[targetIndex], nextIds[index]];

    setError('');
    try {
      const { collection } = await proxyReorderAssetCollectionItems(selectedCollection.id, {
        assetIds: nextIds,
      });
      await loadLibrary();
      setSelectedId(collection.id);
      setNotice(direction === 'up' ? '已上移素材' : '已下移素材');
    } catch (err) {
      setError(err instanceof Error ? err.message : '调整素材顺序失败');
    }
  };

  const previewAsset = (asset: ProxyAsset) => {
    const url = proxyAssetUrl(asset.url);
    if (isImageAsset(asset)) {
      openPreview(url, asset.fileName || asset.prompt || '素材图片');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const renderAssetCard = (
    asset: ProxyAsset,
    options: {
      removable?: boolean;
      addable?: boolean;
      selectable?: boolean;
      collectionSelectable?: boolean;
      coverable?: boolean;
      sortable?: boolean;
    } = {}
  ) => {
    const url = proxyAssetUrl(asset.url);
    const image = isImageAsset(asset);
    const selected = options.collectionSelectable
      ? selectedCollectionAssetIdSet.has(asset.id)
      : options.selectable
        ? selectedUngroupedAssetIdSet.has(asset.id)
        : false;
    const currentCover = selectedCollection?.coverAssetId === asset.id;
    const collectionIndex = selectedCollection?.assets.findIndex((item) => item.id === asset.id) ?? -1;
    const canMoveUp = Boolean(options.sortable && collectionIndex > 0);
    const canMoveDown = Boolean(options.sortable && selectedCollection && collectionIndex >= 0 && collectionIndex < selectedCollection.assets.length - 1);
    return (
      <div
        key={asset.id}
        className={cn(
          'overflow-hidden rounded-lg border border-panel-border bg-[#151a20]',
          selected && 'border-accent ring-1 ring-accent/70'
        )}
      >
        <div className="relative">
          <button
            className="flex aspect-square w-full items-center justify-center bg-[#0c0f12]"
            onClick={() => previewAsset(asset)}
            title={image ? '预览大图' : '打开视频'}
          >
            {image ? (
              <img src={url} alt={asset.fileName || asset.id} className="h-full w-full object-cover" />
            ) : (
              <FileVideo className="h-8 w-8 text-gray-500" />
            )}
          </button>
          {(options.selectable || options.collectionSelectable) && (
            <button
              type="button"
              onClick={() => {
                if (options.collectionSelectable) {
                  toggleCollectionAssetSelection(asset.id);
                  return;
                }
                toggleUngroupedAssetSelection(asset.id);
              }}
              className={cn(
                'absolute left-2 top-2 rounded-md border px-1.5 py-1 text-[10px] shadow-lg',
                selected
                  ? 'border-accent bg-accent text-white'
                  : 'border-panel-border bg-[#11161c] text-gray-200 hover:border-accent hover:text-accent'
              )}
              title={selected ? '取消选择' : '选择素材'}
            >
              {selected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
        <div className="space-y-1 px-2 py-1.5">
          <div className="truncate text-[10px] text-gray-400" title={asset.fileName || asset.prompt || asset.id}>
            {asset.fileName || asset.prompt || asset.id}
          </div>
          {asset.libraryRole && (
            <div className="inline-flex rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent">
              {asset.libraryRole}
            </div>
          )}
          <div className="flex items-center gap-1">
            <AssetIconButton
              title="复制 URL"
              onClick={async () => {
                await copyText(url);
                setNotice('已复制 URL');
              }}
            >
              <Copy className="h-3 w-3" />
            </AssetIconButton>
            <AssetIconButton title={image ? '预览' : '打开'} onClick={() => previewAsset(asset)}>
              <ExternalLink className="h-3 w-3" />
            </AssetIconButton>
            {asset.filePath && (
              <AssetIconButton
                title="打开文件位置"
                onClick={async () => {
                  await proxyOpenAssetLocation(asset.id);
                  setNotice('已打开位置');
                }}
              >
                <FolderOpen className="h-3 w-3" />
              </AssetIconButton>
            )}
            {options.removable && selectedCollection && (
              <>
                {options.sortable && (
                  <>
                    <AssetIconButton
                      title={canMoveUp ? '上移' : '已经是第一项'}
                      className="text-gray-400 hover:bg-gray-700/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                      disabled={!canMoveUp}
                      onClick={() => void moveCollectionAsset(asset, 'up')}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </AssetIconButton>
                    <AssetIconButton
                      title={canMoveDown ? '下移' : '已经是最后一项'}
                      className="text-gray-400 hover:bg-gray-700/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                      disabled={!canMoveDown}
                      onClick={() => void moveCollectionAsset(asset, 'down')}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </AssetIconButton>
                  </>
                )}
                {options.coverable && image && (
                  <AssetIconButton
                    title={currentCover ? '当前封面' : '设为封面'}
                    className={cn(
                      currentCover
                        ? 'text-amber-300 hover:bg-amber-500/10'
                        : 'text-gray-400 hover:bg-amber-500/10 hover:text-amber-300'
                    )}
                    onClick={() => void setCollectionCover(asset)}
                  >
                    <Star className={cn('h-3 w-3', currentCover && 'fill-current')} />
                  </AssetIconButton>
                )}
              </>
            )}
            {options.removable && selectedCollection && (
              <AssetIconButton
                className="ml-auto text-red-300 hover:bg-red-500/10"
                title="从集合移除"
                onClick={async () => {
                  await proxyRemoveAssetFromCollection(selectedCollection.id, asset.id);
                  await loadLibrary();
                  setNotice('已移出集合');
                }}
              >
                <Trash2 className="h-3 w-3" />
              </AssetIconButton>
            )}
            {options.addable && selectedCollection && (
              <AssetIconButton className="ml-auto text-emerald-300 hover:bg-emerald-500/10" title="加入当前集合" onClick={() => void addAssetToCurrentCollection(asset)}>
                <Plus className="h-3 w-3" />
              </AssetIconButton>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <FloatingWindow contentClassName="h-[78vh] w-[980px]">
        <div className="floating-window-sidebar w-[260px]">
        <div className="floating-window-header">
          <div className="text-sm font-medium text-white">素材库</div>
          <span className="rounded bg-panel-bg px-1.5 py-0.5 text-[10px] text-gray-500">{assetSummary}</span>
          {notice && <span className="truncate text-[10px] text-emerald-300">{notice}</span>}
          <button onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-700/50 hover:text-white" title="关闭">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="border-b border-panel-border p-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索集合、素材、prompt..."
            className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button onClick={() => setShowCreateForm((value) => !value)} className="flex flex-1 items-center justify-center gap-1 rounded-md bg-accent px-2 py-1.5 text-xs text-white hover:bg-accent-hover">
              <Plus className="h-3.5 w-3.5" />
              新建集合
            </button>
            <button onClick={() => void loadLibrary()} className="rounded-md border border-panel-border px-2 text-gray-300 hover:bg-gray-700/50" title="刷新">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>

          {showCreateForm && (
            <div className="mt-3 space-y-2 rounded-lg border border-panel-border bg-panel-bg p-2.5">
              <div className="text-[11px] font-medium text-gray-300">新建素材集合</div>
              <div className="grid grid-cols-2 gap-1.5">
                {collectionTemplates.map((template) => (
                  <button
                    key={template.category}
                    type="button"
                    onClick={() => {
                      setNewCollectionCategory(template.category);
                      if (!newCollectionDescription.trim()) setNewCollectionDescription(template.description);
                      if (!newCollectionRolesText.trim()) setNewCollectionRolesText(formatSuggestedRolesText(template.roles));
                    }}
                    className={cn(
                      'rounded-md border px-2 py-1.5 text-left text-[10px] transition-colors',
                      newCollectionCategory === template.category
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-panel-border bg-canvas-bg text-gray-400 hover:border-gray-600 hover:text-white'
                    )}
                  >
                    <div className="font-medium">{template.label}</div>
                    <div className="mt-0.5 line-clamp-1 text-gray-500">{template.roles.slice(0, 3).join(' / ')}</div>
                  </button>
                ))}
              </div>
              <input
                value={newCollectionName}
                onChange={(event) => setNewCollectionName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createCollection();
                }}
                placeholder={templateFor(newCollectionCategory, collectionTemplates).placeholder}
                className="w-full rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
                autoFocus
              />
              <textarea
                value={newCollectionDescription}
                onChange={(event) => setNewCollectionDescription(event.target.value)}
                placeholder="可选：说明这个集合的用途。"
                className="h-16 w-full resize-none rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
              />
              <textarea
                value={newCollectionRolesText}
                onChange={(event) => setNewCollectionRolesText(event.target.value)}
                placeholder={`素材角色，每行一个。留空使用模板：${templateFor(newCollectionCategory, collectionTemplates).roles.slice(0, 4).join('、')}`}
                className="h-20 w-full resize-none rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewCollectionName('');
                    setNewCollectionDescription('');
                    setNewCollectionCategory('character');
                    setNewCollectionRolesText('');
                  }}
                  className="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-700/50 hover:text-white"
                >
                  取消
                </button>
                <button onClick={() => void createCollection()} className="rounded-md bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-hover">
                  创建
                </button>
              </div>
            </div>
          )}
        </div>

        {error && <div className="border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        <div className="flex-1 space-y-2 overflow-auto p-3">
          {filteredCollections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-panel-border p-4 text-center text-xs text-gray-500">
              {search.trim() ? '没有匹配的素材集合。' : '还没有素材集合。'}
            </div>
          ) : (
            <>
              {filteredCollections.map((collection) => {
                const cover = coverFor(collection);
                const active = selectedCollection?.id === collection.id;
                return (
                  <button
                    key={collection.id}
                    onClick={() => setSelectedId(collection.id)}
                    className={cn('flex w-full gap-2 rounded-lg border p-2 text-left transition-colors', active ? 'border-accent bg-accent/10' : 'border-panel-border bg-panel-bg hover:border-gray-600')}
                  >
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md bg-[#0c0f12]">
                      {cover && isImageAsset(cover) ? (
                        <img src={proxyAssetUrl(cover.url)} alt={collection.name} className="h-full w-full object-cover" />
                      ) : (
                        <ImagePlus className="h-6 w-6 text-gray-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-white">{collection.name}</div>
                      <div className="mt-0.5 truncate text-[10px] text-gray-500">
                        {categoryLabel(collection.category, collectionTemplates)} / {collection.description || collection.category}
                      </div>
                      <div className="mt-1 text-[10px] text-gray-500">{collection.assets.length} 个素材</div>
                    </div>
                  </button>
                );
              })}
              <div className="space-y-2 pt-1">
                <div className="text-center text-[10px] text-gray-600">
                  已加载 {Math.min(collections.length, collectionTotal)}/{collectionTotal || collections.length} 个集合
                </div>
                {hasMoreCollections && (
                  <button
                    onClick={() => void loadMoreCollections()}
                    disabled={loadingMoreCollections}
                    className="w-full rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingMoreCollections ? '加载中...' : '加载更多集合'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

        <div className="floating-window-content">
        <div className="border-b border-panel-border px-4 py-3">
          {selectedCollection && editingCollection ? (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_150px] gap-2">
                <input
                  value={editCollectionName}
                  onChange={(event) => setEditCollectionName(event.target.value)}
                  placeholder="集合名称"
                  className="rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-sm text-white placeholder-gray-600 focus:border-accent focus:outline-none"
                />
                <select
                  value={editCollectionCategory}
                  onChange={(event) => setEditCollectionCategory(event.target.value)}
                  className="rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                >
                  {collectionTemplates.map((template) => (
                    <option key={template.category} value={template.category}>{template.label}</option>
                  ))}
                </select>
              </div>
              <textarea
                value={editCollectionDescription}
                onChange={(event) => setEditCollectionDescription(event.target.value)}
                placeholder="说明这个集合的用途"
                className="h-16 w-full resize-none rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
              />
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500">素材角色，每行一个</span>
                  <button
                    type="button"
                    onClick={() => setEditCollectionRolesText(formatSuggestedRolesText(templateFor(editCollectionCategory, collectionTemplates).roles))}
                    className="rounded-md px-2 py-0.5 text-[10px] text-gray-400 hover:bg-gray-700/50 hover:text-white"
                  >
                    使用模板角色
                  </button>
                </div>
                <textarea
                  value={editCollectionRolesText}
                  onChange={(event) => setEditCollectionRolesText(event.target.value)}
                  placeholder="例如：三视图、正面、侧面、背面、脸部特写"
                  className="h-20 w-full resize-none rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setEditingCollection(false);
                    setEditCollectionName(selectedCollection.name);
                    setEditCollectionDescription(selectedCollection.description || '');
                    setEditCollectionCategory(selectedCollection.category);
                    setEditCollectionRolesText(formatSuggestedRolesText(getSuggestedRoles(selectedCollection, collectionTemplates)));
                  }}
                  className="rounded-md px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-700/50 hover:text-white"
                >
                  取消
                </button>
                <button onClick={() => void saveCollectionEdits()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-hover">
                  <Save className="h-3 w-3" />
                  保存
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-white">{selectedCollection?.name || '选择素材集合'}</div>
                {selectedCollection && (
                  <span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] text-accent">{categoryLabel(selectedCollection.category, collectionTemplates)}</span>
                )}
                {selectedCollection && (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => setEditingCollection(true)}
                      className="inline-flex items-center gap-1 rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent"
                    >
                      <Pencil className="h-3 w-3" />
                      编辑
                    </button>
                    <button
                      onClick={() => void deleteSelectedCollection()}
                      className="inline-flex items-center gap-1 rounded-md border border-red-500/20 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {selectedCollection?.description || '把三视图、脸部特写、服装参考等图片放进同一个集合，后续可以跨项目复用。'}
              </div>
              {selectedCollection && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedRoles.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setAssetRole(role)}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                        assetRole === role
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-panel-border bg-canvas-bg text-gray-400 hover:border-gray-600 hover:text-white'
                      )}
                      title="点击后会作为加入集合时的素材角色"
                    >
                      {role}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {selectedCollection ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-xs font-medium text-gray-400">集合素材</h4>
                <div className="flex items-center gap-2">
                  {filteredCollectionAssets.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={allVisibleCollectionSelected ? clearCollectionAssetSelection : selectVisibleCollectionAssets}
                        className="rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent"
                      >
                        {allVisibleCollectionSelected ? '清空选择' : '全选当前'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeSelectedAssetsFromCollection()}
                        disabled={selectedCollectionAssetIds.length === 0}
                        className="rounded-md border border-red-500/20 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        批量移出{selectedCollectionAssetIds.length > 0 ? ` ${selectedCollectionAssetIds.length}` : ''}
                      </button>
                    </>
                  )}
                  {selectedRoles.length > 0 && (
                    <select
                      value={collectionRoleFilter}
                      onChange={(event) => setCollectionRoleFilter(event.target.value)}
                      className="rounded-md border border-panel-border bg-panel-bg px-2 py-1 text-[10px] text-gray-300 focus:border-accent focus:outline-none"
                    >
                      <option value="all">全部角色</option>
                      {selectedRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  )}
                  <span className="text-[10px] text-gray-500">{filteredCollectionAssets.length}/{selectedCollection.assets.length} 项</span>
                </div>
              </div>
              {selectedCollection.assets.length > 0 && filteredCollectionAssets.length > 0 ? (
                <div className="grid grid-cols-4 gap-3">
                  {filteredCollectionAssets.map((asset) => renderAssetCard(asset, {
                    collectionSelectable: true,
                    coverable: true,
                    removable: true,
                    sortable: true,
                  }))}
                </div>
              ) : selectedCollection.assets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-panel-border p-8 text-center text-xs text-gray-500">
                  这个集合还没有素材。可以从任务历史里把生成图加入素材库。
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-panel-border p-8 text-center text-xs text-gray-500">
                  没有匹配的集合素材。可以换个搜索词或切回全部角色。
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-panel-border p-8 text-center text-xs text-gray-500">先新建或选择一个素材集合。</div>
          )}

          {recentUngroupedAssets.length > 0 && (
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-xs font-medium text-gray-400">{search.trim() ? '匹配的未分组资产' : '最近未分组资产'}</h4>
                <div className="flex items-center gap-2">
                  {selectedCollection && (
                    <>
                      <button
                        type="button"
                        onClick={allVisibleUngroupedSelected ? clearUngroupedAssetSelection : selectVisibleUngroupedAssets}
                        className="rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent"
                      >
                        {allVisibleUngroupedSelected ? '清空选择' : '全选当前'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void addSelectedAssetsToCurrentCollection()}
                        disabled={selectedUngroupedAssetIds.length === 0}
                        className="rounded-md bg-accent px-2 py-1 text-[10px] text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        批量加入{selectedUngroupedAssetIds.length > 0 ? ` ${selectedUngroupedAssetIds.length}` : ''}
                      </button>
                    </>
                  )}
                  {selectedCollection && selectedRoles.length > 0 && (
                    <>
                      <span className="text-[10px] text-gray-500">加入为</span>
                      <select
                        value={assetRole}
                        onChange={(event) => setAssetRole(event.target.value)}
                        className="rounded-md border border-panel-border bg-panel-bg px-2 py-1 text-[10px] text-gray-300 focus:border-accent focus:outline-none"
                      >
                        {selectedRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                    </>
                  )}
                  <span className="text-[10px] text-gray-500">加入集合后会从这里移除</span>
                  {hasMoreAssets && <span className="text-[10px] text-gray-600">还有更多素材可加载</span>}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {recentUngroupedAssets.map((asset) => renderAssetCard(asset, { addable: true, selectable: true }))}
              </div>
            </div>
          )}
          {hasMoreAssets && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => void loadMoreAssets()}
                disabled={loadingMoreAssets}
                className="rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMoreAssets ? '加载中...' : '加载更多素材'}
              </button>
            </div>
          )}
        </div>
        </div>
    </FloatingWindow>
  );
}

function AssetIconButton({
  children,
  title,
  onClick,
  className,
  disabled = false,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={cn('rounded p-1 text-gray-400 hover:bg-gray-700/60 hover:text-white', className)}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
