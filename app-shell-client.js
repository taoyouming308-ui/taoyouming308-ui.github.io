/* Public static shell only. No account state, API response or business write is stored here. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  var registration, registering, checking, deadline;
  var registrationFailed = false, handled = false, requested = false;
  var observed = [];
  var dismissalKey = 'zysyr-shell-notice-dismissed-' + document.documentElement.getAttribute('data-version');
  var dismissed = false;
  try { dismissed = sessionStorage.getItem(dismissalKey) === '1'; } catch (_) {}
  function removeNotice() {
    var node = document.getElementById('app-shell-notice');
    if (node) node.remove();
  }
  function dismiss() {
    clearTimeout(deadline);
    dismissed = true;
    try { sessionStorage.setItem(dismissalKey, '1'); } catch (_) {}
    removeNotice();
  }
  function notice(text, state) {
    clearTimeout(deadline);
    handled = true;
    // One update prompt across the main app and the shared three-entry shell.
    var banner = document.getElementById('update-banner');
    if (banner) banner.style.display = 'none';
    if (dismissed) return;
    var node = document.getElementById('app-shell-notice');
    if (!node) {
      node = document.createElement('div');
      node.id = 'app-shell-notice';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.style.cssText = 'position:fixed;bottom:calc(12px + env(safe-area-inset-bottom,0px));left:12px;right:12px;max-width:600px;margin:0 auto;z-index:1000001;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f6f3ec;color:#263b32;border:1px solid #aebbb4;border-radius:10px;font:13px/1.6 sans-serif';
      document.body.appendChild(node);
    }
    node.setAttribute('data-state', state);
    node.textContent = '';
    var message = document.createElement('span');
    message.style.cssText = 'flex:1;min-width:0;overflow-wrap:anywhere';
    message.textContent = text;
    node.appendChild(message);
    function action(label, callback) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = 'flex-shrink:0;min-height:44px;padding:6px 10px;border:1px solid #aebbb4;border-radius:8px;background:#fff;color:#263b32;font:inherit;cursor:pointer';
      button.onclick = callback;
      node.appendChild(button);
      return button;
    }
    if (state === 'error') action('重试', function () { window.ZysyrAppShell.requestUpdate(); });
    action('稍后', dismiss).setAttribute('aria-label', '收起界面更新提示');
    if (state === 'checking' || state === 'installing') {
      deadline = setTimeout(function () {
        notice('界面更新尚未完成，可稍后再检查。当前页面可继续使用。', 'delayed');
      }, 30000);
    } else {
      // A waiting release can stay pending for hours while another app window is open.
      // Treat it as a short reminder and remember that it was shown in this tab.
      deadline = setTimeout(state === 'waiting' ? dismiss : removeNotice, state === 'checked' ? 6000 : 12000);
    }
  }
  function readyNotice() {
    notice('新版界面已准备好。保存未提交内容后，关闭本站所有页面及主屏幕窗口，再重新打开即可切换。', 'waiting');
  }
  function watchInstalling(reg) {
    var worker = reg.installing;
    if (!worker || observed.indexOf(worker) !== -1) return;
    observed.push(worker);
    var isUpdate = !!(reg.active || navigator.serviceWorker.controller || requested);
    if (isUpdate) notice('正在下载新版界面，当前页面可继续使用。', 'installing');
    worker.addEventListener('statechange', function () {
      if (worker.state !== 'installed' && worker.state !== 'redundant' && worker.state !== 'activated') return;
      // Let the browser finish assigning waiting/active before reading the registration.
      setTimeout(function () {
        if (reg.waiting) readyNotice();
        else if (reg.installing && reg.installing !== worker) watchInstalling(reg);
        else if ((isUpdate || requested) && worker.state === 'redundant') notice('新版界面下载未完成。当前页面保留，请联网后重试。', 'error');
        else if (isUpdate || requested) notice('界面资源检查已完成。下次打开页面时使用已准备的资源。', 'checked');
      }, 0);
    });
  }
  function preparing() {
    if (registration && registration.waiting) { readyNotice(); return true; }
    if (registration && registration.installing) {
      watchInstalling(registration);
      notice('正在下载新版界面，当前页面可继续使用。', 'installing');
      return true;
    }
    return false;
  }
  function check(reg) {
    if (!reg || preparing() || checking) return;
    checking = reg.update().then(function () {
      if (!preparing()) notice('本次未发现可切换的新版界面。当前页面可继续使用。', 'checked');
    }).catch(function () { notice('暂时无法检查新版界面。当前页面保留，请联网后重试。', 'error');
    }).then(function () { checking = null; });
  }
  window.ZysyrAppShell = {
    hasUpdatePrompt: function () { return handled || dismissed; },
    requestUpdate: function () {
      dismissed = false;
      try { sessionStorage.removeItem(dismissalKey); } catch (_) {}
      requested = true;
      if (preparing()) return true;
      if (!navigator.serviceWorker.controller && (registrationFailed || (registration && !registration.active && !registration.waiting && !registration.installing))) { register(); return false; }
      notice('正在检查新版界面，当前页面可继续使用。', 'checking');
      if (registration) check(registration);
      else register().then(check);
      return true;
    }
  };
  function register() {
    if (registering) return registering;
    // Preserve the old worker until all clients close. No activation, reload or write replay.
    registering = navigator.serviceWorker.register('app-shell-sw.js', { scope: './', updateViaCache: 'none' }).then(function (reg) {
      registration = reg;
      registrationFailed = false;
      if (reg.waiting) readyNotice();
      watchInstalling(reg);
      reg.addEventListener('updatefound', function () { watchInstalling(reg); });
      return reg;
    }).catch(function () {
      registrationFailed = true;
      if (requested && navigator.serviceWorker.controller) notice('暂时无法检查新版界面。当前页面保留，请联网后重试。', 'error');
      return null;
    }).then(function (reg) { registering = null; return reg; });
    return registering;
  }
  // Do not compete with the first visible page and identity verification.
  if (document.readyState === 'complete') setTimeout(register, 0);
  else window.addEventListener('load', register, { once: true });
  window.addEventListener('online', function () { if (registration && !registration.installing && !registration.waiting && !checking) registration.update().catch(function () {}); });
})();
