/* Optional design entry: no module graph, credential read or API at startup.
 * Activation remains trusted server/application configuration in app-entry.mjs. */
(function () {
  'use strict';
  var entry = document.getElementById('ai-design-prepared-entry');
  if (!entry) return;
  var pending = null, status = null;
  function stylesheet(href) {
    return new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      link.onload = resolve; link.onerror = reject;
      document.head.appendChild(link);
    });
  }
  function message(text) {
    if (!status) { status = document.createElement('p'); status.setAttribute('role', 'status'); status.dataset.designEntryStatus = ''; entry.after(status); }
    status.textContent = text;
  }
  function open(event) {
    // A trusted earlier installation already owns its own click handler.
    if (window.PreparedDesignApp) return;
    event.preventDefault();
    if (pending) return;
    message('正在打开设计记录…');
    pending = Promise.all([stylesheet('ai-design-pilot.css'), stylesheet('ai-design-prepared.css')])
      .then(function () { return import('./packages/design-prepared-ui/app-entry.mjs'); })
      .then(function () {
        entry.removeEventListener('click', open);
        status.remove(); status = null;
        window.PreparedDesignApp.openHome();
      }).catch(function () {
        message('设计界面暂时无法加载，当前输入已保留。可稍后在新窗口打开独立入口。');
        var fallback = document.createElement('a'); fallback.href = 'ai-design-prepared.html';
        fallback.target = '_blank'; fallback.rel = 'noopener'; fallback.textContent = '打开独立设计入口'; status.appendChild(fallback);
      }).finally(function () { pending = null; });
  }
  entry.addEventListener('click', open);
})();
