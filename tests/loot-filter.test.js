import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import itemCatalog from '../web/src/core/game-item-data.json' with { type: 'json' };
import { analyzeFilterBuild, createFilterDraft, createFilterRow, generateFilter, previewFilterMatch, matchFilterRule, getFilterRowMaxCount, DEFAULT_OPTIONS, DEFAULT_STYLES, FILTER_CATALOG } from '../web/src/core/loot-filter.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
const af = id => `A${LZString.compressToBase64(String(id)).replace(/=+$/, '')}`;
const base = (type, sub) => `I${LZString.compressToBase64(`1${String(type).padStart(3, '0')}${String(sub).padStart(3, '0')}000`).replace(/=+$/, '')}`;
const quiet = { ...DEFAULT_OPTIONS, showRareUniques: false, showRareAffixes: false };
const draftWith = rows => ({ name: 'Test filter', language: 'en', rows, options: { ...quiet }, styles: structuredClone(DEFAULT_STYLES) });
const rowWith = overrides => createFilterRow('affix', { affixIds: [26], baseTypeIds: [2], minTier: 5, ...overrides });

test('public build preserves exact identities, idol pairs, special routes and original payload', () => {
  const before = JSON.stringify(fixture), draft = createFilterDraft(fixture), analysis = draft.analysis;
  assert.equal(JSON.stringify(fixture), before);
  assert.deepEqual(analysis.summary, { equipmentCount: 12, idolCount: 11, uniqueCount: 9, affixCount: 21 });
  assert.equal(draft.rows.find(r => r.id === 'unique-66').count, 2);
  assert.equal(analysis.targets.find(t => t.uniqueId === 79).kind, 'set');
  assert.equal(analysis.targets.find(t => t.uniqueId === 300).kind, 'weaver');
  assert.equal(analysis.targets.find(t => t.uniqueId === 447).kind, 'primordial');
  assert.deepEqual(draft.rows.filter(r => r.kind === 'idol').map(r => [r.baseTypeIds[0], r.subTypeIds[0], r.affixIds, r.count]), [
    [30, 13, [941, 287], 1], [27, 1, [862, 870], 3], [26, 1, [842, 851], 4], [28, 0, [107, 117], 3],
  ]);
  assert.equal(analysis.hasUnresolvedTargets, false);
  assert.ok(draft.rows.filter(r => r.slot === 'relic' && r.sourceAffixes).every(r => !r.enabled && r.purpose !== 'donor'));
  assert.ok(draft.rows.filter(r => r.purpose === 'shatter').every(r => r.affixIds.every(id => FILTER_CATALOG.affixes[id].hasShard)));
  assert.equal(draft.rows.some(r => r.purpose === 'shatter' && r.affixIds.includes(679)), false);
});

test('legendary material rules remain slot-specific, exalted and uncorrupted', () => {
  const draft = createFilterDraft(fixture); draft.options = { ...quiet };
  const { rules, warnings } = generateFilter(draft);
  const donor = rules.find(r => r.sourceRowId?.startsWith('affix-head-donor'));
  const candidate = { baseTypeId: 0, subTypeId: 1, rarity: 'EXALTED', corrupted: false, affixes: [{ affixId: 408, tier: 7 }] };
  assert.ok(matchFilterRule(donor, candidate));
  assert.equal(matchFilterRule(donor, { ...candidate, baseTypeId: 3 }), false);
  assert.equal(matchFilterRule(donor, { ...candidate, rarity: 'RARE' }), false);
  assert.equal(matchFilterRule(donor, { ...candidate, corrupted: true }), false);
  assert.equal(matchFilterRule(donor, { ...candidate, affixes: [{ affixId: 408, tier: 6 }] }), false);
  // The game condition also counts sealed affixes: the UI must not claim recipe readiness.
  assert.ok(matchFilterRule(donor, { ...candidate, affixes: [{ affixId: 408, tier: 7, sealed: true }] }));
  assert.ok(warnings.some(w => w.code === 'DONOR_CANDIDATE' && w.rowId === donor.sourceRowId && /sealed/.test(w.message.en)));
});

