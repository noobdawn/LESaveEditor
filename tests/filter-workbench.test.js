import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import catalog from '../web/src/data/filter-catalog.json' with { type: 'json' };
import palette from '../web/src/data/filter-palette.json' with { type: 'json' };
import * as filterCore from '../web/src/core/value-filter.js';

const { createValueFilterDraft, generateValueFilter, createEquipmentScoreGroup, getEquipmentScoreThreshold, VALUE_FILTER_DEFAULT_SCORING, COMMON_AFFIX_GROUPS, VALUE_FILTER_GROUPS } = filterCore;
const build = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, token => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"})[token]);
function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match => [match[1],decode(match[2] ?? '')]));
}
// This harness interprets only controls; production rendering, handlers and generation run unchanged.
class Control {
  constructor(document, tag, attrs, content='') {
    this.document=document; this.attributes=attrs; this.tagName=tag.toUpperCase(); this.id=attrs.id;
    this.dataset=Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));
    this.value=attrs.value ?? ''; this.checked=Object.hasOwn(attrs,'checked'); this.disabled=Object.hasOwn(attrs,'disabled'); this.hidden=Object.hasOwn(attrs,'hidden'); this.open=Object.hasOwn(attrs,'open'); this.listeners={};
    const properties=new Map((attrs.style??'').split(';').filter(Boolean).map(entry=>entry.split(':').map(value=>value.trim())));
    this.style={setProperty:(name,value)=>properties.set(name,value),getPropertyValue:name=>properties.get(name)??''};
    this.classList={toggle:(name,on)=>{const names=new Set((attrs.class??'').split(' ').filter(Boolean));on?names.add(name):names.delete(name);attrs.class=[...names].join(' ');},contains:name=>(attrs.class??'').split(' ').includes(name)};
    if(tag==='select') { const options=[...content.matchAll(/<option\b([^>]*)>/g)].map(match=>attributes(match[1])); this.value=(options.find(option=>Object.hasOwn(option,'selected'))||options[0])?.value ?? ''; }
  }
  addEventListener(type,listener) { (this.listeners[type]??=[]).push(listener); }
  emit(type,value) {
    if(type==='click'&&this.disabled)return;
    if(value!==undefined)this.value=String(value);
    const event={target:this,currentTarget:this}; this[`on${type}`]?.(event);
    for(const listener of this.listeners[type]??[])listener(event);
  }
  scrollIntoView() {}
  focus() { this.document.activeElement=this; }
  set innerHTML(html) {
    assert.match(this.id,/^filter-results-/);
    const pool=this.id.slice('filter-results-'.length);
    this.document.controls=this.document.controls.filter(control=>control.dataset.filterPending!==pool);
    this.document.controls.push(...this.document.parse(html)); this.document.resultsHtml[pool]=html;
  }
}
class DocumentStub {
  controls=[]; resultsHtml={};
  parse(html) {
    return [...html.matchAll(/<(button|input|select|div|nav|p|span|details|output)\b([^>]*)>/g)].map(match=>{
      const attrs=attributes(match[2]);
      const content=match[1]==='select'?html.slice(match.index+match[0].length,html.indexOf('</select>',match.index)):'';
      return new Control(this,match[1],attrs,content);
    });
  }
  setHtml(html) { this.html=html; this.controls=this.parse(html); this.resultsHtml={}; this.renderCount=(this.renderCount??0)+1; this.activeElement=null; }
  querySelectorAll(selector) {
    if(selector.startsWith('#'))return this.controls.filter(control=>control.id===selector.slice(1));
    if(selector.startsWith('.'))return this.controls.filter(control=>(control.attributes.class??'').split(' ').includes(selector.slice(1)));
    const match=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/); assert.ok(match,`Unsupported selector: ${selector}`);
    return this.controls.filter(control=>Object.hasOwn(control.attributes,match[1])&&(match[2]===undefined||control.attributes[match[1]]===match[2]));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]??null; }
}
function workbench({step=1,language='zh',patch={},useDefaultScoring=false}={}) {
  // Keep HIDE interaction cases exactly representable; real default approximation has its own test.
  const scoring={high:Array(7).fill(10),medium:Array(7).fill(4),low:Array(7).fill(0)};
  const draft=createValueFilterDraft(build);
  if(!useDefaultScoring) {
    draft.scoring=scoring;
    draft.equipmentGroups=draft.equipmentGroups.map((group,index)=>({...group,threshold:[25,10,1][index],name:`${[25,10,1][index]}%`}));
  }
  Object.assign(draft,patch);
  const state={tab:'filterTab',filterDraft:draft,filterStep:step,filterDirty:false,language,build};
  const document=new DocumentStub(), downloads=[], notices=[];
  const context=vm.createContext({...filterCore,catalog,palette,document,structuredClone});
  const source=readFileSync(new URL('../web/src/filter-workbench.js',import.meta.url),'utf8').replace(/^import[^\n]*\r?\n/gm,'').replace(/^export\s+/gm,'');
  vm.runInContext(source+'\nglobalThis.api={renderFilterWorkbench,bindFilterWorkbench};',context,{filename:'filter-workbench.js'});
  const render=()=>{document.setHtml(context.api.renderFilterWorkbench(state));context.api.bindFilterWorkbench(state,{render,notify:(...args)=>notices.push(args),downloadFile:(...args)=>downloads.push(args)});};
  const control=selector=>{const found=document.querySelector(selector);assert.ok(found,`Expected control ${selector}`);return found;};
  const click=selector=>control(selector).emit('click');
  const check=(element,checked)=>{assert.ok(element,'Expected checkbox');element.checked=checked;element.emit('change');};
  const inPool=(attr,pool,id)=>document.querySelectorAll(`[data-filter-${attr}]`).find(element=>element.dataset[`filter${attr[0].toUpperCase()+attr.slice(1)}`]===pool&&Number(element.dataset.affixId)===id);
  const search=(pool,query)=>control(`[data-filter-search="${pool}"]`).emit('input',query);
  render();
  return {state,document,render,control,click,check,inPool,search,downloads,notices};
}

