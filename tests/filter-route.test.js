import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createWorkflow, SYNC_OPTIONS } from '../web/src/core/workflow.js';
import * as planner from '../web/src/core/planner.js';
import * as world from '../web/src/core/world.js';
import * as campaign from '../web/src/core/campaign.js';
import { getEquipment } from '../web/src/core/equipment.js';
import { createValueFilterDraft as createFilterDraft, generateValueFilter as generateFilter } from '../web/src/core/value-filter.js';
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
    ...planner, ...world, ...campaign, getEquipment, createFilterDraft,
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
    globalThis.probe = { state, flow, view, filterView, importSelectedBuild, bindEvents,
      linkPage, syncPage, uploadPage, actions, render: originalRender };
  `, context, { filename: 'main.js' });
  return { ...context.probe, element, elements, lists, windowEvents, workbenchCalls, downloads };
}

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