test('purpose changes alter eligibility and reject impossible shard or donor routes', () => {
  const row = rowWith({ purpose: 'crafting' }), draft = draftWith([row]);
  let rule = generateFilter(draft).rules[0];
  const rare = { baseTypeId: 2, rarity: 'RARE', corrupted: false, affixes: [{ affixId: 26, tier: 5 }] };
  assert.ok(matchFilterRule(rule, rare));
  row.purpose = 'donor'; rule = generateFilter(draft).rules[0];
  assert.equal(matchFilterRule(rule, rare), false);
  row.purpose = 'shatter'; rule = generateFilter(draft).rules[0];
  assert.ok(matchFilterRule(rule, { ...rare, corrupted: true }));
  row.affixIds = [679]; row.baseTypeIds = [3];
  assert.throws(() => generateFilter(draft), { code: 'AFFIX_HAS_NO_SHARD' });
  row.purpose = 'donor'; row.affixIds = [1093]; row.baseTypeIds = [41];
  assert.throws(() => generateFilter(draft), { code: 'UNSUPPORTED_DONOR_TYPE' });
});

test('idol target matching never flattens pairs or accepts another shape', () => {
  const draft = createFilterDraft(fixture); draft.options = { ...quiet };
  const rule = generateFilter(draft).rules.find(r => r.sourceRowId === 'idol-27-1-862-870');
  const idol = { baseTypeId: 27, subTypeId: 1, rarity: 'RARE', affixes: [{ affixId: 862, tier: 1 }, { affixId: 870, tier: 1 }] };
  assert.ok(matchFilterRule(rule, idol));
  assert.equal(matchFilterRule(rule, { ...idol, affixes: [{ affixId: 862, tier: 1 }, { affixId: 851, tier: 1 }] }), false);
  assert.equal(matchFilterRule(rule, { ...idol, baseTypeId: 26 }), false);
  assert.equal(matchFilterRule(rule, { ...idol, subTypeId: 0 }), false);
});

test('ordinary and Weaver idol feasibility reserves one prefix and one suffix, not two prefixes', () => {
  assert.equal(FILTER_CATALOG.affixes[108].type, 0);
  assert.equal(FILTER_CATALOG.affixes[118].type, 0);
  assert.equal(getFilterRowMaxCount([108, 118], true), 1);
  assert.equal(getFilterRowMaxCount([842, 851], true), 2);
  const impossible = createFilterRow('idol', { affixIds: [108, 118], baseTypeIds: [25], minCount: 2 });
  assert.throws(() => generateFilter(draftWith([impossible])), { code: 'INVALID_FILTER_VALUE' });
  impossible.minCount = 1; impossible.minTotalTier = 2;
  assert.throws(() => generateFilter(draftWith([impossible])), { code: 'IMPOSSIBLE_FILTER_MATCH' });
  impossible.minTotalTier = 0;
  assert.doesNotThrow(() => generateFilter(draftWith([impossible])));
  assert.throws(() => generateFilter(draftWith([rowWith({ purpose: 'target', affixIds: [108, 118], baseTypeIds: [25], minCount: 2 })])), { code: 'INVALID_FILTER_VALUE' });
});

test('empty, unknown, cross-type subtype and impossible selections cannot become broad rules', () => {
  assert.throws(() => generateFilter(draftWith([createFilterRow('affix')])), { code: 'EMPTY_FILTER_SELECTION' });
  assert.throws(() => generateFilter(draftWith([rowWith({ affixIds: [65535] })])), { code: 'UNKNOWN_FILTER_ID' });
  assert.throws(() => generateFilter(draftWith([rowWith({ baseTypeIds: [2, 4], subTypeIds: [2] })])), { code: 'INVALID_FILTER_SUBTYPE' });
  assert.throws(() => generateFilter(draftWith([rowWith({ minCount: 2 })])), { code: 'INVALID_FILTER_VALUE' });
  assert.throws(() => generateFilter(draftWith([rowWith({ baseTypeIds: [0] })])), { code: 'INCOMPATIBLE_FILTER_AFFIX' });
  assert.throws(() => generateFilter(draftWith([createFilterRow('idol', { baseTypeIds: [28], affixIds: [107], minTier: 6 })])), { code: 'IMPOSSIBLE_FILTER_MATCH' });
});

test('a filtered total tier counts only selected affixes satisfying the individual tier threshold', () => {
  const rule = generateFilter(draftWith([rowWith({ affixIds: [26, 73], minTier: 5, minTotalTier: 10 })])).rules[0];
  const item = { baseTypeId: 2, rarity: 'EXALTED', corrupted: false, affixes: [{ affixId: 26, tier: 5 }, { affixId: 73, tier: 4 }, { affixId: 36, tier: 7 }] };
  assert.equal(matchFilterRule(rule, item), false);
  item.affixes[1].tier = 5;
  assert.ok(matchFilterRule(rule, item));
});

