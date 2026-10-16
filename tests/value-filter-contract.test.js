import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import { createValueFilterDraft, generateValueFilter } from '../web/src/core/value-filter.js';
import catalog from '../web/src/data/filter-catalog.json' with { type: 'json' };

const fixture = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
const affixId = id => `A${LZString.compressToBase64(String(id)).replace(/=+$/, '')}`;
const uniqueId = (id, subtype) => `U${LZString.compressToBase64(`${String(subtype).padStart(3, '0')}${String(id).padStart(3, '0')}`).replace(/=+$/, '')}`;
const baseId = (type, subtype) => `I${LZString.compressToBase64(`1${String(type).padStart(3, '0')}${String(subtype).padStart(3, '0')}000`).replace(/=+$/, '')}`;
function source(equipment = {}) {
  const input = structuredClone(fixture);
  input.data.equipment = equipment; input.data.idols = [];
  return input;
}
function draft() {
  const value = createValueFilterDraft(source());
  value.language = 'en'; value.highAffixIds = [501, 502, 25, 22]; value.mediumAffixIds = [1];
  return value;
}

// A small XML reader and a native-condition oracle, independent of the core's
// rules and preview matcher. It reads only exported XML. Schema names are from
// the 1.5.2.1 ItemFiltering classes; multiple conditions are ANDed and the first
// enabled match stops evaluation, including a HIDE result.
function parseXml(xml) {
  const root = { name: '#document', children: [], text: '' }, stack = [root];
  for (const token of xml.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith('<?') || token.startsWith('<!--')) continue;
    if (token.startsWith('</')) {
      assert.equal(stack.pop().name, token.slice(2, -1).trim(), 'unbalanced XML');
    } else if (token.startsWith('<')) {
      const name = token.match(/^<([^\s/>]+)/)?.[1];
      assert.ok(name);
      const attrs = Object.fromEntries([...token.matchAll(/([\w:.-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
      const node = { name, attrs, children: [], text: '' };
      stack.at(-1).children.push(node);
      if (!token.endsWith('/>')) stack.push(node);
    } else stack.at(-1).text += token;
  }
  assert.equal(stack.length, 1, 'unclosed XML');
  return root.children[0];
}
const child = (node, name) => node.children.find(item => item.name === name);
const text = (node, name) => child(node, name)?.text.trim();
const children = (node, name) => node.children.filter(item => item.name === name);
const preparedAffixConditions = new WeakMap();
const comparison = (actual, operation, expected) => {
  switch (operation) {
    case 'ANY': return true;
    case 'EQUAL': return actual === expected;
    case 'LESS': return actual < expected;
    case 'LESS_OR_EQUAL': return actual <= expected;
    case 'MORE': return actual > expected;
    case 'MORE_OR_EQUAL': return actual >= expected;
    default: assert.fail(`unsupported native comparison ${operation}`);
  }
};
function conditionMatches(condition, item) {
  switch (condition.attrs['i:type']) {
    case 'RarityCondition': return text(condition, 'rarity').split(/\s+/).includes(item.rarity);
    case 'SubTypeCondition': {
      const types = children(child(condition, 'type'), 'EquipmentType').map(node => node.text);
      const subtypes = children(child(condition, 'subTypes'), 'int').map(node => Number(node.text));
      return types.includes(item.equipmentType) && (types.length !== 1 || !subtypes.length || subtypes.includes(item.subtype));
    }
    case 'ClassCondition': {
      const bits = { Primalist: 1, Mage: 2, Sentinel: 4, Acolyte: 8, Rogue: 16, Any: 31, None: 0 };
      const mask = text(condition, 'req').split(/\s+/).reduce((flags, name) => flags | bits[name], 0);
      const required = item.classRequirement ?? 0;
      return mask === 0 || required !== 0 && (mask & required) === required;
    }
    case 'UniqueModifiersCondition':
      return ['UNIQUE', 'SET', 'LEGENDARY'].includes(item.rarity) && children(condition, 'Uniques').some(node => Number(text(node, 'UniqueId')) === item.uniqueId);
    case 'AffixCondition': {
      if (!preparedAffixConditions.has(condition)) preparedAffixConditions.set(condition, {
        accepted: new Set(children(child(condition, 'affixes'), 'int').map(node => Number(node.text))),
        advanced: text(condition, 'advanced') === 'true',
        perTier: text(condition, 'comparsion'), tier: Number(text(condition, 'comparsionValue')),
        count: Number(text(condition, 'minOnTheSameItem')),
        combined: text(condition, 'combinedComparsion'), total: Number(text(condition, 'combinedComparsionValue')),
      });
      const { accepted, advanced, perTier, tier, count, combined, total } = preparedAffixConditions.get(condition);
      const supplied = [...(item.affixes ?? []), item.sealedAffix, item.corruptedAffix, item.primordialAffix].filter(Boolean);
      // Native AffixCondition treats an empty selected-ID set as a wildcard.
      const qualifying = supplied.filter(affix => (!accepted.size || accepted.has(affix.id)) && (!advanced || comparison(affix.tier, perTier, tier)));
      return qualifying.length >= count && (!advanced || comparison(qualifying.reduce((sum, affix) => sum + affix.tier, 0), combined, total));
    }
    case 'AffixCountCondition': {
      const sealed = [item.sealedAffix, ...(item.affixes ?? []).filter(affix => affix.sealed)].filter(Boolean);
      const sealedType = text(condition, 'sealedType');
      if (sealedType === 'NotSealed' && sealed.length) return false;
      if (sealedType === 'Sealed' && !sealed.length) return false;
      if (sealedType === 'SealedPrefix' && !sealed.some(affix => catalog.affixes[affix.id].type === 0)) return false;
      if (sealedType === 'SealedSuffix' && !sealed.some(affix => catalog.affixes[affix.id].type === 1)) return false;
      const ordinary = [...(item.affixes ?? []), item.corruptedAffix, item.primordialAffix].filter(affix => affix && !affix.sealed);
      for (const [field, kind, minimum] of [['minPrefixes', 0, true], ['maxPrefixes', 0, false], ['minSuffixes', 1, true], ['maxSuffixes', 1, false]]) {
        const node = child(condition, field);
        if (!node || node.attrs['i:nil'] === 'true') continue;
        const count = ordinary.filter(affix => catalog.affixes[affix.id].type === kind).length;
        if (minimum ? count < Number(node.text) : count > Number(node.text)) return false;
      }
      return true;
    }
    case 'PotentialCondition': {
      for (const [field, property, min] of [
        ['MinLegendaryPotential', 'lp', true], ['MaxLegendaryPotential', 'lp', false],
        ['MinWeaversWill', 'ww', true], ['MaxWeaversWill', 'ww', false],
        ['MinWeaversTouch', 'wt', true], ['MaxWeaversTouch', 'wt', false],
        ['MinForgingPotential', 'fp', true], ['MaxForgingPotential', 'fp', false],
      ]) {
        const node = child(condition, field);
        if (!node || node.attrs['i:nil'] === 'true') continue;
        if (!Number.isFinite(item[property])) return false;
        if (min ? item[property] < Number(node.text) : item[property] > Number(node.text)) return false;
      }
      return true;
    }
    case 'RuneCondition':
      assert.equal(text(condition, 'RuneFilterFlags'), 'AllRunes'); return item.resource === 'rune';
    case 'GlyphCondition':
      assert.equal(text(condition, 'GlyphFilterFlags'), 'AllGlyphs'); return item.resource === 'glyph';
    case 'KeysCondition':
      assert.equal(text(condition, 'NonEquippableItemFilterFlags'), 'AllKeys'); return item.resource === 'key';
    case 'CraftingMaterialsCondition':
      assert.equal(text(condition, 'NonEquippableItemFilterFlags'), 'AllShards'); return item.resource === 'shard';
    default: assert.fail(`unsupported exported condition ${condition.attrs['i:type']}`);
  }
}
function exportedFilter(input) {
  const generated = generateValueFilter(input), xml = generated.xml, root = parseXml(xml);
  assert.equal(root.name, 'ItemFilter');
  assert.equal(text(root, 'lootFilterVersion'), '9');
  const serialized = children(child(root, 'rules'), 'Rule');
  const rules = serialized.toSorted((a, b) => Number(text(a, 'Order')) - Number(text(b, 'Order')));
  return { xml, root, rules, serialized, generated, match(item) {
    const rule = rules.find(rule => text(rule, 'isEnabled') === 'true' && children(child(rule, 'conditions'), 'Condition').every(condition => conditionMatches(condition, item)));
    return rule && { name: text(rule, 'nameOverride'), action: text(rule, 'type'), color: Number(text(rule, 'color')), emphasized: text(rule, 'emphasized') === 'true', rule };
  } };
}
const gear = (...affixes) => ({ equipmentType: 'HELMET', rarity: 'RARE', affixes: affixes.map(([id, tier]) => ({ id, tier })) });


// Product requirements expressed independently of rule generation and preview.
function expectedEquipment(input, item) {
  const high = new Set(input.highAffixIds), useful = new Set([...high, ...input.mediumAffixIds]);
  const affixes = [...(item.affixes ?? []), item.sealedAffix, item.corruptedAffix, item.primordialAffix].filter(Boolean);
  let id = 'equipment_other';
  if (item.rarity === 'EXALTED' && affixes.some(a => high.has(a.id) && a.tier >= 6)) id = 'equipment_core';
  else if (item.rarity === 'EXALTED' && affixes.some(a => useful.has(a.id) && a.tier >= 6) && affixes.filter(a => useful.has(a.id)).length >= 3) id = 'equipment_useful';
  else if (affixes.some(a => high.has(a.id) && a.tier >= 5) && affixes.filter(a => useful.has(a.id) && a.tier >= 5).length >= 2) id = 'equipment_crafting';
  else if (affixes.some(a => high.has(a.id)) && affixes.filter(a => useful.has(a.id)).length >= 3) id = 'equipment_leveling';
  const names = { equipment_core: 'Core-affix exalted equipment', equipment_useful: 'Useful-affix exalted equipment', equipment_crafting: 'Crafting candidates', equipment_leveling: 'Leveling equipment', equipment_other: 'Other equipment' };
  const style = input.groups[id];
  return { name: names[id], action: style.show ? 'SHOW' : 'HIDE', color: style.color, emphasized: style.emphasized };
}
function assertEquipmentMatches(input, filter, item) {
  const actual = filter.match(item), expected = expectedEquipment(input, item);
  assert.ok(actual, 'equipment must have a terminal match');
  for (const key of ['name', 'action', 'color', 'emphasized']) assert.equal(actual[key], expected[key], JSON.stringify(item));
}

test('exported native XML exactly implements all tier boundaries and useful-count combinations', () => {
  const input = draft(), before = structuredClone(input), filter = exportedFilter(input);
  const tiers = [0, 1, 4, 5, 6, 7, 8], ids = [501, 502, 1, 13];
  for (const rarity of ['NORMAL', 'MAGIC', 'RARE', 'EXALTED']) {
    for (const a of tiers) for (const b of tiers) for (const c of tiers) for (const d of [0, 1, 7]) {
      const item = { ...gear(), rarity, affixes: [a, b, c, d].flatMap((tier, i) => tier ? [{ id: ids[i], tier }] : []) };
      assertEquipmentMatches(input, filter, item);
    }
  }
  assert.deepEqual(input, before);
  assert.equal(filter.generated.diagnostics.equipmentRuleCount, 4);
  assert.equal(filter.generated.diagnostics.approximate, false);
  assert.ok(filter.rules.length < 40);
  assert.deepEqual(filter.rules.map(rule => Number(text(rule, 'Order'))), Array.from({ length: filter.rules.length }, (_, index) => index));
});

test('all ordinary equipment types share four rules and hidden categories remain terminal', () => {
  const input = draft(); Object.assign(input.groups.equipment_core, { show: false, color: 17 });
  const filter = exportedFilter(input);
  const types = ['HELMET', 'BODY_ARMOR', 'BELT', 'BOOTS', 'GLOVES', 'ONE_HANDED_AXE', 'ONE_HANDED_DAGGER', 'ONE_HANDED_MACES', 'ONE_HANDED_SCEPTRE', 'ONE_HANDED_SWORD', 'WAND', 'ONE_HANDED_FIST', 'TWO_HANDED_AXE', 'TWO_HANDED_MACE', 'TWO_HANDED_SPEAR', 'TWO_HANDED_STAFF', 'TWO_HANDED_SWORD', 'QUIVER', 'SHIELD', 'CATALYST', 'AMULET', 'RING', 'RELIC', 'BOW', 'CROSSBOW'];
  for (const equipmentType of types) {
    const item = { ...gear([501, 6], [502, 5], [1, 1]), rarity: 'EXALTED', equipmentType };
    assertEquipmentMatches(input, filter, item);
  }
});

test('additional affix fields count as useful and unselected affixes never subtract value', () => {
  const input = draft(), filter = exportedFilter(input);
  for (const field of ['sealedAffix', 'corruptedAffix', 'primordialAffix']) {
    const item = { ...gear([501, 4], [1, 1]), [field]: { id: 502, tier: 4 } };
    assertEquipmentMatches(input, filter, item);
    assert.equal(filter.match(item).name, 'Leveling equipment');
    item.affixes.push({ id: 13, tier: 1 });
    assert.equal(filter.match(item).name, 'Leveling equipment');
  }
});

test('native XML resolves uniques and sets before exclusions, then ordinary equipment and idol needs', () => {
  const input = draft(); input.uniqueIds = [277]; input.setIds = [79];
  const ordinary = [
    { ...gear([501, 6]), rarity: 'EXALTED' },
    { ...gear([1, 6], [502, 1], [25, 1]), rarity: 'EXALTED' },
    gear([501, 5], [502, 5]),
    gear([501, 4], [502, 4], [1, 1]),
  ];
  const names = ['Core-affix exalted equipment', 'Useful-affix exalted equipment', 'Crafting candidates', 'Leveling equipment'];
  const baseline = exportedFilter(input);
  ordinary.forEach((item, index) => assert.equal(baseline.match(item).name, names[index]));
  input.exclusions.equipmentTypeIds = [0, 7, 21, 12];
  input.exclusions.idolBaseKeys = ['30:4', '30:9', '30:14'];
  const filter = exportedFilter(input);
  const selectedUnique = { equipmentType: 'RING', uniqueId: 277, rarity: 'UNIQUE' };
  assert.equal(filter.match(selectedUnique).name, 'Needed uniques');
  assert.equal(filter.match(selectedUnique).action, 'SHOW');
  for (const rarity of ['SET', 'LEGENDARY']) {
    const match = filter.match({ equipmentType: 'ONE_HANDED_MACES', uniqueId: 79, rarity });
    assert.equal(match.name, 'Valuable set items'); assert.equal(match.action, 'SHOW');
  }
  for (const item of ordinary) { assert.equal(filter.match(item).name, 'Hide selected equipment types'); assert.equal(filter.match(item).action, 'HIDE'); }
  for (const rarity of ['UNIQUE', 'SET', 'LEGENDARY']) assert.equal(filter.match({ equipmentType: 'RING', uniqueId: 65535, rarity }), undefined);
  input.groups.unique_needed.show = false;
  assert.equal(exportedFilter(input).match(selectedUnique).name, 'Needed uniques');
  assert.equal(exportedFilter(input).match(selectedUnique).action, 'HIDE');
  for (const subtype of [4, 9, 14]) assert.equal(filter.match({ equipmentType: 'IDOL_1x3', subtype, rarity: 'RARE' }).action, 'HIDE');
  input.groups.idol_other.show = true;
  const visible = exportedFilter(input);
  for (const subtype of [1, 6, 11]) assert.equal(visible.match({ equipmentType: 'IDOL_1x3', subtype, rarity: 'RARE' }).action, 'SHOW');
  assert.equal(filter.match({ resource: 'rune' }).action, 'SHOW');
  assert.equal(filter.match({ equipmentType: 'IDOL_ALTAR', rarity: 'RARE' }).action, 'SHOW');
});

test('effective-pool edits change matching without creating a low pool or changing the saved draft', () => {
  const input = draft(), before = structuredClone(input), item = gear([501, 4], [502, 4], [1, 4]);
  assert.equal(exportedFilter(input).match(item).name, 'Leveling equipment');
  assert.deepEqual(input, before);
  assert.equal(Object.hasOwn(input, 'lowAffixIds'), false);
  input.mediumAffixIds = [];
  assert.equal(exportedFilter(input).match(item).name, 'Other equipment');
  assert.equal(exportedFilter(input).match(item).action, 'HIDE');
});
test('LP fields cannot accidentally highlight zero-LP uniques, sets or Weaver items', () => {
  const input = draft(); input.options.rareUniqueThreshold = 1;
  const filter = exportedFilter(input);
  const ordinary = { equipmentType: 'RING', rarity: 'UNIQUE', uniqueId: 66 };
  for (const lp of [undefined, 0, 1]) assert.equal(filter.match({ ...ordinary, lp }).name, 'Other uniques');
  for (const lp of [2, 3, 4]) assert.equal(filter.match({ ...ordinary, lp }).name, 'High-potential uniques (2–4)');
  assert.equal(filter.match({ ...ordinary, rarity: 'LEGENDARY', lp: 0 }).name, 'Other uniques');
  assert.equal(filter.match({ equipmentType: 'RELIC', rarity: 'UNIQUE', uniqueId: 300, lp: 4, ww: 28 }).name, 'Other uniques');
  assert.equal(filter.match({ equipmentType: 'ONE_HANDED_MACES', rarity: 'SET', uniqueId: 79, lp: 4 }).name, 'Other set items');
  const potential = filter.rules.flatMap(rule => children(child(rule, 'conditions'), 'Condition')).find(condition => condition.attrs['i:type'] === 'PotentialCondition');
  assert.equal(text(potential, 'MinLegendaryPotential'), '2');
  assert.equal(text(potential, 'MaxLegendaryPotential'), '4');
  assert.equal(child(potential, 'MinWeaversWill').attrs['i:nil'], 'true');
  assert.doesNotMatch(filter.xml, /<minLegendaryPotential>|<LegendaryPotentialCondition/);
});

test('selected uniques and sets retain their specific groups and rarity thresholds exclude fixed-source sets', () => {
  const input = draft(); input.uniqueIds = [277]; input.setIds = [79];
  let filter = exportedFilter(input);
  assert.equal(filter.match({ rarity: 'UNIQUE', uniqueId: 277, lp: 4 }).name, 'Needed uniques');
  assert.equal(filter.match({ rarity: 'SET', uniqueId: 79 }).name, 'Valuable set items');
  assert.equal(filter.match({ rarity: 'SET', uniqueId: 185 }).name, 'Valuable set items');
  assert.equal(filter.match({ rarity: 'SET', uniqueId: 109 }).name, 'Other set items', 'a fixed acquisition source is not automatically rare');
  input.groups.unique_needed.show = false;
  filter = exportedFilter(input);
  assert.equal(filter.match({ rarity: 'UNIQUE', uniqueId: 277, lp: 4 }).action, 'HIDE', 'an explicit needed-unique HIDE is terminal even for rare high LP');
});

test('resource conditions retain their native field and enum spellings and cannot hide equipment by accident', () => {
  const input = draft(), filter = exportedFilter(input);
  for (const [kind, type, field, flag, name] of [
    ['rune', 'RuneCondition', 'RuneFilterFlags', 'AllRunes', 'Runes'],
    ['glyph', 'GlyphCondition', 'GlyphFilterFlags', 'AllGlyphs', 'Glyphs'],
    ['shard', 'CraftingMaterialsCondition', 'NonEquippableItemFilterFlags', 'AllShards', 'Affix shards'],
    ['key', 'KeysCondition', 'NonEquippableItemFilterFlags', 'AllKeys', 'Keys and special materials'],
  ]) {
    assert.match(filter.xml, new RegExp(`<Condition i:type="${type}"><${field}>${flag}</${field}></Condition>`));
    assert.equal(filter.match({ resource: kind }).name, name);
    input.groups[kind].show = false;
    assert.equal(exportedFilter(input).match({ resource: kind }).action, 'HIDE');
  }
  assert.equal(filter.match({ equipmentType: 'IDOL_ALTAR', rarity: 'RARE' }).name, 'Idol altars');
  assert.equal(filter.match({ equipmentType: 'HELMET', rarity: 'RARE' }).name, 'Other equipment');
  assert.equal(filter.match({ resource: 'gold' }), undefined, 'no invented catch-all should change unrelated drops');
  assert.doesNotMatch(filter.xml, /<EquipmentType>(?:RUNE|GLYPH|SHARD|KEY)<\/EquipmentType>/);
  assert.deepEqual(filter.serialized.map(rule => Number(text(rule, 'Order'))), Array.from({ length: filter.rules.length }, (_, index) => filter.rules.length - index - 1));
});

test('fixed unique variants never enter the high pool, regardless of which planner field contains them', () => {
  const variant = { id: affixId(1136), tier: 1 };
  const additions = [{ id: affixId(501), tier: 7 }, { id: affixId(70), tier: 5 }];
  for (const variantPlacement of [{ sealedAffix: variant }, { affixes: [...additions, variant] }]) {
    const input = createValueFilterDraft(source({ ring1: { id: 'UAwRmBYHZKA', affixes: additions, ir: [255, 255, 255], ur: Array(8).fill(255), ...variantPlacement } }));
    assert.deepEqual(input.highAffixIds, [70, 501]);
    assert.deepEqual(input.analysis.targets[0].inherentAffixes.map(affix => affix.id), [1136]);
    assert.equal(input.analysis.hasUnresolvedTargets, false);
    assert.doesNotMatch(generateValueFilter(input).xml, /<int>1136<\/int>/);
  }
  const exulis = createValueFilterDraft(source({ amulet: { id: uniqueId(469, 8), affixes: [{ id: affixId(1083), tier: 1 }, { id: affixId(1084), tier: 1 }], corruptedAffix: { id: affixId(7), tier: 3 } } }));
  assert.deepEqual(exulis.highAffixIds, [7], 'Exulis fixed type-6 variants are not additional corruption targets');
  assert.deepEqual(exulis.analysis.targets[0].inherentAffixes.map(affix => affix.id), [1083, 1084]);
});

test('Exulis fixed-pool IDs remain legitimate corruption additions on another amulet', () => {
  // Native corrupted-affix selection includes 1083–1087 for amulets (weight 2,
  // uniqueId 0). Their fixed origin on Exulis must not become a global ban.
  const input = createValueFilterDraft(source({ amulet: {
    id: baseId(20, 0), corrupted: true, corruptedAffix: { id: affixId(1083), tier: 3 },
  } }));
  assert.deepEqual(input.highAffixIds, [1083]);
  assert.equal(input.analysis.targets[0].affixes[0].origin, 'corruption');
  assert.deepEqual(input.analysis.targets[0].inherentAffixes, []);
  const manual = draft(); manual.highAffixIds = [1084]; manual.mediumAffixIds = [22];
  assert.equal(exportedFilter(manual).match({ equipmentType: 'AMULET', rarity: 'RARE', affixes: [{ id: 1084, tier: 5 }, { id: 22, tier: 5 }] }).name, 'Crafting candidates');
});

test('exported idol XML uses type and class requirements without rarity and preserves general/current-class idols', () => {
  const input = draft(); input.build.classId = 1; input.groups.idol_other.show = true;
  input.exclusions.idolBaseKeys = Object.values(catalog.bases).filter(base => base.baseType >= 25 && base.baseType <= 33 && !base.hideInFilter && !base.legacy && base.classRequirement && !(base.classRequirement & 2)).map(base => `${base.baseType}:${base.subType}`);
  const filter = exportedFilter(input);
  const hides = filter.rules.filter(rule => text(rule, 'nameOverride') === 'Hide other-class idols');
  assert.equal(hides.length, 1);
  const conditions = children(child(hides[0], 'conditions'), 'Condition');
  assert.deepEqual(conditions.map(condition => condition.attrs['i:type']), ['SubTypeCondition', 'ClassCondition']);
  assert.equal(children(child(conditions[0], 'type'), 'EquipmentType').length, 9);
  assert.equal(text(conditions[1], 'req'), 'Primalist Sentinel Acolyte Rogue');
  for (const equipmentType of ['IDOL_1x1_ETERRA', 'IDOL_1x1_LAGON', 'IDOL_2x1', 'IDOL_1x2', 'IDOL_3x1', 'IDOL_1x3', 'IDOL_4x1', 'IDOL_1x4', 'IDOL_2x2']) {
    for (const classRequirement of [0, 1, 2, 4, 8, 16, 3, 31]) {
      const match = filter.match({ equipmentType, classRequirement });
      assert.equal(match.action, classRequirement > 0 && (29 & classRequirement) === classRequirement ? 'HIDE' : 'SHOW');
    }
  }
  input.idols = [{ id: 'general', baseTypeId: 25, subTypeId: 0, affixIds: [108, 114], enabled: true }];
  const needs = exportedFilter(input);
  assert.equal(needs.match({ equipmentType: 'IDOL_1x1_ETERRA', affixes: [{ id: 108, tier: 1 }, { id: 114, tier: 1 }] }).name, 'Two useful idol affixes');
  assert.equal(needs.match({ equipmentType: 'IDOL_1x1_ETERRA', affixes: [{ id: 108, tier: 1 }] }).name, 'One useful idol affix');
  for (const rule of needs.rules.filter(rule => /idol/i.test(text(rule, 'nameOverride')))) assert.ok(children(child(rule, 'conditions'), 'Condition').every(condition => condition.attrs['i:type'] !== 'RarityCondition'));
});

test('native XML merges useful idol rules across all nine types while keeping prefix/suffix matching exact', () => {
  const input = draft();
  input.idols = [
    { id: 'small', baseTypeId: 25, subTypeId: 0, affixIds: [108,114], enabled: true },
    { id: 'large', baseTypeId: 30, subTypeId: 0, affixIds: [941,287], enabled: true },
    { id: 'stout', baseTypeId: 28, subTypeId: 0, affixIds: [107,117], enabled: true },
  ];
  const filter = exportedFilter(input);
  for (const name of ['Two useful idol affixes', 'One useful idol affix']) {
    const rules = filter.rules.filter(rule => text(rule, 'nameOverride') === name);
    assert.equal(rules.length, 1);
    const scope = children(child(rules[0], 'conditions'), 'Condition').find(condition => condition.attrs['i:type'] === 'SubTypeCondition');
    assert.equal(children(child(scope, 'type'), 'EquipmentType').length, 9);
    assert.equal(children(child(scope, 'subTypes'), 'int').length, 0);
  }
  const item = (equipmentType, ids) => ({ equipmentType, affixes: ids.map(id => ({ id, tier: 1 })) });
  assert.equal(filter.match(item('IDOL_3x1', [108,114])).name, 'Two useful idol affixes');
  assert.equal(filter.match(item('IDOL_1x3', [941,117])).name, 'Two useful idol affixes');
  assert.equal(filter.match(item('IDOL_1x1_LAGON', [117])).name, 'One useful idol affix');
  assert.equal(filter.match(item('IDOL_1x3', [117,287])).name, 'One useful idol affix');
  input.groups.idol_double.show = false;
  const hidden = exportedFilter(input).match(item('IDOL_1x3', [941,117]));
  assert.equal(hidden.name, 'Two useful idol affixes'); assert.equal(hidden.action, 'HIDE');
  input.exclusions.idolTypeIds = [30];
  assert.equal(exportedFilter(input).match(item('IDOL_1x3', [941,117])).name, 'Hide selected idol types');
  assert.equal(filter.match({ ...item('HELMET', [108,114]), rarity: 'RARE' }).name, 'Other equipment');
});
