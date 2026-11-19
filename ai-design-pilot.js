/* Buildless pilot UI. Offline by default; explicit loopback-only synthetic adapter is optional. */
(function (global) {
  'use strict';

  const CUSTOMERS = [
    { id:'demo-booking-a', title:'模拟预约 A', detail:'虚构预约 · 10:00 · 设计沟通', type:'预约' },
    { id:'demo-booking-b', title:'模拟预约 B', detail:'虚构预约 · 14:00 · 剪染沟通', type:'预约' },
    { id:'demo-walk-in', title:'模拟散客 C', detail:'虚构散客 · 无预约 · 独立草稿', type:'散客' }
  ];
  const STEPS = ['顾客与素材','人物与风格','六区与工艺','完成复盘','模拟档案'];
  const ZONES = [
    ['bangs','刘海区','#ceb18c','额前轮廓与目标流向'],
    ['top','顶区','#aabca1','顶部形态与纹理'],
    ['ear_front','耳前区','#c8b8ba','脸周连接与目标流向'],
    ['ear_back','耳后区','#9eb8b4','侧后连接与目标流向'],
    ['middle','中区','#c4be95','主体宽度与层次过渡'],
    ['bottom','底区','#b3afc3','后颈轮廓与底线']
  ];
  const BASIC = [['style','风格意向'],['person','人物与轮廓观察'],['length','长度目标'],['features','发型特点'],['layers','层次意向'],['bangs','刘海意向'],['curls','卷度意向']];
  const ZONE_FIELDS = [['goal','区域目标'],['action','操作记录'],['direction','明确流向']];
  const PERM = [['placement','所在位置 / 左右侧'],['rods','杠具 / 杠号'],['method','卷杠方法'],['direction','排杠方向'],['products','产品名称'],['mix','配比'],['application','上药位置'],['softening','软化控制 / 现场确认']];
  const DYE = [['placement','所在位置 / 左右侧'],['colors','目标颜色 / 色号'],['products','染发产品'],['ratios','配比'],['regions','施作区域'],['application','涂抹方法 / 顺序']];
  const REVIEW = [['achieved','观察到的完成情况'],['pending','待核实 / 待调整'],['next','后续记录']];
  const DIRECTIONS = [['','待确认'],['forward','向前 · 朝脸'],['backward','向后 · 离脸'],['up','向上'],['down','向下']];
  const ORIGINS = { manual:'人工输入', demo_extract:'AI 提取演示', demo_suggest:'AI 建议演示' };
  const ANGLES = { front:'正面', back:'背面', left:'左侧', right:'右侧' };
  const SAMPLE = '【固定虚构示例，不来自照片识别】\n模拟顾客希望保留长度，整体简洁，脸周柔和。刘海区向后，顶区向上，耳前区向后。耳后区、中区、底区的方向未确认。今天拟剪发并讨论烫发，不做染发。杠具、卷杠方法、产品、配比、上药位置和软化控制均待现场确认。';
  const TYPES = ['image/jpeg','image/png','image/webp'];
  const MAX_PHOTOS = 4;
  const MAX_BYTES = 8 * 1024 * 1024;
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let instanceCount = 0;
  function record(phase) { return { value:'', original:'', origin:'manual', confirmed:false, phase:phase||'planned', edited:false, tracks:{planned:null,actual:null} }; }
  function records(fields,phase) { return Object.fromEntries(fields.map(([key])=>[key,record(phase)])); }
  function trackCopy(field) { return {value:field.value,original:field.original,origin:field.origin,confirmed:field.confirmed,phase:field.phase,edited:field.edited}; }
  function newDraft(id) {
    return { id, step:0, selectedZone:'bangs', text:'', transcript:'', syntheticConsent:false, expandedGroups:{}, globalOpen:{perm:false,dye:false},
      photos:{before:[],after:[]}, side:{before:'left',after:'left'}, basic:records(BASIC,'context'), proposal:record(), care:record('actual'),
      zones:Object.fromEntries(ZONES.map(([key])=>[key,records(ZONE_FIELDS)])),
      zoneProcesses:Object.fromEntries(ZONES.map(([key])=>[key,{perm:[],dye:[]}])),
      services:{cut:true,perm:false,dye:false}, perm:records(PERM), dye:records(DYE), review:records(REVIEW,'actual'),
      materialRevision:0, designRevision:0, analysis:null, comparison:null, revisions:[], demoLoaded:false, notice:'' };
  }
  function directionLabel(value) { return (DIRECTIONS.find(([key])=>key===value)||['','待确认'])[1]; }
  function photoCoverage(list) {
    return ['front','back','side'].every(angle=>list.some(p=>angle==='side'?['left','right'].includes(p.angle):p.angle===angle));
  }
  function allRecords(draft) {
    return Object.values(draft.basic).concat([draft.proposal,draft.care],Object.values(draft.zones).flatMap(Object.values),Object.values(draft.zoneProcesses).flatMap(zone=>zone.perm.concat(zone.dye).flatMap(Object.values)),Object.values(draft.perm),Object.values(draft.dye),Object.values(draft.review)).flatMap(field=>[field].concat(Object.entries(field.tracks||{}).filter(([phase,value])=>phase!==field.phase&&value).map(([,value])=>value)));
  }
  function snapshot(draft) {
    const result = {
      mode:'offline-synthetic-only', customerId:draft.id, synthetic:true, text:draft.text, transcript:draft.transcript,
      basic:clone(draft.basic), proposal:clone(draft.proposal), care:clone(draft.care), zones:clone(draft.zones), zoneProcesses:clone(draft.zoneProcesses), services:clone(draft.services),
      perm:clone(draft.perm), dye:clone(draft.dye), review:clone(draft.review),
      photoSummary:Object.fromEntries(['before','after'].map(stage=>[stage,Object.fromEntries(Object.keys(ANGLES).map(angle=>[angle,draft.photos[stage].filter(p=>p.angle===angle).length]))])),
      analysisStatus:draft.analysis?(draft.analysis.materialRevision===draft.materialRevision?'演示整理记录（非真实 AI）':'素材已变更，演示记录待复核'):'未运行演示整理',
      comparisonStatus:draft.comparison&&draft.comparison.materialRevision===draft.materialRevision&&draft.comparison.designRevision===draft.designRevision?'已建立模拟并排对照，未验证效果':'未建立当前模拟对照',
      photoNotice:'仅记录数量与角度；不包含照片、图片地址、原文件名或录音。', completion:'模拟记录，不代表服务已完成'
    };
    return result;
  }
  function freezeDeep(value) {
    Object.values(value).forEach(item=>{ if(item && typeof item==='object') freezeDeep(item); });
    return Object.freeze(value);
  }

  function mount(container, options) {
    if (!container || typeof container.appendChild!=='function') throw new Error('需要一个页面容器。');
    options = options || {};
    const adapter=options.connectedAdapter||null, connected=Boolean(adapter);
    if(connected&&(global.location.hostname!=='127.0.0.1'||global.location.protocol!=='http:'))throw new Error('本机合成连接只允许 127.0.0.1。');
    const customers=connected?adapter.customers.map(item=>({id:item.id,title:item.title,detail:(['walk-in','walk_in','散客'].includes(item.kind)?'虚构散客':'虚构预约')+' · 同一模拟试用身份 · 独立本机草稿'})):CUSTOMERS;
    const prefix = 'adp-'+(++instanceCount)+'-';
    const root = document.createElement('section');
    root.className = 'adp';
    root.setAttribute('aria-label','AI 设计工作台，'+(connected?'本机合成服务试用':'离线模拟试用'));
    container.appendChild(root);
    const drafts = new Map(customers.map(customer=>[customer.id,newDraft(customer.id)]));
    const persistence=new Map(customers.map(customer=>[customer.id,{loaded:false,busy:false,revision:0,status:'draft',dirty:false,pending:null,error:'',requestToken:0,discardConfirm:false}]));
    const objectURLs = new Set();
    const pending = new Set();
    let customerId = customers[0].id;
    let destroyed = false, session = 0, photoId = 0;
    const current = () => drafts.get(customerId);
    const customer = () => customers.find(item=>item.id===customerId);
    const syncState = () => persistence.get(customerId);
    const canEdit = () => !connected||(syncState().loaded&&!syncState().busy&&!syncState().pending&&syncState().status==='draft');
    function signal(message) { current().notice=message; render(); }
    function changed(draft, material) {
      if (material) draft.materialRevision++;
      draft.designRevision++;
      if(connected){const state=persistence.get(draft.id);state.dirty=true;state.error='';state.discardConfirm=false;}
      if(draft===current()) {
        const label=root.querySelector('.adp-comparison h4');
        if(label)label.textContent='素材或记录已更改，请重新建立对照';
      }
    }
    function safeDraft(draft){
      const result={};
      for(const key of ['step','selectedZone','text','transcript','basic','proposal','care','zones','zoneProcesses','services','perm','dye','review','side','analysis','comparison','materialRevision','designRevision','demoLoaded'])result[key]=clone(draft[key]);
      result.schemaVersion='design-pilot-ui-draft-v1';result.synthetic=true;
      result.photos=Object.fromEntries(['before','after'].map(stage=>[stage,draft.photos[stage].filter(photo=>photo.kind==='demo').map(photo=>({id:photo.id,kind:'demo',angle:photo.angle}))]));
      return result;
    }
    function restoreDraft(id,saved){
      const next=newDraft(id);
      if(saved){
        for(const key of ['step','selectedZone','text','transcript','basic','proposal','care','zones','zoneProcesses','services','perm','dye','review','side','analysis','comparison','materialRevision','designRevision','demoLoaded'])if(saved[key]!==undefined)next[key]=clone(saved[key]);
        for(const stage of ['before','after'])for(const photo of saved.photos?.[stage]||[]){photoId=Math.max(photoId,photo.id);next.photos[stage].push({id:photo.id,angle:photo.angle,kind:'demo',url:sampleImage(stage,photo.angle)});}
      }
      return next;
    }
    function adoptConnected(id,result){
      const state=persistence.get(id),draft=restoreDraft(id,result.draft);
      draft.revisions=(result.archives||[]).map(item=>{const data=snapshot(restoreDraft(id,item.draft));data.mode='localhost-synthetic-only';data.completion='本机合成记录，不代表正式服务已完成';return {number:item.number,time:item.createdAt,data};});
      state.revision=result.revision;state.status=result.status;state.loaded=true;state.dirty=false;state.pending=null;state.error='';state.conflict=false;state.discardConfirm=false;
      drafts.set(id,draft);
    }
    async function connectedLoad(force){
      const id=customerId,state=persistence.get(id);if(state.busy)return;
      if(force&&(state.dirty||state.pending)&&!state.discardConfirm){state.discardConfirm=true;render();return;}
      state.discardConfirm=false;state.busy=true;state.error='';const token=++state.requestToken;render();
      try{
        const result=await adapter.load(id);
        if(destroyed||token!==state.requestToken)return;
        adoptConnected(id,result);drafts.get(id).notice='已读取本机合成记录。不是云端档案，也未连接真实顾客系统。';
      }catch(error){if(!destroyed&&token===state.requestToken)state.error='读取失败：'+error.message;}
      finally{if(!destroyed&&token===state.requestToken){state.busy=false;if(customerId===id)render();}}
    }
    async function connectedWrite(kind,retry){
      const id=customerId,state=persistence.get(id);
      if(state.busy||!state.loaded)return;
      if(!retry&&state.pending)return;
      if(!retry){
        if(kind==='save'&&!canEdit())return;
        if(kind==='archive'&&(state.dirty||state.status!=='draft')){signal('请先保存当前草稿，再追加本机归档。');return;}
        if(kind==='reopen'&&state.status!=='archived')return;
        state.pending={kind,requestId:global.crypto.randomUUID(),revision:state.revision,draft:kind==='save'?safeDraft(current()):null};
      }
      const operation=state.pending;if(!operation)return;
      state.busy=true;state.error='';const token=++state.requestToken;render();
      try{
        const result=await adapter[operation.kind](id,operation.revision,operation.requestId,operation.draft);
        if(destroyed||token!==state.requestToken)return;
        const step=drafts.get(id).step,zone=drafts.get(id).selectedZone;
        adoptConnected(id,result);drafts.get(id).step=step;drafts.get(id).selectedZone=zone;
        drafts.get(id).notice=operation.kind==='save'?'已保存到本机合成测试目录；刷新和正常服务重启后可读取。':operation.kind==='archive'?'已追加本机合成归档，旧档保持不变。继续修改请先新建修订。':'已打开同一模拟顾客的新修订；之前的归档不会改变。';
      }catch(error){
        if(!destroyed&&token===state.requestToken){
          state.error=(error.code==='REVISION_CONFLICT'?'版本冲突：':'请求未完成：')+error.message+'。当前输入保留，未自动重发。';
          state.conflict=error.code==='REVISION_CONFLICT'||error.code==='IDEMPOTENCY_CONFLICT';
        }
      }finally{if(!destroyed&&token===state.requestToken){state.busy=false;if(customerId===id)render();}}
    }
    function connectedToolbar(){
      if(!connected)return '';
      const state=syncState(),label=state.busy?'正在处理本机请求…':!state.loaded?'本机记录尚未加载':state.status==='archived'?'已归档 · 只读':state.dirty?'有未保存的合成更改':'已与本机记录一致';
      return '<section class="adp-connected-bar" aria-label="本机保存状态"><div><strong>'+label+'</strong><span data-connected-revision>本机 revision '+state.revision+' · '+esc(customer().title)+'</span></div>'+
        (state.error?'<p class="adp-connected-error" role="alert">'+esc(state.error)+'</p>':'')+
        '<div class="adp-actions"><button type="button" class="adp-primary" data-action="connected-save"'+(!canEdit()||!state.dirty?' disabled':'')+'>保存到本机</button><button type="button" data-action="connected-load"'+(state.busy?' disabled':'')+'>'+(state.loaded?'重新读取':'读取 / 重试加载')+'</button>'+
        (state.pending&&!state.busy&&!state.conflict?'<button type="button" data-action="connected-retry">重试同一请求</button>':'')+
        (state.status==='archived'?'<button type="button" data-action="connected-reopen"'+(state.busy||state.pending?' disabled':'')+'>新建修订</button>':'')+'</div>'+
        (state.discardConfirm?'<div class="adp-safety">重新读取会丢弃此顾客尚未确认保存的本页更改。<div class="adp-actions"><button type="button" data-action="connected-load">确认重新读取</button><button type="button" data-action="connected-cancel-reload">保留当前输入</button></div></div>':'')+'</section>';
    }
    function getRecord(path) {
      const parts=path.split('.');
      let value=current();
      for (const part of parts) {
        if (!value || !Object.prototype.hasOwnProperty.call(value,part)) return null;
        value=value[part];
      }
      return value && typeof value.value==='string'?value:null;
    }
    function provenance(field) {
      return (ORIGINS[field.origin]||ORIGINS.manual)+(field.edited?' · 已人工修改':'');
    }
    function fieldMarkup(path,title,field,kind) {
      const id=prefix+path.replace(/\./g,'-');
      const valueControl=kind==='direction'
        ? '<select id="'+id+'" data-field="'+path+'">'+DIRECTIONS.map(([key,label])=>'<option value="'+key+'"'+(field.value===key?' selected':'')+'>'+label+'</option>').join('')+'</select>'
        : connected?'<select id="'+id+'" data-field="'+path+'">'+adapter.valuesFor(path).map(value=>'<option value="'+esc(value)+'"'+(field.value===value?' selected':'')+'>'+esc(value||'待确认 · 未提供')+'</option>').join('')+'</select>':'<textarea id="'+id+'" data-field="'+path+'" rows="2" maxlength="1600" placeholder="待确认，未提供的信息请留空">'+esc(field.value)+'</textarea>';
      const fixedPhase=field.phase==='context'||path.startsWith('review.')||path==='care';
      const phaseControl=fixedPhase?'<span class="adp-source">'+(field.phase==='context'?'观察 / 意向记录':'完成观察 · 本人填写')+'</span>':
        '<select data-phase="'+path+'" aria-label="'+esc(title)+'记录阶段"><option value="planned"'+(field.phase==='planned'?' selected':'')+'>拟执行方案</option><option value="actual"'+(field.phase==='actual'?' selected':'')+'>实际执行记录</option></select>';
      const otherPhase=field.phase==='actual'?'planned':'actual',other=field.tracks&&field.tracks[otherPhase];
      return '<div class="adp-field" data-record="'+path+'"><label for="'+id+'">'+esc(title)+'</label>'+valueControl+
        '<div class="adp-field-meta"><span class="adp-source" data-origin="'+field.origin+'">'+esc(provenance(field))+'</span>'+
        phaseControl+
        '<label class="adp-check"><input type="checkbox" data-confirm="'+path+'"'+(field.confirmed?' checked':'')+(field.value.trim()?'':' disabled')+'>本人已核对</label></div>'+
        (!fixedPhase?'<p class="adp-track-note adp-caption">'+(other&&other.value.trim()?(otherPhase==='planned'?'拟执行方案':'实际执行记录')+'另有保留，切换可查看。':'方案与实际分别填写；切换不会把方案直接当成实际。')+'</p>':'')+
        '<details><summary>原始来源'+(field.edited?'（当前值已修改）':'')+'</summary><p class="adp-original">'+esc(field.original||'尚无来源；手工输入首次完成后保留原文。')+'</p>'+
        '<p class="adp-caption">'+(field.origin==='manual'?'保留首次输入，不随修改覆盖。':'来自固定虚构示例，不是对当前照片或自由文本的识别。')+' '+(field.edited?'原文用于追溯，不代表修改后的内容已经有证据。':'')+'</p></details></div>';
    }
    function fieldsMarkup(group,fields,data) { return fields.map(([key,title])=>fieldMarkup(group+'.'+key,title,data[key])).join(''); }
    function heading(index,title,description) {
      return '<div class="adp-section-heading"><div><p class="adp-index">STEP 0'+(index+1)+'</p><h2 tabindex="-1" data-step-heading>'+title+'</h2><p>'+description+'</p></div></div>';
    }
    function sampleImage(stage,angle) {
      const side=['left','right'].includes(angle), back=angle==='back';
      const shape=side?'<path d="M88 38 Q132 28 139 76 L153 94 139 104 137 126 115 145 114 164 88 164 85 136 Q65 112 66 78 Q66 50 88 38Z" fill="#dce2d3" stroke="#738b75" stroke-width="2"/><path d="M86 43 Q127 30 136 75 Q105 68 88 105 L75 134 Q57 87 70 58Z" fill="#adbca1"/>':'<path d="M56 145 Q35 92 58 51 Q100 14 142 51 Q164 92 144 145Z" fill="#a9b99c"/><ellipse cx="100" cy="95" rx="37" ry="49" fill="#e6e9de"/><path d="M65 74 Q100 44 135 74 L135 52 Q100 22 65 52Z" fill="#a9b99c"/>'+(back?'<path d="M58 75 Q100 48 142 75 L143 146 57 146Z" fill="#a9b99c"/>':'<path d="M83 102 Q100 108 117 102 M100 87 L96 99" stroke="#9ba991" fill="none"/>');
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="250" viewBox="0 0 200 250"><rect width="200" height="250" fill="#edf0e7"/><path d="M35 221 Q40 175 83 171 L83 138 117 138 117 171 Q160 175 165 221" fill="#ced9c4" stroke="#8c9f82"/>'+(angle==='left'?'<g transform="translate(200 0) scale(-1 1)">'+shape+'</g>':shape)+'<text x="100" y="22" text-anchor="middle" font-size="12" fill="#566b50">虚构示意 · '+ANGLES[angle]+'</text><rect x="24" y="222" width="152" height="21" rx="5" fill="#d8e0cf"/><text x="100" y="237" text-anchor="middle" font-size="11" fill="#536848">'+(stage==='before'?'原始位':'完成位')+'占位图 · 非真实效果</text></svg>';
      return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    }
    function photoGroup(stage) {
      const d=current();
      const slots=[['front','正面'],['back','背面'],['side','侧面']];
      return '<div class="adp-photo-grid">'+slots.map(([slot,label])=>{
        const photos=d.photos[stage].filter(p=>slot==='side'?['left','right'].includes(p.angle):p.angle===slot);
        return '<section class="adp-photo-slot"><h4>'+label+'<span>'+photos.length+'/'+MAX_PHOTOS+'</span></h4>'+
          (slot==='side'?'<select data-photo-side="'+stage+'" aria-label="'+(stage==='before'?'原始':'完成')+'侧面照片方向"><option value="left"'+(d.side[stage]==='left'?' selected':'')+'>添加左侧照片</option><option value="right"'+(d.side[stage]==='right'?' selected':'')+'>添加右侧照片</option></select>':'')+
          (photos.length?'<div class="adp-photo-strip">'+photos.map(p=>'<figure><img src="'+esc(p.url)+'" alt="'+(stage==='before'?'原始':'完成')+' · '+ANGLES[p.angle]+' · '+(p.kind==='demo'?'虚构示意图':'本地测试预览')+'"><figcaption>'+ANGLES[p.angle]+' · '+(p.kind==='demo'?'虚构示意，非照片':'本地预览，未上传')+'</figcaption><button type="button" data-remove-photo="'+p.id+'" data-photo-stage="'+stage+'">移除</button></figure>').join('')+'</div>':'<div class="adp-photo-empty">'+(slot==='side'?'明确左侧或右侧':'添加'+label+'测试图')+'</div>')+
          (connected?'<p class="adp-caption">仅内置合成示意图</p>':'<label class="adp-file-label">选择测试照片<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-file-stage="'+stage+'" data-file-angle="'+slot+'" aria-label="添加'+(stage==='before'?'原始':'完成')+label+'测试照片"'+(d.syntheticConsent?'':' disabled')+'></label>')+'</section>';
      }).join('')+'</div>';
    }
    function photosSection(stage) {
      return '<section class="adp-section"><h3>'+(stage==='before'?'原始素材':'完成素材')+'</h3><p class="adp-muted">'+(connected?'正面、背面、至少一个明确的左侧或右侧。只记录内置示意图的角度标记；不选择文件、不传图片内容或地址。':'正面、背面、至少一个明确的左侧或右侧。每个位置可选多张 JPEG / PNG / WebP，单张不超过 8 MB，最多 4 张。')+'</p>'+photoGroup(stage)+
        '<div class="adp-actions"><button type="button" data-action="demo-photos" data-stage="'+stage+'">放入虚构示意图</button><span class="adp-muted">仅补空位置，不替换已有素材</span></div></section>';
    }
    function intakeMarkup() {
      const d=current();
      if(connected)return heading(0,'完整流程，连接本机合成记录','固定模拟身份：demo-ui-owner。切换顾客只切换合成服务记录，不切换身份。')+photosSection('before')+
        '<section class="adp-section"><h3>固定合成沟通原话</h3><p class="adp-muted">这条连接路径只接受预设合成选项，不接收自由输入、真实顾客资料、录音或密钥。可编辑各字段的固定测试选项。</p><p class="adp-original" data-connected-text>'+esc(d.text||'尚未载入固定示例')+'</p><div class="adp-actions"><button type="button" data-action="demo-text">载入固定虚构示例</button></div>'+
        '<h4 class="adp-textarea-label">模拟口述转写</h4><p class="adp-original" data-connected-transcript>'+esc(d.transcript||'尚未添加固定转写文本')+'</p><div class="adp-actions"><button type="button" data-action="connected-transcript">添加固定口述文本</button><button type="button" data-action="connected-clear-transcript">清空口述文本</button></div><p class="adp-input-help">这里只演示转写后文本的记录，不启用麦克风、语音识别或远程 AI。</p></section>';
      return heading(0,'从一次设计沟通开始','先选模拟顾客，再记录素材和原话。素材只在当前页面内存中预览。')+
        '<label class="adp-check"><input type="checkbox" data-consent'+(d.syntheticConsent?' checked':'')+'>我仅使用虚构 / 测试素材，不填写真实顾客资料或密钥</label>'+photosSection('before')+
        '<section class="adp-section"><h3>沟通原话</h3><label class="adp-textarea-label" for="'+prefix+'text">文字记录</label><textarea id="'+prefix+'text" data-text="text" rows="4" maxlength="6000" placeholder="记录这次想要的风格、长度与明确要求。此版本不会自动理解自由文本。">'+esc(d.text)+'</textarea>'+
        '<label class="adp-textarea-label" for="'+prefix+'transcript">口述转写 / 文字补充</label><textarea id="'+prefix+'transcript" data-text="transcript" rows="3" maxlength="6000" placeholder="可用设备键盘的听写功能，或直接键入转写文字。">'+esc(d.transcript)+'</textarea>'+
        '<p class="adp-input-help">本页不录音，也不启用浏览器麦克风或语音识别。键盘听写由设备系统提供，其处理方式取决于系统设置；也可全程打字。</p>'+
        '<div class="adp-actions"><button type="button" data-action="demo-text">载入固定虚构示例</button><span class="adp-muted">仅供查看整理后的字段，不分析照片</span></div></section>';
    }
    function analysisMarkup() {
      const d=current(), stale=d.analysis&&d.analysis.materialRevision!==d.materialRevision;
      return heading(1,'先看人物与基础风格','只整理人物观察、风格和设计意向；此阶段不做护理分析，也不凭照片判断发质或工艺参数。')+
        '<div class="adp-status-bar"><span class="adp-tag adp-warning">AI 未连接 · 离线模拟</span><span class="adp-tag'+(stale?' adp-warning':'')+'">'+(stale?'素材已变更，需重新核对':d.analysis?'已运行演示整理':'尚未整理')+'</span></div>'+
        '<p class="adp-muted">固定示例只展示明确原话如何进入字段。自由输入不会被自动提取；请手工填写，未知留空。建议与原话提取分开标注，均需本人核对。</p>'+
        '<div class="adp-actions"><button type="button" class="adp-primary" data-action="analyze">运行模拟整理</button></div>'+
        '<section class="adp-section"><p class="adp-caption">八步设计中的前七项在此记录；第八项“完成后打理”仅在完成复盘阶段人工填写，剪前不分析打理或护理。</p><div class="adp-grid-two">'+fieldsMarkup('basic',BASIC,d.basic)+'</div></section>'+
        '<section class="adp-section"><h3>发型师提案</h3><p class="adp-muted">保留原始来源，当前方案可继续改写。修改后会重新变为待核对，不自动当作已完成操作。</p>'+fieldMarkup('proposal','本次设计提案',d.proposal)+'</section>';
    }
    function mapMarkup() {
      const d=current(), selected=d.selectedZone;
      const zone=(key,path)=>'<path d="'+path+'" fill="'+ZONES.find(z=>z[0]===key)[2]+'" data-map-zone="'+key+'" data-selected="'+(key===selected)+'"><title>'+ZONES.find(z=>z[0]===key)[1]+'</title></path>';
      const neck='<path d="M42 163 L44 137 76 137 78 163 Q105 166 111 190 H9 Q15 166 42 163Z" fill="#e2e7dc" stroke="#9aac9b" stroke-width="1.4"/>';
      const face='<path d="M29 70 Q28 27 60 26 Q92 27 91 70 L87 112 Q77 142 60 144 Q43 142 33 112Z" fill="#f3f1e7" stroke="#97a48e" stroke-width="1.4"/>';
      const front=neck+face+zone('top','M25 55 Q26 18 60 15 Q94 18 95 55 L84 63 36 63Z')+zone('bangs','M31 53 Q60 43 89 53 L85 81 Q72 69 60 74 Q48 68 35 81Z')+zone('ear_front','M25 59 L35 76 34 118 23 134 18 104Z M95 59 L85 76 86 118 97 134 102 104Z')+zone('middle','M18 104 L23 134 34 118 34 142 20 157 13 135Z M102 104 L97 134 86 118 86 142 100 157 107 135Z')+'<path d="M46 100 L51 100 M69 100 L74 100 M60 103 L57 113 62 113 M51 125 Q60 128 69 125" stroke="#a6b09c" fill="none"/>';
      const back=neck+zone('top','M25 61 Q25 17 60 15 Q95 17 95 61 L82 76 38 76Z')+zone('ear_back','M25 55 L40 72 38 117 20 115Z M95 55 L80 72 82 117 100 115Z')+zone('middle','M39 69 L81 69 101 118 94 145 26 145 19 118Z')+zone('bottom','M26 135 Q60 151 94 135 L90 158 Q60 170 30 158Z');
      const side='<path d="M38 160 L42 136 65 135 66 160 Q94 166 108 190 H10 Q15 171 38 160Z" fill="#e2e7dc" stroke="#9aac9b" stroke-width="1.4"/>'+
        '<path d="M43 27 Q75 24 82 63 L95 81 84 88 82 111 65 134 45 137 Q24 110 22 76 Q20 43 43 27Z" fill="#f3f1e7" stroke="#97a48e" stroke-width="1.4"/>'+
        zone('top','M24 61 Q24 18 58 17 Q79 18 85 52 L67 63 42 68Z')+zone('bangs','M68 45 L85 51 83 81 72 74 64 63Z')+
        zone('ear_front','M62 64 L74 72 72 119 60 128 56 105Z')+zone('ear_back','M35 68 L59 65 55 107 42 122 27 112Z')+
        zone('middle','M25 105 L43 117 55 109 60 126 43 146 24 140 17 122Z')+zone('bottom','M24 137 L45 141 58 129 59 153 38 164 21 154Z')+
        '<path d="M58 87 Q47 80 49 100 Q52 107 57 100 M79 77 L84 77" fill="none" stroke="#869781" stroke-width="1.5"/>';
      const coords={front:{bangs:[60,62],top:[60,34],ear_front:[27,96],middle:[24,139]},side:{bangs:[76,62],top:[51,39],ear_front:[66,97],ear_back:[41,91],middle:[35,129],bottom:[39,151]},back:{top:[60,42],ear_back:[29,94],middle:[60,111],bottom:[60,151]}};
      function arrows(view) {
        return Object.entries(coords[view]).map(([key,[x,y]])=>{
          const value=d.zones[key].direction.value;
          if (!value || (view!=='side' && ['forward','backward'].includes(value))) return '';
          const delta={forward:[13,0],backward:[-13,0],up:[0,-13],down:[0,13]}[value];
          if (!delta) return '';
          const field=d.zones[key].direction;
          return '<line x1="'+(x-delta[0]/2)+'" y1="'+(y-delta[1]/2)+'" x2="'+(x+delta[0]/2)+'" y2="'+(y+delta[1]/2)+'" stroke="#294735" stroke-width="2.2"'+(field.phase==='planned'?' stroke-dasharray="3 2"':'')+' marker-end="url(#'+prefix+'arrow-'+view+')" pointer-events="none"><title>'+ZONES.find(z=>z[0]===key)[1]+'：'+directionLabel(value)+' · '+(field.phase==='planned'?'拟执行':'实际记录')+' · '+(field.confirmed?'已核对':'待核对')+'</title></line>';
        }).join('');
      }
      return '<div class="adp-map-panel"><div class="adp-mannequins">'+[['front','正面',front],['side','侧面 · 面朝右',side],['back','背面',back]].map(([view,title,content])=>'<figure class="adp-mannequin"><svg viewBox="0 0 120 196" role="img" aria-label="中性人头六区'+title+'示意"><defs><marker id="'+prefix+'arrow-'+view+'" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0 L5 2.5 0 5Z" fill="#294735"/></marker></defs>'+content+arrows(view)+'</svg><figcaption>'+title+'</figcaption></figure>').join('')+'</div>'+
        '<div class="adp-zone-tabs" aria-label="选择六区">'+ZONES.map(([key,label,color],i)=>'<button type="button" data-zone="'+key+'" aria-pressed="'+(key===selected)+'"><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="4" fill="'+color+'"/></svg>'+String(i+1).padStart(2,'0')+' '+label+'</button>').join('')+'</div>'+
        '<p class="adp-zone-legend">点击色区或对应按钮编辑。不可见的区域不强行画到正面。<br>箭头来自各区当前显示的流向：虚线为拟执行，实线为实际记录。侧面 → 朝脸、← 离脸；↑ 向上、↓ 向下。前后方向只在侧面表示。箭头不表示角度、杠号、圈数或真实结果，未填不画。<br>人头是区域示意，不呈现左右不对称方案。左右侧和同区不同操作请在分组“所在位置 / 左右侧”写明。分组排杠保留为文字，不自动镜像、套用或画到人头上。</p></div>';
    }
    function zoneProcessMarkup(key,type) {
      const d=current(), groups=d.zoneProcesses[key][type], fields=type==='perm'?PERM:DYE, title=type==='perm'?'烫发':'染发';
      return '<section class="adp-section" data-zone-process="'+type+'"'+(d.services[type]?'':' hidden')+'><h3>'+ZONES.find(([zoneKey])=>zoneKey===key)[1]+' · '+title+'分组</h3><p class="adp-muted">同一区域可分别记录多组'+(type==='perm'?'杠具、卷法和配方':'色号和配方')+'；不自动把一组参数应用到其他组或区域。</p>'+
        groups.map((group,index)=>'<details class="adp-revision" data-process-group="'+key+'-'+type+'-'+index+'"'+(d.expandedGroups[key+'-'+type+'-'+index]?' open':'')+'><summary><strong>第 '+(index+1)+' 组 · '+title+'</strong><span>展开独立参数与来源</span></summary><div class="adp-revision-body"><div class="adp-grid-two">'+fieldsMarkup('zoneProcesses.'+key+'.'+type+'.'+index,fields,group)+'</div></div></details>').join('')+
        '<div class="adp-actions"><button type="button" data-action="add-zone-group" data-group-type="'+type+'">添加本区'+title+'分组</button><span class="adp-muted">每区每项目最多 8 组，未知留空</span></div></section>';
    }
    function techniqueMarkup() {
      const d=current(), zone=ZONES.find(([key])=>key===d.selectedZone);
      return heading(2,'把设计落到六个区域','中性人头示意与区域卡一一对应。原话、AI 演示建议、本人核对和实际记录分别保留。')+
        '<div class="adp-services">'+[['cut','剪发'],['perm','烫发'],['dye','染发']].map(([key,title])=>'<label class="adp-check"><input type="checkbox" data-service="'+key+'"'+(d.services[key]?' checked':'')+'>'+title+'</label>').join('')+'</div><p class="adp-caption">关闭项目只隐藏该项目工艺卡，不删除输入。六区记录保持可见；归档保留项目开关与隐藏字段。</p>'+
        '<div class="adp-zone-workspace">'+mapMarkup()+'<div class="adp-zone-edit"><h3>'+zone[1]+'</h3><p class="adp-muted">'+zone[3]+'。不清楚的操作和参数请留空。</p>'+ZONE_FIELDS.map(([key,title])=>fieldMarkup('zones.'+zone[0]+'.'+key,title,d.zones[zone[0]][key],key==='direction'?'direction':null)).join('')+'</div></div>'+zoneProcessMarkup(zone[0],'perm')+zoneProcessMarkup(zone[0],'dye')+
        '<details class="adp-section adp-global-process" data-global-process="perm" data-perm-section'+(d.services.perm?'':' hidden')+(d.globalOpen.perm?' open':'')+'><summary>烫发整体补充 <span>可选 · 展开填写</span></summary><p class="adp-muted">本区多组杠具与配方在上方分组填写。这里仅记录全局补充，不自动套用各区。本页不会生成配方或软化时间。</p><div class="adp-grid-two">'+fieldsMarkup('perm',PERM,d.perm)+'</div></details>'+
        '<details class="adp-section adp-global-process" data-global-process="dye" data-dye-section'+(d.services.dye?'':' hidden')+(d.globalOpen.dye?' open':'')+'><summary>染发整体补充 <span>可选 · 展开填写</span></summary><p class="adp-muted">染色信息单独记录，不混入烫发工艺；本区配方在上方分组填写。不自动推荐浓度、比例或处理时间。</p><div class="adp-grid-two">'+fieldsMarkup('dye',DYE,d.dye)+'</div></details>';
    }
    function reviewMarkup() {
      const d=current(), comparison=d.comparison, stale=comparison&&(comparison.materialRevision!==d.materialRevision||comparison.designRevision!==d.designRevision);
      const before=d.photos.before.find(p=>p.angle==='front'), after=d.photos.after.find(p=>p.angle==='front');
      return heading(3,'完成后，再回看设计','先补完成素材，再建立模拟对照。相似度、护理效果或工艺达成情况均不由本页自动判断。')+
        (connected?'':'<label class="adp-check"><input type="checkbox" data-consent'+(d.syntheticConsent?' checked':'')+'>仅使用虚构 / 测试素材</label>')+photosSection('after')+
        '<section class="adp-section"><h3>原始 / 完成对照</h3><p class="adp-muted">原始与完成均需正面、背面和一个明确侧面。若左右侧不一致，会提醒补拍，不假装同角度对比。</p>'+
        '<div class="adp-actions"><button type="button" class="adp-primary" data-action="compare">建立模拟对照</button></div>'+
        (comparison?'<div class="adp-comparison"><h4>'+(stale?'素材或记录已更改，请重新建立对照':'模拟对照 · 不是真实 AI 比较')+'</h4><p class="adp-caption">只并排展示素材，未计算相似度、未判断变化或服务完成。下方结论由本人填写。</p>'+
          (before&&after?'<div class="adp-comparison-grid"><figure><img src="'+esc(before.url)+'" alt="原始正面测试素材"><figcaption>原始 · 正面 · '+(before.kind==='demo'?'虚构示意':'本地测试预览')+'</figcaption></figure><figure><img src="'+esc(after.url)+'" alt="完成正面测试素材"><figcaption>完成 · 正面 · '+(after.kind==='demo'?'虚构示意':'本地测试预览')+'</figcaption></figure></div>':'')+
          '<p class="adp-review-state">'+esc(comparison.sideNote)+'</p><p class="adp-review-state">'+allRecords(d).filter(field=>field.value.trim()&&!field.confirmed).length+' 项内容尚未本人核对。拟执行内容不会自动转成实际记录。</p></div>':'')+'</section>'+
        '<section class="adp-section"><h3>第八步 · 完成后打理</h3><p class="adp-muted">完成后才人工记录整理方式或反馈，剪前不分析打理或护理。本页不生成护理效果结论。</p>'+fieldMarkup('care','完成后打理记录',d.care)+'</section>'+
        '<section class="adp-section"><h3>本人复盘</h3><p class="adp-muted">可记录可见变化及尚待核实事项。这里是本人填写的完成观察，仍需逐项核对；未填写的内容保持待确认。</p><div class="adp-grid-two">'+fieldsMarkup('review',REVIEW,d.review)+'</div></section>';
    }
    function readField(title,field,direction,trackOnly) {
      if(!trackOnly&&field.phase!=='context') {
        const tracks=Object.assign({},field.tracks||{},{[field.phase]:trackCopy(field)});
        return ['planned','actual'].filter(phase=>tracks[phase]).map(phase=>readField(title+' · '+(phase==='planned'?'拟执行方案':'实际执行记录'),tracks[phase],direction,true)).join('');
      }
      return '<div class="adp-read-field"><strong>'+esc(title)+'</strong><p>'+esc(field.value?(direction?directionLabel(field.value):field.value):'待确认')+'</p><small>'+esc(provenance(field))+' · '+(field.confirmed?'本人已核对':'待核对')+' · '+(field.phase==='context'?'观察 / 意向记录':field.phase==='actual'?'实际记录':'拟执行')+'</small>'+
        '<p class="adp-caption">原始来源'+(field.edited?'（当前值已修改）':'')+'：'+esc(field.original||'未提供')+'</p></div>';
    }
    function revisionMarkup(revision) {
      const data=revision.data;
      return '<details class="adp-revision" data-revision="'+revision.number+'"><summary><strong>版本 '+String(revision.number).padStart(2,'0')+' · '+(connected?'本机合成归档':'本页模拟记录')+'</strong><span>'+esc(revision.time)+'</span></summary><div class="adp-revision-body">'+
        '<p class="adp-muted">'+esc(data.completion)+'。'+esc(data.photoNotice)+'</p><p class="adp-caption">项目：'+[['cut','剪发'],['perm','烫发'],['dye','染发']].map(([key,title])=>title+' '+(data.services[key]?'开启':'关闭')).join(' · ')+'</p>'+
        '<h4>沟通原话</h4><p class="adp-original">'+esc(data.text||'未提供')+'</p><p class="adp-original">'+esc(data.transcript||'无口述转写')+'</p><h4>人物与提案</h4>'+BASIC.map(([key,title])=>readField(title,data.basic[key])).join('')+readField('发型师提案',data.proposal)+readField('完成后打理记录',data.care)+
        ZONES.map(([key,title])=>'<h4>'+title+'</h4>'+ZONE_FIELDS.map(([field,label])=>readField(label,data.zones[key][field],field==='direction')).join('')+['perm','dye'].map(type=>data.zoneProcesses[key][type].map((group,index)=>'<h4>'+title+' · '+(type==='perm'?'烫发':'染发')+'第 '+(index+1)+' 组</h4>'+(type==='perm'?PERM:DYE).map(([field,label])=>readField(label,group[field])).join('')).join('')).join('')).join('')+
        '<h4>烫发工艺'+(data.services.perm?'':'（项目关闭，输入保留）')+'</h4>'+PERM.map(([key,title])=>readField(title,data.perm[key])).join('')+
        '<h4>染发工艺'+(data.services.dye?'':'（项目关闭，输入保留）')+'</h4>'+DYE.map(([key,title])=>readField(title,data.dye[key])).join('')+
        '<h4>本人复盘</h4>'+REVIEW.map(([key,title])=>readField(title,data.review[key])).join('')+
        '<h4>素材清单（无图片）</h4>'+['before','after'].map(stage=>'<p class="adp-caption">'+(stage==='before'?'原始':'完成')+'：'+Object.entries(data.photoSummary[stage]).map(([angle,count])=>ANGLES[angle]+' '+count+' 张').join(' · ')+'</p>').join('')+
        '<p class="adp-caption">'+esc(data.analysisStatus)+'；'+esc(data.comparisonStatus)+'</p></div></details>';
    }
    function archiveMarkup() {
      const d=current();
      if(connected)return heading(4,'保存到本机，保留每个归档版本','先保存当前合成草稿，再追加不可覆盖的本机归档。不是云端保存，也不会进入真实顾客档案。')+
        '<div class="adp-safety">仅保存合成文字、字段和内置示意图角度标记。没有图片内容、图片地址或录音。归档后为只读，打开新修订才可继续更改。旧归档保留。</div>'+
        '<div class="adp-actions"><button type="button" class="adp-primary" data-action="archive">追加本机合成归档</button><span class="adp-muted">当前模拟顾客已有 '+d.revisions.length+' 版</span></div>'+
        (d.revisions.length?d.revisions.slice().reverse().map(revisionMarkup).join(''):'<div class="adp-empty"><strong>还没有本机归档</strong>先在上方保存，再追加第一版。刷新后可从本机服务重新读取。</div>');
      return heading(4,'让每次修改都有前一版','只追加本页模拟版本。旧版本保持不变，不进入真实顾客档案，也没有云端保存。')+
        '<div class="adp-safety">这些版本只存在当前页面内存里。刷新、关闭页面或离开后会丢失；照片不进入版本。请勿把这里当作正式服务记录。</div>'+
        '<div class="adp-actions"><button type="button" class="adp-primary" data-action="archive">追加模拟版本</button><span class="adp-muted">当前模拟顾客已追加 '+d.revisions.length+' 版</span></div>'+
        (d.revisions.length?d.revisions.slice().reverse().map(revisionMarkup).join(''):'<div class="adp-empty"><strong>还没有模拟版本</strong>填写任意设计内容后，追加第一版。随后修改再追加，原版本仍可展开查看。</div>');
    }
    function render(focusHeading,preserveExpansion=true) {
      if(destroyed) return;
      const d=current();
      if(preserveExpansion&&root.dataset.renderedCustomer===customerId){
        root.querySelectorAll('[data-process-group]').forEach(element=>{d.expandedGroups[element.dataset.processGroup]=element.open;});
        root.querySelectorAll('[data-global-process]').forEach(element=>{d.globalOpen[element.dataset.globalProcess]=element.open;});
      }
      root.dataset.renderedCustomer=customerId;
      root.innerHTML='<div class="adp-shell"><header><div class="adp-topline"><div class="adp-brand"><span class="adp-mark" aria-hidden="true">形</span>设计工作台</div><span class="adp-mode">'+(connected?'本人试用 · 本机合成连接':'本人试用 · 模拟流程')+'</span></div>'+
        '<div class="adp-hero"><div><p class="adp-kicker">DESIGN, WITH A CLEAR RECORD</p><h1>从原话，到有据可查的设计。</h1><p class="adp-subtitle">素材、人物意向、六区工艺与完成复盘，沿着同一条设计线索记录。</p></div><p class="adp-private"><strong>'+(connected?'本机测试 · 显式保存':'离线 · 仅内存')+'</strong>不连接真实顾客 / AI / 云端</p></div></header>'+
        '<div class="adp-safety">'+(connected?'仅本机合成试用：当前身份 demo-ui-owner 是公开的模拟标识，不是真实登录。只编辑预设合成选项，无自由资料输入或真实图片选择。明确保存后写入本机测试目录；未保存更改刷新会丢失。AI 为固定演示，未联网调用模型。':'第一阶段试用：只使用虚构顾客和测试素材。这里的“AI 提取 / 建议”是固定演示，不是模型结果。没有密钥入口，不上传图片，不保存录音；刷新或关页后全部草稿与模拟版本丢失。')+'</div>'+
        '<div class="adp-layout"><aside class="adp-sidebar"><div class="adp-customer-card"><label class="adp-label" for="'+prefix+'customer">当前模拟顾客</label><select id="'+prefix+'customer" data-customer>'+customers.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===customerId?' selected':'')+'>'+esc(c.title)+'</option>').join('')+'</select><p class="adp-customer-detail">'+esc(customer().detail)+'</p></div>'+
        '<nav class="adp-stepper" aria-label="设计流程">'+STEPS.map((label,index)=>'<button type="button" data-step="'+index+'"'+(d.step===index?' aria-current="step"':'')+'><span class="adp-step-number">'+(index+1)+'</span>'+label+'</button>').join('')+'</nav>'+
        '<p class="adp-side-note">'+(connected?'同一模拟身份下，每位顾客独立保存。切换不混用数据，未保存的本页更改仍需主动保存。':'每位模拟顾客各有一份草稿。切换不会混用输入与素材，但刷新会全部清空。')+'</p>'+(typeof options.onClose==='function'?'<div class="adp-actions"><button type="button" data-action="close">关闭试用</button></div>':'')+'</aside>'+
        '<main class="adp-main">'+connectedToolbar()+'<div class="adp-notice" role="status" aria-live="polite">'+esc(d.notice)+'</div><div class="adp-panel">'+[intakeMarkup,analysisMarkup,techniqueMarkup,reviewMarkup,archiveMarkup][d.step]()+
        '<div class="adp-bottom">'+(d.step?'<button type="button" data-step="'+(d.step-1)+'">上一步</button>':'<span>只记录已提供的信息</span>')+(d.step<4?'<button type="button" class="adp-primary" data-step="'+(d.step+1)+'">'+(d.step===3?'查看模拟档案':'下一步')+' →</button>':'<span>追加版本不等于正式归档</span>')+'</div></div></main></div><footer class="adp-footer">本人试用 · 合成数据 · 不替代现场专业判断</footer></div>';
      if(focusHeading) root.querySelector('[data-step-heading]').focus({preventScroll:true});
      if(connected){
        if(!canEdit())root.querySelectorAll('[data-field],[data-confirm],[data-phase],[data-service],[data-photo-side],[data-remove-photo],[data-action="demo-text"],[data-action="demo-photos"],[data-action="analyze"],[data-action="compare"],[data-action="add-zone-group"],[data-action="connected-transcript"],[data-action="connected-clear-transcript"]').forEach(control=>{control.disabled=true;});
        const archiveButton=root.querySelector('[data-action="archive"]');if(archiveButton)archiveButton.disabled=!canEdit()||syncState().dirty;
      }
    }
    function addDemoPhotos(stage) {
      const d=current();
      ['front','back',d.side[stage]].forEach(angle=>{
        const present=d.photos[stage].some(p=>['left','right'].includes(angle)?['left','right'].includes(p.angle):p.angle===angle);
        if (!present) d.photos[stage].push({id:++photoId,angle,kind:'demo',url:sampleImage(stage,angle)});
      });
      changed(d,true);
      signal('已补充虚构人头示意图，只用于走通流程；这不是顾客照片，也不表示完成效果。');
    }
    function addDemoText() {
      const d=current();
      if (d.text.trim() || d.transcript.trim() || allRecords(d).some(field=>field.value.trim())) {
        signal('当前草稿已有输入，固定示例不会覆盖。你可以手工整理，或切换到另一位空白模拟顾客体验示例。');
        return;
      }
      d.text=SAMPLE; d.demoLoaded=true; d.services.perm=true; changed(d,true);
      signal('已载入固定虚构原话。下一步“运行模拟整理”只演示这段原话，不识别照片。');
    }
    function analyze() {
      const d=current();
      if (!d.text.trim()&&!d.transcript.trim()) { signal('先填写模拟沟通原话，或在第一步载入固定虚构示例。'); return; }
      const sampleIsUnchanged=d.demoLoaded&&d.text===SAMPLE&&(!d.transcript.trim()||(connected&&d.transcript===adapter.transcriptText));
      function put(field,value,quote,origin) {
        if (field.value.trim() || field.original || field.confirmed || field.phase==='actual') return;
        Object.assign(field,{value,original:quote,origin:origin||'demo_extract',confirmed:false,edited:false});
      }
      if(sampleIsUnchanged) {
        const quote='模拟顾客希望保留长度，整体简洁，脸周柔和。';
        put(d.basic.style,'简洁；脸周柔和',quote);
        put(d.basic.length,'保留长度',quote);
        put(d.proposal,'先与模拟顾客确认“简洁、脸周柔和”的具体含义，再按六区逐项确认方案。未提供的技术参数保持空白。',quote,'demo_suggest');
        put(d.zones.bangs.direction,'backward','刘海区向后，顶区向上，耳前区向后。');
        put(d.zones.top.direction,'up','刘海区向后，顶区向上，耳前区向后。');
        put(d.zones.ear_front.direction,'backward','刘海区向后，顶区向上，耳前区向后。');
      }
      d.analysis={materialRevision:d.materialRevision,sample:sampleIsUnchanged};
      changed(d,false);
      signal(sampleIsUnchanged?'固定示例整理完成：仅填原话明确支持的风格、长度与流向，并单独标注一条演示建议。已有修改和核对内容不会被覆盖。':'已记录本次模拟整理。当前没有连接 AI，自由文本和照片未被自动分析；请在下面手工填写，未知项保留待确认。');
    }
    function compare() {
      const d=current();
      if (!photoCoverage(d.photos.before)||!photoCoverage(d.photos.after)) {
        signal('请先补齐原始与完成两组：各有正面、背面、至少一个明确的左侧或右侧。可使用虚构示意图试走流程。'); return;
      }
      const match=['left','right'].some(angle=>d.photos.before.some(p=>p.angle===angle)&&d.photos.after.some(p=>p.angle===angle));
      d.comparison={materialRevision:d.materialRevision,designRevision:d.designRevision,sideNote:match?'侧面标签有匹配；拍摄距离、角度和光线仍需本人核对。':'侧面标签不一致：一组为左侧，另一组为右侧。请补齐同侧素材，当前不能做同角度侧面对照。'};
      if(connected)persistence.get(d.id).dirty=true;
      signal('已建立本页模拟对照。只并排展示素材，不生成真实效果结论，也不自动确认任何操作。');
    }
    function archive() {
      if(connected){connectedWrite('archive');return;}
      const d=current();
      if (!d.text.trim()&&!d.transcript.trim()&&!allRecords(d).some(field=>field.value.trim())) { signal('先记录模拟沟通或设计内容，再追加版本。空白草稿不会生成档案。'); return; }
      const data=snapshot(d), signature=JSON.stringify(data), last=d.revisions[d.revisions.length-1];
      if(last&&last.signature===signature) { signal('当前内容与上一模拟版本相同，没有重复追加。'); return; }
      d.revisions.push(freezeDeep({number:d.revisions.length+1,time:new Date().toLocaleString('zh-CN'),signature,data}));
      signal('已在本页内存追加模拟版本 '+d.revisions.length+'。旧版本不变；没有上传或云端保存，刷新后这些版本会丢失。');
    }
    function revoke(url) { if(objectURLs.has(url)){global.URL.revokeObjectURL(url);objectURLs.delete(url);} }
    function cancelPending() {
      pending.forEach(job=>{job.cancelled=true; job.image.onload=null; job.image.onerror=null; job.image.src=''; revoke(job.url); job.resolve(false);});
      pending.clear();
    }
    async function addFiles(input) {
      if(connected)return;
      const d=current(), capture=session, stage=input.dataset.fileStage, slot=input.dataset.fileAngle;
      if(!d.syntheticConsent || !['before','after'].includes(stage)) return;
      const angle=slot==='side'?d.side[stage]:slot;
      const files=Array.from(input.files||[]); input.value='';
      let added=0; const errors=[];
      for(const file of files) {
        if(destroyed||capture!==session||d!==current()) break;
        const count=d.photos[stage].filter(p=>slot==='side'?['left','right'].includes(p.angle):p.angle===slot).length;
        if(count>=MAX_PHOTOS){ errors.push('该位置最多 4 张'); break; }
        if(!TYPES.includes(file.type)){errors.push('只接受 JPEG、PNG 或 WebP');continue;}
        if(file.size>MAX_BYTES||file.size===0){errors.push('图片需大于 0 且不超过 8 MB');continue;}
        const url=global.URL.createObjectURL(file); objectURLs.add(url);
        const ok=await new Promise(resolve=>{
          const image=new global.Image();
          const job={image,url,resolve,cancelled:false}; pending.add(job);
          image.onload=()=>{pending.delete(job);resolve(!job.cancelled&&image.naturalWidth>0&&image.naturalHeight>0&&image.naturalWidth*image.naturalHeight<=40000000);};
          image.onerror=()=>{pending.delete(job);resolve(false);}; image.src=url;
        });
        if(destroyed||capture!==session||d!==current()){revoke(url);break;}
        if(!ok){revoke(url);errors.push('图片无法解码或超过 4000 万像素');continue;}
        const finalCount=d.photos[stage].filter(p=>slot==='side'?['left','right'].includes(p.angle):p.angle===slot).length;
        if(finalCount>=MAX_PHOTOS){revoke(url);errors.push('该位置最多 4 张');continue;}
        d.photos[stage].push({id:++photoId,angle,kind:'local',url});added++;changed(d,true);
      }
      if(destroyed||capture!==session||d!==current()) return;
      signal((added?'已添加 '+added+' 张本地测试预览，未上传。':'未添加图片。')+(errors.length?' '+Array.from(new Set(errors)).join('；')+'。':''));
    }
    function handleInput(event) {
      const element=event.target, d=current();
      if(connected&&!canEdit())return;
      if(element.matches('[data-text]')) {
        d[element.dataset.text]=element.value.slice(0,6000); changed(d,true);
      } else if(element.matches('[data-field]')) {
        const field=getRecord(element.dataset.field); if(!field) return;
        const value=element.value.slice(0,1600);
        if(connected&&!(element.dataset.field.startsWith('zones.')&&element.dataset.field.endsWith('.direction')?DIRECTIONS.map(([key])=>key):adapter.valuesFor(element.dataset.field)).includes(value))return;
        if(field.value!==value) {
          field.value=value;field.confirmed=false;
          if(field.original) field.edited=true;
          changed(d,false);
          const check=element.closest('.adp-field').querySelector('[data-confirm]');
          check.checked=false;check.disabled=!value.trim();
        }
      }
    }
    function handleChange(event) {
      const element=event.target, d=current();
      if(connected&&!element.matches('[data-customer]')&&!canEdit())return;
      if(element.matches('[data-customer]')) {
        if(!drafts.has(element.value)) return;
        session++;cancelPending();customerId=element.value;render(true);
        if(connected&&!syncState().loaded)connectedLoad(false);
      } else if(element.matches('[data-consent]')) {
        d.syntheticConsent=element.checked;if(!d.syntheticConsent){session++;cancelPending();}render();
      } else if(element.matches('[data-file-stage]')) {
        addFiles(element);
      } else if(element.matches('[data-photo-side]')) {
        d.side[element.dataset.photoSide]=element.value;
        if(connected){changed(d,false);render();}
      } else if(element.matches('[data-service]')) {
        d.services[element.dataset.service]=element.checked;changed(d,false);render();
      } else if(element.matches('[data-field]')) {
        const field=getRecord(element.dataset.field);if(!field) return;
        handleInput(event);
        if(field.value.trim()&&!field.original) field.original=element.dataset.field.endsWith('.direction')&&element.dataset.field.startsWith('zones.')?directionLabel(field.value):field.value;
        if(element.tagName==='SELECT') {render();return;}
        const block=element.closest('.adp-field');
        block.querySelector('.adp-source[data-origin]').textContent=provenance(field);
        block.querySelector('.adp-original').textContent=field.original||'尚无来源；手工输入首次完成后保留原文。';
        block.querySelector('summary').textContent='原始来源'+(field.edited?'（当前值已修改）':'');
        block.querySelector('details .adp-caption').textContent=(field.origin==='manual'?'保留首次输入，不随修改覆盖。':'来自固定虚构示例，不是对当前照片或自由文本的识别。')+(field.edited?' 原文用于追溯，不代表修改后的内容已经有证据。':'');
      } else if(element.matches('[data-confirm]')) {
        const field=getRecord(element.dataset.confirm);if(!field) return;
        field.confirmed=Boolean(element.checked&&field.value.trim());changed(d,false);render();
      } else if(element.matches('[data-phase]')) {
        const field=getRecord(element.dataset.phase);if(!field) return;
        const phase=element.value==='actual'?'actual':'planned';
        if(field.phase!==phase){
          field.tracks[field.phase]=trackCopy(field);
          const next=field.tracks[phase]||trackCopy(record(phase));
          Object.assign(field,next,{phase});changed(d,false);
        }
        render();
      }
    }
    function handleClick(event) {
      const button=event.target.closest('[data-action],[data-step],[data-zone],[data-map-zone],[data-remove-photo]');
      if(!button||!root.contains(button)) return;
      const d=current();
      if(button.dataset.step!==undefined) {
        d.step=Math.max(0,Math.min(4,Number(button.dataset.step)));if(connected&&canEdit())syncState().dirty=true;d.notice='';render(true);return;
      }
      const zone=button.dataset.zone||button.dataset.mapZone;
      if(zone&&ZONES.some(([key])=>key===zone)){d.selectedZone=zone;if(connected&&canEdit())syncState().dirty=true;render();return;}
      const action=button.dataset.action;
      if(connected&&action==='connected-load'){connectedLoad(true);return;}
      if(connected&&action==='connected-save'){connectedWrite('save');return;}
      if(connected&&action==='connected-retry'){connectedWrite(null,true);return;}
      if(connected&&action==='connected-reopen'){connectedWrite('reopen');return;}
      if(connected&&action==='connected-cancel-reload'){syncState().discardConfirm=false;render();return;}
      if(connected&&action==='close'&&typeof options.onClose==='function'){options.onClose();return;}
      if(connected&&!canEdit())return;
      if(button.dataset.removePhoto) {
        const stage=button.dataset.photoStage, id=Number(button.dataset.removePhoto);
        d.photos[stage]=d.photos[stage].filter(photo=>{if(photo.id!==id)return true;revoke(photo.url);return false;});
        changed(d,true);render();return;
      }
      if(connected&&action==='connected-transcript'){d.transcript=adapter.transcriptText;changed(d,true);render();return;}
      if(connected&&action==='connected-clear-transcript'){d.transcript='';changed(d,true);render();return;}
      if(action==='add-zone-group') {
        const type=button.dataset.groupType;if(!['perm','dye'].includes(type))return;
        const groups=d.zoneProcesses[d.selectedZone][type];
        if(groups.length>=8){signal('每区每个项目最多 8 组。请在已有组中补充明确内容。');return;}
        Object.keys(d.expandedGroups).filter(key=>key.startsWith(d.selectedZone+'-')).forEach(key=>{d.expandedGroups[key]=false;});
        d.expandedGroups[d.selectedZone+'-'+type+'-'+groups.length]=true;
        groups.push(records(type==='perm'?PERM:DYE));changed(d,false);render(false,false);
      }
      if(action==='demo-photos')addDemoPhotos(button.dataset.stage);
      if(action==='demo-text')addDemoText();
      if(action==='analyze')analyze();
      if(action==='compare')compare();
      if(action==='archive')archive();
      if(action==='close'&&typeof options.onClose==='function')options.onClose();
    }
    root.addEventListener('input',handleInput);
    root.addEventListener('change',handleChange);
    root.addEventListener('click',handleClick);
    function handleToggle(event) {
      if(!root.contains(event.target)||root.dataset.renderedCustomer!==customerId)return;
      if(event.target.dataset.processGroup)current().expandedGroups[event.target.dataset.processGroup]=event.target.open;
      if(event.target.dataset.globalProcess)current().globalOpen[event.target.dataset.globalProcess]=event.target.open;
    }
    root.addEventListener('toggle',handleToggle,true);
    render();
    if(connected)connectedLoad(false);
    function destroy() {
      if(destroyed)return;
      destroyed=true;session++;cancelPending();objectURLs.forEach(url=>global.URL.revokeObjectURL(url));objectURLs.clear();drafts.clear();
      root.removeEventListener('input',handleInput);root.removeEventListener('change',handleChange);root.removeEventListener('click',handleClick);root.remove();
      root.removeEventListener('toggle',handleToggle,true);
      if(container.hasAttribute('data-ai-design-pilot'))delete container.dataset.mounted;
      global.removeEventListener('pagehide',destroy);
    }
    global.addEventListener('pagehide',destroy);
    return Object.freeze({destroy});
  }
  function open() {
    // Deliberately opens a separate page to leave the App's active forms untouched.
    const url=new URL('ai-design-pilot.html',document.baseURI);
    return global.open(url.href,'_blank','noopener,noreferrer');
  }
  global.AIDesignPilot=Object.freeze({mount,open});
  function boot() { const container=document.querySelector('[data-ai-design-pilot]');if(container&&!container.dataset.mounted){container.dataset.mounted='true';mount(container);} }
  global.addEventListener('pageshow',boot);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
