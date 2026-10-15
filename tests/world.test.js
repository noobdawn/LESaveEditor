import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSave, serializeSave } from '../web/src/core/save.js';
import { getTimelines, getFactions, factionRankInfo, applyWorldEdits, validateCompanion, worldData } from '../web/src/core/world.js';

export function worldDocuments() {
  const factions = {0:{rank:8,reputation:6212,favor:129256},2:{rank:3,reputation:0,favor:0},3:{rank:3,reputation:4082,favor:5582}};
  const character = {characterName:'Synthetic',level:91,cycle:8,hardcore:false,savedItems:[],factions,
    monolithRuns:[{timelineID:1,difficultyIndex:0,stability:125,savedEchoWeb:{corruption:0,unknown:'keep'}},
      {timelineID:1,difficultyIndex:1,stability:52,savedEchoWeb:{corruption:136}},
      {timelineID:99,difficultyIndex:0,stability:0,savedEchoWeb:{corruption:0}}],
    unknown:18446744073709551615n.toString(),
  };
  const stash = {gold:100,tabsv2:[],cycle:8,factions:structuredClone(factions)};
  stash.factions[2].factionSpecific={currentprogression:3,defeatedHarbingerTimelines:{1:1,9:1,10:1},progressionrecoveryattempted:true};
  return [parseSave('EPOCH'+JSON.stringify(character),'1CHARACTERSLOT_BETA_9'),parseSave('EPOCH'+JSON.stringify(stash),'STASH_CYCLE_8_0')];
}

test('timeline selectors use installed bilingual names, distinct difficulties and game limits',()=>{
  const [character]=worldDocuments();
  const timelines=getTimelines(character);
  assert.equal(timelines.length,2,'activity ID 99 is not a timeline');
  assert.deepEqual(timelines[0].name,{en:'Fall of the Outcasts',zh:'流亡者的陨落'});
  assert.equal(timelines[0].maxStability,500);
  assert.equal(timelines[0].maxCorruption,50);
  assert.equal(timelines[1].maxStability,1600);
  assert.equal(timelines[1].minCorruption,100);
  assert.equal(Object.keys(worldData.timelines).length,10);
});

test('reputation tables use rank-local progress and skip the initial join requirement in cumulative totals',()=>{
  assert.equal(factionRankInfo('0',1).total,0);
  assert.equal(factionRankInfo('0',2).total,900);
  assert.equal(factionRankInfo('0',8,6212).total,257512);
  assert.equal(factionRankInfo('0',12).total,2051300);
  assert.equal(factionRankInfo('1',12).next,null);
  assert.equal(factionRankInfo('3',10).total,291000);
  assert.throws(()=>factionRankInfo('0',13),{code:'WORLD_RANGE'});
  assert.throws(()=>factionRankInfo('3',11),{code:'WORLD_RANGE'});
});

test('world patches validate bounds atomically and preserve unselected fields and activity runs',()=>{
  const documents=worldDocuments(), originals=documents.map(serializeSave);
  const result=applyWorldEdits(documents,[{kind:'timeline',index:0,field:'stability',value:'500'},{kind:'timeline',index:1,field:'corruption',value:'186'}]);
  assert.equal(String(result[0].data.monolithRuns[0].stability),'500');
  assert.equal(String(result[0].data.monolithRuns[1].savedEchoWeb.corruption),'186');
  assert.equal(result[0].data.monolithRuns[0].savedEchoWeb.unknown,'keep');
  assert.deepEqual(result[0].data.monolithRuns[2],documents[0].data.monolithRuns[2]);
  for(const edit of [{kind:'timeline',index:0,field:'stability',value:'501'},{kind:'timeline',index:0,field:'corruption',value:'51'},{kind:'timeline',index:1,field:'corruption',value:'99'},{kind:'timeline',index:2,field:'stability',value:'20'},{kind:'timeline',index:0,field:'level',value:'100'}])assert.throws(()=>applyWorldEdits(documents,[{kind:'timeline',index:0,field:'stability',value:'200'},edit]));
  assert.deepEqual(documents.map(serializeSave),originals);
});

test('rank changes update character and stash together and reset rank-local reputation rather than storing the total',()=>{
  const documents=worldDocuments();
  const result=applyWorldEdits(documents,[{kind:'faction',id:'0',field:'rank',value:'12'},{kind:'faction',id:'0',field:'favor',value:'200000'}]);
  for(const doc of result){assert.equal(String(doc.data.factions[0].rank),'12');assert.equal(String(doc.data.factions[0].reputation),'0');assert.equal(String(doc.data.factions[0].favor),'200000');}
  const unchanged=applyWorldEdits(documents,[{kind:'faction',id:'0',field:'rank',value:'8'}]);
  assert.deepEqual(unchanged.map(serializeSave),documents.map(serializeSave),'choosing the same rank must preserve current progress');
  const favorOnly=applyWorldEdits(documents,[{kind:'faction',id:'0',field:'favor',value:'200000'}]);
  assert.equal(String(favorOnly[0].data.factions[0].reputation),'6212');
});

test('Forgotten Knights rank changes keep the native progression consistent without inventing defeated bosses',()=>{
  const documents=worldDocuments();
  const before=documents[1].data.factions[2].factionSpecific;
  const result=applyWorldEdits(documents,[{kind:'faction',id:'2',field:'rank',value:'10'}]);
  assert.equal(String(result[1].data.factions[2].factionSpecific.currentprogression),'10');
  assert.deepEqual(result[1].data.factions[2].factionSpecific.defeatedHarbingerTimelines,before.defeatedHarbingerTimelines);
  assert.equal(result[1].data.factions[2].factionSpecific.progressionrecoveryattempted,true);
  delete documents[1].data.factions[2].factionSpecific.currentprogression;
  assert.throws(()=>applyWorldEdits(documents,[{kind:'faction',id:'2',field:'rank',value:'10'}]),{code:'MISSING_HARBINGER_PROGRESS'});
});

test('faction editing requires an exact season and hardcore companion and only supports existing records',()=>{
  const [character,stash]=worldDocuments();
  assert.deepEqual(getFactions(character),[]);
  assert.throws(()=>validateCompanion(character,{...stash,outputName:'STASH_CYCLE_7_0'}),{code:'STASH_MISMATCH'});
  assert.throws(()=>validateCompanion(character,{...stash,outputName:'STASH_CYCLE_8_1'}),{code:'STASH_MISMATCH'});
  assert.throws(()=>applyWorldEdits([character],[{kind:'faction',id:'0',field:'rank',value:'12'}]),{code:'UNKNOWN_FACTION'});
  assert.throws(()=>applyWorldEdits([character,stash],[{kind:'faction',id:'1',field:'rank',value:'12'}]),{code:'UNKNOWN_FACTION'});
  assert.throws(()=>applyWorldEdits([character,stash],[{kind:'faction',id:'0',field:'favor',value:'2147483648'}]),{code:'WORLD_RANGE'});
});
