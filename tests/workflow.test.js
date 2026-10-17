import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import { createWorkflow } from '../web/src/core/workflow.js';
import { parseSave, serializeSave } from '../web/src/core/save.js';
import { decodeSavedItem, encodePlannerItem } from '../web/src/core/items.js';

const example=JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json',import.meta.url),'utf8'));
function file(name,data){const text='EPOCH'+JSON.stringify(data);return {name,size:text.length,text:async()=>text};}
function files(){
  const factions={0:{rank:8,reputation:6212,favor:129256}};
  return [file('1CHARACTERSLOT_BETA_9',{
    characterName:'Synthetic',level:91,characterClass:0,chosenMastery:2,originalMastery:2,currentExp:777,cycle:8,hardcore:false,
    savedCharacterTree:{treeID:'',version:4,nodeIDs:[],nodePoints:[],unspentPoints:104},savedSkillTrees:[],abilityBar:['','','','',''],
    savedItems:[{containerID:1,data:[99,1,2],futureField:'keep'}],factions,
    monolithRuns:[{timelineID:1,difficultyIndex:0,stability:125,savedEchoWeb:{corruption:0}}],
  }),file('STASH_CYCLE_8_0',{gold:100,tabsv2:[],cycle:8,factions})];
}
async function ready(){const flow=createWorkflow({fetchBuild:async()=>example});await flow.importBuild('om6w3Ypq');await flow.addFiles(files());return flow;}
for (const maxRolls of [false, true]) test(`public BakqJGYy completes full sync, review and download (maxRolls=${maxRolls})`, async () => {
  const build = JSON.parse(readFileSync(new URL('./fixtures/planner-BakqJGYy.json', import.meta.url), 'utf8'));
  const before = structuredClone(build);
  const flow = createWorkflow({ fetchBuild: async () => build });
  assert.equal(await flow.importBuild('BakqJGYy'), true);
  assert.equal(await flow.addFiles(files()), true);
  const originals = [...flow.state.files.values()].map(entry => serializeSave(entry.original));
  flow.setOption('maxRolls', maxRolls);
  assert.equal(flow.synchronize(), true, flow.state.error?.message);
  assert.equal(flow.prepareReview(), true, flow.state.error?.message);
  flow.state.acknowledged = true;
  const download = flow.downloads().find(item => item.name === '1CHARACTERSLOT_BETA_9');
  const result = parseSave(download.text, download.name);
  const amulet = decodeSavedItem(result.data.savedItems.find(item => Number(item.containerID) === 11));
  assert.equal(amulet.uniqueId, 469);
  assert.equal(amulet.rarity, 9);
  assert.equal(amulet.flags, 144);
  assert.equal(amulet.extraFlags, 0);
  assert.deepEqual(amulet.affixes.map(a => [a.affixId, a.tier, a.roll]), [[1083, 7, maxRolls ? 255 : 128], [1087, 8, maxRolls ? 255 : 128]]);
  assert.deepEqual([...flow.state.files.values()].map(entry => serializeSave(entry.original)), originals);
  assert.deepEqual(build, before);
});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test('the workflow always syncs level, class and mastery even if option state is tampered with',async()=>{
  const flow=await ready();
  flow.setOption('class',false);flow.setOption('level',false);
  assert.equal(flow.state.options.class,undefined);
  flow.state.options.class=false;flow.state.options.level=false;
  assert.equal(flow.synchronize(),true,flow.state.error?.message);
  const character=flow.state.synced.find(doc=>doc.kind==='character');
  assert.equal(String(character.data.level),'100');assert.equal(String(character.data.characterClass),'3');assert.equal(String(character.data.chosenMastery),'1');
  assert.equal(String(character.data.originalMastery),'1');assert.equal(String(character.data.currentExp),'0');
});

