import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import LZString from 'lz-string';
import { parse, stringify } from 'lossless-json';
import { decodeSavedItem, encodeItemData, encodePlannerItem, applyPlannerItems, resolvePlannerItemId } from '../web/src/core/items.js';

const baseId = (base, subtype) => `I${LZString.compressToBase64(`1${String(base).padStart(3, '0')}${String(subtype).padStart(3, '0')}000`).replace(/=+$/, '')}`;
const affixId = id => `A${LZString.compressToBase64(String(id)).replace(/=+$/, '')}`;

test('decodes LET identifiers independently of minified website code or lookup tables', () => {
  assert.deepEqual(resolvePlannerItemId('UAwRgrALA7CQ'), { baseTypeId: 0, subTypeId: 15, uniqueId: 471 });
  assert.deepEqual(resolvePlannerItemId('UAzCMIDiA'), { baseTypeId: 1, subTypeId: 1, uniqueId: 8 });
  assert.deepEqual(resolvePlannerItemId('IIwBgzALATMDsIKA'), { baseTypeId: 34, subTypeId: 217 });
  assert.deepEqual(resolvePlannerItemId(baseId(41, 3)), { baseTypeId: 41, subTypeId: 3 });
  assert.throws(() => resolvePlannerItemId('Ibroken'), { code: 'UNKNOWN_PLANNER_ITEM' });
  assert.throws(() => resolvePlannerItemId(baseId(41, 250)), { code: 'UNKNOWN_GAME_ITEM' });
});

test('golden v6 legendary layout uses four-byte identity, eight unique rolls and packed affix tier', () => {
  // Synthetic values laid out according to ItemData.RebuildID, game 1.5.2.1.
  const golden = [6, 1, 2, 3, 4, 0, 15, 9, 128, 0, 128, 255, 1, 215, 1, 2, 3, 4, 5, 6, 7, 8, 1, 97, 152, 255];
  const decoded = decodeSavedItem(golden);
  assert.equal(decoded.individualId, 0x01020304);
  assert.equal(decoded.uniqueId, 471);
  assert.deepEqual(decoded.affixes, [{ affixId: 408, tier: 7, roll: 255 }]);
  assert.deepEqual(encodeItemData(decoded), golden);
  const saved = encodePlannerItem({ id: 'UAwRgrALA7CQ', affixes: [{ id: 'ACwBgHEA', tier: 7, r: 255 }], ir: [0, 128, 255], ur: [1, 2, 3, 4, 5, 6, 7, 8] }, { containerID: 2, individualId: 0x01020304 });
  assert.deepEqual(saved.data, golden);
});

test('normal v6 sealed and corrupted affix flags preserve their ordered blocks', () => {
  const item = encodePlannerItem({ id: baseId(2, 2), affixes: [{ id: affixId(26), tier: 6, r: 0 }],
    sealedAffix: { id: affixId(32), tier: 3, r: 100 }, corruptedAffix: { id: affixId(86), tier: 4, r: 250 } },
  { containerID: 7, individualId: 16 });
  assert.equal(item.data[8], 144);
  assert.equal(item.data[13], 195);
  assert.deepEqual(decodeSavedItem(item).affixes.map(x => x.affixId), [32, 86, 26]);
  assert.deepEqual(encodeItemData(decodeSavedItem(item)), item.data);
});

test('Weaver legendary remainder uses high five bits; primordial uniques use the ordinary unique layout', () => {
  const weaver = encodePlannerItem({ id: 'UAwRgTAzMxA', affixes: [{ id: affixId(26), tier: 5 }], ww: 13 }, { containerID: 12, individualId: 17 });
  assert.equal(weaver.data[7], 9);
  assert.equal(weaver.data[22], 13 * 8 + 1);
  const primordial = encodePlannerItem({ id: 'UAwRgzALBDsQ', affixes: [{ id: affixId(26), tier: 7 }] }, { containerID: 5, individualId: 18 });
  assert.equal(decodeSavedItem(primordial).uniqueId, 447);
  assert.equal(primordial.data[7], 9);
});

