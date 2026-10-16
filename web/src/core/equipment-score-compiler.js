import { FilterError } from './loot-filter.js';

// The game has no weighted-score condition or serializable OR/NOT expression.
// This compiler emits a first-match decision list. Counts descend, so a later
// branch implicitly excludes the earlier counts, including a zero-count branch.
// Every leaf is terminal: the caller must expand __equipment_fallback__ into
// its ordinary-equipment fallback rules, with these same conditions attached.
export const EQUIPMENT_SCORE_FALLBACK = '__equipment_fallback__';
const MAX_AFFIXES = 7;
const MAX_STATES = 25000;
const CACHE_SIZE = 16;
const cache = new Map();

function error(code, zh, en, diagnostics) {
  const result = new FilterError(code, zh, en);
  result.diagnostics = diagnostics;
  return result;
}
function units(value, limit) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    throw error('INVALID_EQUIPMENT_SCORE', '评分须为范围内最多两位小数的数字', 'Scores must be finite numbers in range with at most two decimal places');
  }
  return Math.round(value * 100);
}
function copyResult(result) {
  return { rules: result.rules.map(rule => ({ groupId: rule.groupId, conditions: rule.conditions.map(condition => ({ ...condition, affixIds: [...condition.affixIds] })) })), diagnostics: structuredClone(result.diagnostics) };
}
function remember(key, result) {
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
  cache.set(key, result);
}

/**
 * Compiles additive per-tier scores within seven scored affixes. Exact native
 * conditions are preferred; budget or count limits can conservatively promote
 * items into a higher visible group, with explicit diagnostic bounds. T8 uses
 * the T7 score. Zero-score affixes need no condition.
 *
 * Arrays in scoring are ordered T1..T7. The caller supplies disjoint ID pools,
 * styles the returned group IDs, and adds ordinary rarity/equipment type scope.
 * An enabled group with show:false still needs all of its terminal HIDE rules.
 * ruleLimit is the remaining native-rule budget; fallback placeholders cost 3.
 *
 * Affix conditions retain minTier/minCount/minTotalTier and add comparison and
 * combinedComparison enum names. In particular, MORE and EQUAL must NOT be
 * serialized as MORE_OR_EQUAL. Empty conditions mean the whole caller scope.
 */
