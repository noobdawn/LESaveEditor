/** Keep invalid values readable without printing entire save records. */
export function displayValue(value, language = 'zh') {
  if (value === undefined) return language === 'zh' ? '未提供' : 'missing';
  if (value === null) return 'null';
  if (value?.isLosslessNumber === true && typeof value.value === 'string') return value.value.slice(0, 80);
  if (Array.isArray(value)) return language === 'zh' ? '数组（' + value.length + ' 项）' : 'array (' + value.length + ' entries)';
  if (typeof value === 'object') return language === 'zh' ? '对象' : 'object';
  const text = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return text.length > 80 ? text.slice(0, 77) + '…' : text;
}

export function withErrorContext(error, zhContext, enContext, details = {}) {
  const [zh, en = zh] = String(error.message ?? error).split(' / ');
  return Object.assign(new Error(zhContext + '：' + (error.messageZh ?? (error.messageEn ? error.message : zh))), {
    name: error.name ?? 'Error', code: typeof error.code === 'string' ? error.code : 'FILE_READ',
    messageEn: enContext + ': ' + (error.messageEn ?? en),
    details: { ...error.details, ...details },
  });
}

/** Strip explanatory Chinese annotations from canonical field paths for English errors. */
export function englishFieldPath(path) {
  return String(path).replace(/（[^）]*）/g, '').replaceAll('仓库 ', 'stash ').replaceAll('角色 ', 'character ').replaceAll('任务 ', 'quest ');
}
