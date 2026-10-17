import catalog from '../data/endgame-data.json' with { type: 'json' };
import { cloneSaveData } from './save.js';
import { worldData, validateCompanion, WorldError } from './world.js';
import { campaignData, isQuestCompleted } from './campaign.js';

export const ENDGAME_RESOURCES = catalog.resources;
const timelineIds = Object.keys(worldData.timelines).map(Number);
const n = value => Number(String(value));
const object = value => value != null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, max = 2147483647) => value != null && typeof value !== 'boolean' && /^(0|[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(n(value)) && n(value) <= max;
const fail = () => { throw new WorldError('ENDGAME_SAVE_FORMAT', '终局进度或资源字段与当前版本不符，未应用任何修改。', 'Endgame progress or resource fields do not match the current format; no changes were applied.'); };
function list(parent, key) {
  if (parent[key] == null) parent[key] = [];
  if (!Array.isArray(parent[key])) fail();
  return parent[key];
}
function progress(data, key, values, stash = false) {
  const entries = list(data, key);
  if (stash) {
    if (entries.some(row => !Array.isArray(row) || row.some(v => !integer(v, 255)))) fail();
    for (const id of timelineIds) {
      while (entries.length <= id) entries.push([]);
      for (const v of values) if (!entries[id].some(old => n(old) === v)) entries[id].push(v);
    }
  } else {
    const seen = new Set();
    for (const entry of entries) {
      if (!object(entry) || !integer(entry.timelineID, 255) || seen.has(n(entry.timelineID)) || !Array.isArray(entry.progress) || entry.progress.some(v => !integer(v, 255))) fail();
      seen.add(n(entry.timelineID));
    }
    for (const id of timelineIds) {
      let entry = entries.find(row => n(row.timelineID) === id);
      if (!entry) { entry = { timelineID: id, progress: [] }; entries.push(entry); }
      for (const v of values) if (!entry.progress.some(old => n(old) === v)) entry.progress.push(v);
    }
  }
}
function emptyRun(id) {
  // SavedMonolithRun.LoadRun (0x1C558C0): <=1 saved island invokes
  // EchoWeb.initialiseNewWeb with the saved corruption. No borrowed map bytes.
  return { timelineID: id, difficultyIndex: 1, depth: 0, questCompletion: 0, questBranch: 0, bossLootDropped: false,
    savedEchoWeb: { version: 0, corruption: 300, echoesSinceLastDeath: 0, gazeOfOrobyss: 0, islands: [], chains: [], chainTiers: [], chainTypes: [], beaconRevealed: [] },
    stability: 1600, previousEchoWasQuestEcho: false, previousQuestEchoWasCompleted: false,
    previousQuestAttemptLostStability: false, previousEchoHexIndex: 0, previousEchoIslandType: 0,
    hasRerolledOptions: false, modIndexs: [], modRemainingDurations: [], modEffectModifiers: [], options: [] };
}
function timelines(data) {
  const runs = list(data, 'monolithRuns'), seen = new Set();
  for (const run of runs) {
    if (!object(run) || !integer(run.timelineID, 255) || !integer(run.difficultyIndex, 255)) fail();
    const key = `${run.timelineID}:${run.difficultyIndex}`;
    if (seen.has(key)) fail();
    seen.add(key);
    const limits = worldData.timelines[String(run.timelineID)]?.difficulties[n(run.difficultyIndex)];
    if (!limits) continue; // Retain special runs, such as the tutorial (99).
    if (!integer(run.stability) || !object(run.savedEchoWeb) || !integer(run.savedEchoWeb.corruption)) fail();
    run.stability = Math.min(1600, limits.maxStability);
    run.savedEchoWeb.corruption = Math.max(limits.minCorruption, Math.min(300, limits.maxCorruption));
  }
  for (const id of timelineIds) if (!seen.has(`${id}:1`)) runs.push(emptyRun(id));
  progress(data, 'timelineCompletion', [0]);
  progress(data, 'timelineDifficultyCompletion', [0]);
  progress(data, 'timelineDifficultyUnlocks', [0, 1]);
  if (data.maxCorruption != null && !integer(data.maxCorruption)) fail();
  data.maxCorruption = Math.max(300, n(data.maxCorruption ?? 0));
}
function harbingers(character, stash) {
  if (character.factions == null) character.factions = {};
  if (stash.factions == null) stash.factions = {};
  if (!object(character.factions) || !object(stash.factions)) fail();
  for (const data of [character, stash]) {
    const old = data.factions['2'];
    if (old != null && (!object(old) || !integer(old.rank, 10) || !integer(old.reputation) || !integer(old.favor))) fail();
    const faction = old ?? { rank: 0, reputation: 0, favor: 0 };
    if (data === character) Object.assign(faction, { id: 2, isMember: true, hasEverJoined: true });
    if (n(faction.rank) !== 10) faction.reputation = 0;
    faction.rank = 10;
    if (faction.factionSpecific == null) faction.factionSpecific = {};
    if (!object(faction.factionSpecific)) fail();
    data.factions['2'] = faction;
  }
  const p = stash.factions['2'].factionSpecific;
  for (const key of ['currentprogression', 'highestCorruptionKill', 'defeatedAterroths']) if (p[key] != null && !integer(p[key], key === 'currentprogression' ? 10 : 2147483647)) fail();
  p.currentprogression = 10;
  p.highestCorruptionKill = Math.max(300, n(p.highestCorruptionKill ?? 0));
  p.defeatedAterroths ??= 0;
  if (p.defeatedHarbingerTimelines == null) p.defeatedHarbingerTimelines = {};
  if (!object(p.defeatedHarbingerTimelines) || Object.values(p.defeatedHarbingerTimelines).some(v => !integer(v))) fail();
  // AterrothUnlocked (0x20D0220) checks this dictionary's count, not rank alone.
  for (const id of timelineIds) p.defeatedHarbingerTimelines[id] = Math.max(1, n(p.defeatedHarbingerTimelines[id] ?? 0));
  p.progressionrecoveryattempted = true;
  const quests = list(stash, 'savedQuests'), seen = new Set();
  for (const quest of quests) {
    if (!object(quest) || !integer(quest.questID) || seen.has(n(quest.questID))) fail();
    seen.add(n(quest.questID));
    const rule = catalog.harbingerQuests[String(quest.questID)];
    if (!rule) continue;
    const step = campaignData.steps[String(quest.questStepID)];
    if (!step || step[0] !== n(quest.questID) || !['completeObjectives', 'failedObjectives', 'nolongerRelevantObjectives', 'objectiveProgress'].every(key => Array.isArray(quest[key]))) fail();
    if (['completeObjectives', 'failedObjectives', 'nolongerRelevantObjectives'].some(key => quest[key].some(v => !integer(v))) || quest.objectiveProgress.some(row => !object(row) || !integer(row.objectiveID) || !integer(row.progress))) fail();
  }
  for (const [id, rule] of Object.entries(catalog.harbingerQuests)) {
    const index = quests.findIndex(q => n(q.questID) === Number(id)), old = index < 0 ? null : quests[index];
    if (old && isQuestCompleted(old)) continue;
    const objectiveIds = new Set(rule.objectives);
    const quest = { ...(old ?? {}), questID: Number(id), questStepID: rule.step, state: 0, questBranch: rule.branch,
      completeObjectives: [...new Set([...(old?.completeObjectives ?? []).map(n), ...rule.objectives])],
      failedObjectives: (old?.failedObjectives ?? []).filter(v => !objectiveIds.has(n(v))),
      nolongerRelevantObjectives: (old?.nolongerRelevantObjectives ?? []).filter(v => !objectiveIds.has(n(v))),
      objectiveProgress: (old?.objectiveProgress ?? []).filter(row => !objectiveIds.has(n(row.objectiveID))), trackStatus: old?.trackStatus ?? 0 };
    if (index < 0) quests.push(quest); else quests[index] = quest;
  }
  if (catalog.harbingerQuests[String(character.focusedQuest)]) character.focusedQuest = -1;
}
export function endgameResourceQuantity(data, resource) {
  return (data[resource.collection] ?? []).filter(item => Array.isArray(item.data) && n(item.data[5]) === resource.baseTypeId &&
    (resource.baseTypeId === 107 ? n(item.data[6]) * 256 + n(item.data[7]) : n(item.data[6])) === resource.subTypeId)
    .reduce((sum, item) => sum + n(item.quantity), 0);
}
function resources(character, stash) {
  for (const key of ['keysList', 'wovenEchoesList', 'materialsList']) if (stash[key] != null && !Array.isArray(stash[key])) fail();
  if (!Array.isArray(character.savedItems)) fail();
  const used = new Set();
  for (const items of [character.savedItems, stash.keysList, stash.wovenEchoesList, stash.materialsList]) {
    for (const item of items ?? []) if (Array.isArray(item?.data) && item.data.length >= 5) used.add((n(item.data[1]) & 127) * 0x1000000 + n(item.data[2]) * 65536 + n(item.data[3]) * 256 + n(item.data[4]));
  }
  for (const resource of ENDGAME_RESOURCES) {
    const entries = list(stash, resource.collection);
    const matches = entries.filter(item => Array.isArray(item?.data) && n(item.data[5]) === resource.baseTypeId &&
      (resource.baseTypeId === 107 ? n(item.data[6]) * 256 + n(item.data[7]) : n(item.data[6])) === resource.subTypeId);
    if (matches.length > 1) fail();
    if (matches.length) {
      const item = matches[0];
      if (item.data.length !== (resource.baseTypeId === 107 ? 8 : 7) || n(item.data[0]) !== 6 || item.data.some(v => !integer(v, 255)) || !integer(item.quantity)) fail();
      item.quantity = 99; // Preserve the existing wrapper, item identity, and metadata.
    } else {
      let id = 16;
      while (used.has(id)) id++;
      if (id > 0x7fffffff) fail();
      used.add(id);
      const data = [6, (id >>> 24) & 127, (id >>> 16) & 255, (id >>> 8) & 255, id & 255, resource.baseTypeId];
      if (resource.baseTypeId === 107) data.push(resource.subTypeId >> 8, resource.subTypeId & 255);
      else data.push(resource.subTypeId);
      entries.push({ itemData: null, data, inventoryPosition: { x: 0, y: resource.subTypeId }, quantity: 99, containerID: 100, formatVersion: 2 });
    }
  }
  stash.keysTabUnlocked = true;
  stash.wovenEchoesTabUnlocked = true;
}

/** Opt-in transaction over character + matching stash. Originals are never changed. */
export function applyEndgameSkip(documents) {
  const character = documents.find(doc => doc.kind === 'character'), stash = documents.find(doc => doc.kind === 'stash');
  if (!character || !stash) throw new WorldError('ENDGAME_NEEDS_STASH', '“速通至终局”需要同时上传角色及同赛季仓库文件。', 'Endgame skip requires both the character and its matching season stash.');
  validateCompanion(character, stash);
  const c = cloneSaveData(character.data), s = cloneSaveData(stash.data);
  timelines(c);
  progress(s, 'monolithTimelineBranchCompletion', [0], true);
  progress(s, 'monolithTimelineDifficultyCompletion', [0], true);
  progress(s, 'monolithTimelineUnlock', [0, 1], true);
  s.isTimelineProgressionPointsThresholdReached = true;
  if (s.highestCorruption != null && !integer(s.highestCorruption)) fail();
  s.highestCorruption = Math.max(300, n(s.highestCorruption ?? 0));
  harbingers(c, s);
  resources(c, s);
  return documents.map(doc => doc === character ? { ...doc, data: c } : doc === stash ? { ...doc, data: s } : doc);
}
