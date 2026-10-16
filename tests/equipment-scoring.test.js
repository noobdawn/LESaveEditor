import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createValueFilterDraft, VALUE_FILTER_DEFAULT_SCORING, getEquipmentItemScore, getEquipmentScoreThreshold, getEquipmentScoreRange, normalizeEquipmentScoring } from '../web/src/core/value-filter.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
function draft() {
  const value = createValueFilterDraft(fixture);
  value.highAffixIds = [26, 73, 36, 22]; value.mediumAffixIds = [52];
  return value;
}
const item = (...pairs) => ({ affixes: pairs.map(([id, tier]) => ({ id, tier })) });

test('new drafts contain independent editable T1–T7 score tables with the requested defaults', () => {
  const first = draft(), second = draft();
  assert.deepEqual(first.scoring.high.toReversed(), [10, 5, 2, 1.6, 1.2, 0.8, 0.4]);
  assert.deepEqual(first.scoring.medium.toReversed(), [4, 2, 1, 0.8, 0.6, 0.4, 0.2]);
  assert.deepEqual(first.scoring.low.toReversed(), [2, 1, 0, -0.2, -0.2, -0.2, -0.2]);
  first.scoring.high[6] = 9;
  assert.equal(second.scoring.high[6], 10);
  assert.equal(VALUE_FILTER_DEFAULT_SCORING.high[6], 10);
  assert.deepEqual(second.equipmentGroups.map(g => g.threshold), [100, 70, 45]);
  assert.ok(second.equipmentGroups.every(g => g.name.includes('%')));
});

test('every category and tier contributes the configured score, with T8 using T7', () => {
  const value = draft();
  for (const [category, id] of [['high', 26], ['medium', 52], ['low', 70]]) {
    for (let tier = 1; tier <= 8; tier++) {
      const result = getEquipmentItemScore(value, item([id, tier]));
      assert.equal(result.rawScore, value.scoring[category][Math.min(tier, 7) - 1]);
      assert.equal(result.contributions[0].category, category);
    }
  }
  assert.equal(getEquipmentItemScore(value, item([26, 6], [73, 6], [36, 6], [22, 6])).rawScore, 20);
  assert.equal(getEquipmentItemScore(value, item([26, 6], [52, 4])).rawScore, 5.8);
  assert.equal(getEquipmentItemScore(value, item([52, 5])).rawScore, 1);
});

test('empty slots cost zero while negative scores and all additional affix sources remain exact', () => {
  const value = draft();
  assert.equal(getEquipmentItemScore(value, item()).rawScore, 0);
  assert.equal(getEquipmentItemScore(value, item([70, 1])).rawScore, -0.2);
  const candidate = { ...item([26, 6], [52, 4], [70, 1], [50, 2]),
    sealedAffix: { id: 36, tier: 1 }, corruptedAffix: { id: 22, tier: 3 }, primordialAffix: { id: 73, tier: 8 } };
  assert.equal(getEquipmentItemScore(value, candidate).rawScore, 17);
  value.scoring.high[0] = -1.23;
  value.scoring.medium[3] = 0.17;
  value.scoring.low[0] = 0.06;
  assert.equal(getEquipmentItemScore(value, item([26, 1], [52, 4], [70, 1])).rawScore, -1);
  assert.equal(getEquipmentItemScore(value, item([26, 1], [52, 4], [70, 1])).scoreUnits, -100);
});

test('moving affixes between pools uses the current category and high-value wins overlap', () => {
  const value = draft(), candidate = item([52, 6]);
  assert.equal(getEquipmentItemScore(value, candidate).rawScore, 2);
  value.highAffixIds.push(52);
  assert.equal(getEquipmentItemScore(value, candidate).rawScore, 5);
  value.highAffixIds = []; value.mediumAffixIds = [];
  assert.equal(getEquipmentItemScore(value, candidate).rawScore, 1);
});

test('percentage thresholds use four high-value T7 scores and examples use the edited table', () => {
  const value = draft();
  assert.equal(getEquipmentScoreThreshold(70, value.scoring).rawScore, 28);
  assert.equal(getEquipmentScoreThreshold(70, value.scoring).scoreUnits, 2800);
  const before = getEquipmentScoreThreshold(10, value.scoring).example.en;
  value.scoring = { high: Array(7).fill(0), medium: Array(7).fill(0), low: Array(7).fill(0) };
  value.scoring.high[0] = 1; value.scoring.high[6] = 2;
  assert.match(getEquipmentScoreThreshold(10, value.scoring).example.en, /1 high-value T1/);
  assert.notEqual(getEquipmentScoreThreshold(10, value.scoring).example.en, before);
  assert.deepEqual(getEquipmentScoreRange(), { min: 1, max: 100, step: 1 });
});

test('invalid or overprecise scores are rejected without mutating or replacing user input', () => {
  const original = draft();
  for (const invalid of ['', null, true, NaN, Infinity, 0.001, 1001, -1001]) {
    const scoring = structuredClone(original.scoring); scoring.high[6] = invalid;
    assert.throws(() => normalizeEquipmentScoring(scoring));
    assert.ok(Object.is(scoring.high[6], invalid));
  }
  for (const invalid of [null, {}, { high: Array(7), medium: Array(7).fill(1), low: Array(7).fill(0) }, { high: [1], medium: Array(7).fill(1), low: Array(7).fill(0) }]) assert.throws(() => normalizeEquipmentScoring(invalid));
  for (const invalid of ['', null, true, NaN, Infinity, 0, 1.5, 101, -1]) assert.throws(() => getEquipmentScoreThreshold(invalid));
});

test('percentage boundaries round upward at hundredth-point precision and reject a nonpositive reference', () => {
  const value = draft(); value.scoring.high[6] = 0.01;
  assert.deepEqual(getEquipmentScoreThreshold(1, value.scoring), { rawScore: 0.0004, scoreUnits: 1, effectiveScore: 0.01, example: getEquipmentScoreThreshold(1, value.scoring).example });
  assert.equal(getEquipmentItemScore(value, item([26, 7], [73, 7], [36, 7], [22, 7])).percentage, 100);
  for (const reference of [0, -1]) {
    value.scoring.high[6] = reference;
    assert.throws(() => getEquipmentScoreThreshold(100, value.scoring), { code: 'INVALID_SCORE_REFERENCE' });
  }
});
