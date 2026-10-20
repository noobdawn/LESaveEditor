import './entry-landing.css';

const app = document.querySelector('#app');
let language = 'zh';
try { if (localStorage.getItem('le-save-editor-language') === 'en') language = 'en'; } catch { /* Optional storage. */ }
let active = 'sync';
let entering = false;
const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
const art = {
  filter: '<path d="M52 70h156M52 112h156M52 154h156"/><circle cx="96" cy="70" r="10"/><circle cx="165" cy="112" r="10"/><circle cx="120" cy="154" r="10"/><path class="art-faint" d="M52 40v144M208 40v144"/>',
  sync: '<path d="m130 30 66 38v76l-66 38-66-38V68z"/><path d="m64 68 66 38 66-38M130 106v76M97 49l66 38v38l-33 19-33-19V87l33-19"/><path class="art-faint" d="m40 82-17 10v50l43 25m128 0 43-25V92l-17-10"/>',
  world: '<circle cx="130" cy="110" r="65"/><ellipse cx="130" cy="110" rx="29" ry="65"/><path d="M65 110h130M77 73h106M77 147h106"/><path class="art-faint" d="m130 22 7 12-7 12-7-12zM211 110l12-7 12 7-12 7zM130 174l7 12-7 12-7-12zM25 110l12-7 12 7-12 7z"/>'
};
const copy = {
  zh: {
    eyebrow: 'LAST EPOCH · 离线工具箱', title: '下一段旅程，由你设定。', subtitle: '从配装到世界，选择你想开始的地方。',
    local: '文件在本地处理', foot: '为每一次重新出发，留一点自由。', enter: '进入', hint: '移动鼠标展开 · 点击进入', loading: '正在进入',
    cards: [
      { id: 'filter', tag: 'BUILD YOUR FILTER', title: '过滤器构造', brief: '让每一次掉落，都更接近所需。', description: '从配装生成专属掉落过滤器，或导入已有 XML，继续打磨你的拾取规则。', features: ['配装生成过滤器', '导入并编辑 XML', '预览规则与导出'] },
      { id: 'sync', tag: 'SYNC YOUR BUILD', title: '离线存档同步', brief: '将理想配装，带入你的冒险。', description: '导入 LastEpochTools 配装，选择需要同步的内容，让装备、天赋与技能落入离线存档。', features: ['导入模拟器配装', '选择同步内容', '预览修改并下载'] },
      { id: 'world', tag: 'SHAPE YOUR WORLD', title: '世界编辑', brief: '以自己的节奏，探索每条时间线。', description: '直接载入存档，调整世界线、阵营与角色模式，自由安排下一段终局旅程。', features: ['稳定度与腐化度', '阵营与角色模式', '速通与终局准备'] }
    ]
  },
  en: {
    eyebrow: 'LAST EPOCH · OFFLINE TOOLKIT', title: 'Your next chapter. Your way.', subtitle: 'From your build to your world. Choose where to begin.',
    local: 'Files processed locally', foot: 'A little more freedom for every fresh start.', enter: 'Enter', hint: 'Hover to explore · Click to enter', loading: 'Opening',
    cards: [
      { id: 'filter', tag: 'BUILD YOUR FILTER', title: 'Loot filter', brief: 'Make every drop a little more relevant.', description: 'Create a filter from your build, or import an existing XML and refine your loot rules.', features: ['Generate from a build', 'Import and edit XML', 'Preview and export'] },
      { id: 'sync', tag: 'SYNC YOUR BUILD', title: 'Offline save sync', brief: 'Bring your ideal build into your adventure.', description: 'Import a LastEpochTools build and choose the equipment, passives and skills to sync to your save.', features: ['Import a planner build', 'Choose what to sync', 'Review and download'] },
      { id: 'world', tag: 'SHAPE YOUR WORLD', title: 'World editor', brief: 'Explore every timeline at your own pace.', description: 'Load your save directly to edit timelines, factions and character modes, and prepare for the endgame.', features: ['Stability and corruption', 'Factions and character modes', 'Campaign and endgame skips'] }
    ]
  }
};

function select(id) {
  if (entering) return;
  active = id;
  app.querySelector('.entry-panels').dataset.active = id;
  for (const panel of app.querySelectorAll('.entry-panel')) {
    panel.classList.toggle('is-active', panel.dataset.entry === id);
  }
}

function enter(event, panel) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (entering) return;
  entering = true;
  const rect = panel.getBoundingClientRect();
  const overlay = panel.cloneNode(true);
  overlay.removeAttribute('href');
  overlay.removeAttribute('aria-describedby');
  overlay.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  overlay.setAttribute('aria-hidden', 'true');
  overlay.className = 'entry-panel is-active entry-transition';
  Object.assign(overlay.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
  document.body.append(overlay);
  app.setAttribute('inert', '');
  document.querySelector('#entry-status').textContent = copy[language].loading + ' ' + panel.querySelector('h1').textContent;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.classList.add('is-expanding');
    Object.assign(overlay.style, { left: '0px', top: '0px', width: '100vw', height: '100dvh' });
  }));
  window.setTimeout(() => overlay.classList.add('is-dissolving'), 680);
  window.setTimeout(() => window.location.assign(panel.href), 1160);
}

function render() {
  const text = copy[language];
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.title = 'LE Save Editor';
  app.innerHTML = '<main class="entry-shell"><nav class="entry-panels" data-active="' + active + '" aria-label="' + (language === 'zh' ? '选择功能' : 'Choose a tool') + '">' + text.cards.map(card => '<a class="entry-panel ' + (active === card.id ? 'is-active' : '') + '" data-entry="' + card.id + '" href="?entry=' + card.id + '" aria-describedby="detail-' + card.id + '"><div class="panel-art" aria-hidden="true"><svg viewBox="0 0 260 220" fill="none">' + art[card.id] + '</svg></div><div class="panel-copy"><h1>' + card.title + '</h1><div class="panel-details" id="detail-' + card.id + '"><ul>' + card.features.map(feature => '<li>' + feature + '</li>').join('') + '</ul></div></div><span class="panel-arrow">' + arrow + '</span></a>').join('') + '</nav></main><span id="entry-status" class="visually-hidden" role="status" aria-live="polite"></span>';
  app.querySelectorAll('.entry-panel').forEach(panel => {
    panel.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') select(panel.dataset.entry); });
    panel.addEventListener('focus', () => select(panel.dataset.entry));
    panel.addEventListener('click', event => enter(event, panel));
  });
  app.querySelector('.entry-panels').addEventListener('pointerleave', () => {
    const focused = document.activeElement?.closest('.entry-panel');
    select(focused?.dataset.entry || 'sync');
  });
  app.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
    language = button.dataset.language;
    try { localStorage.setItem('le-save-editor-language', language); } catch { /* Optional storage. */ }
    render();
    app.querySelector('[data-language="' + language + '"]').focus();
  }));
}
render();
