import catalog from '../data/campaign-data.json' with { type: 'json' };
import { cloneSaveData } from './save.js';
import { displayValue, englishFieldPath } from './diagnostic-context.js';
import { WorldError } from './world.js';

export { catalog as campaignData };
const own = (object, key) => object != null && Object.hasOwn(object, key);
const campaignIDs = new Set(Object.keys(catalog.quests).filter(id => catalog.quests[id].campaign));
const number = value => Number(String(value));
const integer = (value, min = 0, max = 2147483647) => (min < 0 && String(value) === '-1' || /^(?:0|[1-9]\d*)$/.test(String(value))) && Number.isSafeInteger(number(value)) && number(value) >= min && number(value) <= max;
const fail = (path, value, expected) => { throw new WorldError('CAMPAIGN_SAVE_FORMAT', '无法执行“速通至异界”：' + path + '需要' + expected.zh + '，当前为 ' + displayValue(value) + '。请重新上传游戏正常保存的角色存档；若仍失败，请附此错误信息反馈。', 'Campaign skip cannot use ' + englishFieldPath(path) + ' in the current format: expected ' + expected.en + ', got ' + displayValue(value, 'en') + '. Upload a character save written by the game; if it still fails, report this error.'); };

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
  const check = (valid, path, value, zh, en) => { if (!valid) fail(path, value, { zh, en }); };
  check(Array.isArray(data?.savedQuests), 'savedQuests（任务列表）', data?.savedQuests, '任务记录数组', 'a quest-record array');
  check(Array.isArray(data.unlockedWaypointScenes), 'unlockedWaypointScenes（传送点）', data.unlockedWaypointScenes, '场景名称数组', 'an array of scene names');
  check(!data.unlockedWaypointScenes.some(scene => typeof scene !== 'string'), 'unlockedWaypointScenes', data.unlockedWaypointScenes, '每项均为场景名称字符串', 'scene-name strings');
  check(typeof data.portalUnlocked === 'boolean', 'portalUnlocked（回城传送门）', data.portalUnlocked, '布尔开关', 'a boolean');
  check(own(data, 'lastVisitedTownScene') && (data.lastVisitedTownScene === null || typeof data.lastVisitedTownScene === 'string'), 'lastVisitedTownScene（登录场景）', data.lastVisitedTownScene, '场景名称或 null', 'a scene name or null');
  check(integer(data.level, 1, 100), 'level（角色等级）', data.level, '1–100 的整数', 'an integer from 1 to 100');
  const tree = data.savedCharacterTree;
  check(tree && Array.isArray(tree.nodeIDs) && Array.isArray(tree.nodePoints), 'savedCharacterTree（被动树）', tree, 'nodeIDs 与 nodePoints 两个数组', 'nodeIDs and nodePoints arrays');
  check(tree.nodeIDs.length === tree.nodePoints.length, 'savedCharacterTree.nodePoints', tree.nodePoints, '与节点编号数量 ' + tree.nodeIDs.length + ' 一致', 'the same entry count as nodeIDs (' + tree.nodeIDs.length + ')');
  check(!tree.nodePoints.some(point => !integer(point, 0, 255)), 'savedCharacterTree.nodePoints', tree.nodePoints, '每项均为 0–255 的整数', 'integers from 0 to 255');
  check(integer(tree.unspentPoints, 0, 255), 'savedCharacterTree.unspentPoints（未分配被动点）', tree.unspentPoints, '0–255 的整数', 'an integer from 0 to 255');
  const ids = new Set();
  for (const [index, quest] of data.savedQuests.entries()) {
    const path = 'savedQuests[' + index + ']';
    check(quest && integer(quest.questID) && !ids.has(String(quest.questID)), path + '.questID', quest?.questID, '不重复的非负任务编号', 'a unique non-negative quest ID');
    check(integer(quest.questStepID, -1), path + '.questStepID', quest.questStepID, '有效步骤整数（最低 -1）', 'an integer step ID of at least -1');
    for (const key of ['completeObjectives', 'failedObjectives', 'nolongerRelevantObjectives', 'objectiveProgress']) check(Array.isArray(quest[key]), path + '.' + key, quest[key], '数组', 'an array');
    ids.add(String(quest.questID));
    const step = catalog.steps[String(quest.questStepID)];
    check(!catalog.quests[String(quest.questID)] || (step && step[0] === number(quest.questID)), path + '.questStepID（任务 ' + quest.questID + '）', quest.questStepID, '属于该任务的当前版本步骤', 'a current-game step belonging to quest ' + quest.questID);
    check(!quest.objectiveProgress.some(progress => !progress || !integer(progress.objectiveID) || !integer(progress.progress)), path + '.objectiveProgress', quest.objectiveProgress, '有效目标编号及非负进度', 'valid objective IDs and non-negative progress');
    for (const key of ['completeObjectives', 'failedObjectives', 'nolongerRelevantObjectives']) check(!quest[key].some(id => !integer(id)), path + '.' + key, quest[key], '非负目标编号', 'non-negative objective IDs');
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
