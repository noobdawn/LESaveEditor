import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createWorkflow, SYNC_OPTIONS } from '../web/src/core/workflow.js';
import { parseSave, diffSave } from '../web/src/core/save.js';
import * as planner from '../web/src/core/planner.js';
import * as world from '../web/src/core/world.js';
import * as campaign from '../web/src/core/campaign.js';
import * as endgame from '../web/src/core/endgame.js';
import { getEquipment } from '../web/src/core/equipment.js';
import { createValueFilterDraft as createFilterDraft, generateValueFilter as generateFilter, restoreValueFilterDraft } from '../web/src/core/value-filter.js';
import { MAX_FILTER_XML_BYTES } from '../web/src/core/filter-settings.js';
import { messages, classes, masteries } from '../web/src/i18n.js';
import { icon } from '../web/src/icons.js';
import plannerData from '../web/src/data/planner-game-data.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8'));
const URL_A = 'https://www.lastepochtools.com/planner/om6w3Ypq';
const URL_B = 'https://www.lastepochtools.com/planner/BBBBBBBB';
const build = (id = 'om6w3Ypq', sourceUrl = URL_A) => ({ ...structuredClone(fixture), id, sourceUrl });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Run production routing and the real workflow; only presentation and browser I/O are replaced. */
function routeHarness(fetchBuild = async () => build()) {
  const elements = new Map(), lists = new Map(), windowEvents = new Map();
  const workbenchCalls = [], downloads = [];
  const element = (selector, extra = {}) => {
    const control = { listeners: {}, value: '', dataset: {}, focus() {},
      addEventListener(type, handler) { this.listeners[type] = handler; }, ...extra };
    elements.set(selector, control); return control;
  };
  for (const selector of ['#app', '#main-content', '#brand-link', '#save-input']) element(selector);
  const context = vm.createContext({
    ...planner, ...world, ...campaign, ...endgame, getEquipment, createFilterDraft, restoreValueFilterDraft, MAX_FILTER_XML_BYTES,
    createWorkflow: () => createWorkflow({ fetchBuild }), SYNC_OPTIONS,
    messages, classes, masteries, icon, plannerData,
    renderFilterWorkbench: state => { workbenchCalls.push({ kind: 'render', state }); return '<div class="filter-workbench"></div>'; },
    bindFilterWorkbench: (state, callbacks) => workbenchCalls.push({ kind: 'bind', state, callbacks }),
    document: {
      querySelector: selector => elements.get(selector) ?? null,
      querySelectorAll: selector => lists.get(selector) ?? [], documentElement: {},
      createElement: () => ({ click() { downloads.at(-1).name = this.download; }, remove() {} }),
      body: { append() {} },
    },
    window: { addEventListener: (type, handler) => windowEvents.set(type, handler), scrollTo() {} },
    localStorage: { getItem: () => null, setItem() {} },
    URL: { createObjectURL: blob => { downloads.push({ blob }); return 'blob:filter-test'; }, revokeObjectURL() {} },
    Blob, setTimeout: () => {}, CSS: { escape: value => value },
  });
  const source = readFileSync(new URL('../web/src/main.js', import.meta.url), 'utf8')
    .replace(/^import[^\n]*\r?\n/gm, '').replace(/render\(\);\s*$/, '');
  vm.runInContext(source + `
    const originalRender = render;
    render = () => {};
    globalThis.probe = { state, flow, view, filterView, importSelectedBuild, importFilterFile, filterPage, bindEvents,
      linkPage, syncPage, uploadPage, reviewRows, actions, render: originalRender };
  `, context, { filename: 'main.js' });
  return { ...context.probe, element, elements, lists, windowEvents, workbenchCalls, downloads };
}

test('endgame switch requires campaign skip and the upload page makes the season stash mandatory', async () => {
  const ui=routeHarness();
  await ui.importSelectedBuild(URL_A);
  assert.match(ui.syncPage(), /id="endgame-skip"[^>]*disabled/);
  ui.flow.setOption('campaignSkip',true);ui.flow.setOption('endgameSkip',true);
  assert.match(ui.syncPage(), /id="endgame-skip"[^>]*checked/);
  assert.doesNotMatch(ui.syncPage(), /id="endgame-skip"[^>]*disabled/);
  assert.match(ui.uploadPage(), /必须同时上传角色和同赛季仓库/);
  assert.match(ui.uploadPage(), /赛季仓库 <small>必需/);
  ui.flow.setOption('campaignSkip',false);
  assert.equal(ui.state.options.endgameSkip,false);
  assert.match(ui.syncPage(), /id="endgame-skip"[^>]*disabled/);
});

