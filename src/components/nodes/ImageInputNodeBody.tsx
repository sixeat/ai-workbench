import { useEffect, useMemo, useState } from 'react';
import { ImagePlus, Loader2, Search, Upload } from 'lucide-react';
import { proxyAssetUrl, type ProxyAsset, type ProxyAssetCollection } from '../../lib/apiProxy';
import {
  UNGROUPED_IMAGE_COLLECTION_ID,
  buildSelectableImageAssetItems,
  listImageAssetRoles,
  listImageCollectionCategories,
} from '../../lib/imageAssetSelection';
import { cn } from '../../lib/utils';
import { DarkSelect } from '../ui/DarkSelect';

interface ImageInputNodeBodyProps {
  url?: string;
  fileName?: string;
  libraryAssets: ProxyAsset[];
  libraryCollections: ProxyAssetCollection[];
  libraryLoading: boolean;
  libraryError: string;
  libraryHasMore: boolean;
  libraryLoadingMore: boolean;
  libraryLoadedCount: number;
  libraryTotal: number;
  showLibraryPicker: boolean;
  uploadError: string;
  uploadingImage: boolean;
  onUrlChange: (value: string) => void;
  onUploadImage: (file: File | null) => void;
  onOpenLibraryPicker: () => void;
  onCloseLibraryPicker: () => void;
  onLoadMoreLibraryAssets: () => void;
  onSelectLibraryAsset: (asset: ProxyAsset) => void;
  onOpenPreview: () => void;
  onRemoveImage: () => void;
}