test('maximum rolls applies only to selected synchronized items, preserving tiers, potential and inventory',async()=>{
  const baseline=await ready();assert.equal(baseline.synchronize(),true);
  const flow=await ready();flow.setOption('maxRolls',true);assert.equal(flow.synchronize(),true);
  const before=baseline.state.synced[0].data.savedItems,after=flow.state.synced[0].data.savedItems;
  assert.deepEqual(after[0],before[0]);
  let checked=0;
  for(let i=1;i<after.length;i++){
    const a=decodeSavedItem(before[i]),b=decodeSavedItem(after[i]);assert.equal(b.supported,true);
    assert.ok(b.implicitRolls.every(roll=>roll===255));assert.ok((b.uniqueRolls??[]).every(roll=>roll===255));assert.ok(b.affixes.every(affix=>affix.roll===255));
    assert.deepEqual(b.affixes.map(affix=>[affix.affixId,affix.tier]),a.affixes.map(affix=>[affix.affixId,affix.tier]));
    assert.equal(b.extraFlags,a.extraFlags);assert.equal(b.potentialByte,a.potentialByte);checked++;
  }
  assert.equal(checked,33);
  const untouched=await ready();
  for(const section of ['equipment','idols','blessings'])untouched.setOption(section,false);
  untouched.setOption('maxRolls',true);assert.equal(untouched.synchronize(),true);
  assert.deepEqual(untouched.state.synced[0].data.savedItems,untouched.state.files.get('1CHARACTERSLOT_BETA_9').original.data.savedItems);
  assert.throws(()=>encodePlannerItem({id:'UAwRgrALA7CQ',ir:[999,0,0]},{containerID:2,maxRolls:true}),{code:'INVALID_ROLL'});
});

test('resynchronization starts from exact originals and does not repeatedly grant level-based passive points',async()=>{
  const flow=await ready();const originals=[...flow.state.files.values()].map(entry=>serializeSave(entry.original));
  assert.equal(flow.synchronize(),true);
  const first=serializeSave(flow.state.synced[0]);
  flow.setWorldEdit({kind:'timeline',index:0,field:'stability',value:'300'});
  flow.goBack(2);assert.equal(flow.synchronize(),true);
  const tree=flow.state.synced[0].data.savedCharacterTree;
  assert.equal(tree.nodePoints.reduce((sum,n)=>sum+Number(n),0)+Number(tree.unspentPoints),113);
  assert.equal(flow.prepareReview(),true);assert.equal(String(flow.state.result[0].data.monolithRuns[0].stability),'300');
  assert.deepEqual([...flow.state.files.values()].map(entry=>serializeSave(entry.original)),originals);
  assert.notEqual(serializeSave(flow.state.result[0]),first);
});

test('download requires review acknowledgement, returns native files individually and resets after edits',async()=>{
  const flow=await ready();assert.equal(flow.synchronize(),true);
  flow.setWorldEdit({kind:'faction',id:'0',field:'favor',value:'200000'});
  assert.equal(flow.prepareReview(),true);
  assert.throws(()=>flow.downloads(),{code:'REVIEW_REQUIRED'});
  flow.state.acknowledged=true;
  const downloads=flow.downloads();
  assert.deepEqual(downloads.map(file=>file.name),['1CHARACTERSLOT_BETA_9','STASH_CYCLE_8_0']);
  for(const download of downloads){assert.ok(download.text.startsWith('EPOCH'));assert.equal(String(parseSave(download.text,download.name).data.factions[0].favor),'200000');}
  flow.setWorldEdit({kind:'faction',id:'0',field:'rank',value:'12'});
  assert.throws(()=>flow.downloads(),{code:'REVIEW_REQUIRED'});
  flow.goBack(3);assert.equal(flow.prepareReview(),true);assert.equal(flow.state.acknowledged,false);
});

test('invalid uploads are atomic, reject duplicates and mismatched companions, and never replace existing files',async()=>{
  const flow=createWorkflow();const inputs=files();
  assert.equal(await flow.addFiles([inputs[0]]),true);
  const original=flow.state.files.get(inputs[0].name).original;
  assert.equal(await flow.addFiles([inputs[0]]),false);assert.equal(flow.state.files.size,1);
  const wrong=file('STASH_CYCLE_7_0',{gold:10,tabsv2:[],cycle:7,factions:{}});
  assert.equal(await flow.addFiles([wrong]),false);assert.equal(flow.state.error.code,'STASH_MISMATCH');
  assert.equal(flow.state.files.size,1);assert.equal(flow.state.files.get(inputs[0].name).original,original);
  assert.equal(await flow.addFiles([file('STASH_CYCLE_8_0_TAB_0',{displayName:'Tab',savedItems:[]})]),false);
});