test('default rolls are midpoint and invalid new features cannot silently disappear', () => {
  const item = encodePlannerItem({ id: 'IIwBhCY0sg', affixes: [{ id: affixId(26), tier: 6 }] }, { containerID: 7, individualId: 20 });
  assert.deepEqual(item.data.slice(9, 12), [128, 128, 128]);
  assert.equal(item.data.at(-1), 128);
  assert.equal(item.data[12], 0);
  assert.throws(() => encodePlannerItem({ id: 'IIwBhCY0sg', unknownFutureSystem: 1 }, { containerID: 7 }), { code: 'UNSUPPORTED_ITEM_FEATURE' });
  assert.throws(() => encodePlannerItem({ id: 'IIwBhCY0sg', ir: [300] }, { containerID: 7 }), { code: 'INVALID_ROLL' });
  assert.throws(() => encodePlannerItem({ id: 'UAwRgrALA7CQ', corrupted: 'yes' }, { containerID: 2 }), { code: 'INVALID_ITEM' });
});

test('opaque items and untouched uint64 progress survive application without mutation', () => {
  const original = parse('{"savedItems":[{"containerID":1,"data":[99,1,2],"futureFlag":9007199254740993},{"containerID":93,"data":[6,1,2,3,4,109,8]}],"sceneProgresses":[{"savedProgress":18446744073709551615}]}');
  const before = stringify(original);
  const result = applyPlannerItems(original, { equipment: { head: { id: 'UAwRgrALA7CQ' } } }, { idols: false, blessings: false });
  assert.equal(stringify(original), before);
  assert.equal(stringify(result.data.savedItems.slice(0, 2)), stringify(original.savedItems));
  assert.equal(result.data.sceneProgresses[0].savedProgress.toString(), '18446744073709551615');
  assert.equal(decodeSavedItem(original.savedItems[0]).supported, false);
});

test('planner position transform and overlap checks use actual current game idol dimensions', () => {
  const first = { id: baseId(30, 13), x: 2, y: 1, affixes: [] };
  const result = applyPlannerItems({ savedItems: [] }, { idols: [first] }, { equipment: false, blessings: false });
  assert.deepEqual(result.data.savedItems[0].inventoryPosition, { x: 1, y: 2 });
  assert.throws(() => applyPlannerItems({ savedItems: [] }, { idols: [first, first] }, { equipment: false, blessings: false }), { code: 'OVERLAPPING_IDOLS' });
  assert.throws(() => applyPlannerItems({ savedItems: [] }, { equipment: { head: { id: baseId(21, 7) } } }, { idols: false, blessings: false }), { code: 'INVALID_EQUIPMENT_SLOT' });
});

test('selected sections must exist; only explicit empty sections clear equipped items', () => {
  const original = { savedItems: [encodePlannerItem({ id: baseId(34, 217) }, { containerID: 33, individualId: 21 })] };
  const before = stringify(original);
  assert.throws(() => applyPlannerItems(original, {}, { equipment: false, idols: false }), { code: 'MISSING_PLANNER_SECTION' });
  assert.throws(() => applyPlannerItems(original, { blessings: null }, { equipment: false, idols: false }), { code: 'INVALID_PLANNER_SECTION' });
  assert.throws(() => applyPlannerItems(original, {}, { idols: false, blessings: false }), { code: 'MISSING_PLANNER_SECTION' });
  assert.throws(() => applyPlannerItems(original, {}, { equipment: false, blessings: false }), { code: 'MISSING_PLANNER_SECTION' });
  assert.equal(stringify(original), before);
  assert.equal(applyPlannerItems(original, { blessings: {} }, { equipment: false, idols: false }).data.savedItems.length, 0);
  assert.equal(applyPlannerItems(original, {}, { equipment: false, idols: false, blessings: false }).data.savedItems.length, 1);
});