test('optional hide is last and equipment-scoped while selected set targets survive global toggles', () => {
  const draft = createFilterDraft(fixture); draft.options = { ...quiet, hideUnmatched: true };
  const { rules } = generateFilter(draft);
  assert.equal(rules.at(-1).type, 'HIDE');
  assert.equal(previewFilterMatch(rules, { baseTypeId: 101, rarity: 'NORMAL' }).outcome, 'SHOW');
  assert.equal(previewFilterMatch(rules, { baseTypeId: 21, subTypeId: 0, rarity: 'RARE', affixes: [], corrupted: false }).outcome, 'HIDE');
  const set = previewFilterMatch(rules, { baseTypeId: 7, uniqueId: 79, rarity: 'SET' });
  assert.equal(set.outcome, 'SHOW'); assert.equal(set.rule.sourceRowId, 'unique-79');
});

test('unknown source IDs warn and block hide, while explicit known special identities remain exportable', () => {
  const raw = structuredClone(fixture); raw.data.equipment.head.id = 'Ibroken';
  const draft = createFilterDraft(raw);
  assert.ok(draft.analysis.warnings.some(w => w.code === 'UNRESOLVED_TARGET'));
  assert.doesNotThrow(() => generateFilter(draft));
  draft.options.hideUnmatched = true;
  assert.throws(() => generateFilter(draft), { code: 'UNRESOLVED_HIDE_TARGETS' });
  const known = createFilterDraft(fixture); known.options.hideUnmatched = true;
  assert.doesNotThrow(() => generateFilter(known));
});

test('T8 build targets preserve a T7 precursor and do not claim natural T8 crafting', () => {
  const raw = structuredClone(fixture); raw.data.equipment = { waist: { id: base(2, 2), affixes: [{ id: af(26), tier: 8 }] } }; raw.data.idols = [];
  const draft = createFilterDraft(raw), target = draft.rows.find(r => r.purpose === 'crafting');
  assert.equal(target.minTier, 7);
  assert.equal(target.sourceAffixes[0].tier, 8);
  assert.ok(target.notes.some(n => /T8/.test(n.en)));
});

test('separate primordial affix blocks stay visible as special T8 targets, never ordinary donors', () => {
  const raw = structuredClone(fixture);
  raw.data.equipment = { waist: { id: base(2, 2), primordialAffix: { id: af(26), tier: 8 }, affixes: [{ id: af(73), tier: 5 }] } };
  raw.data.idols = [];
  const draft = createFilterDraft(raw), target = draft.analysis.targets[0];
  const special = target.affixes.find(a => a.sourceRole === 'primordial');
  assert.equal(special.id, 26); assert.equal(special.tier, 8);
  assert.equal(special.sourcePath, 'data.equipment.waist.primordialAffix');
  const row = draft.rows.find(r => r.route === 'primordial_affix');
  assert.equal(row.purpose, 'target'); assert.equal(row.minTier, 8); assert.equal(row.enabled, false);
  assert.equal(draft.rows.some(r => r.purpose === 'donor' && r.affixIds.includes(26)), false);
  assert.ok(draft.analysis.warnings.some(w => w.code === 'PRIMORDIAL_AFFIX_ROUTE'));
  draft.options.hideUnmatched = true;
  assert.throws(() => generateFilter(draft), { code: 'UNRESOLVED_HIDE_TARGETS' });
  draft.options.hideUnmatched = false; row.enabled = true;
  for (const purpose of ['donor', 'crafting']) {
    row.purpose = purpose;
    assert.throws(() => generateFilter(draft), { code: 'UNSUPPORTED_PRIMORDIAL_ROUTE' });
  }
});

