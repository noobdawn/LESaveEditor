import test from 'node:test';
import assert from 'node:assert/strict';
import LZ from 'lz-string';
import { parseSave, serializeSave } from '../web/src/core/save.js';
import { applyPlannerBuild } from '../web/src/core/planner.js';
import { createWorkflow } from '../web/src/core/workflow.js';
import { applyWorldEdits } from '../web/src/core/world.js';
import { applyCampaignSkip } from '../web/src/core/campaign.js';
import { applyEndgameSkip, ENDGAME_RESOURCES } from '../web/src/core/endgame.js';
import { applyPlannerItems } from '../web/src/core/items.js';
import { applyModeChange } from '../web/src/core/modes.js';
import { createValueFilterDraft, generateValueFilter } from '../web/src/core/value-filter.js';
import itemData from '../web/src/core/game-item-data.json' with { type: 'json' };

const doc = (name, data) => parseSave('EPOCH' + JSON.stringify(data), name);
const baseId = (base, sub = 0) => 'I' + LZ.compressToBase64('1' + String(base).padStart(3, '0') + String(sub).padStart(3, '0') + '000').replace(/=+$/, '');
const build = () => ({ data_version: 'Version 1.5.0', data: {
  bio: { level: 100, characterClass: 3, chosenMastery: 1 }, equipment: {}, idols: [], blessings: {},
  charTree: { version: 4, selected: { 1: 8 } },
  skillTrees: [{ treeID: 'ss37kl', slotNumber: 0, version: 2, level: 20, selected: { 2: 5 } }], hud: ['ss37kl', '', '', '', ''],
} });
function character(extra = {}) {
  return doc('1CHARACTERSLOT_BETA_9', {
    id: '9', characterName: 'Synthetic', level: 100, characterClass: 3, chosenMastery: 1, originalMastery: 1,
    cycle: 8, hardcore: false, deaths: 0, savedItems: [],
    savedCharacterTree: { nodeIDs: [], nodePoints: [], unspentPoints: 113 }, savedSkillTrees: [],
    savedQuests: [], unlockedWaypointScenes: [], portalUnlocked: false, lastVisitedTownScene: null,
    factions: { 0: { rank: 8, reputation: 12, favor: 13 } },
    monolithRuns: [{ timelineID: 1, difficultyIndex: 0, stability: 0, savedEchoWeb: { corruption: 0 } }],
    ...extra,
  });
}
const stash = (extra = {}, name = 'STASH_CYCLE_8_0') => doc(name, {
  id: name, cycle: 8, gold: 0, tabsv2: [], retiredStashes: [], retiredStashesData: [],
  factions: { 0: { rank: 8, reputation: 12, favor: 13 } }, ...extra,
});
function capture(code, fn) {
  let caught;
  assert.throws(fn, error => { caught = error; return error.code === code; });
  return caught;
}
const english = error => error.messageEn ?? error.message.split(' / ')[1];