test('idol placement respects the final equipped altar even when only one section is selected', () => {
  const cornerIdol = { id: baseId(25, 0), x: 1, y: 1 };
  const altar = encodePlannerItem({ id: baseId(41, 3) }, { containerID: 123, individualId: 22 });
  const selected = { equipment: false, blessings: false };
  // Altar 3 opens the upper-left cell; the default layout blocks it.
  assert.throws(() => applyPlannerItems({ savedItems: [] }, { idols: [cornerIdol] }, selected), { code: 'BLOCKED_IDOL_CELL' });
  const equipped = applyPlannerItems({ savedItems: [altar] }, { idols: [cornerIdol] }, selected).data;
  assert.equal(equipped.savedItems.length, 2);
  // A build's unselected altar must not be used to validate the save's idols.
  assert.throws(() => applyPlannerItems({ savedItems: [] }, { equipment: { idol_altar: { id: baseId(41, 3) } }, idols: [cornerIdol] }, selected), { code: 'BLOCKED_IDOL_CELL' });
  // Removing only the altar must not leave an existing idol in a blocked cell.
  assert.throws(() => applyPlannerItems(equipped, { equipment: { idol_altar: null } }, { idols: false, blessings: false }), { code: 'BLOCKED_IDOL_CELL' });
  const together = applyPlannerItems({ savedItems: [] }, { equipment: { idol_altar: { id: baseId(41, 3) } }, idols: [cornerIdol] }, { blessings: false });
  assert.equal(together.data.savedItems.length, 2);
});

test('verified local backup items round-trip byte for byte; private files are optional and never committed', { skip: !existsSync('.local/fixtures/1CHARACTERSLOT_BETA_5') }, () => {
  let verified = 0;
  for (const filename of readdirSync('.local/fixtures')) {
    let data;
    try { const text = readFileSync(`.local/fixtures/${filename}`, 'utf8'); if (!text.startsWith('EPOCH')) continue; data = parse(text.slice(5)); }
    catch { continue; }
    for (const item of data.savedItems ?? []) {
      const decoded = decodeSavedItem(item);
      if (!decoded.supported) continue;
      assert.deepEqual(encodeItemData(decoded), item.data.map(Number));
      verified++;
    }
  }
  assert.ok(verified >= 101, `Expected current fixtures, verified ${verified} items`);
});

test('planner import retains native faction rank bits together with corruption and untradeable flags', () => {
  // Current native RebuildID packs requiredFaction << 6 | rank | corruption | untradeable.
  const cof = encodePlannerItem({ id: 'UAwRgrALA7CQ', faction: [0, 4] }, { containerID: 2, individualId: 24 });
  assert.equal(cof.data[8], 132);
  const merchant = encodePlannerItem({ id: baseId(2, 2), faction: [1, 5], corruptedAffix: { id: affixId(86), tier: 4, r: 40 } },
    { containerID: 7, individualId: 25, maxRolls: true });
  assert.equal(merchant.data[8], 213);
  assert.equal(decodeSavedItem(merchant).affixes[0].roll, 255);
  assert.deepEqual(encodeItemData(decodeSavedItem(merchant)), merchant.data);
  for (const faction of [[0, 12], [1, 12], [0, 0]]) {
    assert.equal(encodePlannerItem({ id: 'UAwRgrALA7CQ', faction }, { containerID: 2 }).data[8], 128 | faction[0] << 6 | faction[1]);
  }
});

test('malformed or unsupported faction requirements remain blocked with specific bilingual field errors', () => {
  for (const faction of [[], [0], [0, 4, 1], {}, [true, 4], [0, '4'], [2, 4], [-1, 4], [0, 13], [0, -1], [0, 4.5]]) {
    assert.throws(() => encodePlannerItem({ id: 'UAwRgrALA7CQ', faction }, { containerID: 2 }), error => {
      assert.ok(['INVALID_ITEM_FACTION', 'INVALID_ITEM'].includes(error.code));
      assert.ok(error.message.split(' / ').every(message => message.includes('faction')), error.message);
      assert.ok(error.details.field.startsWith('faction'));
      return true;
    });
  }
  assert.throws(() => encodePlannerItem({ id: 'UAwRgrALA7CQ', unknownFutureSystem: 1 }, { containerID: 2 }), error => {
    assert.equal(error.code, 'UNSUPPORTED_ITEM_FEATURE');
    assert.equal(error.details.field, 'unknownFutureSystem');
    assert.ok(error.message.split(' / ').every(message => message.includes('unknownFutureSystem')));
    return true;
  });
});

