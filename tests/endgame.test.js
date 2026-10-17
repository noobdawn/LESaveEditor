import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENDGAME_RESOURCES, applyEndgameSkip, endgameResourceQuantity } from '../web/src/core/endgame.js';
import { applyCampaignSkip, campaignSummary, isQuestCompleted } from '../web/src/core/campaign.js';
import { createWorkflow } from '../web/src/core/workflow.js';
import { getTimelines, worldData } from '../web/src/core/world.js';
import { parseSave, serializeSave } from '../web/src/core/save.js';
import catalog from '../web/src/data/endgame-data.json' with { type: 'json' };

const build = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
function fresh() {
  return { characterName: 'Synthetic', level: 1, characterClass: 2, chosenMastery: 0, originalMastery: 0, currentExp: 0,
    savedQuests: [], savedMonolithQuests: [], unlockedWaypointScenes: [], portalUnlocked: false, lastVisitedTownScene: null, focusedQuest: -1,
    savedCharacterTree: { treeID: '', version: 0, nodeIDs: [], nodePoints: [], unspentPoints: 0 }, savedSkillTrees: [], abilityBar: ['', '', '', '', ''],
    savedItems: [{ containerID: 1, data: [99, 0, 0, 0, 16], opaque: 'keep' }], factions: {}, cycle: 8, hardcore: false,
    sceneProgresses: ['opaque'], oneTimeEvents: ['unrelated'], dungeonCompletion: [{ dungeonID: 0, tiersCompleted: [] }] };
}
function documents(data = fresh(), stash = {}) {
  return [parseSave('EPOCH'+JSON.stringify(data), '1CHARACTERSLOT_BETA_9'),
    parseSave('EPOCH'+JSON.stringify({ cycle: 8, gold: 123, tabsv2: [], keysList: [], wovenEchoesList: [], ...stash }), 'STASH_CYCLE_8_0')];
}
const dataOf = docs => docs.map(doc => doc.data);

test('pinned endgame catalog contains precisely the requested fourteen current resources and ten Harbinger stages', () => {
  assert.equal(catalog.gameBuildHash, worldData.gameBuildHash);
  assert.deepEqual(ENDGAME_RESOURCES.filter(r=>r.baseTypeId===104).map(r=>r.subTypeId), [0,3,4,5,6,7,13,14,22,23]);
  assert.deepEqual(ENDGAME_RESOURCES.filter(r=>r.baseTypeId===107).map(r=>r.subTypeId), [18,29,30,47]);
  assert.equal(ENDGAME_RESOURCES.every(r=>r.name.zh && r.name.en), true);
  assert.equal(Object.keys(catalog.harbingerQuests).length, 10);
  assert.equal(catalog.harbingerQuests['146'], undefined, 'Aberroth kill quest must remain playable');
});

test('level-one character gets all empowered runs, native unlocks and all tickets without copying a map or changing level/rewards', () => {
  const docs = documents(), before = docs.map(serializeSave);
  const [character, stash] = dataOf(applyEndgameSkip(docs));
  assert.equal(Number(character.level), 1);
  assert.equal(Number(character.savedCharacterTree.unspentPoints), 0);
  assert.equal(campaignSummary(character).passiveRewards, 0, 'campaign skip remains a separate prerequisite');
  const runs = getTimelines({ kind: 'character', data: character });
  assert.equal(runs.length, 10);
  assert.ok(runs.every(r=>r.difficulty===1 && r.stability==='1600' && r.corruption==='300'));
  assert.ok(character.monolithRuns.every(r=>r.savedEchoWeb.islands.length===0 && r.options.length===0));
  assert.ok(character.timelineDifficultyUnlocks.every(r=>r.progress.includes(0)&&r.progress.includes(1)));
  assert.ok(character.timelineDifficultyCompletion.every(r=>r.progress.includes(0) && !r.progress.includes(1)));
  assert.equal(stash.monolithTimelineUnlock.length, 11);
  assert.ok(stash.monolithTimelineUnlock.slice(1).every(r=>r.includes(0)&&r.includes(1)));
  assert.equal(stash.keysList.length, 10); assert.equal(stash.wovenEchoesList.length, 4);
  assert.ok(ENDGAME_RESOURCES.every(r=>endgameResourceQuantity(stash,r)===99));
  const ids = new Set();
  for (const resource of ENDGAME_RESOURCES) {
    const saved = stash[resource.collection].find(item=>Number(item.data[6])*(resource.baseTypeId===107?256:1)+Number(resource.baseTypeId===107?item.data[7]:0)===resource.subTypeId);
    assert.equal(saved.data.length, resource.baseTypeId===107?8:7);
    assert.equal(saved.data[0],6); assert.equal(saved.data[5],resource.baseTypeId);
    assert.equal(saved.containerID,100); assert.equal(saved.formatVersion,2);
    const id = saved.data.slice(1,5).reduce((sum,b)=>sum*256+b,0);
    assert.ok(id>16 && !ids.has(id)); ids.add(id);
  }
  assert.equal(stash.factions['2'].factionSpecific.currentprogression, 10);
  assert.equal(Object.keys(stash.factions['2'].factionSpecific.defeatedHarbingerTimelines).length, 10);
  assert.equal(stash.factions['2'].factionSpecific.defeatedAterroths, 0);
  assert.ok(stash.savedQuests.every(isQuestCompleted));
  assert.deepEqual(character.savedItems,docs[0].data.savedItems);
  for(const key of ['oneTimeEvents','sceneProgresses','savedMonolithQuests','dungeonCompletion']) assert.deepEqual(character[key],docs[0].data[key]);
  assert.equal(String(stash.gold),'123');
  assert.deepEqual(docs.map(serializeSave),before);
});

