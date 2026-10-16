import test from 'node:test';
import assert from 'node:assert/strict';
import LZString from 'lz-string';
import catalog from '../web/src/core/game-item-data.json' with { type: 'json' };
import { decodeSavedItem, encodePlannerItem } from '../web/src/core/items.js';
import { saveToPlannerBuild } from '../web/src/core/reverse-planner.js';

const aliases = ['affixes', 'sealedAffix', 'primordialAffix', 'corruptedAffix'];
const uniques = Object.entries(catalog.uniques).map(([id, definition]) => ({ id: Number(id), ...definition }));
const fakePools = uniques.filter(unique => unique.specificAffixIds?.some(id => catalog.affixes[id].specialType === 7));
const fakeIds = Object.entries(catalog.affixes).filter(([, affix]) => affix.specialType === 7).map(([id]) => Number(id));
const ir = [0, 97, 255], ur = [0, 31, 63, 95, 127, 159, 191, 255];
const affix = (id, tier = 1, r = 97) => ({ id: `A${LZString.compressToBase64(String(id))}`, tier, r });
const uniqueId = unique => `U${LZString.compressToBase64(String(unique.subTypes[0]).padStart(3, '0') + String(unique.id).padStart(3, '0'))}`;
const baseId = (type, subtype = 0) => `I${LZString.compressToBase64(`1${String(type).padStart(3, '0')}${String(subtype).padStart(3, '0')}000`)}`;
const tuples = item => item.affixes.map(a => [a.affixId, a.tier, a.roll]).sort((a, b) => a[0] - b[0]);
const rawTuple = a => [Number(LZString.decompressFromBase64(a.id.slice(1))), a.tier, a.r ?? 128];
const recordTuples = record => [...(record.affixes ?? []), record.sealedAffix, record.primordialAffix, record.corruptedAffix].filter(Boolean).map(rawTuple).sort((a, b) => a[0] - b[0]);
function recordFor(unique) {
  return { id: uniqueId(unique), ir: [...ir], ur: [...ur], affixes: (unique.specificAffixIds ?? []).slice(0, unique.specificAffixCount ?? 0).map(id => affix(id)) };
}
function aliasRecord(unique, id, tier, alias) {
  const record = recordFor(unique);
  record.affixes = unique.specificAffixIds.filter(candidate => candidate !== id).slice(0, unique.specificAffixCount - 1).map(candidate => affix(candidate));
  const selected = affix(id, tier, (id + tier) % 256);
  if (alias === 'affixes') record.affixes.unshift(selected);
  else record[alias] = selected;
  return record;
}
function saveFor(item) {
  return { level: 100, characterClass: 0, chosenMastery: 1, savedItems: [item], savedCharacterTree: { treeID: '', version: 4, nodeIDs: [], nodePoints: [], unspentPoints: 113 }, savedSkillTrees: [], abilityBar: ['', '', '', '', ''] };
}

test('the audit covers every fixed pool and distinguishes fake modifiers from Exulis corruption affixes', () => {
  assert.equal(uniques.length, 489);
  assert.deepEqual(fakePools.map(unique => unique.id), [477, 479, 486]);
  assert.equal(fakeIds.length, 38);
  assert.deepEqual(fakeIds.toSorted((a, b) => a - b), fakePools.flatMap(unique => unique.specificAffixIds).toSorted((a, b) => a - b));
  assert.deepEqual(uniques.filter(unique => unique.specificAffixes).map(unique => unique.id), [469, 477, 479, 486]);
  for (const unique of fakePools) for (const id of unique.specificAffixIds) {
    assert.deepEqual(catalog.affixes[id].canRollOn, [unique.baseType]);
    assert.equal(catalog.affixes[id].tierCount, unique.id === 486 ? 1 : 8);
  }
  assert.deepEqual(catalog.uniques[469].specificAffixIds, [1083, 1084, 1085, 1086, 1087]);
  assert.ok(catalog.uniques[469].specificAffixIds.every(id => catalog.affixes[id].specialType === 6));
});

