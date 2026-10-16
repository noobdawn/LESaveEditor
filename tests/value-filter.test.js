import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import catalog from '../web/src/data/filter-catalog.json' with { type: 'json' };
import { createValueFilterDraft, generateValueFilter, evaluateValueItem, matchValueFilterRule, VALUE_FILTER_GROUPS, COMMON_AFFIX_GROUPS, isValueEquipmentAffix, isValueIdolAffix } from '../web/src/core/value-filter.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
const encoded = (prefix, text) => `${prefix}${LZString.compressToBase64(text).replace(/=+$/, '')}`;
const af = id => encoded('A', String(id));
const base = (type, sub) => encoded('I', `1${String(type).padStart(3, '0')}${String(sub).padStart(3, '0')}000`);
const uid = id => encoded('U', `${String(catalog.uniques[id].subTypes[0]).padStart(3, '0')}${String(id).padStart(3, '0')}`);
const buildWith = (equipment, idols = []) => ({ ...structuredClone(fixture), data: { ...structuredClone(fixture.data), equipment, idols } });
function cleanDraft() {
  const d = createValueFilterDraft(buildWith({}));
  d.language = 'en'; d.uniqueIds = []; d.setIds = []; d.highAffixIds = []; d.mediumAffixIds = []; d.idols = [];
  return d;
}
const gear = affixes => ({ baseTypeId: 2, subTypeId: 2, rarity: 'EXALTED', affixes: affixes.map(([id, tier]) => ({ affixId: id, tier })) });
const result = (draft, item) => evaluateValueItem(draft, item).groupId;

test('public build preserves identities, separates equipment and idol pools, and leaves input intact', () => {
  const before = JSON.stringify(fixture), d = createValueFilterDraft(fixture);
  assert.equal(JSON.stringify(fixture), before);
  assert.deepEqual(d.uniqueIds, [8, 66, 253, 300, 332, 374, 447, 471]);
  assert.deepEqual(d.setIds, [79]);
  assert.deepEqual(d.highAffixIds, [22, 26, 36, 52, 73, 406, 408, 502, 505, 679, 825, 945, 1093]);
  assert.deepEqual(d.idols.map(r => [r.baseTypeId, r.subTypeId, r.affixIds, r.count]), [[30, 13, [287, 941], 1], [27, 1, [862, 870], 3], [26, 1, [842, 851], 4], [28, 0, [107, 117], 3]]);
  assert.ok(d.mediumAffixIds.length > 0 && d.mediumAffixIds.every(id => !d.highAffixIds.includes(id)));
  assert.equal(d.analysis.hasUnresolvedTargets, false);
  assert.deepEqual(d.build, d.analysis.build);
  assert.equal(d.analysis.targets.find(t => t.uniqueId === 300).affixes[0].origin, 'weaver_addition');
  assert.ok(COMMON_AFFIX_GROUPS.every(g => g.affixIds.every(id => isValueEquipmentAffix(catalog.affixes[id]))));
});

test('unique fixed variants and ir/ur are inherent while real additions from every affix block enter the pool', () => {
  const d = createValueFilterDraft(buildWith({
    ring1: { id: uid(477), affixes: [{ id: af(26), tier: 6 }, { id: af(1136), tier: 1 }], ir: [26], ur: [73] },
    amulet: { id: uid(469), corruptedAffix: { id: af(1083), tier: 1 } },
    waist: { id: base(2, 2), sealedAffix: { id: af(22), tier: 3 }, corruptedAffix: { id: af(36), tier: 4 }, primordialAffix: { id: af(73), tier: 8 }, affixes: [{ id: af(52), tier: 5 }] },
  }));
  assert.deepEqual(d.highAffixIds, [22, 26, 36, 52, 73]);
  assert.equal(d.analysis.targets.find(t => t.uniqueId === 477).inherentAffixes[0].id, 1136);
  assert.equal(d.analysis.targets.find(t => t.uniqueId === 469).inherentAffixes[0].id, 1083);
  assert.equal(d.analysis.targets.find(t => t.slot === 'waist').affixes.find(a => a.sourceRole === 'primordial').tier, 8);
  const sealed = createValueFilterDraft(buildWith({ ring1: { id: uid(477), sealedAffix: { id: af(1136), tier: 1 } } }));
  assert.deepEqual(sealed.highAffixIds, []);
  assert.equal(sealed.analysis.hasUnresolvedTargets, false);
  const amulet = createValueFilterDraft(buildWith({ amulet: { id: base(20, 0), corruptedAffix: { id: af(1083), tier: 4 } } }));
  assert.deepEqual(amulet.highAffixIds, [1083]);
  assert.equal(amulet.analysis.targets[0].affixes[0].origin, 'corruption');
  assert.equal(isValueEquipmentAffix(catalog.affixes[1083]), true);
  const invalid = createValueFilterDraft(buildWith({ ring1: { id: base(21, 0), sealedAffix: { id: af(1136), tier: 1 } } }));
  assert.equal(invalid.analysis.hasUnresolvedTargets, true);
});