test('four stages confirm merged Build targets instead of editing low-level rule purposes',()=>{
  const ui=workbench();
  assert.equal(ui.document.querySelectorAll('.current').length,1);
  assert.match(ui.document.html,/需求暗金/); assert.match(ui.document.html,/需求套装/);
  assert.equal(ui.document.querySelectorAll('[data-filter-toggle]').filter(input=>input.dataset.filterToggle==='unique').length,new Set(ui.state.filterDraft.uniqueIds).size);
  for(const step of [2,3,4]) {ui.click(`[data-filter-step="${step}"]`);assert.equal(ui.state.filterStep,step);}
  assert.equal(ui.document.querySelectorAll('[data-filter-group-show]').length,VALUE_FILTER_GROUPS.length+ui.state.filterDraft.equipmentGroups.length);
  assert.equal(ui.document.querySelectorAll('[data-filter-family]').length,6);
  assert.equal(ui.control('[data-filter-family="equipment"]').open,true);
  assert.equal(ui.control('[data-filter-family="resources"]').open,false);
  assert.doesNotMatch(ui.document.html,/data-filter-row-field|data-filter-row-number|传奇供体|拆解碎片|编辑需求/);
});

test('Chinese multiselect search keeps pending choices across queries and separates sets from uniques',()=>{
  const ui=workbench({patch:{uniqueIds:[],setIds:[]}});
  ui.search('unique','红戒指'); ui.check(ui.inPool('pending','unique',277),true);
  ui.search('unique','66'); ui.check(ui.inPool('pending','unique',66),true);
  assert.equal(ui.control('[data-filter-add-selected="unique"]').disabled,false);
  ui.click('[data-filter-add-selected="unique"]');
  assert.deepEqual(plain(ui.state.filterDraft.uniqueIds),[277,66]);
  assert.equal(ui.state.filterUi.pending.unique.length,0);
  ui.search('set','79'); ui.check(ui.inPool('pending','set',79),true); ui.click('[data-filter-add-selected="set"]');
  assert.deepEqual(plain(ui.state.filterDraft.setIds),[79]);
  ui.search('unique',catalog.uniques[79].name.zh);
  assert.equal(ui.inPool('pending','unique',79),undefined);
  ui.search('set','红戒指');assert.equal(ui.inPool('pending','set',277),undefined);
  ui.inPool('remove','unique',277).emit('click');assert.deepEqual(plain(ui.state.filterDraft.uniqueIds),[66]);
});

