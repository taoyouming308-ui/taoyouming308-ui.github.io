(function(global) {
  'use strict';

  global.AESTHETIC_KNOWLEDGE_V1 = {
    schemaVersion: 1,
    version: '1.3.0',
    title: 'Hair Aesthetic System',
    publishedAt: '2026-07-12',
    status: 'published',
    owner: '自由手艺人',
    notice: '本知识库用于审美训练与设计复盘，不替代现场发质检测、顾客沟通和专业技术判断。',
    product: {
      mission: '帮助发型师沿着视觉识别、结构拆解、风格归纳、技术转化与人物适配，建立可迁移的设计能力。',
      positioning: 'AI 发型师设计思维训练系统',
      belief: '产品核心不是 AI，而是训练体系。用户看到自然对话，AI 内部维护训练目标、能力诊断和渐进提示，不替发型师思考。',
      promise: '不是教发型师复制作品，而是训练他们创造作品。',
      tagline: '让模仿变成理解，让理解变成创造。'
    },
    hairVision: {
      version: '1.0.0',
      positioning: 'AI 不是分析工具，而是五分钟设计陪练。',
      systems: [
        { id: 'human_analysis', name: '人物分析', goal: '先看人物与发型的视觉关系，再设计发型。', boundaries: ['画面气质只能描述为视觉呈现', '职业、年龄、性格、生活方式和偏好必须询问或作为模拟条件'] },
        { id: 'style_aesthetics', name: '风格美学', goal: '不背风格名称，理解轮廓、重量、层次、线条、纹理与色彩组成的风格 DNA。' },
        { id: 'hair_anatomy', name: '发型解剖', goal: '用统一结构拆解任何发型，解释每个设计变量为何存在。' },
        { id: 'communication', name: '客户沟通', goal: '把专业判断转化为需求确认、差异解释、替代方案与维护预期。' }
      ],
      sessionRule: {
        targetMinutes: 5,
        checkpoints: ['human_analysis', 'style', 'hair_anatomy', 'suitability', 'client_communication'],
        rule: '每次自然经过五个检查点，只选择一个深练；同一案例按完成次数轮换深练重点与情境。'
      },
      visualExpressions: [
        { id: 'gentle', name: '温柔', signals: ['柔和曲线', '低对比', '边缘不过度锐利'], guardrail: '只描述画面呈现，不推断真实性格。' },
        { id: 'capable', name: '干练', signals: ['清晰边界', '稳定重心', '较高秩序感'], guardrail: '不能由画面推断职业。' },
        { id: 'youthful', name: '少年感', signals: ['自然纹理', '适度留白', '稳定或偏低重量', '不过度精修'], guardrail: '任何单一元素都不能独立推出少年感。' },
        { id: 'mature', name: '成熟感', signals: ['稳定比例', '完整轮廓', '较低随机度'], guardrail: '视觉成熟感不等于真实年龄。' },
        { id: 'cool', name: '清冷', signals: ['低装饰', '清晰线条', '克制色彩与距离感'], guardrail: '视觉距离感不等于性格冷淡。' },
        { id: 'cute', name: '可爱', signals: ['圆润曲线', '小量感', '轻快节奏'], guardrail: '避免把脸型或年龄当作唯一依据。' },
        { id: 'neutral', name: '中性', signals: ['直线与几何', '减少装饰', '力量感'], guardrail: '不把视觉风格等同于性别身份。' },
        { id: 'elegant', name: '优雅', signals: ['连续线条', '比例协调', '节奏克制'], guardrail: '不以价格、身份或职业定义优雅。' }
      ],
      anatomy: [
        { id: 'outer_outline', name: '外轮廓', certainty: 'visible' },
        { id: 'inner_outline', name: '内轮廓', certainty: 'visible_or_partial' },
        { id: 'length', name: '长度', certainty: 'visible' },
        { id: 'weight', name: '重量', certainty: 'visible' },
        { id: 'layers', name: '层次', certainty: 'visible_or_partial' },
        { id: 'bangs', name: '刘海与脸周', certainty: 'visible' },
        { id: 'ends', name: '发尾', certainty: 'visible' },
        { id: 'debulking', name: '去量', certainty: 'inference_only' },
        { id: 'texture', name: '纹理', certainty: 'visible' },
        { id: 'color', name: '色彩与光泽', certainty: 'visible' },
        { id: 'tool_marks', name: '工具痕迹', certainty: 'inference_only' },
        { id: 'blow_dry', name: '吹风与造型方式', certainty: 'inference_only' }
      ],
      styleDNA: [
        { id: 'natural', name: '自然风', coreFeeling: ['真实', '舒适', '低造作'], outline: '均衡、不过度修饰', weight: '自然稳定', layers: '服务真实发流', line: '不过度统一', texture: '保留原生质感', neighborDifference: '比法式更均衡，比日系更少细节', transformation: '增加留白与不规则流动会更接近法式', counterSignal: '高度统一的光泽和规则卷度' },
        { id: 'french', name: '法式风', coreFeeling: ['松弛', '流动', '留白'], outline: '柔和且不完全对称', weight: '有轻重对比', layers: '自然连接并制造流动', line: '曲线与留白并存', texture: '随意但有秩序', neighborDifference: '比日系更松弛，比自然风更强调留白', transformation: '提高统一光泽与轮廓完整度会向韩系移动', counterSignal: '每一束方向和卷度完全一致' },
        { id: 'korean', name: '韩系风', coreFeeling: ['精致', '柔和', '完整'], outline: '饱满且连续', weight: '稳定并服务脸周包裹', layers: '连接顺滑', line: '规则柔曲线', texture: '统一光泽、低随机度', neighborDifference: '比少女风更精致完整，比法式更统一', transformation: '降低统一度并增加留白会向法式移动', counterSignal: '大量随机碎感和强烈方向冲突' },
        { id: 'japanese', name: '日系风', coreFeeling: ['轻盈', '细节', '灵动'], outline: '轻巧并允许局部变化', weight: '支撑结构后局部变轻', layers: '细节丰富、变化明确', line: '多方向细线条', texture: '束感、碎感与空气感', neighborDifference: '比法式细节密度更高，比先锋更少目的性冲突', transformation: '放大不对称和冲突会向先锋移动', counterSignal: '厚重连续且几乎没有局部细节' },
        { id: 'urban', name: '都市风', coreFeeling: ['知性', '利落', '稳定'], outline: '清晰、可复现', weight: '中低且稳定', layers: '克制并服务场景', line: '整洁利落', texture: '完成度高、随机度低', neighborDifference: '比极简更强调职业完成度，比中性更柔和', transformation: '减少装饰并提高边界纯度会向极简移动', counterSignal: '维护成本极高且结构过度实验' },
        { id: 'minimal', name: '极简风', coreFeeling: ['克制', '纯净', '安静'], outline: '依赖精确比例和边界', weight: '集中而清楚', layers: '少层次或隐性层次', line: '少而准确', texture: '低纹理、低装饰', neighborDifference: '比都市更少场景装饰，比中性更安静', transformation: '增加职业完成度和柔和修饰会向都市移动', counterSignal: '大量装饰、碎感和色彩冲突' },
        { id: 'sweet', name: '少女风', coreFeeling: ['轻快', '亲和', '圆润'], outline: '小量感与柔和曲线', weight: '轻而不过度下坠', layers: '轻盈、节奏明快', line: '圆润小弧线', texture: '柔软、有弹性', neighborDifference: '比韩系更轻快圆润，比自然风更具装饰性', transformation: '提高光泽、完整度和脸周包裹会向韩系移动', counterSignal: '强直线、重边界和高攻击性对比' },
        { id: 'androgynous', name: '中性风', coreFeeling: ['利落', '冷静', '力量'], outline: '几何、清楚', weight: '集中并产生力量感', layers: '克制、结构优先', line: '直线占主导', texture: '少卷度、低装饰', neighborDifference: '比都市更去装饰，比极简更强调力量', transformation: '柔化直线并增加职业完成度会向都市移动', counterSignal: '大量圆润小弧和甜美装饰' },
        { id: 'avant_garde', name: '先锋风', coreFeeling: ['实验', '冲突', '表达'], outline: '非常规、不对称或故意失衡', weight: '用于制造冲突与焦点', layers: '可断裂或非连续', line: '强方向与强对比', texture: '服务明确表达目的', neighborDifference: '比日系更强调冲突目的，比中性更非常规', transformation: '降低冲突并保留细节会向日系移动', counterSignal: '没有表达目的的随机凌乱' }
      ]
    },
    capabilities: [
      {
        id: 'observation',
        name: '视觉识别',
        verb: '看事实',
        goal: '先识别可见事实，不先猜风格和技术。',
        outcome: '把“觉得好看”变成“知道哪里好看”。',
        checkpoints: ['风格线索', '整体轮廓', '长度比例', '层次结构', '重量分布', '刘海', '脸周', '线条', '纹理', '发色与光泽', '整体氛围']
      },
      {
        id: 'analysis',
        name: '结构拆解',
        verb: '拆关系',
        goal: '理解轮廓、层次、重量、长度和脸周之间的结构关系。',
        outcome: '理解设计逻辑，而不是只会模仿。',
        checkpoints: ['轮廓目的', '层次作用', '重量安排', '长度原因', '脸型修饰', '风格形成', '整体协调']
      },
      {
        id: 'judgment',
        name: '风格归纳',
        verb: '找证据',
        goal: '根据九项视觉语言归纳 DSS 主风格与副风格。',
        outcome: '不靠感觉贴标签，而是用证据解释风格。',
        checkpoints: ['轮廓', '线条', '重量', '层次', '纹理', '卷度', '发色', '气质', '支持证据与反证']
      },
      {
        id: 'design',
        name: '技术转化',
        verb: '能落地',
        goal: '把视觉结果转成可验证的施工假设和技术方案。',
        outcome: '从模仿走向原创设计。',
        checkpoints: ['剪裁结构', '层次建立', '重量安排', '比例优化', '细节调整', '技术路径', '个人表达']
      },
      {
        id: 'aesthetic',
        name: '人物适配',
        verb: '会调整',
        goal: '根据人物条件、目标、场景和维护能力保留、调整或放弃设计元素。',
        outcome: '不复制图片，而是把设计转化为适合真实顾客的方案。',
        checkpoints: ['目标风格', '头脸比例', '发质发量', '维护能力', '场景限制', '保留项', '调整项', '风险边界']
      }
    ],
    trainingFlow: [
      {
        id: 'observe',
        capabilityId: 'observation',
        name: '视觉识别',
        english: 'Visual scan',
        question: '先不判断风格：你直接看到了哪些事实？',
        rule: '按长度、外轮廓、线条方向、重量位置、层次、纹理、卷度和色彩描述画面；不写“高级、显瘦、适合”，也不猜技术。',
        coachAction: '区分可见事实、主观感受和技术推测，优先提醒最关键的观察遗漏。'
      },
      {
        id: 'analyze',
        capabilityId: 'analysis',
        name: '结构拆解',
        english: 'Structure',
        question: '这些元素怎样组织成现在的轮廓和重心？',
        rule: '分析顶部、侧区、后区和脸周的轻重、连接、支撑与动静关系。',
        coachAction: '检查是否真正说明结构关系，而不是重复第一步的表面描述。'
      },
      {
        id: 'judge',
        capabilityId: 'judgment',
        name: '风格归纳',
        english: 'Style',
        question: '根据前两步证据，它更接近哪一种主风格和副风格？',
        rule: '只从自然、法式、韩系、日系、都市、极简、少女、中性、先锋九型中选择；至少给出3项支持证据和1项反证。',
        coachAction: '检查风格是否由视觉证据推出，避免只凭国家、发色、模特气质或流行印象贴标签。'
      },
      {
        id: 'design',
        capabilityId: 'design',
        name: '技术转化',
        english: 'Technique',
        question: '如果要还原关键视觉结果，你会怎样设计技术路径？',
        rule: '先写必须保留的视觉结果，再写轮廓、层次、重量、脸周、纹理和造型假设；明确哪些信息当前无法确认。',
        coachAction: '检查技术是否服务视觉目标，并阻止把单张成品图推测写成确定事实。'
      },
      {
        id: 'review',
        capabilityId: 'aesthetic',
        name: '人物适配',
        english: 'Adapt',
        question: '换成真实顾客时，哪些要保留、调整或放弃？',
        rule: '结合目标风格、头脸比例、发量发质、工作场景和维护时间，说明保留项、调整项、风险与替代方案。',
        coachAction: '检查方案是否真正考虑人物与现实限制，而不是照搬图片或使用年龄、职业刻板印象。'
      }
    ],
    guidedConversation: {
      mode: 'hidden-goal-chat',
      principle: '不要完成一次图片分析，而要完成一次设计师成长。',
      visibleRule: '一次只聊一个关键问题，像设计总监带教，不显示固定五步和阶段分数。',
      goals: [
        { id: 'outline', name: '轮廓观察', group: 'observation', beginner: '识别边界与最宽点', intermediate: '解释轮廓与重心关系', advanced: '推导人物比例变化' },
        { id: 'weight', name: '重量判断', group: 'analysis', beginner: '指出最重与最轻区域', intermediate: '解释重量如何稳定或改变轮廓', advanced: '在不同发量下重做取舍' },
        { id: 'layers', name: '层次关系', group: 'analysis', beginner: '观察从哪里开始变轻', intermediate: '解释层次、连接和动静关系', advanced: '区分视觉结果与技术推测' },
        { id: 'line_texture', name: '线条与纹理', group: 'observation', beginner: '识别主要方向和表面状态', intermediate: '说明线条与风格的因果', advanced: '比较相邻风格的细节密度' },
        { id: 'style', name: '风格归纳', group: 'judgment', beginner: '从九型选择主风格', intermediate: '提供证据与反证', advanced: '分析混合比例和变化条件' },
        { id: 'suitability', name: '人物适配', group: 'aesthetic', beginner: '识别需要确认的顾客条件', intermediate: '说明保留、调整与风险', advanced: '在多项限制下做设计取舍' },
        { id: 'technique', name: '技术转化', group: 'design', beginner: '先确定要保留的视觉结果', intermediate: '建立结构与技术假设', advanced: '比较多条路径与失败风险' },
        { id: 'client_communication', name: '顾客沟通', group: 'communication', beginner: '确认顾客真正喜欢的元素', intermediate: '说明差异并给替代方案', advanced: '平衡效果、维护、预算与接受度' }
      ],
      hintLevels: ['常驻方法提示', '基于弱项的个性化提示', '卡住后逐层缩小观察范围'],
      completionSummary: ['看对的内容', '主要遗漏', '误判模式', '能力变化', '可迁移的方法', '下次重点']
    },
    governance: {
      layers: [
        { id: 'standard', name: '稳定标准', rule: '优先采用官方教育体系、职业标准与经审核教材，进入正式评分标准。' },
        { id: 'internal', name: '门店方法', rule: '记录自由手艺人的设计语言和 PERM 方法，必须由负责人审核并注明适用边界。' },
        { id: 'trend', name: '趋势候选', rule: '来自秀场、平台和行业观察，只能作为案例与趋势参考，不能自动成为标准答案。' }
      ],
      publishFlow: ['候选收集', '来源与版权核验', '专业审核', '小范围试用', '版本发布', '效果复盘'],
      reviewCadence: {
        standard: '每 6 个月复核',
        internal: '每月结合门店案例复核',
        trend: '每周收集、每月评审'
      },
      aiRule: 'AI 只根据已发布知识解释和出题，不得把聊天内容、网络热度或单个案例自动写回正式标准。',
      privacyRule: '顾客照片默认不进入公共知识库；用于训练前需取得授权、脱敏并记录使用范围。',
      copyrightRule: '外部书籍和课程只保存书目、链接与原创摘要，不复制受版权保护的正文、图表或课程资料。'
    },
    styleAxes: [
      { id: 'line', name: '曲线 ↔ 直线', use: '判断轮廓、脸周、刘海和卷度的线条语言。' },
      { id: 'volume', name: '小量感 ↔ 大量感', use: '判断长度、蓬松度、层次幅度和发量视觉占比。' },
      { id: 'edge', name: '柔和 ↔ 锐利', use: '判断边缘清晰度、切口、束感和五官呼应。' },
      { id: 'contrast', name: '低对比 ↔ 高对比', use: '判断明暗、发色、轮廓与肤色之间的视觉冲突。' },
      { id: 'age', name: '年轻 ↔ 成熟', use: '判断轻盈感、稳定感、装饰性和秩序感。' },
      { id: 'finish', name: '自然 ↔ 精致', use: '判断纹理随机度、光泽、边界与打理完成度。' },
      { id: 'era', name: '经典 ↔ 前卫', use: '判断设计对趋势的依赖程度和长期适用性。' },
      { id: 'distance', name: '亲和 ↔ 距离感', use: '判断轮廓开放度、五官暴露度和整体气场。' }
    ],
    styleLibrary: [
      { id: 'natural', name: '自然风', english: 'Natural', keywords: '真实、舒适、低造作', language: '均衡轮廓、中等控制、自然纹理、低对比色彩。', neighbors: '与法式共享松弛；比法式更均衡、比日系更少细节。', mapping: '保留真实质感，减少统一造型痕迹，优先考虑日常维护。' },
      { id: 'french', name: '法式风', english: 'French', keywords: '松弛、流动、留白', language: '柔曲线、轻重对比、局部留白、不完全规则的纹理、低饱和色彩。', neighbors: '与日系都可轻盈；法式更松弛留白，日系更强调束感和细节。', mapping: '控制统一痕迹，保留流动和留白，避免把每一束都做成同样方向。' },
      { id: 'korean', name: '韩系风', english: 'Korean', keywords: '精致、柔和、完整', language: '脸周包裹、连续线条、规则卷度、光泽统一、完成度高。', neighbors: '与少女共享柔和；韩系更精致统一，少女更圆润轻快。', mapping: '强化脸周连接和光泽，控制卷度尺度，减少随机碎感。' },
      { id: 'japanese', name: '日系风', english: 'Japanese', keywords: '轻盈、细节、灵动', language: '束感、碎感、丰富局部层次、方向变化和空气感。', neighbors: '与法式共享轻盈；日系细节密度更高、方向变化更明显。', mapping: '保留结构支撑，再用束感和局部纹理制造动感，避免平均打薄。' },
      { id: 'urban', name: '都市风', english: 'Urban', keywords: '知性、利落、稳定', language: '清晰轮廓、中低层次、稳定重心、整洁光泽和高复现性。', neighbors: '与极简共享克制；都市更强调职业场景和可维护性。', mapping: '稳定重心、清楚边界、减少维护成本，让设计可持续复现。' },
      { id: 'minimal', name: '极简风', english: 'Minimal', keywords: '克制、纯净、安静', language: '少层次、少纹理、精确边界、大面积留白和单一色彩关系。', neighbors: '与都市共享结构；极简更少装饰，依赖比例、贴合和边界质量。', mapping: '减少元素但提高精度，先确认头型、发流和边界，再决定长度。' },
      { id: 'sweet', name: '少女风', english: 'Sweet', keywords: '轻快、亲和、圆润', language: '柔曲线、小量感、轻刘海、弹性小弧和明快但不必浅的色彩。', neighbors: '与韩系共享柔和；少女更圆润亲和，韩系更精致包裹。', mapping: '降低攻击性，保留圆润和轻快，避免过度厚重或锐利切口。' },
      { id: 'androgynous', name: '中性风', english: 'Androgynous', keywords: '利落、冷静、力量', language: '直线、几何、集中重量、少卷度、深色或高对比结构。', neighbors: '与都市共享利落；中性更去装饰、直线和力量感更明显。', mapping: '减少曲线和装饰，明确结构边界，同时确认顾客对暴露和维护的接受度。' },
      { id: 'avant_garde', name: '先锋风', english: 'Avant-garde', keywords: '实验、冲突、表达', language: '非对称、强对比、非常规轮廓、特殊色块或故意失衡。', neighbors: '与日系可共享细节；先锋更强调冲突、表达和非常规目的。', mapping: '先明确表达目标和风险，再设计对比关系；不能把随机凌乱当作先锋。' }
    ],
    rubric: [
      { id: 'observation', name: '观察能力', verb: '会看', weight: 20, question: '是否准确描述轮廓、比例、层次、重量、线条、纹理和色彩事实？' },
      { id: 'analysis', name: '分析能力', verb: '会拆', weight: 20, question: '是否说明设计动作为什么产生当前视觉结果？' },
      { id: 'judgment', name: '判断能力', verb: '会判断', weight: 20, question: '是否说明适合谁、不适合谁、为什么以及如何调整？' },
      { id: 'design', name: '设计能力', verb: '会设计', weight: 20, question: '是否把判断转成可执行的剪裁、层次、重量和技术方案？' },
      { id: 'aesthetic', name: '美感能力', verb: '会审美', weight: 20, question: '是否提炼出比例、空间、重心、风格和氛围的可迁移原则？' }
    ],
    modules: [
      {
        id: 'M0',
        order: 0,
        title: '顾客目标与限制',
        objective: '先确定顾客想成为什么样的人，以及不能接受什么，再开始设计。',
        topics: ['场景与职业', '维护时间', '预算与周期', '顾客偏好', '明确禁区', '历史失败'],
        sourceIds: ['S01', 'S08']
      },
      {
        id: 'M1',
        order: 1,
        title: '美感底层',
        objective: '用点、线、面、比例、平衡、节奏、对比、留白和视觉重心解释为什么好看。',
        topics: ['视觉设计', '色彩', '光影', '空间感'],
        sourceIds: ['S01', 'S03', 'S04', 'S11', 'S12', 'S14']
      },
      {
        id: 'M2',
        order: 2,
        title: '人物分析',
        objective: '区分事实描述与风格判断，分析脸型、骨相、皮相、五官、头型、发质、肤色和身材比例。',
        topics: ['脸型与头型', '骨相与皮相', '五官线条', '发质与发量', '肤色与整体比例'],
        sourceIds: ['S01', 'S02', 'S04', 'S06']
      },
      {
        id: 'M3',
        order: 3,
        title: '风格定位',
        objective: '用统一的视觉坐标描述风格，避免只靠风格名称和性别化标签。',
        topics: ['八条风格轴', '人物与场景匹配', '风格主次', '可接受的反差'],
        sourceIds: ['S01', 'S03', 'S08', 'S13']
      },
      {
        id: 'M4',
        order: 4,
        title: '发型设计',
        objective: '把人物分析转成轮廓、长度、层次、重量、脸周、卷度和发色。',
        topics: ['轮廓', '长度与重量', '层次', '刘海与脸周', '卷度', '发色'],
        sourceIds: ['S01', 'S02', 'S03', 'S05']
      },
      {
        id: 'M5',
        order: 5,
        title: '技术实现',
        objective: '让视觉目标、发质条件和剪烫染动作一一对应，并明确风险和替代方案。',
        topics: ['分区', '提升角', '切口与连接', '去量', '吹风与造型', '剪烫染落地'],
        sourceIds: ['S01', 'S02', 'S05', 'S06', 'S07']
      },
      {
        id: 'M6',
        order: 6,
        title: 'AI 训练',
        objective: '通过观察、分类、解释、修改和复盘建立可重复的审美判断。',
        topics: ['每日 5 分钟', '五个隐藏检查点', '同款差异化训练', '先判断后解释', '对比训练', '多维评分'],
        sourceIds: ['S01', 'S09', 'S10']
      },
      {
        id: 'M7',
        order: 7,
        title: '案例知识库',
        objective: '同时记录成功、失败、替代方案和回访结果，让经验能被检索和复用。',
        topics: ['人物条件', '设计目标', '技术参数', '成品', '满意度', '7/30 天反馈', '版权与授权'],
        sourceIds: ['S01', 'S08', 'S09']
      },
      {
        id: 'M8',
        order: 8,
        title: '成长路径',
        objective: '从观察、分析、判断、设计、技术、优化到创新，形成个人设计语言。',
        topics: ['八级能力', '弱项追踪', '阶段考核', '专家复核'],
        sourceIds: ['S01', 'S09', 'S10']
      }
    ],
    sources: [
      {
        id: 'S01',
        layer: 'internal',
        type: '内部方法',
        title: '发型师美感训练体系 V1.0',
        publisher: '自由手艺人',
        url: '',
        use: '课程结构、风格坐标、门店案例字段与成长路径',
        evidence: 'owner_method',
        rights: '内部原创，可用于门店训练',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S02',
        layer: 'standard',
        type: '官方教育',
        title: 'Sassoon ABC Cutting',
        publisher: 'Sassoon Academy',
        url: 'https://academy.sassoon-global.com/course-finder/abc-cut-5-day.html',
        use: '线条、渐层、层次、比例、骨骼结构与适合度',
        evidence: 'official_curriculum',
        rights: '仅保存书目、链接与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S03',
        layer: 'standard',
        type: '官方教育',
        title: 'Pivot Point Fundamentals: Cosmetology',
        publisher: 'Pivot Point International',
        url: 'https://www.pivot-point.com/schools/licensure-education/fundamentals-cosmetology/',
        use: '设计基础、四种基本形与系统化技术训练',
        evidence: 'official_curriculum',
        rights: '仅保存书目、链接与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S04',
        layer: 'standard',
        type: '教材',
        title: 'Milady Standard Cosmetology',
        publisher: 'Milady',
        url: 'https://www.milady.com/catalog/milady-standard-cosmetology',
        use: '发型设计原则、发质与纹理基础、职业咨询',
        evidence: 'publisher_catalog',
        rights: '仅保存书目、链接与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S05',
        layer: 'standard',
        type: '教材',
        title: 'Milady Standard Haircutting System',
        publisher: 'Milady',
        url: 'https://www.milady.com/catalog/milady-standard-haircutting-system',
        use: '剪发结构、分区、切口、层次与技术转译',
        evidence: 'publisher_catalog',
        rights: '仅保存书目、链接与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S06',
        layer: 'standard',
        type: '教材',
        title: 'Hair Structure and Chemistry Simplified',
        publisher: 'Milady',
        url: 'https://www.milady.com/catalog/hair-structure-and-chemistry-simplified-5th-edition',
        use: '发丝结构、化学基础和技术风险边界',
        evidence: 'publisher_catalog',
        rights: '仅保存书目、链接与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S07',
        layer: 'standard',
        type: '官方教育',
        title: 'Wella Color Fundamentals',
        publisher: 'Wella Education',
        url: 'https://education.wella.com/course/view.php?id=1565',
        use: '色轮、天然底色、显色与提浅基础',
        evidence: 'official_curriculum',
        rights: '仅保存书目、链接与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S08',
        layer: 'standard',
        type: '职业标准',
        title: 'Hair and Beauty Technical Qualifications',
        publisher: 'City & Guilds',
        url: 'https://www.cityandguilds.com/-/media/cityandguilds-site/documents/technical-qualifications/technical-qualifications/hei-admissions/j407334-01-hei-hair-and-beauty-guide-v4-pdf.pdf',
        use: '顾客咨询、创意设计、服务流程与职业能力边界',
        evidence: 'qualification_standard',
        rights: '仅保存书目、链接与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S09',
        layer: 'standard',
        type: '研究综述',
        title: 'Deliberate practice and feedback',
        publisher: 'PubMed Central',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6731745/',
        use: '刻意练习、及时反馈与能力提升机制',
        evidence: 'peer_reviewed',
        rights: '保存引用信息与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S10',
        layer: 'standard',
        type: '研究论文',
        title: 'Interleaving and category learning',
        publisher: 'PubMed Central',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10455486/',
        use: '交错案例、类别辨别与迁移训练',
        evidence: 'peer_reviewed',
        rights: '保存引用信息与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S11',
        layer: 'standard',
        type: '设计史资料',
        title: 'Bauhaus-Archiv / Museum für Gestaltung',
        publisher: 'Bauhaus-Archiv Berlin',
        url: 'https://www.bauhaus.de/en/about-us/',
        use: '设计基础、构成、形式与跨媒介观察的历史背景',
        evidence: 'official_archive',
        rights: '仅保存链接与原创摘要，不复制馆藏图像',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S12',
        layer: 'standard',
        type: '设计教材',
        title: "The Non-Designer's Design Book",
        publisher: 'Pearson',
        url: 'https://www.pearson.com/en-us/subject-catalog/p/Non-Designer-s-Design-Book-The-4th-Edition/P200000000691?view=educator',
        use: '对比、重复、对齐与亲密性等基础视觉组织原则',
        evidence: 'publisher_catalog',
        rights: '仅保存书目、链接与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S13',
        layer: 'internal',
        type: '框架索引',
        title: 'PD、韩国形象设计、Kibbe 与四季色彩比较框架',
        publisher: '自由手艺人整理',
        url: '',
        use: '作为风格观察词汇和比较工具，不作为人物身份或唯一适配结论',
        evidence: 'framework_reference',
        rights: '仅记录门店原创比较摘要；后续逐项补充原始书目与授权',
        reviewStatus: 'reference_only',
        reviewedAt: '2026-07-04'
      },
      {
        id: 'S14',
        layer: 'standard',
        type: '设计著作',
        title: 'Designing Design / 设计中的设计',
        publisher: 'Kenya Hara / Lars Müller Publishers',
        url: 'https://www.lars-mueller-publishers.com/designing-design',
        use: '观察、感知、留白与设计思考方法',
        evidence: 'author_and_publisher_catalog',
        rights: '仅保存书目、链接与原创摘要',
        reviewStatus: 'approved',
        reviewedAt: '2026-07-04'
      }
    ],
    trainingCases: [
      {
        id: 'CASE-001',
        title: '轻盈短发 · 侧后轮廓',
        category: '短发',
        imageUrl: 'https://taoyouming308-ui.github.io/img/showcase_45_%E7%9F%AD%E5%8F%91_2026-06-14T09-25-44.jpg',
        focus: '轮廓、后脑重量、发尾动感',
        estimatedMinutes: 5,
        limitations: '只有侧后角度，不能据此确定完整脸型、正面刘海和两侧是否完全对称。',
        guides: {
          observe: {
            prompts: ['先不判断风格，按长度、轮廓、线条、重量、层次、纹理和色彩逐项扫描', '先看外轮廓是什么形', '重量最集中在哪里', '发尾、耳周和后颈是什么状态', '只写画面事实，不写"适合、显瘦、高级"'],
            master: '整体是偏圆的短发外轮廓，顶部到枕骨保持饱满，视觉重量集中在耳上与后脑；耳周局部露出，后颈保留不规则延伸，发尾有外翻和方向变化。深色低对比，主要靠明暗和弯曲线条表现层次。'
          },
          analyze: {
            prompts: ['圆轮廓为什么没有显得厚重', '后脑重量如何支撑头型', '破碎发尾给风格带来什么变化'],
            master: '上部饱满建立稳定轮廓，耳周与后颈的断续边缘削弱厚重感；枕骨附近的重量支撑侧面曲线，外翻发尾和不同方向的纹理打破整齐边界，让深色短发仍有空间和动态。'
          },
          judge: {
            prompts: ['从DSS九型中选择主风格和副风格', '列出至少3项支持证据', '找出1项反证或相邻风格信号'],
            master: '主风格偏日系，副风格偏自然。日系证据来自短碎边缘、不同方向的发尾和可见束感；自然风证据来自圆润骨架、低色彩对比和不过度规则的表面。反证是整体轮廓仍较完整稳定，因此不属于强烈先锋风。'
          },
          design: {
            prompts: ['轮廓和重量线怎样建立', '耳周与后颈怎样处理', '纹理通过剪、烫还是造型完成'],
            master: '先建立顶部至枕骨的圆润骨架，重量保留在耳上和后脑；耳周做开合变化，后颈保留较轻的延伸。内部层次服务于表面方向，不做平均打薄。根据发质选择轻纹理烫或吹风、电棒完成发尾转向，并保留深色光泽。'
          },
          review: {
            prompts: ['真实顾客有哪些条件需要补充确认', '哪些风格核心必须保留', '面对细软、粗硬或低维护需求分别怎样调整'],
            master: '应保留圆润骨架与破碎边缘的核心关系。细软塌发需增加根部支撑并减少过度去量；粗硬膨胀或强自然卷要控制横向体积；不愿日常造型时应减少发尾方向变化。单张侧面图不足以判断脸型和完整头型，必须补正面信息。'
          }
        }
      },
      {
        id: 'CASE-002',
        title: '曲线短发 · 脸周节奏',
        category: '短发',
        imageUrl: 'https://taoyouming308-ui.github.io/img/showcase_46_%E7%9F%AD%E5%8F%91_2026-06-14T09-26-49.jpg',
        focus: '脸周、曲线节奏、轻重平衡',
        estimatedMinutes: 5,
        limitations: '作品包含造型、妆容和拍摄光线，不能把所有氛围都归因于剪发。',
        guides: {
          observe: {
            prompts: ['先不判断风格，按长度、轮廓、线条、重量、层次、纹理和色彩逐项扫描', '刘海和脸周有几组方向', '最宽点与最轻的位置在哪里', '曲线大小是否完全一致', '区分发型事实与模特气质'],
            master: '短发轮廓在耳上和后脑较宽，顶部不过度升高；刘海分成多束弯曲线条，额头有留白，脸周从眼侧、颧骨到耳前形成不同长度。纹理以大弯和局部外翻为主，深色发面保留光泽。'
          },
          analyze: {
            prompts: ['为什么多组曲线不会显乱', '额头留白起什么作用', '耳后外翻怎样改变轮廓'],
            master: '曲线方向不同但尺度接近，并围绕面部形成节奏，所以有变化而不散乱；额头留白减轻刘海重量并突出五官；耳后外翻把视觉重心向外打开，与贴近脸部的刘海形成收放对比。'
          },
          judge: {
            prompts: ['从DSS九型中选择主风格和副风格', '哪些曲线、留白和纹理支持判断', '哪些信号更接近相邻风格'],
            master: '主风格偏日系，副风格偏法式。日系来自多束脸周、细节密度、局部外翻和灵动纹理；法式来自不完全规则的曲线、额头留白和轻松的节奏。卷度仍有一定控制感，因此不是纯法式松弛。'
          },
          design: {
            prompts: ['先剪什么骨架', '脸周每组长度服务什么目标', '卷度怎样保持统一又有变化'],
            master: '先确定耳上偏宽的短发骨架和后脑支点，再按额头、颧骨、耳前分别设计脸周长度。表面层次保留可弯曲的长度，卷度用相近尺度、不同方向建立节奏；避免每束都卷成同样的圆圈。'
          },
          review: {
            prompts: ['顾客目标和维护习惯如何影响方案', '额头、颧骨和耳周条件变化时怎样调整', '哪些氛围来自妆容与摄影而不能照搬'],
            master: '应保留相近尺度、方向变化和明确重心的风格核心。额头比例、颧骨位置和耳周宽度决定刘海开合；细软发需要支撑，强自然卷应减少碎束数量并控制膨胀。人物、服装、妆容和摄影带来的氛围不能全部归因于发型。'
          }
        }
      },
      {
        id: 'CASE-003',
        title: '极短发 · 克制与留白',
        category: '超短发',
        imageUrl: 'https://taoyouming308-ui.github.io/img/showcase_47_%E7%9F%AD%E5%8F%91_2026-06-14T09-26-59.jpg',
        focus: '小量感、面部留白、精细边界',
        estimatedMinutes: 5,
        limitations: '正面照片看不到完整枕骨结构，也无法判断自然状态下的发量和发流。',
        guides: {
          observe: {
            prompts: ['先不判断风格，按长度、轮廓、线条、重量、层次、纹理和色彩逐项扫描', '头发占人物整体的面积', '刘海边界、耳周和后颈是否整齐一致', '哪里贴、哪里有轻微起伏', '色彩对比强还是弱'],
            master: '整体长度极短，耳朵和颈部大面积露出，发型量感小；刘海在眉上呈短而不完全齐整的弧线，耳周贴合，顶部有轻微波纹起伏。深发色与浅肤色形成较高明暗对比，轮廓边界清楚。'
          },
          analyze: {
            prompts: ['为什么很短却不显生硬', '微小波纹和碎边的作用', '留白如何改变视觉重心'],
            master: '清晰短轮廓提供克制感，细小弯曲和不完全齐整的边缘缓和硬度；大面积露出额头、耳朵和颈部，把注意力集中到五官与头颈比例，发型成为框架而不是主体。'
          },
          judge: {
            prompts: ['从DSS九型中选择主风格和副风格', '哪些直线、留白与边界支持判断', '哪些微曲线构成反证'],
            master: '主风格偏极简，副风格偏中性。极简来自小量感、清晰边界、大面积留白和装饰克制；中性来自短轮廓、较高明暗对比和利落结构。顶部微小波纹与柔碎边缘降低硬度，是纯中性判断的反证。'
          },
          design: {
            prompts: ['如何控制贴合但不扁', '边界怎样做到精细而不僵硬', '需要怎样的修剪周期'],
            master: '按头型分区建立贴合轮廓，顶部保留少量可弯曲长度，耳周和后颈精细收紧；边缘采用点状或柔和切口，避免机械齐线。根据发流调整左右，不强求几何对称，并向顾客说明短周期维护。'
          },
          review: {
            prompts: ['顾客能否接受五官、耳朵和颈部暴露', '哪些头型、发际线和发流信息必须确认', '何时需要保留更多长度和调整空间'],
            master: '需要确认顾客是否接受大面积暴露和高频修剪。发际线、头型不对称、旋涡和贴头程度会直接影响结果；希望强修饰脸周或不愿频繁维护时，应保留更多长度。极简元素越少，比例、贴合和边界越不能出错。'
          }
        }
      },
      {
        id: 'CASE-004',
        title: '柔和超短发 · 圆与碎',
        category: '超短发',
        imageUrl: 'https://taoyouming308-ui.github.io/img/showcase_48_%E8%B6%85%E7%9F%AD%E5%8F%91_2026-06-14T09-27-38.jpg',
        focus: '圆轮廓、短刘海、柔锐平衡',
        estimatedMinutes: 5,
        limitations: '照片经过正面光线和造型处理，发色、光泽与皮肤对比可能受拍摄影响。',
        guides: {
          observe: {
            prompts: ['先不判断风格，按长度、轮廓、线条、重量、层次、纹理和色彩逐项扫描', '外轮廓偏圆还是偏方', '刘海长度与边缘状态', '耳周有没有完全收紧', '顶部纹理的尺度'],
            master: '轮廓小而偏圆，顶部保留柔和起伏；刘海在眉上，边缘短碎，额头仍有部分留白；耳周露出但鬓角和耳后保留细小延伸。整体纹理细，深棕色低饱和，边界柔和。'
          },
          analyze: {
            prompts: ['圆轮廓与短碎边缘怎样平衡', '为什么耳周还要留一点延伸', '细纹理带来什么气质'],
            master: '圆形骨架提供亲和与完整感，短碎刘海和耳周细小延伸减少“头盔感”；细尺度纹理让变化靠近表面，不扩大体积，因此既柔和又保持短发的利落。'
          },
          judge: {
            prompts: ['从DSS九型中选择主风格和副风格', '哪些圆线、细纹理和短碎边缘支持判断', '哪些利落结构构成反证'],
            master: '主风格偏少女，副风格偏日系。少女感来自紧凑圆轮廓、小尺度曲线、眉上短刘海和较低攻击性；日系来自细碎边缘、耳周延伸和表面束感。耳周收紧与短轮廓仍保留利落结构，因此不是单纯甜美。'
          },
          design: {
            prompts: ['圆形骨架怎样分区', '刘海与耳周如何连接', '去量应放在哪里'],
            master: '先按头型建立紧凑圆形骨架，顶部保留可产生细弯的长度；刘海用不等长短点形成柔边，耳周收紧但不全部推平。去量集中在内部堆积处，表面保留完整度和光泽。'
          },
          review: {
            prompts: ['顾客是否接受短刘海和眉眼暴露', '粗硬、细软和旋涡明显时分别怎样调整', '哪些元素必须保留才能维持柔和风格'],
            master: '应保留圆形比例、细尺度纹理、非机械边缘和微小延伸。短刘海会暴露额头与眉眼，必须确认接受度；粗硬发需保留压住轮廓的长度，细软发避免过度去量，旋涡明显时应顺应发流。'
          }
        }
      },
      {
        id: 'CASE-005',
        title: '湿感短鲍伯 · 直线张力',
        category: '短发',
        imageUrl: 'https://taoyouming308-ui.github.io/img/showcase_49_%E8%B6%85%E7%9F%AD%E5%8F%91_2026-06-14T09-27-53.jpg',
        focus: '直线轮廓、低体积、湿感质地',
        estimatedMinutes: 5,
        limitations: '湿感造型显著改变发量、光泽和贴合度，不能直接推断顾客自然干发状态。',
        guides: {
          observe: {
            prompts: ['先不判断风格，按长度、轮廓、线条、重量、层次、纹理和色彩逐项扫描', '轮廓线落在什么位置', '顶部体积高还是低', '脸周和后颈是否同一长度', '湿感如何影响束感与光泽'],
            master: '短鲍伯长度靠近下颌与后颈，外轮廓以直线和清晰切口为主；顶部压低、头发表面贴合，侧分发线明确。脸周有较长尖角，后颈发尾局部外翘。湿感让发束聚合并提高光泽。'
          },
          analyze: {
            prompts: ['低体积为什么仍有力量', '长尖角与短后颈形成什么关系', '湿感怎样强化设计语言'],
            master: '力量来自清晰直线、低重心和轮廓边界，而不是蓬松度；脸周长尖角与短后颈形成前后长度张力；湿感减少碎发和空气感，让线条、贴合和切口更突出。'
          },
          judge: {
            prompts: ['从DSS九型中选择主风格和副风格', '哪些直线、低体积与湿感支持判断', '哪些常规结构限制了先锋匹配度'],
            master: '主风格偏中性，副风格偏先锋。中性来自清晰直线、低重心、贴合表面和深色结构；先锋来自前长后短张力、脸周尖角与湿感质地。整体仍保留可识别的短鲍伯骨架，因此先锋属于副风格。'
          },
          design: {
            prompts: ['如何建立准确外线', '内部重量是否需要大量去除', '湿感造型的产品和方向'],
            master: '先在自然落点建立清晰外线和前长后短关系，内部保留足够重量支撑切口，只处理妨碍贴合的堆积。吹整顺着头型压低体积，使用轻湿感产品聚合发束；后颈外翘要主动设计，不是随意翻出。'
          },
          review: {
            prompts: ['顾客是否接受湿感产品和低体积表达', '蓬松自然卷、粗硬发或低维护需求如何调整', '不做湿感时怎样保留风格核心'],
            master: '适合追求冷静、前卫、低体积表达并愿意使用造型品的顾客。蓬松自然卷、粗硬发或不愿打理者与参考图差距较大；应提供自然状态降级方案。所谓高级感要拆成比例、体积、边界、质地和重心，不能用造型质地冒充剪裁结构。'
          }
        }
      }
    ],
    questions: [
      {
        id: 'Q001',
        moduleId: 'M0',
        dimension: 'judgment',
        prompt: '顾客拿着参考图说“就要这一款”，设计前最先确认什么？',
        options: ['直接判断脸型', '她喜欢参考图中的哪种感觉、日常维护时间和不能接受的变化', '先决定烫发杠号', '先拍成品照'],
        answer: 1,
        explanation: '参考图只是表达媒介。先澄清目标、使用场景和限制，才能判断哪些视觉特征应保留、哪些需要调整。',
        sourceIds: ['S01', 'S08']
      },
      {
        id: 'Q002',
        moduleId: 'M1',
        dimension: 'observation',
        prompt: '下面哪一句属于可验证的视觉观察？',
        options: ['她很有高级感', '她适合法式风格', '颧骨外侧是面部最宽点，眉眼线条偏直', '她看起来很温柔'],
        answer: 2,
        explanation: '观察先描述能被共同看见的结构和线条；“高级、法式、温柔”属于后续解释或风格判断。',
        sourceIds: ['S01', 'S03']
      },
      {
        id: 'Q003',
        moduleId: 'M1',
        dimension: 'aesthetic',
        prompt: '想让整体视觉更稳定、沉静，哪种处理更一致？',
        options: ['提高顶部和两侧的随机蓬松度', '降低轮廓跳动，保留清晰重心与较低色彩对比', '同时加入碎刘海、强卷和高对比挑染', '只改变发尾一小束颜色'],
        answer: 1,
        explanation: '稳定感来自重心明确、节奏克制和元素之间的一致性，不是简单减少设计。',
        sourceIds: ['S01', 'S03', 'S04']
      },
      {
        id: 'Q004',
        moduleId: 'M2',
        dimension: 'analysis',
        prompt: '判断脸周需要修饰颧骨时，最有价值的证据是什么？',
        options: ['顾客年龄', '颧骨最高点与面部最宽点的位置、正侧面光影和顾客在意区域', '当天穿的衣服颜色', '最近流行的刘海'],
        answer: 1,
        explanation: '设计判断必须同时有结构证据和顾客目标，趋势只能作为表达方式参考。',
        sourceIds: ['S01', 'S02', 'S08']
      },
      {
        id: 'Q005',
        moduleId: 'M2',
        dimension: 'observation',
        prompt: '评估头型时为什么必须同时看正面、侧面和后面？',
        options: ['让照片数量更多', '单一角度不能完整反映顶部高度、侧宽和枕骨转折', '侧面照片更适合发朋友圈', '为了判断肤色'],
        answer: 1,
        explanation: '头型是三维结构。单张正面照无法可靠判断枕骨、侧脑和前后重心。',
        sourceIds: ['S01', 'S02']
      },
      {
        id: 'Q006',
        moduleId: 'M3',
        dimension: 'aesthetic',
        prompt: '为什么风格定位要使用“曲直、量感、柔锐”等连续坐标？',
        options: ['坐标名字更专业', '能描述混合与程度，避免把人强行塞进单一标签', '可以完全替代顾客沟通', '能自动决定所有技术参数'],
        answer: 1,
        explanation: '连续坐标能表达主次和程度；风格名称可以保留，但必须能回到可观察、可调整的视觉变量。',
        sourceIds: ['S01']
      },
      {
        id: 'Q007',
        moduleId: 'M3',
        dimension: 'judgment',
        prompt: '人物分析显示适合强轮廓，但顾客职业要求低存在感，正确做法是什么？',
        options: ['坚持理论最适合的强轮廓', '放弃全部设计', '保留结构优势，同时降低对比、锐度或维护要求', '让顾客自己选择技术'],
        answer: 2,
        explanation: '“适合”不是脱离场景的唯一答案。设计要在人物优势、顾客目标与现实约束之间取得可解释的平衡。',
        sourceIds: ['S01', 'S08']
      },
      {
        id: 'Q008',
        moduleId: 'M4',
        dimension: 'design',
        prompt: '“希望脸看起来更舒展”怎样转成可执行的发型动作？',
        options: ['做一个高级发型', '选择合适风格', '明确顶部高度、脸周开合、最宽点位置和纵横比例', '换一张参考图'],
        answer: 2,
        explanation: '设计语言必须落到可控制的形状、位置和比例，技术人员才能稳定复现。',
        sourceIds: ['S01', 'S02', 'S03']
      },
      {
        id: 'Q009',
        moduleId: 'M4',
        dimension: 'design',
        prompt: '降低发型视觉量感，下面哪组动作更直接？',
        options: ['增加横向最宽点并强化卷圈', '减小轮廓面积、降低横向膨胀、控制层次与发尾重量', '只提高发色饱和度', '所有区域统一打薄'],
        answer: 1,
        explanation: '量感首先来自轮廓占比、横向宽度、厚薄和纹理尺度；盲目打薄可能破坏支撑和发质。',
        sourceIds: ['S01', 'S03', 'S05']
      },
      {
        id: 'Q010',
        moduleId: 'M5',
        dimension: 'design',
        prompt: '审美方案确定后，技术落地前最重要的校验是什么？',
        options: ['方案名称是否流行', '发质、发量、损伤史、居家维护与目标效果是否允许', '顾客是否愿意拍照', '发型师是否做过同名款式'],
        answer: 1,
        explanation: '视觉目标必须经过材料条件和维护条件校验；做不到时应给替代方案，不应隐瞒风险。',
        sourceIds: ['S01', 'S06', 'S08']
      },
      {
        id: 'Q011',
        moduleId: 'M5',
        dimension: 'analysis',
        prompt: '同一张参考图为什么不能直接复制同一套剪烫参数？',
        options: ['每位发型师习惯不同', '头型、发量、发径、自然卷、损伤度和目标维护方式可能不同', '参考图一定经过修图', '顾客不会发现区别'],
        answer: 1,
        explanation: '参考图提供视觉目标，不提供完整材料条件。技术参数必须根据当前顾客重新设计。',
        sourceIds: ['S01', 'S05', 'S06']
      },
      {
        id: 'Q012',
        moduleId: 'M6',
        dimension: 'judgment',
        prompt: 'AI 给出“适合知性风格”，发型师下一步应做什么？',
        options: ['直接接受结论', '要求 AI 列出观察证据、反例、设计动作与风险，再由发型师判断', '只看评分', '把结论存进顾客档案'],
        answer: 1,
        explanation: 'AI 的价值是帮助组织证据和产生备选方案，不是替代专业判断。无法解释的标签不能直接指导设计。',
        sourceIds: ['S01', 'S09']
      },
      {
        id: 'Q013',
        moduleId: 'M6',
        dimension: 'observation',
        prompt: '每天 5 分钟训练中，哪种安排更利于形成审美判断？',
        options: ['连续看 5 分钟漂亮图片', '人物、风格、解剖、适配、沟通依次完成并说明依据', '背诵风格名称', '只练自己最熟悉的发型'],
        answer: 1,
        explanation: '有效训练需要明确任务、即时反馈和针对弱项的重复，而不是被动浏览。',
        sourceIds: ['S01', 'S09', 'S10']
      },
      {
        id: 'Q014',
        moduleId: 'M6',
        dimension: 'aesthetic',
        prompt: '为什么训练题要交错出现不同风格和相近案例？',
        options: ['让题目更难', '训练辨别关键差异，减少只记住固定模板', '减少题库维护', '避免给出解释'],
        answer: 1,
        explanation: '交错练习迫使学习者比较类别边界，有助于把判断迁移到新顾客，而不是记答案。',
        sourceIds: ['S10']
      },
      {
        id: 'Q015',
        moduleId: 'M7',
        dimension: 'analysis',
        prompt: '一个案例进入正式知识库，至少还缺少哪类信息才有复用价值？',
        options: ['只有成品照片已经足够', '人物条件、顾客目标、设计理由、技术过程、结果反馈和使用授权', '只要 AI 高分', '只要点赞量高'],
        answer: 1,
        explanation: '没有前提、过程和结果的漂亮照片只能提供灵感，不能成为可复用的设计证据。',
        sourceIds: ['S01', 'S08', 'S09']
      },
      {
        id: 'Q016',
        moduleId: 'M7',
        dimension: 'judgment',
        prompt: '顾客成品照被用于内部训练前，正确处理是什么？',
        options: ['员工拍摄就默认可用', '取得授权、说明范围、尽量脱敏并允许撤回', '只要不发朋友圈就不需要处理', '上传后再询问'],
        answer: 1,
        explanation: '照片使用范围必须明确。默认不进入公共知识库，训练使用也应遵循授权和最小必要原则。',
        sourceIds: ['S01']
      },
      {
        id: 'Q017',
        moduleId: 'M8',
        dimension: 'judgment',
        prompt: '判断一名发型师从“分析”进入“判断”阶段，关键证据是什么？',
        options: ['能说出更多风格名称', '能基于人物证据比较多个方向，并说明选择与舍弃的理由', '作品数量增加', '训练用时更短'],
        answer: 1,
        explanation: '判断能力体现在有证据地比较方案和权衡取舍，不是标签数量或速度。',
        sourceIds: ['S01', 'S09']
      },
      {
        id: 'Q018',
        moduleId: 'M8',
        dimension: 'design',
        prompt: '形成个人设计语言，不等于什么？',
        options: ['建立稳定的判断原则', '能解释反复出现的线条、比例和质感偏好', '所有顾客都做成同一种标志性发型', '知道何时坚持、何时为顾客调整'],
        answer: 2,
        explanation: '个人语言是稳定的判断方法和表达倾向，不是忽略顾客差异的固定模板。',
        sourceIds: ['S01', 'S02']
      }
    ]
  };
})(window);