test('endgame review renders all new timelines and tickets with readable labels for both documents', () => {
  const ui=routeHarness();ui.flow.setOption('campaignSkip',true);ui.flow.setOption('endgameSkip',true);
  const originals=[parseSave('EPOCH'+JSON.stringify({characterName:'Synthetic',level:1,savedItems:[],cycle:8,hardcore:false}), '1CHARACTERSLOT_BETA_9'),
    parseSave('EPOCH'+JSON.stringify({cycle:8,gold:0,tabsv2:[]}), 'STASH_CYCLE_8_0')];
  const result=endgame.applyEndgameSkip(originals);
  for(let index=0;index<2;index++){
    const html=ui.reviewRows({original:originals[index],doc:result[index],changes:diffSave(originals[index],result[index])});
    assert.doesNotMatch(html,/maxCorruption|highestCorruption|materialsList|\[object Object\]/);
    if(index===0)assert.equal(html.match(/稳定值 1600 · 腐化值 300/g).length,10);
    else for(const resource of endgame.ENDGAME_RESOURCES)assert.ok(html.includes(resource.name.zh));
  }
});

test('default URL import retains the original sync options and requires a character save', async () => {
  const ui = routeHarness();
  assert.equal(ui.view.mode, 'sync');
  assert.equal(ui.state.step, 0);
  await ui.importSelectedBuild(URL_A);
  assert.equal(ui.view.mode, 'sync');
  assert.equal(ui.state.step, 1);
  assert.equal(ui.filterView.filterDraft, null);
  assert.match(ui.linkPage(), /name="intent" value="sync"/);
  for (const option of SYNC_OPTIONS) assert.match(ui.syncPage(), new RegExp(`data-sync="${option}"`));
  assert.match(ui.syncPage(), /role="switch" data-sync="maxRolls"/);
  assert.match(ui.syncPage(), /id="campaign-skip"[^>]*role="switch"[^>]*data-sync="campaignSkip"/);

  const toggles = ['maxRolls', 'campaignSkip'].map(key => ({ dataset: { sync: key }, checked: true }));
  ui.lists.set('[data-sync]', toggles);
  const next = ui.element('#next-button');
  ui.bindEvents();
  toggles.forEach(toggle => toggle.onchange());
  assert.equal(ui.state.options.maxRolls, true);
  assert.equal(ui.state.options.campaignSkip, true);
  next.listeners.click();
  assert.equal(ui.state.step, 2);
  assert.match(ui.actions(), /id="next-button" disabled/);
  assert.equal(ui.flow.synchronize(), false);
  assert.equal(ui.state.error.code, 'NEED_CHARACTER');
  assert.equal(ui.state.step, 2, 'the filter branch must not bypass the original character requirement');
});

test('filter import works without saves and adapts state, language and XML downloads', async () => {
  const ui = routeHarness();
  await ui.importSelectedBuild(URL_A, 'filter');
  assert.equal(ui.state.files.size, 0);
  assert.equal(ui.view.mode, 'filter');
  assert.equal(ui.filterView.tab, 'filterTab');
  assert.equal(ui.filterView.build, ui.state.build);
  assert.equal(ui.filterView.filterDraft.uniqueIds.length, 8);
  assert.equal(ui.filterView.filterDraft.setIds.length, 1);
  assert.ok(generateFilter(ui.filterView.filterDraft).xml.includes('<ItemFilter'));

  const english = { dataset: { language: 'en' } };
  ui.lists.set('[data-language]', [english]);
  ui.bindEvents(); english.onclick(); ui.render();
  const bound = ui.workbenchCalls.findLast(call => call.kind === 'bind');
  assert.equal(bound.state, ui.filterView);
  assert.equal(bound.state.language, 'en');
  assert.doesNotMatch(ui.elements.get('#app').innerHTML, /<nav class="stepper"/);
  assert.match(ui.elements.get('#app').innerHTML, /class="filter-workbench"/);
  bound.callbacks.downloadFile('<ItemFilter/>', 'My filter.xml', 'application/xml;charset=utf-8');
  assert.equal(ui.downloads[0].name, 'My filter.xml');
  assert.equal(ui.downloads[0].blob.type, 'application/xml;charset=utf-8');
  assert.equal(await ui.downloads[0].blob.text(), '<ItemFilter/>');
});

