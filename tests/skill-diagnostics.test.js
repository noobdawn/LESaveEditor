import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyPlannerBuild } from '../web/src/core/planner.js';
import { parseSave, serializeSave } from '../web/src/core/save.js';
import gameData from '../web/src/data/planner-game-data.js';

// Public build snapshots only; no private character data.
const fixture = id => JSON.parse(readFileSync(new URL('./fixtures/planner-' + id + '.json', import.meta.url), 'utf8'));
function character() {
  return parseSave('EPOCH' + JSON.stringify({
    characterName: 'Synthetic', level: 100, characterClass: 1, chosenMastery: 1, originalMastery: 1,
    savedItems: [], savedCharacterTree: { treeID: '', version: 7, nodeIDs: [], nodePoints: [], unspentPoints: 113 },
    savedSkillTrees: [], abilityBar: ['', '', '', '', ''], savedQuests: [],
    cycle: 8, hardcore: false, untouched: { counter: '18446744073709551615' },
  }).replace('"18446744073709551615"', '18446744073709551615'), '1CHARACTERSLOT_BETA_9');
}
function failure(source, code) {
  const doc = character(), before = serializeSave(doc), buildBefore = JSON.stringify(source);
  let caught;
  assert.throws(() => applyPlannerBuild(doc.data, source, { class: true, level: true }), error => {
    caught = error; return error.code === code;
  });
  assert.equal(serializeSave(doc), before);
  assert.equal(JSON.stringify(source), buildBefore);
  return caught;
}

test('locked action-bar diagnostics name the skill, exact slot, mastery, required points and current allocation', () => {
  const error = failure(fixture('QWXr0dxZ'), 'LOCKED_SKILL');
  assert.match(error.message, /技能栏第 4 格「Frost Wall」/);
  assert.match(error.message, /符文大师.*需要 15 点，当前 13 点.*缺少 2 点/);
  assert.match(error.message, /模拟器.*保存链接重试/);
  assert.match(error.messageEn, /Action bar slot 4 "Frost Wall"/);
  assert.match(error.messageEn, /15 points in Runemaster; currently 13 \(2 points short\)/);
  assert.deepEqual(error.details.requirements[0], { kind: 'passive', mastery: 3, required: 15, actual: 13, missing: 2, needsMastery: false, chosenMastery: 1 });
});

test('all three over-allocated skills are reported together with actual slot numbers and exact excess points', () => {
  const error = failure(fixture('B4XP4b8d'), 'INVALID_SKILL_POINTS');
  assert.deepEqual(error.details.issues.map(issue => [issue.treeID, issue.slotNumber, issue.level, issue.spent, issue.excess]), [
    ['me27', 1, 24, 25, 1], ['fw3d', 2, 26, 27, 1], ['bh2', 3, 33, 35, 2],
  ]);
  for (const [name, slot, level, spent, excess] of [['Meteor', 2, 24, 25, 1], ['Flame Ward', 3, 26, 27, 1], ['Black Hole', 4, 33, 35, 2]]) {
    assert.ok(error.message.includes('技能专精第 ' + slot + ' 槽「' + name + '」'));
    assert.ok(error.message.includes('等级 ' + level + ' 级，已分配 ' + spent + ' 点，超出 ' + excess + ' 点'));
    assert.ok(error.messageEn.includes('Specialization slot ' + slot + ' "' + name + '"'));
    assert.ok(error.messageEn.includes('level ' + level + ' but allocates ' + spent + ' points'));
  }
  assert.equal(error.message.split('\n').length, 3);
  assert.equal(error.messageEn.split('\n').length, 3);
  assert.match(error.message, /回收 2 点.*装备与天赋/);
});

test('level, chosen-mastery and cross-class failures explain the actual failed condition', () => {
  const low = fixture('QWXr0dxZ');
  low.data.bio.level = 1; low.data.charTree.selected = {}; low.data.skillTrees = [];
  low.data.hud = ['fw3d', '', '', '', ''];
  const levelError = failure(low, 'LOCKED_SKILL');
  assert.match(levelError.message, /Flame Ward.*需要 7 级，当前 1 级（差 6 级）/);
  assert.match(levelError.messageEn, /current level is 1 \(6 levels short\)/);

  const wrongMastery = fixture('QWXr0dxZ');
  wrongMastery.data.bio.chosenMastery = 2;
  wrongMastery.data.charTree.selected = {};
  wrongMastery.data.skillTrees = [{ ...wrongMastery.data.skillTrees[1], selected: {}, level: 1 }];
  wrongMastery.data.hud = ['', '', '', '', ''];
  const masteryError = failure(wrongMastery, 'LOCKED_SKILL');
  assert.match(masteryError.message, /技能专精第 2 槽「Meteor」.*巫师.*魔剑士/);
  assert.match(masteryError.messageEn, /Sorcerer mastery; current mastery is Spellblade/);

  const high = fixture('QWXr0dxZ');
  high.data.hud[3] = 'f1b4d';
  const highError = failure(high, 'LOCKED_SKILL');
  assert.equal(highError.details.requirements[0].actual, 30);
  assert.equal(highError.details.requirements[0].needsMastery, true);
  assert.match(highError.message, /魔剑士.*需要 30 点，当前 30 点.*还需要选择该专精.*巫师/);
  assert.doesNotMatch(highError.message, /缺少 0/);

  const wrongClass = fixture('QWXr0dxZ');
  wrongClass.data.bio.characterClass = 2;
  wrongClass.data.charTree = { selected: {}, version: gameData.passives[2].version };
  wrongClass.data.skillTrees = [{ treeID: 'fi9', slotNumber: 0, level: 1, version: gameData.skills.fi9.version, selected: {} }];
  wrongClass.data.hud = ['', '', '', '', ''];
  const classError = failure(wrongClass, 'SKILL_CLASS_MISMATCH');
  assert.match(classError.message, /技能专精第 1 槽「Fireball」.*哨卫/);
  assert.match(classError.messageEn, /Fireball.*current class, Sentinel/);
});

test('a corrected action bar imports without changing allocation, and valid live-profile bonus points remain supported', () => {
  const corrected = fixture('QWXr0dxZ'); corrected.data.hud[3] = 'fw3d';
  const first = applyPlannerBuild(character().data, corrected, { class: true, level: true }).data;
  assert.deepEqual(first.abilityBar, corrected.data.hud);
  assert.equal(first.savedSkillTrees.length, 5);
  assert.equal(first.savedCharacterTree.nodePoints.reduce((sum, n) => sum + Number(n), 0) + Number(first.savedCharacterTree.unspentPoints), 113);
  const live = fixture('B4XP4b8d'); live.data.fromSaveFile = 2;
  const second = applyPlannerBuild(character().data, live, { class: true, level: true }).data;
  assert.deepEqual(second.savedSkillTrees.map(tree => tree.nodePoints.reduce((sum, n) => sum + Number(n), 0)), [22, 25, 27, 35, 20]);
});