test('high-value promotion removes a medium selection and clearing keeps candidates available',()=>{
  const ui=workbench({step:2,patch:{highAffixIds:[],mediumAffixIds:[36]}});
  ui.search('high','复合生命');ui.check(ui.inPool('pending','high',36),true);ui.click('[data-filter-add-selected="high"]');
  assert.deepEqual(plain(ui.state.filterDraft.highAffixIds),[36]);assert.deepEqual(plain(ui.state.filterDraft.mediumAffixIds),[]);
  ui.click('[data-filter-step="3"]');assert.equal(ui.inPool('toggle','medium',36),undefined,'high selection must not also appear in medium');
  ui.click('[data-filter-step="2"]');ui.check(ui.inPool('toggle','high',36),false);
  assert.ok(ui.inPool('toggle','high',36),'unchecking retains the visible candidate');
  ui.click('[data-filter-step="3"]');ui.check(ui.inPool('toggle','medium',36),true);
  assert.deepEqual(plain(ui.state.filterDraft.highAffixIds),[]);assert.deepEqual(plain(ui.state.filterDraft.mediumAffixIds),[36]);
});

test('medium categories start selected except high conflicts and support category and whole-pool changes',()=>{
  const ui=workbench({step:3});
  const expected=[...new Set(COMMON_AFFIX_GROUPS.flatMap(group=>group.affixIds))].filter(id=>!ui.state.filterDraft.highAffixIds.includes(id));
  assert.deepEqual([...ui.state.filterDraft.mediumAffixIds].sort((a,b)=>a-b),expected.sort((a,b)=>a-b));
  const category='common-resistances';
  const bulk=choice=>ui.document.querySelectorAll('[data-filter-bulk]').find(button=>button.dataset.filterCategory===category&&button.dataset.filterChoice===choice);
  bulk('none').emit('click');
  assert.ok(COMMON_AFFIX_GROUPS.find(group=>group.id==='resistances').affixIds.every(id=>!ui.state.filterDraft.mediumAffixIds.includes(id)));
  bulk('all').emit('click');
  assert.ok(COMMON_AFFIX_GROUPS.find(group=>group.id==='resistances').affixIds.every(id=>ui.state.filterDraft.highAffixIds.includes(id)||ui.state.filterDraft.mediumAffixIds.includes(id)));
  const clearAll=ui.document.querySelectorAll('[data-filter-bulk]').find(button=>!button.dataset.filterCategory&&button.dataset.filterChoice==='none');clearAll.emit('click');
  assert.equal(ui.state.filterDraft.mediumAffixIds.length,0);
  assert.ok(ui.document.querySelectorAll('[data-filter-toggle]').length>30,'cleared defaults stay visible for reconsideration');
});

test('catalog search shares the generator domain, includes special affixes, and excludes inherent unique variants',()=>{
  const ui=workbench({step:2,patch:{highAffixIds:[]}});
  const special=Object.values(catalog.affixes).find(a=>a.specialAffixType===6&&filterCore.isValueEquipmentAffix(a));
  assert.ok(special);ui.search('high',String(special.id));assert.ok(ui.inPool('pending','high',special.id));
  const inherent=Object.values(catalog.affixes).find(a=>a.specialAffixType===7);
  assert.ok(inherent);ui.search('high',String(inherent.id));assert.equal(ui.inPool('pending','high',inherent.id),undefined);
  const idolOnly=Object.values(catalog.affixes).find(a=>a.canRollOn.every(type=>type>=25&&type<=33));
  ui.search('high',String(idolOnly.id));assert.equal(ui.inPool('pending','high',idolOnly.id),undefined);
});

test('idol needs use compatible prefix and suffix selections and clear incompatible affixes after shape changes',()=>{
  const ui=workbench({step:2,patch:{idols:[]}});ui.click('#filter-add-idol');
  const idol=ui.state.filterDraft.idols[0];
  const affixInput=type=>ui.document.querySelectorAll('[data-filter-idol-affix]').find(input=>Number(input.dataset.affixType)===type);
  affixInput(0).emit('change','108');affixInput(1).emit('change','114');
  assert.deepEqual(plain(idol.affixIds),[108,114]);
  ui.control(`[data-filter-idol-shape="${idol.id}"]`).emit('change','28');assert.deepEqual(plain(idol.affixIds),[]);
  affixInput(0).emit('change','107');affixInput(1).emit('change','117');
  assert.deepEqual(plain(idol.affixIds),[107,117]);
  ui.click('[data-filter-step="4"]');assert.equal(ui.control('#filter-download').disabled,false);ui.click('#filter-download');
  assert.match(ui.downloads[0][0],/<EquipmentType>IDOL_1x2<\/EquipmentType>/);
  ui.click('[data-filter-step="2"]');ui.control(`[data-filter-idol-remove="${idol.id}"]`).emit('click');assert.equal(ui.state.filterDraft.idols.length,0);
});

