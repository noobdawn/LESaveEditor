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
  value.equipmentGroups = [
    { id: 'score-top', name: 'Score 25', threshold: 25, enabled: true, show: true, color: 6, emphasized: true },
    { id: 'score-middle', name: 'Score 10', threshold: 10, enabled: true, show: true, color: 4, emphasized: true },
    { id: 'score-entry', name: 'Score 1', threshold: 1, enabled: true, show: true, color: 3, emphasized: false },
  ];
  value.scoring = { high: Array(7).fill(10), medium: Array(7).fill(4), low: Array(7).fill(0) };
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
      return types.includes(item.equipmentType) && (!subtypes.length || subtypes.includes(item.subtype));
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

// Product scoring expressed directly; no preview matcher, threshold inversion,
// compiled rules, or score helper from the implementation is used as an oracle.
function expectedEquipment(input, item) {
  const high = new Set(input.highAffixIds), medium = new Set(input.mediumAffixIds.filter(id => !high.has(id)));
  const affixes = [...(item.affixes ?? []), item.sealedAffix, item.corruptedAffix, item.primordialAffix].filter(Boolean);
  let scoreUnits = 0;
  for (const affix of affixes) {
    const category = high.has(affix.id) ? 'high' : medium.has(affix.id) ? 'medium' : 'low';
    scoreUnits += Math.round(input.scoring[category][Math.min(affix.tier, 7) - 1] * 100);
  }
  const referenceUnits = 4 * Math.round(input.scoring.high[6] * 100);
  const group = input.equipmentGroups.filter(group => group.enabled).toSorted((a, b) => b.threshold - a.threshold)
    .find(group => scoreUnits >= Math.ceil(referenceUnits * group.threshold / 100 - 1e-10));
  if (group) return { name: group.name, action: group.show ? 'SHOW' : 'HIDE', color: group.color, emphasized: group.emphasized };
  const exalted = item.rarity === 'EXALTED' && (affixes.some(affix => affix.tier >= 7) || affixes.filter(affix => affix.tier >= 6).length >= 2);
  const style = input.groups[exalted ? 'equipment_other_exalted' : 'equipment_other'];
  return { name: exalted ? 'Other high-tier exalted equipment' : 'Other equipment', action: style.show ? 'SHOW' : 'HIDE', color: style.color, emphasized: style.emphasized };
}
function assertEquipmentMatches(input, filter, item, context = '') {
  const actual = filter.match(item), expected = expectedEquipment(input, item);
  assert.ok(actual, `${context}: equipment has no terminal match`);
  for (const key of ['name', 'action', 'color', 'emphasized']) assert.equal(actual[key], expected[key], `${context}: ${key}; ${JSON.stringify(item)}`);
}

test('exact exported XML uses four high T7 affixes as 100 percent, and HIDE remains terminal', () => {
  const input = draft(), filter = exportedFilter(input);
  assert.equal(filter.match(gear([501, 1])).name, 'Score 25');
  assert.equal(filter.match(gear([1, 8])).name, 'Score 10');
  assert.equal(filter.match(gear([503, 8])).name, 'Other equipment');
  Object.assign(input.equipmentGroups[1], { show: false, color: 17, emphasized: false });
  let match = exportedFilter(input).match(gear([1, 4]));
  assert.equal(match.name, 'Score 10'); assert.equal(match.action, 'HIDE');
  assert.equal(text(match.rule, 'recolor'), 'false');
  input.equipmentGroups[1].enabled = false;
  match = exportedFilter(input).match(gear([1, 4]));
  assert.equal(match.name, 'Score 1'); assert.equal(match.action, 'SHOW');
  input.equipmentGroups = [];
  assertEquipmentMatches(input, exportedFilter(input), gear([501, 7]), 'no enabled scoring groups');
});

test('equal percent thresholds preserve user order and a disabled group does not act as HIDE', () => {
  const input = draft();
  input.equipmentGroups = [
    { ...input.equipmentGroups[2], id: 'lower', name: 'Lower', threshold: 1 },
    { ...input.equipmentGroups[1], id: 'first', name: 'First', threshold: 10, show: false },
    { ...input.equipmentGroups[1], id: 'second', name: 'Second', threshold: 10 },
  ];
  assert.equal(exportedFilter(input).match(gear([1, 7])).name, 'First');
  assert.equal(exportedFilter(input).match(gear([1, 7])).action, 'HIDE');
  input.equipmentGroups[1].enabled = false;
  assert.equal(exportedFilter(input).match(gear([1, 7])).name, 'Second');
});

