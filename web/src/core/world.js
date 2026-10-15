import catalog from '../data/world-data.json' with { type: 'json' };
import { applySaveEdits } from './save.js';

export { catalog as worldData };
const own = (value, key) => value != null && Object.hasOwn(value, key);
const numeric = value => /^\d+$/.test(String(value ?? ''));
export class WorldError extends Error {
  constructor(code, zh, en) { super(zh); this.code = code; this.messageEn = en; }
}
function fail(code, zh, en) { throw new WorldError(code, zh, en); }
function integer(value, min, max) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^(?:0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    fail('WORLD_RANGE', `请输入 ${min}–${max} 之间的整数。`, `Enter an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

export function expectedStashName(character) {
  if (!character || !numeric(character.data.cycle) || typeof character.data.hardcore !== 'boolean') return null;
  if (character.data.soloChallenge || character.data.soloCharacterChallenge) return null;
  return `STASH_CYCLE_${String(character.data.cycle)}_${character.data.hardcore ? 1 : 0}`;
}

export function validateCompanion(character, stash) {
  if (!stash) return;
  const expected = expectedStashName(character);
  if (!expected) fail('STASH_ASSOCIATION', '无法验证该角色与仓库的关联。请仅载入角色文件。', 'The character/stash association cannot be verified. Load only the character file.');
  if (stash.outputName.toUpperCase() !== expected || String(stash.data.cycle) !== String(character.data.cycle)) {
    fail('STASH_MISMATCH', `请上传此角色对应的仓库文件：${expected}。`, `Upload this character’s matching stash: ${expected}.`);
  }
}

export function getTimelines(character) {
  if (character?.kind !== 'character') return [];
  return (Array.isArray(character.data.monolithRuns) ? character.data.monolithRuns : []).flatMap((run, index) => {
    const metadata = catalog.timelines[String(run.timelineID)];
    const difficulty = Number(run.difficultyIndex);
    const limits = metadata?.difficulties[difficulty];
    if (!limits || !numeric(run.stability) || !numeric(run.savedEchoWeb?.corruption)) return [];
    return [{ index, id: String(run.timelineID), difficulty, name: metadata.name, ...limits,
      stability: String(run.stability), corruption: String(run.savedEchoWeb.corruption) }];
  }).sort((a, b) => Number(a.id) - Number(b.id) || a.difficulty - b.difficulty);
}

/** The save stores rank-local reputation, not the cumulative total shown in guides. */
export function factionRankInfo(id, rank, reputation = 0) {
  const metadata = catalog.factions[String(id)];
  if (!metadata) fail('UNKNOWN_FACTION', '不支持此阵营。', 'This faction is not supported.');
  rank = integer(rank, 0, metadata.maxRank);
  reputation = integer(reputation, 0, 2147483647);
  const base = metadata.reputationPerRank.slice(1, Math.max(1, rank)).reduce((sum, cost) => sum + cost, 0);
  return { rank, maxRank: metadata.maxRank, reputation, total: base + reputation,
    threshold: base, next: rank < metadata.maxRank ? metadata.reputationPerRank[rank] : null };
}

export function getFactions(character, stash) {
  if (!stash) return [];
  validateCompanion(character, stash);
  return Object.entries(stash.data.factions ?? {}).flatMap(([id, faction]) => {
    const metadata = catalog.factions[id];
    const characterFaction = character.data.factions?.[id];
    if (!metadata || !characterFaction || !['rank', 'reputation', 'favor'].every(key => numeric(faction[key]) && numeric(characterFaction[key]))) return [];
    const rank = Number(faction.rank);
    if (rank > metadata.maxRank) return [];
    return [{ id, name: metadata.name, ...factionRankInfo(id, rank, Number(faction.reputation)),
      favor: String(faction.favor), rankEditable: !metadata.rankFromHarbingerProgress || numeric(faction.factionSpecific?.currentprogression),
      harbinger: metadata.rankFromHarbingerProgress }];
  });
}

/** All world edits validate before any document is returned. Missing structures stay absent. */
export function applyWorldEdits(documents, edits = []) {
  if (!Array.isArray(edits)) fail('INVALID_WORLD_EDITS', '世界修改列表无效。', 'Invalid world changes.');
  const character = documents.find(doc => doc.kind === 'character');
  const stash = documents.find(doc => doc.kind === 'stash');
  const timelines = getTimelines(character);
  const factions = new Map(getFactions(character, stash).map(faction => [faction.id, faction]));
  const patches = new Map(documents.map(doc => [doc.name, []]));
  const factionEdits = new Map();
  for (const edit of edits) {
    if (edit.kind === 'timeline') {
      const timeline = timelines.find(run => run.index === edit.index);
      if (!timeline || !['stability', 'corruption'].includes(edit.field)) fail('UNKNOWN_TIMELINE', '此世界线或字段无法编辑。', 'This timeline or field cannot be edited.');
      const limits = edit.field === 'stability' ? [0, timeline.maxStability] : [timeline.minCorruption, timeline.maxCorruption];
      const value = integer(edit.value, ...limits);
      patches.get(character.name).push({ path: ['monolithRuns', edit.index, ...(edit.field === 'corruption' ? ['savedEchoWeb', 'corruption'] : ['stability'])], value: String(value) });
    } else if (edit.kind === 'faction') {
      if (!factions.has(String(edit.id)) || !['rank', 'favor'].includes(edit.field)) fail('UNKNOWN_FACTION', '请先载入角色对应的仓库，且只能修改已有阵营。', 'Load the matching stash; only existing factions can be edited.');
      const draft = factionEdits.get(String(edit.id)) ?? {};
      draft[edit.field] = edit.value;
      factionEdits.set(String(edit.id), draft);
    } else fail('INVALID_WORLD_EDITS', '只支持世界线和阵营修改。', 'Only timeline and faction changes are supported.');
  }
  for (const [id, edit] of factionEdits) {
    const faction = factions.get(id);
    const values = {};
    if (own(edit, 'rank')) {
      const rank = integer(edit.rank, 0, faction.maxRank);
      if (rank !== faction.rank) {
        if (!faction.rankEditable) fail('MISSING_HARBINGER_PROGRESS', '存档缺少已验证的先兆进度，无法变更此阶级。', 'Verified Harbinger progression is missing; this rank cannot be changed.');
        values.rank = String(rank);
        values.reputation = '0';
        if (faction.harbinger) patches.get(stash.name).push({ path: ['factions', id, 'factionSpecific', 'currentprogression'], value: String(rank) });
      }
    }
    if (own(edit, 'favor')) values.favor = String(integer(edit.favor, 0, 2147483647));
    for (const doc of [character, stash]) for (const [field, value] of Object.entries(values)) {
      patches.get(doc.name).push({ path: ['factions', id, field], value });
    }
  }
  return documents.map(doc => applySaveEdits(doc, patches.get(doc.name)));
}