test('group visibility and styles persist with language, stage and disclosure changes and affect real XML',()=>{
  const ui=workbench({step:4});
  const family=ui.control('[data-filter-family="resources"]');family.open=true;family.emit('toggle');
  ui.control('[data-filter-group-show="glyph"]').emit('change','hide');
  assert.equal(ui.control('[data-filter-family="resources"]').open,true);
  ui.control('[data-filter-group-color="unique_needed"]').emit('change','9');
  ui.check(ui.control('[data-filter-group-emphasis="unique_needed"]'),false);
  const before=plain(ui.state.filterDraft);
  ui.click('[data-filter-step="1"]');ui.state.language='en';ui.render();ui.click('[data-filter-step="4"]');
  assert.deepEqual(plain(ui.state.filterDraft),before);
  ui.control('#filter-name').emit('input','Skeleton / value');ui.click('#filter-download');
  assert.equal(ui.downloads.length,1);assert.equal(ui.downloads[0][1],'Skeleton _ value.xml');assert.equal(ui.state.filterDirty,false);
  assert.match(ui.downloads[0][0],/Needed uniques/);
  const rules=generateValueFilter({...ui.state.filterDraft,language:'en'}).rules;
  const glyph=rules.find(rule=>rule.groupId==='glyph');assert.equal(glyph.type,'HIDE');
  const needed=rules.find(rule=>rule.groupId==='unique_needed');assert.equal(needed.style.color,9);assert.equal(needed.style.emphasized,false);
});

test('all additional idol affixes remain visible and can be removed independently',()=>{
  const extra=Object.values(catalog.affixes).find(a=>a.id!==108&&a.type===0&&filterCore.isValueIdolAffix(a,25));
  assert.ok(extra);
  const idol={id:'three-affix-idol',baseTypeId:25,subTypeId:0,affixIds:[108,114,extra.id],enabled:true};
  const ui=workbench({step:2,patch:{idols:[idol]}});
  assert.equal(ui.document.querySelectorAll('[data-filter-idol-affix-remove]').length,3);
  const remove=ui.document.querySelectorAll('[data-filter-idol-affix-remove]').find(button=>Number(button.dataset.affixId)===extra.id);
  remove.emit('click');assert.deepEqual(plain(idol.affixIds),[108,114]);
  assert.equal(ui.document.querySelectorAll('[data-filter-idol-affix-remove]').length,2);
});

test('correcting the filter name immediately restores download and escaping cannot inject controls',()=>{
  const ui=workbench({step:4});ui.control('#filter-name').emit('input','');
  assert.equal(ui.control('#filter-download').disabled,true);assert.equal(ui.control('#filter-export-error').hidden,false);
  ui.control('#filter-name').emit('input','价值 <input> & 中文');
  assert.equal(ui.control('#filter-download').disabled,false);assert.equal(ui.control('#filter-export-error').hidden,true);
  ui.render();assert.match(ui.document.html,/价值 &lt;input&gt; &amp; 中文/);
  ui.click('#filter-download');assert.equal(ui.downloads.length,1);assert.match(ui.downloads[0][0],/<name>价值 &lt;input&gt; &amp; 中文<\/name>/);
});

test('replacing a build resets only the value wizard UI candidate state',()=>{
  const ui=workbench({patch:{uniqueIds:[],setIds:[]}});ui.search('unique','红戒指');
  ui.check(ui.inPool('pending','unique',277),true);ui.click('[data-filter-add-selected="unique"]');
  assert.ok(ui.state.filterUi.candidates.unique.includes(277));
  const replacement=createValueFilterDraft(build);ui.state.filterDraft=replacement;ui.render();
  assert.deepEqual(plain(ui.state.filterUi.candidates.unique),replacement.uniqueIds);
  assert.equal(ui.state.filterUi.query.unique,undefined);
});

