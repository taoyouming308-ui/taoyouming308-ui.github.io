(function(global) {
  'use strict';

  global.AESTHETIC_KNOWLEDGE_V1 = {
    schemaVersion: 1,
    version: '1.1.0',
    title: 'Hair Aesthetic System',
    publishedAt: '2026-07-04',
    status: 'published',
    owner: '自由手艺人',
    notice: '本知识库用于审美训练与设计复盘，不替代现场发质检测、顾客沟通和专业技术判断。',
    product: {
      mission: '帮助发型师建立专业的观察、分析、判断、设计与美感体系。',
      positioning: 'AI 发型师设计思维训练系统',
      belief: '产品核心不是 AI，而是训练体系。AI 不替发型师思考，只负责点评、指出遗漏、继续追问和整理完整解析。',
      promise: '不是教发型师复制作品，而是训练他们创造作品。',
      tagline: '让模仿变成理解，让理解变成创造。'
    },
    capabilities: [
      {
        id: 'observation',
        name: '观察能力',
        verb: '会看',
        goal: '准确描述作品，不遗漏重要设计细节。',
        outcome: '把“觉得好看”变成“知道哪里好看”。',
        checkpoints: ['风格线索', '整体轮廓', '长度比例', '层次结构', '重量分布', '刘海', '脸周', '线条', '纹理', '发色与光泽', '整体氛围']
      },
      {
        id: 'analysis',
        name: '分析能力',
        verb: '会拆',
        goal: '理解轮廓、层次、重量、长度和脸周背后的设计逻辑。',
        outcome: '理解设计逻辑，而不是只会模仿。',
        checkpoints: ['轮廓目的', '层次作用', '重量安排', '长度原因', '脸型修饰', '风格形成', '整体协调']
      },
      {
        id: 'judgment',
        name: '判断能力',
        verb: '会判断',
        goal: '根据顾客条件选择、舍弃和调整设计。',
        outcome: '知道漂亮的作品为什么不一定适合每一位顾客。',
        checkpoints: ['适合脸型', '适合发质', '适合年龄与场景', '适合风格', '不适合人群', '调整方向', '维护成本']
      },
      {
        id: 'design',
        name: '设计能力',
        verb: '会设计',
        goal: '把分析结果转成自己的施工方案和设计语言。',
        outcome: '从模仿走向原创设计。',
        checkpoints: ['剪裁结构', '层次建立', '重量安排', '比例优化', '细节调整', '技术路径', '个人表达']
      },
      {
        id: 'aesthetic',
        name: '美感能力',
        verb: '会审美',
        goal: '把控比例、空间、重心、色彩、纹理、风格与氛围。',
        outcome: '不只是会做发型，更知道高级感从哪里产生。',
        checkpoints: ['比例', '空间', '重心', '风格', '色彩', '纹理', '高级感', '氛围']
      }
    ],
    trainingFlow: [
      {
        id: 'observe',
        capabilityId: 'observation',
        name: '观察',
        english: 'Observe',
        question: '我看到了什么？',
        rule: '只描述事实，不分析、不推测。',
        coachAction: '检查是否把主观感受误写成事实，并提醒遗漏的视觉信息。'
      },
      {
        id: 'analyze',
        capabilityId: 'analysis',
        name: '分析',
        english: 'Analyze',
        question: '为什么会这样设计？',
        rule: '解释设计动作与视觉结果之间的因果关系。',
        coachAction: '检查理由是否有作品证据，继续追问“为什么”。'
      },
      {
        id: 'judge',
        capabilityId: 'judgment',
        name: '判断',
        english: 'Judge',
        question: '适合谁？为什么？',
        rule: '同时说清适合、不适合和需要调整的条件。',
        coachAction: '检查判断是否考虑人物、发质、场景和维护成本。'
      },
      {
        id: 'design',
        capabilityId: 'design',
        name: '设计',
        english: 'Design',
        question: '如果由我来做，我会怎么完成？',
        rule: '把设计想法转成轮廓、层次、重量、脸周和技术方案。',
        coachAction: '检查方案是否可执行，并指出设计与技术之间的断点。'
      },
      {
        id: 'review',
        capabilityId: 'aesthetic',
        name: '复盘',
        english: 'Review',
        question: '我今天学到了什么？',
        rule: '总结一条可以迁移到下一位顾客的设计原则。',
        coachAction: '帮助把一次案例经验提炼为自己的设计语言。'
      }
    ],
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
    trainingCases: [
      {
        id: 'CASE-001',
        title: '轻盈短发 · 侧后轮廓',
        category: '短发',
        imageUrl: 'https://taoyouming308-ui.github.io/img/showcase_45_%E7%9F%AD%E5%8F%91_2026-06-14T09-25-44.jpg',
        focus: '轮廓、后脑重量、发尾动感',
        estimatedMinutes: 15,
        limitations: '只有侧后角度，不能据此确定完整脸型、正面刘海和两侧是否完全对称。',
        guides: {
          observe: {
            prompts: ['先看外轮廓是什么形', '重量最集中在哪里', '发尾、耳周和后颈是什么状态', '只写画面事实，不写“适合、显瘦、高级”'],
            master: '整体是偏圆的短发外轮廓，顶部到枕骨保持饱满，视觉重量集中在耳上与后脑；耳周局部露出，后颈保留不规则延伸，发尾有外翻和方向变化。深色低对比，主要靠明暗和弯曲线条表现层次。'
          },
          analyze: {
            prompts: ['圆轮廓为什么没有显得厚重', '后脑重量如何支撑头型', '破碎发尾给风格带来什么变化'],
            master: '上部饱满建立稳定轮廓，耳周与后颈的断续边缘削弱厚重感；枕骨附近的重量支撑侧面曲线，外翻发尾和不同方向的纹理打破整齐边界，让深色短发仍有空间和动态。'
          },
          judge: {
            prompts: ['什么发量和发质更容易完成', '什么顾客需要调整', '日常维护要求是什么'],
            master: '更适合接受短发、愿意做基础造型，且发量中等到偏多或有一定支撑力的顾客。细软塌发需要增加根部支撑；粗硬膨胀或强自然卷要控制横向体积。单张侧面图不足以判断具体脸型，必须补正面与头型信息。'
          },
          design: {
            prompts: ['轮廓和重量线怎样建立', '耳周与后颈怎样处理', '纹理通过剪、烫还是造型完成'],
            master: '先建立顶部至枕骨的圆润骨架，重量保留在耳上和后脑；耳周做开合变化，后颈保留较轻的延伸。内部层次服务于表面方向，不做平均打薄。根据发质选择轻纹理烫或吹风、电棒完成发尾转向，并保留深色光泽。'
          },
          review: {
            prompts: ['今天最值得带走的一条原则', '下次遇到不同发量怎样变化', '你会加入什么个人表达'],
            master: '圆润骨架与破碎边缘可以同时存在：骨架负责稳定和头型，边缘负责轻盈与个性。先确定重量支点，再决定去量和纹理，不能为了“轻”而平均打薄。'
          }
        }
      },
      {
        id: 'CASE-002',
        title: '曲线短发 · 脸周节奏',
        category: '短发',
        imageUrl: 'https://taoyouming308-ui.github.io/img/showcase_46_%E7%9F%AD%E5%8F%91_2026-06-14T09-26-49.jpg',
        focus: '脸周、曲线节奏、轻重平衡',
        estimatedMinutes: 15,
        limitations: '作品包含造型、妆容和拍摄光线，不能把所有氛围都归因于剪发。',
        guides: {
          observe: {
            prompts: ['刘海和脸周有几组方向', '最宽点与最轻的位置在哪里', '曲线大小是否完全一致', '区分发型事实与模特气质'],
            master: '短发轮廓在耳上和后脑较宽，顶部不过度升高；刘海分成多束弯曲线条，额头有留白，脸周从眼侧、颧骨到耳前形成不同长度。纹理以大弯和局部外翻为主，深色发面保留光泽。'
          },
          analyze: {
            prompts: ['为什么多组曲线不会显乱', '额头留白起什么作用', '耳后外翻怎样改变轮廓'],
            master: '曲线方向不同但尺度接近，并围绕面部形成节奏，所以有变化而不散乱；额头留白减轻刘海重量并突出五官；耳后外翻把视觉重心向外打开，与贴近脸部的刘海形成收放对比。'
          },
          judge: {
            prompts: ['适合怎样的五官线条与风格目标', '高额头、窄额头怎样调整', '自然卷或细软发有什么风险'],
            master: '适合希望呈现灵动、个性和轻复古感，并愿意日常整理纹理的顾客。额头比例、颧骨位置和耳周宽度决定刘海开合，不能照搬。细软发需要支撑，强自然卷要减少碎束数量并控制膨胀。'
          },
          design: {
            prompts: ['先剪什么骨架', '脸周每组长度服务什么目标', '卷度怎样保持统一又有变化'],
            master: '先确定耳上偏宽的短发骨架和后脑支点，再按额头、颧骨、耳前分别设计脸周长度。表面层次保留可弯曲的长度，卷度用相近尺度、不同方向建立节奏；避免每束都卷成同样的圆圈。'
          },
          review: {
            prompts: ['“有变化但不乱”的条件是什么', '这个案例哪些氛围不来自头发', '如何迁移到中长发'],
            master: '节奏来自“相近尺度＋方向变化＋明确重心”。分析作品时要分开发型、人物、服装、妆容和摄影，不能把整体氛围全部解释成剪发效果。'
          }
        }
      },
      {
        id: 'CASE-003',
        title: '极短发 · 克制与留白',
        category: '超短发',
        imageUrl: 'https://taoyouming308-ui.github.io/img/showcase_47_%E7%9F%AD%E5%8F%91_2026-06-14T09-26-59.jpg',
        focus: '小量感、面部留白、精细边界',
        estimatedMinutes: 15,
        limitations: '正面照片看不到完整枕骨结构，也无法判断自然状态下的发量和发流。',
        guides: {
          observe: {
            prompts: ['头发占人物整体的面积', '刘海边界、耳周和后颈是否整齐一致', '哪里贴、哪里有轻微起伏', '色彩对比强还是弱'],
            master: '整体长度极短，耳朵和颈部大面积露出，发型量感小；刘海在眉上呈短而不完全齐整的弧线，耳周贴合，顶部有轻微波纹起伏。深发色与浅肤色形成较高明暗对比，轮廓边界清楚。'
          },
          analyze: {
            prompts: ['为什么很短却不显生硬', '微小波纹和碎边的作用', '留白如何改变视觉重心'],
            master: '清晰短轮廓提供克制感，细小弯曲和不完全齐整的边缘缓和硬度；大面积露出额头、耳朵和颈部，把注意力集中到五官与头颈比例，发型成为框架而不是主体。'
          },
          judge: {
            prompts: ['顾客需要接受哪些暴露', '发际线、头型和发流为什么重要', '哪些情况应保留更多长度'],
            master: '适合愿意露出五官、耳朵和颈部，且接受高频修剪的顾客。发际线、头型不对称、旋涡和贴头程度会直接影响结果；希望强修饰脸周或不愿频繁维护时，应保留更多长度与调整空间。'
          },
          design: {
            prompts: ['如何控制贴合但不扁', '边界怎样做到精细而不僵硬', '需要怎样的修剪周期'],
            master: '按头型分区建立贴合轮廓，顶部保留少量可弯曲长度，耳周和后颈精细收紧；边缘采用点状或柔和切口，避免机械齐线。根据发流调整左右，不强求几何对称，并向顾客说明短周期维护。'
          },
          review: {
            prompts: ['极简为什么反而要求更高', '这个案例最重要的留白在哪里', '怎样判断该减还是该留'],
            master: '设计元素越少，比例、头型贴合和边界质量越不能出错。极简不是简单剪短，而是主动选择哪里露、哪里贴、哪里保留一丝变化。'
          }
        }
      },
      {
        id: 'CASE-004',
        title: '柔和超短发 · 圆与碎',
        category: '超短发',
        imageUrl: 'https://taoyouming308-ui.github.io/img/showcase_48_%E8%B6%85%E7%9F%AD%E5%8F%91_2026-06-14T09-27-38.jpg',
        focus: '圆轮廓、短刘海、柔锐平衡',
        estimatedMinutes: 15,
        limitations: '照片经过正面光线和造型处理，发色、光泽与皮肤对比可能受拍摄影响。',
        guides: {
          observe: {
            prompts: ['外轮廓偏圆还是偏方', '刘海长度与边缘状态', '耳周有没有完全收紧', '顶部纹理的尺度'],
            master: '轮廓小而偏圆，顶部保留柔和起伏；刘海在眉上，边缘短碎，额头仍有部分留白；耳周露出但鬓角和耳后保留细小延伸。整体纹理细，深棕色低饱和，边界柔和。'
          },
          analyze: {
            prompts: ['圆轮廓与短碎边缘怎样平衡', '为什么耳周还要留一点延伸', '细纹理带来什么气质'],
            master: '圆形骨架提供亲和与完整感，短碎刘海和耳周细小延伸减少“头盔感”；细尺度纹理让变化靠近表面，不扩大体积，因此既柔和又保持短发的利落。'
          },
          judge: {
            prompts: ['什么头型与发际线需要调整', '粗硬发如何避免炸开', '顾客能否接受短刘海'],
            master: '适合希望轻盈、年轻、柔和但仍有个性的顾客。短刘海会暴露额头和眉眼，必须确认接受度；粗硬发要保留压住轮廓的长度，细软发要避免过度去量，旋涡明显时需顺应发流。'
          },
          design: {
            prompts: ['圆形骨架怎样分区', '刘海与耳周如何连接', '去量应放在哪里'],
            master: '先按头型建立紧凑圆形骨架，顶部保留可产生细弯的长度；刘海用不等长短点形成柔边，耳周收紧但不全部推平。去量集中在内部堆积处，表面保留完整度和光泽。'
          },
          review: {
            prompts: ['柔和感来自哪些具体动作', '短发怎样避免只剩“利落”', '这套原则如何用于男士短发'],
            master: '柔和感不是只靠卷，而来自圆形比例、细尺度纹理、非机械边缘和保留的微小延伸。短发也要设计线条的语气。'
          }
        }
      },
      {
        id: 'CASE-005',
        title: '湿感短鲍伯 · 直线张力',
        category: '短发',
        imageUrl: 'https://taoyouming308-ui.github.io/img/showcase_49_%E8%B6%85%E7%9F%AD%E5%8F%91_2026-06-14T09-27-53.jpg',
        focus: '直线轮廓、低体积、湿感质地',
        estimatedMinutes: 15,
        limitations: '湿感造型显著改变发量、光泽和贴合度，不能直接推断顾客自然干发状态。',
        guides: {
          observe: {
            prompts: ['轮廓线落在什么位置', '顶部体积高还是低', '脸周和后颈是否同一长度', '湿感如何影响束感与光泽'],
            master: '短鲍伯长度靠近下颌与后颈，外轮廓以直线和清晰切口为主；顶部压低、头发表面贴合，侧分发线明确。脸周有较长尖角，后颈发尾局部外翘。湿感让发束聚合并提高光泽。'
          },
          analyze: {
            prompts: ['低体积为什么仍有力量', '长尖角与短后颈形成什么关系', '湿感怎样强化设计语言'],
            master: '力量来自清晰直线、低重心和轮廓边界，而不是蓬松度；脸周长尖角与短后颈形成前后长度张力；湿感减少碎发和空气感，让线条、贴合和切口更突出。'
          },
          judge: {
            prompts: ['适合什么风格目标与维护习惯', '什么发质自然状态差距最大', '脸周尖角应怎样个性化'],
            master: '适合追求冷静、前卫、低体积表达，并愿意使用造型品的顾客。蓬松自然卷、粗硬发或不愿打理者，干发状态可能与参考差异很大；脸周长度必须结合下颌、颧骨和顾客接受度调整。'
          },
          design: {
            prompts: ['如何建立准确外线', '内部重量是否需要大量去除', '湿感造型的产品和方向'],
            master: '先在自然落点建立清晰外线和前长后短关系，内部保留足够重量支撑切口，只处理妨碍贴合的堆积。吹整顺着头型压低体积，使用轻湿感产品聚合发束；后颈外翘要主动设计，不是随意翻出。'
          },
          review: {
            prompts: ['“高级感”可以被拆成哪些事实', '造型效果与剪裁结构怎样区分', '如果顾客不做湿感，方案如何降级'],
            master: '所谓高级感应拆成清晰比例、克制体积、准确边界、统一质地和明确重心。参考图中的造型质地不能冒充剪裁效果，设计时必须同时给出自然状态方案。'
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
        prompt: '每天 20 分钟训练中，哪种安排更利于形成审美判断？',
        options: ['连续看 20 分钟漂亮图片', '观察事实、做出判断、说明理由、修改方案、复盘错因', '背诵风格名称', '只练自己最熟悉的发型'],
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