// Minimal public item descriptor, not a character save. Native v6 layout is the oracle.
const rageRing = {
  id: 'UAwRmBYHZKA', affixes: [{ id: 'AKwBgjEA', tier: 7, r: 191 }, { id: 'AAwdmQ', tier: 5 }],
  sealedAffix: { id: 'AIzDMDYg', tier: 1 }, ir: [252, 115, 230], ur: [81, 202, 11, 210, 109, 177, 237, 115],
};

test('Unsated Rage planner sealedAffix is a native FakeUniqueMod variant, not a discarded regular seal', () => {
  // RebuildID: rarity 9; unique ID 477; count 3; variant 1136 T1, then 501 T7 and 70 T5.
  const golden = [6,1,2,3,4,21,10,9,128,252,115,230,1,221,81,202,11,210,109,177,237,115,3,4,112,128,97,245,191,64,70,128];
  const encoded = encodePlannerItem(rageRing, { containerID: 10, individualId: 0x01020304 });
  assert.deepEqual(encoded.data, golden);
  assert.deepEqual(encodeItemData(decodeSavedItem(encoded)), golden);
  const maximum = decodeSavedItem(encodePlannerItem(rageRing, { containerID: 10, maxRolls: true }));
  assert.deepEqual(maximum.affixes.map(affix => [affix.affixId, affix.tier]), [[1136,1],[501,7],[70,5]]);
  assert.ok([...maximum.implicitRolls, ...maximum.uniqueRolls, ...maximum.affixes.map(affix => affix.roll)].every(roll => roll === 255));
});

test('fixed-pool variants alone keep unique rarity and LP, while true legendary affixes reject positive LP', () => {
  const ring = { id: rageRing.id, sealedAffix: rageRing.sealedAffix, lp: 3 };
  const unique = decodeSavedItem(encodePlannerItem(ring, { containerID: 10 }));
  assert.equal(unique.rarity, 7); assert.equal(unique.extraFlags, 3);
  assert.deepEqual(unique.affixes.map(affix => affix.affixId), [1136]);
  const direct = encodePlannerItem({ id: rageRing.id, affixes: [rageRing.sealedAffix], lp: 3 }, { containerID: 10, individualId: 16 });
  assert.deepEqual(direct.data, encodePlannerItem(ring, { containerID: 10, individualId: 16 }).data);
  assert.throws(() => encodePlannerItem({ ...rageRing, lp: 1 }, { containerID: 10 }), {code: 'INVALID_LEGENDARY_POTENTIAL'});
});

const reportedGloves = JSON.parse(readFileSync(new URL('./fixtures/planner-Q9JP5wbn.json', import.meta.url), 'utf8')).data.equipment.hands;

test('Q9JP5wbn gloves preserve the fixed variant in primordialAffix with its original T4 and native bytes', () => {
  // Native v6: unique 479; six records, corruption sealed LAST. The first two are fixed FakeUniqueMods.
  const golden = [6,1,2,3,4,4,3,9,209,9,252,51,1,223,42,205,146,164,135,122,93,178,134,
    68,121,97,52,123,3,97,247,178,96,17,90,64,80,171,84,3,6];
  const before = JSON.stringify(reportedGloves);
  const encoded = encodePlannerItem(reportedGloves, { containerID: 9, individualId: 0x01020304 });
  assert.deepEqual(encoded.data, golden);
  assert.deepEqual(encodeItemData(decodeSavedItem(encoded)), golden);
  assert.deepEqual(decodeSavedItem(encoded).affixes.map(a => [a.affixId, a.tier, a.roll]), [
    [1145,5,97], [1147,4,3], [503,7,178], [17,7,90], [80,5,171], [1027,6,6],
  ]);
  const maximum = encodePlannerItem(reportedGloves, { containerID: 9, individualId: 0x01020304, maxRolls: true });
  const rollOffsets = new Set([9,10,11,14,15,16,17,18,19,20,21,25,28,31,34,37,40]);
  assert.deepEqual(maximum.data, golden.map((value, index) => rollOffsets.has(index) ? 255 : value));
  assert.equal(JSON.stringify(reportedGloves), before);
});