export function compileEquipmentScores({ pools, scoring, groups = [], catalog, ruleLimit = 200 }) {
  if (!Number.isInteger(ruleLimit) || ruleLimit < 0 || ruleLimit > 200) throw error('INVALID_EQUIPMENT_SCORE', '原生规则预算无效', 'Invalid native-rule budget');
  const dictionary = catalog?.affixes ?? catalog;
  const seen = new Set();
  const normalizedPools = {}, weights = {};
  for (const pool of ['high', 'medium', 'low']) {
    if (!Array.isArray(scoring?.[pool]) || scoring[pool].length !== 7 || !Array.isArray(pools?.[pool])) throw error('INVALID_EQUIPMENT_SCORE', '需要完整的三组 T1–T7 评分与词缀池', 'Three complete T1–T7 score rows and affix pools are required');
    weights[pool] = Array.from(scoring[pool], value => units(value, 1000));
    normalizedPools[pool] = [...new Set(pools[pool])].sort((a, b) => a - b);
    for (const id of normalizedPools[pool]) {
      if (!Number.isInteger(id) || !dictionary?.[id] || seen.has(id)) throw error('INVALID_EQUIPMENT_SCORE', '评分词缀池存在未知编号或重复归属', 'Score pools contain unknown IDs or overlapping membership');
      seen.add(id);
    }
  }
  const groupIds = new Set();
  const selected = groups.filter(group => group.enabled !== false).map((group, order) => {
    if (typeof group.id !== 'string' || !group.id || group.id === EQUIPMENT_SCORE_FALLBACK || groupIds.has(group.id)) throw error('INVALID_EQUIPMENT_SCORE', '评分组编号缺失或重复', 'Missing or duplicate score group IDs');
    groupIds.add(group.id);
    return { id: group.id, threshold: units(group.threshold, 7000), show: group.show !== false, order };
  }).sort((a, b) => b.threshold - a.threshold || a.order - b.order);
  const definitions = [...seen].sort((a, b) => a - b).map(id => [id, dictionary[id].type, dictionary[id].tierCount]);
  const key = JSON.stringify([normalizedPools, weights, selected, definitions, ruleLimit]);
  const cached = cache.get(key);
  if (cached) {
    if (cached.error) throw error(cached.error.code, cached.error.zh, cached.error.en, structuredClone(cached.error.diagnostics));
    return copyResult(cached);
  }
  let exploredStates = 0;
  const diagnostics = () => ({ exploredStates, maxAffixes: MAX_AFFIXES, fallbackRuleCost: 3, ruleLimit, algorithm: 'first-match-tier-count-tree-with-conservative-pruning' });
  const reject = (code, zh, en, extra = {}) => {
    const details = { ...diagnostics(), ...extra };
    remember(key, { error: { code, zh, en, diagnostics: details } });
    throw error(code, zh, en, details);
  };
  const outcome = score => { const rank = selected.findIndex(group => score >= group.threshold); return rank < 0 ? selected.length : rank; };
  let nextNodeId = 0;
  const groupAt = rank => selected[rank]?.id ?? EQUIPMENT_SCORE_FALLBACK;
  const makeLeaf = (rank, minimum, maximum, worstRank = rank, reasons = []) => ({ id: nextNodeId++, leaf: true, groupId: groupAt(rank), bestRank: rank, worstRank, minimum, maximum, reasons });
  const approximateLeaf = (nodes, reason) => ({ ...makeLeaf(Math.min(...nodes.map(node => node.bestRank)), Math.min(...nodes.map(node => node.minimum)), Math.max(...nodes.map(node => node.maximum)), Math.max(...nodes.map(node => node.worstRank)), [...new Set([...nodes.flatMap(node => node.reasons ?? []), reason])]), ...(reason === 'rule-budget' && nodes.length === 1 && !nodes[0].leaf ? { source: nodes[0] } : {}) });

  // A score plateau can share a tier condition only when it is a prefix or
  // suffix of T1..T8, or an exact tier. Interior ranges otherwise need OR.
  const atoms = [];
  for (const pool of ['high', 'medium', 'low']) {
    const row = [...weights[pool], weights[pool][6]];
    for (let start = 1; start <= 8;) {
      let end = start;
      while (end < 8 && row[end] === row[start - 1]) end++;
      const ranges = start === 1 || end === 8 || start === end ? [[start, end]] : Array.from({ length: end - start + 1 }, (_, index) => [start + index, start + index]);
      for (const [lower, upper] of ranges) {
        if (!row[lower - 1]) continue;
        const affixIds = normalizedPools[pool].filter(id => (dictionary[id].tierCount ?? 0) >= lower);
        if (!affixIds.length) continue;
        const maximumTier = Math.min(upper, Math.max(...affixIds.map(id => dictionary[id].tierCount)));
        atoms.push({ pool, lower, upper: maximumTier, weight: row[lower - 1], affixIds,
          comparison: lower === upper ? 'EQUAL' : lower === 1 ? 'LESS_OR_EQUAL' : 'MORE_OR_EQUAL',
          minTier: lower === upper ? lower : lower === 1 ? upper : lower });
      }
      start = end + 1;
    }
  }
  // Large positive contributions first create terminal branches early. Negative
  // buckets remain part of every bound; they are never silently discarded.
  atoms.sort((a, b) => b.weight - a.weight || a.pool.localeCompare(b.pool) || b.lower - a.lower);
  const memo = new Map();
  function tree(depth, score, slots) {
    const stateKey = `${depth}/${score}/${slots}`;
    if (memo.has(stateKey)) return memo.get(stateKey);
    let minimumWeight = 0, maximumWeight = 0;
    for (let i = depth; i < atoms.length; i++) { minimumWeight = Math.min(minimumWeight, atoms[i].weight); maximumWeight = Math.max(maximumWeight, atoms[i].weight); }
    const minimum = score + slots * minimumWeight, maximum = score + slots * maximumWeight;
    const low = outcome(minimum), high = outcome(maximum);
    if (low === high || depth === atoms.length || !slots) { const leaf = makeLeaf(low, minimum, maximum); memo.set(stateKey, leaf); return leaf; }
    if (exploredStates >= MAX_STATES) return makeLeaf(high, minimum, maximum, low, ['state-budget']);
    exploredStates++;
    const atom = atoms[depth], branches = [];
    for (let count = Math.min(slots, atom.affixIds.length); count >= 0; count--) {
      const child = tree(depth + 1, score + count * atom.weight, slots - count);
      const last = branches.at(-1);
      if (last?.child.leaf && child.leaf && last.child.groupId === child.groupId) {
        last.count = count;
        last.child = makeLeaf(child.bestRank, Math.min(last.child.minimum, child.minimum), Math.max(last.child.maximum, child.maximum), Math.max(last.child.worstRank, child.worstRank), [...new Set([...last.child.reasons, ...child.reasons])]);
      } else branches.push({ count, child });
    }
    if (branches.length === 1) { memo.set(stateKey, branches[0].child); return branches[0].child; }
    const node = { id: nextNodeId++, depth, branches, minimum, maximum, bestRank: Math.min(...branches.map(branch => branch.child.bestRank)), worstRank: Math.max(...branches.map(branch => branch.child.worstRank)) };
    memo.set(stateKey, node); return node;
  }
  const originalRoot = selected.length ? tree(0, 0, MAX_AFFIXES) : makeLeaf(selected.length, 0, 0);
  function makeCost(cuts = new Map()) {
    const costs = new Map();
    function cost(original) {
      let node = original;
      while (cuts.has(node.id)) node = cuts.get(node.id);
      if (costs.has(node.id)) return costs.get(node.id);
      const value = node.leaf ? node.groupId === EQUIPMENT_SCORE_FALLBACK ? 3 : 1 : node.branches.reduce((sum, branch) => Math.min(Number.MAX_SAFE_INTEGER, sum + cost(branch.child)), 0);
      costs.set(node.id, value); return value;
    }
    return cost;
  }
  const exactExpandedRuleCount = exploredStates < MAX_STATES ? makeCost()(originalRoot) : null;
  function countCondition(atom, count) {
    const definitions = atom.affixIds.map(id => dictionary[id]);
    const prefix = definitions.filter(definition => definition.type === 0).length;
    const suffix = definitions.filter(definition => definition.type === 1).length;
    const editorMaximum = Math.min(4, (prefix ? 2 : 0) + (suffix ? 2 : 0), prefix + suffix);
    const result = { type: 'affix', affixIds: atom.affixIds, comparison: atom.comparison, minTier: atom.minTier, minCount: count, combinedComparison: 'ANY', minTotalTier: 1 };
    if (count <= editorMaximum) return result;
    // For a narrow tier bucket, total tier can encode a count without asking
    // the editor for >2 prefixes or >4 total matches. E.g. EQUAL T7, sum>14
    // means at least 3; T7/T8 together require sum>16 instead.
    const boundary = atom.upper * (count - 1);
    if (editorMaximum >= 1 && atom.lower * count > boundary && boundary <= 28) return { ...result, minCount: 1, combinedComparison: 'MORE', minTotalTier: boundary };
    return null;
  }
  // Merge only the unrepresentable high-count run down to the next legal
  // threshold. For example, T7/T8 count>=5..7 can merge at count>=4, while the
  // 3/2/1/0 branches remain distinct. Never turn the entire root into a broad
  // top-score rule merely because one high-count condition is unavailable.
  const normalized = new Map();
  function normalizeNative(node) {
    if (node.leaf) return node;
    if (normalized.has(node.id)) return normalized.get(node.id);
    const source = node.branches.map(branch => ({ ...branch, child: normalizeNative(branch.child) })), branches = [];
    for (let i = 0; i < source.length; i++) {
      const branch = source[i];
      if (!branch.count || countCondition(atoms[node.depth], branch.count)) { branches.push(branch); continue; }
      let end = i;
      while (source[end].count && !countCondition(atoms[node.depth], source[end].count)) end++;
      branches.push({ count: source[end].count, child: approximateLeaf(source.slice(i, end + 1).map(value => value.child), 'native-count-limit') });
      i = end;
    }
    const result = { ...node, id: nextNodeId++, branches };
    normalized.set(node.id, result); return result;
  }
  const root = normalizeNative(originalRoot), cuts = new Map();
  let currentCost = makeCost(cuts), expandedRuleCount = currentCost(root);
  // Keep the root partition whenever possible. Prefer pruning subtrees whose
  // possible outcomes differ by one group before sacrificing wider distinctions.
  while (expandedRuleCount > ruleLimit) {
    const candidates = [], visited = new Set();
    function collect(node) {
      if (visited.has(node.id) || cuts.has(node.id) || node.leaf) return;
      visited.add(node.id);
      const saving = currentCost(node) - (node.bestRank === selected.length ? 3 : 1);
      if (node !== root && saving > 0) candidates.push({ node, saving, promotion: node.worstRank - node.bestRank });
      for (const branch of node.branches) collect(branch.child);
    }
    collect(root);
    candidates.sort((a, b) => a.promotion - b.promotion || b.saving - a.saving || a.node.id - b.node.id);
    const target = candidates[0]?.node ?? (!root.leaf && !cuts.has(root.id) ? root : null);
    if (!target) reject('TOO_MANY_FILTER_RULES', '其他过滤规则已用尽原生规则预算，请停用部分分组', 'Other rules have exhausted the native-rule budget; disable some groups', { expandedRuleCount, exactExpandedRuleCount });
    // Far above budget, batch a few candidates of the same smallest promotion
    // rank. Shared descendants may make the savings overlap; recomputing below
    // keeps the bound exact, and the refinement pass recovers spare precision.
    const batch = expandedRuleCount > ruleLimit * 4 && candidates.length ? candidates.filter(candidate => candidate.promotion === candidates[0].promotion).slice(0, 32) : [{ node: target }];
    for (const { node } of batch) cuts.set(node.id, approximateLeaf([node], 'rule-budget'));
    currentCost = makeCost(cuts); expandedRuleCount = currentCost(root);
  }
  // A coarse cut can save far more rules than necessary. Spend the remaining
  // budget by reopening one decision at a time, keeping each child optimistic.
  // These local replacement nodes cannot weaken an unrelated shared subtree.
  for (let step = 0; step < MAX_STATES && expandedRuleCount < ruleLimit; step++) {
    const occurrences = new Map();
    function collectRefinements(original) {
      let node = original;
      while (cuts.has(node.id)) node = cuts.get(node.id);
      if (node.leaf) {
        if (!node.source) return;
        const previous = occurrences.get(node.id);
        if (previous) previous.count++;
        else occurrences.set(node.id, { node, count: 1 });
      } else for (const branch of node.branches) collectRefinements(branch.child);
    }
    collectRefinements(root);
    // A memoized leaf can occur under several condition paths. Reopening it
    // expands every occurrence in the emitted decision list, not just one.
    const refinements = [...occurrences.values()].map(({ node, count }) => {
      const branches = node.source.branches;
      const nextCost = branches.reduce((sum, branch) => sum + (branch.child.bestRank === selected.length ? 3 : 1), 0);
      return { node, delta: count * (nextCost - (node.bestRank === selected.length ? 3 : 1)), improvement: count * branches.reduce((sum, branch) => sum + branch.child.bestRank - node.bestRank, 0) };
    }).filter(candidate => candidate.delta <= ruleLimit - expandedRuleCount);
    refinements.sort((a, b) => b.improvement - a.improvement || a.delta - b.delta || a.node.id - b.node.id);
    const chosen = refinements[0];
    if (!chosen) break;
    const source = chosen.node.source;
    // Fresh leaf IDs keep a previously refined shared leaf from introducing
    // unbudgeted descendants into this local replacement.
    cuts.set(chosen.node.id, { ...source, id: nextNodeId++, branches: source.branches.map(branch => ({ ...branch, child: branch.child.leaf ? { ...branch.child, id: nextNodeId++ } : approximateLeaf([branch.child], 'rule-budget') })) });
    currentCost = makeCost(cuts); expandedRuleCount = currentCost(root);
  }
  if (expandedRuleCount > ruleLimit) reject('TOO_MANY_FILTER_RULES', '评分组合仍超过原生规则预算，请停用部分分组', 'Score combinations still exceed the native-rule budget; disable some groups', { expandedRuleCount, exactExpandedRuleCount });
  const rules = [];
  const approximationReasons = new Set();
  let approximate = false, maxGroupPromotion = 0, maxScoreOverstatement = 0;
  function emit(original, conditions) {
    let node = original;
    while (cuts.has(node.id)) node = cuts.get(node.id);
    if (node.leaf) {
      if (node.reasons.length) {
        approximate = true;
        for (const reason of node.reasons) approximationReasons.add(reason);
        maxGroupPromotion = Math.max(maxGroupPromotion, node.worstRank - node.bestRank);
        maxScoreOverstatement = Math.max(maxScoreOverstatement, (selected[node.bestRank]?.threshold ?? node.minimum) - node.minimum);
      }
      rules.push({ groupId: node.groupId, conditions }); return;
    }
    const atom = atoms[node.depth];
    for (const branch of node.branches) emit(branch.child, branch.count ? [...conditions, countCondition(atom, branch.count)] : conditions);
  }
  emit(root, []);
  if (approximate && selected.some(group => !group.show)) reject('APPROXIMATE_HIDDEN_SCORE_GROUP', '此配置需要保守近似；请先将所有启用的装备评分组设为显示，或简化评分以便精确导出', 'This configuration needs conservative approximation; set all enabled equipment score groups to Show, or simplify scores for an exact export', { expandedRuleCount, exactExpandedRuleCount, approximate: true });
  const result = { rules, diagnostics: { ...diagnostics(), expandedRuleCount, exactExpandedRuleCount, approximate, errorBounds: { maxGroupPromotion, maxScoreOverstatement: Math.max(0, maxScoreOverstatement) / 100 }, approximationReasons: [...approximationReasons], ruleCount: rules.length, scoreBuckets: atoms.length } };
  remember(key, result); return copyResult(result);
}
