import './styles.css';
import { messages, classes, masteries } from './i18n.js';
import { icon } from './icons.js';
import { createWorkflow, SYNC_OPTIONS } from './core/workflow.js';
import { summarizeBuild } from './core/planner.js';
import { getTimelines, getFactions, factionRankInfo, expectedStashName, worldData } from './core/world.js';
import { getEquipment } from './core/equipment.js';
import { campaignSummary, campaignData } from './core/campaign.js';
import plannerData from './data/planner-game-data.js';
import { createValueFilterDraft as createFilterDraft, restoreValueFilterDraft } from './core/value-filter.js';
import { MAX_FILTER_XML_BYTES } from './core/filter-settings.js';
import { renderFilterWorkbench, bindFilterWorkbench } from './filter-workbench.js';

const flow = createWorkflow(), state = flow.state;
const app = document.querySelector('#app');
let language = 'zh';
try { if (localStorage.getItem('le-save-editor-language') === 'en') language = 'en'; } catch { /* Optional preference storage. */ }
const filterView = { tab: 'filterTab', filterDraft: null, filterStep: 1, filterSelected: null, filterUi: null, filterDirty: false, build: null, language: 'zh' };
const view = { mode: 'sync', filterImporting: false, loadedBuildUrl: '', timeline: null, faction: null, tutorial: false, notice: '', downloaded: false, downloadedFiles: new Set() };
const t = key => messages[language][key];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const localized = value => value?.[language] ?? value?.en ?? value ?? '';
const number = value => Number(String(value ?? 0));
const formatted = value => value !== '' && value != null && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(String(value))) ? Number(String(value)).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US') : String(value ?? '');
const className = (classId, masteryId) => masteries[language][number(classId)]?.[number(masteryId)] ?? classes[language][number(classId)] ?? String(classId);
const plannerUrl = () => `https://www.lastepochtools.com/planner/${language === 'zh' ? 'zh/' : ''}`;
const character = () => state.synced.find(doc => doc.kind === 'character');
const stash = () => state.synced.find(doc => doc.kind === 'stash');
const draft = (key, fallback) => state.worldEdits.get(key)?.value ?? fallback;
function errorText(error) {
  if (language === 'en' && error.messageEn) return error.messageEn;
  const parts = error.message.split(' / ');
  return parts.length === 2 ? parts[language === 'zh' ? 0 : 1] : error.message;
}
const notice = () => state.error ? `<div class="message error" role="alert">${esc(errorText(state.error))}</div>` : view.notice ? `<div class="message success" role="status">${esc(view.notice)}</div>` : '';
const location = () => `<div class="save-location"><span>${t('locationTitle')}</span><code>${esc(t('location'))}</code></div>`;
function actions(next = true) {
  const blocked=state.loading||state.readingFiles||(state.step===2&&![...state.files.values()].some(entry=>entry.original.kind==='character'));
  return `<div class="actions">${state.step ? `<button class="button secondary" id="back-button" ${state.loading || state.readingFiles ? 'disabled' : ''}>${t('back')}</button>` : '<span></span>'}${next ? `<button class="button primary" id="next-button" ${blocked ? 'disabled' : ''}>${t('next')}${icon('arrow')}</button>` : ''}</div>`;
}
function buildSummary() {
  const summary = summarizeBuild(state.build);
  return `<div class="build-summary"><div><strong>${esc(className(summary.classId, summary.masteryId))}</strong><span>${t('level')} ${summary.level}</span></div><a href="${esc(state.build.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('viewBuild')}${icon('external')}</a></div>`;
}
function linkPage() {
  return `<section class="page entry filter-route"><h1>${t('linkTitle')}</h1><p class="intro">${t('linkHint')}</p><form id="build-form" class="card"><label for="build-url">${t('linkLabel')}</label><input id="build-url" type="text" inputmode="url" placeholder="https://www.lastepochtools.com/planner/…" value="${esc(state.buildUrl)}" required autocomplete="off" spellcheck="false" ${state.loading || view.filterImporting ? 'disabled' : ''}>${notice()}<div class="filter-route-actions"><button type="submit" name="intent" value="sync" class="button primary full" ${state.loading || view.filterImporting ? 'disabled' : ''}>${t(state.loading ? 'loading' : 'syncRoute')}${state.loading ? '<span class="spinner" aria-hidden="true"></span>' : icon('arrow')}</button><button type="submit" name="intent" value="filter" class="button secondary full" ${state.loading || view.filterImporting ? 'disabled' : ''}>${t('filterRoute')}${icon('arrow')}</button></div></form>${filterImportCard()}<button class="text-link tutorial-link" id="tutorial-link">${t('ownSave')}</button></section>`;
}
function syncPage() {
  return `<section class="page"><h1>${t('syncTitle')}</h1>${buildSummary()}<div class="card"><div class="sync-grid">${SYNC_OPTIONS.map(key => `<label class="sync-option"><input type="checkbox" data-sync="${key}" ${state.options[key] ? 'checked' : ''}><span><strong>${t(key)}</strong><small>${t(key+'Hint')}</small></span></label>`).join('')}</div><label class="max-roll-option"><span><strong>${t('maxRolls')}</strong><small>${t('maxRollsHint')}</small></span><input type="checkbox" role="switch" data-sync="maxRolls" ${state.options.maxRolls ? 'checked' : ''}></label><div class="max-roll-option campaign-option"><div class="campaign-copy"><div class="option-heading"><label for="campaign-skip"><strong>${t('campaignSkip')}</strong></label><span class="hint-trigger"><button type="button" class="hint-button" aria-label="${t('campaignSkipInfo')}" aria-describedby="campaign-skip-hint">!</button><span role="tooltip" id="campaign-skip-hint">${t('campaignSkipHint')}</span></span></div><small id="campaign-skip-description">${t('campaignSkipDescription')}</small></div><input id="campaign-skip" type="checkbox" role="switch" data-sync="campaignSkip" aria-describedby="campaign-skip-description" ${state.options.campaignSkip ? 'checked' : ''}></div></div><p class="hint">${t('replaceHint')}</p>${notice()}${actions()}</section>`;
}
function uploadPage() {
  const entries = [...state.files.values()];
  const loadedCharacter = entries.find(entry => entry.original.kind === 'character')?.original;
  const expected = expectedStashName(loadedCharacter) ?? 'STASH_CYCLE_*';
  return `<section class="page"><h1>${t('uploadTitle')}</h1><p class="intro">${t('uploadHint')}</p><div class="card"><div class="drop-area" id="drop-area">${icon('upload')}<strong>${t('drop')}</strong><button class="button secondary" data-choose ${state.readingFiles ? 'disabled' : ''}>${t(state.readingFiles ? 'readingFiles' : entries.length ? 'addFiles' : 'choose')}</button></div><p class="hint">${t('uploadKinds')}</p><div class="file-kinds"><div><span>${t('characterFile')} <small>${t('required')}</small></span><code>1CHARACTERSLOT_BETA_*</code></div><div><span>${t('stashFile')} <small>${t('optional')}</small></span><code>${esc(expected)}</code></div></div>${entries.length ? `<ul class="file-list">${entries.map(({original}) => `<li>${icon('file')}<span><strong>${esc(original.kind === 'character' ? original.data.characterName : t('stashFile'))}</strong><code>${esc(original.name)}</code></span><button class="icon-button" data-remove="${esc(original.name)}" aria-label="${t('remove')} ${esc(original.name)}" ${state.readingFiles ? 'disabled' : ''}>${icon('close')}</button></li>`).join('')}</ul>` : ''}</div>${location()}${notice()}${actions()}</section>`;
}
function timelineLabel(run) { return `${localized(run.name)} · ${t(run.difficulty === 1 ? 'empowered' : 'normal')}`; }
function timelineEditor() {
  const timelines = getTimelines(character());
  const selected = timelines.find(run => run.index === view.timeline) ?? timelines[0];
  view.timeline = selected?.index ?? null;
  if (!selected) return `<section class="card world-card"><h2>${t('timelineTitle')}</h2><p class="hint">${t(state.options.campaignSkip ? 'campaignTimelineEmpty' : 'timelineEmpty')}</p></section>`;
  return `<section class="card world-card"><h2>${t('timelineTitle')}</h2><label for="timeline-select">${t('timelineSelect')}</label><select id="timeline-select">${timelines.map(run => `<option value="${run.index}" ${run.index === selected.index ? 'selected' : ''}>${esc(timelineLabel(run))}</option>`).join('')}</select><div class="field-grid">${['stability','corruption'].map(field => {
    const value = draft(`timeline:${selected.index}:${field}`, selected[field]);
    const min = field === 'stability' ? 0 : selected.minCorruption;
    const max = field === 'stability' ? selected.maxStability : selected.maxCorruption;
    return `<div class="field"><label for="timeline-${field}">${t(field)}</label><div class="quick-input"><input id="timeline-${field}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${esc(value)}" data-timeline-field="${field}"><button class="button secondary small" data-increment="${field}">${t(field === 'stability' ? 'addStability' : 'addCorruption')}</button></div><small>${max === 2147483647 ? `${t('atLeast')} ${formatted(min)}` : `${t('range')} ${formatted(min)}–${formatted(max)}`}</small></div>`;
  }).join('')}</div><p class="hint compact">${t('capHint')}</p></section>`;
}
function factionEditor() {
  const factions = getFactions(character(), stash());
  const selected = factions.find(faction => faction.id === view.faction) ?? factions[0];
  view.faction = selected?.id ?? null;
  if (!selected) return `<section class="card world-card"><h2>${t('factionTitle')}</h2><p class="hint">${t(stash() ? 'factionMissing' : 'factionEmpty')}</p>${!stash() && expectedStashName(character()) ? `<code>${esc(expectedStashName(character()))}</code>` : ''}</section>`;
  const rankValue = draft(`faction:${selected.id}:rank`, selected.rank);
  const info = factionRankInfo(selected.id, Number(rankValue), Number(rankValue) === selected.rank ? selected.reputation : 0);
  return `<section class="card world-card"><h2>${t('factionTitle')}</h2><label for="faction-select">${t('factionSelect')}</label><select id="faction-select">${factions.map(faction => `<option value="${faction.id}" ${faction.id === selected.id ? 'selected' : ''}>${esc(localized(faction.name))}</option>`).join('')}</select><div class="field-grid"><div class="field"><label for="faction-rank">${t('rank')}</label><select id="faction-rank" ${selected.rankEditable ? '' : 'disabled'}>${Array.from({length:selected.maxRank+1},(_,rank)=>rank).filter(rank=>rank || selected.rank===0).map(rank => `<option value="${rank}" ${rank === Number(rankValue) ? 'selected' : ''}>${language === 'zh' ? `${rank} ${t('rankOption')}` : `${t('rankOption')} ${rank}`}${rank === selected.maxRank ? ` · ${t('rankMax')}` : ''}</option>`).join('')}</select></div>${!selected.harbinger ? `<div class="field"><label for="faction-favor">${t('favor')}</label><input id="faction-favor" type="number" inputmode="numeric" min="0" max="2147483647" step="1" value="${esc(draft(`faction:${selected.id}:favor`,selected.favor))}"></div>` : ''}</div>${selected.harbinger ? `<p class="hint">${t(selected.rankEditable ? 'harbingerHint' : 'rankUnavailable')}</p>` : `<div class="reputation-summary"><span>${t('reputation')}<strong>${formatted(info.reputation)}${info.next != null ? ` / ${formatted(info.next)}` : ''}</strong></span><span>${t('totalReputation')}<strong>${formatted(info.total)}</strong></span></div><p class="hint compact">${t('rankReset')}</p><details class="rank-details"><summary>${t('rankTable')}</summary><div class="table-scroll"><table><thead><tr><th>${t('rank')}</th><th>${t('totalReputation')}</th><th>${t('nextRankCost')}</th></tr></thead><tbody>${Array.from({length:selected.maxRank},(_,i)=>factionRankInfo(selected.id,i+1)).map(rank => `<tr${rank.rank === info.rank ? ' class="selected-row"' : ''}><td>${rank.rank}</td><td>${formatted(rank.threshold)}</td><td>${rank.next == null ? t('rankMax') : formatted(rank.next)}</td></tr>`).join('')}</tbody></table></div></details>`}</section>`;
}
function worldPage() {
  return `<section class="page"><h1>${t('worldTitle')}</h1><div class="world-sections">${timelineEditor()}${factionEditor()}</div>${notice()}${actions()}</section>`;
}
function skillName(id) { return plannerData.skills[id]?.name ?? (id === 'na28' ? (language === 'zh' ? '移动' : 'Move') : /^evade\d$/.test(id) ? (language === 'zh' ? '闪避' : 'Evade') : id || t('empty')); }
function reviewRows(entry) {
  const rows = [], handled = new Set();
  const before = entry.original.data, after = entry.doc.data;
  const push = (label, a, b, note = '', group = 'general') => rows.push({label, before:a, after:b, note, group});
  for (const change of entry.changes) {
    const path = change.path, root = path[0];
    if (['savedQuests','unlockedWaypointScenes','portalUnlocked','focusedQuest','lastVisitedTownScene'].includes(root) && state.options.campaignSkip) {
      if (handled.has('campaign')) continue;
      handled.add('campaign');
      const a = campaignSummary(before), b = campaignSummary(after);
      if (a.completedQuests !== b.completedQuests) push(t('campaignQuests'), `${a.completedQuests} / ${a.totalQuests}`, `${b.completedQuests} / ${b.totalQuests}`);
      if (a.waypoints !== b.waypoints) push(t('campaignWaypoints'), `${a.waypoints} / ${a.totalWaypoints}`, `${b.waypoints} / ${b.totalWaypoints}`);
      if (a.passiveRewards !== b.passiveRewards) push(t('campaignPassiveRewards'), a.passiveRewards, b.passiveRewards);
      if (a.idolUnlocks !== b.idolUnlocks) push(t('campaignIdolRewards'), `${a.idolUnlocks} / ${campaignData.maximumIdolUnlocks}`, `${b.idolUnlocks} / ${campaignData.maximumIdolUnlocks}`);
      if (before.lastVisitedTownScene !== after.lastVisitedTownScene) push(t('campaignSpawn'), before.lastVisitedTownScene === campaignData.spawnScene ? t('monolithHub') : before.lastVisitedTownScene || t('empty'), t('monolithHub'));
      if (before.focusedQuest !== after.focusedQuest && number(before.focusedQuest) !== number(after.focusedQuest)) push(t('campaignTrackedQuest'), before.focusedQuest, t('empty'));
      if (before.portalUnlocked !== after.portalUnlocked) push(t('campaignPortal'), t(before.portalUnlocked ? 'unlocked' : 'locked'), t('unlocked'));
    } else if (['savedItems','savedCharacterTree','savedSkillTrees','abilityBar'].includes(root)) {
      if (handled.has(root)) continue;
      handled.add(root);
      if (root === 'savedItems') {
        const oldItems = getEquipment(before).filter(item => item.group !== 'inventory');
        const newItems = getEquipment(after).filter(item => item.group !== 'inventory');
        const key = item => `${item.group}:${item.slot}:${item.group === 'idols' ? `${item.inventoryPosition?.x},${item.inventoryPosition?.y}` : ''}`;
        const oldMap = new Map(oldItems.map(item => [key(item),item])), newMap = new Map(newItems.map(item => [key(item),item]));
        for (const id of new Set([...oldMap.keys(),...newMap.keys()])) {
          const a=oldMap.get(id), b=newMap.get(id), item=b??a;
          if (JSON.stringify(before.savedItems[a?.index]) === JSON.stringify(after.savedItems[b?.index])) continue;
          const aName=a?localized(a.name):t('empty'), bName=b?localized(b.name):t('empty');
          const label=item.group==='idols'?`${t('idols')} · ${number(item.inventoryPosition?.x)+1},${number(item.inventoryPosition?.y)+1}`:item.group==='blessings'?`${t('blessings')} · ${localized(worldData.timelines[item.slot.replace('blessing','')]?.name)}`:localized(item.slotLabel);
          push(label,aName,bName,aName===bName?t('synchronized'):'',item.group);
        }
      } else if (root === 'savedCharacterTree') {
        const allocation = tree => `${t('allocated')} ${(tree?.nodePoints ?? []).reduce((sum,value)=>sum+number(value),0)} · ${t('unspent')} ${number(tree?.unspentPoints)}`;
        push(t('passiveAllocation'),allocation(before.savedCharacterTree),allocation(after.savedCharacterTree),'','allocations');
      } else if (root === 'savedSkillTrees') {
        const skills = trees => (trees ?? []).map(tree => skillName(tree.treeID)).join(', ') || t('empty');
        push(t('skillAllocation'),skills(before.savedSkillTrees),skills(after.savedSkillTrees),t('synchronized'),'allocations');
      } else push(t('skillBar'),(before.abilityBar??[]).map(skillName).join(', '),(after.abilityBar??[]).map(skillName).join(', '),'','allocations');
    } else if (root === 'monolithRuns') {
      const run=after.monolithRuns[path[1]], name=worldData.timelines[String(run.timelineID)]?.name??String(run.timelineID);
      push(`${localized(name)} · ${t(number(run.difficultyIndex)===1?'empowered':'normal')} · ${t(path.at(-1)==='stability'?'stability':'corruption')}`,change.before,change.after);
    } else if (root === 'factions') {
      const name=worldData.factions[path[1]]?.name??path[1];
      push(`${localized(name)} · ${t({rank:'rank',reputation:'reputation',favor:'favor',currentprogression:'harbingerProgress'}[path.at(-1)]??'factionTitle')}`,change.before,change.after);
    } else if(root==='characterClass')push(t('characterClass'),classes[language][number(before.characterClass)],classes[language][number(after.characterClass)]);
    else if(root==='chosenMastery')push(t('mastery'),className(before.characterClass,before.chosenMastery),className(after.characterClass,after.chosenMastery));
    else if(root==='level')push(t('level'),change.before,change.after);
    else if(root==='currentExp')push(t('experience'),change.before,change.after);
    else if(!['originalMastery','characterTreeNodeProgression'].includes(root))push(path.join('.'),change.before,change.after);
  }
  const table=items=>`<div class="table-scroll"><table class="review-table"><thead><tr><th>${t('field')}</th><th>${t('before')}</th><th>${t('after')}</th></tr></thead><tbody>${items.map(row=>`<tr><th scope="row">${esc(row.label)}</th><td>${esc(formatted(row.before))}</td><td>${esc(formatted(row.after))}${row.note?`<small>${esc(row.note)}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`;
  return `${rows.some(row=>row.group==='general')?table(rows.filter(row=>row.group==='general')):''}${['equipment','idols','blessings','allocations'].map(group=>{
    const items=rows.filter(row=>row.group===group);
    return items.length?`<details class="review-details"><summary>${t(group)} <span>${items.length} ${t('changes')}${state.options.maxRolls&&group!=='allocations'?` · ${t('maxRolls')}`:''}</span></summary>${table(items)}</details>`:'';
  }).join('')}`;
}
function reviewPage() {
  const changed=flow.changedFiles();
  return `<section class="page review"><h1>${t('reviewTitle')}</h1><p class="intro">${t('reviewHint')}</p>${changed.map(entry=>`<section class="card review-file"><h2>${esc(entry.doc.kind==='character'?entry.doc.data.characterName:t('stashFile'))}</h2><code class="file-caption">${esc(entry.doc.outputName)}</code>${reviewRows(entry)}</section>`).join('')||`<div class="card"><p class="hint">${t('noChanges')}</p></div>`}${state.warnings.length?`<details class="sync-notes"><summary>${t('warnings')} (${state.warnings.length})</summary><ul>${state.warnings.map(message=>`<li>${esc(errorText({message}))}</li>`).join('')}</ul></details>`:''}<div class="card download-card"><label class="acknowledgement"><input type="checkbox" id="acknowledge" ${state.acknowledged?'checked':''}><span>${t('ack')}</span></label><div class="download-files">${changed.map(entry=>`<div><code>${esc(entry.doc.outputName)}</code><button class="button primary" data-download="${esc(entry.doc.outputName)}" ${state.acknowledged?'':'disabled'}>${icon(view.downloadedFiles.has(entry.doc.outputName)?'check':'download')}${t(entry.doc.kind==='character'?'downloadCharacter':'downloadStash')}</button></div>`).join('')}</div>${changed.length>1?`<p class="hint compact">${t('separateFiles')}</p>`:''}<p class="hint">${t('downloadHint')}</p></div>${location()}${notice()}${actions(false)}</section>`;
}
function tutorial() {
  return `<dialog id="tutorial-dialog" aria-labelledby="tutorial-title"><div class="dialog-head"><h2 id="tutorial-title">${t('tutorialTitle')}</h2><button class="icon-button" id="close-tutorial" aria-label="${t('close')}">${icon('close')}</button></div><ol>${t('tutorialSteps').map(step=>`<li>${esc(step)}</li>`).join('')}</ol><a class="text-link" href="${plannerUrl()}" target="_blank" rel="noopener noreferrer">${t('openPlanner')}${icon('external')}</a><div class="demo-head"><span>${t('tutorialDemo')}</span><button class="text-link" id="replay-tutorial">${t('replay')}</button></div><img id="tutorial-image" src="./tutorial/save-to-planner.gif" alt="${t('tutorialAlt')}" width="1513" height="1127"></dialog>`;
}
function filterImportButton() {
  const disabled = state.loading || state.readingFiles || view.filterImporting;
  const title = view.filterImporting ? (language === 'zh' ? '正在恢复…' : 'Restoring…') : (language === 'zh' ? '导入过滤器 XML' : 'Import filter XML');
  return `<button type="button" class="button secondary" id="filter-import" ${disabled ? 'disabled' : ''}>${title}</button>`;
}
function filterImportCard() {
  return `<section class="card filter-import-card"><h2>${language === 'zh' ? '继续编辑过滤器' : 'Continue editing a filter'}</h2><p class="hint">${language === 'zh' ? '导入本工具下载的 XML，恢复词缀、隐藏类型和配色，无需重新输入配装链接。' : 'Import an XML downloaded from this tool to restore affixes, hidden types and colors. No build link is needed.'}</p>${filterImportButton()}</section>`;
}
function filterBuildSummary() {
  const build = filterView.filterDraft?.build ?? {};
  const title = build.classId == null ? (language === 'zh' ? '已导入的过滤器' : 'Imported filter') : className(build.classId, build.masteryId);
  return `<div class="build-summary"><div><strong>${esc(title)}</strong>${build.level == null ? '' : `<span>${t('level')} ${build.level}</span>`}</div>${build.sourceUrl ? `<a href="${esc(build.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('viewBuild')}${icon('external')}</a>` : ''}</div>`;
}
async function importFilterFile(file) {
  if (!file || state.loading || state.readingFiles || view.filterImporting) return false;
  view.filterImporting = true; state.error = null; view.notice = ''; render();
  try {
    if (file.size > MAX_FILTER_XML_BYTES) throw new Error('过滤器文件最多 2 MB / Filter file must be no larger than 2 MB');
    const restored = restoreValueFilterDraft(await file.text());
    filterView.filterDraft = restored; filterView.filterStep = 5; filterView.filterSelected = null;
    filterView.filterUi = null; filterView.filterDirty = false; filterView.build = null;
    language = restored.language;
    try { localStorage.setItem('le-save-editor-language', language); } catch { /* Optional preference storage. */ }
    view.mode = 'filter';
    view.notice = language === 'zh' ? '已恢复过滤器设置，可以微调后重新下载。' : 'Filter settings restored. Adjust them and download a new XML.';
    return true;
  } catch (error) { state.error = error; return false; }
  finally { view.filterImporting = false; renderStep(-1); }
}
function filterPage() {
  return `<section class="page filter-route"><div class="filter-route-heading"><h1>${t('filterRoute')}</h1><div class="filter-route-heading-actions">${filterImportButton()}<button class="button secondary" id="filter-back">${t('returnToLink')}</button></div></div>${filterBuildSummary()}${notice()}${renderFilterWorkbench(filterView)}</section>`;
}
async function importSelectedBuild(url, mode = 'sync') {
  if (view.filterImporting) return;
  const previous = state.step;
  view.notice = ''; state.error = null;
  if (state.build && !state.loading && url.trim() === view.loadedBuildUrl) {
    if (mode === 'filter') {
      if (!filterView.filterDraft || filterView.filterDraft.build?.id !== state.build.id) { filterView.filterDraft = createFilterDraft(state.build); filterView.filterStep = 1; filterView.filterUi = null; filterView.filterDirty = false; }
      filterView.build = state.build;
    }
    view.mode = mode; state.step = 1; renderStep(-1); return;
  }
  view.mode = 'sync';
  const loading = flow.importBuild(url); render();
  const success = await loading;
  if (success) {
    view.loadedBuildUrl = url.trim();
    filterView.filterDraft = null; filterView.filterDirty = false; filterView.filterStep = 1; filterView.filterSelected = null; filterView.filterUi = null;
    filterView.build = state.build;
    try {
      if (mode === 'filter') filterView.filterDraft = createFilterDraft(state.build);
      view.mode = mode;
    } catch (error) { state.error = error; state.step = 0; }
  }
  renderStep(previous);
}
function render() {
  filterView.language=language;
  document.documentElement.lang=language==='zh'?'zh-CN':'en';document.title=`LE Save Editor · ${view.mode==='filter'?t('filterRoute'):t('steps')[state.step]}`;
  app.innerHTML=`<header class="site-header"><a class="brand" href="#" id="brand-link">LE Save Editor</a><div class="language-switch" role="group" aria-label="Language"><button data-language="zh" aria-pressed="${language==='zh'}">中文</button><button data-language="en" aria-pressed="${language==='en'}">English</button></div></header>${view.mode==='filter'?'':`<nav class="stepper" aria-label="${language==='zh'?'操作步骤':'Steps'}">${t('steps').map((label,index)=>`<button data-step="${index}" ${index>=state.step||state.loading||state.readingFiles?'disabled':''} ${index===state.step?'aria-current="step"':''} class="${index<state.step?'complete':''}"><span class="step-index">${index<state.step?icon('check'):index+1}</span><span>${label}</span></button>`).join('')}</nav>`}<main id="main-content" tabindex="-1">${view.mode==='filter'?filterPage():[linkPage,syncPage,uploadPage,worldPage,reviewPage][state.step]()}</main><footer><span>${t('localOnly')}</span><span>${t('version')}<a href="https://github.com/noobdawn/LESaveEditor" target="_blank" rel="noopener noreferrer">${t('source')}</a></span></footer><input type="file" id="save-input" multiple hidden aria-label="${t('choose')}"><input type="file" id="filter-xml-input" accept=".xml,application/xml,text/xml" hidden aria-label="${language === 'zh' ? '选择过滤器 XML' : 'Choose filter XML'}">${view.tutorial?tutorial():''}`;
  bindEvents();if(view.tutorial)document.querySelector('#tutorial-dialog').showModal();
}
function renderStep(previous) { render();if(previous!==state.step){window.scrollTo(0,0);document.querySelector('#main-content').focus({preventScroll:true});} }
function downloadFile(file, mime = 'application/octet-stream') {
  const url=URL.createObjectURL(new Blob([file.text],{type:mime}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function loadFiles(files) { const loading=flow.addFiles(files);render();await loading;view.downloaded=false;render(); }
function bindEvents() {
  document.querySelectorAll('[data-language]').forEach(button=>button.onclick=()=>{language=button.dataset.language;try{localStorage.setItem('le-save-editor-language',language);}catch{}view.notice='';render();});
  document.querySelector('#brand-link').onclick=event=>{event.preventDefault();if(state.loading||state.readingFiles)return;const previous=state.step;view.mode='sync';flow.goBack(0);renderStep(previous);};
  document.querySelectorAll('[data-step]').forEach(button=>button.onclick=()=>{const previous=state.step;flow.goBack(Number(button.dataset.step));renderStep(previous);});
  document.querySelector('#back-button')?.addEventListener('click',()=>{const previous=state.step;flow.goBack();view.notice='';renderStep(previous);});
  document.querySelector('#build-form')?.addEventListener('submit',event=>{event.preventDefault();importSelectedBuild(document.querySelector('#build-url').value,event.submitter?.value||'sync');});
  document.querySelector('#filter-import')?.addEventListener('click', () => document.querySelector('#filter-xml-input').click());
  document.querySelector('#filter-xml-input')?.addEventListener('change', event => { const file = event.target.files?.[0]; event.target.value = ''; return importFilterFile(file); });
  document.querySelector('#filter-back')?.addEventListener('click',()=>{view.mode='sync';flow.goBack(0);view.notice='';renderStep(-1);});
  if(view.mode==='filter') bindFilterWorkbench(filterView,{render,notify:(message,error=false)=>{if(error)state.error=new Error(message);else{state.error=null;view.notice=message;}render();},downloadFile:(text,name,mime)=>downloadFile({text,name},mime)});
  document.querySelector('#build-url')?.addEventListener('input',event=>{state.buildUrl=event.target.value;});
  document.querySelectorAll('[data-sync]').forEach(input=>input.onchange=()=>flow.setOption(input.dataset.sync,input.checked));
  document.querySelector('#next-button')?.addEventListener('click',()=>{const previous=state.step;view.notice='';view.downloaded=false;view.downloadedFiles.clear();if(state.step===1)state.step=2;else if(state.step===2)flow.synchronize();else if(state.step===3)flow.prepareReview();renderStep(previous);});
  document.querySelectorAll('[data-choose]').forEach(button=>button.onclick=()=>document.querySelector('#save-input').click());
  document.querySelector('#save-input').onchange=event=>loadFiles(event.target.files);
  document.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{flow.removeFile(button.dataset.remove);render();});
  const drop=document.querySelector('#drop-area');
  if(drop){drop.ondragover=event=>{event.preventDefault();drop.classList.add('dragging');};drop.ondragleave=()=>drop.classList.remove('dragging');drop.ondrop=event=>{event.preventDefault();drop.classList.remove('dragging');loadFiles(event.dataTransfer.files);};}
  document.querySelector('#timeline-select')?.addEventListener('change',event=>{view.timeline=Number(event.target.value);render();document.querySelector('#timeline-select').focus({preventScroll:true});});
  document.querySelectorAll('[data-timeline-field]').forEach(input=>input.oninput=()=>flow.setWorldEdit({kind:'timeline',index:view.timeline,field:input.dataset.timelineField,value:input.value}));
  document.querySelectorAll('[data-increment]').forEach(button=>button.onclick=()=>{const field=button.dataset.increment,input=document.querySelector(`#timeline-${field}`);if(!input.reportValidity()||!/^\d+$/.test(input.value))return;input.value=String(Math.min(Number(input.max),Number(input.value)+(field==='stability'?1000:50)));flow.setWorldEdit({kind:'timeline',index:view.timeline,field,value:input.value});});
  document.querySelector('#faction-select')?.addEventListener('change',event=>{view.faction=event.target.value;render();document.querySelector('#faction-select').focus({preventScroll:true});});
  document.querySelector('#faction-rank')?.addEventListener('change',event=>{flow.setWorldEdit({kind:'faction',id:view.faction,field:'rank',value:event.target.value});render();document.querySelector('#faction-rank').focus({preventScroll:true});});
  document.querySelector('#faction-favor')?.addEventListener('input',event=>flow.setWorldEdit({kind:'faction',id:view.faction,field:'favor',value:event.target.value}));
  document.querySelector('#acknowledge')?.addEventListener('change',event=>{state.acknowledged=event.target.checked;document.querySelectorAll('[data-download]').forEach(button=>{button.disabled=!state.acknowledged;});});
  document.querySelectorAll('[data-download]').forEach(button=>button.onclick=()=>{
    try{const files=flow.downloads(),file=files.find(file=>file.name===button.dataset.download);if(!file)return;downloadFile(file);view.downloadedFiles.add(file.name);view.downloaded=files.every(file=>view.downloadedFiles.has(file.name));view.notice=t('downloaded');render();document.querySelector(`[data-download="${CSS.escape(file.name)}"]`)?.focus({preventScroll:true});}
    catch(error){state.error=error;render();}
  });
  document.querySelector('#tutorial-link')?.addEventListener('click',()=>{view.tutorial=true;render();});
  const dialog=document.querySelector('#tutorial-dialog');
  if(dialog){const close=()=>{view.tutorial=false;render();document.querySelector('#tutorial-link')?.focus();};document.querySelector('#close-tutorial').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}});document.querySelector('#replay-tutorial').onclick=()=>{document.querySelector('#tutorial-image').src=`./tutorial/save-to-planner.gif?replay=${Date.now()}`;};}
}
window.addEventListener('beforeunload',event=>{if(filterView.filterDirty || state.files.size&&!(state.step===4&&view.downloaded&&state.acknowledged)){event.preventDefault();event.returnValue='';}});
window.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
window.addEventListener('drop',event=>event.preventDefault());
render();
