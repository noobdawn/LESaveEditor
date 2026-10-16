import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileEquipmentScores, EQUIPMENT_SCORE_FALLBACK } from '../web/src/core/equipment-score-compiler.js';
import { createValueFilterDraft, isValueEquipmentAffix } from '../web/src/core/value-filter.js';
import catalog from '../web/src/data/filter-catalog.json' with { type: 'json' };

const fixture = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
const draft = createValueFilterDraft(fixture);
const high = [...draft.highAffixIds];
const medium = draft.mediumAffixIds.filter(id => !high.includes(id));
const low = Object.values(catalog.affixes).filter(isValueEquipmentAffix).map(affix => affix.id).filter(id => !high.includes(id) && !medium.includes(id));
const pools = { high, medium, low };
const scoring = draft.scoring;
const thirtyGroups = Array.from({ length: 30 }, (_, index) => ({ id: `score${index}`, threshold: Math.round((index * 3 + 1) * 40) / 100, show: true }));
const expandedCost = result => result.rules.reduce((count, rule) => count + (rule.groupId === EQUIPMENT_SCORE_FALLBACK ? 3 : 1), 0);

test('sparse score rows are invalid rather than silently skipping missing cells', () => {
  assert.throws(() => compileEquipmentScores({ pools, scoring: { ...scoring, high: Array(7) }, groups: thirtyGroups, catalog, ruleLimit: 180 }), { code: 'INVALID_EQUIPMENT_SCORE' });
});

test('shared subtree refinements respect the real expanded 180-rule budget with thirty groups', () => {
  const result = compileEquipmentScores({ pools, scoring, groups: thirtyGroups, catalog, ruleLimit: 180 });
  assert.ok(result.diagnostics.approximate);
  assert.ok(expandedCost(result) <= 180);
  assert.equal(result.diagnostics.expandedRuleCount, expandedCost(result));
  assert.equal(result.diagnostics.ruleCount, result.rules.length);
  for (const rule of result.rules) for (const condition of rule.conditions) {
    const definitions = condition.affixIds.map(id => catalog.affixes[id]);
    const prefixes = definitions.filter(affix => affix.type === 0).length;
    const suffixes = definitions.filter(affix => affix.type === 1).length;
    assert.ok(condition.minCount >= 1);
    assert.ok(condition.minCount <= Math.min(4, (prefixes ? 2 : 0) + (suffixes ? 2 : 0), prefixes + suffixes));
    assert.ok(condition.minTotalTier <= 28);
  }
});

test('budget accounting includes each three-rule terminal fallback', () => {
  const groups = [{ id: 'top', threshold: 40 }, { id: 'middle', threshold: 28 }, { id: 'entry', threshold: 18 }];
  for (const ruleLimit of [20, 50, 179, 180]) {
    const result = compileEquipmentScores({ pools, scoring, groups, catalog, ruleLimit });
    assert.ok(expandedCost(result) <= ruleLimit, `expanded cost respects ${ruleLimit}`);
    assert.equal(result.diagnostics.expandedRuleCount, expandedCost(result));
  }
});

test('cached compiler results isolate nested diagnostics and condition arrays', () => {
  const options = { pools, scoring, groups: thirtyGroups, catalog, ruleLimit: 180 };
  const first = compileEquipmentScores(options);
  const expected = structuredClone(first);
  first.diagnostics.errorBounds.maxGroupPromotion = -1;
  first.diagnostics.approximationReasons.push('caller mutation');
  first.rules.find(rule => rule.conditions.length).conditions[0].affixIds.length = 0;
  assert.deepEqual(compileEquipmentScores(options), expected);
});

const compare = (actual, operation, expected) => {
  switch (operation) {
    case 'ANY': return true;
    case 'EQUAL': return actual === expected;
    case 'LESS_OR_EQUAL': return actual <= expected;
    case 'MORE_OR_EQUAL': return actual >= expected;
    case 'MORE': return actual > expected;
    default: assert.fail(`Unexpected comparison ${operation}`);
  }
};
function nativeMatch(condition, affixes) {
  const matching = affixes.filter(affix => condition.affixIds.includes(affix.id) && compare(affix.tier, condition.comparison, condition.minTier));
  return matching.length >= condition.minCount && compare(matching.reduce((sum, affix) => sum + affix.tier, 0), condition.combinedComparison, condition.minTotalTier);
}

test('thirty-group approximation never demotes seven-affix items and reports conservative error bounds', () => {
  const result = compileEquipmentScores({ pools, scoring, groups: thirtyGroups, catalog, ruleLimit: 180 });
  const groups = [...thirtyGroups].sort((a, b) => b.threshold - a.threshold);
  const poolById = new Map(Object.entries(pools).flatMap(([pool, ids]) => ids.map(id => [id, pool])));
  const availablePools = Object.values(pools).filter(ids => ids.length);
  let seed = 981713;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let sample = 0; sample < 3000; sample++) {
    const affixes = [], used = new Set(), count = random(8);
    while (affixes.length < count) {
      const ids = availablePools[random(availablePools.length)];
      const id = ids[random(ids.length)];
      if (used.has(id)) continue;
      used.add(id);
      affixes.push({ id, tier: random(Math.min(8, catalog.affixes[id].tierCount)) + 1 });
    }
    const scoreUnits = affixes.reduce((sum, affix) => sum + Math.round(scoring[poolById.get(affix.id)][Math.min(7, affix.tier) - 1] * 100), 0);
    const matching = groups.findIndex(group => scoreUnits >= Math.round(group.threshold * 100));
    const trueRank = matching < 0 ? groups.length : matching;
    const rule = result.rules.find(candidate => candidate.conditions.every(condition => nativeMatch(condition, affixes)));
    assert.ok(rule, 'the equipment decision list is terminal');
    const rank = rule.groupId === EQUIPMENT_SCORE_FALLBACK ? groups.length : groups.findIndex(group => group.id === rule.groupId);
    assert.ok(rank <= trueRank, 'approximation may retain extra items but never demote a qualifying item');
    assert.ok(trueRank - rank <= result.diagnostics.errorBounds.maxGroupPromotion);
    if (rank < groups.length) assert.ok(Math.round(groups[rank].threshold * 100) - scoreUnits <= Math.round(result.diagnostics.errorBounds.maxScoreOverstatement * 100));
  }
});