test('returning to the same loaded URL preserves customized filter stages and styles', async () => {
  let requests = 0;
  const ui = routeHarness(async () => { requests++; return build(); });
  await ui.importSelectedBuild(URL_A, 'filter');
  const savedDraft = ui.filterView.filterDraft;
  savedDraft.name = '我的构造'; savedDraft.groups.unique_needed.color = 13;
  ui.filterView.filterStep = 2; ui.filterView.filterDirty = true;
  ui.filterView.filterUi = { search: '生命' };
  const back = ui.element('#filter-back'); ui.bindEvents(); back.listeners.click();
  assert.equal(ui.view.mode, 'sync'); assert.equal(ui.state.step, 0);
  await ui.importSelectedBuild(` ${URL_A} `, 'filter');
  assert.equal(requests, 1, 'a return to the same loaded build should not discard edits by refetching');
  assert.equal(ui.filterView.filterDraft, savedDraft);
  assert.equal(ui.filterView.filterDraft.groups.unique_needed.color, 13);
  assert.equal(ui.filterView.filterStep, 2);
  assert.equal(ui.filterView.filterUi.search, '生命');
  assert.equal(ui.filterView.filterDirty, true);
  await ui.importSelectedBuild(URL_A, 'sync');
  assert.equal(ui.view.mode, 'sync'); assert.equal(ui.state.step, 1);
  assert.equal(ui.filterView.filterDraft, savedDraft, 'entering save sync must retain the separate filter draft');
});

test('a changed typed URL is fetched even though a previous build is already loaded', async () => {
  const requests = [];
  const ui = routeHarness(async url => { requests.push(url); return url === URL_B ? build('BBBBBBBB', URL_B) : build(); });
  await ui.importSelectedBuild(URL_A, 'filter');
  const oldDraft = ui.filterView.filterDraft;
  ui.filterView.filterStep = 4; ui.filterView.filterDirty = true; ui.filterView.filterUi = { search: '旧配装' };
  const input = ui.element('#build-url', { value: URL_B }); ui.bindEvents();
  input.listeners.input({ target: input });
  assert.equal(ui.state.buildUrl, URL_B);
  await ui.importSelectedBuild(input.value, 'filter');
  assert.deepEqual(requests, [URL_A, URL_B]);
  assert.equal(ui.state.build.id, 'BBBBBBBB');
  assert.equal(ui.view.loadedBuildUrl, URL_B);
  assert.notEqual(ui.filterView.filterDraft, oldDraft);
  assert.equal(ui.filterView.filterDraft.build.id, 'BBBBBBBB');
  assert.equal(ui.filterView.filterStep, 1);
  assert.equal(ui.filterView.filterUi, null);
  assert.equal(ui.filterView.filterDirty, false);
});

test('an older asynchronous request cannot change the newer request’s route or filter draft', async () => {
  for (const modes of [['filter', 'sync'], ['sync', 'filter']]) {
    const first = deferred(), second = deferred(), requests = [];
    const ui = routeHarness((url, { signal }) => { requests.push({ url, signal }); return requests.length === 1 ? first.promise : second.promise; });
    const pendingFirst = ui.importSelectedBuild(URL_A, modes[0]);
    const pendingSecond = ui.importSelectedBuild(URL_B, modes[1]);
    assert.equal(requests[0].signal.aborted, true);
    second.resolve(build('BBBBBBBB', URL_B)); await pendingSecond;
    const currentDraft = ui.filterView.filterDraft;
    first.resolve(build()); await pendingFirst;
    assert.equal(ui.state.build.id, 'BBBBBBBB');
    assert.equal(ui.view.mode, modes[1]);
    assert.equal(ui.view.loadedBuildUrl, URL_B);
    assert.equal(ui.filterView.filterDraft, currentDraft);
    assert.equal(ui.filterView.filterDraft?.build.id ?? null, modes[1] === 'filter' ? 'BBBBBBBB' : null);
  }
});

test('failed replacement cannot reactivate the previous build, and dirty filters warn on close', async () => {
  const failure = new Error('Synthetic fetch failure');
  const ui = routeHarness(async url => { if (url === URL_B) throw failure; return build(); });
  await ui.importSelectedBuild(URL_A, 'filter');
  ui.filterView.filterDirty = true;
  let prevented = false;
  ui.windowEvents.get('beforeunload')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'editing only a filter still creates unsaved work');
  const back = ui.element('#filter-back'); ui.bindEvents(); back.listeners.click();
  await ui.importSelectedBuild(URL_B, 'filter');
  assert.equal(ui.state.build, null);
  assert.equal(ui.state.error, failure);
  assert.equal(ui.view.mode, 'sync');
  assert.equal(ui.state.step, 0);
  assert.equal(ui.flow.synchronize(), false);
  assert.equal(ui.state.error.code, 'NEED_BUILD');
});

