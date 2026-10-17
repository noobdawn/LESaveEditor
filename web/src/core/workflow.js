import { parseSave, serializeSave, diffSave } from './save.js';
import { fetchPlannerBuild, applyPlannerBuild } from './planner.js';
import { applyCampaignSkip } from './campaign.js';
import { applyEndgameSkip } from './endgame.js';
import { applyWorldEdits, validateCompanion, WorldError } from './world.js';
import { applyModeChange, validateWorldFiles } from './modes.js';

export const SYNC_OPTIONS = ['equipment', 'idols', 'blessings', 'passives', 'skills', 'skillBar'];
const fail = (code, zh, en) => { throw new WorldError(code, zh, en); };
function validateFiles(files, requireCharacter = false, route = 'sync') {
  const docs = [...files.values()].map(entry => entry.original);
  if (route === 'world') { validateWorldFiles(docs, requireCharacter); return { character: docs.find(d=>d.kind==='character') }; }
  const characters = docs.filter(doc => doc.kind === 'character');
  const stashes = docs.filter(doc => doc.kind === 'stash');
  if (characters.length > 1 || stashes.length > 1 || docs.some(doc => !['character', 'stash'].includes(doc.kind))) {
    fail('FILE_SET', '每次请载入一名角色，以及可选的同赛季仓库文件。', 'Load one character and, optionally, its matching season stash.');
  }
  if (requireCharacter && !characters.length) fail('NEED_CHARACTER', '请上传角色存档文件。', 'Upload a character save.');
  if (characters.length && stashes.length) validateCompanion(characters[0], stashes[0]);
  return { character: characters[0], stash: stashes[0] };
}