test('existing ordinary runs respect caps, maps/unknown data survive, counts become 99 and reapplication is idempotent', () => {
  const c = fresh();
  c.monolithRuns = [
    { timelineID:1,difficultyIndex:0,stability:11,savedEchoWeb:{corruption:5,islands:[{opaque:'map'}]},opaque:'keep' },
    { timelineID:2,difficultyIndex:1,stability:12,savedEchoWeb:{corruption:999,islands:[{opaque:'other map'}]},opaque:'keep' },
    { timelineID:99,difficultyIndex:0,stability:3,savedEchoWeb:{corruption:0},opaque:'special' },
  ];
  c.maxCorruption=999;
  c.timelineDifficultyUnlocks=[{timelineID:1,progress:[0,1],opaque:'keep'},{timelineID:99,progress:[42]}];
  const ticket={data:[6,0,0,1,0,104,7],quantity:120,formatVersion:2,containerID:100,inventoryPosition:{x:0,y:7},opaque:'keep'};
  const docs=documents(c,{keysList:[ticket,{data:[9,0,0,0,25,104,24],quantity:7}],highestCorruption:1000,privateCounter:999,
    factions:{2:{rank:10,reputation:15,favor:11,factionSpecific:{currentprogression:10,highestCorruptionKill:1000,defeatedAterroths:7,defeatedHarbingerTimelines:{1:20},opaque:'keep'}}}});
  const once=applyEndgameSkip(docs),[a,b]=dataOf(once);
  assert.equal(a.monolithRuns[0].stability,500); assert.equal(a.monolithRuns[0].savedEchoWeb.corruption,50);
  assert.deepEqual(a.monolithRuns[1].savedEchoWeb.islands,c.monolithRuns[1].savedEchoWeb.islands);
  assert.deepEqual(a.monolithRuns[2],docs[0].data.monolithRuns[2]);
  assert.equal(Number(a.maxCorruption),999); assert.equal(Number(b.highestCorruption),1000);
  assert.deepEqual(b.keysList[0],{...docs[1].data.keysList[0],quantity:99});
  assert.deepEqual(b.keysList[1],docs[1].data.keysList[1]);
  assert.equal(Number(b.factions['2'].factionSpecific.defeatedAterroths),7);
  assert.equal(Number(b.factions['2'].factionSpecific.defeatedHarbingerTimelines[1]),20);
  assert.equal(Number(b.factions['2'].reputation),15);
  assert.deepEqual(applyEndgameSkip(once).map(serializeSave),once.map(serializeSave));
});

test('missing/wrong stash, duplicate identities and unsupported fields fail atomically', () => {
  assert.throws(()=>applyEndgameSkip(documents().slice(0,1)),{code:'ENDGAME_NEEDS_STASH'});
  const wrong=documents(); wrong[1].outputName='STASH_CYCLE_7_0';
  assert.throws(()=>applyEndgameSkip(wrong),{code:'STASH_MISMATCH'});
  const cases=[
    docs=>docs[0].data.monolithRuns=[{timelineID:1,difficultyIndex:1,stability:0}],
    docs=>docs[0].data.timelineDifficultyUnlocks=[{timelineID:1,progress:[true]}],
    docs=>docs[1].data.keysList='broken',
    docs=>docs[1].data.keysList=[{data:[7,0,0,0,17,104,7],quantity:5}],
    docs=>docs[1].data.keysList=[{data:[6,0,0,0,17,104,7],quantity:5},{data:[6,0,0,0,18,104,7],quantity:6}],
    docs=>docs[1].data.factions={2:{rank:0,reputation:0,favor:0,factionSpecific:{currentprogression:11}}},
    docs=>docs[1].data.savedQuests=[{questID:136,questStepID:1}],
  ];
  for(const alter of cases){const docs=documents();alter(docs);const before=docs.map(serializeSave);assert.throws(()=>applyEndgameSkip(docs),{code:'ENDGAME_SAVE_FORMAT'});assert.deepEqual(docs.map(serializeSave),before);}
});

