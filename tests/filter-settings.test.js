import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createValueFilterDraft, generateValueFilter, getValueFilterSettings, restoreValueFilterDraft } from '../web/src/core/value-filter.js';
import { encodeFilterSettings, decodeFilterSettings, MAX_FILTER_XML_BYTES } from '../web/src/core/filter-settings.js';

const source = { ...JSON.parse(readFileSync(new URL('./fixtures/planner-om6w3Ypq.json', import.meta.url), 'utf8')), id: 'om6w3Ypq', sourceUrl: 'https://www.lastepochtools.com/planner/om6w3Ypq' };
const commentPattern = /<!-- LESaveEditor-settings:[\s\S]*?-->/g;
function customized() {
  const draft = createValueFilterDraft(source);
  draft.name = '微调 -- <隐藏> & "神像" 😀'; draft.language = 'en';
  draft.uniqueIds = [277]; draft.setIds = [79];
  draft.highAffixIds = [26, 73, 1083]; draft.mediumAffixIds = [22, 25];
  draft.idols.push({ id: 'disabled-empty', baseTypeId: 25, subTypeId: 0, affixIds: [], enabled: false });
  draft.exclusions = { equipmentTypeIds: [12, 13, 14], idolTypeIds: [33], idolBaseKeys: ['30:4', '30:9', '30:14'] };
  Object.assign(draft.groups.equipment_leveling, { show: false, color: 17, emphasized: true });
  draft.groups.glyph.color = 9;
  draft.options = { rareUniqueThreshold: 0.95, rareSetThreshold: 0.7 };
  return draft;
}
function editedXml(xml, mutate) {
  const settings = decodeFilterSettings(xml);
  mutate(settings);
  return xml.replace(commentPattern, encodeFilterSettings(settings));
}

test('XML settings round-trip restores all editable choices and produces identical native rules', () => {
  const draft = customized(), before = structuredClone(draft), output = generateValueFilter(draft);
  const restored = restoreValueFilterDraft(output.xml);
  assert.deepEqual(getValueFilterSettings(restored), getValueFilterSettings(draft));
  assert.deepEqual(generateValueFilter(restored).rules, output.rules);
  assert.equal(generateValueFilter(restored).xml, output.xml, 'export/import must be deterministic');
  assert.deepEqual(draft, before);
  restored.name = '第二次编辑'; restored.groups.glyph.color = 14; restored.mediumAffixIds.push(1);
  const again = restoreValueFilterDraft(generateValueFilter(restored).xml);
  assert.equal(again.name, '第二次编辑'); assert.equal(again.groups.glyph.color, 14);
  assert.ok(again.mediumAffixIds.includes(1));
  assert.equal(draft.groups.glyph.color, 9, 'imported edits cannot mutate the original draft');
});

test('saved settings use a single safe XML comment outside native rules, with compact build context', () => {
  const output = generateValueFilter(customized()), comments = output.xml.match(commentPattern);
  assert.equal(comments.length, 1);
  const comment = comments[0];
  assert.ok(output.xml.indexOf(comment) < output.xml.indexOf('<rules>'));
  assert.doesNotMatch(comment.slice(4, -3), /--|<Rule>|<Condition/);
  assert.equal((output.xml.match(/<Rule>/g) ?? []).length, output.rules.length);
  const saved = decodeFilterSettings(output.xml);
  assert.equal(saved.draft.name, '微调 -- <隐藏> & "神像" 😀');
  assert.equal(saved.draft.build.level, 100);
  assert.equal(saved.draft.build.classId, 3);
  assert.equal(saved.draft.build.sourceUrl, source.sourceUrl);
  assert.ok(saved.draft.analysis.initialSelections.high.includes(22));
  assert.equal(Object.hasOwn(saved.draft.analysis, 'targets'), false);
  assert.equal(Object.hasOwn(saved.draft, 'data'), false);
  assert.deepEqual(restoreValueFilterDraft('\uFEFF<?xml version="1.0" encoding="utf-8"?>\n' + output.xml), restoreValueFilterDraft(output.xml));
});

