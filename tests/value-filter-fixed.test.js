import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createValueFilterDraft, generateValueFilter, evaluateValueItem,
  EQUIPMENT_FILTER_GROUPS, FILTER_IDOL_BASES, getOtherClassIdolKeys,
} from '../web/src/core/value-filter.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
function draft() {
  const d = createValueFilterDraft(fixture);
  // All four IDs can appear on a relic: two prefixes and two suffixes.
  d.highAffixIds = [26]; d.mediumAffixIds = [73, 25, 22];
  return d;
}
const item = (affixes, overrides = {}) => ({ baseTypeId: 22, subTypeId: 0, rarity: 'EXALTED', affixes: affixes.map(([id, tier]) => ({ id, tier })), ...overrides });

test('four fixed global templates generate once each, without a scoring configuration', () => {
  const d = draft(), before = JSON.stringify(d), result = generateValueFilter(d);
  assert.equal('scoring' in d, false);
  assert.equal('equipmentGroups' in d, false);
  assert.equal(EQUIPMENT_FILTER_GROUPS.length, 4);
  for (const group of EQUIPMENT_FILTER_GROUPS) {
    const rules = result.rules.filter(rule => rule.groupId === group.id);
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].conditions.find(c => c.type === 'subtype').baseTypeIds, Array.from({ length: 25 }, (_, i) => i));
  }
  assert.equal(result.diagnostics.equipmentRuleCount, 4);
  assert.equal(result.diagnostics.approximate, false);
  assert.equal(JSON.stringify(d), before);
});

test('tier boundaries, useful counts and first-match precedence follow the four fixed categories', () => {
  const d = draft();
  const cases = [
    [[[26, 7]], 'equipment_core'],
    [[[26, 6]], 'equipment_core'],
    [[[26, 8]], 'equipment_core'],
    [[[73, 6], [25, 2], [22, 1]], 'equipment_useful'],
    [[[73, 6], [25, 2]], 'equipment_other'],
    [[[26, 5], [25, 5]], 'equipment_crafting'],
    [[[26, 5], [25, 4]], 'equipment_other'],
    [[[26, 4], [25, 3], [73, 2]], 'equipment_leveling'],
    [[[26, 5], [25, 4], [73, 2]], 'equipment_leveling'],
    [[[26, 1], [25, 1], [73, 1]], 'equipment_leveling'],
    [[[26, 4], [25, 3]], 'equipment_other'],
    [[[73, 5], [25, 5], [22, 5]], 'equipment_other'],
    [[[26, 6], [25, 6], [73, 6]], 'equipment_core'],
  ];
  for (const [affixes, expected] of cases) assert.equal(evaluateValueItem(d, item(affixes)).groupId, expected, JSON.stringify(affixes));
  assert.equal(evaluateValueItem(d, item([[26, 6]], { rarity: 'RARE' })).groupId, 'equipment_other');
  assert.equal(evaluateValueItem(d, item([[26, 5], [25, 5]], { rarity: 'RARE' })).groupId, 'equipment_crafting');
  assert.equal(evaluateValueItem(d, item([[26, 6], [502, 1], [501, 1], [1, 7]])).groupId, 'equipment_core', 'unselected affixes do not subtract value');
  assert.equal(evaluateValueItem(d, item([[501, 7], [502, 7]])).outcome, 'HIDE', 'unselected T7 affixes do not count as useful');
});

test('H is included in U once and additional affix fields participate', () => {
  const d = draft(); d.mediumAffixIds.push(26);
  const output = generateValueFilter(d);
  const useful = output.rules.find(r => r.groupId === 'equipment_useful').conditions.filter(c => c.type === 'affix');
  assert.ok(useful.every(c => c.affixIds.filter(id => id === 26).length === 1));
  assert.equal(evaluateValueItem(d, item([[26, 4], [25, 3]], { sealedAffix: { id: 73, tier: 2 } })).groupId, 'equipment_leveling');
});