test('fixed variants in the primordial slot retain unique rarity and LP while enforcing their unique count', () => {
  const one = { id: rageRing.id, primordialAffix: { ...rageRing.sealedAffix, tier: 4, r: 19 }, lp: 3 };
  const single = decodeSavedItem(encodePlannerItem(one, { containerID: 10 }));
  assert.equal(single.rarity, 7); assert.equal(single.extraFlags, 3);
  assert.deepEqual(single.affixes.map(a => [a.affixId, a.tier, a.roll]), [[1136, 4, 19]]);
  const pair = { id: reportedGloves.id, sealedAffix: reportedGloves.sealedAffix, primordialAffix: reportedGloves.primordialAffix, lp: 3 };
  const encoded = encodePlannerItem(pair, { containerID: 9, individualId: 16 }), decoded = decodeSavedItem(encoded);
  assert.equal(decoded.rarity, 7); assert.equal(decoded.extraFlags, 3); assert.equal(encoded.data[22], 67);
  assert.deepEqual(decoded.affixes.map(a => [a.affixId, a.tier]), [[1145, 5], [1147, 4]]);
  const direct = encodePlannerItem({ id: pair.id, affixes: [pair.sealedAffix, pair.primordialAffix], lp: 3 }, { containerID: 9, individualId: 16 });
  assert.deepEqual(direct.data, encoded.data);
  assert.throws(() => encodePlannerItem({ id: pair.id, primordialAffix: pair.primordialAffix }, { containerID: 9 }), { code: 'INVALID_UNIQUE_VARIANT' });
  assert.throws(() => encodePlannerItem({ ...pair, affixes: [{ id: affixId(1140), tier: 1 }] }, { containerID: 9 }), { code: 'INVALID_UNIQUE_VARIANT' });
});

test('corruption cannot remove fixed variants from uniques whose game definition preserves them', () => {
  const catalog = JSON.parse(readFileSync(new URL('../web/src/core/game-item-data.json', import.meta.url), 'utf8'));
  for (const unique of [477, 479, 486]) {
    const definition = catalog.uniques[unique];
    assert.equal(definition.corruptionPreservesDroppableAffixes, true);
    const id = `U${LZString.compressToBase64(String(definition.subTypes[0]).padStart(3, '0') + String(unique).padStart(3, '0'))}`;
    const variants = definition.specificAffixIds.slice(0, definition.specificAffixCount).map((value, index) => ({ id: affixId(value), tier: 1, r: 19 + index }));
    for (const maxRolls of [false, true]) {
      for (let count = 0; count < variants.length; count++) {
        assert.throws(() => encodePlannerItem({ id, corrupted: true, affixes: variants.slice(0, count) }, { containerID: 10, maxRolls }), { code: 'INVALID_UNIQUE_VARIANT' }, `unique ${unique}, ${count} fixed variants`);
      }
      const complete = decodeSavedItem(encodePlannerItem({ id, corrupted: true, affixes: variants }, { containerID: 10, maxRolls }));
      assert.deepEqual(complete.affixes.map(affix => [affix.affixId, affix.tier, affix.roll]), definition.specificAffixIds.slice(0, definition.specificAffixCount).map((value, index) => [value, 1, maxRolls ? 255 : 19 + index]));
      assert.equal(complete.rarity, 7);
      assert.ok(complete.flags & 16);
    }
  }
  // The reported gloves express corruption through an affix rather than the boolean flag.
  const incomplete = { ...reportedGloves, primordialAffix: undefined };
  delete incomplete.primordialAffix;
  assert.throws(() => encodePlannerItem(incomplete, { containerID: 9 }), { code: 'INVALID_UNIQUE_VARIANT' });
});

