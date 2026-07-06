const ASSET_COLLECTION_TEMPLATES = [
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

function listAssetCollectionTemplates() {
  return ASSET_COLLECTION_TEMPLATES.map((template) => ({
    ...template,
    roles: [...template.roles],
  }));
}

function templateForAssetCollection(category = 'general') {
  return ASSET_COLLECTION_TEMPLATES.find((template) => template.category === category) ||
    ASSET_COLLECTION_TEMPLATES.find((template) => template.category === 'general');
}

function collectionMetadataForTemplate(category, metadata = {}) {
  const template = templateForAssetCollection(category);
  return {
    template: template.category,
    suggestedRoles: [...template.roles],
    ...metadata,
  };
}

module.exports = {
  ASSET_COLLECTION_TEMPLATES,
  collectionMetadataForTemplate,
  listAssetCollectionTemplates,
  templateForAssetCollection,
};