test('type exclusions follow unique and set groups and override all four ordinary equipment categories', () => {
  const d = draft();
  const ordinary = [
    [item([[26, 7]]), 'equipment_core'],
    [item([[73, 6], [25, 2], [22, 1]]), 'equipment_useful'],
    [item([[26, 5], [25, 5]], { rarity: 'RARE' }), 'equipment_crafting'],
    [item([[26, 4], [25, 3], [73, 2]], { rarity: 'RARE' }), 'equipment_leveling'],
  ];
  for (const [candidate, groupId] of ordinary) assert.equal(evaluateValueItem(d, candidate).groupId, groupId);
  d.exclusions.equipmentTypeIds = [22, 12, 13, 0, 7, 21];
  const output = generateValueFilter(d), excluded = output.rules.findIndex(r => r.groupId === 'excluded');
  assert.ok(output.rules.filter(r => /^(unique|set)_/.test(r.groupId)).every(r => r.order < excluded));
  assert.ok(output.rules.filter(r => /^equipment_/.test(r.groupId)).every(r => r.order > excluded));
  assert.equal(output.rules.filter(r => r.id === 'excluded-types').length, 1);
  for (const [candidate] of ordinary) {
    const result = evaluateValueItem(d, candidate);
    assert.equal(result.groupId, 'excluded'); assert.equal(result.outcome, 'HIDE');
  }
  assert.equal(evaluateValueItem(d, item([[26, 7]], { baseTypeId: 20 })).groupId, 'equipment_core');
  assert.equal(evaluateValueItem(d, { baseTypeId: 0, uniqueId: 471, rarity: 'UNIQUE' }).groupId, 'unique_needed');
  assert.equal(evaluateValueItem(d, { baseTypeId: 7, uniqueId: 79, rarity: 'SET' }).groupId, 'set_valuable');
  assert.equal(evaluateValueItem(d, { baseTypeId: 7, uniqueId: 79, rarity: 'LEGENDARY' }).groupId, 'set_valuable');
  d.uniqueIds = []; d.setIds = []; d.options.rareUniqueThreshold = 1;
  assert.equal(evaluateValueItem(d, { baseTypeId: 21, uniqueId: 66, rarity: 'UNIQUE', legendaryPotential: 3 }).groupId, 'unique_high_lp');
  assert.equal(evaluateValueItem(d, { baseTypeId: 21, uniqueId: 66, rarity: 'LEGENDARY', legendaryPotential: 0 }).groupId, 'unique_common');
  assert.equal(evaluateValueItem(d, { baseTypeId: 7, uniqueId: 79, rarity: 'SET' }).groupId, 'set_common');
  d.groups.set_common.show = false;
  assert.equal(evaluateValueItem(d, { baseTypeId: 7, uniqueId: 79, rarity: 'SET' }).outcome, 'HIDE');
  for (const rarity of ['UNIQUE', 'SET', 'LEGENDARY']) assert.equal(evaluateValueItem(d, { baseTypeId: 21, uniqueId: 65535, rarity }).outcome, 'SHOW', 'type exclusions cannot hide unknown unique or set identities');
  for (const resourceKind of ['glyph', 'rune', 'shard', 'key']) assert.equal(evaluateValueItem(d, { resourceKind }).outcome, 'SHOW');
  assert.equal(evaluateValueItem(d, { baseTypeId: 41 }).outcome, 'SHOW');
});