test('missing, duplicate, corrupt, oversized and unsupported metadata are rejected clearly', () => {
  const xml = generateValueFilter(customized()).xml;
  assert.throws(() => restoreValueFilterDraft(xml.replace(commentPattern, '')), { code: 'FILTER_SETTINGS_NOT_FOUND' });
  assert.throws(() => restoreValueFilterDraft(xml.replace('</ItemFilter>', `${xml.match(commentPattern)[0]}\n</ItemFilter>`)), { code: 'INVALID_FILTER_SETTINGS' });
  assert.throws(() => restoreValueFilterDraft(xml.replace(/LESaveEditor-settings:v1/, 'LESaveEditor-settings:v2')), { code: 'UNSUPPORTED_FILTER_SETTINGS' });
  assert.throws(() => restoreValueFilterDraft(xml.replace(commentPattern, '<!-- LESaveEditor-settings:v1 Zm9v -->')), { code: 'INVALID_FILTER_SETTINGS' });
  assert.throws(() => restoreValueFilterDraft('<html>not a filter</html>'), { code: 'INVALID_FILTER_XML' });
  assert.throws(() => restoreValueFilterDraft('<!DOCTYPE ItemFilter>' + xml), { code: 'INVALID_FILTER_XML' });
  assert.throws(() => restoreValueFilterDraft('x'.repeat(MAX_FILTER_XML_BYTES + 1)), { code: 'FILTER_XML_TOO_LARGE' });
  assert.throws(() => encodeFilterSettings({ extra: 'x'.repeat(256 * 1024) }), { code: 'FILTER_SETTINGS_TOO_LARGE' });
});

test('restored settings pass domain validation and discard unrelated JSON properties', () => {
  const xml = generateValueFilter(customized()).xml;
  assert.throws(() => restoreValueFilterDraft(editedXml(xml, saved => { saved.draft.highAffixIds = [65535]; })), { code: 'UNKNOWN_FILTER_ID' });
  assert.throws(() => restoreValueFilterDraft(editedXml(xml, saved => { saved.draft.groups.glyph.color = 99; })), { code: 'INVALID_FILTER_VALUE' });
  assert.throws(() => restoreValueFilterDraft(editedXml(xml, saved => { saved.draft.groups = {}; })), { code: 'INVALID_FILTER_SETTINGS' });
  assert.throws(() => restoreValueFilterDraft(editedXml(xml, saved => { saved.draft.build.sourceUrl = 'javascript:alert(1)'; })), { code: 'INVALID_URL' });
  assert.throws(() => restoreValueFilterDraft(editedXml(xml, saved => { saved.draft.schemaVersion = 999; })), { code: 'UNSUPPORTED_FILTER_SETTINGS' });
  const restored = restoreValueFilterDraft(editedXml(xml, saved => {
    saved.draft.script = '<script>alert(1)</script>';
    saved.draft.groups.glyph.injected = { polluted: true };
  }));
  assert.equal(Object.hasOwn(restored, 'script'), false);
  assert.equal(Object.hasOwn(restored.groups.glyph, 'injected'), false);
  assert.equal({}.polluted, undefined);
});

test('unresolved-build guards survive a round-trip and catalog changes enable visible fallbacks', () => {
  const changed = structuredClone(source); changed.dataVersion = 'Version 2.0.0';
  const draft = createValueFilterDraft(changed), xml = generateValueFilter(draft).xml;
  const restored = restoreValueFilterDraft(xml);
  assert.equal(restored.analysis.hasUnresolvedTargets, true);
  assert.ok(restored.analysis.warnings.some(w => w.code === 'BUILD_VERSION'));
  assert.equal(restored.groups.equipment_other.show, true);
  assert.throws(() => restoreValueFilterDraft(editedXml(xml, saved => { saved.draft.groups.equipment_other.show = false; })), { code: 'UNRESOLVED_HIDE_TARGETS' });
  const current = generateValueFilter(customized()).xml;
  const migrated = restoreValueFilterDraft(editedXml(current, saved => { saved.gameVersion = '9.9.9'; }));
  assert.equal(migrated.analysis.hasUnresolvedTargets, true);
  assert.equal(migrated.groups.equipment_other.show, true);
  assert.equal(migrated.groups.idol_other.show, true);
  assert.ok(migrated.analysis.warnings.some(w => w.code === 'FILTER_CATALOG_CHANGED'));
});
