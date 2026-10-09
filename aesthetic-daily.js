/* Published fictional teaching cases; no business writes or authentication changes. */
(function () {
  'use strict';
  const root = document.getElementById('perm-academy-root');
  if (!root) return;
  const key = 'aesthetic_daily_learning_v1';
  let items = [], selected = '', failed = false, state = {completed: []};
  try { const s = JSON.parse(localStorage.getItem(key)); if (s && Array.isArray(s.completed)) state.completed = s.completed.filter(x => typeof x === 'string'); } catch (_) {}
  const esc = v => String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const imagePath = p => typeof p === 'string' && /^img\/aesthetic-training\/[a-z0-9._-]+\.(png|jpg|webp)$/.test(p);
  function valid(x) {
    return x && typeof x.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && typeof x.title === 'string' && imagePath(x.image) &&
      typeof x.caption === 'string' && Array.isArray(x.conditions) && x.conditions.every(v => typeof v === 'string') && typeof x.question === 'string' &&
      Array.isArray(x.answer) && x.answer.length >= 6 && x.answer.every(v => v && typeof v.title === 'string' && typeof v.text === 'string') &&
      Array.isArray(x.recap) && x.recap.length === 5 && x.recap.every(v => v && typeof v.title === 'string' && typeof v.text === 'string');
  }
  function render() {
    if (failed) { root.innerHTML = '<div class="academy-empty"><p>暂时无法读取训练内容。</p><button class="academy-retry" data-retry>重新读取</button></div>'; return; }
    if (!items.length) { root.innerHTML = '<div class="academy-empty"><p>暂时没有已发布案例。</p></div>'; return; }
    const x = items.find(x => x.id === selected) || items[0]; selected = x.id;
    root.innerHTML = '<article class="academy-detail"><label class="training-history">选择案例<select aria-label="选择案例">' + items.map(v => '<option value="' + esc(v.id) + '"' + (v.id === x.id ? ' selected' : '') + '>' + esc(v.date + ' · ' + v.title) + '</option>').join('') + '</select></label>' +
      '<div class="academy-meta">' + esc(x.date) + ' · 约5分钟 · 虚构教学案例</div><h3>' + esc(x.title) + '</h3><figure class="training-figure"><a href="' + esc(x.image) + '" target="_blank" rel="noopener"><img src="' + esc(x.image) + '" alt="' + esc(x.caption) + '"></a><figcaption>' + esc(x.caption) + ' · 点击查看大图</figcaption></figure>' +
      '<h4>案例条件</h4><ul>' + x.conditions.map(v => '<li>' + esc(v) + '</li>').join('') + '</ul><div class="training-question"><h4>先想一想 · 60秒</h4><p>' + esc(x.question) + '</p></div><h4 data-study-answer>参考答案与设计推理</h4><p class="academy-note">方案可以不同，重点是判断与设计能对应起来。</p>' +
      x.answer.map(v => '<section><h4>' + esc(v.title) + '</h4><p>' + esc(v.text) + '</p></section>').join('') +
      '<h4>学习复盘</h4><p class="academy-note">尚未提交作答时，以下为自查提示，不代表对个人表现的评价。</p>' + x.recap.map(v => '<p><strong>' + esc(v.title) + '：</strong>' + esc(v.text) + '</p>').join('') +
      '<div class="academy-actions"><button data-complete aria-pressed="' + state.completed.includes(x.id) + '">' + (state.completed.includes(x.id) ? '已学完 ✓' : '标记学完') + '</button></div><p class="academy-note"><span data-study-status>未连接员工学习记录时，标记仅保存在当前浏览器。</span> 配图为AI生成示意；发质和生活习惯以案例设定为准。</p></article>';
    root.dispatchEvent(new CustomEvent('aesthetic-case-rendered', {detail:x}));
    const img = root.querySelector('img');
    img.addEventListener('error', () => { const note = document.createElement('p'); note.textContent = '图片暂时加载失败，可稍后重试。'; img.replaceWith(note); }, {once:true});
  }
  root.addEventListener('change', e => { if (e.target.matches('select')) { selected = e.target.value; render(); } });
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-retry')) load();
    if (b.hasAttribute('data-complete')) {
      if (window.AestheticStudy && window.AestheticStudy.connected()) {
        const done = b.getAttribute('aria-pressed') !== 'true';
        if (window.AestheticStudy.mark(selected, done)) { b.setAttribute('aria-pressed', String(done)); b.textContent = done ? '已学完 ✓' : '标记学完'; }
        return;
      }
      state.completed = state.completed.includes(selected) ? state.completed.filter(id => id !== selected) : state.completed.concat(selected);
      try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) {}
      render();
    }
  });
  async function load() {
    root.innerHTML = '<p>正在读取训练内容…</p>';
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('docs/aesthetic-training/feed.v1.json', {cache:'no-cache', signal:controller.signal});
      if (!response.ok) throw Error('feed');
      const feed = await response.json();
      if (feed.schemaVersion !== 1 || !Array.isArray(feed.items) || !feed.items.every(valid)) throw Error('schema');
      items = feed.items.slice().sort((a,b) => b.date.localeCompare(a.date)); failed = false;
    } catch (_) { failed = true; } finally { clearTimeout(timeout); render(); }
  }
  window.addEventListener('aesthetic-learning-state', () => { if (items.length) render(); });
  load();
})();