test('equipment slider updates percentage, mapped score and example live and retains focus after commits',()=>{
  const ui=workbench({step:4});
  const group=ui.state.filterDraft.equipmentGroups.at(-1);
  const selector=`[data-filter-equipment-threshold="${group.id}"]`;
  const slider=ui.control(selector);slider.focus();
  const before=ui.document.renderCount;
  slider.emit('input','77');
  assert.equal(ui.document.renderCount,before,'pointer dragging must not replace the range control');
  assert.equal(ui.control(selector),slider);
  assert.equal(ui.document.activeElement,slider);
  assert.equal(group.threshold,77);
  assert.equal(ui.control(`[data-filter-equipment-score="${group.id}"]`).value,'77');
  assert.equal(ui.control(`[data-filter-score-value="${group.id}"]`).textContent,'30.8 分');
  assert.equal(ui.control(`#filter-score-example-${group.id}`).textContent,`例：${getEquipmentScoreThreshold(77,ui.state.filterDraft.scoring).example.zh}`);
  assert.equal(group.name,'77%','untouched percentage names follow the threshold');
  assert.equal(ui.control(`[data-filter-equipment-name="${group.id}"]`).value,'77%');
  slider.emit('change','77');
  assert.deepEqual(ui.document.querySelectorAll('[data-filter-equipment-threshold]').map(input=>Number(input.value)),[77,25,10]);
  assert.equal(ui.document.activeElement,ui.control(selector));
  // A subsequent keyboard change must still target the focused range after the first redraw.
  ui.document.activeElement.emit('input','78');ui.document.activeElement.emit('change','78');
  assert.equal(group.threshold,78);assert.equal(ui.document.activeElement,ui.control(selector));
});

test('custom equipment groups can be added, renamed, disabled independently from hiding, restored and deleted',()=>{
  const ui=workbench({step:4});ui.click('#filter-add-equipment-group');
  const group=ui.state.filterDraft.equipmentGroups.at(-1), id=group.id;
  assert.equal(group.name,'过渡装备');assert.equal(group.threshold,30);
  const name=ui.control(`[data-filter-equipment-name="${id}"]`);
  name.emit('input','开荒 <T4>');name.emit('change');
  ui.control(`[data-filter-equipment-threshold="${id}"]`).emit('change','35');
  assert.equal(group.name,'开荒 <T4>','custom names are never replaced by percentage labels');
  assert.match(ui.document.html,/开荒 &lt;T4&gt;/);
  ui.control(`[data-filter-group-show="${id}"]`).emit('change','hide');
  ui.control(`[data-filter-group-color="${id}"]`).emit('change','9');
  ui.check(ui.control(`[data-filter-group-emphasis="${id}"]`),true);
  let rules=generateValueFilter(ui.state.filterDraft).rules.filter(rule=>rule.groupId===id);
  assert.ok(rules.length);assert.ok(rules.every(rule=>rule.type==='HIDE'));
  const saved=plain(group);
  ui.check(ui.control(`[data-filter-equipment-enabled="${id}"]`),false);
  assert.deepEqual(plain(group),{...saved,enabled:false});
  assert.equal(generateValueFilter(ui.state.filterDraft).rules.some(rule=>rule.groupId===id),false);
  assert.equal(ui.control(`[data-filter-group-color="${id}"]`).disabled,false,'disabled groups remain editable');
  ui.click('[data-filter-step="2"]');ui.state.language='en';ui.render();ui.click('[data-filter-step="4"]');
  assert.deepEqual(plain(group),{...saved,enabled:false});
  ui.check(ui.control(`[data-filter-equipment-enabled="${id}"]`),true);
  rules=generateValueFilter(ui.state.filterDraft).rules.filter(rule=>rule.groupId===id);
  assert.ok(rules.length);assert.ok(rules.every(rule=>rule.type==='HIDE'&&rule.style.color===9&&rule.style.emphasized));
  ui.click(`[data-filter-equipment-delete="${id}"]`);
  assert.equal(ui.state.filterDraft.equipmentGroups.some(group=>group.id===id),false);
  assert.equal(ui.document.querySelector(`[data-filter-equipment-name="${id}"]`),null);
});

