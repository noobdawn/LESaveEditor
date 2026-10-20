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

function treeLabel(field, language) {
  return field === 'charTree' ? (language === 'zh' ? '角色被动树' : 'Character passive tree')
    : (language === 'zh' ? '技能「' : 'Skill "') + (gameData.skills[field]?.name ?? field) + (language === 'zh' ? '」' : '"');
}
export function nodeLimitIssue(field, id, points, maximum) {
  const unavailable = maximum == null;
  return { zh: treeLabel(field, 'zh') + '节点 #' + id + (unavailable ? '不在当前游戏目录中' : '已分配 ' + points + ' 点，单节点上限为 ' + maximum + ' 点')
      + '。请在模拟器中' + (unavailable ? '更新配装至当前版本或移除此节点' : '回收超出上限的 ' + (points - maximum) + ' 点') + '，再保存链接重试。',
    en: treeLabel(field, 'en') + ' node #' + id + (unavailable ? ' is absent from the current game catalog' : ' has ' + points + ' points; its cap is ' + maximum)
      + '. ' + (unavailable ? 'Update the build to the current game version or remove this node' : 'Refund ' + (points - maximum) + ' points from this node') + ' in the planner, then save a new link and retry.',
    details: { field, node: id, points, maximum } };
}
export function masteryNodeIssue(classId, chosen, id, required, threshold) {
  return { zh: '角色被动树节点 #' + id + '属于「' + masteryName('zh', classId, required) + '」，解锁门槛为 ' + threshold + ' 点，需要选择该专精；当前为「'
      + masteryName('zh', classId, chosen) + '」。请在模拟器中更正专精或移除此节点后重试。',
    en: 'Passive node #' + id + ' belongs to ' + masteryName('en', classId, required) + ' with a ' + threshold + '-point threshold and requires that mastery; current mastery is '
      + masteryName('en', classId, chosen) + '. Correct the mastery or remove this node in the planner, then retry.',
    details: { field: 'charTree', node: id, requiredMastery: required, chosenMastery: chosen, threshold } };
}
export function nodeRequirementIssues(field, blocked, classId) {
  return blocked.map(node => {
    const zh = [], en = [];
    if (node.masteryPoints < node.threshold) {
      zh.push('「' + masteryName('zh', classId, node.mastery) + '」树需要 ' + node.threshold + ' 点，当前可满足前置条件的点数为 ' + node.masteryPoints);
      en.push(masteryName('en', classId, node.mastery) + ' needs ' + node.threshold + ' points; currently ' + node.masteryPoints + ' points meet prerequisites');
    }
    if (node.needsBase) { zh.push('基础职业树需要 20 点，当前 ' + node.basePoints); en.push('base class needs 20 points; currently ' + node.basePoints); }
    if (node.parents.length) {
      zh.push('前置节点需满足任一项：' + node.parents.map(p => '#' + p.id + ' 至少 ' + p.required + ' 点（当前可满足前置条件 ' + p.actual + ' 点）').join('，或 '));
      en.push('meet at least one parent requirement: ' + node.parents.map(p => '#' + p.id + ' needs ' + p.required + ' points (currently ' + p.actual + ' valid points)').join(' OR '));
    }
    return { zh: treeLabel(field, 'zh') + '节点 #' + node.id + '无法分配：' + zh.join('；') + '。请在模拟器中补足前置条件或调整分配，再保存链接重试。',
      en: treeLabel(field, 'en') + ' node #' + node.id + ' cannot be allocated: ' + en.join('; ') + '. Meet the prerequisites or adjust the allocation in the planner, then save a new link and retry.',
      details: { field, node: node.id, ...node } };
  });
}