test('known unique identity survives primordial analysis and unknown primordial IDs still block hiding', () => {
  const raw = structuredClone(fixture);
  raw.data.equipment = { head: { id: 'UAwRgrALA7CQ', primordialAffix: { id: af(408), tier: 8 } } };
  raw.data.idols = [];
  let draft = createFilterDraft(raw);
  assert.equal(draft.rows.find(r => r.id === 'unique-471').enabled, true);
  assert.equal(draft.rows.find(r => r.route === 'primordial_affix').targetUniqueId, 471);
  assert.equal(draft.analysis.hasUnresolvedTargets, false);
  draft.options.hideUnmatched = true;
  assert.equal(previewFilterMatch(generateFilter(draft).rules, { uniqueId: 471, baseTypeId: 0, rarity: 'LEGENDARY' }).outcome, 'SHOW');
  raw.data.equipment.head.primordialAffix = { id: af(65535), tier: 8 };
  draft = createFilterDraft(raw);
  assert.equal(draft.rows.find(r => r.id === 'unique-471').enabled, true);
  assert.ok(draft.analysis.warnings.some(w => w.code === 'UNRESOLVED_TARGET'));
  draft.options.hideUnmatched = true;
  assert.throws(() => generateFilter(draft), { code: 'UNRESOLVED_HIDE_TARGETS' });
});

test('a primordial block with a non-T8 tier is reported instead of treated as an ordinary affix', () => {
  const raw = structuredClone(fixture);
  raw.data.equipment = { waist: { id: base(2, 2), primordialAffix: { id: af(26), tier: 7 } } }; raw.data.idols = [];
  const draft = createFilterDraft(raw);
  assert.ok(draft.analysis.warnings.some(w => w.code === 'UNRESOLVED_TARGET' && /T8/.test(w.message.en)));
  assert.equal(draft.analysis.hasUnresolvedTargets, true);
  assert.equal(draft.rows.some(r => r.purpose === 'donor'), false);
});

test('Q9JP5wbn second fixed unique variant is not mistaken for a primordial T8 target', () => {
  const source = JSON.parse(readFileSync(new URL('./fixtures/planner-Q9JP5wbn.json', import.meta.url), 'utf8'));
  const draft = createFilterDraft(source);
  const hands = draft.analysis.targets.find(target => target.slot === 'hands');
  assert.ok(!draft.analysis.warnings.some(w => w.code === 'UNRESOLVED_TARGET' && w.message.en.includes('data.equipment.hands')));
  const variant = hands.affixes.find(affix => affix.id === 1147);
  assert.equal(variant.tier, 4);
  assert.equal(variant.sourceRole, 'fixed_variant');
  assert.ok(!draft.rows.some(row => row.route === 'primordial_affix' && row.affixIds.includes(1147)));
  assert.ok(!draft.rows.some(row => row.enabled && row.affixIds.includes(1147)));
  assert.doesNotThrow(() => generateFilter(draft));
});

test('all 43 unique fixed variants stay attached to their owner across LET affix fields', () => {
  let checked = 0;
  for (const [uniqueId, unique] of Object.entries(itemCatalog.uniques).filter(([, item]) => item.specificAffixes)) {
    const id = `U${LZString.compressToBase64(`${String(unique.subTypes[0]).padStart(3, '0')}${uniqueId.padStart(3, '0')}`).replace(/=+$/, '')}`;
    for (const affixId of unique.specificAffixIds) for (const field of ['affixes', 'sealedAffix', 'primordialAffix', 'corruptedAffix']) {
      const affix = { id: af(affixId), tier: Math.min(4, itemCatalog.affixes[affixId].tierCount) };
      const raw = structuredClone(fixture);
      raw.data.equipment = { hands: { id, [field]: field === 'affixes' ? [affix] : affix } };
      raw.data.idols = [];
      const draft = createFilterDraft(raw);
      assert.equal(draft.analysis.hasUnresolvedTargets, false, `${uniqueId}/${affixId}/${field}`);
      assert.equal(draft.analysis.targets[0].affixes[0].sourceRole, 'fixed_variant');
      assert.ok(draft.rows.some(row => row.uniqueIds.includes(Number(uniqueId))));
      assert.ok(!draft.rows.some(row => row.affixIds.includes(affixId)));
      checked++;
    }
  }
  assert.equal(checked, 172);
});