test('a later build request invalidates the previous build and ignores stale async responses',async()=>{
  const first=deferred(),second=deferred(),requests=[first,second];
  const flow=createWorkflow({fetchBuild:()=>requests.shift().promise});
  flow.state.build=example;
  const oldRead=flow.importBuild('AAAAAAAA'),newRead=flow.importBuild('BBBBBBBB');
  assert.equal(flow.state.build,null);assert.equal(flow.synchronize(),false);
  second.resolve(example);assert.equal(await newRead,true);
  first.resolve({unexpected:true});assert.equal(await oldRead,false);assert.equal(flow.state.build,example);
  assert.equal(flow.state.loading,false);
});

test('file reads block synchronization and changing selection until the complete batch validates',async()=>{
  const read=deferred(),flow=await ready();flow.removeFile('STASH_CYCLE_8_0');
  const loading=flow.addFiles([{name:'STASH_CYCLE_8_0',size:50,text:()=>read.promise}]);
  assert.equal(flow.synchronize(),false);assert.equal(flow.state.error.code,'BUSY');
  flow.removeFile('1CHARACTERSLOT_BETA_9');assert.equal(flow.state.files.size,1);
  read.resolve(await files()[1].text());assert.equal(await loading,true);assert.equal(flow.state.files.size,2);
});

test('a share created from an imported save can sync faction-restricted gear through review and native download', async () => {
  const imported = structuredClone(example);
  imported.data.equipment.head.faction = [0, 4];
  imported.data.equipment.ring1.faction = [0, 5];
  imported.data.equipment.ring2.faction = [1, 5];
  const flow = createWorkflow({ fetchBuild: async () => imported });
  assert.equal(await flow.importBuild('AAAAAAAA'), true);
  assert.equal(await flow.addFiles(files()), true);
  const originals = [...flow.state.files.values()].map(entry => serializeSave(entry.original));
  flow.setOption('maxRolls', true);
  assert.equal(flow.synchronize(), true, flow.state.error?.message);
  assert.equal(flow.prepareReview(), true, flow.state.error?.message);
  flow.state.acknowledged = true;
  const downloaded = parseSave(flow.downloads()[0].text, flow.downloads()[0].name);
  for (const [container, flags] of [[2, 132], [10, 133], [9, 128]]) {
    const item = downloaded.data.savedItems.find(item => Number(item.containerID) === container);
    assert.equal(Number(item.data[8]), flags);
    assert.ok(decodeSavedItem(item).implicitRolls.every(roll => roll === 255));
  }
  assert.deepEqual([...flow.state.files.values()].map(entry => serializeSave(entry.original)), originals);
});

test('a build with the Unsated Rage variant completes sync, review and download without altering inventory', async () => {
  const build = structuredClone(example);
  build.data.equipment.ring1 = {id: 'UAwRmBYHZKA', affixes: [{id: 'AKwBgjEA', tier: 7, r: 191}, {id: 'AAwdmQ', tier: 5}], sealedAffix: {id: 'AIzDMDYg', tier: 1}};
  for (const maxRolls of [false, true]) {
    const flow = createWorkflow({fetchBuild: async () => build});
    assert.equal(await flow.importBuild('AAAAAAAA'), true);
    assert.equal(await flow.addFiles(files()), true); flow.setOption('maxRolls', maxRolls);
    const original = [...flow.state.files.values()][0].original;
    const before = serializeSave(original);
    assert.equal(flow.synchronize(), true, flow.state.error?.message);
    assert.equal(flow.prepareReview(), true, flow.state.error?.message); flow.state.acknowledged = true;
    const result = parseSave(flow.downloads()[0].text, flow.downloads()[0].name);
    const ring = decodeSavedItem(result.data.savedItems.find(item => Number(item.containerID) === 10));
    assert.equal(ring.uniqueId, 477); assert.equal(ring.rarity, 9);
    assert.deepEqual(ring.affixes.map(affix => [affix.affixId, affix.tier, affix.roll]), [[1136,1,maxRolls?255:128],[501,7,maxRolls?255:191],[70,5,maxRolls?255:128]]);
    assert.deepEqual(result.data.savedItems.find(item => Number(item.containerID) === 1), original.data.savedItems[0]);
    assert.equal(serializeSave(original), before);
  }
});