test('Exulis retains the existing corrupted fixed-pool count range instead of inheriting FakeUniqueMod preservation', () => {
  const catalog = JSON.parse(readFileSync(new URL('../web/src/core/game-item-data.json', import.meta.url), 'utf8'));
  const definition = catalog.uniques[469];
  assert.equal(definition.corruptionPreservesDroppableAffixes, false);
  const id = `U${LZString.compressToBase64('008469')}`;
  const variants = definition.specificAffixIds.slice(0, 3).map((value, index) => ({ id: affixId(value), tier: 4, r: 37 + index }));
  for (const count of [0, 1, 2]) {
    const decoded = decodeSavedItem(encodePlannerItem({ id, affixes: variants.slice(0, count) }, { containerID: 11 }));
    assert.deepEqual(decoded.affixes.map(affix => [affix.affixId, affix.tier, affix.roll]), definition.specificAffixIds.slice(0, count).map((value, index) => [value, 4, 37 + index]));
    assert.ok(decoded.flags & 16);
    if (count) assert.equal(decoded.rarity, 9);
  }
  assert.throws(() => encodePlannerItem({ id, affixes: variants }, { containerID: 11 }), { code: 'INVALID_UNIQUE_VARIANT' });
});

test('BakqJGYy Exulis source aliases preserve owned type-6 variants and native legendary flags', () => {
  const build = JSON.parse(readFileSync(new URL('./fixtures/planner-BakqJGYy.json', import.meta.url), 'utf8')).data;
  for (const maxRolls of [false, true]) {
    const result = applyPlannerItems({ savedItems: [] }, build, { idols: false, blessings: false, maxRolls });
    const saved = result.data.savedItems.find(item => item.containerID === 11);
    const decoded = decodeSavedItem(saved);
    assert.equal(decoded.uniqueId, 469);
    assert.equal(decoded.rarity, 9);
    assert.equal(decoded.flags, 144);
    assert.equal(decoded.extraFlags, 0, 'fixed pool entries are not a corruption-sealed last affix');
    assert.deepEqual(decoded.affixes, [
      { affixId: 1083, tier: 7, roll: maxRolls ? 255 : 128 },
      { affixId: 1087, tier: 8, roll: maxRolls ? 255 : 128 },
    ]);
    assert.deepEqual(encodeItemData(decoded), saved.data);
  }
  // All five pool members can occupy either LET alias, even below T8.
  for (const id of [1083, 1084, 1085, 1086, 1087]) for (const field of ['sealedAffix', 'primordialAffix']) {
    const decoded = decodeSavedItem(encodePlannerItem({ id: build.equipment.amulet.id, [field]: { id: affixId(id), tier: 4, r: 19 } }, { containerID: 11 }));
    assert.deepEqual(decoded.affixes, [{ affixId: id, tier: 4, roll: 19 }]);
    assert.equal(decoded.rarity, 9);
  }
  assert.throws(() => encodePlannerItem({ id: build.equipment.amulet.id, sealedAffix: { id: affixId(26), tier: 7 } }, { containerID: 11 }), { code: 'UNSUPPORTED_ITEM_FEATURE' });
  assert.throws(() => encodePlannerItem({ ...build.equipment.amulet, lp: 1 }, { containerID: 11 }), { code: 'INVALID_LEGENDARY_POTENTIAL' });
  assert.throws(() => encodePlannerItem({ ...build.equipment.amulet, primordialAffix: build.equipment.amulet.sealedAffix }, { containerID: 11 }), { code: 'DUPLICATE_AFFIX' });
});

test('only a matching fixed variant bypasses the T8 source check; ordinary and foreign variants remain rejected', () => {
  for (const tier of [4, 8]) {
    const foreign = { id: affixId(1147), tier };
    for (const id of [rageRing.id, 'UAwRgrALA7CQ', baseId(4, 3)]) {
      assert.throws(() => encodePlannerItem({ id, primordialAffix: foreign }, { containerID: 9 }), { code: 'INVALID_UNIQUE_VARIANT' });
    }
  }
  for (const tier of [1, 4, 7]) {
    assert.throws(() => encodePlannerItem({ id: baseId(4, 3), primordialAffix: { id: affixId(26), tier } }, { containerID: 9 }), { code: 'INVALID_PRIMORDIAL_AFFIX' });
  }
  const genuine = decodeSavedItem(encodePlannerItem({ id: baseId(4, 3), primordialAffix: { id: affixId(26), tier: 8 } }, { containerID: 9 }));
  assert.deepEqual(genuine.affixes.map(a => [a.affixId, a.tier]), [[26, 8]]);
  const invalidRoll = { ...reportedGloves, primordialAffix: { ...reportedGloves.primordialAffix, r: 256 } };
  assert.throws(() => encodePlannerItem(invalidRoll, { containerID: 9, maxRolls: true }), { code: 'INVALID_ROLL' });
});

