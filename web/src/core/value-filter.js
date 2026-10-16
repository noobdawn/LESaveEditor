import LZString from 'lz-string';
import catalog from '../data/filter-catalog.json' with { type: 'json' };
import commonAffixes from '../data/filter-common-affixes.json' with { type: 'json' };
import itemCatalog from './game-item-data.json' with { type: 'json' };
import { normalizePlannerBuild } from './planner.js';
import { resolvePlannerItemId } from './items.js';
import { EQUIPMENT_TYPES, FILTER_VERSION, MAX_FILTER_RULES, FilterError, filterLabel } from './loot-filter.js';
import { compileEquipmentScores, EQUIPMENT_SCORE_FALLBACK } from './equipment-score-compiler.js';

export const COMMON_AFFIX_GROUPS = commonAffixes.groups;
export const VALUE_FILTER_DEFAULT_OPTIONS = Object.freeze({ rareUniqueThreshold: 0.9, rareSetThreshold: 0.65 });
// Stored in ascending tier order; the editor presents T7 first. T8 uses the T7 value.
export const VALUE_FILTER_DEFAULT_SCORING = Object.freeze({
  high: Object.freeze([0.4, 0.8, 1.2, 1.6, 2, 5, 10]),
  medium: Object.freeze([0.2, 0.4, 0.6, 0.8, 1, 2, 4]),
  low: Object.freeze([-0.2, -0.2, -0.2, -0.2, 0, 1, 2]),
});
const label = (zh, en) => ({ zh, en });
const group = (id, zh, en, descriptionZh, descriptionEn, color, emphasized = false, show = true) => ({ id, name: label(zh, en), description: label(descriptionZh, descriptionEn), defaults: { show, color, emphasized } });
/** Logical groups are editable independently. Compiled precedence rules may repeat a group. */
export const VALUE_FILTER_GROUPS = Object.freeze([
  group('unique_needed', '需求暗金', 'Needed uniques', '按暗金编号保留，优先于稀有度与潜能。', 'Selected unique identities take precedence over rarity and potential.', 7, true),
  group('idol_double', '双有效词缀神像', 'Two useful idol affixes', '同形状的所选需求中，一条前缀和一条后缀同时符合，允许重组。', 'A selected prefix and suffix of the same shape; selected pairs may recombine.', 9, true),
  group('idol_single', '单有效词缀神像', 'One useful idol affix', '符合一个所选词缀，未达到双词缀档。', 'One selected affix without reaching the two-affix group.', 10),
  group('equipment_other_exalted', '其他高阶崇高装备', 'Other high-tier exalted equipment', '未命中有效词缀组，拥有至少一条 T7+ 或两条 T6+。', 'No useful-affix group matched; at least one T7+ or two T6+ affixes.', 11),
  group('unique_rare', '高价值暗金', 'High-value uniques', '随机池稀有度达到门槛，不代表 Boss 掉率或价格。', 'Meets the random-pool rarity threshold; not a boss drop rate or price.', 8, true),
  group('unique_high_lp', '高潜暗金（2–4）', 'High-potential uniques (2–4)', '拥有 2–4 传奇潜能的普通暗金；不包含 Weaver’s Will。', 'Ordinary uniques with 2–4 legendary potential; excludes Weaver’s Will.', 5, true),
  group('set_valuable', '高价值套装', 'Valuable set items', '配装需要、手动选择，或随机池稀有度达到门槛的套装。', 'Needed or selected set items, or sets meeting the random-pool rarity threshold.', 16, true),
  group('unique_common', '一般暗金', 'Other uniques', '其余暗金与传奇装备。', 'Remaining unique and legendary items.', 5),
  group('set_common', '一般套装', 'Other set items', '其余套装装备。', 'Remaining set items.', 17),
  group('equipment_other', '其他装备', 'Other equipment', '未命中以上价值组的普通、魔法、稀有与崇高装备。', 'Remaining normal, magic, rare and exalted equipment.', 1, false, false),
  group('idol_other', '其他神像', 'Other idols', '未命中所选神像词缀的神像。', 'Idols without selected matching affixes.', 1, false, false),
  group('glyph', '雕文', 'Glyphs', '所有雕文。', 'All glyphs.', 14),
  group('rune', '符文', 'Runes', '所有符文。', 'All runes.', 13),
  group('shard', '词缀碎片', 'Affix shards', '所有词缀碎片。', 'All affix shards.', 2),
  group('key', '钥匙与特殊材料', 'Keys and special materials', '游戏 AllKeys 分类，包含钥匙及部分特殊材料。', 'The game’s AllKeys category, including keys and some special materials.', 12, true),
  group('altar', '神像祭坛', 'Idol altars', '祭坛独立保留，不随普通装备兜底隐藏。', 'Altars have their own group, separate from other equipment.', 15),
]);
const BY_GROUP = Object.fromEntries(VALUE_FILTER_GROUPS.map(g => [g.id, g]));
const RENAMABLE_EQUIPMENT_GROUPS = new Set(['equipment_other_exalted', 'equipment_other']);
const GEAR_TYPES = Array.from({ length: 25 }, (_, i) => i);
const IDOL_TYPES = Array.from({ length: 9 }, (_, i) => i + 25);
const ORDINARY_RARITIES = ['NORMAL', 'MAGIC', 'RARE', 'EXALTED'];
const warning = (code, zh, en, sourcePath) => ({ code, message: label(zh, en), ...(sourcePath ? { sourcePath } : {}) });
const fail = (code, zh, en) => { throw new FilterError(code, zh, en); };
const unique = values => [...new Set(values)];
const sorted = values => unique(values).sort((a, b) => a - b);
export const isValueEquipmentAffix = a => !!a && a.specialAffixType !== 7 && a.canRollOn.some(type => GEAR_TYPES.includes(type) || type === 41);
export const isValueIdolAffix = (a, baseTypeId) => !!a && a.specialAffixType !== 7 && [0, 1].includes(a.type) && IDOL_TYPES.includes(Number(baseTypeId)) && a.canRollOn.includes(Number(baseTypeId));
const isGearAffix = isValueEquipmentAffix;
function number(value, min, max, field, integer = false) {
  const result = Number(value);
  if (value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) fail('INVALID_FILTER_VALUE', `无效值：${field}`, `Invalid value: ${field}`);
  return result;
}
function ids(values, dictionary, field) {
  if (!Array.isArray(values)) fail('INVALID_FILTER_SELECTION', `无效选择：${field}`, `Invalid selection: ${field}`);
  const result = sorted(values.map(id => number(id, 0, 65535, field, true)));
  if (result.some(id => !Object.hasOwn(dictionary, id))) fail('UNKNOWN_FILTER_ID', `${field} 包含未知编号`, `Unknown ID in ${field}`);
  return result;
}
function equipmentGroupName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) fail('INVALID_SCORE_GROUP_NAME', '装备组名称须为 1–80 个字符', 'Equipment group names must have 1–80 characters');
  escapeXml(value);
  return value;
}