test('workflow dependency, stash requirement, review/download, reset and repeated level-one synchronization are enforced', async () => {
  const flow=createWorkflow({fetchBuild:async()=>build});
  await flow.importBuild('om6w3Ypq');
  flow.setOption('endgameSkip',true); assert.equal(flow.state.options.endgameSkip,false);
  flow.setOption('campaignSkip',true); flow.setOption('endgameSkip',true);
  const original=documents();
  const files=original.map(doc=>({name:doc.name,text:async()=>serializeSave(doc)}));
  await flow.addFiles(files.slice(0,1));
  assert.equal(flow.synchronize(),false);assert.equal(flow.state.error.code,'ENDGAME_NEEDS_STASH');
  assert.equal(flow.state.synced.length,0);
  await flow.addFiles(files.slice(1));
  for(let repeat=0;repeat<2;repeat++){
    assert.equal(flow.synchronize(),true,flow.state.error?.message);
    const c=flow.state.synced[0].data;
    assert.equal(c.savedCharacterTree.nodePoints.reduce((sum,v)=>sum+Number(v),0)+Number(c.savedCharacterTree.unspentPoints),113);
    assert.equal(c.monolithRuns.length,10);
    assert.equal(flow.prepareReview(),true);flow.state.acknowledged=true;
    const downloads=flow.downloads();assert.equal(downloads.length,2);
    for(const download of downloads)assert.doesNotThrow(()=>parseSave(download.text,download.name));
  }
  assert.deepEqual([...flow.state.files.values()].map(e=>serializeSave(e.original)),original.map(serializeSave));
  flow.setOption('campaignSkip',false);
  assert.equal(flow.state.options.endgameSkip,false);assert.equal(flow.state.synced.length,0);assert.equal(flow.state.acknowledged,false);
  flow.state.options.endgameSkip=true;
  assert.equal(flow.synchronize(),false);assert.equal(flow.state.error.code,'ENDGAME_REQUIRES_CAMPAIGN');
});

test('campaign alone still grants level-one native reward budget without creating endgame progress', () => {
  const result=applyCampaignSkip(fresh());assert.equal(Number(result.data.savedCharacterTree.unspentPoints),14);
  assert.equal(result.data.monolithRuns,undefined);assert.deepEqual(result.data.factions,{});
});

test('unrelated uint64 counters retain every digit through the endgame transaction', () => {
  const docs=documents();
  docs[0]=parseSave('EPOCH'+JSON.stringify({...fresh(),unknownCounter:'__large__'}).replace('"__large__"','18446744073709551615'),'1CHARACTERSLOT_BETA_9');
  const result=applyEndgameSkip(docs);
  assert.equal(String(result[0].data.unknownCounter),'18446744073709551615');
  assert.match(serializeSave(result[0]),/"unknownCounter":18446744073709551615/);
});

test('optional private endgame character and stash remain immutable and preserve lossless counters', {skip:!process.env.LE_ENDGAME_CHARACTER_FIXTURE||!process.env.LE_ENDGAME_STASH_FIXTURE}, () => {
  const c=parseSave(readFileSync(process.env.LE_ENDGAME_CHARACTER_FIXTURE,'utf8'),'1CHARACTERSLOT_BETA_5');
  const s=parseSave(readFileSync(process.env.LE_ENDGAME_STASH_FIXTURE,'utf8'),'STASH_CYCLE_8_0');
  const before=[c,s].map(serializeSave),result=applyEndgameSkip([c,s]);
  assert.deepEqual([c,s].map(serializeSave),before);
  assert.ok(ENDGAME_RESOURCES.every(r=>endgameResourceQuantity(result[1].data,r)===99));
  assert.deepEqual(result[0].data.savedItems,c.data.savedItems);
  assert.deepEqual(applyEndgameSkip(result).map(serializeSave),result.map(serializeSave));
});