test('other-class idol selection uses item class bits and preserves Mage and general bases', () => {
  const keys = getOtherClassIdolKeys(1);
  assert.ok(keys.includes('30:4'), 'Rogue large idol');
  assert.ok(keys.includes('30:9'), 'Rogue heretical large idol');
  assert.ok(keys.includes('30:14'), 'Rogue omen large idol');
  assert.ok(!keys.includes('30:1'), 'Mage large idol');
  assert.ok(!keys.includes('30:6'), 'Mage heretical large idol');
  assert.ok(!keys.includes('25:0'), 'general idol');
  assert.ok(FILTER_IDOL_BASES.filter(b => keys.includes(b.key)).every(b => b.classRequirement && !(b.classRequirement & 2)));
  assert.deepEqual(getOtherClassIdolKeys(null), []);
  const d = draft(); d.build.classId = 1; d.groups.idol_other.show = true; d.exclusions.idolBaseKeys = keys;
  for (const subTypeId of [4, 9, 14]) assert.equal(evaluateValueItem(d, { baseTypeId: 30, subTypeId, rarity: 'RARE' }).outcome, 'HIDE');
  for (const subTypeId of [1, 6, 11]) assert.equal(evaluateValueItem(d, { baseTypeId: 30, subTypeId, rarity: 'RARE' }).outcome, 'SHOW');
  const hides = generateValueFilter(d).rules.filter(r => r.groupId === 'excluded');
  assert.equal(hides.length, 1, 'all other-class idols share one native class rule');
  assert.equal(hides[0].name.zh, '隐藏非本职业神像');
  assert.deepEqual(hides[0].conditions.find(c => c.type === 'subtype').baseTypeIds, [25,26,27,28,29,30,31,32,33]);
  assert.equal(hides[0].conditions.find(c => c.type === 'class').classRequirement, 29);
  assert.equal(hides[0].conditions.some(c => c.type === 'rarity'), false);
  for (const base of FILTER_IDOL_BASES) {
    const result = evaluateValueItem(d, { baseTypeId: base.baseType, subTypeId: base.subType });
    assert.equal(result.outcome, keys.includes(base.key) ? 'HIDE' : 'SHOW', base.key);
  }
  d.exclusions.idolBaseKeys = keys.filter(key => key !== '30:4');
  assert.equal(evaluateValueItem(d, { baseTypeId: 30, subTypeId: 4 }).outcome, 'SHOW', 'partial class selection cannot become a broad class hide');
  assert.equal(evaluateValueItem(d, { baseTypeId: 30, subTypeId: 9 }).outcome, 'HIDE');
  d.exclusions.idolBaseKeys = keys;
  d.exclusions.idolTypeIds = [30];
  const output = generateValueFilter(d);
  assert.ok(!output.rules.some(r => r.id === 'excluded-idols-30'), 'whole-shape exclusion subsumes its selected bases');
  assert.equal(evaluateValueItem(d, { baseTypeId: 30, subTypeId: 1, rarity: 'RARE' }).outcome, 'HIDE');
});

test('XML preserves native order, multi-type scope, exact idol subtypes and four fixed names', () => {
  const d = draft(); d.exclusions.equipmentTypeIds = [12, 13]; d.exclusions.idolBaseKeys = ['30:4', '30:9', '30:14'];
  const output = generateValueFilter(d);
  const xmlRules = [...output.xml.matchAll(/<Rule>([\s\S]*?)<\/Rule>/g)].map(match => match[1]).reverse();
  assert.equal(xmlRules.length, output.rules.length);
  const hiddenIndex = output.rules.findIndex(rule => rule.groupId === 'excluded');
  assert.ok(hiddenIndex > 0);
  assert.match(xmlRules[hiddenIndex], /<type>HIDE<\/type>/);
  assert.match(xmlRules[hiddenIndex], /<EquipmentType>TWO_HANDED_AXE<\/EquipmentType><EquipmentType>TWO_HANDED_MACE<\/EquipmentType>/);
  assert.match(xmlRules[hiddenIndex + 1], /<EquipmentType>IDOL_1x3<\/EquipmentType>/);
  assert.match(xmlRules[hiddenIndex + 1], /<subTypes><int>4<\/int><int>9<\/int><int>14<\/int><\/subTypes>/);
  assert.equal((xmlRules[hiddenIndex + 1].match(/<EquipmentType>/g) ?? []).length, 1);
  for (const name of ['核心词缀崇高装备', '有效词缀崇高装备', '考虑打造装备', '开荒过渡装备']) assert.equal(xmlRules.filter(rule => rule.includes(`<nameOverride>${name}</nameOverride>`)).length, 1);
  assert.doesNotMatch(output.xml, /评分|近似|equipment_score|__equipment_fallback__/);
  assert.equal(output.rules.length <= 200, true);
});

test('empty pools cannot export wildcard affixes and invalid exclusions are rejected', () => {
  const d = draft(); d.highAffixIds = []; d.mediumAffixIds = [];
  const output = generateValueFilter(d);
  assert.equal(output.diagnostics.equipmentRuleCount, 0);
  assert.ok(!output.rules.some(r => r.conditions.some(c => c.type === 'affix' && !c.affixIds.length)));
  d.exclusions.idolBaseKeys = ['30:999'];
  assert.throws(() => generateValueFilter(d), { code: 'INVALID_FILTER_EXCLUSIONS' });
  d.exclusions.idolBaseKeys = []; d.exclusions.equipmentTypeIds = [41];
  assert.throws(() => generateValueFilter(d), { code: 'INVALID_FILTER_EXCLUSIONS' });
});

