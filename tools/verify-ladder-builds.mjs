/** Read-only live-build compatibility audit. Never writes a source save or sends it over the network. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import LZString from 'lz-string';
import {stringify} from 'lossless-json';
import {fetchPlannerBuild,normalizePlannerBuild} from '../web/src/core/planner.js';
import {createWorkflow} from '../web/src/core/workflow.js';
import {parseSave,serializeSave} from '../web/src/core/save.js';
import {decodeSavedItem,encodeItemData,resolvePlannerItemId,EQUIPMENT_CONTAINERS,BLESSING_CONTAINERS} from '../web/src/core/items.js';
import catalog from '../web/src/core/game-item-data.json' with {type:'json'};
const arg=name=>process.argv[process.argv.indexOf(name)+1];
for(const required of ['--manifest','--character','--cache','--out'])if(!process.argv.includes(required))throw Error(`Missing ${required}`);
const manifest=JSON.parse(readFileSync(arg('--manifest'),'utf8'));
assert.equal(manifest.profiles.length,20,'Exactly the requested top 20 must be included');
assert.deepEqual(manifest.profiles.map(p=>p.rank),Array.from({length:20},(_,i)=>i+1));
const cache=resolve(arg('--cache')),out=resolve(arg('--out'));mkdirSync(cache,{recursive:true});mkdirSync(out,{recursive:true});
const sourceText=readFileSync(arg('--character'),'utf8'), source=parseSave(sourceText,basename(arg('--character')));
const replaced=new Set([...Object.values(EQUIPMENT_CONTAINERS),29,...BLESSING_CONTAINERS]);
const untouched=items=>items.filter(item=>!replaced.has(Number(item.containerID)));
const roll=(value,max)=>max?255:Math.round(value??128);
const nodes=selected=>Object.entries(selected).filter(([,v])=>Number(v)>0).map(([id,v])=>[Number(id),Number(v)]).sort((a,b)=>a[0]-b[0]);
const expectedAffix=(a,max)=>({affixId:Number(LZString.decompressFromBase64(a.id.slice(1))),tier:Number(a.tier),roll:roll(a.r,max)});
function records(build){
 const data=build.data,list=[];
 for(const [slot,id]of Object.entries(EQUIPMENT_CONTAINERS))if(data.equipment[slot]?.id)list.push({container:id,source:data.equipment[slot]});
 for(const item of data.idols){const identity=resolvePlannerItemId(item.id);const height=catalog.bases[identity.baseTypeId].size[1];list.push({container:29,source:item,x:item.x-1,y:6-item.y-height});}
 for(const [timeline,item]of Object.entries(data.blessings??{})){const record=typeof item==='string'?{id:item}:item;if(record?.id)list.push({container:BLESSING_CONTAINERS[Number(timeline)-1],source:record});}
 return list;
}
async function verify(build,maxRolls){
 const flow=createWorkflow({fetchBuild:async()=>build});assert.equal(await flow.importBuild(build.sourceUrl),true);
 assert.equal(await flow.addFiles([{name:source.name,size:sourceText.length,text:async()=>sourceText}]),true);flow.setOption('maxRolls',maxRolls);
 assert.equal(flow.synchronize(),true,flow.state.error?.message);assert.equal(flow.prepareReview(),true,flow.state.error?.message);
 assert.throws(()=>flow.downloads(),{code:'REVIEW_REQUIRED'});flow.state.acknowledged=true;
 const downloads=flow.downloads();assert.equal(downloads.length,1);assert.equal(downloads[0].name,source.outputName);
 const result=parseSave(downloads[0].text,downloads[0].name).data;
 assert.equal(serializeSave([...flow.state.files.values()][0].original),sourceText,'Source copy changed');
 const allowed=new Set(['level','currentExp','characterClass','chosenMastery','originalMastery','savedItems','savedCharacterTree','characterTreeNodeProgression','savedSkillTrees','abilityBar']);
 for(const key of Object.keys(source.data))if(!allowed.has(key))assert.equal(stringify(result[key]),stringify(source.data[key]),`Unexpected root change: ${key}`);
 assert.equal(stringify(untouched(result.savedItems)),stringify(untouched(source.data.savedItems)),'Inventory changed');
 for(const [field,expected]of Object.entries({level:build.data.bio.level,characterClass:build.data.bio.characterClass,chosenMastery:build.data.bio.chosenMastery}))assert.equal(Number(result[field]),Number(expected),field);
 assert.deepEqual(result.abilityBar,build.data.hud);
 assert.deepEqual(result.savedCharacterTree.nodeIDs.map((id,i)=>[Number(id),Number(result.savedCharacterTree.nodePoints[i])]).sort((a,b)=>a[0]-b[0]),nodes(build.data.charTree.selected));
 assert.equal(result.savedSkillTrees.length,build.data.skillTrees.length);
 for(const tree of build.data.skillTrees){const saved=result.savedSkillTrees.find(t=>t.treeID===tree.treeID);assert.ok(saved);assert.deepEqual(saved.nodeIDs.map((id,i)=>[Number(id),Number(saved.nodePoints[i])]).sort((a,b)=>a[0]-b[0]),nodes(tree.selected));assert.ok(Number(saved.unspentPoints)>=0);}
 const expectedRecords=records(build),actual=result.savedItems.filter(item=>replaced.has(Number(item.containerID)));
 assert.equal(actual.length,expectedRecords.length,'Generated item count mismatch');
 const ids=new Set();let merchantItems=0,corruptedItems=0;
 for(const expected of expectedRecords){
  const item=actual.find(item=>Number(item.containerID)===expected.container&&(expected.container!==29||(Number(item.inventoryPosition.x)===expected.x&&Number(item.inventoryPosition.y)===expected.y)));
  assert.ok(item,'Missing synchronized item');const decoded=decodeSavedItem(item);assert.equal(decoded.supported,true);assert.deepEqual(encodeItemData(decoded),item.data.map(Number));
  assert.ok(!ids.has(decoded.individualId),'Duplicate generated identity');ids.add(decoded.individualId);
  const record=expected.source,identity=resolvePlannerItemId(record.id);assert.equal(decoded.baseTypeId,identity.baseTypeId);assert.equal(decoded.subTypeId,identity.subTypeId);assert.equal(decoded.uniqueId,identity.uniqueId);
  assert.ok(decoded.flags&128,'Generated item is tradeable');
  const faction=record.faction??[0,0];const expectedRequirement=faction[0]===1?0:faction[1];assert.equal(decoded.flags&79,expectedRequirement,'Offline faction restriction mismatch');if(faction[0]===1)merchantItems++;
  const corrupted=Boolean(record.corrupted||record.corruptedAffix||catalog.bases[identity.baseTypeId].subtypes[identity.subTypeId].corrupted||catalog.uniques[identity.uniqueId]?.preCorrupted);
  assert.equal(Boolean(decoded.flags&16),corrupted);if(corrupted)corruptedItems++;
  assert.equal(Boolean(decoded.flags&32),Boolean(record.ruined));assert.equal(decoded.duplicated,Boolean(record.duplicated));
  assert.deepEqual(decoded.implicitRolls,Array.from({length:3},(_,i)=>roll(record.ir?.[i],maxRolls)));
  if(identity.uniqueId!=null)assert.deepEqual(decoded.uniqueRolls,Array.from({length:8},(_,i)=>roll(record.ur?.[i],maxRolls)));
  const affixes=identity.uniqueId!=null?[record.sealedAffix,record.primordialAffix,...(record.affixes??[]),record.corruptedAffix]:[record.sealedAffix,record.corruptedAffix,record.primordialAffix,...(record.affixes??[])];
  assert.deepEqual(decoded.affixes,affixes.filter(Boolean).map(a=>expectedAffix(a,maxRolls)),'Affix ID/tier/roll mismatch');
  if(identity.uniqueId!=null&&record.corruptedAffix)assert.ok(decoded.extraFlags&128,'Missing native corruption seal flag');
 }
 return {status:'PASS',items:actual.length,merchantItems,corruptedItems,warnings:flow.state.warnings.length};
}
const results=[];
for(const profile of manifest.profiles){
 let build;
 try{
  if(process.argv.includes('--refresh'))build=await fetchPlannerBuild(profile.plannerUrl);
  else if(existsSync(join(cache,profile.buildId+'.json')))build=normalizePlannerBuild(JSON.parse(readFileSync(join(cache,profile.buildId+'.json'),'utf8')));
  else if(existsSync(join(cache,profile.buildId+'.raw.json')))build=normalizePlannerBuild(JSON.parse(readFileSync(join(cache,profile.buildId+'.raw.json'),'utf8')));
  else build=await fetchPlannerBuild(profile.plannerUrl);
  build.sourceUrl=profile.plannerUrl;writeFileSync(join(cache,profile.buildId+'.json'),JSON.stringify(build));
 }catch(error){results.push({...profile,status:'SOURCE_UNAVAILABLE',error:{code:error.code??error.name,message:error.message}});console.log(profile.rank,profile.name,'SOURCE_UNAVAILABLE',error.code);continue;}
 const modes={};for(const [name,max]of [['normal',false],['maxRolls',true]])try{modes[name]=await verify(build,max);}catch(error){modes[name]={status:'FAIL',code:error.code??error.name,message:error.message};}
 const result={...profile,status:Object.values(modes).every(m=>m.status==='PASS')?'PASS':'FAIL',dataVersion:build.dataVersion,modes};results.push(result);console.log(profile.rank,profile.name,result.status,JSON.stringify(modes));
}
assert.equal(readFileSync(arg('--character'),'utf8'),sourceText,'Source backup file changed');
const passed=results.filter(r=>r.status==='PASS'),unavailable=results.filter(r=>r.status==='SOURCE_UNAVAILABLE');
const report={capturedAt:manifest.capturedAt,verifiedAt:new Date().toISOString(),source:manifest.source,season:manifest.season,type:manifest.type,mode:manifest.mode,gameVersion:catalog.gameVersion,
 scope:'In-memory conversion and native-file verification. No in-game loading performed. Source backup was not modified or uploaded.',
 totals:{requested:20,passed:passed.length,sourceUnavailable:unavailable.length,failed:results.filter(r=>r.status==='FAIL').length,successfulConversions:passed.length*2,itemsPerMode:passed.reduce((n,r)=>n+r.modes.normal.items,0),merchantItemsPerMode:passed.reduce((n,r)=>n+r.modes.normal.merchantItems,0)},results};
writeFileSync(join(out,'ladder-20-results.json'),JSON.stringify(report,null,2));
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
writeFileSync(join(out,'ladder-20-results.csv'),'\ufeff'+[['名次','角色','职业','结果','原始Roll','最大Roll','物品数','商人限制清除','配装链接','备注'],...results.map(r=>[r.rank,r.name,r.className,r.status,r.modes?.normal.status,r.modes?.maxRolls.status,r.modes?.normal.items,r.modes?.normal.merchantItems,r.plannerUrl,r.error?.message??''])].map(row=>row.map(csv).join(',')).join('\r\n'));
console.log('TOTAL',JSON.stringify(report.totals));if(report.totals.failed)process.exitCode=1;
