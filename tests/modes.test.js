import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getCharacterMode, modeStashName, currentStash, applyModeChange } from '../web/src/core/modes.js';
import { parseSave, serializeSave, cloneSaveData } from '../web/src/core/save.js';
import { createWorkflow } from '../web/src/core/workflow.js';
import { applyWorldEdits, expectedStashName } from '../web/src/core/world.js';

const charName='1CHARACTERSLOT_BETA_7',shared='STASH_CYCLE_8_0',solo='STASH_CYCLE_8_2_7';
const doc=(name,data)=>parseSave('EPOCH'+JSON.stringify(data),name);
const character=(extra={})=>doc(charName,{id:'7',characterName:'Synthetic',level:87,cycle:8,hardcore:false,deaths:0,died:false,soloChallenge:false,soloCharacterChallenge:false,savedItems:[{data:[99,8],containerID:1}],savedCharacterTree:{nodeIDs:[1],nodePoints:[3],unspentPoints:2},savedSkillTrees:[{treeID:'keep'}],abilityBar:['unchanged'],factions:{0:{rank:8,reputation:125,favor:999,isMember:true}},monolithRuns:[{timelineID:1,difficultyIndex:0,stability:5,savedEchoWeb:{corruption:0}}],...extra});
const stash=(name=shared,extra={})=>doc(name,{id:name,cycle:8,gold:100,ancientBones:20,tabsv2:[],retiredStashes:[],retiredStashesData:[],stashType:name===solo?2:name.endsWith('_1')?1:0,factions:{0:{rank:4,reputation:22,favor:33}},keysList:[],materialsList:[],wovenEchoesList:[],savedShards:[],...extra});
const global=(names=[shared])=>doc('Epoch_Local_Global_Data_Beta',{id:'Epoch_Local_Global_Data_Beta',version:4,stashes:names});
const draft=(extra={})=>({hardcore:false,solo:true,merge:false,createTarget:true,...extra});
const resource=(base,sub,quantity)=>({itemData:null,data:[6,0,0,0,17,base,...(base===107?[sub>>8,sub&255]:[sub])],quantity,containerID:100,inventoryPosition:{x:0,y:sub},formatVersion:2});
const file=d=>({name:d.name,size:serializeSave(d).length,text:async()=>serializeSave(d)});

test('mode identification follows deaths, SCF priority, and native offline stash naming',()=>{
  const c=character();assert.equal(modeStashName(c),shared);
  assert.equal(modeStashName(character({hardcore:true})), 'STASH_CYCLE_8_1');
  assert.equal(modeStashName(character({hardcore:true,deaths:1,died:false})),shared);
  assert.equal(modeStashName(character({hardcore:true,deaths:0,died:true})),'STASH_CYCLE_8_1');
  assert.equal(modeStashName(character({soloCharacterChallenge:true})),solo);
  assert.equal(modeStashName(character({soloChallenge:true})),solo);
  assert.equal(modeStashName(character({cycle:0,soloCharacterChallenge:true})),'STASH_2_7');
  assert.equal(modeStashName(character({cycle:0})),'STASH_0');
  assert.equal(expectedStashName(character({hardcore:true,deaths:1})),shared);
  assert.equal(getCharacterMode(character({hardcore:'false'})),null);
});

test('independent world route makes no build request and preserves level, equipment, allocation and skills',async()=>{
  const flow=createWorkflow({fetchBuild:async()=>{throw new Error('must not fetch');}});
  flow.setOption('campaignSkip',true);flow.setOption('endgameSkip',true);
  assert.equal(flow.startWorldEdit(),true);assert.equal(flow.state.step,2);assert.equal(flow.state.options.endgameSkip,false);
  const docs=[character(),stash(),stash('STASH_CYCLE_8_1'),global()];
  assert.equal(await flow.addFiles(docs.map(file)),true);
  assert.equal(flow.synchronize(),true,flow.state.error?.message);
  flow.setWorldEdit({kind:'timeline',index:0,field:'stability',value:'400'});
  assert.equal(flow.prepareReview(),true,flow.state.error?.message);flow.state.acknowledged=true;
  const result=parseSave(flow.downloads()[0].text,charName);
  assert.equal(Number(result.data.monolithRuns[0].stability),400);
  for(const key of ['level','savedItems','savedCharacterTree','savedSkillTrees','abilityBar','factions'])assert.deepEqual(result.data[key],docs[0].data[key]);
  assert.equal(flow.downloads().length,1);
  flow.goBack(2);flow.goBack();assert.equal(flow.state.step,0,'world back skips Build sync settings');
});

