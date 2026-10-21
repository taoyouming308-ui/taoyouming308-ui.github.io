/* Public static shell only. No account state, API response or business write is stored here. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  var registration;
  var registrationFailed = false;
  function notice(text) {
    var node = document.getElementById('app-shell-notice');
    if (!node) {
      node = document.createElement('div');
      node.id = 'app-shell-notice';
      node.setAttribute('role', 'status');
      node.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:9998;padding:10px 14px;background:#f6f3ec;color:#263b32;border:1px solid #aebbb4;border-radius:10px;font:13px/1.6 sans-serif';
      document.body.appendChild(node);
    }
    node.textContent = text;
  }
  function readyNotice() {
    notice('新版界面资源已准备。请先保存未提交内容，再关闭本站所有页面（含主应用、经营页、前台和主屏幕窗口）后重新打开。');
  }
  function preparing() {
    if (registration && registration.waiting) { readyNotice(); return true; }
    if (registration && registration.installing) {
      notice('新版界面资源正在准备，请稍后重试。当前页面和未提交内容保留，不会自动刷新。');
      return true;
    }
    return false;
  }
  window.ZysyrAppShell = {
    requestUpdate: function () {
      if (preparing()) return true;
      if (!navigator.serviceWorker.controller && (registrationFailed || (registration && !registration.active && !registration.waiting && !registration.installing))) { register(); return false; }
      notice('请先保存未提交内容。正在检查界面资源；不会自动刷新当前页面。');
      if (registration) registration.update().then(function () {
        if (registration.waiting) readyNotice();
        else notice('若资源更新仍在准备，请稍后重试。保存后关闭本站所有页面和主屏幕窗口，再重新打开；当前内容不会自动刷新。');
      }).catch(function () { notice('暂时无法下载新版界面。当前页面保留，请联网后重试。'); });
      else register();
      return true;
    }
  };
  function register() {
    // Updating the existing root registration preserves the old worker until all clients close.
    // No unregister, skipWaiting, claim, controllerchange reload or write replay.
    navigator.serviceWorker.register('app-shell-sw.js', { scope: './', updateViaCache: 'none' }).then(function (reg) {
      registration = reg;
      registrationFailed = false;
      if (reg.waiting) readyNotice();
      reg.addEventListener('updatefound', function () {
        var installing = reg.installing;
        if (installing) installing.addEventListener('statechange', function () {
          if (installing.state === 'installed' && reg.waiting) readyNotice();
        });
      });
    }).catch(function () { registrationFailed = true; /* Keep the existing confirmed network-update fallback available. */ });
  }
  // Do not compete with the first visible page and identity verification.
  if (document.readyState === 'complete') setTimeout(register, 0);
  else window.addEventListener('load', register, { once: true });
  window.addEventListener('online', function () { if (registration && !registration.installing && !registration.waiting) registration.update().catch(function () {}); });
})();