test('unknown affixes preserve known unique identity and sibling affixes, disable default strict hiding, and cannot be ignored for export', () => {
  const d = createValueFilterDraft(buildWith({ ring1: { id: uid(66), affixes: [{ id: af(26), tier: 6 }, { id: af(65535), tier: 7 }] } }));
  assert.deepEqual(d.uniqueIds, [66]); assert.deepEqual(d.highAffixIds, [26]);
  assert.equal(d.analysis.hasUnresolvedTargets, true);
  assert.equal(d.groups.equipment_other.show, true); assert.equal(d.groups.idol_other.show, true);
  assert.doesNotThrow(() => generateValueFilter(d));
  d.groups.equipment_other.show = false;
  assert.throws(() => generateValueFilter(d), { code: 'UNRESOLVED_HIDE_TARGETS' });
});

test('Q9JP5wbn fixed glove variants retain their source tiers without becoming primordial or high-value targets', () => {
  const source = JSON.parse(readFileSync(new URL('./fixtures/planner-Q9JP5wbn.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(source), draft = createValueFilterDraft(source);
  const hands = draft.analysis.targets.find(target => target.slot === 'hands');
  assert.ok(!draft.analysis.warnings.some(w => w.code === 'UNRESOLVED_TARGET' && w.sourcePath?.startsWith('data.equipment.hands')));
  assert.deepEqual(hands.inherentAffixes.map(a => [a.id, a.tier, a.sourceRole]), [[1145, 5, 'fixed_variant'], [1147, 4, 'fixed_variant']]);
  assert.deepEqual(hands.affixes.map(a => [a.id, a.tier]), [[503, 7], [17, 7], [80, 5], [1027, 6]]);
  assert.ok(draft.uniqueIds.includes(479));
  assert.ok(!draft.highAffixIds.includes(1145) && !draft.highAffixIds.includes(1147));
  assert.ok([503, 17, 80, 1027].every(id => draft.highAffixIds.includes(id)));

  assert.doesNotThrow(() => generateValueFilter(draft));
  assert.equal(JSON.stringify(source), before);
  const wrongUnique = structuredClone(source);
  wrongUnique.data.equipment.hands.id = uid(477);
  assert.equal(createValueFilterDraft(wrongUnique).analysis.hasUnresolvedTargets, true);
  const truePrimordial = structuredClone(source);
  truePrimordial.data.equipment.hands.primordialAffix = { id: af(501), tier: 4 };
  assert.ok(createValueFilterDraft(truePrimordial).analysis.warnings.some(w => w.code === 'UNRESOLVED_TARGET' && /T8/.test(w.message.en)));
});

test('same-shape idol pools allow recombination but require one selected prefix and suffix', () => {
  const d = cleanDraft();
  const candidates = Object.values(catalog.affixes).filter(a => isValueIdolAffix(a, 25));
  const prefixes = candidates.filter(a => a.type === 0).slice(0, 2).map(a => a.id), suffixes = candidates.filter(a => a.type === 1).slice(0, 2).map(a => a.id);
  d.idols = [{ id: 'one', baseTypeId: 25, subTypeId: 0, affixIds: [prefixes[0], suffixes[0]], enabled: true }, { id: 'two', baseTypeId: 25, subTypeId: 0, affixIds: [prefixes[1], suffixes[1]], enabled: true }];
  const idol = selected => ({ baseTypeId: 25, rarity: 'RARE', affixes: selected.map(id => ({ id, tier: 1 })) });
  assert.equal(result(d, idol([prefixes[0], suffixes[1]])), 'idol_double');
  assert.equal(result(d, idol(prefixes)), 'idol_single');
  assert.equal(result(d, idol([suffixes[0]])), 'idol_single');
  assert.equal(result(d, { ...idol([prefixes[0], suffixes[1]]), baseTypeId: 26 }), 'idol_other');
  d.groups.idol_double.show = false;
  assert.equal(evaluateValueItem(d, idol([prefixes[0], suffixes[1]])).outcome, 'HIDE');
});

test('empty enabled idols and mismatched shapes are rejected, disabled empty rows are ignored', () => {
  const d = cleanDraft(); d.idols = [{ id: 'new', baseTypeId: 25, affixIds: [], enabled: true }];
  assert.throws(() => generateValueFilter(d), { code: 'EMPTY_IDOL_SELECTION' });
  d.idols[0].enabled = false; assert.doesNotThrow(() => generateValueFilter(d));
  d.idols[0].enabled = true; d.idols[0].affixIds = [941];
  assert.throws(() => generateValueFilter(d), { code: 'INCOMPATIBLE_IDOL_AFFIX' });
});

test('uniques prioritize identity then rarity then LP, excluding Weaver potential and equipment rules', () => {
  const d = cleanDraft(); const rare = Object.values(catalog.uniques).find(u => !u.isSetItem && !u.hideFromPlayers && u.canDropRandomly && u.rerollChance >= 0.9);
  const common = Object.values(catalog.uniques).find(u => !u.isSetItem && !u.hideFromPlayers && u.legendaryType === 0 && u.rerollChance < 0.9);
  const item = id => ({ uniqueId: id, baseTypeId: catalog.uniques[id].baseType, rarity: 'UNIQUE', legendaryPotential: 3, affixes: [{ id: 26, tier: 7 }] });
  d.highAffixIds = [26]; d.uniqueIds = [rare.id];
  assert.equal(result(d, item(rare.id)), 'unique_needed');
  d.uniqueIds = []; assert.equal(result(d, item(rare.id)), 'unique_rare');
  assert.equal(result(d, item(common.id)), 'unique_high_lp');
  assert.equal(result(d, { ...item(common.id), legendaryPotential: 1 }), 'unique_common');
  d.options.rareUniqueThreshold = 1;
  assert.equal(result(d, item(300)), 'unique_common');
  const uniqueRule = generateValueFilter({ ...d, uniqueIds: [0] }).rules.find(r => r.groupId === 'unique_needed');
  assert.equal(matchValueFilterRule(uniqueRule, { uniqueId: 0, rarity: 'RARE' }), false);
});

test('valuable sets combine selected and rare identities; reforged legendary sets stay in set groups', () => {
  const d = cleanDraft();
  assert.equal(result(d, { uniqueId: 88, rarity: 'SET' }), 'set_valuable');
  assert.equal(result(d, { uniqueId: 79, rarity: 'SET' }), 'set_common');
  assert.equal(result(d, { uniqueId: 79, rarity: 'LEGENDARY' }), 'set_common');
  d.setIds = [79];
  assert.equal(result(d, { uniqueId: 79, rarity: 'LEGENDARY' }), 'set_valuable');
});

test('empty pools never emit broad affix rules; invalid selections and XML text fail safely', () => {
  const d = cleanDraft(); let g = generateValueFilter(d);
  assert.ok(g.rules.every(r => r.conditions.every(c => c.type !== 'affix' || c.affixIds.length)));
  assert.equal(result(d, gear([])), 'equipment_other');
  d.highAffixIds = [1136]; assert.throws(() => generateValueFilter(d), { code: 'INVALID_EQUIPMENT_AFFIX' });
  d.highAffixIds = [65535]; assert.throws(() => generateValueFilter(d), { code: 'UNKNOWN_FILTER_ID' });
  d.highAffixIds = []; d.name = 'Bad\u0000name'; assert.throws(() => generateValueFilter(d), { code: 'INVALID_XML_TEXT' });
  d.name = '中文 <Rule> & "quoted"'; g = generateValueFilter(d);
  assert.ok(g.xml.includes('中文 &lt;Rule&gt; &amp; &quot;quoted&quot;'));
  const orders = [...g.xml.matchAll(/<Order>(\d+)<\/Order>/g)].map(match => Number(match[1]));
  assert.deepEqual(orders, g.rules.map(r => r.order).reverse());
  d.groups.altar.color = 18; assert.throws(() => generateValueFilter(d), { code: 'INVALID_FILTER_VALUE' });
});


test('fixed equipment styles apply to the single native rule and resources keep their own scope', () => {
  const d = createValueFilterDraft(fixture);
  Object.assign(d.groups.equipment_crafting, { show: false, color: 17, emphasized: true });
  const generated = generateValueFilter(d), rules = generated.rules.filter(r => r.groupId === 'equipment_crafting');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, 'HIDE');
  assert.deepEqual(rules[0].style, { color: 17, emphasized: true });
  assert.equal(evaluateValueItem(d, { baseTypeId: 41, rarity: 'RARE', affixes: [] }).outcome, 'SHOW');
  for (const kind of ['glyph', 'rune', 'shard', 'key']) {
    assert.equal(result(d, { resourceKind: kind }), kind);
    d.groups[kind].show = false;
    assert.equal(evaluateValueItem(d, { resourceKind: kind }).outcome, 'HIDE');
  }
  assert.deepEqual(evaluateValueItem(d, { kind: 'gold' }), { groupId: null, outcome: 'SHOW', rule: null });
  assert.equal(generated.groups.length, VALUE_FILTER_GROUPS.length - 1);
});