test('splitting into character-found creates an empty stash/tab and index entry while shared storage remains byte-for-byte unchanged',()=>{
  const docs=[character(),stash(),global()],before=docs.map(serializeSave);
  const result=applyModeChange(docs,draft());
  const c=result.documents[0],s=currentStash(result.documents),g=result.documents.find(d=>d.kind==='global');
  assert.equal(c.data.soloCharacterChallenge,true);assert.equal(c.data.soloChallenge,false);
  assert.equal(s.outputName,solo);assert.equal(Number(s.data.gold),0);assert.equal(s.data.factions&&Object.keys(s.data.factions).length,0);
  assert.deepEqual(s.data.tabsv2,[`${solo}_TAB_0`]);
  assert.ok(g.data.stashes.includes(solo));assert.equal(result.migration.created,true);
  assert.equal(serializeSave(result.documents.find(d=>d.outputName===shared)),before[1]);
  assert.deepEqual(c.data.savedItems,docs[0].data.savedItems);assert.deepEqual(c.data.savedCharacterTree,docs[0].data.savedCharacterTree);
  assert.equal(Number(c.data.factions[0].rank),0,'character faction view follows the empty destination');
  assert.deepEqual(docs.map(serializeSave),before);
  assert.deepEqual(applyModeChange(result.documents,draft()).documents.map(serializeSave),result.documents.map(serializeSave));
});

function mergeDocuments(){
  return [character({soloCharacterChallenge:true}),stash(solo,{gold:60,ancientBones:3,tabsv2:[`${solo}_TAB_0`],keysList:[resource(104,7,5)],materialsList:[resource(102,0,2)],wovenEchoesList:[resource(107,29,3)],savedShards:[{shardType:25,quantity:4}],savedResonances:[{privateIdentity:'keep'}],monolithTimelineUnlock:[[],[0,1]],unlockedBlessings:[5],dungeonCompletion:[{dungeonID:0,tiersCompleted:[0,1]}]}),stash(shared,{gold:100,keysList:[resource(104,7,7)],savedShards:[{shardType:25,quantity:6}],monolithTimelineUnlock:[[],[0]],unlockedBlessings:[6]}),doc(`${solo}_TAB_0`,{id:`${solo}_TAB_0`,displayName:'Original tab',savedItems:[{data:[99,1,2],opaque:'keep'}],tabId:0}),global([shared,solo])];
}
test('leaving SCF merges resource totals without copying items or overwriting target tabs; factions remain pending in retired storage',()=>{
  const docs=mergeDocuments(),before=docs.map(serializeSave);
  const {documents:result,migration}=applyModeChange(docs,draft({solo:false,merge:true,createTarget:false}));
  const source=result.find(d=>d.outputName===solo).data,target=result.find(d=>d.outputName===shared).data;
  assert.equal(source.gold,0);assert.equal(source.removeOnly,true);assert.equal(Number(source.stashType),0);
  assert.equal(target.gold,160);assert.equal(target.keysList[0].quantity,12);assert.equal(target.savedShards[0].quantity,10);
  assert.equal(Number(target.materialsList[0].quantity),2);assert.equal(Number(target.wovenEchoesList[0].quantity),3);
  assert.deepEqual(source.keysList,[]);assert.deepEqual(source.savedShards,[]);
  assert.deepEqual(source.savedResonances,docs[1].data.savedResonances);
  assert.deepEqual(target.retiredStashes,[solo]);assert.deepEqual(target.retiredStashesData[0].unmergedFactions,[0]);
  assert.deepEqual(target.monolithTimelineUnlock[1].map(Number),[0,1]);assert.deepEqual(target.unlockedBlessings.map(Number),[6,5]);
  assert.deepEqual(source.factions,docs[1].data.factions);assert.deepEqual(target.factions,docs[2].data.factions);
  assert.equal(serializeSave(result[3]),before[3],'source item tab is not repacked, renamed or overwritten');
  assert.deepEqual(result[4].data.stashes,[shared]);assert.equal(migration.merge,true);
  assert.deepEqual(docs.map(serializeSave),before);
  assert.deepEqual(applyModeChange(result,draft({solo:false,merge:true,createTarget:false})).documents.map(serializeSave),result.map(serializeSave));
});

test('mode preview and repeated review recalculate from originals, support newly generated downloads, and reset on edits',async()=>{
  const flow=createWorkflow();flow.startWorldEdit();await flow.addFiles([character(),stash(),global()].map(file));assert.equal(flow.synchronize(),true);
  flow.setMode(draft());
  assert.equal(flow.previewMode().documents.length,5);
  for(let i=0;i<2;i++){
    assert.equal(flow.prepareReview(),true,flow.state.error?.message);flow.state.acknowledged=true;
    const files=flow.downloads();assert.deepEqual(files.map(f=>f.name).sort(),[charName,'Epoch_Local_Global_Data_Beta',solo,`${solo}_TAB_0`].sort());
    for(const f of files)assert.doesNotThrow(()=>parseSave(f.text,f.name));
  }
  flow.setMode(null);assert.equal(flow.state.result.length,0);assert.equal(flow.state.acknowledged,false);
  assert.equal(flow.prepareReview(),true);flow.state.acknowledged=true;assert.equal(flow.downloads().length,0);
});