test('a third prefix and mixed T7/T8 counts use native strict MORE without overcounting two T8 affixes', () => {
  const input = draft();
  input.highAffixIds = [501, 502, 503, 504]; input.mediumAffixIds = [];
  input.scoring = { high: [0, 0, 0, 0, 0, 0, 1], medium: Array(7).fill(0), low: Array(7).fill(0) };
  input.equipmentGroups = [{ ...input.equipmentGroups[0], threshold: 75 }];
  const filter = exportedFilter(input);
  assert.equal(filter.match(gear([501, 8], [502, 8])).name, 'Other equipment');
  for (const [a, b, c] of [[7, 7, 7], [8, 8, 7], [8, 8, 8]]) {
    const item = { ...gear([501, a], [502, b]), sealedAffix: { id: 503, tier: c } };
    assertEquipmentMatches(input, filter, item, 'three matching prefixes including an extra affix');
  }
  assert.match(filter.xml, /<combinedComparsion>MORE<\/combinedComparsion>/);
  for (const rule of filter.rules) for (const condition of children(child(rule, 'conditions'), 'Condition')) {
    if (condition.attrs['i:type'] !== 'AffixCondition') continue;
    assert.ok(Number(text(condition, 'minOnTheSameItem')) >= 1);
    assert.ok(Number(text(condition, 'combinedComparsionValue')) <= 28);
    assert.ok(children(child(condition, 'affixes'), 'int').length > 0);
  }
});

test('nonmonotonic editable tiers, negative contributions and zero branches agree with direct arithmetic', () => {
  const input = draft(); input.highAffixIds = [501]; input.mediumAffixIds = [];
  input.scoring = { high: [0, -1, 0, 2, 0, -1, 2], medium: Array(7).fill(0), low: Array(7).fill(0) };
  input.equipmentGroups = [{ ...input.equipmentGroups[0], threshold: 25 }];
  let filter = exportedFilter(input);
  for (let tier = 1; tier <= 8; tier++) {
    assertEquipmentMatches(input, filter, gear([501, tier]), `nonmonotonic T${tier}`);
    assertEquipmentMatches(input, filter, { ...gear([1, 8]), primordialAffix: { id: 501, tier } });
  }
  assertEquipmentMatches(input, filter, gear(), 'empty zero-score item');
  input.highAffixIds = [501, 502]; input.mediumAffixIds = [1];
  input.scoring = { high: Array(7).fill(1), medium: Array(7).fill(-0.01), low: Array(7).fill(0) };
  input.equipmentGroups = [
    { ...input.equipmentGroups[0], threshold: 25 },
    { ...draft().equipmentGroups[1], threshold: 24 },
  ];
  filter = exportedFilter(input);
  const positive = gear([501, 7]);
  assert.equal(filter.match(positive).name, 'Score 25');
  assert.equal(filter.match({ ...positive, corruptedAffix: { id: 1, tier: 8 } }).name, 'Score 10');
  for (const item of [gear(), gear([1, 1]), positive, { ...positive, sealedAffix: { id: 1, tier: 5 } }, gear([501, 1], [502, 1], [1, 8])]) {
    assertEquipmentMatches(input, filter, item, 'negative points are never clamped or ignored');
  }
});

test('sub-cent percentage cutoffs round toward the first reachable hundredth of a point', () => {
  const input = draft(); input.highAffixIds = [501]; input.mediumAffixIds = [];
  input.scoring = { high: Array(7).fill(0.01), medium: Array(7).fill(0), low: Array(7).fill(0) };
  for (const threshold of [1, 25, 26, 100]) {
    input.equipmentGroups = [{ ...input.equipmentGroups[0], threshold }];
    const filter = exportedFilter(input);
    for (const item of [gear(), gear([501, 1]), gear([501, 8])]) assertEquipmentMatches(input, filter, item, `${threshold}% of .04`);
  }
  input.scoring.high[6] = 0;
  assert.throws(() => generateValueFilter(input), error => error.code === 'INVALID_SCORE_REFERENCE');
});

function equipmentSamples(count = 1800) {
  let seed = 0x1e5c0de;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const prefixes = [501, 502, 503, 504, 70], suffixes = [25, 22, 1, 13, 17, 10];
  return Array.from({ length: count }, () => {
    const affixes = [], used = new Set();
    for (const pool of [prefixes, suffixes]) {
      const available = [...pool], quantity = random(3);
      for (let n = 0; n < quantity; n++) {
        const id = available.splice(random(available.length), 1)[0];
        used.add(id); affixes.push({ id, tier: random(8) + 1 });
      }
    }
    const item = { equipmentType: 'HELMET', rarity: 'EXALTED', affixes };
    for (const field of ['sealedAffix', 'corruptedAffix', 'primordialAffix']) if (random(2)) {
      const available = [...prefixes, ...suffixes].filter(id => !used.has(id));
      const id = available[random(available.length)]; used.add(id);
      item[field] = { id, tier: random(8) + 1 };
    }
    return item;
  });
}

