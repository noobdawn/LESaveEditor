import gameData from '../data/planner-game-data.js';
import { masteries } from '../i18n.js';

function context(id, location) {
  const skillName = gameData.skills[id]?.name ?? id;
  const slot = location.slotNumber + 1;
  const zh = location.kind === 'skillBar' ? '技能栏第 ' + slot + ' 格' : '技能专精第 ' + slot + ' 槽';
  const en = location.kind === 'skillBar' ? 'Action bar slot ' + slot : 'Specialization slot ' + slot;
  return { skillName, zh: zh + '「' + skillName + '」', en: en + ' "' + skillName + '"',
    details: { treeID: id, skillName, location: location.kind, slotNumber: location.slotNumber } };
}
const masteryName = (language, classId, mastery) => masteries[language][classId]?.[mastery] ?? String(mastery);

export function classSkillIssue(id, location, classId) {
  const label = context(id, location);
  return { zh: label.zh + '不属于当前职业「' + masteryName('zh', classId, 0) + '」。请在模拟器中检查职业或替换该技能，再保存链接重试。',
    en: label.en + ' does not belong to the current class, ' + masteryName('en', classId, 0) + '. Check the class or replace the skill in the planner, then save a new link and retry.',
    details: { ...label.details, classId } };
}

export function lockedSkillIssue(id, location, { classId, mastery, level, totals, rules }) {
  const label = context(id, location);
  const requirements = rules.map(rule => {
    if (rule.kind === 'level') {
      const missing = Math.max(0, rule.level - level);
      return { zh: '角色等级需要 ' + rule.level + ' 级，当前 ' + level + ' 级（差 ' + missing + ' 级）',
        en: 'character level ' + rule.level + ' is required; current level is ' + level + ' (' + missing + ' levels short)',
        details: { kind: 'level', required: rule.level, actual: level, missing } };
    }
    if (rule.kind === 'mastery') return {
      zh: '需要选择「' + masteryName('zh', classId, rule.mastery) + '」专精，当前为「' + masteryName('zh', classId, mastery) + '」',
      en: 'requires the ' + masteryName('en', classId, rule.mastery) + ' mastery; current mastery is ' + masteryName('en', classId, mastery),
      details: { kind: 'mastery', required: rule.mastery, actual: mastery },
    };
    const actual = totals[rule.mastery], missing = Math.max(0, rule.level - actual);
    const needsMastery = rule.level > 22 && mastery !== rule.mastery;
    return { zh: '「' + masteryName('zh', classId, rule.mastery) + '」被动树需要 ' + rule.level + ' 点，当前 ' + actual + ' 点'
        + (missing ? '（缺少 ' + missing + ' 点）' : '')
        + (needsMastery ? '；还需要选择该专精，当前为「' + masteryName('zh', classId, mastery) + '」' : ''),
      en: 'requires ' + rule.level + ' points in ' + masteryName('en', classId, rule.mastery) + '; currently ' + actual
        + (missing ? ' (' + missing + ' points short)' : '')
        + (needsMastery ? '; that mastery must also be chosen, but the current mastery is ' + masteryName('en', classId, mastery) : ''),
      details: { kind: 'passive', mastery: rule.mastery, required: rule.level, actual, missing, needsMastery, chosenMastery: mastery } };
  });
  return { zh: label.zh + '未解锁：' + (rules.length > 1 ? '需满足以下任一条件：' : '')
      + requirements.map(rule => rule.zh).join('；或：') + '。请在模拟器中按上述条件调整角色等级、专精或被动分配，或替换该技能，再保存链接重试。',
    en: label.en + ' is locked: ' + (rules.length > 1 ? 'meet at least one of these requirements: ' : '')
      + requirements.map(rule => rule.en).join('; OR ') + '. Adjust the character level, mastery or passives as required, or replace the skill in the planner, then save a new link and retry.',
    details: { ...label.details, classId, requirements: requirements.map(rule => rule.details) } };
}

export function skillPointIssue(id, slotNumber, level, spent) {
  const label = context(id, { kind: 'specialization', slotNumber }), excess = spent - level;
  return { zh: label.zh + '：配装技能等级 ' + level + ' 级，已分配 ' + spent + ' 点，超出 ' + excess
      + ' 点。请在模拟器中回收 ' + excess + ' 点，或核对装备与天赋带来的技能等级加成，再保存链接重试。',
    en: label.en + ': the build declares level ' + level + ' but allocates ' + spent + ' points, exceeding the limit by '
      + excess + '. Refund ' + excess + (excess === 1 ? ' point' : ' points') + ' or check skill-level bonuses from equipment and passives in the planner, then save a new link and retry.',
    details: { ...label.details, level, spent, excess } };
}
