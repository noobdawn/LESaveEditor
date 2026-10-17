import { cloneSaveData, parseSave, serializeSave } from './save.js';
import questData from '../data/campaign-data.json' with { type: 'json' };

export class ModeError extends Error {
  constructor(code, zh, en) { super(zh); this.code=code; this.messageEn=en; }
}
const fail=(code,zh,en)=>{throw new ModeError(code,zh,en);};
const object=v=>v!=null&&typeof v==='object'&&!Array.isArray(v);
const num=v=>Number(String(v));
const integer=v=>v!=null&&typeof v!=='boolean'&&/^(0|[1-9]\d*)$/.test(String(v))&&Number.isSafeInteger(num(v));
const isQuestCompleted=q=>questData.steps[String(q?.questStepID)]?.[0]===num(q?.questID)&&questData.steps[String(q?.questStepID)]?.[1]===2;
const array=(parent,key)=>{
  if(parent[key]==null)parent[key]=[];
  if(!Array.isArray(parent[key]))fail('MODE_STASH_FORMAT',`仓库字段 ${key} 无法合并。`,`Stash field ${key} cannot be merged.`);
  return parent[key];
};

/** Pinned GetLifeState 0x1C4A8A0 / offline GetStashType 0x2869C90. */
export function getCharacterMode(character) {
  const data=character?.data??character;
  if(!data||typeof data.hardcore!=='boolean'||!integer(data.cycle)||!integer(data.deaths??0))return null;
  if(['soloChallenge','soloCharacterChallenge'].some(k=>data[k]!=null&&typeof data[k]!=='boolean'))return null;
  return {hardcore:data.hardcore&&num(data.deaths??0)===0,solo:!!(data.soloCharacterChallenge||data.soloChallenge),deaths:num(data.deaths??0),cycle:num(data.cycle),characterId:String(data.id??character?.outputName?.match(/_(\d+)$/)?.[1]??'')};
}
export function modeStashName(character, target=null) {
  const mode=getCharacterMode(character);
  if(!mode)return null;
  const m=target??mode;
  if(typeof m.hardcore!=='boolean'||typeof m.solo!=='boolean')return null;
  const type=m.solo?2:m.hardcore?1:0;
  if(type===2&&!/^\d+$/.test(mode.characterId))return null;
  return `${mode.cycle>=2?`STASH_CYCLE_${mode.cycle}`:'STASH'}_${type}${type===2?`_${mode.characterId}`:''}`;
}
export function currentStash(documents) {
  const c=documents.find(d=>d.kind==='character'),name=modeStashName(c);
  return documents.find(d=>d.kind==='stash'&&d.outputName.toUpperCase()===name);
}
export function validateWorldFiles(documents, requireCharacter=false) {
  const chars=documents.filter(d=>d.kind==='character'),globals=documents.filter(d=>d.kind==='global');
  if(chars.length>1||globals.length>1||documents.length>256)fail('WORLD_FILE_SET','请载入一名角色、相关仓库／仓库页及最多一份全局索引。','Load one character, related stashes/tabs and at most one global index.');
  if(requireCharacter&&!chars.length)fail('NEED_CHARACTER','请上传角色存档文件。','Upload a character save.');
  const c=chars[0],mode=c&&getCharacterMode(c);
  if(c&&!mode)fail('MODE_CHARACTER_FORMAT','无法识别此角色的游戏模式字段。','Cannot identify this character’s game mode fields.');
  for(const doc of documents){
    if(doc.kind==='stash'){
      if(!/^STASH(?:_CYCLE_\d+)?_[012](?:_\d+)?$/.test(doc.outputName.toUpperCase())||(c&&String(doc.data.cycle)!==String(c.data.cycle)))fail('MODE_STASH_CYCLE','只能上传此角色同赛季的普通、专家或独立仓库。','Upload normal, hardcore or character-found stashes from this character’s season only.');
      if(doc.data.id!=null&&String(doc.data.id)!==doc.outputName)fail('MODE_STASH_ID','仓库内部身份与文件名不一致。','Stash identity does not match its filename.');
      const match=doc.outputName.match(/^STASH(?:_CYCLE_\d+)?_([012])(?:_(\d+))?$/);
      if(match&&doc.data.removeOnly!==true&&doc.data.stashType!=null&&String(doc.data.stashType)!==match[1])fail('MODE_STASH_ID','仓库模式标记与文件名不一致。','Stash mode metadata does not match its filename.');
      if(match?.[1]==='2'&&doc.data.soloChallengeCharacterId!=null&&String(doc.data.soloChallengeCharacterId)!==match[2])fail('MODE_STASH_ID','独立仓库归属与文件名不一致。','Independent stash owner does not match its filename.');
    }
    if(doc.kind==='stashTab'&&doc.data.id!=null&&String(doc.data.id)!==doc.outputName)fail('MODE_STASH_ID','仓库页内部身份与文件名不一致。','Stash tab identity does not match its filename.');
  }
  const owners=new Set(documents.filter(d=>d.kind!=='character'&&d.data.partitionKey!=null).map(d=>String(d.data.partitionKey)));
  if(owners.size>1)fail('MODE_STASH_OWNER','仓库与全局索引来自不同账户，不能混用。','Stashes and the global index belong to different accounts.');
}
function makeDocument(name,data){return parseSave(serializeSave(data),name);}
function makeStash(character,source,global,name,target){
  const sourceData=source.data, c=character.data;
  const data={id:name,cycle:num(c.cycle),latestCycle:sourceData.latestCycle??num(c.cycle),stashType:target.solo?2:target.hardcore?1:0,
    soloChallengeCharacterId:target.solo?getCharacterMode(character).characterId:'',soloChallengeStashName:target.solo?String(c.characterName):'',
    gold:0,ancientBones:0,tabsv2:[`${name}_TAB_0`],retiredStashes:[],retiredStashesData:[],categories:[{categoryId:0,iconId:0,colorId:0,displayName:'通用',displayOrder:0,folderPriority:null,dirty:true}],
    stashTabsCreated:1,removeOnly:false,savedShards:[],savedResonances:[],materialsList:[],keysList:[],wovenEchoesList:[],unlockedBlessings:[],factions:{},
    anyFactionJoinedBefore:false,craftingIsLocked:false,completedCraftingTutorial:false,highestCorruption:0,keysTabUnlocked:false,wovenEchoesTabUnlocked:false,giftingTabUnlocked:false,
    monolithTimelineBranchCompletion:[],monolithTimelineDifficultyCompletion:[],monolithTimelineUnlock:[],optionalChaptersCompleted:[],isTimelineProgressionPointsThresholdReached:false,
    savedQuests:[],dungeonCompletion:[],tabs:[],savedStashItems:[],affixesCleanupDone:true,seqNo:0,version:sourceData.version??0,_etag:null};
  if(global.data.partitionKey!=null)data.partitionKey=global.data.partitionKey;
  const tab={id:`${name}_TAB_0`,tabId:0,displayOrder:0,categoryId:0,iconId:0,colorId:0,displayName:'仓库页1',tabPriority:null,ignoreFolderPriority:false,savedItems:[],seqNo:0,version:0,_etag:null};
  if(global.data.partitionKey!=null)tab.partitionKey=global.data.partitionKey;
  return [makeDocument(name,data),makeDocument(tab.id,tab)];
}
function add(a,b){
  if(!integer(a??0)||!integer(b??0))fail('MODE_RESOURCE_FORMAT','资源数量格式无效，未执行合并。','Invalid resource quantity; merge was not applied.');
  const sum=BigInt(String(a??0))+BigInt(String(b??0));
  if(sum>2147483647n)fail('MODE_RESOURCE_OVERFLOW','合并后的资源数量超过游戏上限。','Merged resource quantity exceeds the game limit.');
  return Number(sum);
}
function mergeResources(source,target){
  for(const key of ['gold','ancientBones']){if(source[key]!=null){target[key]=add(source[key],target[key]);source[key]=0;}}
  const specifications={savedShards:r=>String(r.shardType),materialsList:resourceKey,keysList:resourceKey,wovenEchoesList:resourceKey};
  for(const [key,identity] of Object.entries(specifications)){
    const from=array(source,key),to=array(target,key),map=new Map();
    for(const item of to){if(!integer(item.quantity)||(key==='savedShards'&&!integer(item.shardType)))fail('MODE_RESOURCE_FORMAT','目标资源数量或身份无效。','Invalid target resource quantity or identity.');const id=identity(item);if(map.has(id))fail('MODE_RESOURCE_FORMAT','目标仓库存在重复资源记录。','Duplicate resource records in the target stash.');map.set(id,item);}
    const seen=new Set();
    for(const item of from){
      if(!integer(item.quantity)||(key==='savedShards'&&!integer(item.shardType)))fail('MODE_RESOURCE_FORMAT','源资源数量或身份无效。','Invalid source resource quantity or identity.');
      const id=identity(item);if(seen.has(id))fail('MODE_RESOURCE_FORMAT','源仓库存在重复资源记录。','Duplicate resource records in the source stash.');seen.add(id);
      const existing=map.get(id);
      if(existing)existing.quantity=add(existing.quantity,item.quantity);
      else{add(item.quantity,0);const copy=cloneSaveData(item);to.push(copy);map.set(id,copy);}
    }
    source[key]=[];
  }
  // Resonances are sender/recipient-specific; keep their exact records in the
  // retired stash rather than inventing an identity or duplicating them.
}
function resourceKey(item){
  if(!Array.isArray(item?.data)||![7,8].includes(item.data.length)||num(item.data[0])!==6||item.data.some(v=>!integer(v)||num(v)>255))fail('MODE_RESOURCE_FORMAT','资源字节格式尚未验证。','Unverified resource byte format.');
  const base=num(item.data[5]);
  if(!([102,103,104].includes(base)&&item.data.length===7)&&!(base===107&&item.data.length===8))fail('MODE_RESOURCE_FORMAT','此资源类型尚未验证合并。','Merging this resource type is not verified.');
  return item.data.slice(5).map(String).join(':');
}
function mergeProgress(source,target){
  for(const key of ['unlockedBlessings','optionalChaptersCompleted'])for(const value of array(source,key))if(!array(target,key).some(v=>String(v)===String(value)))target[key].push(cloneSaveData(value));
  for(const key of ['monolithTimelineBranchCompletion','monolithTimelineDifficultyCompletion','monolithTimelineUnlock']){
    const from=array(source,key),to=array(target,key);
    for(let i=0;i<from.length;i++){
      if(!Array.isArray(from[i]))fail('MODE_STASH_FORMAT','世界线进度格式无效。','Invalid timeline progression format.');
      while(to.length<=i)to.push([]);
      if(!Array.isArray(to[i]))fail('MODE_STASH_FORMAT','目标世界线进度格式无效。','Invalid target timeline progression format.');
      for(const value of from[i])if(!to[i].some(v=>String(v)===String(value)))to[i].push(cloneSaveData(value));
    }
  }
  for(const key of ['highestCorruption'])if(source[key]!=null){if(!integer(source[key])||!integer(target[key]??0))fail('MODE_STASH_FORMAT','最高腐化记录格式无效。','Invalid highest corruption record.');target[key]=Math.max(num(source[key]),num(target[key]??0));}
  for(const key of ['keysTabUnlocked','wovenEchoesTabUnlocked','giftingTabUnlocked','isTimelineProgressionPointsThresholdReached'])if(source[key]===true)target[key]=true;
  for(const entry of array(source,'dungeonCompletion')){
    if(!object(entry)||!integer(entry.dungeonID)||!Array.isArray(entry.tiersCompleted)||entry.tiersCompleted.some(v=>!integer(v)||num(v)>3))fail('MODE_STASH_FORMAT','地下城进度格式无效。','Invalid dungeon completion format.');
    let other=array(target,'dungeonCompletion').find(d=>String(d.dungeonID)===String(entry.dungeonID));
    if(!other){other=cloneSaveData(entry);target.dungeonCompletion.push(other);}else{
      if(!Array.isArray(other.tiersCompleted))fail('MODE_STASH_FORMAT','目标地下城进度格式无效。','Invalid target dungeon completion format.');
      for(const tier of entry.tiersCompleted)if(!other.tiersCompleted.some(v=>String(v)===String(tier)))other.tiersCompleted.push(cloneSaveData(tier));
    }
  }
  const quests=array(target,'savedQuests');
  for(const quest of array(source,'savedQuests')){
    if(!object(quest)||!integer(quest.questID))fail('MODE_STASH_FORMAT','仓库任务格式无效。','Invalid stash quest format.');
    const i=quests.findIndex(q=>String(q.questID)===String(quest.questID));
    if(i<0)quests.push(cloneSaveData(quest));
    else if(isQuestCompleted(quest)&&!isQuestCompleted(quests[i]))quests[i]=cloneSaveData(quest);
  }
}

