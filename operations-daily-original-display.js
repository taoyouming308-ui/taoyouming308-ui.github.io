(function (global) {
  'use strict';

  // A display projection only. Archive presence never changes financial evidence or gates.
  function presence(value) {
    if (!value || typeof value !== 'object') return { state: 'legacy', count: null };
    if (value.state === 'archived' && Number.isInteger(value.count) && value.count > 0) {
      return { state: 'archived', count: value.count };
    }
    if (value.state === 'none' && value.count === 0) return { state: 'none', count: 0 };
    return { state: 'unavailable', count: null };
  }

  function privateLink(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }

  function sameDraft(left, right) {
    return !!(left && right && left.draft && right.draft && left.draft.id
      && String(left.draft.id) === String(right.draft.id)
      && left.draft.report_date === right.draft.report_date);
  }

  // Called only after the owner verifies the current store/request scope. Older
  // mutation responses omit display references; that omission is not absence.
  function preserve(previous, next) {
    if (sameDraft(previous, next) && !Object.prototype.hasOwnProperty.call(next, 'original_archive')
      && Object.prototype.hasOwnProperty.call(previous, 'original_archive')) {
      next.original_archive = previous.original_archive;
      next.archived_originals = previous.archived_originals || [];
    }
    return next;
  }

  function refresh(current, fresh) {
    if (!sameDraft(current, fresh) || !Object.prototype.hasOwnProperty.call(fresh, 'original_archive')) return false;
    current.original_archive = fresh.original_archive;
    current.archived_originals = fresh.archived_originals || [];
    return true;
  }

  var viewer;
  function openViewer(url, label) {
    if (!viewer) {
      viewer = document.createElement('dialog');
      viewer.setAttribute('aria-label', '日报原图放大查看');
      viewer.style.cssText = 'width:96vw;max-width:96vw;height:94vh;max-height:94vh;padding:12px;border:1px solid #aaa;border-radius:12px;background:#f5f3ef;color:#222';
      viewer.innerHTML = '<div style="display:flex;align-items:center;gap:8px;position:sticky;top:0;background:#f5f3ef;padding:4px;z-index:1"><strong data-label style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></strong><button type="button" data-zoom-out aria-label="缩小">－</button><button type="button" data-zoom-reset>适合屏幕</button><button type="button" data-zoom-in aria-label="放大">＋</button><button type="button" data-close>关闭</button></div><div data-stage style="height:calc(100% - 48px);overflow:auto;text-align:center"><img data-image alt="日报原图放大查看" style="height:auto;max-width:none"></div>';
      document.body.appendChild(viewer);
      viewer.querySelector('[data-close]').onclick = function () { viewer.close(); };
      viewer.addEventListener('click', function (event) { if (event.target === viewer) viewer.close(); });
    }
    var image = viewer.querySelector('[data-image]'), zoom = 1;
    function scale() { image.style.width = (Math.round(88 * zoom)) + 'vw'; }
    viewer.querySelector('[data-label]').textContent = label;
    viewer.querySelector('[data-zoom-in]').onclick = function () { zoom = Math.min(4, zoom * 1.5); scale(); };
    viewer.querySelector('[data-zoom-out]').onclick = function () { zoom = Math.max(.4, zoom / 1.5); scale(); };
    viewer.querySelector('[data-zoom-reset]').onclick = function () { zoom = 1; scale(); };
    image.src = url; scale(); viewer.showModal();
  }

  function render(sheet, host, esc) {
    if (viewer && viewer.open) viewer.close();
    var state = presence(sheet.original_archive), date = sheet.draft && sheet.draft.report_date;
    // Never display an original under a different day's financial detail.
    var originals = state.state === 'archived' && Array.isArray(sheet.archived_originals)
      ? sheet.archived_originals.filter(function (item) { return item.report_date === date; }) : [];
    host.classList.toggle('hidden', state.state !== 'archived');
    host.innerHTML = state.state === 'archived'
      ? '<h4>当日原始日报照片 · 待核对</h4><div class="help">照片在本张电子日报内直接展示。存档不代表财务绑定或审核通过，金额与入账状态未调整。</div>'
        + originals.map(function (item) {
          var url = privateLink(item.private_url);
          var image = url && (item.mime_type === 'image/jpeg' || item.mime_type === 'image/png');
          return '<div class="finance-record" data-daily-archived-original="' + esc(item.request_id) + '"><div class="finance-record-head"><div><strong>'
            + esc(item.original_filename) + '</strong><div class="help">' + esc(item.report_date)
            + ' · 原图已存档 · 待核对</div></div><div class="compact-actions">'
            + (url ? '<a class="ghost" data-daily-archived-link href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">另开原图</a>'
              : '<span class="help">原图链接暂不可用，请刷新日报后重试。</span>')
            + '</div></div>' + (image ? '<button type="button" data-daily-archived-zoom="' + esc(item.request_id) + '" aria-label="放大查看 ' + esc(item.original_filename) + '" style="display:block;width:100%;padding:8px;border:0;background:transparent;cursor:zoom-in"><img src="' + esc(url) + '" alt="' + esc(item.report_date + ' 日报原图 ' + item.original_filename) + '" loading="lazy" style="display:block;max-width:100%;max-height:420px;object-fit:contain;margin:auto;border-radius:8px"></button><div class="help">点击图片放大，可缩小、放大并滚动检查细节。</div>' : '') + '</div>';
        }).join('')
        + (originals.length ? '' : '<div class="help">原图已存档，明细暂不可用，请刷新日报后重试。</div>')
      : '';
    host.querySelectorAll('[data-daily-archived-zoom]').forEach(function (button) {
      button.onclick = function () {
        var item = originals.find(function (entry) { return entry.request_id === button.dataset.dailyArchivedZoom; });
        var url = item && privateLink(item.private_url);
        if (url) openViewer(url, item.report_date + ' · ' + item.original_filename);
      };
    });
    return state;
  }

  global.ZysyrDailyOriginalDisplay = Object.freeze({ presence: presence, render: render, preserve: preserve, refresh: refresh });
})(window);