export function ImageInputNodeBody({
  url,
  fileName,
  libraryAssets,
  libraryCollections,
  libraryLoading,
  libraryError,
  libraryHasMore,
  libraryLoadingMore,
  libraryLoadedCount,
  libraryTotal,
  showLibraryPicker,
  uploadError,
  uploadingImage,
  onUploadImage,
  onOpenLibraryPicker,
  onCloseLibraryPicker,
  onLoadMoreLibraryAssets,
  onSelectLibraryAsset,
  onOpenPreview,
  onRemoveImage,
}: ImageInputNodeBodyProps) {
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryCategory, setLibraryCategory] = useState('all');
  const [libraryCollectionId, setLibraryCollectionId] = useState('all');
  const [libraryRole, setLibraryRole] = useState('all');

  const categoryOptions = useMemo(
    () => listImageCollectionCategories(libraryCollections),
    [libraryCollections]
  );

  const libraryOptions = useMemo(
    () => libraryCollections.filter((collection) => (
      collection.assets.length > 0 &&
      (libraryCategory === 'all' || collection.category === libraryCategory)
    )),
    [libraryCategory, libraryCollections]
  );

  const roleSourceItems = useMemo(
    () => buildSelectableImageAssetItems(libraryCollections, libraryAssets, {
      category: libraryCategory,
      collectionId: libraryCollectionId,
      search: librarySearch,
    }),
    [libraryAssets, libraryCategory, libraryCollectionId, libraryCollections, librarySearch]
  );

  const roleOptions = useMemo(
    () => listImageAssetRoles(roleSourceItems),
    [roleSourceItems]
  );

  const libraryItems = useMemo(
    () => buildSelectableImageAssetItems(libraryCollections, libraryAssets, {
      category: libraryCategory,
      collectionId: libraryCollectionId,
      role: libraryRole,
      search: librarySearch,
    }),
    [libraryAssets, libraryCategory, libraryCollectionId, libraryCollections, libraryRole, librarySearch]
  );

  useEffect(() => {
    if (libraryCollectionId === 'all') return;
    if (libraryCollectionId === UNGROUPED_IMAGE_COLLECTION_ID) {
      if (libraryCategory !== 'all' || libraryRole !== 'all') setLibraryCollectionId('all');
      return;
    }
    const selected = libraryCollections.find((collection) => collection.id === libraryCollectionId);
    if (selected && libraryCategory !== 'all' && selected.category !== libraryCategory) {
      setLibraryCollectionId('all');
    }
  }, [libraryCategory, libraryCollectionId, libraryCollections, libraryRole]);

  useEffect(() => {
    if (libraryRole === 'all') return;
    if (!roleOptions.includes(libraryRole)) setLibraryRole('all');
  }, [libraryRole, roleOptions]);

  return (
    <div className="mb-2 space-y-2 rounded-lg border border-gray-700/40 bg-gray-900/30 p-2">
      {url ? (
        <div className="group/image relative overflow-hidden rounded-md border border-panel-border bg-black/20">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpenPreview();
            }}
            className="block w-full"
            title="预览大图"
          >
            <img
              src={proxyAssetUrl(url)}
              alt={fileName || '参考图'}
              className="h-[260px] w-full object-contain"
              onError={(event) => {
                (event.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onRemoveImage();
            }}
            className="absolute right-2 top-2 rounded-full border border-white/10 bg-black/70 px-2 py-1 text-[10px] text-white opacity-0 shadow-lg backdrop-blur transition-opacity hover:bg-red-500/80 group-hover/image:opacity-100"
          >
            移除
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-dashed border-gray-700 bg-black/20 p-4 text-center">
            <ImagePlus className="mx-auto mb-2 h-7 w-7 text-gray-500" />
            <div className="text-[11px] text-gray-300">选择一张参考图</div>
            <div className="mt-1 text-[10px] leading-4 text-gray-500">
              可以从素材库复用角色、产品、场景图，也可以上传新图片。
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenLibraryPicker();
              }}
              className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-600 px-2.5 py-2 text-[10px] text-gray-300 transition-colors hover:border-accent hover:text-white"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              从素材库选择
            </button>
            <label
              onClick={(event) => event.stopPropagation()}
              className={cn(
                'flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-600 px-2.5 py-2 text-[10px] text-gray-300 transition-colors hover:border-accent hover:text-white',
                uploadingImage && 'pointer-events-none opacity-60'
              )}
            >
              {uploadingImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploadingImage ? '上传中...' : '上传图片'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  onUploadImage(event.target.files?.[0] || null);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
        </>
      )}

      {!url && showLibraryPicker && (
        <div
          onClick={(event) => event.stopPropagation()}
          className="rounded-lg border border-panel-border bg-panel-bg p-2 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-gray-300">选择素材库图片</span>
            <div className="flex items-center gap-2">
              {libraryTotal > 0 && (
                <span className="text-[10px] text-gray-600">
                  已加载 {Math.min(libraryLoadedCount, libraryTotal)}/{libraryTotal}
                </span>
              )}
              <button onClick={onCloseLibraryPicker} className="text-[10px] text-gray-500 hover:text-white">关闭</button>
            </div>
          </div>
          <div className="mb-2 grid grid-cols-[1fr_112px] gap-2">
            <label className="relative block">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-600" />
              <input
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="搜索集合、角色、文件名..."
                className="w-full rounded-md border border-panel-border bg-canvas-bg py-1.5 pl-7 pr-2 text-[10px] text-gray-200 placeholder-gray-600 focus:border-accent focus:outline-none"
              />
            </label>
            <DarkSelect
              value={libraryCategory}
              onChange={setLibraryCategory}
              buttonClassName="px-2 py-1.5 text-[10px]"
              title="按素材类型筛选"
              options={[
                { label: '全部类型', value: 'all' },
                ...categoryOptions.map((category) => ({ label: category.label, value: category.id })),
              ]}
            />
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <DarkSelect
              value={libraryCollectionId}
              onChange={setLibraryCollectionId}
              buttonClassName="px-2 py-1.5 text-[10px]"
              title="按集合筛选"
              options={[
                { label: '全部图片', value: 'all' },
                ...(libraryCategory === 'all' && libraryRole === 'all'
                  ? [{ label: '未分组', value: UNGROUPED_IMAGE_COLLECTION_ID }]
                  : []),
                ...libraryOptions.map((collection) => ({ label: collection.name, value: collection.id })),
              ]}
            />
            <DarkSelect
              value={libraryRole}
              onChange={setLibraryRole}
              buttonClassName="px-2 py-1.5 text-[10px]"
              title="按素材角色筛选"
              options={[
                { label: '全部角色', value: 'all' },
                ...roleOptions.map((role) => ({ label: role, value: role })),
              ]}
            />
          </div>
          {libraryLoading ? (
            <div className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-panel-border py-5 text-[10px] text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              加载素材库...
            </div>
          ) : libraryError ? (
            <div className="rounded-md bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300">{libraryError}</div>
          ) : libraryItems.length === 0 ? (
            <div className="space-y-2">
              <div className="rounded-md border border-dashed border-panel-border px-2 py-5 text-center text-[10px] text-gray-500">
                没有匹配的图片。你可以换个关键词，或先从任务历史把生成图加入素材库。
              </div>
              {libraryHasMore && (
                <button
                  type="button"
                  onClick={onLoadMoreLibraryAssets}
                  disabled={libraryLoadingMore}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-panel-border px-2 py-1.5 text-[10px] text-gray-300 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {libraryLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {libraryLoadingMore ? '加载中...' : '继续加载更多素材'}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid max-h-56 grid-cols-3 gap-2 overflow-auto pr-1">
                {libraryItems.map(({ asset, collectionName, collectionCategory, grouped }) => (
                  <button
                    key={`${asset.id}-${collectionName}`}
                    type="button"
                    onClick={() => onSelectLibraryAsset(asset)}
                    className="overflow-hidden rounded-md border border-panel-border bg-black/20 text-left transition-colors hover:border-accent"
                    title={`${collectionName} / ${asset.fileName || asset.prompt || asset.id}`}
                  >
                    <img src={proxyAssetUrl(asset.url)} alt={asset.fileName || asset.id} className="aspect-square w-full object-cover" />
                    <div className="space-y-0.5 px-1.5 py-1">
                      <div className="truncate text-[9px] text-gray-300">{asset.fileName || asset.prompt || asset.id}</div>
                      <div className="truncate text-[9px] text-gray-600">{collectionCategory} / {collectionName}</div>
                      {asset.libraryRole && <div className="truncate text-[9px] text-accent">{asset.libraryRole}</div>}
                      {!grouped && <div className="truncate text-[9px] text-amber-300">未加入集合</div>}
                    </div>
                  </button>
                ))}
              </div>
              {libraryHasMore && (
                <button
                  type="button"
                  onClick={onLoadMoreLibraryAssets}
                  disabled={libraryLoadingMore}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-panel-border px-2 py-1.5 text-[10px] text-gray-300 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {libraryLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {libraryLoadingMore ? '加载中...' : '加载更多素材'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {uploadError && <div className="text-[10px] text-red-400">{uploadError}</div>}
    </div>
  );
}
