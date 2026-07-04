(function(global) {
  'use strict';

  global.AESTHETIC_KNOWLEDGE_V1 = {
    schemaVersion: 1,
    version: '1.0.0',
    title: 'Hair Aesthetic System',
    publishedAt: '2026-07-04',
    status: 'published',
    owner: '自由手艺人',
    notice: '本知识库用于审美训练与设计复盘，不替代现场发质检测、顾客沟通和专业技术判断。',
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
    rubric: [
      { id: 'observation', name: '观察准确', weight: 20, question: '描述的是画面事实，还是未经验证的印象？' },
      { id: 'evidence', name: '理由证据', weight: 20, question: '每个判断是否能指出人物或发型中的具体依据？' },
      { id: 'coherence', name: '风格一致', weight: 15, question: '轮廓、线条、色彩和质感是否讲同一种视觉语言？' },
      { id: 'solution', name: '设计转译', weight: 20, question: '是否把观察转成了明确的长度、轮廓、层次、脸周和色彩动作？' },
      { id: 'feasibility', name: '技术可行', weight: 15, question: '是否符合发质、发量、损伤度和技术风险？' },
      { id: 'customer', name: '顾客适配', weight: 10, question: '是否考虑职业、维护时间、预算、接受度和明确禁区？' }
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
        topics: ['每日 20 分钟', '先判断后解释', '对比训练', '错题回练', '多维评分'],
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
    questions: [
      {
        id: 'Q001',
        moduleId: 'M0',
        dimension: 'customer',
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
        dimension: 'coherence',
        prompt: '想让整体视觉更稳定、沉静，哪种处理更一致？',
        options: ['提高顶部和两侧的随机蓬松度', '降低轮廓跳动，保留清晰重心与较低色彩对比', '同时加入碎刘海、强卷和高对比挑染', '只改变发尾一小束颜色'],
        answer: 1,
        explanation: '稳定感来自重心明确、节奏克制和元素之间的一致性，不是简单减少设计。',
        sourceIds: ['S01', 'S03', 'S04']
      },
      {
        id: 'Q004',
        moduleId: 'M2',
        dimension: 'evidence',
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
        dimension: 'coherence',
        prompt: '为什么风格定位要使用“曲直、量感、柔锐”等连续坐标？',
        options: ['坐标名字更专业', '能描述混合与程度，避免把人强行塞进单一标签', '可以完全替代顾客沟通', '能自动决定所有技术参数'],
        answer: 1,
        explanation: '连续坐标能表达主次和程度；风格名称可以保留，但必须能回到可观察、可调整的视觉变量。',
        sourceIds: ['S01']
      },
      {
        id: 'Q007',
        moduleId: 'M3',
        dimension: 'customer',
        prompt: '人物分析显示适合强轮廓，但顾客职业要求低存在感，正确做法是什么？',
        options: ['坚持理论最适合的强轮廓', '放弃全部设计', '保留结构优势，同时降低对比、锐度或维护要求', '让顾客自己选择技术'],
        answer: 2,
        explanation: '“适合”不是脱离场景的唯一答案。设计要在人物优势、顾客目标与现实约束之间取得可解释的平衡。',
        sourceIds: ['S01', 'S08']
      },
      {
        id: 'Q008',
        moduleId: 'M4',
        dimension: 'solution',
        prompt: '“希望脸看起来更舒展”怎样转成可执行的发型动作？',
        options: ['做一个高级发型', '选择合适风格', '明确顶部高度、脸周开合、最宽点位置和纵横比例', '换一张参考图'],
        answer: 2,
        explanation: '设计语言必须落到可控制的形状、位置和比例，技术人员才能稳定复现。',
        sourceIds: ['S01', 'S02', 'S03']
      },
      {
        id: 'Q009',
        moduleId: 'M4',
        dimension: 'solution',
        prompt: '降低发型视觉量感，下面哪组动作更直接？',
        options: ['增加横向最宽点并强化卷圈', '减小轮廓面积、降低横向膨胀、控制层次与发尾重量', '只提高发色饱和度', '所有区域统一打薄'],
        answer: 1,
        explanation: '量感首先来自轮廓占比、横向宽度、厚薄和纹理尺度；盲目打薄可能破坏支撑和发质。',
        sourceIds: ['S01', 'S03', 'S05']
      },
      {
        id: 'Q010',
        moduleId: 'M5',
        dimension: 'feasibility',
        prompt: '审美方案确定后，技术落地前最重要的校验是什么？',
        options: ['方案名称是否流行', '发质、发量、损伤史、居家维护与目标效果是否允许', '顾客是否愿意拍照', '发型师是否做过同名款式'],
        answer: 1,
        explanation: '视觉目标必须经过材料条件和维护条件校验；做不到时应给替代方案，不应隐瞒风险。',
        sourceIds: ['S01', 'S06', 'S08']
      },
      {
        id: 'Q011',
        moduleId: 'M5',
        dimension: 'feasibility',
        prompt: '同一张参考图为什么不能直接复制同一套剪烫参数？',
        options: ['每位发型师习惯不同', '头型、发量、发径、自然卷、损伤度和目标维护方式可能不同', '参考图一定经过修图', '顾客不会发现区别'],
        answer: 1,
        explanation: '参考图提供视觉目标，不提供完整材料条件。技术参数必须根据当前顾客重新设计。',
        sourceIds: ['S01', 'S05', 'S06']
      },
      {
        id: 'Q012',
        moduleId: 'M6',
        dimension: 'evidence',
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
        prompt: '每天 20 分钟训练中，哪种安排更利于形成审美判断？',
        options: ['连续看 20 分钟漂亮图片', '观察事实、做出判断、说明理由、修改方案、复盘错因', '背诵风格名称', '只练自己最熟悉的发型'],
        answer: 1,
        explanation: '有效训练需要明确任务、即时反馈和针对弱项的重复，而不是被动浏览。',
        sourceIds: ['S01', 'S09', 'S10']
      },
      {
        id: 'Q014',
        moduleId: 'M6',
        dimension: 'coherence',
        prompt: '为什么训练题要交错出现不同风格和相近案例？',
        options: ['让题目更难', '训练辨别关键差异，减少只记住固定模板', '减少题库维护', '避免给出解释'],
        answer: 1,
        explanation: '交错练习迫使学习者比较类别边界，有助于把判断迁移到新顾客，而不是记答案。',
        sourceIds: ['S10']
      },
      {
        id: 'Q015',
        moduleId: 'M7',
        dimension: 'evidence',
        prompt: '一个案例进入正式知识库，至少还缺少哪类信息才有复用价值？',
        options: ['只有成品照片已经足够', '人物条件、顾客目标、设计理由、技术过程、结果反馈和使用授权', '只要 AI 高分', '只要点赞量高'],
        answer: 1,
        explanation: '没有前提、过程和结果的漂亮照片只能提供灵感，不能成为可复用的设计证据。',
        sourceIds: ['S01', 'S08', 'S09']
      },
      {
        id: 'Q016',
        moduleId: 'M7',
        dimension: 'customer',
        prompt: '顾客成品照被用于内部训练前，正确处理是什么？',
        options: ['员工拍摄就默认可用', '取得授权、说明范围、尽量脱敏并允许撤回', '只要不发朋友圈就不需要处理', '上传后再询问'],
        answer: 1,
        explanation: '照片使用范围必须明确。默认不进入公共知识库，训练使用也应遵循授权和最小必要原则。',
        sourceIds: ['S01']
      },
      {
        id: 'Q017',
        moduleId: 'M8',
        dimension: 'evidence',
        prompt: '判断一名发型师从“分析”进入“判断”阶段，关键证据是什么？',
        options: ['能说出更多风格名称', '能基于人物证据比较多个方向，并说明选择与舍弃的理由', '作品数量增加', '训练用时更短'],
        answer: 1,
        explanation: '判断能力体现在有证据地比较方案和权衡取舍，不是标签数量或速度。',
        sourceIds: ['S01', 'S09']
      },
      {
        id: 'Q018',
        moduleId: 'M8',
        dimension: 'solution',
        prompt: '形成个人设计语言，不等于什么？',
        options: ['建立稳定的判断原则', '能解释反复出现的线条、比例和质感偏好', '所有顾客都做成同一种标志性发型', '知道何时坚持、何时为顾客调整'],
        answer: 2,
        explanation: '个人语言是稳定的判断方法和表达倾向，不是忽略顾客差异的固定模板。',
        sourceIds: ['S01', 'S02']
      }
    ]
  };
})(window);