/** A five-step session. Originals are immutable; every synchronization starts from them. */
export function createWorkflow({ fetchBuild = fetchPlannerBuild } = {}) {
  const state = { step: 0, route: 'sync', modeDraft: null, migration: null, build: null, buildUrl: '', loading: false, readingFiles: false, error: null,
    options: { ...Object.fromEntries(SYNC_OPTIONS.map(key => [key, true])), maxRolls: false, campaignSkip: false, endgameSkip: false },
    files: new Map(), synced: [], result: [], warnings: [], worldEdits: new Map(), acknowledged: false,
  };
  let request;
  let fileRead;
  let modeCache;
  function invalidate() { state.synced = []; state.result = []; state.acknowledged = false; state.migration=null; modeCache=null; }
  const api = {
    state,
    startWorldEdit() {
      if(state.readingFiles)return false;
      request?.abort();request=null;state.loading=false;
      state.route='world';state.modeDraft=null;state.files=new Map();state.worldEdits.clear();invalidate();state.error=null;state.step=2;
      state.options.campaignSkip=false;state.options.endgameSkip=false;
      return true;
    },
    setMode(draft) {
      if(state.route!=='world'||state.loading||state.readingFiles)return;
      state.modeDraft=draft?{...draft}:null;modeCache=null;state.migration=null;state.result=[];state.worldEdits.clear();state.acknowledged=false;state.error=null;
    },
    previewMode() {
      if(state.route!=='world')return {documents:state.synced,migration:null};
      if(!modeCache){try{modeCache=applyModeChange(state.synced,state.modeDraft);}catch(error){modeCache={documents:state.synced,migration:null,error};}}
      return modeCache;
    },
    async importBuild(url) {
      if(state.route==='world'){state.files=new Map();state.worldEdits.clear();state.modeDraft=null;}
      state.route='sync';
      request?.abort();
      const controller = new AbortController(); request = controller;
      state.loading = true; state.buildUrl = url.trim(); state.build = null; state.error = null; invalidate();
      try {
        const build = await fetchBuild(url, { signal: controller.signal });
        if (request !== controller) return false;
        state.build = build; state.step = 1;
        return true;
      } catch (error) {
        if (request === controller) state.error = error;
        return false;
      } finally {
        if (request === controller) { state.loading = false; request = null; }
      }
    },
    setOption(key, value) {
      if (![...SYNC_OPTIONS, 'maxRolls', 'campaignSkip', 'endgameSkip'].includes(key) || typeof value !== 'boolean') return;
      if (key === 'endgameSkip' && value && !state.options.campaignSkip) return;
      if (key === 'campaignSkip' && !value) state.options.endgameSkip = false;
      if (['campaignSkip', 'endgameSkip'].includes(key)) state.worldEdits.clear();
      state.options[key] = value; invalidate(); state.error = null;
    },
    async addFiles(incoming) {
      if (state.readingFiles) return false;
      const token = {}; fileRead = token;
      state.readingFiles = true; state.error = null;
      try {
        const files = Array.from(incoming);
        if (!files.length) return false;
        if (files.length > (state.route==='world'?256:2)) fail('FILE_SET', '所选文件数量超过此流程上限。', 'Too many files for this workflow.');
        const next = new Map(state.files);
        for (const file of files) {
          if (file.size > 32 * 1024 * 1024) fail('FILE_TOO_LARGE', '单个文件不能超过 32 MB。', 'Each file must be at most 32 MB.');
          const original = parseSave(await file.text(), file.name);
          if (fileRead !== token) return false;
          if ([...next.values()].some(entry => entry.original.outputName.toLowerCase() === original.outputName.toLowerCase())) fail('DUPLICATE_FILE', '此存档已载入，请先移除旧文件。', 'This save is already loaded. Remove it before replacing it.');
          next.set(original.name, { original });
        }
        if([...next.values()].reduce((sum,{original})=>sum+original.originalText.length,0)>256*1024*1024)fail('FILE_SET','载入文件总量不能超过 256 MB。','Loaded files must total no more than 256 MB.');
        validateFiles(next,false,state.route);
        state.files = next; state.worldEdits.clear(); invalidate();
        return true;
      } catch (error) { state.error = error; return false; }
      finally { if (fileRead === token) { state.readingFiles = false; fileRead = null; } }
    },
    removeFile(name) { if (state.readingFiles) return; state.files.delete(name); state.worldEdits.clear(); invalidate(); state.error = null; },
    synchronize() {
      state.error = null;
      try {
        if (state.loading || state.readingFiles) fail('BUSY', '请等待读取完成。', 'Wait for the current read to finish.');
        if (state.route==='world') {
          validateFiles(state.files,true,'world');
          state.synced=[...state.files.values()].map(({original})=>original);modeCache=null;state.result=[];state.migration=null;state.acknowledged=false;state.step=3;return true;
        }
        if (!state.build) fail('NEED_BUILD', '请先读取配装链接。', 'Load a build URL first.');
        const { character } = validateFiles(state.files, true);
        if (state.options.endgameSkip && !state.options.campaignSkip) fail('ENDGAME_REQUIRES_CAMPAIGN', '请先开启“速通至异界”。', 'Enable campaign skip before endgame skip.');
        // These three character settings are mandatory in this workflow.
        const options = { ...state.options, class: true, level: true, weaverTree: false };
        // Quest rewards must exist before the planner validates its passive budget.
        const input = options.campaignSkip ? applyCampaignSkip(character.data).data : character.data;
        const applied = applyPlannerBuild(input, state.build, options);
        const documents = [...state.files.values()].map(({ original }) => original.name === character.name ? { ...original, data: applied.data } : original);
        state.synced = options.endgameSkip ? applyEndgameSkip(documents) : documents;
        modeCache=null;
        state.warnings = applied.warnings; state.result = []; state.acknowledged = false; state.step = 3;
        return true;
      } catch (error) { state.error = error; return false; }
    },
    setWorldEdit(edit) {
      const key = edit.kind === 'timeline' ? `timeline:${edit.index}:${edit.field}` : `faction:${edit.id}:${edit.field}`;
      state.worldEdits.set(key, { ...edit }); state.acknowledged = false; state.result = []; state.error = null;
    },
    prepareReview() {
      state.error = null;
      try {
        if (!state.synced.length) fail('NEED_SYNC', '请先完成存档同步。', 'Synchronize the save first.');
        const preview=api.previewMode();if(preview.error)throw preview.error;
        state.result = applyWorldEdits(preview.documents, [...state.worldEdits.values()]);state.migration=preview.migration;
        state.acknowledged = false; state.step = 4;
        return true;
      } catch (error) { state.error = error; return false; }
    },
    goBack(step = state.step - 1) {
      if(state.route==='world'&&step===1)step=0;
      if (state.loading || state.readingFiles || step < 0 || step >= state.step) return;
      state.step = step; state.error = null; state.acknowledged = false;
    },
    changedFiles() {
      return state.result.map(doc => {const original=state.files.get(doc.name)?.original;return {doc,original,changes:diffSave(original??{},doc)};}).filter(entry => entry.changes.length);
    },
    downloads() {
      if (state.step !== 4 || !state.acknowledged) fail('REVIEW_REQUIRED', '请先查看修改并确认我已了解。', 'Review the changes and acknowledge them first.');
      return api.changedFiles().map(({ doc }) => ({ name: doc.outputName, text: serializeSave(doc) }));
    },
  };
  return api;
}
