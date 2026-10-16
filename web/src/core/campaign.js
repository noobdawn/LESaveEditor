import catalog from '../data/campaign-data.json' with { type: 'json' };
import { cloneSaveData } from './save.js';
import { WorldError } from './world.js';

export { catalog as campaignData };
const own = (object, key) => object != null && Object.hasOwn(object, key);
const campaignIDs = new Set(Object.keys(catalog.quests).filter(id => catalog.quests[id].campaign));
const number = value => Number(String(value));
const integer = (value, min = 0, max = 2147483647) => (min < 0 && String(value) === '-1' || /^(?:0|[1-9]\d*)$/.test(String(value))) && Number.isSafeInteger(number(value)) && number(value) >= min && number(value) <= max;
const fail = () => { throw new WorldError('CAMPAIGN_SAVE_FORMAT', '此存档的任务或天赋字段不符合当前版本，无法安全执行“速通至异界”。', 'This save’s quest or passive fields do not match the current format; campaign skip cannot be applied safely.'); };

/** The native loader resolves replacement steps and ignores SavedQuest.state. */
export function isQuestCompleted(quest) {
  const step = catalog.steps[String(quest?.questStepID)];
  return step?.[0] === number(quest?.questID) && step[1] === 2;
}

export function campaignSummary(data) {
  let passiveRewards = 0, idolUnlocks = 0;
  const completed = new Set();
  for (const quest of Array.isArray(data.savedQuests) ? data.savedQuests : []) {
    const id = String(quest?.questID), rule = catalog.quests[id];
    if (!rule || rule.type !== 0 || completed.has(id) || !isQuestCompleted(quest)) continue;
    completed.add(id); passiveRewards += rule.passivePoints; idolUnlocks += rule.idolUnlocks;
  }
  return {
    completedQuests: [...completed].filter(id => campaignIDs.has(id)).length,
    totalQuests: campaignIDs.size,
    waypoints: new Set((Array.isArray(data.unlockedWaypointScenes) ? data.unlockedWaypointScenes : []).filter(scene => catalog.waypoints.includes(scene))).size,
    totalWaypoints: catalog.waypoints.length,
    passiveRewards: Math.min(catalog.maximumPassiveRewards, passiveRewards),
    idolUnlocks: Math.min(catalog.maximumIdolUnlocks, idolUnlocks),
  };
}

/** LocalTreeData.calculatePassivePointsEarnt: clamp(level - 2 + quest rewards). */
export function earnedPassivePoints(level, questRewards) {
  return Math.max(0, number(level) - catalog.passiveLevelOffset + questRewards);
}

function validate(data) {
  if (!Array.isArray(data?.savedQuests) || !Array.isArray(data.unlockedWaypointScenes)
      || data.unlockedWaypointScenes.some(scene => typeof scene !== 'string')
      || typeof data.portalUnlocked !== 'boolean' || !own(data, 'lastVisitedTownScene')
      || (data.lastVisitedTownScene !== null && typeof data.lastVisitedTownScene !== 'string')
      || !integer(data.level, 1, 100)) fail();
  const tree = data.savedCharacterTree;
  if (!tree || !Array.isArray(tree.nodeIDs) || !Array.isArray(tree.nodePoints)
      || tree.nodeIDs.length !== tree.nodePoints.length || tree.nodePoints.some(point => !integer(point, 0, 255))
      || !integer(tree.unspentPoints, 0, 255)) fail();
  const ids = new Set();
  for (const quest of data.savedQuests) {
    if (!quest || !integer(quest.questID) || ids.has(String(quest.questID)) || !integer(quest.questStepID, -1)
        || !['completeObjectives', 'failedObjectives', 'nolongerRelevantObjectives', 'objectiveProgress'].every(key => Array.isArray(quest[key]))) fail();
    ids.add(String(quest.questID));
    const step = catalog.steps[String(quest.questStepID)];
    // Refuse unknown steps on known quests rather than awarding their rewards twice.
    if (catalog.quests[String(quest.questID)] && (!step || step[0] !== number(quest.questID))) fail();
    if (quest.objectiveProgress.some(progress => !progress || !integer(progress.objectiveID) || !integer(progress.progress))) fail();
    for (const key of ['completeObjectives', 'failedObjectives', 'nolongerRelevantObjectives']) {
      if (quest[key].some(id => !integer(id))) fail();
    }
  }
}

/** An opt-in, idempotent patch. It never uses another character's saved progress. */
export function applyCampaignSkip(saveData) {
  validate(saveData);
  const data = cloneSaveData(saveData), before = campaignSummary(data);
  const existing = new Map(data.savedQuests.map(quest => [String(quest.questID), quest]));
  for (const id of campaignIDs) {
    const old = existing.get(id), rule = catalog.quests[id];
    if (old && isQuestCompleted(old)) continue;
    const objectiveIDs = new Set(rule.objectives);
    const quest = {
      ...(old ?? {}), questID: Number(id), questStepID: rule.step,
      // This fallback field is zero in native saves, including completed quests.
      state: 0, questBranch: rule.branch,
      completeObjectives: [...new Set([...(old?.completeObjectives ?? []).map(number), ...rule.objectives])],
      failedObjectives: (old?.failedObjectives ?? []).filter(id => !objectiveIDs.has(number(id))),
      nolongerRelevantObjectives: (old?.nolongerRelevantObjectives ?? []).filter(id => !objectiveIDs.has(number(id))),
      objectiveProgress: (old?.objectiveProgress ?? []).filter(progress => !objectiveIDs.has(number(progress.objectiveID))), trackStatus: old?.trackStatus ?? 0,
    };
    if (old) data.savedQuests[data.savedQuests.indexOf(old)] = quest;
    else data.savedQuests.push(quest);
  }
  data.unlockedWaypointScenes = [...data.unlockedWaypointScenes, ...catalog.waypoints.filter(scene => !data.unlockedWaypointScenes.includes(scene))];
  data.portalUnlocked = true;
  data.lastVisitedTownScene = catalog.spawnScene;
  if (campaignIDs.has(String(data.focusedQuest))) data.focusedQuest = -1;
  const after = campaignSummary(data), tree = data.savedCharacterTree;
  const budget = tree.nodePoints.reduce((sum, points) => sum + number(points), 0) + number(tree.unspentPoints);
  // Grant only newly earned quest rewards, never duplicate rewards already
  // present in the saved point budget or change an existing over-cap allocation.
  const addedPassivePoints = Math.max(0, Math.min(after.passiveRewards - before.passiveRewards,
    earnedPassivePoints(data.level, after.passiveRewards) - budget));
  if (addedPassivePoints) tree.unspentPoints = number(tree.unspentPoints) + addedPassivePoints;
  return { data, before, after, addedPassivePoints };
}