function scoreBoundarySamples(input) {
  const high = new Set(input.highAffixIds), medium = new Set(input.mediumAffixIds);
  const pools = { high: [], medium: [], low: [] };
  for (const affix of Object.values(catalog.affixes)) if (affix.tierCount === 8 && affix.canRollOn.includes(0) && affix.specialAffixType !== 7) {
    pools[high.has(affix.id) ? 'high' : medium.has(affix.id) ? 'medium' : 'low'].push(affix.id);
  }
  const cases = [
    [[4, 7], [0, 1], [0, 1]], [[4, 8], [0, 1], [1, 1]],
    [[3, 7], [2, 7], [1, 7]], [[3, 7], [2, 7], [1, 6]],
    [[2, 7], [2, 7], [0, 1]], [[2, 7], [2, 7], [1, 1]],
    [[3, 6], [3, 5], [0, 1]], [[3, 6], [3, 5], [1, 1]],
    [[3, 6], [3, 5], [1, 7]], [[0, 1], [7, 8], [0, 1]],
    [[7, 6], [0, 1], [0, 1]], [[7, 8], [0, 1], [0, 1]],
    [[0, 1], [0, 1], [0, 1]], [[0, 1], [0, 1], [1, 1]],
  ];
  return cases.map(specification => {
    const affixes = ['high', 'medium', 'low'].flatMap((pool, index) => {
      const [count, tier] = specification[index];
      assert.ok(pools[pool].length >= count, `boundary fixture lacks ${pool} IDs`);
      return pools[pool].slice(0, count).map(id => ({ id, tier }));
    });
    return { equipmentType: 'HELMET', rarity: 'EXALTED', affixes: affixes.slice(0, 4), sealedAffix: affixes[4], corruptedAffix: affixes[5], primordialAffix: affixes[6] };
  });
}

test('exact XML matches independently scored items with all three additional affix sources', () => {
  const input = draft(), filter = exportedFilter(input);
  equipmentSamples().forEach((item, index) => assertEquipmentMatches(input, filter, item, `sample ${index}`));
  assert.ok(filter.rules.length <= 200);
  assert.notEqual(filter.generated.diagnostics.approximate, true);
});

test('the seventh affix can cross a score threshold and is not discarded or capped at four', () => {
  const input = draft(); input.highAffixIds = [501, 502]; input.mediumAffixIds = [503, 504, 1, 13];
  input.scoring = { high: Array(7).fill(1), medium: Array(7).fill(0.25), low: Array(7).fill(0) };
  input.equipmentGroups = [{ ...input.equipmentGroups[0], threshold: 75 }];
  const filter = exportedFilter(input);
  const six = { ...gear([501, 1], [503, 1], [1, 1], [17, 1]), sealedAffix: { id: 502, tier: 1 }, corruptedAffix: { id: 13, tier: 1 } };
  const seven = { ...six, primordialAffix: { id: 504, tier: 8 } };
  assert.equal(filter.match(six).name, 'Other equipment');
  assert.equal(filter.match(seven).name, 'Score 25');
  assertEquipmentMatches(input, filter, six); assertEquipmentMatches(input, filter, seven);
  assert.notEqual(filter.generated.diagnostics.approximate, true);
});

test('the actual Build can export a precise low-threshold configuration without changing its other pools', () => {
  for (const id of ['om6w3Ypq', 'Q9JP5wbn']) {
    const input = createValueFilterDraft(JSON.parse(readFileSync(new URL(`./fixtures/planner-${id}.json`, import.meta.url), 'utf8')));
    input.language = 'en'; input.scoring.low = [0, 0, 0, 0, 0, 1, 2];
    input.equipmentGroups = [{ ...draft().equipmentGroups[0], threshold: 1 }];
    const filter = exportedFilter(input);
    assert.ok(filter.rules.length <= 200);
    equipmentSamples(600).forEach((item, index) => assertEquipmentMatches(input, filter, item, `${id} sample ${index}`));
  }
});