test('all scoring groups may be removed while fixed equipment fallbacks remain editable',()=>{
  const ui=workbench({step:4});
  for(const id of ui.state.filterDraft.equipmentGroups.map(group=>group.id))ui.click(`[data-filter-equipment-delete="${id}"]`);
  assert.equal(ui.state.filterDraft.equipmentGroups.length,0);
  assert.equal(ui.document.querySelectorAll('[data-filter-equipment-threshold]').length,0);
  assert.ok(ui.control('[data-filter-group-show="equipment_other_exalted"]'));
  assert.ok(ui.control('[data-filter-group-show="equipment_other"]'));
  assert.equal(ui.control('#filter-download').disabled,false);
  ui.click('#filter-add-equipment-group');assert.equal(ui.state.filterDraft.equipmentGroups.length,1);
});

test('the score table displays T7 through T1 defaults, edits negative decimals in place and restores defaults',()=>{
  const ui=workbench({step:4,useDefaultScoring:true}), draft=ui.state.filterDraft;
  const scoringInputs=ui.document.querySelectorAll('[data-filter-score-category]');
  assert.equal(scoringInputs.length,21);
  for(const category of ['high','medium','low']) {
    const row=scoringInputs.filter(input=>input.dataset.filterScoreCategory===category);
    assert.deepEqual(row.map(input=>Number(input.dataset.filterScoreTier)),[7,6,5,4,3,2,1]);
    assert.deepEqual(row.map(input=>Number(input.value)),[...VALUE_FILTER_DEFAULT_SCORING[category]].reverse());
    assert.ok(row.every(input=>input.attributes.step==='0.01'));
  }
  assert.match(ui.document.html,/高价值/);assert.match(ui.document.html,/有效/);assert.match(ui.document.html,/无效/);
  assert.match(ui.document.html,/T8 按 T7 计分/);assert.equal(ui.document.querySelector('#filter-low-penalty'),null);
  const input=scoringInputs.find(input=>input.dataset.filterScoreCategory==='low'&&input.dataset.filterScoreTier==='1');
  input.focus();const before=ui.document.renderCount, oldGroups=plain(draft.equipmentGroups);
  input.emit('input','-0.3');input.emit('change');
  assert.equal(draft.scoring.low[0],-0.3);
  assert.equal(ui.document.renderCount,before);assert.equal(ui.document.activeElement,input);
  for(const group of draft.equipmentGroups) {
    const slider=ui.control(`[data-filter-equipment-threshold="${group.id}"]`);
    assert.equal(slider.attributes.min,'1');assert.equal(slider.attributes.max,'100');
    assert.equal(ui.control(`#filter-score-example-${group.id}`).textContent,`例：${getEquipmentScoreThreshold(group.threshold,draft.scoring).example.zh}`);
  }
  const t7=scoringInputs.find(input=>input.dataset.filterScoreCategory==='high'&&input.dataset.filterScoreTier==='7');
  t7.emit('input','12.5');
  const full=draft.equipmentGroups.find(group=>group.threshold===100);
  assert.equal(ui.control(`[data-filter-score-value="${full.id}"]`).textContent,'50 分','100% must track four high-value T7 affixes');
  assert.equal(ui.document.renderCount,before);
  assert.equal(VALUE_FILTER_DEFAULT_SCORING.low[0],-0.2,'editing must not mutate the defaults');
  ui.click('#filter-reset-scoring');assert.deepEqual(plain(draft.scoring),plain(VALUE_FILTER_DEFAULT_SCORING));
  assert.deepEqual(plain(draft.equipmentGroups),oldGroups);
  assert.equal(ui.control('[data-filter-scoring]').open,true);
});

test('real default scores show concise approximation status that updates after score edits',()=>{
  const ui=workbench({step:4,useDefaultScoring:true}), draft=ui.state.filterDraft;
  assert.deepEqual(plain(draft.scoring),plain(VALUE_FILTER_DEFAULT_SCORING));
  assert.equal(ui.control('#filter-download').disabled,false);
  assert.equal(generateValueFilter(draft).diagnostics.approximate,true);
  assert.equal(ui.control('#filter-approximation').hidden,false);
  assert.match(ui.document.html,/近似过滤：可能多保留部分装备/);
  const before=plain(draft.equipmentGroups);
  for(const input of ui.document.querySelectorAll('[data-filter-score-category]')) {
    input.emit('input',String({high:10,medium:4,low:0}[input.dataset.filterScoreCategory]));
  }
  const output=generateValueFilter(draft);
  assert.equal(ui.control('#filter-download').disabled,false);assert.equal(ui.control('#filter-scoring-error').hidden,true);
  assert.equal(ui.control('#filter-approximation').hidden,!output.diagnostics.approximate);
  assert.equal(ui.control('#filter-rule-count').textContent,`${output.rules.length} / 200`);
  assert.deepEqual(plain(draft.equipmentGroups),before);
  for(const group of draft.equipmentGroups) {
    assert.equal(ui.control(`[data-filter-group-rule-count="${group.id}"]`).textContent,`${output.groups.find(g=>g.id===group.id).ruleCount} 条自动规则`);
    assert.equal(ui.control(`#filter-score-example-${group.id}`).textContent,`例：${getEquipmentScoreThreshold(group.threshold,draft.scoring).example.zh}`);
  }
  ui.click('#filter-download');assert.equal(ui.downloads.length,1);
});

