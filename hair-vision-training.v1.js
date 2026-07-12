(function(global) {
  'use strict';

  var CHECKPOINTS = [
    { id: 'human_analysis', name: '人物分析', question: '先看人：画面呈现出什么气质与比例关系？依据在哪里？' },
    { id: 'style', name: '风格美学', question: '先不说名称：哪些轮廓、重量、线条与纹理组成了这种风格？' },
    { id: 'hair_anatomy', name: '发型解剖', question: '拆开看：外轮廓、内轮廓、长度、重量与层次怎样共同工作？' },
    { id: 'suitability', name: '适配分析', question: '换一个人物条件，哪些保留、调整或放弃？为什么？' },
    { id: 'client_communication', name: '客户沟通', question: '客户坐在面前时，怎样解释差异并给出替代方案？' }
  ];

  var STYLE_CONTRASTS = [
    { id: 'french_japanese', label: '法式 × 日系', styles: ['french', 'japanese'], question: '同样轻盈，松弛留白与束感细节的分界在哪里？' },
    { id: 'korean_sweet', label: '韩系 × 少女', styles: ['korean', 'sweet'], question: '同样柔和，精致完整与圆润轻快的分界在哪里？' },
    { id: 'urban_minimal', label: '都市 × 极简', styles: ['urban', 'minimal'], question: '同样克制，职业完成度与减少装饰的分界在哪里？' },
    { id: 'natural_french', label: '自然 × 法式', styles: ['natural', 'french'], question: '同样自然，均衡真实与刻意保留松弛感的分界在哪里？' },
    { id: 'urban_androgynous', label: '都市 × 中性', styles: ['urban', 'androgynous'], question: '同样利落，稳定知性与直线力量感的分界在哪里？' },
    { id: 'japanese_avant_garde', label: '日系 × 先锋', styles: ['japanese', 'avant_garde'], question: '同样有细节，灵动变化与有目的冲突的分界在哪里？' }
  ];

  var HUMAN_LENSES = [
    '只观察五官线条与发型线条的呼应，不推断性格。',
    '只观察面部立体度、头脸比例与发型体积关系。',
    '只观察额头、下颌、颈部与肩宽形成的纵横比例。',
    '区分画面呈现的气质与人物真实职业、性格等未知信息。',
    '比较发型遮盖与露出的区域如何改变人物视觉重心。'
  ];

  var ANATOMY_LENSES = [
    '外轮廓 × 重量位置',
    '内轮廓 × 层次连接',
    '刘海脸周 × 留白比例',
    '发尾状态 × 线条纹理',
    '色彩光泽 × 视觉完成度',
    '工具痕迹 × 无法确认边界'
  ];

  var ADAPTATION_SCENARIOS = [
    '顾客发量偏少、头顶容易贴，每天打理不超过5分钟。',
    '顾客颈部较短，希望保留长度但不显沉重。',
    '顾客发质粗硬、自然蓬松，不接受每天使用电卷棒。',
    '顾客脸周敏感，不接受明显露耳或大幅剪短。',
    '顾客工作场景要求利落，但本人喜欢图片中的松弛感。',
    '顾客只愿意剪发，不接受烫染，却想保留图片的氛围。'
  ];

  var CLIENT_SCENARIOS = [
    '我就想完全照着图片剪，为什么不可以？',
    '别人剪出来很好看，为什么你说我需要调整？',
    '我不会打理，做完以后还能有这个效果吗？',
    '你说不建议，那有没有保留这种感觉的方案？',
    '为什么要改脸周和重量？我看图片不是一样的吗？',
    '我不想听专业术语，你直接告诉我会有什么区别。'
  ];

  function hash(text) {
    var value = 0;
    text = String(text || '');
    for (var index = 0; index < text.length; index += 1) value = ((value << 5) - value + text.charCodeAt(index)) | 0;
    return Math.abs(value);
  }

  function pick(list, seed, exposure, step) {
    return list[(seed + exposure * step) % list.length];
  }

  function buildPlan(input) {
    input = input || {};
    var exposure = Math.max(0, Number(input.exposureCount) || 0);
    var seed = hash(String(input.identity || '') + '|' + String(input.caseKey || ''));
    var deepFocus = CHECKPOINTS[(seed + exposure) % CHECKPOINTS.length];
    var styleContrast = pick(STYLE_CONTRASTS, seed, exposure, 5);
    var humanLens = pick(HUMAN_LENSES, seed + 1, exposure, 3);
    var anatomyLens = pick(ANATOMY_LENSES, seed + 2, exposure, 5);
    var adaptationScenario = pick(ADAPTATION_SCENARIOS, seed + 3, exposure, 5);
    var clientScenario = pick(CLIENT_SCENARIOS, seed + 4, exposure, 5);
    var lessonSignature = 'lesson-' + hash([deepFocus.id, humanLens, styleContrast.id, anatomyLens, adaptationScenario, clientScenario].join('|'));
    return {
      version: 'hair-vision-v1',
      variantId: 'hv-' + (seed % 100000) + '-' + exposure,
      lessonSignature: lessonSignature,
      exposureCount: exposure,
      repeatNumber: exposure + 1,
      checkpoints: CHECKPOINTS.map(function(item) { return item.id; }),
      deepFocus: deepFocus.id,
      deepFocusLabel: deepFocus.name,
      humanLens: humanLens,
      styleContrast: styleContrast,
      anatomyLens: anatomyLens,
      adaptationScenario: adaptationScenario,
      clientScenario: clientScenario
    };
  }

  function openingQuestion(plan) {
    var repeat = plan && Number(plan.repeatNumber) > 1
      ? '这是同款发型的第' + Number(plan.repeatNumber) + '次训练，这次换一个观察入口。'
      : '今天先从人物开始，不急着给发型命名。';
    return repeat + ' ' + (plan && plan.humanLens ? plan.humanLens : HUMAN_LENSES[0]) + ' 你先说一个判断，并指出画面依据。';
  }

  function timeState(startedAt, now) {
    var start = new Date(startedAt || 0).getTime();
    var current = now == null ? Date.now() : new Date(now).getTime();
    var elapsedMs = Math.max(0, current - start);
    var phase = elapsedMs < 270000 ? 'active' : elapsedMs < 300000 ? 'closing' : elapsedMs < 900000 ? 'extended' : 'overtime';
    return {
      elapsedMs: elapsedMs,
      elapsedSeconds: Math.floor(elapsedMs / 1000),
      phase: phase,
      remainingMs: Math.max(0, 300000 - elapsedMs),
      overtimeMs: Math.max(0, elapsedMs - 300000)
    };
  }

  function timeStateFromElapsed(elapsed) {
    var elapsedMs = Math.max(0, Number(elapsed) || 0);
    var phase = elapsedMs < 270000 ? 'active' : elapsedMs < 300000 ? 'closing' : elapsedMs < 900000 ? 'extended' : 'overtime';
    return {
      elapsedMs: elapsedMs,
      elapsedSeconds: Math.floor(elapsedMs / 1000),
      phase: phase,
      remainingMs: Math.max(0, 300000 - elapsedMs),
      overtimeMs: Math.max(0, elapsedMs - 300000)
    };
  }

  global.HAIR_VISION_TRAINING_V1 = {
    version: '1.1.0',
    targetMs: 300000,
    closingMs: 270000,
    hardStopMs: 900000,
    checkpoints: CHECKPOINTS,
    buildPlan: buildPlan,
    openingQuestion: openingQuestion,
    timeState: timeState,
    timeStateFromElapsed: timeStateFromElapsed
  };
})(typeof window !== 'undefined' ? window : this);
