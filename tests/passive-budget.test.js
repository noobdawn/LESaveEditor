import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyPlannerBuild } from '../web/src/core/planner.js';
import { campaignData } from '../web/src/core/campaign.js';
import { parseSave, serializeSave } from '../web/src/core/save.js';
import { createWorkflow } from '../web/src/core/workflow.js';

const build = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
const options = { equipment: false, idols: false, blessings: false, skills: false, skillBar: false, level: true };
const total = data => data.savedCharacterTree.nodePoints.reduce((sum, point) => sum + Number(point), 0) + Number(data.savedCharacterTree.unspentPoints);
function document(level, budget = 0, rewards = 'all') {
  const quests = Object.entries(campaignData.quests).filter(([id, rule]) => rewards === 'all' ? rule.campaign : rewards.includes(Number(id)));
  return parseSave('EPOCH' + JSON.stringify({
    characterName: 'Synthetic', characterClass: 3, chosenMastery: 1, originalMastery: 1, level, currentExp: 0,
    savedCharacterTree: { treeID: '', version: 4, nodeIDs: budget >= 8 ? [1] : [], nodePoints: budget >= 8 ? [8] : [], unspentPoints: budget >= 8 ? budget - 8 : budget, nodesTaken: null },
    savedSkillTrees: [], savedItems: [], abilityBar: ['', '', '', '', ''], characterTreeNodeProgression: [],
    savedQuests: quests.map(([id, rule]) => ({ questID: Number(id), questStepID: rule.step, state: 0, questBranch: rule.branch, completeObjectives: [...rule.objectives], failedObjectives: [], nolongerRelevantObjectives: [], objectiveProgress: [], trackStatus: 0 })),
    unlockedWaypointScenes: [], portalUnlocked: false, lastVisitedTownScene: null, focusedQuest: -1, cycle: 8, hardcore: false, factions: {},
    unrelated: { counter: '18446744073709551615' },
  }).replace('"18446744073709551615"', '18446744073709551615'), '1CHARACTERSLOT_BETA_9');
}

test('completed quest rewards repair empty and short passive budgets before allocation, without reducing excess points or accumulating on retry', () => {
  for (const [level, budget, expected] of [[1, 0, 113], [1, 14, 113], [50, 0, 113], [100, 0, 113], [100, 99, 113], [100, 112, 113], [100, 113, 113], [100, 120, 120]]) {
    const doc = document(level, budget), before = serializeSave(doc);
    const result = applyPlannerBuild(doc.data, build, options).data;
    assert.equal(total(result), expected, JSON.stringify({ level, budget }));
    assert.equal(result.savedCharacterTree.nodePoints.reduce((sum, point) => sum + Number(point), 0), 112);
    assert.equal(Number(result.savedCharacterTree.unspentPoints), expected - 112);
    assert.deepEqual(result.savedQuests, doc.data.savedQuests);
    assert.deepEqual(result.unrelated, doc.data.unrelated);
    assert.equal(serializeSave(doc), before);
    const roundtrip = parseSave(serializeSave({ ...doc, data: result }), doc.name);
    assert.equal(total(roundtrip.data), expected);
    assert.deepEqual(applyPlannerBuild(roundtrip.data, build, options).data.savedCharacterTree, result.savedCharacterTree);
  }
});

test('repair counts only completed quest rewards and respects the native level-one and level-two clamp', () => {
  const source = structuredClone(build);
  source.data.charTree.selected = {};
  for (const [target, rewards, expected] of [[1, [], 0], [2, [], 0], [3, [], 1], [100, [], 98], [100, [128, 9], 101], [1, 'all', 14], [2, 'all', 15]]) {
    const doc = document(target, 0, rewards), before = serializeSave(doc);
    source.data.bio.level = target;
    const result = applyPlannerBuild(doc.data, source, options).data;
    assert.equal(total(result), expected, JSON.stringify({ target, rewards }));
    assert.deepEqual(result.savedQuests, doc.data.savedQuests);
    assert.equal(serializeSave(doc), before);
  }
  const incomplete = document(100, 0, [128]);
  incomplete.data.savedQuests[0].questStepID = Object.entries(campaignData.steps).find(([, step]) => step[0] === 128 && step[1] !== 2)[0];
  source.data.bio.level = 100;
  assert.equal(total(applyPlannerBuild(incomplete.data, source, options).data), 98);
});

test('repair precedes downgrades and still rejects retaining allocations above the lower-level budget', () => {
  const source = structuredClone(build);
  source.data.charTree.selected = {};
  for (const [budget, target, expected] of [[0, 1, 14], [99, 2, 15], [99, 50, 63], [120, 1, 21], [120, 50, 70]]) {
    source.data.bio.level = target;
    assert.equal(total(applyPlannerBuild(document(100, budget).data, source, options).data), expected);
  }
  const doc = document(100, 8, []), before = serializeSave(doc);
  source.data.bio.level = 1;
  assert.throws(() => applyPlannerBuild(doc.data, source, { ...options, passives: false }), { code: 'LEVEL_BELOW_PASSIVES' });
  assert.equal(serializeSave(doc), before);
});

test('level-only synchronization repairs the budget while preserving the existing passive allocation', () => {
  for (const [level, budget, target, expected] of [[1, 0, 100, 113], [50, 8, 100, 113], [100, 99, 50, 63], [100, 120, 50, 70]]) {
    const doc = document(level, budget), before = serializeSave(doc), source = structuredClone(build);
    source.data.bio.level = target;
    const result = applyPlannerBuild(doc.data, source, { ...options, passives: false }).data;
    assert.equal(total(result), expected);
    assert.deepEqual(result.savedCharacterTree.nodeIDs, doc.data.savedCharacterTree.nodeIDs);
    assert.deepEqual(result.savedCharacterTree.nodePoints, doc.data.savedCharacterTree.nodePoints);
    assert.deepEqual(result.savedQuests, doc.data.savedQuests);
    assert.equal(serializeSave(doc), before);
  }
  const doc = document(100, 0);
  const untouched = applyPlannerBuild(doc.data, build, { ...options, passives: false, level: false }).data;
  assert.deepEqual(untouched.savedCharacterTree, doc.data.savedCharacterTree);
});

test('the full workflow repairs pre-completed saves with or without campaign skip and exports 113 points on repeated synchronization', async () => {
  for (const level of [1, 100]) for (const skip of [false, true]) {
    const doc = document(level), text = serializeSave(doc), flow = createWorkflow({ fetchBuild: async () => build });
    assert.equal(await flow.importBuild('om6w3Ypq'), true);
    assert.equal(await flow.addFiles([{ name: doc.name, size: text.length, text: async () => text }]), true);
    flow.setOption('campaignSkip', skip);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal(flow.synchronize(), true, flow.state.error?.message);
      assert.equal(flow.prepareReview(), true, flow.state.error?.message);
      flow.state.acknowledged = true;
      const output = flow.downloads().find(file => file.name === doc.name);
      const exported = parseSave(output.text, output.name);
      assert.equal(total(exported.data), 113);
      assert.equal(exported.data.savedCharacterTree.nodePoints.reduce((sum, point) => sum + Number(point), 0), 112);
      assert.equal(Number(exported.data.savedCharacterTree.unspentPoints), 1);
      assert.deepEqual(exported.data.unrelated, doc.data.unrelated);
      assert.equal(serializeSave(flow.state.files.get(doc.name).original), text);
      flow.goBack(2);
    }
  }
});