function scoreNumber(value, field, min = -1000, max = 1000) {
  const result = number(value, min, max, field);
  if (Math.abs(result * 100 - Math.round(result * 100)) > 1e-7) fail('INVALID_SCORE_PRECISION', '评分最多保留两位小数', 'Scores support at most two decimal places');
  return Math.round(result * 100) / 100;
}
export function normalizeEquipmentScoring(scoring = VALUE_FILTER_DEFAULT_SCORING) {
  if (!scoring || typeof scoring !== 'object') fail('INVALID_EQUIPMENT_SCORING', '词缀评分格式无效', 'Invalid affix scores');
  const normalized = Object.fromEntries(['high', 'medium', 'low'].map(category => {
    const values = scoring[category];
    if (!Array.isArray(values) || values.length !== 7) fail('INVALID_EQUIPMENT_SCORING', '每类词缀需要 T1–T7 的分数', 'Each category requires T1–T7 scores');
    return [category, Array.from(values, (value, index) => scoreNumber(value, `scoring.${category}.T${index + 1}`))];
  }));
  if (normalized.high[6] <= 0) fail('INVALID_SCORE_REFERENCE', '高价值 T7 分数须大于 0', 'The high-value T7 score must be greater than zero');
  return normalized;
}
export function getEquipmentScoreRange(scoring = VALUE_FILTER_DEFAULT_SCORING) {
  normalizeEquipmentScoring(scoring);
  return { min: 1, max: 100, step: 1 };
}
let scoreGroupSequence = 0;
/** Disabled groups are omitted; hidden groups retain terminal HIDE rules. */
export function createEquipmentScoreGroup(overrides = {}) {
  const threshold = overrides.threshold ?? 30;
  return { id: `equipment_score_${Date.now()}_${++scoreGroupSequence}`, name: `${threshold}%`, threshold, enabled: true, show: true,
    color: threshold >= 80 ? 6 : threshold >= 60 ? 4 : 3, emphasized: threshold >= 60, ...overrides };
}
const exampleCache = new Map();
function thresholdExample(scoreUnits, scoring) {
  const key = JSON.stringify(scoring);
  if (!exampleCache.has(key)) {
    const types = ['high', 'medium', 'low'].flatMap(category => scoring[category].map((value, index) => ({ category, tier: index + 1, units: Math.round(value * 100) })));
    const examples = new Map();
    const visit = (start, picked, total) => {
      if (picked.length) {
        const previous = examples.get(total);
        // Prefer fewer affixes, then lower tiers, then useful affixes in examples.
        const rank = [picked.length, Math.max(...picked.map(a => a.tier)), picked.filter(a => a.category === 'low').length, picked.filter(a => a.category === 'high').length];
        if (!previous || rank.some((n, i) => n < previous.rank[i] && rank.slice(0, i).every((v, j) => v === previous.rank[j]))) examples.set(total, { picked: [...picked], rank });
      }
      if (picked.length === 4) return;
      for (let index = start; index < types.length; index++) visit(index, [...picked, types[index]], total + types[index].units);
    };
    visit(0, [], 0);
    if (exampleCache.size >= 8) exampleCache.delete(exampleCache.keys().next().value);
    exampleCache.set(key, [...examples].sort((a, b) => a[0] - b[0]));
  }
  const entry = exampleCache.get(key).find(([total]) => total >= scoreUnits);
  if (!entry) return label('—', '—');
  const counts = new Map();
  for (const a of entry[1].picked) { const key = `${a.category}:${a.tier}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  const describe = language => [...counts].map(([key, count]) => {
    const [category, tier] = key.split(':');
    const names = language === 'zh' ? { high: '高价值', medium: '有效', low: '无效' } : { high: 'high-value', medium: 'useful', low: 'unwanted' };
    return language === 'zh' ? `${count} 条${names[category]} T${tier}` : `${count} ${names[category]} T${tier}`;
  }).join(' + ');
  return label(describe('zh'), describe('en'));
}
/** 100% is four high-value T7 affixes. Scores are integer hundredths, so round the comparison up. */
export function getEquipmentScoreThreshold(threshold, scoring = VALUE_FILTER_DEFAULT_SCORING) {
  const percent = number(threshold, 1, 100, 'threshold', true), scores = normalizeEquipmentScoring(scoring);
  const scaled = Math.round(scores.high[6] * 100) * 4 * percent;
  const scoreUnits = Math.ceil(scaled / 100), rawScore = scaled / 10000;
  return { rawScore, scoreUnits, effectiveScore: scoreUnits / 100, example: thresholdExample(scoreUnits, scores) };
}
function readAffix(raw, sourcePath, sourceRole) {
  if (!raw || typeof raw.id !== 'string' || raw.id.length > 80 || !/^A[A-Za-z0-9+/=]+$/.test(raw.id)) fail('UNKNOWN_BUILD_AFFIX', '无法解析配装词缀', 'Cannot decode build affix');
  const decoded = LZString.decompressFromBase64(raw.id.slice(1));
  const id = decoded && /^\d+$/.test(decoded) ? Number(decoded) : NaN, definition = catalog.affixes[id];
  if (!definition) fail('UNKNOWN_BUILD_AFFIX', '词缀不在当前目录中', 'Affix is absent from the current catalog');
  const tier = number(raw.tier ?? 1, 1, definition.tierCount, 'tier', true);
  return { id, tier, name: definition.name, specialType: definition.specialAffixType, sourceRole, sourcePath };
}

/** Reads planner identities and additional affixes, never inherent ir/ur rolls. */
export function createValueFilterDraft(input) {
  const build = normalizePlannerBuild(input), warnings = [], targets = [], high = [], uniqueIds = [], setIds = [], idolRows = new Map();
  let hasUnresolvedTargets = !/^Version\s+1\.5\.\d+(?:\.\d+)?$/i.test(build.dataVersion);
  if (hasUnresolvedTargets) warnings.push(warning('BUILD_VERSION', '配装版本与目录基准不同；请先核对，兜底隐藏已关闭。', 'Build version differs from the catalog baseline; fallback hiding is disabled until reviewed.'));
  const records = [...Object.entries(build.data.equipment).filter(([, item]) => item).map(([slot, item]) => ({ slot, item, sourcePath: `data.equipment.${slot}` })),
    ...build.data.idols.filter(Boolean).map((item, index) => ({ slot: 'idol', item, sourcePath: `data.idols[${index}]` }))];
  for (const { slot, item, sourcePath } of records) {
    let identity;
    try { identity = resolvePlannerItemId(item.id); }
    catch (error) { hasUnresolvedTargets = true; warnings.push(warning('UNRESOLVED_TARGET', `${sourcePath}：${error.message}`, `${sourcePath}: ${error.message}`, sourcePath)); continue; }
    const definition = identity.uniqueId == null ? null : catalog.uniques[identity.uniqueId];
    if (identity.uniqueId != null && !definition) { hasUnresolvedTargets = true; warnings.push(warning('UNKNOWN_FILTER_UNIQUE', '独特物品不在过滤器目录中。', 'Unique is absent from the filter catalog.', sourcePath)); continue; }
    const idol = IDOL_TYPES.includes(identity.baseTypeId);
    if (definition) (definition.isSetItem ? setIds : uniqueIds).push(identity.uniqueId);
    const target = { ...identity, slot, sourcePath, kind: definition ? definition.isSetItem ? 'set' : 'unique' : idol ? 'idol' : identity.baseTypeId === 41 ? 'altar' : 'equipment', name: definition?.name ?? catalog.bases[`${identity.baseTypeId}:${identity.subTypeId}`]?.name, affixes: [], inherentAffixes: [] };
    targets.push(target);
    const candidates = [];
    if (item.affixes != null && !Array.isArray(item.affixes)) { hasUnresolvedTargets = true; warnings.push(warning('UNRESOLVED_TARGET', '配装词缀列表格式无效。', 'Invalid build affix list.', sourcePath)); }
    else for (const [index, raw] of (item.affixes ?? []).entries()) candidates.push({ raw, role: 'regular', path: `${sourcePath}.affixes[${index}]` });
    for (const [field, role] of [['sealedAffix', 'sealed'], ['corruptedAffix', 'corrupted'], ['primordialAffix', 'primordial']]) if (item[field]) candidates.push({ raw: item[field], role, path: `${sourcePath}.${field}` });
    for (const candidate of candidates) {
      try {
        const affix = readAffix(candidate.raw, candidate.path, candidate.role);
        // Exulis' type-6 variants also belong to the ordinary amulet corruption pool: exclude only this unique's fixed source.
        const fixedVariant = itemCatalog.uniques[identity.uniqueId]?.specificAffixIds?.includes(affix.id);
        if (affix.specialType === 7 && !fixedVariant) fail('INVALID_UNIQUE_VARIANT', '固有变体不属于此暗金', 'The inherent variant does not belong to this unique');
        if (fixedVariant) { target.inherentAffixes.push({ ...affix, sourceRole: 'fixed_variant' }); continue; }
        // LET also uses primordialAffix for the second fixed unique variant, at its original tier.
        if (candidate.role === 'primordial' && affix.tier !== 8) fail('INVALID_PRIMORDIAL_AFFIX', '原初词缀必须为 T8', 'Primordial affix must be T8');
        if (!catalog.affixes[affix.id].canRollOn.includes(identity.baseTypeId)) fail('INCOMPATIBLE_BUILD_AFFIX', '词缀与装备类型不兼容', 'Affix is incompatible with its item type');
        affix.origin = candidate.role === 'primordial' ? 'primordial' : affix.specialType === 3 ? 'reforged_set' : candidate.role === 'corrupted' || affix.specialType === 6 ? 'corruption' : definition?.legendaryType === 1 ? 'weaver_addition' : definition ? 'legendary_addition' : idol ? 'idol' : 'ordinary';
        target.affixes.push(affix);
        if (!idol && isGearAffix(catalog.affixes[affix.id])) high.push(affix.id);
        if ([2, 3, 4, 5, 6].includes(affix.specialType) || candidate.role === 'primordial' || definition?.legendaryType === 1) warnings.push(warning('SPECIAL_AFFIX_SOURCE', '已记录特殊附加词缀；价值分组只判断词缀，不代表普通掉落或制作路线。', 'Special additional affix recorded. Value grouping does not imply an ordinary drop or crafting route.', candidate.path));
      } catch (error) { hasUnresolvedTargets = true; warnings.push(warning('UNRESOLVED_TARGET', `${candidate.path}：${error.message}`, `${candidate.path}: ${error.message}`, candidate.path)); }
    }
    if (idol && !definition && target.affixes.length) {
      const affixIds = sorted(target.affixes.map(a => a.id)), key = [identity.baseTypeId, identity.subTypeId, ...affixIds].join('-');
      if (idolRows.has(key)) { const row = idolRows.get(key); row.count++; row.sourcePaths.push(sourcePath); }
      else idolRows.set(key, { id: `idol-${key}`, baseTypeId: identity.baseTypeId, subTypeId: identity.subTypeId, affixIds, enabled: true, count: 1, sourcePaths: [sourcePath], name: target.name });
    }
  }
  const highAffixIds = sorted(high), mediumAffixIds = sorted(COMMON_AFFIX_GROUPS.flatMap(g => g.affixIds).filter(id => !highAffixIds.includes(id)));
  const groups = Object.fromEntries(VALUE_FILTER_GROUPS.map(g => [g.id, { ...g.defaults }]));
  if (hasUnresolvedTargets) { groups.equipment_other.show = true; groups.idol_other.show = true; }
  const equipmentGroups = [100, 70, 45].map(threshold => createEquipmentScoreGroup({ id: `equipment_score_${threshold}`, threshold }));
  return { schemaVersion: 2, name: build.id ? `Build ${build.id}` : 'Build 价值过滤器', language: 'zh', build: { id: build.id, sourceUrl: build.sourceUrl, dataVersion: build.dataVersion }, uniqueIds: sorted(uniqueIds), setIds: sorted(setIds), highAffixIds, mediumAffixIds, idols: [...idolRows.values()],
    analysis: { targets, warnings, hasUnresolvedTargets, build: { id: build.id, sourceUrl: build.sourceUrl, dataVersion: build.dataVersion }, summary: { equipmentCount: records.filter(r => r.slot !== 'idol').length, idolCount: records.filter(r => r.slot === 'idol').length, uniqueCount: unique(uniqueIds).length, setCount: unique(setIds).length, highAffixCount: highAffixIds.length } }, groups, equipmentGroups, scoring: structuredClone(VALUE_FILTER_DEFAULT_SCORING), options: { ...VALUE_FILTER_DEFAULT_OPTIONS } };
}

const rarity = rarities => ({ type: 'rarity', rarities });
const subtype = baseTypeIds => ({ type: 'subtype', baseTypeIds, subTypeIds: [] });
const identities = uniqueIds => ({ type: 'unique', uniqueIds });
const affix = (affixIds, minTier = 1, minCount = 1, minTotalTier = 0) => ({ type: 'affix', affixIds, minTier, minCount, minTotalTier });
// AffixCondition's editor clamps impossible count values. Never emit a condition that would be broadened this way.
function viable(c) {
  if (c.type !== 'affix') return true;
  const definitions = c.affixIds.map(id => catalog.affixes[id]).filter(a => Array.from({ length: a.tierCount }, (_, i) => i + 1).some(tier => compare(tier, c.comparison ?? 'MORE_OR_EQUAL', c.minTier)));
  const prefix = definitions.filter(a => a.type === 0), suffix = definitions.filter(a => a.type === 1);
  const maxCount = Math.min(4, (prefix.length ? 2 : 0) + (suffix.length ? 2 : 0), prefix.length + suffix.length);
  return c.affixIds.length > 0 && maxCount >= c.minCount && definitions.reduce((sum, a) => sum + a.tierCount, 0) >= c.minTotalTier;
}
function validateDraft(draft) {
  if (!draft || draft.schemaVersion !== 2 || typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 200 || !['zh', 'en'].includes(draft.language)) fail('INVALID_FILTER_DRAFT', '请填写过滤器名称并选择语言', 'Enter a filter name and language');
  const high = ids(draft.highAffixIds, catalog.affixes, 'highAffixIds'), medium = ids(draft.mediumAffixIds, catalog.affixes, 'mediumAffixIds').filter(id => !high.includes(id));
  if ([...high, ...medium].some(id => !isGearAffix(catalog.affixes[id]))) fail('INVALID_EQUIPMENT_AFFIX', '装备价值池包含神像或固有属性', 'Equipment pools contain idol or inherent affixes');
  const uniqueIds = ids(draft.uniqueIds, catalog.uniques, 'uniqueIds'), setIds = ids(draft.setIds, catalog.uniques, 'setIds');
  if (uniqueIds.some(id => catalog.uniques[id].isSetItem) || setIds.some(id => !catalog.uniques[id].isSetItem)) fail('INVALID_UNIQUE_KIND', '暗金与套装需要分别选择', 'Select uniques and sets separately');
  const options = { ...VALUE_FILTER_DEFAULT_OPTIONS, ...draft.options };
  options.rareUniqueThreshold = number(options.rareUniqueThreshold, 0, 1, 'rareUniqueThreshold');
  options.rareSetThreshold = number(options.rareSetThreshold, 0, 1, 'rareSetThreshold');
  const scoring = normalizeEquipmentScoring(draft.scoring);
  const styles = Object.fromEntries(VALUE_FILTER_GROUPS.map(g => {
    const style = draft.groups?.[g.id] ?? g.defaults;
    if (typeof style.show !== 'boolean' || typeof style.emphasized !== 'boolean') fail('INVALID_FILTER_STYLE', '分组显示设置无效', 'Invalid group visibility or emphasis');
    const name = RENAMABLE_EQUIPMENT_GROUPS.has(g.id) && style.name !== undefined ? equipmentGroupName(style.name) : undefined;
    return [g.id, { show: style.show, emphasized: style.emphasized, color: number(style.color, 0, 17, `${g.id}.color`, true), ...(name !== undefined ? { name } : {}) }];
  }));
  if (!Array.isArray(draft.equipmentGroups)) fail('INVALID_SCORE_GROUPS', '装备评分组格式无效', 'Invalid equipment score groups');
  const equipmentIds = new Set(Object.keys(BY_GROUP));
  const equipmentGroups = draft.equipmentGroups.map(g => {
    if (!g || typeof g.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(g.id) || equipmentIds.has(g.id)) fail('INVALID_SCORE_GROUP_ID', '装备组编号缺失、重复或无效', 'Missing, duplicate or invalid equipment group ID');
    equipmentIds.add(g.id);
    equipmentGroupName(g.name);
    if (typeof g.enabled !== 'boolean' || typeof g.show !== 'boolean' || typeof g.emphasized !== 'boolean') fail('INVALID_SCORE_GROUP_OPTION', '装备组开关或显示设置无效', 'Invalid equipment group enabled state or style');
    const threshold = number(g.threshold, 1, 100, 'threshold', true), color = number(g.color, 0, 17, `${g.id}.color`, true);
    return { ...g, color, threshold, ...getEquipmentScoreThreshold(threshold, scoring), description: label(`≥ ${threshold}%`, `≥ ${threshold}%`) };
  }).sort((a, b) => b.threshold - a.threshold);
  if (draft.analysis?.hasUnresolvedTargets && (!styles.equipment_other.show || !styles.idol_other.show)) fail('UNRESOLVED_HIDE_TARGETS', '配装有未解析的目标，不能启用兜底隐藏', 'Unresolved build targets prevent fallback hiding');
  if (!Array.isArray(draft.idols)) fail('INVALID_IDOL_FILTER', '神像需求格式无效', 'Invalid idol targets');
  const idolPools = new Map(), rowIds = new Set();
  for (const row of draft.idols) {
    if (!row || typeof row.id !== 'string' || !row.id || rowIds.has(row.id) || typeof row.enabled !== 'boolean') fail('INVALID_IDOL_FILTER', '神像条目编号或开关无效', 'Invalid idol row ID or enabled state');
    rowIds.add(row.id); if (!row.enabled) continue;
    const type = number(row.baseTypeId, 25, 33, 'baseTypeId', true), selected = ids(row.affixIds, catalog.affixes, 'idol.affixIds');
    if (!selected.length) fail('EMPTY_IDOL_SELECTION', '启用的神像条目需要词缀', 'An enabled idol row needs affixes');
    if (selected.some(id => !isValueIdolAffix(catalog.affixes[id], type))) fail('INCOMPATIBLE_IDOL_AFFIX', '神像词缀与形状不兼容', 'Idol affix is incompatible with its shape');
    if (row.subTypeId != null && !Object.hasOwn(itemCatalog.bases[type]?.subtypes ?? {}, number(row.subTypeId, 0, 65535, 'subTypeId', true))) fail('INVALID_IDOL_SUBTYPE', '神像底材不属于所选形状', 'Idol base does not belong to the selected shape');
    idolPools.set(type, sorted([...(idolPools.get(type) ?? []), ...selected]));
  }
  return { high, medium, uniqueIds, setIds, options, scoring, styles, idolPools, equipmentGroups };
}

/** Compiles the actual additive score. All lower-level rules retain the group's SHOW/HIDE outcome. */
export function generateValueFilter(draft) {
  const { high, medium, uniqueIds, setIds, options, scoring, styles, idolPools, equipmentGroups } = validateDraft(draft);
  const warnings = [...(draft.analysis?.warnings ?? [])], rules = [], useful = sorted([...high, ...medium]);
  const allGearAffixes = Object.values(catalog.affixes).filter(isGearAffix).map(a => a.id), low = allGearAffixes.filter(id => !useful.includes(id));
  const definitions = { ...BY_GROUP, ...Object.fromEntries(equipmentGroups.map(g => [g.id, g])) };
  for (const g of equipmentGroups) styles[g.id] = { show: g.show, color: g.color, emphasized: g.emphasized };
  const add = (groupId, key, conditions) => {
    if (!conditions.every(viable) || conditions.some(c => c.type === 'unique' && !c.uniqueIds.length)) return;
    const style = styles[groupId]; rules.push({ id: `${groupId}-${key}`, groupId, name: style.name === undefined ? definitions[groupId].name : style.name, description: definitions[groupId].description, type: style.show ? 'SHOW' : 'HIDE', conditions, style: { color: style.color, emphasized: style.emphasized }, order: rules.length });
  };
  const equipment = [rarity(ORDINARY_RARITIES), subtype(GEAR_TYPES)];
  add('unique_needed', 'selected', [identities(uniqueIds)]);
  const equipmentInsertAt = rules.length;
  for (const [baseTypeId, selected] of idolPools) {
    const scope = [rarity(ORDINARY_RARITIES), subtype([baseTypeId])];
    add('idol_double', `shape${baseTypeId}`, [...scope, affix(selected.filter(id => catalog.affixes[id].type === 0)), affix(selected.filter(id => catalog.affixes[id].type === 1))]);
    add('idol_single', `shape${baseTypeId}`, [...scope, affix(selected)]);
  }
  const rareIds = (sets, threshold) => Object.values(catalog.uniques).filter(u => u.isSetItem === sets && !u.hideFromPlayers && u.canDropRandomly && u.rerollChance >= threshold).map(u => u.id);
  add('unique_rare', 'random-pool', [identities(rareIds(false, options.rareUniqueThreshold))]);
  const lpIds = Object.values(catalog.uniques).filter(u => !u.isSetItem && u.legendaryType === 0 && !u.hideFromPlayers).map(u => u.id);
  add('unique_high_lp', 'lp2to4', [rarity(['UNIQUE', 'LEGENDARY']), identities(lpIds), { type: 'potential', minLegendaryPotential: 2, maxLegendaryPotential: 4 }]);
  add('set_valuable', 'selected-or-rare', [identities(sorted([...setIds, ...rareIds(true, options.rareSetThreshold)]))]);
  // Reforged sets can have LEGENDARY rarity, so identity (not just the rarity flag) separates sets.
  add('unique_common', 'remaining', [identities(Object.values(catalog.uniques).filter(u => !u.isSetItem).map(u => u.id))]);
  add('set_common', 'remaining', [identities(Object.values(catalog.uniques).filter(u => u.isSetItem).map(u => u.id))]);
  add('idol_other', 'remaining', [rarity(ORDINARY_RARITIES), subtype(IDOL_TYPES)]);
  for (const kind of ['glyph', 'rune', 'shard', 'key']) add(kind, 'all', [{ type: 'resource', kind }]);
  add('altar', 'all', [subtype([41])]);
  const compilation = compileEquipmentScores({ pools: { high, medium, low }, scoring,
    groups: equipmentGroups.map(g => ({ ...g, threshold: g.scoreUnits / 100 })), catalog, ruleLimit: MAX_FILTER_RULES - rules.length });
  const staticRuleCount = rules.length;
  for (const [index, compiled] of compilation.rules.entries()) {
    if (!compiled.conditions.every(viable)) fail('UNREPRESENTABLE_SCORE_CONDITION', '评分条件无法稳定导入游戏', 'A score condition cannot be preserved by the native editor');
    const scope = [...equipment, ...compiled.conditions];
    if (compiled.groupId === EQUIPMENT_SCORE_FALLBACK) {
      add('equipment_other_exalted', `${index}-t7`, [rarity(['EXALTED']), ...scope.slice(1), affix(allGearAffixes, 7)]);
      add('equipment_other_exalted', `${index}-t6x2`, [rarity(['EXALTED']), ...scope.slice(1), affix(allGearAffixes, 6, 2)]);
      add('equipment_other', `${index}-remaining`, scope);
    } else add(compiled.groupId, `${index}`, scope);
  }
  rules.splice(equipmentInsertAt, 0, ...rules.splice(staticRuleCount));
  rules.forEach((rule, index) => { rule.order = index; });
  if (rules.length > MAX_FILTER_RULES) fail('TOO_MANY_FILTER_RULES', `原生规则超过 ${MAX_FILTER_RULES} 条，请停用部分装备组`, `More than ${MAX_FILTER_RULES} native rules; disable some equipment groups`);
  if (compilation.diagnostics.approximate) warnings.push(warning('EQUIPMENT_SCORE_APPROXIMATION', '近似过滤：可能多保留部分装备。', 'Approximate filtering: some below-threshold equipment may also be kept.'));
  warnings.push(warning('EQUIPMENT_SCORE', '100% = 4 条高价值 T7；T8 按 T7 计分。', '100% = four high-value T7 affixes; T8 uses the T7 score.'));
  warnings.push(warning('RELATIVE_UNIQUE_RARITY', '暗金和套装的稀有门槛只比较随机池 rerollChance，不代表 Boss 掉率或市场价格。', 'Unique and set rarity thresholds compare random-pool rerollChance, not boss drop rates or market prices.'));
  const orderedGroups = [VALUE_FILTER_GROUPS[0], ...equipmentGroups, ...VALUE_FILTER_GROUPS.slice(1)];
  return { xml: serialize(rules, draft, compilation.diagnostics), rules, warnings, diagnostics: compilation.diagnostics, groups: orderedGroups.map(g => ({ ...g, ...styles[g.id], ruleCount: rules.filter(r => r.groupId === g.id).length })) };
}

function escapeXml(value) {
  const text = String(value ?? '');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(text) || (text.isWellFormed && !text.isWellFormed())) fail('INVALID_XML_TEXT', '名称含有无效 XML 字符', 'A name contains invalid XML characters');
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}
const RESOURCE_XML = {
  glyph: ['GlyphCondition', 'GlyphFilterFlags', 'AllGlyphs'], rune: ['RuneCondition', 'RuneFilterFlags', 'AllRunes'],
  shard: ['CraftingMaterialsCondition', 'NonEquippableItemFilterFlags', 'AllShards'], key: ['KeysCondition', 'NonEquippableItemFilterFlags', 'AllKeys'],
};
function conditionXml(c) {
  const wrap = (type, body) => `        <Condition i:type="${type}">${body}</Condition>`;
  if (c.type === 'unique') return wrap('UniqueModifiersCondition', c.uniqueIds.map(id => `<Uniques><UniqueId>${id}</UniqueId><Rolls /></Uniques>`).join(''));
  if (c.type === 'subtype') return wrap('SubTypeCondition', `<type>${c.baseTypeIds.map(id => `<EquipmentType>${EQUIPMENT_TYPES[id]}</EquipmentType>`).join('')}</type><subTypes />`);
  if (c.type === 'rarity') return wrap('RarityCondition', `<rarity>${c.rarities.join(' ')}</rarity>`);
  if (c.type === 'affix') return wrap('AffixCondition', `<affixes>${c.affixIds.map(id => `<int>${id}</int>`).join('')}</affixes><comparsion>${c.comparison ?? 'MORE_OR_EQUAL'}</comparsion><comparsionValue>${c.minTier}</comparsionValue><minOnTheSameItem>${c.minCount}</minOnTheSameItem><combinedComparsion>${c.combinedComparison ?? (c.minTotalTier ? 'MORE_OR_EQUAL' : 'ANY')}</combinedComparsion><combinedComparsionValue>${c.minTotalTier || 1}</combinedComparsionValue><advanced>true</advanced>`);
  if (c.type === 'potential') return wrap('PotentialCondition', ['MinLegendaryPotential', 'MaxLegendaryPotential', 'MinWeaversWill', 'MaxWeaversWill', 'MinWeaversTouch', 'MaxWeaversTouch', 'MinForgingPotential', 'MaxForgingPotential'].map(field => { const value = c[field[0].toLowerCase() + field.slice(1)]; return value == null ? `<${field} i:nil="true" />` : `<${field}>${value}</${field}>`; }).join(''));
  if (c.type === 'resource') { const [type, field, value] = RESOURCE_XML[c.kind]; return wrap(type, `<${field}>${value}</${field}>`); }
  fail('UNKNOWN_FILTER_CONDITION', '无法序列化规则条件', 'Cannot serialize filter condition');
}
function serialize(rules, draft, diagnostics = {}) {
  const body = [...rules].reverse().map(rule => `    <Rule>\n      <type>${rule.type}</type>\n      <conditions>\n${rule.conditions.map(conditionXml).join('\n')}\n      </conditions>\n      <recolor>${rule.type === 'SHOW'}</recolor>\n      <color>${rule.style.color}</color>\n      <isEnabled>true</isEnabled>\n      <levelDependent_deprecated>false</levelDependent_deprecated>\n      <minLvl_deprecated>0</minLvl_deprecated>\n      <maxLvl_deprecated>0</maxLvl_deprecated>\n      <emphasized>${rule.style.emphasized}</emphasized>\n      <nameOverride>${escapeXml(filterLabel(rule.name, draft.language))}</nameOverride>\n      <SoundId>0</SoundId>\n      <MapIconId>0</MapIconId>\n      <BeamOverride>false</BeamOverride>\n      <BeamSizeOverride>NONE</BeamSizeOverride>\n      <BeamColorOverride>0</BeamColorOverride>\n      <Order>${rule.order}</Order>\n    </Rule>`).join('\n');
  return `<ItemFilter xmlns:i="http://www.w3.org/2001/XMLSchema-instance">\n  <name>${escapeXml(draft.name)}</name>\n  <filterIcon>0</filterIcon>\n  <filterIconColor>0</filterIconColor>\n  <description>${escapeXml(diagnostics.approximate ? draft.language === 'en' ? 'Approximate equipment scoring: may keep additional below-threshold equipment.' : '近似装备评分：可能多保留部分未达门槛的装备。' : draft.language === 'en' ? 'Build value pools and editable equipment score thresholds.' : '配装价值池与可调装备评分门槛。')}</description>\n  <lastModifiedInVersion>${itemCatalog.gameVersion}</lastModifiedInVersion>\n  <lootFilterVersion>${FILTER_VERSION}</lootFilterVersion>\n  <rules>\n${body}\n  </rules>\n</ItemFilter>\n`;
}

function compare(actual, operation, expected) {
  if (operation === 'ANY') return true;
  if (operation === 'EQUAL') return actual === expected;
  if (operation === 'LESS') return actual < expected;
  if (operation === 'LESS_OR_EQUAL') return actual <= expected;
  if (operation === 'MORE') return actual > expected;
  if (operation === 'MORE_OR_EQUAL') return actual >= expected;
  return false;
}
/** Preview input uses decoded IDs, display tiers (T1=1), rarity enum names, and legendaryPotential. */
export function matchValueFilterRule(rule, item) {
  const affixes = [...(item.affixes ?? []), ...['sealedAffix', 'corruptedAffix', 'primordialAffix'].map(field => item[field]).filter(Boolean)];
  return rule.conditions.every(c => {
    if (c.type === 'unique') return ['UNIQUE', 'SET', 'LEGENDARY'].includes(item.rarity) && c.uniqueIds.includes(item.uniqueId);
    if (c.type === 'subtype') return c.baseTypeIds.includes(item.baseTypeId);
    if (c.type === 'rarity') return c.rarities.includes(item.rarity);
    if (c.type === 'affix') { const found = affixes.filter(a => c.affixIds.includes(a.affixId ?? a.id) && compare(a.tier, c.comparison ?? 'MORE_OR_EQUAL', c.minTier)); return found.length >= c.minCount && compare(found.reduce((sum, a) => sum + a.tier, 0), c.combinedComparison ?? (c.minTotalTier ? 'MORE_OR_EQUAL' : 'ANY'), c.minTotalTier); }
    if (c.type === 'potential') return Number.isFinite(item.legendaryPotential) && item.legendaryPotential >= c.minLegendaryPotential && item.legendaryPotential <= c.maxLegendaryPotential;
    if (c.type === 'resource') return (item.resourceKind ?? item.kind) === c.kind;
    return false;
  });
}
export function evaluateValueItem(draft, item) {
  const { rules } = generateValueFilter(draft), rule = rules.find(r => matchValueFilterRule(r, item));
  return { groupId: rule?.groupId ?? null, outcome: rule?.type ?? 'SHOW', rule: rule ?? null };
}

/** Every additional affix contributes its configured tier score; an empty slot contributes zero. */
export function getEquipmentItemScore(draft, item) {
  const { high, medium, scoring } = validateDraft(draft);
  const affixes = [...(item.affixes ?? []), ...['sealedAffix', 'corruptedAffix', 'primordialAffix'].map(field => item[field]).filter(Boolean)];
  const contributions = [];
  for (const a of affixes) {
    const id = a.affixId ?? a.id;
    if (!isGearAffix(catalog.affixes[id])) continue;
    const tier = number(a.tier, 1, 8, 'item.affix.tier', true);
    const category = high.includes(id) ? 'high' : medium.includes(id) ? 'medium' : 'low';
    const scoreUnits = Math.round(scoring[category][Math.min(tier, 7) - 1] * 100);
    contributions.push({ id, tier, category, scoreUnits, score: scoreUnits / 100 });
  }
  const scoreUnits = contributions.reduce((sum, a) => sum + a.scoreUnits, 0);
  return { scoreUnits, rawScore: scoreUnits / 100, percentage: scoreUnits / (Math.round(scoring.high[6] * 100) * 4) * 100, contributions };
}
