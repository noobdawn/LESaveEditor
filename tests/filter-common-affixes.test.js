import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../web/src/data/filter-catalog.json' with { type: 'json' };
import common from '../web/src/data/filter-common-affixes.json' with { type: 'json' };

// Manually reviewed against the installed 1.5.2.1 catalog. This is an editable
// starter collection, not a claim that every listed stat benefits every build.
// Class availability and item-type restrictions remain in the source catalog.
// Unconditional player stats are included; damage, minion/skill effects, special
// crafting, triggered recovery and defensive conversions are not inferred.
const groups = new Map(common.groups.map(group => [group.id, group]));
const ids = common.groups.flatMap(group => group.affixIds);
const selected = new Set(ids);

test('the reviewed common collection resolves only ordinary equipment affixes in the current catalog', () => {
  assert.equal(common.version, 1);
  assert.equal(catalog.source.gameVersion, '1.5.2.1', 'review this hand-curated collection when upgrading game data');
  assert.equal(groups.size, common.groups.length, 'category IDs must be unique');
  assert.equal(selected.size, ids.length, 'an affix must not be counted twice through different categories');
  for (const group of common.groups) {
    assert.ok(group.affixIds.length);
    assert.ok(group.name.zh && group.name.en, `${group.id} needs both UI labels`);
    for (const id of group.affixIds) {
      assert.ok(Number.isSafeInteger(id));
      const affix = catalog.affixes[id];
      assert.ok(affix, `unknown reviewed affix ${id}`);
      assert.ok(affix.name.zh && affix.name.en, `affix ${id} must use catalog translations`);
      assert.equal(affix.standard, true, `affix ${id} is not a normal drop affix`);
      assert.equal(affix.specialAffixType, 0, `affix ${id} needs a special acquisition route`);
      assert.equal(affix.rollsOn, 0, `affix ${id} is an idol affix`);
      assert.equal(affix.hasShard, true, `affix ${id} is not a normal shard affix`);
      assert.ok(affix.canRollOn.length > 0);
      assert.ok(affix.canRollOn.every(type => type >= 0 && type <= 24), `affix ${id} includes an idol, altar or non-equipment type`);
    }
  }
});

test('the default categories cover basic life, mitigation, all attributes and all seven resistances', () => {
  const includes = (groupId, required) => {
    const actual = groups.get(groupId)?.affixIds;
    assert.ok(actual, `missing category ${groupId}`);
    for (const id of required) assert.ok(actual.includes(id), `${groupId} omitted ${catalog.affixes[id].name.en}`);
  };
  includes('health', [22, 25, 29, 36, 52, 90, 825]);
  includes('endurance', [92, 425]);
  includes('ward', [382, 824]);
  includes('attributes', [50, 501, 502, 503, 504, 505]);
  includes('resistances', [7, 10, 13, 17, 19, 24, 45, 46, 80]);
  includes('armour', [1, 31, 715]);
  includes('defense', [3, 8, 51, 59, 81, 97, 426, 427, 717]);
  includes('utility', [27, 28, 34, 330, 331, 718, 1156]);
});

test('similar names cannot accidentally promote minion, triggered, converted, idol or skill-only stats', () => {
  const excluded = [
    14, // Freeze rate plus cold resistance: includes a damage-specific component.
    20, 41, 44, 66, 74, 75, 99, // Kill, block, melee-hit or potion-triggered recovery/mitigation.
    53, 83, 400, 759, // Mana-before-health and ward conversions require build decisions.
    70, 71, 73, 332, // Minion-only and shared minion survival are not generic player stats.
    104, 335, 397, 414, 415, 437, 440, 442, 656, 687, 760, // Conditional or skill-specific effects.
    142, 285, // Ward retention is an idol stat in this catalog, not ordinary equipment.
    539, 572, 628, // Skill levels may be high value when explicitly selected by a build.
    679, 1093, // Experimental/altar-only examples must not enter the ordinary collection.
  ];
  for (const id of excluded) {
    assert.ok(catalog.affixes[id], `exclusion fixture ${id} needs review after catalog changes`);
    assert.equal(selected.has(id), false, `${catalog.affixes[id].name.en} should require an explicit user/build choice`);
  }
  for (const id of ids) {
    assert.doesNotMatch(catalog.affixes[id].name.en, /minion|totem|while|when|on (?:hit|kill|potion)|converted|level of/i);
  }
});