test('default conservative export stays within 200 rules and never demotes a qualifying item', () => {
  for (const id of ['om6w3Ypq', 'Q9JP5wbn']) {
    const input = createValueFilterDraft(JSON.parse(readFileSync(new URL(`./fixtures/planner-${id}.json`, import.meta.url), 'utf8')));
    input.language = 'en';
    const before = structuredClone(input), filter = exportedFilter(input);
    assert.deepEqual(input, before, 'export cannot rewrite the requested scoring table or groups');
    assert.ok(filter.rules.length <= 200);
    const names = input.equipmentGroups.filter(group => group.enabled).toSorted((a, b) => b.threshold - a.threshold).map(group => group.name);
    const rank = name => names.includes(name) ? names.indexOf(name) : names.length;
    for (const [index, item] of [...equipmentSamples(2000), ...scoreBoundarySamples(input)].entries()) {
      const expected = expectedEquipment(input, item), actual = filter.match(item);
      assert.ok(actual, `${id}/${index}: missing terminal match`);
      assert.ok(rank(actual.name) <= rank(expected.name), `${id}/${index}: approximation demoted ${expected.name} to ${actual.name}`);
      if (expected.action === 'SHOW') assert.equal(actual.action, 'SHOW', `${id}/${index}: approximation hid a wanted item`);
      assert.ok(rank(expected.name) - rank(actual.name) <= filter.generated.diagnostics.errorBounds.maxGroupPromotion, 'reported promotion bound must cover the actual XML');
      const promoted = input.equipmentGroups.find(group => group.name === actual.name);
      if (promoted) {
        const score = [...(item.affixes ?? []), item.sealedAffix, item.corruptedAffix, item.primordialAffix].filter(Boolean).reduce((total, affix) => {
          const category = input.highAffixIds.includes(affix.id) ? 'high' : input.mediumAffixIds.includes(affix.id) ? 'medium' : 'low';
          return total + Math.round(input.scoring[category][Math.min(affix.tier, 7) - 1] * 100);
        }, 0) / 100;
        const assignedMinimum = 4 * input.scoring.high[6] * promoted.threshold / 100;
        assert.ok(assignedMinimum - score <= filter.generated.diagnostics.errorBounds.maxScoreOverstatement + 1e-9, 'reported score bound must cover the actual XML');
      }
    }
    assert.equal(filter.generated.diagnostics.approximate, true);
    assert.ok(filter.generated.warnings.some(warning => warning.code === 'EQUIPMENT_SCORE_APPROXIMATION'), 'the exported result must disclose its approximation');
    assert.ok(Number.isFinite(filter.generated.diagnostics.errorBounds.maxGroupPromotion));
    assert.ok(Number.isFinite(filter.generated.diagnostics.errorBounds.maxScoreOverstatement));
    assert.deepEqual(filter.rules.map(rule => Number(text(rule, 'Order'))), Array.from({ length: filter.rules.length }, (_, index) => index));
  }
});

test('a hidden score group cannot silently use conservative approximation that might hide wanted equipment', () => {
  const input = createValueFilterDraft(fixture);
  input.equipmentGroups[0].show = false;
  const before = structuredClone(input);
  assert.throws(() => generateValueFilter(input), error => error.code === 'APPROXIMATE_HIDDEN_SCORE_GROUP');
  assert.deepEqual(input, before);
});

test('other exalted gear still needs T7 or two T6 and remains below exact useful-score groups', () => {
  const input = draft(), filter = exportedFilter(input);
  const exalted = (...affixes) => ({ ...gear(...affixes), rarity: 'EXALTED' });
  assert.equal(filter.match(exalted([503, 7])).name, 'Other high-tier exalted equipment');
  assert.equal(filter.match(exalted([503, 6], [13, 6])).name, 'Other high-tier exalted equipment');
  assert.equal(filter.match(exalted([503, 6], [13, 5])).name, 'Other equipment');
  assert.equal(filter.match(exalted([503, 6])).action, 'HIDE');
  assert.equal(filter.match(exalted([501, 7])).name, 'Score 25');
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
    input.equipmentGroups = [];
    assert.doesNotMatch(generateValueFilter(input).xml, /<int>1136<\/int>/);
  }
  const exulis = createValueFilterDraft(source({ amulet: { id: uniqueId(469, 8), affixes: [{ id: affixId(1083), tier: 1 }, { id: affixId(1084), tier: 1 }], corruptedAffix: { id: affixId(7), tier: 3 } } }));
  assert.deepEqual(exulis.highAffixIds, [7], 'Exulis fixed type-6 variants are not additional corruption targets');
  assert.deepEqual(exulis.analysis.targets[0].inherentAffixes.map(affix => affix.id), [1083, 1084]);
});

test('medium-value edits recompute the implicit low pool without mutating the saved draft', () => {
  const input = draft(), before = structuredClone(input);
  assert.equal(exportedFilter(input).match(gear([1, 5])).name, 'Score 10');
  assert.deepEqual(input, before);
  assert.equal(Object.hasOwn(input, 'lowAffixIds'), false);
  input.mediumAffixIds = [];
  assert.equal(exportedFilter(input).match(gear([1, 5])).name, 'Other equipment');
  assert.equal(exportedFilter(input).match(gear([1, 5])).action, 'HIDE');
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
  const manual = draft(); manual.highAffixIds = [1084]; manual.mediumAffixIds = [];
  assert.equal(exportedFilter(manual).match({ equipmentType: 'AMULET', rarity: 'RARE', affixes: [{ id: 1084, tier: 3 }] }).name, 'Score 25');
});