test('invalid score cells are preserved and block export until corrected instead of applying defaults',()=>{
  const ui=workbench({step:4});
  const field=()=>ui.document.querySelectorAll('[data-filter-score-category]').find(input=>input.dataset.filterScoreCategory==='high'&&input.dataset.filterScoreTier==='7');
  const input=field();input.focus();input.emit('input','');
  assert.equal(ui.state.filterDraft.scoring.high[6],'');assert.equal(ui.document.activeElement,input);
  assert.equal(ui.control('#filter-download').disabled,true);assert.equal(ui.control('#filter-scoring-error').hidden,false);
  assert.ok(ui.document.querySelectorAll('[data-filter-equipment-threshold]').every(slider=>slider.disabled));
  ui.click('#filter-download');assert.equal(ui.downloads.length,0);
  ui.click('[data-filter-step="3"]');ui.click('[data-filter-step="4"]');
  assert.equal(field().value,'');assert.equal(ui.control('#filter-download').disabled,true);
  field().emit('input','10');
  assert.equal(ui.state.filterDraft.scoring.high[6],10);assert.equal(ui.control('#filter-download').disabled,false);
  assert.equal(ui.control('#filter-scoring-error').hidden,true);
  for(const value of ['0','-0.2']) {
    field().emit('input',value);assert.equal(ui.control('#filter-download').disabled,true);
  }
  field().emit('input','10');assert.equal(ui.control('#filter-download').disabled,false);
});

test('direct percentage thresholds synchronize scores and sliders while preserving invalid input and focus',()=>{
  const ui=workbench({step:4}), group=ui.state.filterDraft.equipmentGroups.at(-1);
  const input=ui.control(`[data-filter-equipment-score="${group.id}"]`), slider=ui.control(`[data-filter-equipment-threshold="${group.id}"]`), before=ui.document.renderCount;
  input.focus();input.emit('input','58');input.emit('change');
  assert.equal(group.threshold,58);assert.equal(Number(slider.value),58);assert.equal(group.name,'58%');
  assert.equal(ui.document.renderCount,before);assert.equal(ui.document.activeElement,input);
  input.emit('input','');
  assert.equal(group.threshold,'');assert.equal(ui.control('#filter-download').disabled,true);assert.equal(slider.disabled,true);
  for(const value of ['-1','101','5.8']) { input.emit('input',value);assert.equal(ui.control('#filter-download').disabled,true); }
  input.emit('input','70');
  assert.equal(group.threshold,70);assert.equal(Number(slider.value),70);assert.equal(slider.disabled,false);
  assert.equal(group.name,'70%');assert.equal(ui.control(`[data-filter-score-value="${group.id}"]`).textContent,'28 分');
  assert.equal(ui.control('#filter-download').disabled,false);
  assert.equal(ui.document.activeElement,input);assert.equal(ui.document.renderCount,before);
  ui.click('#filter-download');assert.equal(ui.downloads.length,1);assert.match(ui.downloads[0][0],/70%/);
});

test('equipment name validation updates export immediately without replacing the editing control',()=>{
  const ui=workbench({step:4}), group=ui.state.filterDraft.equipmentGroups[0];
  const selector=`[data-filter-equipment-name="${group.id}"]`, input=ui.control(selector), before=ui.document.renderCount;
  input.emit('input','');assert.equal(ui.control('#filter-download').disabled,true);
  input.emit('input','精挑装备');assert.equal(ui.control('#filter-download').disabled,false);
  input.emit('change');assert.equal(ui.control(selector),input);assert.equal(ui.document.renderCount,before);
  ui.click('#filter-download');assert.equal(ui.downloads.length,1);assert.match(ui.downloads[0][0],/精挑装备/);
});