test('every source rejects a foreign FakeUniqueMod on ordinary equipment, ordinary uniques and set items', () => {
  // Construct known ordinary unique/set IDs directly, avoiding reliance on display names.
  const uniqueId = (subtype, unique) => `U${LZString.compressToBase64(String(subtype).padStart(3, '0') + String(unique).padStart(3, '0'))}`;
  const ids = [baseId(21, 0), uniqueId(7, 66), 'UAwRgrALA7CQ', uniqueId(3, 79)];
  for (const id of ids) for (const field of ['affixes', 'sealedAffix', 'primordialAffix', 'corruptedAffix']) {
    for (const tier of [4, 8]) {
      const variant = { id: affixId(1136), tier, r: 19 };
      const record = { id, [field]: field === 'affixes' ? [variant] : variant };
      assert.throws(() => encodePlannerItem(record, { containerID: 10, individualId: 16 }), error => ['INVALID_UNIQUE_VARIANT', 'UNSUPPORTED_ITEM_FEATURE'].includes(error.code), `${id}: ${field} T${tier}`);
    }
  }
});

test('matching fixed variants keep tier, roll and source ordering across all supported slots', () => {
  for (const field of ['affixes', 'sealedAffix', 'primordialAffix', 'corruptedAffix']) for (const tier of [4, 8]) {
    const variant = { id: affixId(1136), tier, r: 19 }, regular = { id: affixId(501), tier: 5, r: 73 };
    const record = { id: rageRing.id, affixes: field === 'affixes' ? [variant, regular] : [regular], ...(field === 'affixes' ? {} : { [field]: variant }) };
    const encoded = encodePlannerItem(record, { containerID: 10, individualId: 16 }), decoded = decodeSavedItem(encoded);
    assert.deepEqual(decoded.affixes.map(a => [a.affixId, a.tier, a.roll]), field === 'corruptedAffix' ? [[501,5,73], [1136,tier,19]] : [[1136,tier,19], [501,5,73]]);
    assert.equal(decoded.rarity, 9);
    assert.equal(decoded.flags, field === 'corruptedAffix' ? 144 : 128);
    assert.equal(decoded.extraFlags, field === 'corruptedAffix' ? 128 : 0);
    assert.deepEqual(encodeItemData(decoded), encoded.data);
  }
});

test('unique variant pool/count and unsupported seals remain strict and report the offending slot atomically', () => {
  assert.throws(() => encodePlannerItem({ id: rageRing.id }, {containerID: 10}), {code: 'INVALID_UNIQUE_VARIANT'});
  assert.throws(() => encodePlannerItem({ ...rageRing, sealedAffix: {id: affixId(26), tier: 3} }, {containerID: 10}), {code: 'UNSUPPORTED_ITEM_FEATURE'});
  assert.throws(() => encodePlannerItem({ ...rageRing, affixes: [...rageRing.affixes, {id: affixId(1140), tier: 1}] }, {containerID: 10}), {code: 'INVALID_UNIQUE_VARIANT'});
  const original = {savedItems: [{containerID: 1, data: [99,1,2], opaque: true}]}, before = stringify(original);
  assert.throws(() => applyPlannerItems(original, {equipment: {ring1: {...rageRing, ruined: 'unsupported'}}}, {idols: false, blessings: false}), error => {
    assert.equal(error.details.path, 'equipment.ring1'); assert.equal(error.details.itemId, rageRing.id);
    assert.ok(error.message.split(' / ').every(message => message.includes('equipment.ring1') && message.includes(rageRing.id)));
    return true;
  });
  assert.equal(stringify(original), before);
});