for (const maxRolls of [false, true]) test(`public Q9JP5wbn completes full sync, review and download with fixed variants in both auxiliary fields (maxRolls=${maxRolls})`, async () => {
  const build = JSON.parse(readFileSync(new URL('./fixtures/planner-Q9JP5wbn.json', import.meta.url), 'utf8'));
  const originalBuild = structuredClone(build);
  const flow = createWorkflow({ fetchBuild: async () => build });
  assert.equal(await flow.importBuild('https://www.lastepochtools.com/planner/zh/Q9JP5wbn'), true);
  assert.equal(await flow.addFiles(files()), true);
  flow.setOption('maxRolls', maxRolls);
  for (const section of ['equipment', 'idols', 'blessings', 'passives', 'skills', 'skillBar']) assert.equal(flow.state.options[section], true, `${section} must stay included in this full-sync regression`);
  const originals = [...flow.state.files.values()].map(entry => serializeSave(entry.original));
  const originalCharacter = flow.state.files.get('1CHARACTERSLOT_BETA_9').original;
  assert.equal(flow.synchronize(), true, flow.state.error?.message);
  assert.equal(flow.state.step, 3);
  assert.equal(flow.prepareReview(), true, flow.state.error?.message);
  assert.equal(flow.state.step, 4);
  assert.throws(() => flow.downloads(), { code: 'REVIEW_REQUIRED' });
  flow.state.acknowledged = true;
  const downloads = flow.downloads();
  assert.deepEqual(downloads.map(download => download.name), ['1CHARACTERSLOT_BETA_9']);
  const result = parseSave(downloads[0].text, downloads[0].name);
  assert.equal(String(result.data.level), '100');
  assert.equal(String(result.data.characterClass), '4');
  assert.equal(String(result.data.chosenMastery), '2');

  // Assert concrete game bytes through the decoder, not encodePlannerItem's
  // own result: these are fixed FakeUniqueMod variants despite LET placing
  // 1147 T4 in primordialAffix. The native corruption block must remain last.
  const hands = decodeSavedItem(result.data.savedItems.find(item => Number(item.containerID) === 6));
  assert.equal(hands.supported, true);
  assert.equal(hands.uniqueId, 479);
  assert.equal(hands.rarity, 9);
  assert.equal(hands.extraFlags, 128);
  assert.deepEqual(hands.affixes.map(affix => [affix.affixId, affix.tier, affix.roll]), [
    [1145, 5, maxRolls ? 255 : 97], [1147, 4, maxRolls ? 255 : 3],
    [503, 7, maxRolls ? 255 : 178], [17, 7, maxRolls ? 255 : 90], [80, 5, maxRolls ? 255 : 171],
    [1027, 6, maxRolls ? 255 : 6],
  ]);
  const slotContainers = { head: 2, chest: 3, weapon1: 4, weapon2: 5, hands: 6, waist: 7, feet: 8, ring2: 9, ring1: 10, amulet: 11, relic: 12, idol_altar: 123 };
  for (const [slot, planner] of Object.entries(build.data.equipment)) {
    if (!planner) continue;
    const saved = decodeSavedItem(result.data.savedItems.find(item => Number(item.containerID) === slotContainers[slot]));
    assert.equal(saved.supported, true, `${slot} must be present and decodable`);
    const supplied = [...(planner.affixes ?? []), planner.sealedAffix, planner.primordialAffix, planner.corruptedAffix].filter(Boolean);
    const expected = supplied.map(affix => [Number(LZString.decompressFromBase64(affix.id.slice(1))), affix.tier, maxRolls ? 255 : Math.round(affix.r ?? 128)]).sort((a, b) => a[0] - b[0]);
    const actual = saved.affixes.map(affix => [affix.affixId, affix.tier, affix.roll]).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(actual, expected, `${slot} must retain every explicit affix and its actual tier`);
    assert.deepEqual(saved.implicitRolls, Array.from({ length: 3 }, (_, i) => maxRolls ? 255 : Math.round(planner.ir?.[i] ?? 128)), `${slot} implicit rolls`);
    if (saved.uniqueRolls) assert.deepEqual(saved.uniqueRolls, Array.from({ length: 8 }, (_, i) => maxRolls ? 255 : Math.round(planner.ur?.[i] ?? 128)), `${slot} unique rolls`);
  }
  assert.deepEqual(result.data.savedItems.find(item => Number(item.containerID) === 1), originalCharacter.data.savedItems[0]);
  assert.deepEqual([...flow.state.files.values()].map(entry => serializeSave(entry.original)), originals, 'original character and stash are immutable');
  assert.deepEqual(build, originalBuild, 'imported planner data is immutable');
});