test('all 489 unique identities keep inherent ir/ur separate; unsupported mechanics fail explicitly', () => {
  let supported = 0, cocoons = 0, unsupportedPrecorrupted = 0;
  for (const unique of uniques) {
    const record = recordFor(unique), before = structuredClone(record);
    if (unique.cocooned || unique.id === 470) {
      assert.throws(() => encodePlannerItem(record, { containerID: 10 }), { code: 'UNSUPPORTED_ITEM_FEATURE' }, `unique ${unique.id}`);
      unique.cocooned ? cocoons++ : unsupportedPrecorrupted++;
    } else {
      const decoded = decodeSavedItem(encodePlannerItem(record, { containerID: 10, individualId: 123 }));
      assert.equal(decoded.uniqueId, unique.id);
      assert.equal(decoded.baseTypeId, unique.baseType);
      assert.equal(decoded.subTypeId, unique.subTypes[0]);
      assert.deepEqual(decoded.implicitRolls, ir);
      assert.deepEqual(decoded.uniqueRolls, ur);
      assert.deepEqual(tuples(decoded), recordTuples(record), `unique ${unique.id}: inherent roll bytes cannot become affixes`);
      supported++;
    }
    assert.deepEqual(record, before);
  }
  assert.deepEqual({ supported, cocoons, unsupportedPrecorrupted }, { supported: 465, cocoons: 23, unsupportedPrecorrupted: 1 });
});

test('every owned fake modifier retains all catalog-supported tiers through every accepted source field', () => {
  let combinations = 0;
  for (const unique of fakePools) for (const id of unique.specificAffixIds) for (let tier = 1; tier <= catalog.affixes[id].tierCount; tier++) for (const alias of aliases) {
    const record = aliasRecord(unique, id, tier, alias), before = structuredClone(record);
    for (const maxRolls of [false, true]) {
      const decoded = decodeSavedItem(encodePlannerItem(record, { containerID: 10, individualId: 123, maxRolls }));
      assert.equal(decoded.rarity, 7, `${unique.id}/${id}/T${tier}/${alias}: fake modifiers alone are not legendary additions`);
      assert.equal(decoded.affixes.length, unique.specificAffixCount);
      assert.deepEqual(tuples(decoded), recordTuples(record).map(([id, tier, roll]) => [id, tier, maxRolls ? 255 : roll]));
    }
    assert.deepEqual(record, before);
    combinations++;
  }
  assert.equal(combinations, 1132, 'catalog tier bounds are encoding coverage, not a claim all tiers naturally drop');
});

test('all 38 fake modifiers are rejected on every foreign unique in every source field, including sets', () => {
  let combinations = 0;
  for (const unique of uniques) for (const id of fakeIds) {
    if (unique.specificAffixIds?.includes(id)) continue;
    for (const alias of aliases) {
      const record = recordFor(unique), fake = affix(id);
      if (alias === 'affixes') record.affixes.push(fake); else record[alias] = fake;
      assert.throws(() => encodePlannerItem(record, { containerID: 10 }), error => ['INVALID_UNIQUE_VARIANT', 'UNSUPPORTED_ITEM_FEATURE'].includes(error.code), `foreign fake ${id} on unique ${unique.id} via ${alias}`);
      combinations++;
    }
  }
  assert.equal(combinations, (489 * 38 - 38) * 4);
  for (const id of fakeIds) for (const alias of aliases) {
    const record = { id: baseId(21), affixes: [] }, fake = affix(id);
    if (alias === 'affixes') record.affixes.push(fake); else record[alias] = fake;
    assert.throws(() => encodePlannerItem(record, { containerID: 10 }), { code: 'INVALID_UNIQUE_VARIANT' }, `normal item foreign fake ${id}/${alias}`);
  }
});