test('corrupted legendary encodes its corruption seal last with the native high-bit flag', () => {
  const record = {id: 'UAwRgrALA7CQ', affixes: [{id: affixId(26), tier: 6, r: 40}], corruptedAffix: {id: affixId(86), tier: 4, r: 90}, duplicated: true, tradeable: 0};
  const encoded = encodePlannerItem(record, {containerID: 2, individualId: 16});
  assert.equal(encoded.data[1], 128); assert.equal(encoded.data[8], 144); assert.equal(encoded.data[22], 130);
  assert.deepEqual(encoded.data.slice(23), [80,26,40,48,86,90]);
  const decoded = decodeSavedItem(encoded);
  assert.deepEqual(decoded.affixes.map(a=>a.affixId), [26,86]); assert.deepEqual(encodeItemData(decoded), encoded.data);
  assert.throws(()=>encodePlannerItem({...record, ww: 2}, {containerID: 2}), {code: 'INVALID_ITEM_FEATURE'});
  assert.throws(()=>encodePlannerItem({...record, tradeable: 'yes'}, {containerID: 2}), {code: 'INVALID_ITEM'});
});

test('primordial and ordinary seals retain separate ordered blocks and original tiers', () => {
  const record = {id: baseId(2,2), sealedAffix: {id: affixId(26),tier:3,r:11}, corruptedAffix: {id:affixId(32),tier:4,r:22},
    primordialAffix: {id:affixId(86),tier:8,r:33}, affixes:[{id:affixId(70),tier:5,r:44}], ruined: 1};
  const encoded=encodePlannerItem(record,{containerID:7,individualId:16});
  assert.equal(encoded.data[8],176); assert.equal(encoded.data[13],196);
  assert.deepEqual(encoded.data.slice(14),[32,26,11,48,32,22,112,86,33,64,70,44]);
  assert.deepEqual(encodeItemData(decodeSavedItem(encoded)),encoded.data);
  assert.throws(()=>encodePlannerItem({...record,primordialAffix:{id:affixId(86),tier:7}},{containerID:7}),{code:'INVALID_PRIMORDIAL_AFFIX'});
});

test('offline item application removes MG restrictions while preserving CoF and untouched inventory', () => {
  const inventory=encodePlannerItem({id:'UAwRgrALA7CQ',faction:[1,5]},{containerID:1,individualId:17});
  const original={savedItems:[inventory]};
  const build={equipment:{head:{id:'UAwRgrALA7CQ',faction:[1,5],tradeable:1},chest:{id:'UAzCMIDiA',faction:[0,4]}}};
  const result=applyPlannerItems(original,build,{idols:false,blessings:false});
  assert.equal(result.data.savedItems.find(item=>item.containerID===2).data[8],128);
  assert.equal(result.data.savedItems.find(item=>item.containerID===3).data[8],132);
  assert.equal(stringify(result.data.savedItems[0]),stringify(inventory));
  assert.ok(result.warnings.some(message=>message.includes('商人公会')));
  assert.deepEqual(original.savedItems,[inventory]);
});


test('full sync without a source altar uses the default grid while idol-only sync keeps altar validation', () => {
  const altar=encodePlannerItem({id:baseId(41,6)},{containerID:123,individualId:23});
  const original={savedItems:[altar,{containerID:1,data:[99,1,2],opaque:true}]};
  const before=stringify(original),idol={id:baseId(25,0),x:5,y:4};
  const build={equipment:{},idols:[idol]};
  const synced=applyPlannerItems(original,build,{blessings:false});
  assert.equal(synced.data.savedItems.some(item=>Number(item.containerID)===123),false);
  assert.equal(synced.data.savedItems.filter(item=>Number(item.containerID)===29).length,1);
  assert.ok(synced.warnings.some(message=>message.includes('默认神像布局')));
  assert.equal(stringify(synced.data.savedItems.find(item=>Number(item.containerID)===1)),stringify(original.savedItems[1]));
  assert.throws(()=>applyPlannerItems(original,build,{equipment:false,blessings:false}),{code:'BLOCKED_IDOL_CELL'});
  const equipmentOnly=applyPlannerItems(original,build,{idols:false,blessings:false});
  assert.equal(stringify(equipmentOnly.data.savedItems.find(item=>Number(item.containerID)===123)),stringify(altar));
  assert.equal(stringify(original),before);
});