test('node cap and unmet prerequisites name the tree, node and required/current points without changing inputs', () => {
  const c = character(), before = serializeSave(c), source = build();
  source.data.charTree.selected = { 1: 9 };
  const cap = capture('INCOMPATIBLE_TREE', () => applyPlannerBuild(c.data, source, { equipment: false, idols: false, blessings: false }));
  assert.match(cap.message, /角色被动树节点 #1已分配 9 点，单节点上限为 8 点/);
  assert.match(cap.messageEn, /node #1 has 9 points; its cap is 8/);
  source.data.charTree.selected = { 11: 5 };
  const requirement = capture('INVALID_TREE_REQUIREMENTS', () => applyPlannerBuild(c.data, source, { equipment: false, idols: false, blessings: false }));
  assert.match(requirement.message, /节点 #11无法分配/);
  assert.ok(requirement.details.issues[0].parents.length || requirement.details.issues[0].threshold > 0 || requirement.details.issues[0].needsBase);
  assert.match(requirement.messageEn, /prerequisites/);
  assert.equal(serializeSave(c), before);
  source.data.bio.level = '1 / 2';
  const number = capture('INVALID_BUILD', () => applyPlannerBuild(c.data, source));
  assert.match(number.message, /bio.level.*1 \/ 2.*1–100/);
  assert.match(number.messageEn, /bio.level.*1 \/ 2.*from 1 to 100/);
});

test('future tree versions and locked specialization slots expose supported versions and character level thresholds', () => {
  const source = build(), c = character();
  source.data.charTree.version = 99;
  const version = capture('FUTURE_TREE_VERSION', () => applyPlannerBuild(c.data, source));
  assert.match(version.message, /版本为 99，工具支持版本 4/);
  assert.match(version.message, /更新工具/);
  const low = character({ level: 3 });
  const slot = capture('LOCKED_SKILL_SLOT', () => applyPlannerBuild(low.data, build(), { equipment: false, idols: false, blessings: false }));
  assert.match(slot.message, /第 1 槽.*需要角色 4 级，当前同步等级 3 级/);
  assert.equal(slot.details.required, 4);
});

test('world edit bounds identify the exact timeline/difficulty or faction and preserve failed transactions', () => {
  const docs = [character(), stash()], before = docs.map(serializeSave);
  const corruption = capture('WORLD_RANGE', () => applyWorldEdits(docs, [{ kind: 'timeline', index: 0, field: 'corruption', value: '51' }]));
  assert.match(corruption.message, /流亡者的陨落（普通）·腐化值.*51.*0–50/);
  assert.match(corruption.messageEn, /Fall of the Outcasts \(Normal\) corruption.*51.*0 to 50/);
  const favor = capture('WORLD_RANGE', () => applyWorldEdits(docs, [{ kind: 'faction', id: '0', field: 'favor', value: '-1' }]));
  assert.match(favor.message, /命运之环·恩惠.*-1.*2147483647/);
  const fraction = capture('WORLD_RANGE', () => applyWorldEdits(docs, [{ kind: 'timeline', index: 0, field: 'stability', value: '1 / 2' }]));
  assert.match(fraction.message, /1 \/ 2/);
  assert.deepEqual(docs.map(serializeSave), before);
});

test('batch upload errors identify the bad file and duplicates without retaining partial uploads', async () => {
  const flow = createWorkflow(), c = character();
  const okFile = { name: c.name, text: async () => c.originalText };
  assert.equal(await flow.addFiles([okFile, { name: 'STASH_CYCLE_8_0', text: async () => '{}' }]), false);
  assert.equal(flow.state.error.code, 'INVALID_PREFIX');
  assert.match(flow.state.error.message, /文件「STASH_CYCLE_8_0」.*EPOCH/);
  assert.match(flow.state.error.messageEn, /File "STASH_CYCLE_8_0"/);
  assert.equal(flow.state.error.details.filename, 'STASH_CYCLE_8_0');
  assert.equal(flow.state.files.size, 0);
  assert.equal(await flow.addFiles([okFile]), true);
  assert.equal(await flow.addFiles([{ ...okFile, name: c.name + '.bak' }]), false);
  assert.match(flow.state.error.message, /1CHARACTERSLOT_BETA_9\.bak.*已载入/);
  assert.equal(flow.state.files.size, 1);
  const readError = createWorkflow();
  assert.equal(await readError.addFiles([{ name: c.name, text: async () => { throw new DOMException('Read failed', 'NotReadableError'); } }]), false);
  assert.equal(readError.state.error.code, 'FILE_READ');
  assert.match(readError.state.error.message, /1CHARACTERSLOT_BETA_9/);
});

test('campaign format errors pinpoint quest and passive fields, with an English message free of Chinese annotations', () => {
  const c = character();
  c.data.savedQuests = [{ questID: 127, questStepID: 99999, completeObjectives: [], failedObjectives: [], nolongerRelevantObjectives: [], objectiveProgress: [] }];
  const before = serializeSave(c), error = capture('CAMPAIGN_SAVE_FORMAT', () => applyCampaignSkip(c.data));
  assert.match(error.message, /savedQuests\[0\]\.questStepID.*127.*99999/);
  assert.match(error.messageEn, /savedQuests\[0\]\.questStepID.*99999/);
  assert.doesNotMatch(error.messageEn, /\p{Script=Han}/u);
  assert.equal(serializeSave(c), before);
  const badPoints = character();
  badPoints.data.savedCharacterTree.nodeIDs = [1];
  const tree = capture('CAMPAIGN_SAVE_FORMAT', () => applyCampaignSkip(badPoints.data));
  assert.match(tree.message, /savedCharacterTree.nodePoints.*数量 1/);
});

test('endgame errors expose the affected stash field or duplicate named ticket and remain atomic', () => {
  const docs = [character(), stash({ highestCorruption: 'broken / token' })], before = docs.map(serializeSave);
  const badField = capture('ENDGAME_SAVE_FORMAT', () => applyEndgameSkip(docs));
  assert.match(badField.message, /STASH_CYCLE_8_0.*highestCorruption.*broken/);
  assert.match(badField.messageEn, /stash highestCorruption.*broken/);
  assert.match(badField.message, /broken \/ token/);
  assert.doesNotMatch(badField.messageEn, /\p{Script=Han}/u);
  assert.deepEqual(docs.map(serializeSave), before);
  const ticket = ENDGAME_RESOURCES[0], data = [6, 0, 0, 0, 17, ticket.baseTypeId, ticket.subTypeId];
  const tickets = [character(), stash({ [ticket.collection]: [{ data, quantity: 1 }, { data, quantity: 2 }] })];
  const original = tickets.map(serializeSave);
  const duplicate = capture('ENDGAME_SAVE_FORMAT', () => applyEndgameSkip(tickets));
  assert.ok(duplicate.message.includes(ticket.name.zh));
  assert.match(duplicate.message, /重复资源记录.*2/);
  assert.ok(duplicate.messageEn.includes(ticket.name.en));
  assert.doesNotMatch(duplicate.messageEn, /\p{Script=Han}/u);
  assert.deepEqual(tickets.map(serializeSave), original);
});

test('idol overlap and out-of-grid messages include row numbers, coordinates and dimensions', () => {
  const build = { idols: [{ id: baseId(25), x: 1, y: 1 }, { id: baseId(25), x: 1, y: 1 }] };
  const c = character(), before = serializeSave(c);
  const overlap = capture('OVERLAPPING_IDOLS', () => applyPlannerItems(c.data, build, { equipment: false, blessings: false }));
  assert.match(overlap.message, /第 2 项（坐标 1,1）与第 1 项重叠/);
  assert.match(english(overlap), /idol 2 at \(1, 1\) overlaps idol 1/);
  const wide = Object.entries(itemData.bases).find(([id, base]) => Number(id) >= 25 && Number(id) <= 33 && base.size[0] > 1);
  const id = baseId(Number(wide[0]), Number(Object.keys(wide[1].subtypes)[0]));
  const outside = capture('INVALID_IDOL_POSITION', () => applyPlannerItems(c.data, { idols: [{ id, x: 5, y: 1 }] }, { equipment: false, blessings: false }));
  assert.match(outside.message, /第 1 项.*坐标（5，1）.*尺寸.*5×5/);
  assert.equal(serializeSave(c), before);
});

test('filter input and idol selection errors show the offending target and how to recover', () => {
  const d = createValueFilterDraft(build());
  d.idols = [{ id: 'empty', enabled: true, baseTypeId: 25, affixIds: [] }];
  const empty = capture('EMPTY_IDOL_SELECTION', () => generateValueFilter(d));
  assert.match(empty.message, /第 1 项.*没有选择任何词缀.*关闭该项/);
  assert.match(empty.messageEn, /Idol target 1.*disable this target/);
  d.idols = []; d.options.rareUniqueThreshold = 3;
  const range = capture('INVALID_FILTER_VALUE', () => generateValueFilter(d));
  assert.match(range.message, /稀有暗金权重阈值.*3.*0–1/);
  assert.match(range.messageEn, /Rare unique weight threshold.*between 0 and 1/);
});

test('stash merge overflow names the resource and displays both amounts, sum and game cap', () => {
  const solo = 'STASH_CYCLE_8_2_9';
  const docs = [character({ soloCharacterChallenge: true }), stash({ gold: 2147483647 }, solo), stash({ gold: 1 }),
    doc('Epoch_Local_Global_Data_Beta', { stashes: [solo, 'STASH_CYCLE_8_0'] })];
  const before = docs.map(serializeSave);
  const error = capture('MODE_RESOURCE_OVERFLOW', () => applyModeChange(docs, { hardcore: false, solo: false, merge: true, createTarget: false }));
  assert.match(error.message, /金币.*2147483647 \+ 1 = 2147483648.*上限 2147483647/);
  assert.match(error.messageEn, /Gold.*2147483648.*limit of 2147483647/);
  assert.doesNotMatch(error.messageEn, /\p{Script=Han}/u);
  assert.deepEqual(docs.map(serializeSave), before);
});