test('fixed modifier ownership does not exempt invalid tiers, duplicate identities or malformed rolls', () => {
  for (const unique of fakePools) for (const id of unique.specificAffixIds) for (const alias of aliases) {
    for (const tier of [0, catalog.affixes[id].tierCount + 1]) assert.throws(() => encodePlannerItem(aliasRecord(unique, id, tier, alias), { containerID: 10 }), { code: 'INVALID_ITEM' });
    const badRoll = aliasRecord(unique, id, 1, alias);
    (alias === 'affixes' ? badRoll.affixes[0] : badRoll[alias]).r = 999;
    assert.throws(() => encodePlannerItem(badRoll, { containerID: 10, maxRolls: true }), { code: 'INVALID_ROLL' });
    const duplicate = aliasRecord(unique, id, 1, alias);
    if (alias === 'affixes') duplicate.sealedAffix = affix(id); else duplicate.affixes.push(affix(id));
    assert.throws(() => encodePlannerItem(duplicate, { containerID: 10 }), { code: 'DUPLICATE_AFFIX' });
  }
});

test('Exulis pool membership is source-specific and never globally excludes valid amulet corruption additions', () => {
  const exulis = uniques.find(unique => unique.id === 469);
  for (const id of exulis.specificAffixIds) {
    const second = exulis.specificAffixIds.find(candidate => candidate !== id);
    const owned = { id: uniqueId(exulis), affixes: [affix(id, 5), affix(second, 5)] };
    const decoded = decodeSavedItem(encodePlannerItem(owned, { containerID: 11 }));
    assert.equal(decoded.rarity, 9, 'type 6 retains native legendary semantics rather than FakeUniqueMod semantics');
    const additional = { id: baseId(20), corruptedAffix: affix(id, 5) };
    const ordinary = decodeSavedItem(encodePlannerItem(additional, { containerID: 11 }));
    assert.deepEqual(tuples(ordinary), [[id, 5, 97]]);
  }
});

test('read-only reverse mapping preserves every fixed modifier and its tier/roll without relying on its planner alias', () => {
  for (const unique of fakePools) for (const id of unique.specificAffixIds) for (const alias of aliases) {
    const record = aliasRecord(unique, id, catalog.affixes[id].tierCount, alias);
    const idol = unique.baseType >= 25 && unique.baseType <= 33;
    const containerID = idol ? 29 : unique.baseType === 4 ? 6 : 10;
    const original = encodePlannerItem(record, { containerID, individualId: 123 });
    const save = saveFor(original), before = structuredClone(save);
    const { build, warnings } = saveToPlannerBuild(save);
    assert.equal(warnings.filter(warning => warning.slot).length, 0, `${unique.id}/${id}/${alias}`);
    const returned = idol ? build.data.idols[0] : build.data.equipment[containerID === 6 ? 'hands' : 'ring1'];
    const left = decodeSavedItem(original), right = decodeSavedItem(encodePlannerItem(returned, { containerID, individualId: 123 }));
    for (const property of ['uniqueId', 'rarity', 'flags', 'extraFlags']) assert.equal(right[property], left[property], `${unique.id}/${id}/${alias}/${property}`);
    assert.deepEqual(tuples(right), tuples(left));
    assert.deepEqual(right.implicitRolls, left.implicitRolls);
    assert.deepEqual(right.uniqueRolls, left.uniqueRolls);
    assert.deepEqual(save, before);
  }
});

test('a genuine T8 addition remains separate from an owned T8 fake modifier and corruption stays last', () => {
  const rage = uniques.find(unique => unique.id === 477);
  const record = { id: uniqueId(rage), affixes: [affix(1136, 8, 31)], primordialAffix: affix(501, 8, 63), corruptedAffix: affix(1027, 6, 127) };
  // Item serialization identifies a T8 seal by tier after explicit seal flags;
  // fixed ownership and T8 sealing are separate facts. Both IDs retain T8.
  const decoded = decodeSavedItem(encodePlannerItem(record, { containerID: 10 }));
  assert.deepEqual(decoded.affixes.map(a => [a.affixId, a.tier]), [[501, 8], [1136, 8], [1027, 6]]);
  assert.equal(decoded.extraFlags, 128);
  assert.throws(() => encodePlannerItem({ ...record, primordialAffix: affix(501, 7) }, { containerID: 10 }), { code: 'INVALID_PRIMORDIAL_AFFIX' });
});
