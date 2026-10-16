import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { applyCampaignSkip, campaignSummary, campaignData, isQuestCompleted } from '../web/src/core/campaign.js';
import { parseSave, serializeSave } from '../web/src/core/save.js';
import { createWorkflow } from '../web/src/core/workflow.js';
import { applyPlannerBuild } from '../web/src/core/planner.js';

const build = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
function quest(questID, questStepID, extra = {}) {
  return { questID, questStepID, state: 0, questBranch: 0, completeObjectives: [], failedObjectives: [], nolongerRelevantObjectives: [], objectiveProgress: [], trackStatus: 0, ...extra };
}
function freshData() {
  return {
    characterName: 'Synthetic', level: 1, characterClass: 2, chosenMastery: 0, originalMastery: 0, currentExp: 0,
    savedQuests: [quest(127, 721)], unlockedWaypointScenes: [], portalUnlocked: false, reachedTown: false,
    lastVisitedTownScene: null, focusedQuest: 127, savedMonolithQuests: [],
    savedCharacterTree: { treeID: '', version: 0, nodeIDs: [], nodePoints: [], unspentPoints: 0, nodesTaken: null },
    savedSkillTrees: [], abilityBar: ['', '', '', '', ''], savedItems: [],
    sceneProgresses: [], oneTimeEvents: ['EpochMasteryUnlock'], monolithRuns: [], factions: {},
    timelineDifficultyUnlocks: Array.from({ length: 10 }, (_, i) => ({ timelineID: i + 1, progress: [0] })),
    unknownCounter: '9007199254740993', cycle: 8, hardcore: false,
  };
}
function document(data = freshData()) {
  return parseSave('EPOCH' + JSON.stringify(data).replace('"9007199254740993"', '9007199254740993'), '1CHARACTERSLOT_BETA_9');
}
const write = data => serializeSave({ ...document(), data });

test('current native quest steps, caps and offline destinations form a consistent campaign catalog', () => {
  const quests = Object.entries(campaignData.quests).filter(([, rule]) => rule.campaign);
  assert.equal(quests.length, 76);
  assert.equal(campaignData.waypoints.length, 107);
  assert.equal(new Set(campaignData.waypoints).size, 107);
  assert.ok(campaignData.waypoints.includes('MonolithHub'));
  assert.ok(campaignData.waypoints.includes('Dun3Q10'));
  assert.ok(!campaignData.waypoints.includes('Bazaar'));
  assert.ok(!campaignData.waypoints.includes('B1S10')); // Obsolete map entry absent from SceneList.
  for (const [id, rule] of quests) {
    assert.deepEqual(campaignData.steps[rule.step], [Number(id), 2]);
    assert.equal(rule.objectives.length, new Set(rule.objectives).size);
  }
  assert.equal(campaignData.quests[151].campaign, true); // Current chapter 10.
  for (const id of [133, 134, 135, 158, 159, 160, 169]) assert.notEqual(campaignData.quests[id].campaign, true);
});

test('fresh character completes the campaign, gains capped rewards and enters the hub without copying endgame progress', () => {
  const doc = document(), original = serializeSave(doc), result = applyCampaignSkip(doc.data);
  assert.deepEqual(result.before, { completedQuests: 0, totalQuests: 76, waypoints: 0, totalWaypoints: 107, passiveRewards: 0, idolUnlocks: 0 });
  assert.equal(result.after.completedQuests, 76); assert.equal(result.after.waypoints, 107);
  assert.equal(result.after.passiveRewards, 15); assert.equal(result.after.idolUnlocks, 8);
  assert.equal(result.addedPassivePoints, 14); assert.equal(result.data.savedCharacterTree.unspentPoints, 14);
  assert.equal(result.data.lastVisitedTownScene, 'MonolithHub'); assert.equal(result.data.portalUnlocked, true);
  assert.equal(result.data.focusedQuest, -1); assert.equal(String(result.data.level), '1');
  for (const field of ['reachedTown', 'sceneProgresses', 'oneTimeEvents', 'monolithRuns', 'factions', 'savedMonolithQuests', 'timelineDifficultyUnlocks', 'savedItems', 'currentExp', 'unknownCounter']) assert.deepEqual(result.data[field], doc.data[field], field);
  assert.equal(serializeSave(doc), original);
  const roundtrip = parseSave(write(result.data), doc.name);
  assert.equal(String(roundtrip.data.unknownCounter), '9007199254740993');
  assert.equal(campaignSummary(roundtrip.data).completedQuests, 76);
  assert.equal(write(applyCampaignSkip(result.data).data), write(result.data));
});

