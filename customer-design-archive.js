/* Customer design archive: append-only visit revisions and private original photos. */
(function (global) {
  'use strict';
  const STEPS = [['style','风格'],['person','人物'],['length','长度'],['features','发型特点'],['layers','层次'],['bangs','刘海'],['curls','卷度'],['care','打理']];
  const STATUS = {baseline:'初始判断',optimizing:'设计优化中',confirmed:'方案已确认',completed:'服务已完成',followup:'回访记录'};
  const STAGE = {before:'原始照片',after:'完成效果',reference:'参考图'};
  const ANGLE = {front:'正面',back:'背面',left:'左侧',right:'右侧',detail:'局部'};
  const MAX_BYTES = 8 * 1024 * 1024;
  const TYPES = ['image/jpeg','image/png','image/webp'];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text = value => typeof value === 'string' ? value : '';
  const clone = value => JSON.parse(JSON.stringify(value));
  const localDate = () => { const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
  const uuid = () => global.crypto && global.crypto.randomUUID ? global.crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16));
  function model(value) {
    value = value && typeof value === 'object' ? value : {};
    const result = {outline:text(value.outline),root_flow:text(value.root_flow),steps:{}};
    STEPS.forEach(([key]) => { result.steps[key] = text(value.steps && value.steps[key]); });
    return result;
  }
  function signedURL(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && u.pathname.includes('/storage/v1/object/sign/') && u.searchParams.has('token') ? u.href : ''; }
    catch (_) { return ''; }
  }
  function chatLink(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && ['chatgpt.com','www.chatgpt.com'].includes(u.hostname) ? u.href : ''; }
    catch (_) { return ''; }
  }
  function author(version) {
    return text(version.author && typeof version.author === 'object' ? version.author.name || version.author.display_name || version.author.barber_name : version.author) || text(version.author_name) || '员工';
  }
  function sourceName(value) { return ({manual:'员工手动填写',chatgpt:'ChatGPT 协作',ai:'AI 协作',import:'历史导入'})[value] || '档案记录'; }
  function formatDate(value) {
    if (!text(value)) return '时间待补';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? text(value) : new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
  }
  function mount(container, options) {
    if (!container || !options || typeof options.api !== 'function') throw new Error('设计档案需要容器和已登录的接口。');
    const state = {versions:[],latest:null,customerId:options.customerId || null,canWrite:false,urls:new Map(),urlTimes:new Map(),signing:new Map(),imageRetries:new Map(),visitKey:options.bookingId?'booking:'+options.bookingId:'manual:'+text(options.bookingDate || localDate()).slice(0,10),draft:null,loading:true,error:'',notice:'',saving:false,destroyed:false,loadSeq:0,viewer:null,conflict:false,conflictRead:false};
    const root = document.createElement('section');
    root.className = 'cda';
    root.setAttribute('aria-label','顾客设计思路');
    container.appendChild(root);
    const common = () => ({phone:options.phone,name:options.name,booking_id:options.bookingId || null,booking_date:state.draft?state.draft.booking_date:text(options.bookingDate || localDate()).slice(0,10),visit_key:state.draft?state.draft.visit_key:state.visitKey,customer_profile_id:state.customerId || undefined,customer_scope:options.scope || 'store'});
    async function api(operation,payload) {
      const result = await options.api(operation,Object.assign(common(),/customer_design_(save|upload)$/.test(operation)?{customer_scope:'store'}:{},payload || {}));
      if (!result || result.error || result.ok === false) { const error = new Error(result && (result.message || result.error) || '服务暂时不可用'); error.code = result && result.code; throw error; }
      return result;
    }
    function meaningful(value) { return esc(text(value).trim() || '待填写'); }
    function visitIdentity(version) {
      if (version.visit_key) return String(version.visit_key);
      if (version.booking_id != null && version.booking_id !== '') return 'booking:'+version.booking_id;
      if (version.visit_id) return 'visit:'+version.visit_id;
      return version.booking_date || version.service_date ? 'manual:'+(version.booking_date || version.service_date) : 'record:'+version.id;
    }
    function displayedVersionPhotos(version) {
      const photos=version.photos || [],key=visitIdentity(version);
      if (photos.some(p=>p.stage==='after')) return {photos};
      const latest=state.versions.find(v=>visitIdentity(v)===key);
      if (!latest || latest.id!==version.id) return {photos};
      const completed=state.versions.find(v=>visitIdentity(v)===key && (v.photos || []).some(p=>p.stage==='after'));
      return completed ? {photos:photos.concat(completed.photos.filter(p=>p.stage==='after')),completionSource:'沿用本次服务第 '+(completed.version_no || '1')+' 版完成照片'} : {photos};
    }
    function versionPhotosMarkup(version) {
      const display=displayedVersionPhotos(version);
      return photosMarkup(display.photos,false,display.completionSource);
    }
    function photosMarkup(photos,editable,completionSource) {
      return Object.keys(STAGE).map(stage => {
        const list = (photos || []).filter(p => p.stage === stage);
        if (!list.length && !editable && stage === 'reference') return '';
        const count = stage === 'before' ? ' · 建议正面、背面、侧面各一张' : '';
        return '<div class="cda-photo-group" data-stage="'+stage+'"><h5>'+STAGE[stage]+(editable?'<span>'+count+'</span>':'')+'</h5>'+(stage==='after' && completionSource?'<p class="cda-completion-source">'+esc(completionSource)+'</p>':'')+(list.length ? '<div class="cda-photos">'+list.map((p,index) => {
          const src = p.file && /^blob:/.test(p.local_url || '') ? p.local_url : state.urls.get(p.id) || '';
          const label = (ANGLE[p.angle] || '其他角度') + (p.file && !p.id ? ' · 待保存' : '');
          const meta=editable && p.file && !p.id?'<label class="cda-photo-meta">类别<select data-photo-meta="stage" data-local-id="'+esc(p.local_id)+'">'+Object.keys(STAGE).map(k=>'<option value="'+k+'"'+(p.stage===k?' selected':'')+'>'+STAGE[k]+'</option>').join('')+'</select></label><label class="cda-photo-meta">角度<select data-photo-meta="angle" data-local-id="'+esc(p.local_id)+'">'+Object.keys(ANGLE).map(k=>'<option value="'+k+'"'+(p.angle===k?' selected':'')+'>'+ANGLE[k]+'</option>').join('')+'</select></label>':'';
          return '<figure class="cda-photo">'+(src ? '<button type="button" class="cda-photo-open" data-photo="'+esc(p.id || p.local_id)+'" aria-label="放大'+esc(STAGE[stage]+' '+label)+'"><img loading="lazy" data-asset-id="'+esc(p.id || '')+'" src="'+esc(src)+'" alt="'+esc(STAGE[stage]+' '+label)+'"></button>' : '<button type="button" class="cda-photo-placeholder" data-photo="'+esc(p.id || p.local_id)+'">点击载入原图</button>')+'<figcaption>'+esc(label)+'</figcaption>'+meta+(editable?'<button type="button" class="cda-remove" data-remove-photo="'+esc(p.id || p.local_id)+'">移出本版</button>':'')+'</figure>';
        }).join('')+'</div>' : '<p class="cda-muted'+(stage==='after'?' cda-after-empty':'')+'">'+(stage==='before'?'尚未上传原始照片。':stage==='after'?'尚未上传完成照。':'尚未上传。')+'</p>')+'</div>';
      }).join('');
    }
    function comparison(version) {
      const baseline = model(version.baseline), optimized = model(version.optimized), reasons = version.reasons || {};
      function row(key,label,a,b,prominent) {
        const changed = !!b.trim() && a.trim() !== b.trim();
        return '<article class="cda-compare'+(prominent?' cda-prominent':'')+'"><h5>'+esc(label)+(changed?'<span class="cda-change">已优化</span>':'')+'</h5><div class="cda-compare-columns"><div><span class="cda-label">初始判断</span><p>'+meaningful(a)+'</p></div><div><span class="cda-label">'+(version.status==='baseline'?'设计方向':'优化方案')+'</span><p>'+meaningful(b)+'</p></div></div>'+(text(reasons[key]).trim()?'<p class="cda-reason"><span>调整理由</span>'+esc(reasons[key])+'</p>':'')+'</article>';
      }
      return '<div class="cda-outline">'+row('outline','整体轮廓',baseline.outline,optimized.outline,true)+row('root_flow','发根毛流方向',baseline.root_flow,optimized.root_flow,true)+'</div><div class="cda-eight">'+STEPS.map(([key,label],i)=>row(key,(i+1)+'. '+label,baseline.steps[key],optimized.steps[key],false)).join('')+'</div>';
    }
    function versionMarkup(version,open) {
      const link = chatLink(version.archive_url || version.chatgpt_url);
      return '<details class="cda-version" data-version-id="'+esc(version.id)+'"'+(open?' open':'')+'><summary><span>'+esc(STATUS[version.status] || '设计记录')+' <small>第 '+esc(version.version_no || '1')+' 版</small></span><span class="cda-muted">'+esc(formatDate(version.created_at))+'</span></summary><div class="cda-version-body"><p class="cda-byline">'+esc(author(version))+' · '+esc(sourceName(version.source))+'</p><div class="cda-version-photos">'+versionPhotosMarkup(version)+'</div>'+comparison(version)+(link?'<a class="cda-link" href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">打开 ChatGPT 协作档案 ↗</a>':'')+'</div></details>';
    }
    function historyMarkup() {
      if (!state.versions.length) return '<div class="cda-empty"><p>还没有结构化设计记录</p><span>上传原始照片，按八步填写初始判断；沟通后再记录优化方案。</span></div>';
      const groups = new Map();
      state.versions.forEach(v => { const key = String(v.visit_key || v.booking_id || v.visit_id || v.booking_date || v.service_date || v.id); if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(v); });
      return Array.from(groups.values()).map((versions,index) => {
        const first = versions[0], date = first.booking_date || first.service_date || first.visit_date || first.created_at;
        return '<details class="cda-visit"'+(index===0?' open':'')+'><summary><span>'+esc(formatDate(date))+'<small>'+ (index===0?'最近一次设计':'历史到店')+'</small></span><span class="cda-pill">'+versions.length+' 个保存版本</span></summary><div class="cda-visit-body">'+versions.map((v,i)=>versionMarkup(v,index===0 && i===0)).join('')+'</div></details>';
      }).join('');
    }
    function input(group,key,value,label) {
      return '<label class="cda-field"><span>'+esc(label)+'</span><textarea data-group="'+group+'" data-key="'+key+'" rows="2" maxlength="4000">'+esc(value)+'</textarea></label>';
    }
    function editorMarkup() {
      const d = state.draft;
      if (!d) return '';
      function editRow(key,label) {
        const a = key==='outline' || key==='root_flow' ? d.baseline[key] : d.baseline.steps[key];
        const b = key==='outline' || key==='root_flow' ? d.optimized[key] : d.optimized.steps[key];
        return '<div class="cda-edit-compare">'+input('baseline',key,a,'初始判断')+input('optimized',key,b,'优化方案')+'</div>'+input('reasons',key,d.reasons[key] || '','调整理由（有改动时填写）');
      }
      return '<form class="cda-editor" novalidate><div class="cda-editor-title"><h4>记录本次设计</h4><button type="button" class="cda-text-btn" data-action="cancel">收起</button></div><p class="cda-muted">手动填写即可。每次保存新增一个版本，原照片和历史记录保留。</p><div class="cda-form-meta"><label class="cda-field"><span>服务日期</span><input type="date" data-meta="booking_date" value="'+esc(d.booking_date)+'"'+(options.bookingId?' readonly':'')+'></label><label class="cda-field"><span>本次状态</span><select data-meta="status">'+Object.keys(STATUS).map(k=>'<option value="'+k+'"'+(d.status===k?' selected':'')+'>'+STATUS[k]+'</option>').join('')+'</select></label></div><fieldset class="cda-photo-editor"><legend>本版照片</legend>'+photosMarkup(d.photos,true)+'<div class="cda-upload-fields"><label class="cda-field"><span>照片类别</span><select data-upload="stage">'+Object.keys(STAGE).map(k=>'<option value="'+k+'">'+STAGE[k]+'</option>').join('')+'</select></label><label class="cda-field"><span>拍摄角度</span><select data-upload="angle">'+Object.keys(ANGLE).map(k=>'<option value="'+k+'">'+ANGLE[k]+'</option>').join('')+'</select></label><label class="cda-upload-btn">添加照片<input type="file" data-upload="file" accept="image/jpeg,image/png,image/webp" multiple></label></div><p class="cda-muted">JPEG / PNG / WebP，每张最多 8 MB；保留上传原文件，不压缩替换原图。</p></fieldset><div class="cda-editor-outline"><h5>整体轮廓</h5>'+editRow('outline','整体轮廓')+'<h5>发根毛流方向</h5>'+editRow('root_flow','发根毛流方向')+'</div><div class="cda-editor-steps">'+STEPS.map(([key,label],i)=>'<details'+(i===0?' open':'')+'><summary>'+ (i+1)+'. '+label+'</summary>'+editRow(key,label)+'</details>').join('')+'</div><div class="cda-draft-feedback" role="status"></div><div class="cda-save-row"><button type="submit" class="cda-primary"'+(state.saving || state.conflict?' disabled':'')+'>'+(state.saving?'保存中…':'保存新版本')+'</button><span>填写人：'+esc(options.barberName || '当前登录员工')+'</span></div></form>';
    }
    function render() {
      if (state.destroyed) return;
      root.innerHTML = '<header class="cda-header"><div><h3>设计思路</h3><p class="cda-customer">'+esc(options.name || '顾客')+'</p><p>八步设计 · 原图对照 · 历次版本</p></div>'+(!state.draft?'<button type="button" class="cda-primary" data-action="record"'+(!state.canWrite || state.loading?' disabled':'')+'>记录设计</button>':'')+'</header>'+(!state.loading && !state.canWrite && !state.error?'<p class="cda-message">此顾客当前门店的设计档案仅供查看。</p>':'')+(state.error?'<div class="cda-message cda-error" role="alert">'+esc(state.error)+' <button type="button" class="cda-text-btn" data-action="refresh">重新读取</button></div>':'')+(state.notice?'<p class="cda-message" role="status">'+esc(state.notice)+'</p>':'')+(state.conflict?'<div class="cda-message cda-error" role="alert">已有其他新版本，草稿和照片已保留。请先核对下方最新记录。<button type="button" class="cda-text-btn" data-action="refresh">读取最新记录</button><button type="button" class="cda-text-btn" data-action="resolve">已核对，保留草稿继续</button></div>':'')+editorMarkup()+(state.loading?'<p class="cda-muted" role="status">正在读取设计档案…</p>':'')+'<div class="cda-history">'+historyMarkup()+'</div>';
    }
    async function load(preserve) {
      const seq = ++state.loadSeq;
      state.loading = true; state.error = '';
      if (!preserve || !state.draft) render();
      try {
        const result = await api('customer_design_history');
        if (state.destroyed || seq !== state.loadSeq) return;
        state.versions = (Array.isArray(result.versions)?result.versions:[]).slice().sort((a,b)=>String(b.created_at || '').localeCompare(String(a.created_at || '')) || Number(b.version_no || 0)-Number(a.version_no || 0));
        state.latest = result.latest_version_id || null;
        if (!state.draft && result.visit_key) state.visitKey=result.visit_key;
        state.canWrite = result.can_write === true;
        state.customerId = result.customer_profile_id || state.customerId;
        state.loading = false;
        state.imageRetries.clear();
        if (state.conflict) state.conflictRead = true;
        if (preserve && state.draft) updateHistory(); else render();
        root.querySelectorAll('.cda-version[open]').forEach(el=>loadVersionPhotos(el));
      } catch (error) {
        if (state.destroyed || seq !== state.loadSeq) return;
        state.loading = false; state.error = '设计档案读取失败：'+error.message;
        if (preserve && state.draft) { updateHistory(); feedback(state.error,true); } else render();
      }
    }
    async function signPhotos(photos,force) {
      const ids = Array.from(new Set(photos.map(p=>p.id).filter(id=>id && (force || !state.urls.has(id) || Date.now()-(state.urlTimes.get(id)||0)>240000))));
      if (!ids.length) return;
      try {
        for(let offset=0;offset<ids.length;offset+=30) {
          const result = await api('customer_design_photo_urls',{asset_ids:ids.slice(offset,offset+30)});
          if(state.destroyed)return;
          const entries = result.assets || result.urls || result.photos || [];
          (Array.isArray(entries)?entries:Object.keys(entries).map(id=>({id,url:entries[id]}))).forEach(item=>{ const url = signedURL(item.url || item.signed_url || item.signedURL); if (url) {const id=item.id || item.asset_id;state.urls.set(id,url);state.urlTimes.set(id,Date.now());} });
        }
      } catch (_) { state.notice = '部分原图暂未载入，可重新读取档案。设计文字和历史仍保留。'; }
    }
    async function loadVersionPhotos(el) {
      if (!el.open || state.destroyed) return;
      const id=el.dataset.versionId,version=state.versions.find(v=>String(v.id)===id);
      if (!version || state.signing.has(id))return;
      const work=signPhotos(displayedVersionPhotos(version).photos);state.signing.set(id,work);await work;state.signing.delete(id);
      if(state.destroyed || !root.contains(el))return;
      const target=el.querySelector('.cda-version-photos');if(target)target.innerHTML=versionPhotosMarkup(version);
    }
    function toggle(event) {if(event.target.matches('.cda-version[open]'))loadVersionPhotos(event.target);}
    async function imageError(event) {
      const image=event.target,id=image.dataset && image.dataset.assetId;
      if(!id || state.destroyed || (state.imageRetries.get(id)||0)>=1)return;
      state.imageRetries.set(id,1);await signPhotos([{id}],true);
      if(!state.destroyed && root.contains(image) && state.urls.has(id))image.src=state.urls.get(id);
    }
    function updateHistory() {
      if (state.destroyed) return;
      const history = root.querySelector('.cda-history');
      if (history) history.innerHTML = historyMarkup();
      const saving = root.querySelector('.cda-save-row button');
      if (saving) { saving.disabled = state.saving || state.conflict || !state.canWrite; saving.textContent = state.saving?'保存中…':'保存新版本'; }
    }
    function feedback(message,error) {
      const el = root.querySelector('.cda-draft-feedback');
      if (el) { const tools=el.querySelector('.cda-conflict-tools'); el.textContent = message; if(tools)el.appendChild(tools); el.classList.toggle('cda-error',!!error); }
    }
    function startDraft() {
      const previous = state.versions.find(v=>options.bookingId?String(v.booking_id || '')===String(options.bookingId):!v.booking_id && String(v.visit_key || 'manual:'+v.booking_date)===state.visitKey);
      const latest = previous || null;
      state.draft = {baseline:model(latest && latest.baseline),optimized:model(latest && latest.optimized),reasons:clone(latest && latest.reasons || {}),photos:clone(latest && latest.photos || []),booking_date:text(options.bookingDate || localDate()).slice(0,10),visit_key:state.visitKey,status:latest && latest.status || 'baseline',expected:latest?latest.id:state.latest,dirty:false,contentDirty:false,requestId:uuid()};
      state.conflict = false; state.notice = ''; render();
      signPhotos(state.draft.photos).then(()=>{if(state.draft && !state.destroyed){const gallery=root.querySelector('.cda-photo-editor');if(gallery){const fieldsets=root.querySelectorAll('.cda-photo-editor .cda-photo-group');fieldsets.forEach(el=>el.remove());gallery.querySelector('legend').insertAdjacentHTML('afterend',photosMarkup(state.draft.photos,true));}}});
      root.querySelector('.cda-editor').scrollIntoView({block:'nearest'});
    }
    function dirty() { if (state.draft) { state.draft.dirty = true; state.draft.requestId = uuid(); if (options.onDirtyChange) options.onDirtyChange(true); } }
    function clearDraft() {
      if (state.draft) state.draft.photos.forEach(p=>{ if(p.local_url) URL.revokeObjectURL(p.local_url); });
      state.draft = null; state.conflict = false;
      if (options.onDirtyChange) options.onDirtyChange(false);
    }
    function readFile(file) {
      return new Promise((resolve,reject)=>{ const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=()=>reject(new Error('照片读取失败，请重新选择')); reader.readAsDataURL(file); });
    }
    function validation(d) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.booking_date)) return '请填写服务日期。';
      const keys = ['outline','root_flow'].concat(STEPS.map(([k])=>k));
      for (const key of keys) {
        const a = key==='outline'||key==='root_flow'?d.baseline[key]:d.baseline.steps[key];
        const b = key==='outline'||key==='root_flow'?d.optimized[key]:d.optimized.steps[key];
        if (b.trim() && a.trim()!==b.trim() && !text(d.reasons[key]).trim()) return '请为“'+({outline:'整体轮廓',root_flow:'发根毛流方向'}[key] || STEPS.find(s=>s[0]===key)[1])+'”填写调整理由。';
      }
      if (!keys.some(k=>(k==='outline'||k==='root_flow'?d.baseline[k] || d.optimized[k]:d.baseline.steps[k] || d.optimized.steps[k]).trim()) && !d.photos.length) return '请填写初始判断或添加本次照片。';
      return '';
    }
    async function save() {
      const d = state.draft;
      if (!d || state.saving || state.conflict || !state.canWrite) return;
      const error = validation(d); if (error) { feedback(error,true); return; }
      state.saving = true; root.querySelectorAll('.cda-editor input,.cda-editor textarea,.cda-editor select,.cda-editor button').forEach(el=>{el.disabled=true;}); updateHistory(); feedback('正在保存原图与设计版本…',false);
      try {
        for (const photo of d.photos) {
          if (photo.id) continue;
          const uploaded = await api('customer_design_upload',{booking_date:d.booking_date,visit_key:d.visit_key,request_id:photo.upload_request_id,stage:photo.stage,angle:photo.angle,filename:photo.file.name,mime_type:photo.file.type,data_base64:await readFile(photo.file)});
          if (state.destroyed) return;
          const asset = uploaded.asset || uploaded.photo || uploaded;
          if (!asset.id) throw new Error('原图上传未返回凭据，草稿已保留');
          Object.assign(photo,asset);
        }
        const result = await api('customer_design_save',{booking_date:d.booking_date,request_id:d.requestId,expected_latest_version_id:d.expected,status:d.status,baseline:d.baseline,optimized:d.optimized,reasons:d.reasons,photo_ids:d.photos.map(p=>p.id)});
        if (state.destroyed) return;
        if (result.version) { state.versions = [result.version].concat(state.versions.filter(v=>v.id!==result.version.id)); state.latest = result.latest_version_id || result.version.id; }
        clearDraft(); state.notice = '已保存新版本。原有设计、照片和历史版本均已保留。'; state.saving = false; render();
        await load(false);
        if (options.onSaved) options.onSaved(result);
      } catch (error) {
        if (state.destroyed) return;
        state.saving = false;
        state.conflict = /conflict|stale|version/i.test(String(error.code || '')+' '+error.message);
        state.conflictRead = false;
        root.querySelectorAll('.cda-editor input,.cda-editor textarea,.cda-editor select,.cda-editor button').forEach(el=>{el.disabled=false;});
        if (options.bookingId) root.querySelector('[data-meta="booking_date"]').readOnly=true;
        updateHistory();
        feedback((state.conflict?'已有其他新版本。请读取最新记录并核对后再保存。':'保存未确认：'+error.message+'。请先重新读取核对；不会自动重试。')+' 草稿和所选照片已保留。',true);
        if (!root.querySelector('.cda-conflict-tools')) {
          const tools = document.createElement('div'); tools.className='cda-conflict-tools';
          tools.innerHTML='<button type="button" class="cda-text-btn" data-action="refresh">读取最新记录</button>'+(state.conflict?'<button type="button" class="cda-text-btn" data-action="resolve">已核对，保留草稿继续</button>':'');
          root.querySelector('.cda-draft-feedback').appendChild(tools);
        }
      }
    }
    async function openPhoto(id) {
      const photos = state.versions.flatMap(v=>v.photos || []).concat(state.draft?state.draft.photos:[]);
      const photo = photos.find(p=>String(p.id)===id || String(p.local_id)===id);
      if (photo && !photo.file) await signPhotos([photo]);
      if (state.destroyed) return;
      const url = photo && (photo.file && /^blob:/.test(photo.local_url || '') ? photo.local_url : state.urls.get(photo.id));
      if (!url) return;
      if (state.viewer) state.viewer.remove();
      const viewer = document.createElement('dialog'); viewer.className='cda-viewer';
      viewer.innerHTML='<button type="button" aria-label="关闭原图">关闭</button><img src="'+esc(url)+'" alt="'+esc((STAGE[photo.stage] || '照片')+' '+(ANGLE[photo.angle] || ''))+'"><p>'+esc((STAGE[photo.stage] || '照片')+' · '+(ANGLE[photo.angle] || ''))+'</p>';
      document.body.appendChild(viewer); state.viewer=viewer;
      viewer.querySelector('button').addEventListener('click',()=>viewer.close());
      viewer.addEventListener('close',()=>{viewer.remove();if(state.viewer===viewer)state.viewer=null;});
      viewer.showModal();
    }
    function click(event) {
      const button=event.target.closest('button'); if(!button || !root.contains(button))return;
      if (button.dataset.photo) {openPhoto(button.dataset.photo);return;}
      if (button.dataset.removePhoto && state.draft && !state.saving) {
        const id = button.dataset.removePhoto;
        state.draft.photos=state.draft.photos.filter(p=>{ if(String(p.id)!==id && String(p.local_id)!==id)return true; if(p.local_url)URL.revokeObjectURL(p.local_url); return false; });
        state.draft.contentDirty=true; dirty(); render(); return;
      }
      const action=button.dataset.action;
      if(action==='record' && state.canWrite)startDraft();
      if(action==='cancel' && !state.saving) { if(state.draft.dirty) {feedback('草稿已保留，可继续编辑并保存。若要关闭档案，请使用页面的关闭按钮。',false);return;} clearDraft();render(); }
      if(action==='refresh')load(true);
      if(action==='resolve' && !state.loading && state.draft) {if(!state.conflictRead){feedback('请先读取最新记录，核对后再继续。草稿仍保留。',true);return;}state.draft.expected=state.latest;state.conflict=false;dirty();updateHistory();feedback('草稿保留。请核对差异后点击“保存新版本”。',false);button.remove();}
    }
    function change(event) {
      const el=event.target,d=state.draft; if(!d || state.saving)return;
      if(el.dataset.group) { const g=el.dataset.group,k=el.dataset.key; if(g==='reasons')d.reasons[k]=el.value;else if(k==='outline'||k==='root_flow')d[g][k]=el.value;else d[g].steps[k]=el.value;d.contentDirty=true;dirty(); }
      if(el.dataset.meta==='booking_date' && el.value!==d.booking_date) {
        if(d.contentDirty || d.photos.some(p=>p.file)) {el.value=d.booking_date;feedback('已填写的设计和照片仍保留。请先保存本次记录，再更换服务日期。',true);return;}
        d.booking_date=el.value;d.visit_key='manual:'+el.value;
        const previous=state.versions.find(v=>!v.booking_id && String(v.visit_key || 'manual:'+v.booking_date)===d.visit_key);
        d.baseline=model(previous && previous.baseline);d.optimized=model(previous && previous.optimized);d.reasons=clone(previous && previous.reasons || {});d.photos=clone(previous && previous.photos || []);d.status=previous && previous.status || 'baseline';d.expected=previous?previous.id:null;dirty();render();return;
      }
      if(el.dataset.meta && el.dataset.meta!=='booking_date') {d[el.dataset.meta]=el.value;d.contentDirty=true;dirty();}
      if(el.dataset.photoMeta) {
        const p=d.photos.find(p=>p.local_id===el.dataset.localId && !p.id);
        if(p){p[el.dataset.photoMeta]=el.value;p.upload_request_id=uuid();d.contentDirty=true;dirty();render();}return;
      }
      if(el.dataset.upload==='file') {
        const stage=root.querySelector('[data-upload="stage"]').value,angle=root.querySelector('[data-upload="angle"]').value;
        const errors=[];
        Array.from(el.files || []).forEach(file=>{
          if(!TYPES.includes(file.type) || !file.size || file.size>MAX_BYTES) {errors.push('仅支持非空 JPEG / PNG / WebP，每张最多 8 MB。');return;}
          if(d.photos.length>=30){errors.push('每个设计版本最多保留 30 张照片。');return;}
          d.photos.push({local_id:uuid(),upload_request_id:uuid(),local_url:URL.createObjectURL(file),file,stage,angle});d.contentDirty=true;dirty();
        });
        render(); if(errors.length)feedback(errors[0]+' 其余已选照片已保留。',true);
      }
    }
    function submit(event) {if(event.target.matches('.cda-editor')){event.preventDefault();save();}}
    function inputEvent(event) {if(event.target.type!=='file')change(event);}
    function fileEvent(event) {if(event.target.type==='file')change(event);}
    root.addEventListener('click',click);root.addEventListener('input',inputEvent);root.addEventListener('change',fileEvent);root.addEventListener('submit',submit);root.addEventListener('toggle',toggle,true);root.addEventListener('error',imageError,true);
    render();load(false);
    return {refresh:()=>load(true),hasUnsavedChanges:()=>!!(state.draft && state.draft.dirty),destroy:()=>{state.destroyed=true;state.loadSeq++;clearDraft();if(state.viewer)state.viewer.remove();root.removeEventListener('click',click);root.removeEventListener('input',inputEvent);root.removeEventListener('change',fileEvent);root.removeEventListener('submit',submit);root.removeEventListener('toggle',toggle,true);root.removeEventListener('error',imageError,true);root.remove();}};
  }
  global.CustomerDesignArchive = {mount};
})(window);
