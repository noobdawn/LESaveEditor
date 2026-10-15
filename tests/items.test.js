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
  assert.throws(() => encodePlannerItem({ id: 'UAwRgrALA7CQ', corrupted: true }, { containerID: 2 }), { code: 'UNSUPPORTED_ITEM_FEATURE' });
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

test('unique variant pool/count and unsupported seals remain strict and report the offending slot atomically', () => {
  assert.throws(() => encodePlannerItem({ id: rageRing.id }, {containerID: 10}), {code: 'INVALID_UNIQUE_VARIANT'});
  assert.throws(() => encodePlannerItem({ ...rageRing, sealedAffix: {id: affixId(26), tier: 3} }, {containerID: 10}), {code: 'UNSUPPORTED_ITEM_FEATURE'});
  assert.throws(() => encodePlannerItem({ ...rageRing, affixes: [...rageRing.affixes, {id: affixId(1140), tier: 1}] }, {containerID: 10}), {code: 'INVALID_UNIQUE_VARIANT'});
  const original = {savedItems: [{containerID: 1, data: [99,1,2], opaque: true}]}, before = stringify(original);
  assert.throws(() => applyPlannerItems(original, {equipment: {ring1: {...rageRing, ruined: true}}}, {idols: false, blessings: false}), error => {
    assert.equal(error.details.path, 'equipment.ring1'); assert.equal(error.details.itemId, rageRing.id);
    assert.ok(error.message.split(' / ').every(message => message.includes('equipment.ring1') && message.includes(rageRing.id)));
    return true;
  });
  assert.equal(stringify(original), before);
});