test('hardcore transition resets deaths explicitly and uses the uploaded destination stash',()=>{
  const docs=[character({hardcore:true,deaths:3,died:true}),stash(),stash('STASH_CYCLE_8_1')];
  const result=applyModeChange(docs,draft({hardcore:true,solo:false,createTarget:false}));
  assert.equal(result.documents[0].data.deaths,0);assert.equal(result.documents[0].data.died,false);
  assert.equal(modeStashName(result.documents[0]),'STASH_CYCLE_8_1');assert.equal(result.migration.resetDeaths,true);
});

test('missing stash/index/tabs, target collisions, other seasons, accounts and resource overflow fail atomically',()=>{
  const failures=[
    [[character(),global()],draft(),'MODE_SOURCE_STASH'],
    [[character(),stash()],draft(),'MODE_GLOBAL_REQUIRED'],
    [[character(),stash(),global([shared,solo])],draft(),'MODE_TARGET_EXISTS'],
    [[character(),stash()],draft({createTarget:false}),'MODE_TARGET_STASH'],
    [[character(),stash(solo,{removeOnly:true}),stash()],draft(),'MODE_RETIRED_STASH'],
    [[character(),stash(shared,{cycle:7})],draft(),'MODE_STASH_CYCLE'],
    [mergeDocuments().filter(d=>d.kind!=='stashTab'),draft({solo:false,merge:true}),'MODE_MISSING_TABS'],
  ];
  const overflow=mergeDocuments();overflow[2].data.gold=2147483647;failures.push([overflow,draft({solo:false,merge:true}),'MODE_RESOURCE_OVERFLOW']);
  const owners=[character(),stash(shared,{partitionKey:'a'}),global()];owners[2].data.partitionKey='b';failures.push([owners,draft(),'MODE_STASH_OWNER']);
  for(const [docs,choice,code] of failures){const before=docs.map(serializeSave);assert.throws(()=>applyModeChange(docs,choice),{code});assert.deepEqual(docs.map(serializeSave),before);}
});

test('multi-file world uploads remain atomic and original Build route keeps its strict one-character one-stash limit',async()=>{
  const flow=createWorkflow();flow.startWorldEdit();const docs=mergeDocuments();assert.equal(await flow.addFiles(docs.map(file)),true);
  const originalFiles=flow.state.files;
  assert.equal(await flow.addFiles([file(stash('STASH_CYCLE_7_0',{cycle:7}))]),false);assert.equal(flow.state.files,originalFiles);
  assert.equal(await flow.addFiles([file(docs[0])]),false);assert.equal(flow.state.error.code,'DUPLICATE_FILE');
  const old=createWorkflow();assert.equal(await old.addFiles(docs.map(file)),false);assert.equal(old.state.files.size,0);
});

test('unknown counters and all original source bytes remain lossless when generating a new mode',()=>{
  const c=character();c.data.unknown=cloneSaveData(parseSave('EPOCH{"characterName":"x","level":1,"savedItems":[],"counter":18446744073709551615}',charName).data.counter);
  const result=applyModeChange([c,stash(),global()],draft());
  assert.equal(String(result.documents[0].data.unknown),'18446744073709551615');
});

test('optional real character is read-only while split output preserves every inventory byte', {skip:!process.env.LE_MODE_CHARACTER_FIXTURE||!process.env.LE_MODE_STASH_FIXTURE||!process.env.LE_MODE_GLOBAL_FIXTURE},()=>{
  const docs=[parseSave(readFileSync(process.env.LE_MODE_CHARACTER_FIXTURE,'utf8'),charName),parseSave(readFileSync(process.env.LE_MODE_STASH_FIXTURE,'utf8'),shared),parseSave(readFileSync(process.env.LE_MODE_GLOBAL_FIXTURE,'utf8'),'Epoch_Local_Global_Data_Beta')];
  const before=docs.map(serializeSave),result=applyModeChange(docs,draft());
  assert.deepEqual(result.documents[0].data.savedItems,docs[0].data.savedItems);
  assert.equal(serializeSave(result.documents[1]),before[1]);assert.deepEqual(docs.map(serializeSave),before);
  const returned=applyModeChange(result.documents,draft({solo:false,merge:true,createTarget:false}));
  assert.equal(modeStashName(returned.documents[0]),shared);
  assert.deepEqual(returned.documents[0].data.savedItems,docs[0].data.savedItems);
  const destination=returned.documents.find(d=>d.outputName===shared);
  for(const key of ['gold','ancientBones','savedShards','materialsList','keysList','wovenEchoesList'])assert.equal(serializeSave({value:destination.data[key]}),serializeSave({value:docs[1].data[key]}));
  assert.deepEqual(docs.map(serializeSave),before);
});