test('idol needs and fallbacks match items without equipment rarity and hide names state their purpose', () => {
  const d = draft(); d.language = 'en';
  d.idols = [{ id: 'general', baseTypeId: 25, subTypeId: 0, affixIds: [108, 114], enabled: true }];
  const idol = affixes => ({ baseTypeId: 25, subTypeId: 0, affixes: affixes.map(id => ({ id, tier: 1 })) });
  assert.equal(evaluateValueItem(d, idol([108, 114])).groupId, 'idol_double');
  assert.equal(evaluateValueItem(d, idol([108])).groupId, 'idol_single');
  assert.equal(evaluateValueItem(d, idol([])).groupId, 'idol_other');
  d.exclusions.equipmentTypeIds = [12]; d.exclusions.idolTypeIds = [30]; d.exclusions.idolBaseKeys = ['25:0'];
  const output = generateValueFilter(d);
  assert.equal(evaluateValueItem(d, idol([108, 114])).outcome, 'HIDE');
  for (const rule of output.rules.filter(rule => rule.groupId.startsWith('idol_') || rule.groupId === 'excluded' && rule.id !== 'excluded-types')) assert.ok(rule.conditions.every(condition => condition.type !== 'rarity'));
  for (const expected of ['Hide selected equipment types', 'Hide selected idol types', 'Hide selected idol bases (Small Idol)']) assert.ok(output.rules.some(rule => rule.name.en === expected), expected);
  assert.match(output.xml, /<nameOverride>Hide selected idol types<\/nameOverride>/);
  assert.equal(evaluateValueItem(d, { baseTypeId: 30, subTypeId: 4 }).outcome, 'HIDE');
});

test('all selected idol shapes share exactly one double rule and one single rule', () => {
  const d = draft();
  d.idols = [
    { id: 'small', baseTypeId: 25, subTypeId: 0, affixIds: [108, 114], enabled: true },
    { id: 'large', baseTypeId: 30, subTypeId: 0, affixIds: [941, 287], enabled: true },
    { id: 'stout', baseTypeId: 28, subTypeId: 0, affixIds: [107, 117], enabled: true },
    { id: 'disabled', baseTypeId: 26, subTypeId: 0, affixIds: [842], enabled: false },
  ];
  const output = generateValueFilter(d);
  for (const groupId of ['idol_double', 'idol_single']) {
    const rules = output.rules.filter(rule => rule.groupId === groupId);
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].conditions.find(c => c.type === 'subtype').baseTypeIds, [25,26,27,28,29,30,31,32,33]);
    assert.equal(rules[0].conditions.some(c => c.type === 'rarity'), false);
    assert.equal(output.groups.find(group => group.id === groupId).ruleCount, 1);
  }
  const idol = (baseTypeId, ids) => ({ baseTypeId, affixes: ids.map(id => ({ id, tier: 1 })) });
  assert.equal(evaluateValueItem(d, idol(29, [108,114])).groupId, 'idol_double', 'selected affixes apply to another compatible shape');
  assert.equal(evaluateValueItem(d, idol(30, [941,117])).groupId, 'idol_double', 'a valid pair can draw affixes from different selected needs');
  assert.equal(evaluateValueItem(d, idol(26, [117])).groupId, 'idol_single');
  assert.equal(evaluateValueItem(d, idol(30, [117,287])).groupId, 'idol_single', 'two suffixes cannot satisfy the double group');
  assert.equal(evaluateValueItem(d, idol(26, [842])).groupId, 'idol_other', 'disabled needs do not contribute affixes');
  d.groups.idol_double.show = false;
  assert.equal(evaluateValueItem(d, idol(30, [941,117])).outcome, 'HIDE', 'double-group HIDE precedes the shared single rule');
  d.idols = [{ id: 'prefix-only', baseTypeId: 25, subTypeId: 0, affixIds: [108], enabled: true }];
  assert.equal(generateValueFilter(d).rules.filter(rule => rule.groupId === 'idol_double').length, 0);
  assert.equal(generateValueFilter(d).rules.filter(rule => rule.groupId === 'idol_single').length, 1);
  d.idols = [];
  assert.equal(generateValueFilter(d).rules.filter(rule => ['idol_double','idol_single'].includes(rule.groupId)).length, 0);
});