test('XML settings import works offline, restores language and styles, and never loads or replaces save data', async () => {
  let requests = 0;
  const ui = routeHarness(async () => { requests++; throw new Error('No network allowed'); });
  const saved = createFilterDraft(build()); saved.language = 'en'; saved.name = 'Imported filter';
  saved.groups.glyph.color = 9; saved.exclusions.equipmentTypeIds = [12,13];
  const xml = generateFilter(saved).xml;
  assert.match(ui.linkPage(), /继续编辑过滤器/);
  assert.equal(await ui.importFilterFile({ name: 'filter.xml', size: xml.length, text: async () => xml }), true);
  assert.equal(requests, 0); assert.equal(ui.state.build, null); assert.equal(ui.state.files.size, 0);
  assert.equal(ui.view.mode, 'filter'); assert.equal(ui.filterView.filterStep, 5);
  assert.equal(ui.filterView.filterDraft.name, 'Imported filter');
  assert.equal(ui.filterView.filterDraft.groups.glyph.color, 9);
  assert.deepEqual(Array.from(ui.filterView.filterDraft.exclusions.equipmentTypeIds), [12,13]);
  assert.equal(ui.filterView.filterDirty, false); assert.equal(ui.view.filterImporting, false);
  ui.render();
  assert.equal(ui.filterView.language, 'en');
  assert.match(ui.filterPage(), /Create loot filter/);
  assert.match(ui.filterPage(), /Level 100/);
  assert.match(ui.filterPage(), /https:\/\/www.lastepochtools.com\/planner\/om6w3Ypq/);
  ui.filterView.filterDraft.groups.glyph.color = 14;
  assert.equal(restoreValueFilterDraft(generateFilter(ui.filterView.filterDraft).xml).groups.glyph.color, 14);
});

test('failed XML replacement and oversize files preserve the dirty draft and loaded save workflow', async () => {
  const ui = routeHarness(); await ui.importSelectedBuild(URL_A, 'filter');
  const original = ui.filterView.filterDraft, originalBuild = ui.state.build;
  ui.state.files.set('keep', { original: { kind: 'character' } });
  ui.filterView.filterDirty = true; ui.filterView.filterStep = 2;
  const oldXml = generateFilter(original).xml.replace(/<!-- LESaveEditor-settings:[\s\S]*?-->/g, '');
  assert.equal(await ui.importFilterFile({ size: oldXml.length, text: async () => oldXml }), false);
  assert.equal(ui.state.error.code, 'FILTER_SETTINGS_NOT_FOUND');
  assert.equal(ui.filterView.filterDraft, original); assert.equal(ui.filterView.filterDirty, true);
  assert.equal(ui.filterView.filterStep, 2); assert.equal(ui.state.build, originalBuild);
  assert.equal(ui.state.files.size, 1);
  assert.equal(await ui.importFilterFile({ size: MAX_FILTER_XML_BYTES + 1, text: () => { throw new Error('Must not read'); } }), false);
  assert.equal(ui.filterView.filterDraft, original); assert.equal(ui.view.filterImporting, false);
});

test('XML import keeps the prior raw Build separate and returning to its URL restores that Build draft', async () => {
  let requests = 0;
  const ui = routeHarness(async () => { requests++; return build(); });
  await ui.importSelectedBuild(URL_A, 'filter');
  const originalBuild = ui.state.build;
  const other = createFilterDraft(build('BBBBBBBB', URL_B)), xml = generateFilter(other).xml;
  assert.equal(await ui.importFilterFile({ size: xml.length, text: async () => xml }), true);
  assert.equal(ui.filterView.filterDraft.build.id, 'BBBBBBBB');
  assert.equal(ui.state.build, originalBuild); assert.equal(requests, 1);
  await ui.importSelectedBuild(URL_A, 'filter');
  assert.equal(requests, 1); assert.equal(ui.filterView.filterDraft.build.id, 'om6w3Ypq');
  assert.equal(ui.filterView.filterStep, 1);
});

test('XML import controls avoid a build URL requirement and prevent competing imports while reading', async () => {
  const ui = routeHarness(), pending = deferred();
  const input = ui.element('#filter-xml-input', { files: [], click() { this.clicked = true; } });
  const button = ui.element('#filter-import');
  ui.bindEvents(); button.listeners.click(); assert.equal(input.clicked, true);
  const xml = generateFilter(createFilterDraft(build())).xml;
  input.files = [{ size: xml.length, text: () => pending.promise }]; input.value = 'filter.xml';
  const importing = input.listeners.change({ target: input });
  assert.equal(input.value, ''); assert.equal(ui.view.filterImporting, true);
  assert.match(ui.linkPage(), /id="filter-import" disabled/);
  assert.equal(await ui.importFilterFile({ size: 1, text: () => 'ignored' }), false);
  await ui.importSelectedBuild(URL_A, 'filter'); assert.equal(ui.state.build, null);
  pending.resolve(xml); await importing;
  assert.equal(ui.filterView.filterDraft.build.id, 'om6w3Ypq');
  assert.equal(ui.view.filterImporting, false);
});
