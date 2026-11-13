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
  function openViewer(url, label, controls) {
    if (!viewer) {
      viewer = document.createElement('dialog');
      viewer.setAttribute('aria-label', '日报原图放大查看');
      viewer.style.cssText = 'width:96vw;max-width:96vw;height:94vh;max-height:94vh;padding:12px;border:1px solid #aaa;border-radius:12px;background:#f5f3ef;color:#222';
      viewer.innerHTML = '<div style="display:flex;align-items:center;gap:8px;position:sticky;top:0;background:#f5f3ef;padding:4px;z-index:1;flex-wrap:wrap"><strong data-label style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></strong><button type="button" data-turn-left>向左转</button><button type="button" data-auto-straighten>自动摆正</button><button type="button" data-turn-right>向右转</button><button type="button" data-zoom-out aria-label="缩小">－</button><button type="button" data-zoom-reset>适合屏幕</button><button type="button" data-zoom-in aria-label="放大">＋</button><button type="button" data-save-orientation>保存方向</button><button type="button" data-close>关闭</button></div><div data-stage style="height:calc(100% - 60px);overflow:auto;text-align:center"><img data-image alt="日报原图放大查看" style="height:auto;max-width:none;transform-origin:center"></div>';
      document.body.appendChild(viewer);
      viewer.querySelector('[data-close]').onclick = function () { viewer.close(); };
      viewer.addEventListener('click', function (event) { if (event.target === viewer) viewer.close(); });
    }
    var image = viewer.querySelector('[data-image]'), zoom = 1;
    function scale() { image.style.width = (Math.round(88 * zoom)) + 'vw'; image.style.transform='rotate('+controls.angle()+'deg)'; }
    viewer.querySelector('[data-label]').textContent = label;
    viewer.querySelector('[data-zoom-in]').onclick = function () { zoom = Math.min(4, zoom * 1.5); scale(); };
    viewer.querySelector('[data-zoom-out]').onclick = function () { zoom = Math.max(.4, zoom / 1.5); scale(); };
    viewer.querySelector('[data-zoom-reset]').onclick = function () { zoom = 1; scale(); };
    viewer.querySelector('[data-turn-left]').onclick=function(){controls.turn(-90);scale();};
    viewer.querySelector('[data-turn-right]').onclick=function(){controls.turn(90);scale();};
    viewer.querySelector('[data-auto-straighten]').onclick=function(){controls.auto();scale();};
    var save=viewer.querySelector('[data-save-orientation]');save.hidden=!controls.canSave;
    save.onclick=async function(){save.disabled=true;try{await controls.save();}finally{save.disabled=false;}};
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
            + '</div></div>' + (image ? '<button type="button" data-daily-archived-zoom="' + esc(item.request_id) + '" aria-label="放大查看 ' + esc(item.original_filename) + '" style="display:block;width:100%;padding:8px;border:0;background:transparent;cursor:zoom-in"><span data-rotation-frame style="display:block;position:relative;width:100%;height:420px;overflow:hidden"><img src="' + esc(url) + '" alt="' + esc(item.report_date + ' 日报原图 ' + item.original_filename) + '" loading="lazy" style="position:absolute;left:50%;top:50%;max-width:none;transform-origin:center;border-radius:8px"></span></button><div class="compact-actions" data-archive-rotation-tools="' + esc(item.request_id) + '"><button type="button" data-left>向左转</button><button type="button" data-auto>自动摆正</button><button type="button" data-right>向右转</button><button type="button" data-save hidden>保存方向</button><span class="help" data-status>点击图片放大检查细节。</span></div>' : '') + '</div>';
        }).join('')
        + (originals.length ? '' : '<div class="help">原图已存档，明细暂不可用，请刷新日报后重试。</div>')
      : '';
    host.querySelectorAll('[data-daily-archived-zoom]').forEach(function (button) {
      var item = originals.find(function (entry) { return entry.request_id === button.dataset.dailyArchivedZoom; });
      var url = item && privateLink(item.private_url), img=button.querySelector('img'),frame=button.querySelector('[data-rotation-frame]');
      var tools=host.querySelector('[data-archive-rotation-tools="'+item.request_id+'"]');
      var saved=item.display_rotation_degrees, angle=[0,90,180,270].includes(Number(saved))&&saved!==null&&saved!==undefined?Number(saved):null;
      var canSave=Boolean(global.state&&global.state.user&&global.state.user.can_import_photo_reports&&!global.state.user.personal_scope);
      var saveButton=tools.querySelector('[data-save]'),status=tools.querySelector('[data-status]');saveButton.hidden=!canSave;
      function autoAngle(){return img.naturalHeight>img.naturalWidth?90:0;}
      function currentAngle(){return angle===null?autoAngle():angle;}
      function layout(){if(!img.naturalWidth)return;var degrees=currentAngle(),swapped=degrees%180===90,w=swapped?img.naturalHeight:img.naturalWidth,h=swapped?img.naturalWidth:img.naturalHeight;var factor=Math.min(1,(frame.clientWidth-16)/w,404/h);frame.style.height=Math.max(80,Math.round(h*factor+16))+'px';img.style.width=Math.round(img.naturalWidth*factor)+'px';img.style.height=Math.round(img.naturalHeight*factor)+'px';img.style.transform='translate(-50%,-50%) rotate('+degrees+'deg)';}
      function update(){layout();saveButton.disabled=saved!==null&&Number(saved)===currentAngle();status.textContent='当前显示 '+currentAngle()+'°；'+(canSave?'调整后请保存方向。':'只读查看。');}
      img.addEventListener('load',update);if(img.complete)update();
      function turn(delta){angle=(currentAngle()+delta+360)%360;update();}
      function auto(){angle=autoAngle();update();}
      async function save(){
        if(!canSave||!global.state||global.state.imports.sheet!==sheet||!global.api||!global.currentStore)return;
        saveButton.disabled=true;status.textContent='正在保存图片方向…';
        try{await global.api('daily_original_archive_orientation_save',{store:global.currentStore(),request_id:item.request_id,degrees:currentAngle(),reason:'人工调整日报原图显示方向'},true);saved=currentAngle();item.display_rotation_degrees=saved;update();status.textContent='方向已保存，刷新后仍保持。';}
        catch(error){status.textContent='保存失败：'+error.message;saveButton.disabled=false;}
      }
      tools.querySelector('[data-left]').onclick=function(){turn(-90);};
      tools.querySelector('[data-right]').onclick=function(){turn(90);};
      tools.querySelector('[data-auto]').onclick=auto;saveButton.onclick=save;
      button.onclick=function(){if(url)openViewer(url,item.report_date+' · '+item.original_filename,{angle:currentAngle,turn:turn,auto:auto,save:save,canSave:canSave});};
    });
    return state;
  }

  global.ZysyrDailyOriginalDisplay = Object.freeze({ presence: presence, render: render, preserve: preserve, refresh: refresh });
})(window);
