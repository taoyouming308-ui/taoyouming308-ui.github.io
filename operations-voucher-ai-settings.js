/* Current-store recognition settings. Keys never enter browser storage. */
(function(root){
 'use strict';
 function identity(){return JSON.stringify([currentStore(),root.ZysyrPettyScopeIdentity?root.ZysyrPettyScopeIdentity():state.session]);}
 root.ZysyrVoucherAISettings={open:async function(){
  var key=identity(),backdrop=document.getElementById('trace-backdrop'),host=document.getElementById('trace-content');
  if(!host||!backdrop)return;
  backdrop.classList.remove('hidden');backdrop.setAttribute('aria-hidden','false');host.innerHTML='<p class="help">正在读取当前门店的识别设置…</p>';
  try{
   var data=await api('voucher_ai_settings_read',{store:currentStore()});if(key!==identity())return;
   host.innerHTML='<section class="trace-card"><h4>凭证识别 API 设置</h4><p class="help">只影响当前门店的新识别。支持 OpenAI、OpenRouter、硅基流动、DeepSeek、Groq、通义和火山方舟的公开 API 地址。兼容服务需支持图片和结构化输出。密钥加密保存在后台，页面不会回显。</p><label>API 地址<input id="voucher-ai-url" type="url" autocomplete="off" value="'+esc(data.base_url)+'" style="width:100%"></label><label>接口协议<select id="voucher-ai-protocol" style="width:100%"><option value="responses" '+(data.protocol==='responses'?'selected':'')+'>Responses（OpenAI 推荐）</option><option value="chat_completions" '+(data.protocol==='chat_completions'?'selected':'')+'>Chat Completions（兼容 API）</option></select></label><label>模型 ID<input id="voucher-ai-model" autocomplete="off" maxlength="100" value="'+esc(data.model)+'" style="width:100%"></label><label>API 密钥<input id="voucher-ai-key" type="password" autocomplete="new-password" maxlength="500" placeholder="'+(data.key_configured?'已配置；留空沿用，填写新值可更换':'填写对应服务商的 API 密钥')+'" style="width:100%"></label><p class="help">切换服务商时请填写该服务商的密钥。测试使用合成图片，会产生少量 API 用量；保存后凭证图片将发送到所填服务。原图、原识别记录和人工确认保持原样。</p><button id="voucher-ai-save" type="button" class="primary">测试连接并保存</button><p id="voucher-ai-settings-status" class="help" role="status">'+(data.key_configured?'当前密钥已配置':'当前尚未配置密钥')+'</p></section>';
   var save=document.getElementById('voucher-ai-save');save.onclick=async function(){
    if(key!==identity())return;var result=document.getElementById('voucher-ai-settings-status'),input=document.getElementById('voucher-ai-key');
    var payload={store:currentStore(),base_url:document.getElementById('voucher-ai-url').value.trim(),protocol:document.getElementById('voucher-ai-protocol').value,model:document.getElementById('voucher-ai-model').value.trim(),api_key:input.value.trim(),revision:data.revision};
    save.disabled=true;result.textContent='正在测试图片识别与返回格式，通过后保存…';
    var pending=api('voucher_ai_settings_save',payload);input.value='';
    try{var saved=await pending;if(key!==identity())return;data.revision=saved.revision;data.key_configured=saved.key_configured;result.textContent='连接测试通过，已保存模型 '+saved.model+'。下次识别使用此设置。';}
    catch(error){if(key===identity())result.textContent='设置未确认：'+error.message+'。请重新读取核验，不要重复提交。';}
    finally{payload.api_key='';if(key===identity())save.disabled=false;}
   };
  }catch(error){if(key===identity())host.innerHTML='<p class="help">读取设置失败：'+esc(error.message)+'</p>';}
 }};
})(window);