test('native completed steps take precedence over the saved state field; completed records and non-campaign quests are preserved', () => {
  assert.equal(isQuestCompleted(quest(3, 12)), true);
  assert.equal(isQuestCompleted(quest(3, 10, { state: 2 })), false);
  assert.equal(isQuestCompleted(quest(127, 12, { state: 2 })), false);
  const data = freshData();
  data.savedQuests.push(quest(3, 12, { future: 'keep', failedObjectives: [9999], trackStatus: 3 }), quest(158, 853), quest(169, 899), quest(9999, -1, { future: 'unknown' }));
  data.savedCharacterTree.unspentPoints = 3; // One campaign point plus two earned through a dungeon.
  data.unlockedWaypointScenes = ['FutureWaypoint', 'EoT']; data.focusedQuest = 169;
  const original = document(data), result = applyCampaignSkip(original.data);
  assert.equal(result.addedPassivePoints, 11); assert.equal(result.data.savedCharacterTree.unspentPoints, 14);
  for (const id of [3, 158, 169, 9999]) assert.deepEqual(result.data.savedQuests.find(q => Number(q.questID) === id), original.data.savedQuests.find(q => Number(q.questID) === id));
  assert.deepEqual(result.data.unlockedWaypointScenes.slice(0, 2), original.data.unlockedWaypointScenes);
  assert.equal(String(result.data.focusedQuest), '169');
});

test('partial quest completion resolves conflicting objectives while keeping unknown fields and already-budgeted rewards', () => {
  const data = freshData(), objectives = campaignData.quests[127].objectives;
  data.savedQuests[0] = quest(127, 721, { completeObjectives: [99999], failedObjectives: [objectives[0]], nolongerRelevantObjectives: [objectives[1]], futureField: 'keep' });
  data.savedCharacterTree.unspentPoints = 15; // Already edited or granted through another mechanism.
  const result = applyCampaignSkip(document(data).data), first = result.data.savedQuests[0];
  assert.equal(first.futureField, 'keep'); assert.ok(first.completeObjectives.includes(99999));
  assert.deepEqual(first.failedObjectives, []); assert.deepEqual(first.nolongerRelevantObjectives, []);
  assert.equal(result.addedPassivePoints, 0); assert.equal(String(result.data.savedCharacterTree.unspentPoints), '15');
});

test('level changes follow the native clamp at levels 1 and 2 and never invent the first passive point', () => {
  const options = { equipment: false, idols: false, blessings: false, passives: true, skills: false, skillBar: false, level: true, weaverTree: false };
  const source = structuredClone(build);
  source.data.bio.characterClass = 2; source.data.bio.chosenMastery = 0;
  source.data.charTree.selected = {};
  for (const [level, expected] of [[1, 0], [2, 0], [3, 1], [100, 98]]) {
    source.data.bio.level = level;
    const result = applyPlannerBuild(document().data, source, options);
    assert.equal(Number(result.data.savedCharacterTree.unspentPoints), expected);
  }
  const skipped = applyCampaignSkip(document().data).data;
  source.data.bio.level = 100;
  const full = applyPlannerBuild(skipped, source, options).data;
  assert.equal(Number(full.savedCharacterTree.unspentPoints), 113);
  source.data.bio.level = 1;
  const lowered = applyPlannerBuild(full, source, options).data;
  assert.equal(Number(lowered.savedCharacterTree.unspentPoints), 14);
});