test('fixed equipment group names edit live, survive navigation and appear in exported XML',()=>{
  const ui=workbench({step:4});
  for(const id of ['equipment_other_exalted','equipment_other']) {
    const input=ui.control(`[data-filter-equipment-name="${id}"]`), before=ui.document.renderCount;
    input.focus();input.emit('input','');
    assert.equal(ui.control('#filter-download').disabled,true);
    input.emit('input',`备用 <${id}>`);
    assert.equal(ui.control('#filter-download').disabled,false);
    assert.equal(ui.control(`[data-filter-group-preview="${id}"]`).textContent,`备用 <${id}>`);
    assert.equal(ui.document.renderCount,before);
    assert.equal(ui.document.activeElement,input);
  }
  ui.click('[data-filter-step="2"]');ui.state.language='en';ui.render();ui.click('[data-filter-step="4"]');
  ui.click('#filter-download');
  for(const id of ['equipment_other_exalted','equipment_other']) {
    assert.equal(ui.control(`[data-filter-equipment-name="${id}"]`).value,`备用 <${id}>`);
    assert.ok(ui.downloads[0][0].includes(`<nameOverride>备用 &lt;${id}&gt;</nameOverride>`));
  }
});

test('color and emphasis update actual preview styles without replacing focused controls',()=>{
  const ui=workbench({step:4}), id=ui.state.filterDraft.equipmentGroups[0].id;
  const color=ui.control(`[data-filter-group-color="${id}"]`), preview=ui.control(`[data-filter-group-preview="${id}"]`), swatch=ui.control(`[data-filter-group-swatch="${id}"]`);
  const before=ui.document.renderCount;
  color.focus();color.emit('input','9');color.emit('change','9');
  const expected=(palette.colors??palette).find(entry=>entry.id===9).hex;
  assert.equal(preview.style.getPropertyValue('--loot-color'),expected);
  assert.equal(swatch.style.getPropertyValue('--loot-color'),expected);
  assert.equal(ui.document.renderCount,before);assert.equal(ui.document.activeElement,color);
  const emphasis=ui.control(`[data-filter-group-emphasis="${id}"]`);
  emphasis.focus();ui.check(emphasis,false);
  assert.equal(preview.classList.contains('emphasized'),false);
  ui.check(emphasis,true);assert.equal(preview.classList.contains('emphasized'),true);
  assert.equal(ui.document.renderCount,before);assert.equal(ui.document.activeElement,emphasis);
  const rules=generateValueFilter(ui.state.filterDraft).rules.filter(rule=>rule.groupId===id);
  assert.ok(rules.length&&rules.every(rule=>rule.style.color===9&&rule.style.emphasized));
  ui.control(`[data-filter-group-show="${id}"]`).emit('change','hide');
  assert.equal(ui.control(`[data-filter-group-preview="${id}"]`).style.getPropertyValue('--loot-color'),expected);
  ui.check(ui.control(`[data-filter-equipment-enabled="${id}"]`),false);
  assert.equal(ui.control(`[data-filter-group-preview="${id}"]`).style.getPropertyValue('--loot-color'),expected);
  assert.match(ui.document.html,/颜色预览/);
  assert.match(ui.document.html,new RegExp(`data-filter-group-preview-status="${id}">已停用`));
});

test('unsafe approximate hiding blocks export without dropping groups and recovers when set to Show',()=>{
  const groups=createValueFilterDraft(build).equipmentGroups;groups[0].show=false;
  const before=plain(groups), ui=workbench({step:4,useDefaultScoring:true,patch:{equipmentGroups:groups}});
  assert.equal(ui.control('#filter-download').disabled,true);
  assert.equal(ui.control('#filter-export-error').hidden,false);
  assert.match(ui.document.html,/近似/);
  assert.deepEqual(plain(ui.state.filterDraft.equipmentGroups),before);
  assert.equal(ui.document.querySelectorAll('[data-filter-equipment-enabled]').length,groups.length);
  ui.click('#filter-download');assert.equal(ui.downloads.length,0);
  ui.control(`[data-filter-group-show="${groups[0].id}"]`).emit('change','show');
  assert.equal(ui.control('#filter-download').disabled,false);assert.equal(ui.control('#filter-approximation').hidden,false);
  ui.click('#filter-download');assert.equal(ui.downloads.length,1);
});
