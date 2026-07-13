# 九型风格与风格美学知识底座 V1

版本：0.1.0；运行时映射：`aesthetic-knowledge.v1.js` 1.4.0。

## 结论与边界

公开且可追溯资料稳定支持的是中文个人形象设计中的八型：少女、优雅、浪漫、少年、前卫、自然、古典、戏剧。“九型风格”不存在已确认的统一原始来源；市场上有拆分型、增补型、机构专有型和与九型人格混用等口径。

本 App 当前 DSS 九型（自然、法式、韩系、日系、都市、极简、少女、中性、先锋）是发型作品归纳体系，不等同于中文个人形象八型，也不等同于 Kibbe 或九型人格。三类体系通过 `school id` 并存，禁止按同名直接合并。

中文第九型在获得准确名称、教材或机构来源前保持 `provisional`，不参与自动评分。

## 总目录

- `VIS` 视觉基础：感知组织、点线面体、比例、重心、节奏、秩序、留白、对比、质感、色彩、构图。
- `PER` 人物分析：图像条件、头脸、五官、头肩颈、体型姿态、个人色彩、视觉印象、需求限制、设计矛盾。
- `STY` 风格识别：体系史、流派版本、连续维度、风格 DNA、主辅混合、地域年代、近邻辨析、反例。
- `DES` 设计语言：目标、形态、比例、轮廓、重心、纹理、色彩、约束和决策解释。
- `HAI` 发型映射：长度、轮廓、层次、体积、刘海、纹理卷度、色彩、技术路径和安全可行性。
- `TRN` 训练方法：事实观察、证据标注、AB、排序、找差异、去标签、反例、变量实验、设计推演、对话和复习。
- `SCR` 评分：观察、证据、概念、因果谨慎、设计推理、替代方案、约束、表达、不确定性和迁移。

## 证据等级

- A：标准、系统综述、元分析、原始同行评审研究。
- B：原始著作、创始机构材料、权威专业教材。
- C：博物馆、高校、协会、职业教材中的行业采用证据。
- D：专家实践、结构化门店数据、内部实验。
- E：媒体、自媒体、电商、培训宣传；只用于发现线索。

创始机构资料可以证明“该流派这样定义”，不能单独证明分类科学有效。

## 条目合同

每条知识必须包含：ID、标题、领域、状态、版本、定义、观察指标、机制、设计应用、发型映射、训练、评分、原子 claims、来源和治理。

状态：`draft → sourced → expert_reviewed → calibrated → published → deprecated`。

设计链：`目标 → 证据 → 设计动作 → 预期效果 → 约束/风险 → 替代方案`。

## 安全规则

- 只描述可见形式、视觉印象和设计假设，不由外貌推断真实性格、道德、智力、健康、职业、阶层、消费能力或性取向。
- 类型不是医学或心理诊断；评分对象是学员的观察和推理，不是人物长相。
- 单张图片记录角度、光线、镜头、妆容、姿态和遮挡造成的不确定性。
- 未获权利的图片不进入训练集；书籍只保存书目、定位和原创摘要。

## 主要来源

- [中国丝绸博物馆：八类常见女性穿衣风格](https://www.chinasilkmuseum.com/gskt/info_319.aspx?itemid=31010)
- [Colour Me Beautiful UK：六种 style personality](https://www.colourmebeautiful.co.uk/blog/shake-up-your-style/)
- [Color Me Beautiful Japan：六种 Fashion Type](https://www.cp-cmb.jp/fashiontype.html)
- [Penguin Random House：David Kibbe 与 Image Identity](https://www.penguinrandomhouse.com/authors/2280872/david-kibbe/)
- [CIE Colorimetry, 4th Edition](https://www.cie.co.at/publications/colorimetry-4th-edition)
- [ISO/CIE 11664-4:2019](https://www.iso.org/standard/74166.html)
- [面孔可信度印象准确性元分析](https://pubmed.ncbi.nlm.nih.gov/34609231/)
- [First Impressions From Faces 综述](https://pmc.ncbi.nlm.nih.gov/articles/PMC5473630/)

完整来源元数据见 `data/style-aesthetics-sources.v1.json`；机器条目约束见 `schema/knowledge-entry.schema.json`。
