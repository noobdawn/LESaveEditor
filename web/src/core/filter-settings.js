import { FilterError } from './loot-filter.js';

export const FILTER_SETTINGS_VERSION = 1;
export const MAX_FILTER_XML_BYTES = 2 * 1024 * 1024;
const MAX_SETTINGS_BYTES = 256 * 1024;
const MARKER = 'LESaveEditor-settings';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, zh, en) => { throw new FilterError(code, zh, en); };

/** ASCII-only comment data cannot close a comment or introduce native filter elements. */
export function encodeFilterSettings(settings) {
  const bytes = new TextEncoder().encode(JSON.stringify({ format: 'LESaveEditorFilterSettings', version: FILTER_SETTINGS_VERSION, ...settings }));
  if (bytes.length > MAX_SETTINGS_BYTES) fail('FILTER_SETTINGS_TOO_LARGE', '构造设置过大，无法保存到 XML', 'Filter settings are too large to save in XML');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const encoded = btoa(binary).match(/.{1,120}/g).join('\n    ');
  return `  <!-- ${MARKER}:v${FILTER_SETTINGS_VERSION}\n    ${encoded}\n  -->`;
}

/** Read our saved settings, never execute or reverse-engineer arbitrary native rules. */
export function decodeFilterSettings(xml) {
  if (typeof xml !== 'string' || new TextEncoder().encode(xml).length > MAX_FILTER_XML_BYTES) fail('FILTER_XML_TOO_LARGE', '过滤器文件过大或格式无效（最多 2 MB）', 'Invalid filter file or file exceeds 2 MB');
  const text = xml.replace(/^\uFEFF/, '');
  const plain = text.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (/<!DOCTYPE|<!ENTITY/i.test(plain) || !/^(?:<\?xml\s[^]*?\?>\s*)?<ItemFilter(?:\s[^<>]*?)?>[\s\S]*<\/ItemFilter>\s*$/.test(plain)) fail('INVALID_FILTER_XML', '请选择有效的 ItemFilter XML 文件', 'Choose a valid ItemFilter XML file');
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (document.getElementsByTagName('parsererror').length || document.documentElement?.tagName !== 'ItemFilter') fail('INVALID_FILTER_XML', 'XML 文件结构无效', 'Invalid XML document structure');
  }
  const comments = [...text.matchAll(/<!--([\s\S]*?)-->/g)].map(match => match[1].trim()).filter(value => value.startsWith(`${MARKER}:`));
  if (!comments.length) fail('FILTER_SETTINGS_NOT_FOUND', '这个 XML 没有可恢复的构造设置，请使用本工具新版下载的原文件', 'This XML has no saved editor settings. Use the original file downloaded by this version of the tool');
  if (comments.length !== 1) fail('INVALID_FILTER_SETTINGS', 'XML 中存在重复的构造设置', 'XML contains duplicate saved filter settings');
  const header = comments[0].match(/^LESaveEditor-settings:v(\d+)\s+([\s\S]+)$/);
  if (!header) fail('INVALID_FILTER_SETTINGS', '构造设置注释损坏', 'Saved settings comment is damaged');
  if (Number(header[1]) !== FILTER_SETTINGS_VERSION) fail('UNSUPPORTED_FILTER_SETTINGS', '此文件的构造设置版本暂不支持', 'This saved-settings version is not supported');
  const encoded = header[2].replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length > Math.ceil(MAX_SETTINGS_BYTES / 3) * 4) fail('INVALID_FILTER_SETTINGS', '构造设置内容无效或过大', 'Saved settings are invalid or too large');
  let settings;
  try {
    const binary = atob(encoded);
    if (binary.length > MAX_SETTINGS_BYTES) throw new Error('Too large');
    settings = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
  } catch { fail('INVALID_FILTER_SETTINGS', '构造设置损坏，无法恢复', 'Saved settings are damaged and cannot be restored'); }
  if (!record(settings) || settings.format !== 'LESaveEditorFilterSettings' || settings.version !== FILTER_SETTINGS_VERSION || !record(settings.draft) || typeof settings.gameVersion !== 'string') fail('INVALID_FILTER_SETTINGS', '构造设置格式无效', 'Invalid saved filter settings format');
  return settings;
}