test('unverified or malformed known quest data is rejected atomically with bilingual errors', () => {
  for (const mutate of [
    data => { data.savedQuests[0].questStepID = 999999; },
    data => { data.savedQuests[0].questStepID = 12; },
    data => { data.savedQuests.push(data.savedQuests[0]); },
    data => { delete data.portalUnlocked; },
    data => { data.savedQuests[0].completeObjectives = null; },
    data => { data.savedCharacterTree.nodePoints = [-1]; },
  ]) {
    const data = freshData(); mutate(data); const doc = document(data), original = serializeSave(doc);
    assert.throws(() => applyCampaignSkip(doc.data), error => error.code === 'CAMPAIGN_SAVE_FORMAT' && error.messageEn.includes('current format'));
    assert.equal(serializeSave(doc), original);
  }
});

test('workflow opts in before passive-budget validation, preserves originals and resets when the option is disabled', async () => {
  const doc = document(), original = serializeSave(doc), flow = createWorkflow({ fetchBuild: async () => build });
  await flow.importBuild('AAAAAAAA'); await flow.addFiles([{ name: doc.name, size: original.length, text: async () => original }]);
  assert.equal(flow.state.options.campaignSkip, false);
  assert.equal(flow.synchronize(), false); assert.equal(flow.state.error.code, 'INSUFFICIENT_PASSIVE_POINTS');
  flow.setOption('campaignSkip', true);
  assert.equal(flow.synchronize(), true, flow.state.error?.message);
  assert.equal(flow.prepareReview(), true); flow.state.acknowledged = true;
  const download = flow.downloads()[0], result = parseSave(download.text, download.name);
  assert.equal(campaignSummary(result.data).completedQuests, 76);
  assert.equal(result.data.savedCharacterTree.nodePoints.reduce((sum, points) => sum + Number(points), 0) + Number(result.data.savedCharacterTree.unspentPoints), 113);
  assert.equal(serializeSave(flow.state.files.get(doc.name).original), original);
  flow.goBack(2); assert.equal(flow.synchronize(), true); assert.equal(flow.prepareReview(), true); flow.state.acknowledged = true;
  const repeated = parseSave(flow.downloads()[0].text, download.name);
  // Newly generated equipment receives fresh item identities on each sync.
  for (const key of Object.keys(result.data)) if (key !== 'savedItems') assert.deepEqual(repeated.data[key], result.data[key], key);
  flow.goBack(1); flow.setOption('campaignSkip', false);
  assert.equal(flow.state.result.length, 0); assert.equal(flow.state.synced.length, 0);
  assert.equal(flow.synchronize(), false); assert.equal(flow.state.error.code, 'INSUFFICIENT_PASSIVE_POINTS');
});

const localRoot = process.env.LE_CAMPAIGN_TEST_DIR;
test('optional private fresh and graduated backups remain lossless and retain all unrelated progression', { skip: !localRoot || !existsSync(localRoot) }, () => {
  for (const slot of [6, 5]) {
    const name = `1CHARACTERSLOT_BETA_${slot}`, text = readFileSync(`${localRoot}/${name}`, 'utf8'), doc = parseSave(text, name);
    const original = serializeSave(doc), result = applyCampaignSkip(doc.data);
    assert.equal(result.addedPassivePoints, slot === 6 ? 14 : 0);
    assert.equal(result.after.completedQuests, 76); assert.equal(result.after.waypoints, 107);
    const allowed = new Set(['savedQuests', 'savedCharacterTree', 'unlockedWaypointScenes', 'portalUnlocked', 'lastVisitedTownScene', 'focusedQuest']);
    for (const key of Object.keys(doc.data)) if (!allowed.has(key)) assert.deepEqual(result.data[key], doc.data[key], key);
    const output = serializeSave({ ...doc, data: result.data });
    assert.equal(serializeSave({ ...doc, data: applyCampaignSkip(result.data).data }), output);
    assert.equal(serializeSave(parseSave(output, name)), output);
    assert.equal(serializeSave(doc), original); assert.equal(readFileSync(`${localRoot}/${name}`, 'utf8'), text);
  }
});