test('foreign fixed variants are rejected in every field while Exulis affixes remain valid corruption elsewhere', () => {
  const uid = id => `U${LZString.compressToBase64(`${String(itemCatalog.uniques[id].subTypes[0]).padStart(3, '0')}${String(id).padStart(3, '0')}`).replace(/=+$/, '')}`;
  for (const id of [base(4, 3), uid(66), uid(79), uid(477)]) {
    for (const field of ['affixes', 'sealedAffix', 'primordialAffix', 'corruptedAffix']) {
      const affix = { id: af(1147), tier: 4 }, raw = structuredClone(fixture);
      raw.data.equipment = { hands: { id, [field]: field === 'affixes' ? [affix] : affix } };
      raw.data.idols = [];
      const draft = createFilterDraft(raw);
      assert.equal(draft.analysis.hasUnresolvedTargets, true);
      assert.ok(draft.analysis.warnings.some(w => /does not belong/.test(w.message.en)));
      assert.ok(!draft.rows.some(row => row.affixIds.includes(1147)));
    }
  }
  const raw = structuredClone(fixture);
  raw.data.equipment = { amulet: { id: base(20, 0), corruptedAffix: { id: af(1083), tier: 4 } } };
  raw.data.idols = [];
  const target = createFilterDraft(raw).analysis.targets[0];
  assert.equal(target.affixes[0].sourceRole, 'corrupted');
});

test('corrupted ordinary targets do not silently permit a hide that only retains uncorrupted precursors', () => {
  const raw = structuredClone(fixture); raw.data.equipment = { waist: { id: base(2, 2), corrupted: true, affixes: [{ id: af(26), tier: 7 }] } }; raw.data.idols = [];
  const draft = createFilterDraft(raw);
  assert.ok(draft.analysis.warnings.some(w => w.code === 'SPECIAL_ITEM_STATE'));
  draft.options.hideUnmatched = true;
  assert.throws(() => generateFilter(draft), { code: 'UNRESOLVED_HIDE_TARGETS' });
});

test('known Weaver outcome rows cannot be repurposed into an unverified normal donor route', () => {
  const draft = createFilterDraft(fixture), row = draft.rows.find(r => r.slot === 'relic' && r.sourceAffixes);
  row.enabled = true; row.purpose = 'target'; draft.options = { ...quiet };
  let rule = generateFilter(draft).rules.find(r => r.sourceRowId === row.id);
  assert.ok(rule.conditions.some(c => c.type === 'unique' && c.uniqueIds.includes(300)));
  row.purpose = 'donor';
  assert.throws(() => generateFilter(draft), { code: 'UNSUPPORTED_DONOR_ROUTE' });
});

test('rare shard globals honor per-item-type weights, shard eligibility and exclude build-specific targets', () => {
  const draft = createFilterDraft(fixture); draft.options.showRareUniques = false;
  const { rules } = generateFilter(draft), globals = rules.filter(r => r.id.startsWith('extra-rare-affixes-'));
  assert.ok(globals.length > 0);
  for (const rule of globals) {
    const type = rule.conditions.find(c => c.type === 'subtype').baseTypeIds[0];
    for (const id of rule.conditions.find(c => c.type === 'affix').affixIds) {
      const definition = FILTER_CATALOG.affixes[id];
      assert.ok(definition.hasShard);
      assert.ok((definition.effectiveWeightByType[type] ?? definition.weighting) <= draft.options.rareAffixWeightThreshold);
      assert.equal(draft.analysis.targets.some(t => t.affixes.some(a => a.id === id)), false);
    }
  }
});

test('specific build rules win over broad extras, generation does not mutate the editable draft', () => {
  const draft = createFilterDraft(fixture); draft.options.showAllUniques = true; draft.styles.target = { color: 14, emphasized: false };
  const before = JSON.stringify(draft), { rules } = generateFilter(draft);
  assert.equal(JSON.stringify(draft), before);
  const match = previewFilterMatch(rules, { uniqueId: 471, baseTypeId: 0, rarity: 'LEGENDARY' });
  assert.equal(match.rule.sourceRowId, 'unique-471');
  assert.deepEqual(match.rule.style, { color: 14, emphasized: false });
  const other = previewFilterMatch(rules, { uniqueId: 65535, baseTypeId: 0, rarity: 'UNIQUE' });
  assert.equal(other.rule.id, 'extra-all-uniques');
});

test('rules exceeding the real game limit fail rather than silently truncating targets', () => {
  const rows = Array.from({ length: 201 }, (_, i) => createFilterRow('unique', { id: `copy-${i}`, uniqueIds: [471] }));
  assert.throws(() => generateFilter(draftWith(rows)), { code: 'TOO_MANY_FILTER_RULES' });
});