/** Mode changes operate on uploaded documents only; no live filesystem writes. */
export function applyModeChange(documents,draft=null){
  validateWorldFiles(documents,true);
  const character=documents.find(d=>d.kind==='character'),before=getCharacterMode(character);
  if(!draft)return {documents,migration:null};
  if(typeof draft.hardcore!=='boolean'||typeof draft.solo!=='boolean'||typeof draft.merge!=='boolean'||typeof draft.createTarget!=='boolean')fail('INVALID_MODE','游戏模式选项无效。','Invalid game mode options.');
  const from=modeStashName(character),to=modeStashName(character,draft);
  if(before.hardcore===draft.hardcore&&before.solo===draft.solo)return {documents,migration:null};
  if(!to)fail('MODE_CHARACTER_FORMAT','角色缺少独立仓库所需的身份。','Character identity required for an independent stash is missing.');
  const originals=documents;
  const result=documents.map(d=>({...d,data:cloneSaveData(d.data)}));
  const c=result.find(d=>d.kind==='character'),source=result.find(d=>d.kind==='stash'&&d.outputName===from);
  let target=result.find(d=>d.kind==='stash'&&d.outputName===to);
  if(!source)fail('MODE_SOURCE_STASH',`请上传当前仓库：${from}。`,`Upload the current stash: ${from}.`);
  if(source.data.removeOnly)fail('MODE_RETIRED_STASH','当前仓库已是只取出仓库，无法作为模式切换来源。','A retired stash cannot be used as the current mode source.');
  if(target?.data.removeOnly)fail('MODE_RETIRED_STASH','目标独立仓库已归档，不能直接重新启用，以免重复资源或覆盖旧页。','The target stash is retired and cannot be reactivated safely.');
  let global=result.find(d=>d.kind==='global'),created=false;
  if(global&&(global.outputName!=='Epoch_Local_Global_Data_Beta'||!Array.isArray(global.data.stashes)||global.data.stashes.some(v=>typeof v!=='string')))fail('MODE_GLOBAL_FORMAT','需要当前离线版本的 Epoch_Local_Global_Data_Beta 仓库索引。','The current offline Epoch_Local_Global_Data_Beta stash index is required.');
  if(!target){
    if(!draft.createTarget)fail('MODE_TARGET_STASH',`请上传目标仓库 ${to}，或确认新建空仓库。`,`Upload target stash ${to}, or confirm creation of an empty stash.`);
    if(!global)fail('MODE_GLOBAL_REQUIRED','新建仓库需要上传 Epoch_Local_Global_Data_Beta 全局索引。','Creating a stash requires the Epoch_Local_Global_Data_Beta index.');
    if(!Array.isArray(global.data.stashes)||global.data.stashes.some(v=>typeof v!=='string'))fail('MODE_GLOBAL_FORMAT','全局仓库索引格式无效。','Invalid global stash index.');
    if(global.data.stashes.includes(to)||result.some(d=>d.kind==='stash'&&(d.data.retiredStashes??[]).includes(to))||result.some(d=>d.outputName===`${to}_TAB_0`))fail('MODE_TARGET_EXISTS','索引中已存在目标仓库，请上传该仓库，不可新建覆盖。','The target stash already exists in the index; upload it instead of creating a replacement.');
    const generated=makeStash(c,source,global,to,draft);result.push(...generated);target=generated[0];created=true;
    global.data.stashes.push(to);
  }
  if(!target||String(target.data.cycle)!==String(c.data.cycle))fail('MODE_STASH_CYCLE','目标仓库不属于此角色的赛季。','The target stash belongs to a different season.');
  const merge=draft.merge&&!draft.solo;
  if(draft.merge&&draft.solo)fail('MODE_SPLIT_POLICY','进入单人挑战只新建或使用独立仓库，不迁移共享仓库。','Entering character-found mode does not move the shared stash.');
  if(merge){
    if(!before.solo)fail('MODE_MERGE_SOURCE','只有退出单人挑战时才能合并独立仓库。','Only an independent stash can be merged when leaving character-found mode.');
    if(!global)fail('MODE_GLOBAL_REQUIRED','合并仓库需要上传 Epoch_Local_Global_Data_Beta 全局索引。','Stash merging requires the Epoch_Local_Global_Data_Beta index.');
    if(!Array.isArray(global.data.stashes)||!global.data.stashes.includes(from))fail('MODE_GLOBAL_FORMAT','全局索引缺少当前独立仓库，无法安全归档。','The global index does not include the source independent stash.');
    if(!Array.isArray(source.data.tabsv2)||source.data.tabsv2.some(v=>typeof v!=='string'||!v.startsWith(`${from}_TAB_`)))fail('MODE_STASH_FORMAT','源仓库页索引格式无效。','Invalid source stash tab index.');
    if(new Set(source.data.tabsv2).size!==source.data.tabsv2.length)fail('MODE_STASH_FORMAT','源仓库页索引重复。','Duplicate source stash tab references.');
    for(const name of source.data.tabsv2)if(!result.some(d=>d.kind==='stashTab'&&d.outputName===name))fail('MODE_MISSING_TABS',`请同时上传源仓库页：${name}。`,`Also upload source stash tab: ${name}.`);
    if(array(target.data,'retiredStashes').includes(from))fail('MODE_ALREADY_MERGED','目标仓库已经关联此独立仓库，不能再次合并。','The target already includes this independent stash; it cannot be merged twice.');
    if(array(source.data,'retiredStashes').length)fail('MODE_NESTED_STASH','源仓库包含其他归档仓库，请先在游戏中处理后再合并。','Resolve nested retired stashes in the game before merging.');
    mergeResources(source.data,target.data);mergeProgress(source.data,target.data);
    target.data.retiredStashes.push(from);
    // Native RetireStash (0x286B070): source stays readable with its own tab IDs;
    // faction-specific progress remains attached as unmerged data for game UI.
    const factions=Object.keys(source.data.factions??{});
    if(factions.some(id=>!/^\d+$/.test(id)||num(id)>3))fail('MODE_FACTION_FORMAT','源仓库包含未知阵营，无法安全归档。','The source stash contains an unknown faction.');
    array(target.data,'retiredStashesData').push({stashId:from,cycle:num(c.data.cycle),unmergedFactions:factions.map(Number),scfCharacterName:String(c.data.characterName)});
    source.data.removeOnly=true;
    source.data.stashType=target.data.stashType??(draft.hardcore?1:0);
    global.data.stashes=global.data.stashes.filter(name=>name!==from);
    if(!global.data.stashes.includes(to))global.data.stashes.push(to);
  }
  c.data.hardcore=draft.hardcore;
  if(draft.hardcore&&!before.hardcore){c.data.deaths=0;c.data.died=false;}
  c.data.soloChallenge=false;c.data.soloCharacterChallenge=draft.solo;
  // Membership remains the character's choice; shared rank/progress follows the
  // destination stash. Source faction data stays available in the retired stash.
  for(const [id,faction] of Object.entries(c.data.factions??{})){
    const destination=target.data.factions?.[id];
    for(const key of ['rank','reputation','favor'])faction[key]=destination?.[key]??0;
  }
  for(const doc of result)serializeSave(doc);
  return {documents:result,migration:{from,to,created,merge,resetDeaths:draft.hardcore&&!before.hardcore,createdFiles:result.filter(d=>!originals.some(o=>o.outputName===d.outputName)).map(d=>d.outputName)}};
}
