Warning: truncated output (original token count: 84465)
Total output lines: 2823

## 2026-11-22 · 发型审美训练：肩颈碰撞与后枕重心

- 新增 `aesthetic-2026-11-22`：训练正面锁骨柔发偏好与侧后发尾压肩、后枕重心偏低、扎发功能之间的方案取舍。
- 同步原创 AI 虚构四视图、人物条件、一个核心 A/B 题、六段完整参考答案和五项无作答自查；明确区分图片事实、案例设定、技术推测和现场确认。
- 继续沿用现有聚焦 PR；仅更新审美训练 feed、图片与公开交接记录，App 版本保持 v683，不修改顾客、财务、数据库、权限、业务同步或旧研习院。

## v683 · 2026-11-21 · 日报可从存档选原图

- 财务可在未锁账、无绑定原件的未入账日报中选取同店同日、已完成且未作废的存档原图。原图加载并人工预览确认后，直接绑定并回读保存结果，不需下载或重传。
- 后台再次校验权限、原图有效性和草稿版本，只新增原件链接和审核记录，不启动识别、不改已填金额、不自动入账。按现有财务流程单独核对和入账。

## 2026-11-21 · 发型审美训练补齐：分缝、镜头比例与动态脸周

- 保留既有42条训练，追加 `aesthetic-2026-11-19`、`aesthetic-2026-11-20`、`aesthetic-2026-11-21` 三个独立日期案例；同日重试使用原稳定ID，不用旧案例改日期。
- 三条分别训练可逆分缝结构、近距视频与真人三维比例、静止参考图与动态脸周轨迹。每条同步原创AI虚构四视图、完整人物条件、六段参考答案、五项无作答自查及透明审查记录。
- 仅更新审美训练 feed、图片与公开记录，App 版本保持 v683；不修改旧研习院、自由换算、顾客、财务、数据库、权限或业务同步。

## v682 · 2026-11-21 · 日报作废原图不再放行入账

- 日报只认本张草稿实际绑定、审核通过且未作废的原件；独立存档和未绑定附件不算有效原件。
- 未绑定有效原件且没有已核实电子来源时，页面直接提示「上传 / 重传正确日报」并禁用入账，仍可保存草稿。已核实电子来源和已入账日报保持原流程。
- 仅修改页面判断和提示，不改数据库、附件、金额和已入账账目。

## v681 · 2026-11-21 · 电子日报草稿按证据纠正（未上线）

- 把电子日报「补空白」和「核对并纠正」分开。财务可查看同店同日已核验的收银项目与草稿已填明细的差异，逐项勾选后只保存所选草稿字段。
- 草稿、来源或权限一旦变化，需要重新核对。不能安全对应的字段、合计、已提交或已入账记录不改；保留修改记录和来源版本，不自动入账。

## v680 · 2026-11-21 · 月报凭证按归档月份隔离

- 月报「从凭证上传库选择」和组合推荐只使用上传时明确归到该月的原件，票面跨月不会排除；新建关联也校验归档月份。
- 不猜测未归档原件的月份，不移动凭证或改账；已经保存的原件、历史关联和金额记录继续保留。

## v679 · 2026-11-20 · 月报凭证关联完成显示

- 月报佐证确认并回读成功后，凭证卡片采用与原已对应卡片一致的绿色，并标记「已关联月报」。同一栏目禁止重复关联，重新打开后恢复服务器保存的状态。
- 完成提示不再等待无关备用金报表刷新；保存前的旧请求不能覆盖较新的确认结果。失败、未知回执不显示完成，整图关联仍明确保留「逐笔对应待核对」，不等于已入账。
- 仅调整前端完成状态与交互，不改金额、审批、入账、凭证原图或已有关系；用户已同意检查通过后上线。

## v678 · 2026-11-20 · 凭证月报选项及旧页面兼容

- 恢复当前月报开支栏目与明细，并保留原逐笔关联。补充旧主页面加载新延迟组件时的能力检查，避免凭证区报错；新挂证功能需要用户方便时自行更新，原逐笔操作继续保留。
- 用户已同意备份及检查通过后上线。发布不修改账目金额、原凭证、审批或入账状态；实际线上状态以受保护发布及部署回读为准。

## v677 · 2026-11-20 · 凭证月报选项修复候选（未上线）

- 凭证「对应开支明细」补充当前门店、月份的电子月报开支栏目和明细；未指定独立核对原件时也可展示，不再只剩备用金逐笔明细。原件栏目与逐笔明细分组保留，已映射栏目去重。
- 月报栏目由财务核对整张原图后补充佐证，保存后回读确认。不改变金额、审批或入账状态，不把图内多笔付款自动标成逐笔已对应；原有历史关联保留。
- 空白金额显示但禁止挂证，避免未知被当成零；切换门店、月份或报告版本时阻止旧目标继续确认。月报读取不完整时明确提示，不悄悄隐藏。
- 独立分支准备；无数据库迁移、正式数据修复或生产部署。上线须另行确认并完成受保护发布与回读。

## v676 · 2026-11-20

- 本月全部开支凭证按批列出原文件，一次核对本批全部原件所属门店后上传，避免每张重复弹窗造成误以为上传无响应。单笔补传仍逐笔确认。
- 门店不一致、取消、切换月份/门店/账号会阻止尚未发出的文件；一次确认只适用于原文件清单及原批次，保留已保存结果且不自动重传。
- 未刷新的旧页面仍可按原方式逐张确认上传，避免更新中断当前操作。

## v675 · 2026-11-20

- 打开电子日报时直接加载当天已存档原图，宽屏并排对照，窄屏在表格前显示。首次创建日报时也自动带出同店同日的已存档照片。

## v673 · 2026-11-20

- 日报详情的待核对存档原图增加「误传作废」，可逐张确认作废并刷新当天原图状态。保留存档记录。

## v671 · 2026-11-20

- 日报单张原件、按月批量原图与电子日报上传前核对原件所属门店。已知表头、文件名或声明与目标门店矛盾时拦截写入。
- 普通、备用金与历史凭证明细上传统一核对来源门店；切换门店、月份或账号会停止未发出的上传，已归属其他店的同一凭证不能在当前店复用。

## 2026-11-20 · 同步读取排队优化准备（沿用主线 v673）

- 预约只在真正访问美管加时占用源请求锁，云端确认等待不再阻止客户档案读取；已到达的预约请求优先于下一笔客户读取。
- 客户等待统一受原105秒总预算限制，保留10秒单次读取与20秒落库余量；不改变预约、客户和日消费的定时频率。
- 旧预约脚本或异常协调状态时安全延期；保留续传、人工核查、退避队列、历史资料和自动出库关闭状态。仅三个运行代码文件纳入专用安全部署，不改App前端、数据库或凭据。实际恢复以受保护发布、运行指纹和客户云端内容回读分别验收。

## 2026-11-20 · 客户档案积压修复准备（沿用主线 v671）

- 将已实际运行的客户只读传输与协调版本合入最新隔离开发基线，保留现行预约、日消费和自动出库关闭状态。
- 增加有限、私有、身份绑定的年窗续传，跨日补窗后再次读取近期账单；云端档案和服务投影均成功才清理进度，失败保留原档案。保留预算、频率和预约优先级。
-57项新增合成测试与112项原同步回归通过，两路独立复核无阻断；v670 基线的完整共享校验通过（财务165/165），增加只替换客户主脚本及续传模块的四锁原子部署器。不重置人工核查队列，不改前端或数据库结构。此为准备阶段记录，发布、运行部署和云端回读分别验收。

## v670 · 2026-11-20

- 界面更新提示在准备完成后自动收起。同一版本的同一标签页不会重复提示。
- 「按月存档日报原图」顶部增加「批量删除误传原图」，可勾选存档清单或全选本次已存档的图片，确认后批量作废并保留原图与操作记录。
- 在可编辑的日报草稿顶部增加「自动填写报表」，从本门店当天已同步且通过核对的收银明细补填空格。来源缺失或冲突时提示财务核对。

<!-- academy-reviewed-inputs:8724d84e3df655532d155eaffb9da8b0f0070950541785bbf833f50f346d9c67 -->
## 2026-11-20 · Reviewed academy publication candidate (App version: v669 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 8c1d38ccf225c22109169d4a952474800f6f9851.
- Dates: 2026-11-20. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## v669 · 2026-11-19

## 2026-11-19 Appointment sync recovery

- Restore a single launchd appointment schedule with exact runtime backups.
- Reject malformed/partial sources, atomically replace each store/day, make retries idempotent and preserve change audit.
- Keep the existing App shell, source appointments and separate consumption task unchanged.

- 修复界面资源检查结束后仍显示“准备中”的问题；检查完成、下载中、等待切换、失败及等待过久分别提示。
- 三入口共用可收起提示，当前版本在同一浏览会话内记住“稍后”；主应用不再叠加第二条更新按钮，失败仍可重试。
- 保留保存后关闭全部本站页面再自然切换的流程；Chromium/WebKit 的390/1366尺寸、跨页面收起、旧输入保留与多窗口版本隔离回归通过。

## v668 · 2026-11-19

- 修复部分单月 XLSX 使用 XML 命名空间前缀后无法找到工作表的问题；当前页、月报显示与核对原件共用兼容读取。
- 兼容工作表关联别名及包关系/类型标签，原件留存和核对继续读取原始字节，不改变金额、公式或入账状态。
- 新增合成命名空间回归和完整上传接口回归；向里7月原表本地271个单元格、97个公式独立核对一致，原文件哈希不变。

<!-- academy-reviewed-inputs:8b97b2649a442e65f53b3d4083506f007c4a1b0b6a512259d454fdee32fefe37 -->
## 2026-11-19 · Reviewed academy publication candidate (App version: v667 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main e400816aceace3120cb1d18083bf30eddb0fe6d3.
- Dates: 2026-11-19. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-11-18 · 发型审美训练：动态肩线与稳定底线

- 追加稳定案例 `aesthetic-2026-11-18`，训练把真实长度、自然落态和肩线/衣领/包带碰撞分开判断，避免为一张正面照片直接剪出永久的左右长度差。
- 同提交加入原创 AI 虚构教学四视图、六段条件式参考答案、五项无作答自查复盘和透明审查记录；只修改训练内容、图片与交接记录，应用版本保持 v667。

## 2026-11-17 · 发型审美训练：银白分布、视觉发量与维护周期

- 追加稳定案例 `aesthetic-2026-11-17`，训练把前区银白造成的视觉轻薄、真实分区密度、后区深色重量和顾客愿意承担的盖白周期分开判断，避免用统一深染或全头打薄掩盖比例冲突。
- 同提交加入原创 AI 虚构教学四视图、六段条件式参考答案、五项无作答自查复盘和透明审查记录；只修改训练内容、图片与交接记录，应用版本保持 v667。

## v667 · 2026-11-17 · 加载修复，已获发布授权

- 修复登录验证期间其他页面更新同一凭据的时间信息时，当前页面一直等待的问题；真实身份切换仍须重新验证，保留未保存表单和登录凭据。
- 登录验证及预约客户只读请求增加覆盖响应体的15秒截止；失败可原地重试，不自动重放登录、保存或其他写操作。
- 发型师和助理共用本店在职目录的一次请求及60秒内存缓存；增加错误状态、重试和旧回包隔离，保留原档案人员值，不把失败当作“暂无助理”。
- 新建分析不再预读隐藏的任务和补开单；切到“我的任务”仍读取最新内容。恢复登录文字和按钮提高对比度及点击尺寸。
- 合成 Chromium/WebKit 手机尺寸、超时/乱序/跨页身份与原有业务回归通过；尚未真机验收、推送、合并或发布。首次静态资源网络等待仍需后续按需加载专项评估。

## v666 · 2026-11-17

- 修复原图金额已识别但因付款状态不明而未参与推荐：严格区分原文订单/转账金额与付款金额，前者作为只读推荐线索，显示“付款待核对”。金额相符、商品名称和原文日期共同参与排序；单选与多选顺序、搜索保持一致。原付款金额、日期、自动匹配规则和账目不变。
- 月报电子费用格统一从本店已上传原图选择，保留既有原图关联。关联失败、识别不完整及汇总/聊天材料继续可见；月报仅补凭证支持多选这些材料，仍要求人工核对、合计一致及来源快照保护。单笔交易要求继续执行。
- 兼容Safari月份文本输入“8月”，使用明确的当前账期年份规范为2026-08；空值保持空值、跨月仍拒绝，未猜填原图付款日期。
- 新增59.90真实元数据只读复现、纯排序与390/1280实际页面回归，覆盖多选搜索、完整上传库、失败保留、汇总材料、8月提交及不把订单金额当已付。原单张、整组、月报、备用金与桌面补图回归通过。无生产业务数据写入或数据库迁移。

## v665 · 2026-11-17

- 备用金逐笔明细及月报凭证库新增组合推荐：单张金额一致和接近的推荐保留，同时展示多张凭证合计一致的组合。按分精确计算，优先参考用途和日期；未知金额、跨月和重复原图不用于自动组合，亦可手动勾选与核对金额。
- 逐张预览、核对日期及用途后确认整组。合计必须等于当前开支金额，整组在同一数据库事务保存；保留既有金额、原件、审核状态和旧关联，失败整组回滚，重复操作安全返回。推荐不自动关联或入账。
- 增加两个仅服务端可调用的事务包装函数，复用既有财务权限与关联接口，校验门店、原图、目标、并发关联和月报来源快照。无表、金额、原图或审核结构变更。
- 新增纯金额/推荐、实际 API、隔离 PostgreSQL17 和390/1280实际页面验收，覆盖170.30的两张/三张组合、单张保留、人工更正、未知金额、跨月/重复/其他关联、部分重试、第二张失败回滚与切月隔离。

## 2026-11-17 Customer fairness candidate (not deployed)

- Preserve same-batch history progress across bounded readiness waits while releasing shared session/source locks.
- Build requests from a single locked session snapshot; stop uncertain responses without replay.
- Add fairness/transition safety tests and quiescent cutover/trigger restoration plan; no production cadence or frontend change.

## 2026-11-17 Customer coordination candidate (not deployed)

- Bound and pace customer source reads, yield to daily/booking activity without lock waiting, preserve existing shared-lock contracts.
- Track deferred work separately from failures, deduplicate compensation, emit age/persistent-source alerts, and finish all modes with released locks.
- Add offline integration coverage to mandatory existing gate; no frontend, production scheduler or financial changes.

## 2026-11-17 Customer source transport and bounded history recovery

- Restrict customer reads to verified-TLS source targets with compatible request headers; reject redirects and redact subprocess credentials from error strings.
- Split history reads into <=365-day windows with continuity, identity and failure checks; preserve incomplete data and retry state.
- Eliminate temporary multipart-body cleanup failures; yield a JSON/HTTP 429 rate-limited batch, including search, instead of immediate retries; reject missing/non-success HTTP status.
- No frontend version change, source business edits, financial posting or scheduler change.
## v664 · 2026-11-17

- 补齐月报产品进货、零售产品成本、备用金分类及杂项明细的凭证库入口；可选择同店已上传原图，金额一致及接近优先推荐，上传月份不限制原账期。
- 逐图预览并人工确认后，复用既有仅补凭证接口；保留金额、旧关联、审核状态，不重复上传或识别。备用金总额仍先打开明细单。
- 凭证库入口同时执行既有凭证查看与上传权限校验，继续限定当前门店、月份、报表及具体明细。
- 新增实际分类/API及390/1280页面回归，覆盖四类明细、未知识别、失败重试、重复关联、越权拒绝及切月隔离。

<!-- academy-reviewed-inputs:951c7fd3f64ea877cf0086c9ecf63494ae20f64f9af7b4b32530e4974eabb5e5 -->
## 2026-11-17 · Reviewed academy publication candidate (App version: v663 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 1cb33fd7b75dd0923b699fe33785ff278d85dd10.
- Dates: 2026-11-17. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

# Booking transport recovery · 2026-11-16

Restore the existing exact Meiguanjia appointment read endpoints with verified TLS and source-only direct routing; preserve cloud signatures, original appointments, cadence, and failure cleanup protection. Runtime recovery verified for November17; UI acceptance and protected merge remain pending.

## 2026-11-16 · 发型审美训练：眼镜、露耳参考与耳前桥接

- 追加稳定案例 `aesthetic-2026-11-16`，训练把露耳超短鲍伯参考图拆成边界、临时别耳、镜腿接触、后枕支撑与维护成本，避免为静态照片直接剪掉太阳穴和耳前安全长度。
- 同提交加入原创 AI 虚构教学四视图、六段条件式参考答案、五项无作答自查复盘和透明审查记录；只修改训练内容、图片与交接记录，应用版本保持 v663。

## 2026-11-15 · 发型审美训练：把湿感参考图翻译成干发结构

- 追加稳定案例 `aesthetic-2026-11-15`，区分湿感产品、强侧分与摄影形成的束条效果，和顾客拒绝产品、只肯无产品吹整三分钟时真正可持续的剪裁结构。
- 同提交加入原创 AI 虚构教学四视图、六段条件式参考答案、五项无作答自查复盘和透明审查记录；只修改训练内容、图片与交接记录，应用版本保持 v663。

## v663 · 2026-11-15

- 修复月报从桌面选择已上传原图后无法保存补充凭证：同店同哈希原图直接追加当前单元格凭证关联，已关联时安全返回，不重复上传、登记或识别。保留原金额、原图、审核状态和其他关联；继续执行既有财务权限、报表及单元格归属校验。
- 补凭证预览明确说明金额保持不变；补充 API 和 390/1280 实际文件选择器回归，覆盖失败重试、原图复用与金额不变。

## v662 · Petty total, detail sheet and individual receipts

- Monthly petty-cash totals and voucher badges open the detail sheet first, including templates with a trailing month label. Each detail then opens only its own receipt or the upload-library selector; recommendations use that detail amount. Other monthly expenses retain direct original viewing.
- Exclude the petty monthly aggregate from new manual options and automatic association. Keep existing aggregate links as month-level history, separately flagged rather than redistributed or counted as per-detail evidence.
- Rebuild the detail sheet on both fresh reads and cached finance-page redraws, so refreshes cannot remove the per-row evidence actions.
- Include legacy formal voucher links and exact historical pages outside the batch library, after a fresh scoped read and matching record id/date/amount; whole-month bundles stay excluded from per-row originals.
- Cancel closed monthly reads and superseded detail requests so late replies cannot replace the currently selected detail.
- Keep source/draft/formal/history rows distinct, amounts and posting unchanged. Single-detail selection requires transaction evidence and explicit attestation; original links remain protected. Synthetic phone/desktop regression covers the complete hierarchy and exact one-row association. No backend/schema or production-data changes.

## v661 · Monthly originals and existing voucher library

- Open associated originals directly from monthly amount cells and voucher badges, with images before amount editing controls. Keep all existing evidence and history.
- Add searchable, current-store/month uploaded-voucher selection inside the same amount drawer. Preview the original and explicitly confirm a single association through the established audited endpoint; unknown dates/months remain blank and financial amounts do not change.
- Recommend exact amounts first, then the smallest absolute amount differences; keep unknown amounts last and show exact/difference labels. Respect manually corrected amounts and retain this order during search. Ranking never confirms an association.
- Preserve existing linked vouchers, scope/source guards, no-op save detection and no forced refresh. Synthetic phone/desktop regression covers the complete flow. No backend/schema or production financial data changes.

## v660 · Evidence-bound voucher acceptance corrections

- Select full printed dates by their original labels, preserving payment, order, creation and completion roles; reject missing years, shipping dates and equal-priority conflicts.
- Distinguish drinking water from utility water, keep merchant-only categories uncertain, and retain bank fee summaries as month-only evidence. Reject contradictory store-split arithmetic and product matches without quoted item evidence.
- Clarify already-paid order recognition without a fabricated payment date. Preserve raw model responses, historical/manual results and all financial records. Real acceptance results remain private; publication gates and deployment are separate.

## v659 · GPT-5.6 voucher recognition and configurable APIs

- Use GPT-5.6 Sol for new expense recognition, supply store expense categories, preserve printed date roles, and fix broad category contradictions, literal telecom matching and concurrent duplicate associations.
- Add re-recognition to every image. Preserve originals and all attempts; keep new candidates for confirmed/associated images separate from human results, approvals and financial records.
- Add current-store API/model settings for OpenAI and supported compatible providers. Encrypt custom credentials, prevent cross-provider key reuse, test synthetic image/date/amount output before saving, and guard concurrent setting changes. Financial amounts and posting are unchanged.
- Extend pure/API, PostgreSQL 17 and mobile browser validation; require unchanged full gates, protected CI and live acceptance before publication.

## v658 · Voucher date and monthly display corrections

- Keep the exact printed calendar day when OCR returns a complete date and time. Recover affected unassociated candidates from their existing recognition result, without rewriting or replaying stored evidence; partial years and invalid dates remain unknown.
- Read the latest monthly report with a bounded query instead of the complete-pagination helper. Refresh original-image buttons in the existing monthly cells after associations change, retaining report/source label and effective-amount checks across different files.
- Add focused API, PostgreSQL and browser regressions using synthetic values, including immutable raw recognition, service-only timestamp validation and updates without rerendering the monthly sheet. Financial amounts, approvals and posting remain unchanged.

## v657 · All-expense voucher matching

- Extend the existing voucher panel to all monthly expense categories and source petty details. Show linked originals in existing monthly cells and source review; verify labels and current amounts when projecting across different source files.
- Recognize document type, expense category and independent payments; preserve explicit month-only payroll/advertising totals as summary evidence. Automatically associate only reliable unique matches, with manual handling for exceptions and audited reversible corrections. Financial amounts, approval and posting remain unchanged.
- Separate failed recognition from manual exceptions and add failed-only recovery. Process up to three lease-protected images concurrently while preserving previous successful/manual results and original files. Add scoped API, isolated database and mobile browser regression coverage.

## 2026-11-14 · 发型审美训练：半干侧睡与次晨恢复

- 追加稳定案例 `aesthetic-2026-11-14`，把晚洗半干侧睡、分区发质和两分钟晨间整理纳入松卷短鲍伯的结构与卷度取舍。
- 同提交加入原创 AI 虚构教学四视图、六段条件式参考答案、五项无作答自查复盘和透明审查记录；只修改训练内容、图片与交接记录，应用版本保持 v656。

## v656 · Excel detail compatibility

- Read valid prefixed SpreadsheetML and absolute internal worksheet/table relationships through an in-memory compatibility copy. Preserve original upload bytes and SHA-256; distinguish invalid archives from unsupported structures.
- Preserve explicit ISO date cells as text before strict date validation, avoiding ExcelJS serial-date misinterpretation. Prioritize an unambiguous expense/credit column; leave multiple choices and debit/income/balance columns unmapped.
- Regression covers prefixed/default XML, nested table paths, ISO dates, unchanged zero/text/formula handling and mobile mapping. Independent read-only comparison of three source workbooks checked 864 cells without differences; originals are not committed or imported by this change.

## v655 · Petty-cash matching detail import

- Add current-store/month XLSX and UTF-8 CSV preview, sheet/header/column mapping, invalid/duplicate exclusion and explicit selected-row confirmation. Preserve private originals and append matching-only drafts; no financial posting or manual record overwrite.
- Recommend matching drafts/current/history items by amount, date and summary. Ambiguous choices remain manual, and summary/multiple-payment candidates cannot be forced into one expense.
- Use the existing server-only OpenAI key for bounded structured image candidates, preserving Codex when no key is configured and legacy non-batch OCR. Require original text/confidence, keep unknown fields empty and expose provider provenance.
- Preserve status/forms on transient read failures, isolate late responses by store/month/session and resume pending polling. Screenshot-window server logs were successful; the client network failure itself is not conclusively diagnosed.

## v654 · 已入账日报原图留档状态

- 成功入账的日报原图显示“原图已存档”，不再重复提示核对，并从月历待核对天数中排除；未入账日报继续提醒。
- 原图详情保留查看入口；入账后的未审核附件只展示留档，不伪造审核通过。缺少原件、读取失败和金额异常仍如实显示。
- 仅更新显示规则，保留金额、原件、财务审核及修改历史。浏览器回归覆盖已入账/草稿切换、待核对计数与无业务写入。

## v653 · Codex recognition for petty-cash batch vouchers

- Route pending batch images through the authenticated Codex bridge, with structured date/actual-paid candidates and original-text evidence. Ambiguous, summary or multiple-payment images stay manual; no automatic approval, association or posting.
- Keep unknown dates and amounts blank, display Codex review warnings, refresh untouched form fields and preserve manual edits. PDFs remain manual-review originals.
- Preserve existing daily recognition and non-batch OCR paths, with a separate supported voucher-model default and bounded background worker tasks.

## v652 · Hide monthly bulk voucher upload

- Hide and disable the monthly report's bulk photo/PDF upload card at the user's request. Keep workbook uploads, existing voucher viewing and each expense's own evidence upload available.
- Clarify the upload copy and verify keyboard/phone/desktop behavior. This frontend change does not alter financial amounts, API permissions or daily-original management.

## 2026-11-13 · 发型审美训练：衣领与肩颈比例的长度取舍

- 追加稳定案例 `aesthetic-2026-11-13`，区分低领参考图的露颈效果与本人高领、帽领、后颈粗密及八至十周维护之间的冲突。
- 同提交加入原创 AI 虚构教学四视图、六段条件式参考答案、五项无作答自查复盘和透明审查记录；只修改训练内容、图片与交接记录，应用版本保持 v652。

## v652 · 月报上传后核对原件（2026-11-13）

- XLSX 上传后将原件数值、缓存公式和月份与保存结果逐格核对，差异列出单元格及原件/保存值；核对状态随月报再次打开显示。
- 核对失败、缺少公式结果或不支持完整核对的格式标为待核对。草稿保存成功后的核对/刷新失败保留成功回执，避免重复上传。
- 上传仅保存草稿和私有原件，保留旧版；自动核对不修改金额、不自动审批或入账。现有手工修改与上传原始一致性检查分开。
- 增加独立 XML、完整 API 和浏览器回归，并验证 7–9 月原件 815 个数值与 295 个公式。

## v651 candidate · Preserve zero-valued Excel formula caches

- Preserve explicit cached zero results when importing original monthly workbooks. ExcelJS's copied value can omit zero; the result accessor retains it.
- Display numeric zero correctly and keep genuinely missing formula caches unknown. Add reproducing shared/non-shared zero tests and optional independent full-source numeric/formula verification.
- Follow-up to v650 live acceptance; old report versions and original bytes remain retained. No automatic review, confirmation or posting.

## v650 candidate · Correct monthly workbook formula display

- Translate Excel shared formulas per cell when importing monthly workbooks; skip merged aliases that duplicate a financial value.
- Preserve the original cached formula result in an unchanged monthly report. Recalculate dependent formulas only after an input changes, so existing July–September previews recover without a financial write.
- Verify the importer against the exact July, August and September source workbooks and add a regression for cached legacy reports. Existing reports should be reimported append-only after publication before financial edits, because their stored formula references remain legacy data.
- Local candidate only. No production upload, accounting revision, posting or deployment in this change.
## v649 candidate · Preview, straighten and void daily originals

- Enlarge and rotate each photo before confirming its upload date; preview rotation does not alter original bytes.
- Restore left/automatic/right rotation and persist the chosen display direction for each archived original inside its electronic daily report.
- Let authorized report editors select multiple excess originals and void them with a reason. Voided photos disappear from normal report reads and new signed-link requests, while original bytes, upload trace and void audit remain. Financial cells, posting and account status are untouched.

## v648 candidate · Show archived daily photos inside electronic reports

- Embed each completed, authorized original image directly in its matching electronic daily report, with an in-page zoom viewer and a return-to-report action after batch upload.
- Preserve private short-lived URLs, store/date isolation, independent unreviewed status and all existing financial gates. No reupload or accounting mutation.

## v647 local candidate · Complete daily originals and monthly expense source views

- Keep archived-original status and refreshed links visible after saving a daily draft, with honest read-failure messages and preserved unsaved edits.
- Add finance-only, on-demand source views for monthly originals and expense details, preserving raw values, formulas, provenance and unreviewed evidence boundaries.
- Local candidate only. No deployment, financial changes, automatic posting or repeated original upload.

# Unreleased v647 · Daily archived original read bridge

- Show independently archived daily originals in the existing daily calendar and detail, with a direct short-lived original link and a clear “原图已存档 · 待核对” status. Missing and unavailable originals remain distinct.
- Reuse existing daily month/detail reads, including the employee read-only view. Financial attachments, source pointers, amounts, review/recognition and posting gates stay unchanged.
- Whole-page browser coverage checks 26/26/25 archived dates, all 77 correct-date links, direct private image opening, unknown/legacy responses and employee privacy. Local validation is not production deployment or accounting verification.

<!-- academy-reviewed-inputs:29ae0f9f00a3696b4e53165743aa8c0dde227361ad4ff446d66980b4fa6cd43c -->
## 2026-11-13 · Reviewed academy publication candidate (App version: v646 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main fcef3cebbe2ff8d7eea9227d5d23c08fa0867704.
- Dates: 2026-11-13. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

# Unreleased v646 · Monthly verification originals

- Register one intact XLSX as the verification original for several explicit month/worksheet mappings, preserving worksheet-name whitespace and all older originals.
- Show “新版核对原件” and “原件已更新，金额未调整” separately from monthly amounts. No parser, financial save, source-pointer replacement, acceptance or posting runs through this path.
- Keep upload/selection requests for readback and explicit same-request recovery; suppress late results after store/account changes. Publication and real authorized registration require separate root verification.
- Add private immutable source/completion/selection sidecars with existing scope/capabilities, exact-byte verification, canonical hash reuse, 404-only recovery and atomic 1–12 month selection receipts. Focused real-ZIP API, isolated PG17, frontend and frozen-lock API type checks passed; full publication gates and live acceptance remain pending.
- Permit explicit fresh month bindings after a confirmed selection conflict and exact-request not_found readback, reusing the completed original. Unknown responses retain their original request; no reupload or selection write occurs while refreshing bindings.
- Keep the new source-only panel inactive in the employee shareholder iframe, preserving the existing authorized report views and staff API boundary. The original staff visibility/privacy regression passes without modified assertions.
- Load auxiliary originals only after an explicit view/refresh or source registration action, with the primary monthly overview ready. Startup, rendering and scope changes retain an honest unread placeholder without extra requests. The unchanged original monthly-summary/startup/session/shareholder tests and new on-demand coverage passed in a 13-test targeted batch.

## 2026-11-12 · 发型审美训练：深色发重新翻译浅色参考图（v645 不变）

- 新增 `aesthetic-2026-11-12`：训练浅米棕逆光参考图的通透感遇到自然深色、中粗发、后区较密、不染不烫与三分钟整理时，如何区分颜色、光线、结构和造型贡献。
- 同步原创AI虚构女性四视图、六段资深基准答案、普通光/侧逆光/深浅衣着背景验证及首次洗后/第四周/第八周验收、五项未评分复盘；未改 App 代码、版本、旧研习院、自由换算或业务数据。

## 2026-11-12 · Allow longer original-photo uploads (App version: v645)

- Original-photo archive uploads and explicit same-request resumes now wait up to 300 seconds for the server response. Large originals could otherwise outlive the previous 90-second client wait and appear uncertain after the server completed them.
- Only these two upload waits changed. Read/encoding deadlines, original bytes, request identities, uncertainty handling, manual recovery and cancellation remain intact; no automatic resend or financial-data changes.
- Current owner: Codex. Last synchronized base checked: github/main cc8a0c4c6c5618f648fd4fc498b3f79d9f95a2be; clean isolated branch and complete local backup verified before edits. The separate unpublished historical-import candidate labelled v645 must advance beyond the published version before any later release.
- Focused batch runner, archive API mocks, offline Chromium batch browser and version/integrity/handoff checks passed. Complete pre-push and exact-head protected CI remain required. This client change needs no schema or backend deployment; no live upload or financial posting was performed during validation.

## 2026-11-12 · Resume independent original archive (App version: v644)

- Fresh github/main 46e7219c is included. Isolated resume worktree preserves all other dirty candidates; complete local backup verified before edits.
- Align archive migration filename with existing production history 20261112055108; SQL bytes are unchanged. Register archive regression tests in the shared finance gate.
- 77 original handwritten dates independently reviewed: July 26, August 26, September 25, no duplicate dates. Missing supplied dates remain unknown, never zero or assumed rest days.
- Latest user-specified monthly workbook is preserved separately; this release does not modify monthly values, financial drafts or posting rules. Preserve exact live catalog dependency bytes in API deployment.
- Production API/frontend publication, real authorized upload and per-file hash/date readback remain pending. No financial posting.

# Unreleased v644 independent original archive

- Store month/date original photos without changing, creating or replacing financial daily records. Posted, locked and missing dates are archive-only, not automatic ledger links.
- Narrow existing service-role RPC; append-only reservations/completions; private signed views and current per-store capability enforcement.
- Exact request/hash binding, create-only writes, explicit same-file recovery only after definitive missing-object status, owner pending visibility after reopening. No uncertain-object cleanup.
- Frontend date previews, daily-detail entry with unsaved guard, cancellation and account/store/month scope controls. No automatic OCR or extra model call.
- Final v644 validation passed: API synthetic mocks; batch runner; isolated PostgreSQL reservation/concurrency/post-lock capability-revocation tests; four isolated browser suites (archive privacy/recovery, per-item vouchers, batch vouchers, monthly photos); repository version/integrity/handoff/smoke; existing monthly scope/matching, care/hair/customer regressions and 42 Python cases. Targeted safety re-review passed.
- SQL authority and financial sentinel fixtures are synthetic, not deployed-schema evidence. Actual storage/production acceptance remains pending. Candidate remains local; no production action performed.

# Unreleased v643 upload candidate

- Explain the photo-only Word bundle error with the correct existing archive and per-expense paths; no automatic resubmission.
- Add date-confirmed batch originals for existing editable daily drafts only. No amount or financial record changes.
- Verified existing expense-binding and batch-matching static tests, store/report scope, isolated per-item and batch-voucher/monthly-photo browser regressions, and 42 sync/keepalive/customer synthetic cases. New batch: 61 synthetic assertions plus an isolated 390px browser pass covering date previews, two uploads, confirmed-date refusal, lost-response freeze, cancellation and store change.
- Not deployed. Actual production files and classification remain untested; confirmed/absent daily reports are explicitly unsupported.

<!-- academy-reviewed-inputs:0f5b273f04cdf17553b65f400ac12814521df9c60c5608840bd4a95922475165 -->
## 2026-11-12 · Reviewed academy publication candidate (App version: v642 unchanged by academy)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main e76e44331c9a5dfa5e58cf108a28de0521d566e1.
- Dates: 2026-11-12. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:b46324872ab727ebad1d1950a1a76816e3a854c3258f03dc0bdedfb0978e28ab -->
## 2026-11-11 · Reviewed academy publication candidate (App version: v641 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 3e3a91de5c663a3e5615b70dc92b42bd5aab73e2.
- Dates: 2026-11-11. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:e10aee52d0c02dd42524eead570688af58f3c0f5fa199756e09c480f13b539d6 -->
## 2026-11-10 · Reviewed academy publication candidate (App version: v641 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 427131b5a299b21c5b89a00a7543af08fc741ae9.
- Dates: 2026-11-10. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:f69ecbf680ec3bc8aaa6c37bf130781ceb7dcf5aedb1f6690b47753c633dc417 -->
## 2026-11-09 · Reviewed academy publication candidate (App version: v641 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 5a31e6090a78a16338305c2999782e1cc0994287.
- Dates: 2026-11-09. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-11-09 · 发型审美训练：头盔与耳机后的短发恢复力案例（v641 不变）

- 新增 `aesthetic-2026-11-09`：训练男性韩式参考图的露额、贴侧与后区饱满，遇到长脸比例、太阳穴覆盖、头盔通勤、包耳耳机、两分钟整理及八周修剪周期时，如何在照片完成度与真实恢复力之间取舍。
- 同步原创AI虚构男性四视图、六段资深基准答案、自然/正式/头盔后/耳机后四状态验证及首次洗后/第三周/第八周验收、五项未评分复盘；未改 App 代码、版本、旧研习院、自由换算或业务数据。

## 2026-11-08 · 发型审美训练：潮湿环境双状态案例（v641 不变）

- 新增 `aesthetic-2026-11-08`：训练门店干燥镜前状态与潮湿通勤后的真实落态冲突时，如何把吸湿反应、混合自然弯和三分钟整理纳入同一结构。
- 同步原创AI虚构人物四视图、六段资深基准答案、干燥/微湿/真实通勤三层验证及首次洗后/第四周/第八周验收、五项未评分复盘；未改 App 代码、版本、旧研习院、自由换算或业务数据。

## 2026-11-08 · 八步设计、六区执行与完成复盘（v641）

- 八步人物设计后新增刘海、顶、耳前、耳后、中、底六区；每区可手填当前问题、目标、具体动作与完成核对点。
- 剪烫十大流程按本次项目选填，完成复盘记录已达成、待调整和下次重点；员工手填与 ChatGPT 导入共用同一结构。
- 发质分析表新增本次设计入口，核对明确预约后复用客户设计档案，返回保留未保存的发质表。
- 新字段随每次保存追加快照，原始及完成照片继续直观展示；旧八步和旧五区烫发记录保留原格式，不补造技术或完成结果。
- 对已有六区的档案保护旧客户端保存，避免遗漏字段冲掉当前执行记录；保留草稿并提示更新，不强制刷新。

## 2026-11-08 · 当前方案、完成效果与手机看图（v640）

- 每次到店只展示一份当前最终方案，不再铺开过程版本、数量及版本号；历史分析与照片在后台完整保留。
- 设计思路在原始照片下固定显示完成效果区域；尚未上传时显示明确提示，已上传的正面、侧面、背面完成照直接铺开缩略图。
- 手机大图的关闭按钮避开顶部状态栏，支持安全区域、滚动固定及44像素触控。
- 本次服务最新版若未带完成照，可显示同次最近保存的完成图库并标明来源版本；不借用其他到店记录，不改变历史快照。

## 2026-11-08 · 客户设计思路与照片历史（v639）

- 预约「查看方案」及「客户档案」新增设计思路，整体轮廓、发根毛流优先展示，八步基础判断、设计优化与调整理由逐项对照。
- 原始、完成及参考照片分类展示，可打开大图；员工可直接填写、上传和保存，无需使用 ChatGPT。
- 每次保存追加独立版本，保留到店日期、状态、作者、原图与旧设计；并发更新保留草稿并提示重新核对，不覆盖历史。
- 私有照片使用受控短期链接；ChatGPT 导入按客户、预约及短时授权限定范围。保留原有客户备注、套餐、消费及预约同步逻辑。

<!-- academy-reviewed-inputs:5feb1e3c6d831a197bd6ab738cb6e046149dff84b64be4c10b9b696efe0eb73f -->
## 2026-11-08 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main a074388d42ad21a2693f5645a26034e2fde087f0.
- Dates: 2026-11-08. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:b8ab0d324fc11df97385fdb3de7e37c42dfb07254277a19cbb87a6fbe8410a4b -->
## 2026-11-07 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 9c8072fdb6218b04352a0ae7ba7812fdabc2bc57.
- Dates: 2026-11-07. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-11-07 · 发型审美训练：相邻风格与场景切换案例（v638 不变）

- 新增 `aesthetic-2026-11-07`：训练“减龄但不装嫩、工作专业、周末松弛”发生相邻风格冲突时，如何把稳定结构和可变细节分开设计。
- 同步原创AI虚构人物四视图、六段资深基准答案、工作/周末/低扎三状态及首次洗后/第四周/第八周验收、五项未评分复盘；未改 App 代码、版本、旧研习院、自由换算或业务数据。

## 2026-11-06 · 发型审美训练：分阶段适配参考图案例（v638 不变）

- 新增 `aesthetic-2026-11-06`：训练参考图即时相似度、前区旧漂与后区健康的混合孔隙度、低马尾、高领碰撞及三分钟整理发生冲突时，如何在一次剪烫与分阶段设计之间取舍。
- 同步原创AI虚构人物四视图、六段资深基准答案、四种使用状态及首次洗后/第四周/六至八周验收、五项未评分复盘；未改 App 代码、版本、旧研习院、自由换算或业务数据。

<!-- academy-reviewed-inputs:985027dc0aeb844f4b72e5f49c083038298a609773a8b6d288bd09ba57b73a38 -->
## 2026-11-06 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 7e5eadb4e69b33b0e4be71642aebd2f0822eefc6.
- Dates: 2026-11-06. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-11-05 · 发型审美训练：左右非对称与视觉平衡案例（v638 不变）

- 新增 `aesthetic-2026-11-05`：训练左右毛流、覆盖、别耳习惯与肩线参照不一致时，如何区分“参数完全对称”和“真实使用后的视觉平衡”。
- 同步原创AI虚构人物四视图、六段资深基准答案、三状态及首次洗后/第四周/第八周验收、五项未评分复盘；同时安全恢复已通过检查但未合并的11月4日案例。未改 App 代码、版本或业务数据。

<!-- academy-reviewed-inputs:2922202a2a62bd1bc6a9fa32e607db5a154d8c1c69e9fc7eb5326c930e25e7b0 -->
## 2026-11-05 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main e07749550ef3073c6ca03e831053f9bd2a23c646.
- Dates: 2026-11-05. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-11-04 · 发型审美训练：六区卷度功能案例（v638 不变）

- 新增 `aesthetic-2026-11-04`：训练顶区细软、后区粗密、后颈外向时，如何在“全头统一S纹”与“六区按功能分配卷度”之间取舍。
- 同步原创AI虚构人物四视图、六段资深基准答案、首次洗后/第四周/第八周验收，以及五项未评分复盘；未改 App 代码、版本或业务数据。

<!-- academy-reviewed-inputs:aed595596c1a35931dc15d8d7f3712293af1ae6d1871259cbc99ade0f34c705f -->
## 2026-11-04 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 1c9f1edb6bf1db9385ceeac86e74337a21c345f0.
- Dates: 2026-11-04. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:fd333520898287122640f88a6ea63708f99ff6b2b200e77105ad1c6c8d9f5477 -->
## 2026-11-03 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 9a52c092ca0b379fd1c5ee1c878a6d3328608d3c.
- Dates: 2026-11-03. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:09fb236c3dc2f3e31ad7e947208327d564b971a0fd2dd232753c594e53061b0a -->
## 2026-11-02 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main af1948c2d8a35c59efb5c4a9a413076bb91876c1.
- Dates: 2026-11-02. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:f82cc0ba95f4bf5d191369d72a23a3dfdcb1580e3a4f88226c509e55611e354d -->
## 2026-11-01 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 85c109de09028eca525679513686d2c7558ad89f.
- Dates: 2026-11-01. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:372155555c5c55a7533e6bac918908a569548a9b8f816b30e2e8758863ca0637 -->
## 2026-10-31 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main f26d809e0a1642adaee5e6fa39c1bb0c1bfcc6d1.
- Dates: 2026-10-31. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:fc33a7584463584df5636f2fe38a63f9b519c35b2fb9ba2ea8870338061f762f -->
## 2026-10-30 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main b305ff02ecff46492fd8b947c786ea77fab37595.
- Dates: 2026-10-30. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:288ca513cbdeaf21aaf859faecd87442e6e5dd038d314bb557cc7a7adb877afc -->
## 2026-10-30 · Helmet-recovery crown-balance aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about high-crown reference goals, two opposing crown whorls, medium-coarse support, broad-shoulder clothing context, twice-daily forty-minute helmet use and a two-minute no-heat recovery budget. Six conditional answers compare aggressive short crown height with a recovery-first directional structure; five self-checks remain unscored without a user answer.
- Original same-person 1942×809 AI WebP shows one current grown-out short silhouette without a helmet, not the reference, proposed cut, helmet test, two-minute recovery or eight-week result. No real customer, measured anatomy/density/diameter, verified helmet performance, scientific validation or independent human expert certification is implied.
- Preserve all twenty-two earlier aesthetic feed objects. App/runtime/version, academy, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; exact-head protected CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.

## 2026-10-29 · Reference-result feasibility aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about an undisplayed airy large-wave reference, zonally resistant upper hair, twice-lightened face frame and ends, slow wet-state return, natural-dry expectations and a three-minute routine. Six conditional answers compare full-head curl pursuit with a structural-first, test-gated route; five self-checks remain unscored without a user answer.
- Original same-person 1916×821 AI WebP shows one current medium-long fall only, not the reference, proposed cut, strand test, chemical result or home result. No real customer, verified diameter/porosity/damage grade, chemical safety approval, scientific validation or independent human expert certification is implied.
- Preserve the reviewed 2026-10-29 academy publication and all twenty-one earlier aesthetic feed objects. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; exact-head protected CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.

## 2026-10-29 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main def17efeeefb8b04f0b3d4b0f124a325887b23f4.
- Dates: 2026-10-29. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-10-28 · Head-face-neck-shoulder proportion aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about a relatively small face opening, long visible neck, narrow sloping shoulders and dense medium-coarse hair whose current width sits around the jaw and upper neck. Six conditional answers compare broad upper-side volume with a lower, continuous shoulder-neck transition; five self-checks remain unscored without a user answer.
- Original same-person 1312×1199 AI WebP shows one current shoulder-length blunt lob, not the undisplayed reference or proposed result. No real customer, measured face/skull/neck/shoulder ratio, verified hair diameter/density, personality, occupation, scientific validation or independent human expert certification is implied.
- Preserve the reviewed 2026-10-28 academy publication and all twenty earlier aesthetic feed objects. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; exact-head protected CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.

<!-- academy-reviewed-inputs:9708badbb91d468c03ca0e41a8e159e38b3d6b241d13480e469f4b5e61dda6e7 -->
## 2026-10-28 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main d87d949a4a2d4f8a9cfe6209d331003a20d5ee4a.
- Dates: 2026-10-28. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-10-27 · Mixed regional-density aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about comparatively quiet crown/temple coverage, dense occipital/nape weight, mixed strand support and an eight-to-ten-week low-maintenance cycle. Six conditional answers compare uniform high layers/global thinning with regional coverage-and-weight management; five self-checks remain unscored without a user answer.
- Original same-person 1448×1086 AI WebP shows one current medium-long silhouette, not the undisplayed reference, proposed layers, thinning result, first wash, fourth week or ten-week state. No real customer, medical hair-loss claim, measured density/diameter, damage grade, scientific validation or independent human expert certification is implied.
- Preserve the 2026-10-27 academy publication and all nineteen earlier parsed feed objects. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; protected exact-head CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.

<!-- academy-reviewed-inputs:9544c97ad27c8e2d14cb7b5a2dd0b49ed954914ae763f9cbb14d2dcbc735239d -->
## 2026-10-27 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 8519da154775a5e9fa35a8662a0ba8d38022eb6c.
- Dates: 2026-10-27. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-10-26 · Geometric-reference adaptation aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about adapting a jaw-length geometric box-bob reference to shoulder/head proportion, temple coverage, mixed nape bend, ear-tuck/headset function and an eight-to-ten-week service cycle. Six conditional answers separate permanent structure from reversible styling; five self-checks remain unscored without a user answer.
- Original same-person 1536×1024 AI WebP shows one current collarbone lob, not the undisplayed reference, proposed haircut, first wash, fourth week or ten-week result. No real customer, measured skull/face ratio, verified density, hair diameter, damage grade, scientific validation or independent human expert certification is implied.
- Preserve the 2026-10-26 academy publication and all eighteen earlier parsed feed objects. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; protected exact-head CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.

<!-- academy-reviewed-inputs:274fdccc24a83f9466a7c328f6a9ed1bac369e16dc6e5c0c30495cd2eeee1231 -->
## 2026-10-26 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main a6015d26ddf4376fbfcc6617f986e2c582336832.
- Dates: 2026-10-26. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-10-25 · Nape grow-out and maintenance-cycle aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about low nape hairline, upward-growing nape flow, neck exposure and an eight-to-ten-week service interval. Six conditional answers compare a higher exposed line with bridge-length grow-out control; five self-checks remain unscored without a user answer.
- Original same-person 1536×1024 AI WebP shows one current seven-week grown-out short bob, not the undisplayed reference, fresh haircut, first wash or tenth-week result. No real customer, measured hairline, follicle direction, growth rate, scientific validation or independent human expert certification is implied.
- Preserve the 2026-10-25 academy publication and all seventeen earlier parsed feed objects. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; protected exact-head CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.

<!-- academy-reviewed-inputs:b4cb12a2de82b8af296901acad43e7af184fe14997124eab9d2eb2bd13a2e3ac -->
## 2026-10-25 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main a0e937b467151e218671e227e1128b9ac5eb74e2.
- Dates: 2026-10-25. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-10-24 · Grown-out perm transition aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about straight new growth, uneven residual perm and a six-month no-reperm plan. Six conditional answers compare preserving temporary curl with building a future-stable straight-growth base; five self-checks remain unscored without a user answer.
- Original same-person 1536×1024 AI WebP shows current root-to-end transition and shoulder contact only, not the undisplayed reference, haircut, first-wash or future result. No real customer, chemical history, elasticity, damage grade, scientific validation or independent human expert certification is implied.
- Preserve the 2026-10-24 academy publication and all sixteen earlier parsed feed objects. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; protected exact-head CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.

<!-- academy-reviewed-inputs:d1f3c90c9b28ba6d8dfb3c2907f715af0ec0ec5289914954d933e994e5fbc032 -->
## 2026-10-24 · Reviewed academy publication candidate (App version: v638 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 20e3bcfa241c13d0edc87e3e45633c1d72b0189b.
- Dates: 2026-10-24. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-10-23 · Haircut-only versus waved-reference aesthetic case (v638 unchanged)

- Add one original fictional current-state four-view case separating a loose-wave reference into contour, strand separation and wave formation before choosing a haircut-only plan. Six conditional answers include a primary stop condition and a backup upgrade condition; five self-checks do not score an unanswered user.
- Original same-person 1536×1024 AI WebP shows only the current straight bob, not the undisplayed reference, post-cut result or texture-service result. No real customer, skull/hair-diameter measurement, curl prediction, scientific validation or independent human expert certification is implied.
- Preserve all fifteen earlier parsed feed objects and every academy lesson/catalog. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; protected exact-head CI, ordinary merge, Pages success and exact live feed/image readback remain required before claiming App synchronization.

## 2026-10-21 · Data read candidate (App version: v638 local only)

- Base github/main ac0cfd26 (published v637); isolated perf/data-load-20261021. No push, merge, deployment, backend or production business data changes.
- Optional memory-only concurrent read coalescing for three entries; pending reads expire from the join window after five seconds, mutations invalidate flights, settled results are never cached. Frontdesk expanded details refresh once in parallel with dashboard. Auth/scope/latest-response guards and complete payloads remain intact.
- Same synthetic sample proves fewer duplicate calls/JSON bytes, not production latency gains. Commands, coverage and evidence limitations: docs/data-loading-performance-2026-10-21.md. Original cumulative local gate passed (120 finance steps plus remaining original checks); focused WebKit recovery/shell passed. Desktop WebKit does not replace iPhone acceptance.

## 2026-10-21 · WebKit update diagnosis (App version: v637 local only)

- Confirmed the test helper incorrectly treated async predicates as completed; explicit awaited polling now retains a hard 30-second deadline, all original scenarios and assertions. WebKit/Chromium full lifecycle passes, including runtime-only bad resource updates.
- Guard repeated button/online update requests while a worker is installing or waiting. Real-browser synthetic regression preserves unsaved input and subsequent natural activation/update failure recovery. No auth/business/cache-scope changes. Exact results and original failure evidence are retained in ../validation-review/static-shell-results.md; desktop WebKit is not iPhone acceptance. No push, PR #64 edit, merge or deployment.

## 2026-10-21 · Startup guard follow-up (App version: v637 local only)

- Original full gate caught external deferred shell script before the inline startup guard. Moved client script after existing page content/guards; original style regression passed without relaxing its assertions. Browser cache-deletion assertion now waits boundedly for actual cleanup visibility. Final frozen full gate and WebKit outcome are in ../validation-review/static-shell-results.md.

## 2026-10-21 · Static shell phase 2 (v637 local only, PR #64 untouched)

- Isolated from 2d9cea7/main251c5b1; academy preserved. Public explicit37-file shell, hash-verified atomic install, natural activation only, no API/private data/write queue. Independent review fixes cover downgrade/runtime/same-cache reinstall, admin resource ownership, query version bypass and update retry.
- New build/browser regressions and integrity generation check preserve original gates. Chromium synthetic lifecycle checks passed during development; WebKit offline emulation hit a browser internal error, server-drop alternative and final full gate results are recorded in ../validation-review/static-shell-results.md. No iPhone claim.
- Local implementation/testing only: no phase2 push, PR update, merge, deployment, backend or business data change. See docs/static-shell-local-2026-10-21.md for limitations and device-test approval gap.

## 2026-10-21 · Startup draft PR preparation (v636, not deployed)

User authorized pushing only the isolated startup branch and opening a draft PR with remote checks; no merge, auto-merge or production deployment. Integrated main 251c5b1 (academy PR #63), preserving all academy bytes and both handoff histories. Cumulative original pre-push gate will run against this main baseline before branch publication; exact-head remote CI remains required. iPhone acceptance still lacks an approved supported test route; no ports, tunnels or credentials added.

## v636 local review follow-up — 2026-10-21 (not published)

Independent review fixes: defer saved private hair view until verification, reject stale booking/picker responses across identity/date changes, freeze private views on cross-tab account changes, preserve same-user unsaved form DOM through reauthentication, and block background keyboard access with opaque identity gates. Added synthetic scope and actual hair-input regressions; see `docs/startup-independent-review-2026-10-21.md`.

## v636 — 2026-10-21 (local candidate, not published)

Verified shell/monthly loading separation; bounded frontdesk/main identity recovery with transient failures retaining credentials; defer non-first-screen import and pre-verification report reads. Business write order and auth scope preserved. See `docs/startup-review-2026-10-21.md` for synthetic Chromium/WebKit results, iPhone acceptance and cache design limits.

<!-- academy-reviewed-inputs:7240c0a05adef312fa65d7c5d8efaf73615129c9e1d580af00117a7a9ea23f4b -->
## 2026-10-21 · Reviewed academy publication candidate (App version: v635 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main b713720a0970cf66c4d55de4f83ea63fd5e57a99.
- Dates: 2026-10-21. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-10-20 · Visual balance versus mirror symmetry case (v635 unchanged)

- Add one original fictional shoulder-area hairstyle case distinguishing actual length, bends and apparent width before cutting an outward-turning side. Six conditional answers compare closer visual matching with length-preserving balance; five recaps do not evaluate an unanswered user.
- Same-person current four-view AI WebP adds the second side for observation. No measured length/root cause, real client, post-cut result or independent scientific/expert approval is implied; exact hashes and complete prompt are in transparent preparer audit.
- Preserve all twelve earlier parsed feed objects, all academy lessons/catalog, App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and schedules. Local browser absence is documented; exact-head protected CI and ordinary merge/Pages/live readback remain release gates.

## 2026-10-19 · Softness versus roundness aesthetic case (v635 unchanged)

- Add one original fictional adjacent-visual-language case: distinguish whole-contour roundness, local edge transitions and surface texture before choosing a haircut technique. Six conditional reference answers compare clear silhouette/soft edges with fuller inward curves; five self-checks do not score an unanswered user.
- Original same-person current front/profile/back AI WebP; framing revision includes shoulder context. Image is not a real customer, an A/B outcome or proof of post-cut/home behavior; prompt and exact hashes are in the transparent preparer audit, not independent expert certification.
- Preserve all eleven earlier feed objects, all academy lessons/catalog and all runtime/version, old feed, calculator, customer, finance, database, login, permission, business-sync and automation files. Existing protected CI must complete identical daily/browser and full shared checks before normal merge; exact live readback remains required.

<!-- academy-reviewed-inputs:460b48200ed97a923e42da6e29318a7c2ec43b688cd02153d54db8b6280d7eeb -->
## 2026-10-19 · Reviewed academy publication candidate (App version: v635 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 0c803bb0af86cca04a988938351ace4ff0c7ec59.
- Dates: 2026-10-19. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:78a39d05baac5ffea5df668cb3d7d73a2206eede27515bb97c35fe884ab71fcd -->
## 2026-10-19 · Reviewed academy publication candidate (App version: v635 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 0c803bb0af86cca04a988938351ace4ff0c7ec59.
- Dates: 2026-10-19. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:db867f45f4df3bb364e9d5b833150a528118fcc1e28783f33f328d0a87d4723c -->
## 2026-10-18 · Reviewed academy publication candidate (App version: v635 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 47b04b9a3cd995730b3c6bd4f6e0e64d3a05774b.
- Dates: 2026-10-18. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:19c170cfda421a8cbe2d9b67856add17e4091ab118613f7d191502f5b9e59f53 -->
## 2026-10-17 · Reviewed academy publication candidate (App version: v635 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main cbf245881f5732a8dfef800bcfb25f1dbb45be74.
- Dates: 2026-10-17. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

<!-- academy-reviewed-inputs:3d5fa88800c9b235e995d68f1f3d53bf6d3e817e8bc94271640fc982ef46fc55 -->
## 2026-10-16 · Reviewed academy publication candidate (App version: v635 unchanged)

- Current owner: ChatGPT content publisher. Last synchronized base checked: github/main 2c0563208142f7b3e85919b1dac18cb2aa6767b4.
- Dates: 2026-10-15, 2026-10-16. Original reviewed drafts and local figures are preserved; no new scientific approval is generated.
- Dated HTML, complete descending catalog and known-course fallback are rendered with the trusted main publisher. Existing lessons and all business code stay unchanged.
- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected Validate shared app, normal merge and main/Pages readback are still required. Preparation is not publication.
- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; the connected publisher must make the final status commit, then verify its exact head.

## 2026-10-18 · Two-occasion aesthetic case (v635 unchanged)

- Add one original fictional case about a clear low-maintenance daily contour and a one-off soft-wave/partial-up event goal. Separate shared haircut structure from temporary parting, texture and fastening; compare preserving continuity with a more layered long-term choice.
- Same-person current front/profile/back AI WebP, six conditional answers and five unscored self-checks. No event result, fastening success or all-evening curl retention is implied by the current-state image or a single trial.
- Preserve ten earlier feed objects, all academy lessons/catalog, App/runtime/version, old feed, calculator, customer, finance, database, login, permission, business-sync and schedules. Local browser absence is documented; existing protected CI must complete identical daily and full shared gates before merge.

## 2026-10-17 · Styling-effort aesthetic case (v635 unchanged)

- Add one original fictional case about liking a salon side-back style while declining repeated root styling at home. Compare a tested maintenance commitment with a softer side-forward target; distinguish willingness, skill and tools instead of blaming the customer.
- Same-person current-state front/profile/back AI WebP, six conditional answers and five unscored self-checks. Two extra styling minutes explicitly exclude necessary drying; customer reproduction is not proof of all-day or home stability.
- Keep nine previous objects, all academy courses/catalog, App/runtime/version, old feed, calculator, customer, finance, database, login, permission, business-sync and schedules unchanged. Local browser absence is documented; existing protected CI must complete identical daily and full shared checks before merge.

## 2026-10-16 · Reference-photo adaptation case (v635 unchanged)

- Add one new fictional aesthetic case: fine-looking longer hair, a fuller chin-length short-hair reference, and the trade-off between preserving visual language and copying length. Compare two conditional outlines, density, head/shoulder balance and a five-minute routine.
- Original current-state front/profile/back WebP, six reference answers and five self-check sections. Reference person's features are explicitly fictional text, not an unseen verified image; no user performance is invented.
- Preserve all eight previous cases and all runtime/version, retired feed, calculator, customer, finance, database, login, permission, business-sync and schedule files. Local browser absence is transparent; unchanged protected CI supplies the identical required daily browser checks before any merge.

## 2026-10-15 · Mixed-texture aesthetic training case (v635 unchanged)

- Add one fictional front/profile/back teaching case about a smooth outer layer, wavier inner layer, and the trade-off between a solid straight-reference perimeter and realistic air-dry maintenance.
- Include six conditional design sections, five self-review prompts, visible/assumed/unknown boundaries, an explicit A/B change condition, and customer wording that does not promise the reference photo's straightened result.
- Add one original AI-generated current-state image and a transparent preparer audit. No App runtime, retired academy feed, calculator, customer, finance, database, authentication, permission, business-sync or schedule change.

## v635 · 2026-10-14 · 月报上传入口说明（待发布）

- 月报上传区分为“月报数据 · Excel / Word”和“月报凭证 · 照片 / PDF”，分别说明读取表格与留存原件的用途；电脑并排、手机竖屏上下排列。
- 保留一个“上传并保存”按钮；文件格式、大小、多选及照片单独补传条件直接可见，详细识别和统计说明折叠保留。
- 仅改显示与说明；不改上传处理、识别路由、金额计算、原件保存、后台权限或股东确认规则。增加五种窗口尺寸、文件选择保留和只读权限测试，并回归现有上传流程。

## v634 · 2026-10-14 · 月报股东确认（发布候选）

- 财务核对预览后主动提交已保存月报；股东查看固定版本，勾选“已核对本月报表，账目无异议”后确认。同一人同一版本只记录一次，不可反复确认；新金额需财务重新提交，旧记录永久保留。
- 自由手艺人 App 增加月报待办及红点，仅对后台已授权门店开放；新增确认不包含编辑、入账或授权能力，不把旧“已阅”记录当作无异议确认。
- 服务器从现有月报计算结果构建版本，不信任浏览器金额或身份；提交预览之后来源变化会要求重看。请求结果不明时只读核对状态，不自动重试确认。
- 新增实际 HTTP、隔离 PostgreSQL、手机/电脑和 App 待办测试；保留人工金额、历史账、采集安排及已有后台授权规则。部署前备份原接口；独立新增表，回滚保留确认记录。
- 月报返回入口恢复确认状态；状态、待办和预览按只读请求限时处理，提交与确认不会被自动重试。
- 按生产目录权限补充服务端私有目录访问和回归测试；不增加普通用户、股东门店、旧函数或数据表的权限。

## 未发布 · 月报股东确认：版本与确认记录

- 新增独立、只追加的财务提交版本、股东待办名单和“已核对、账目无异议”确认记录；同一人同一版本只能确认一次，重复点击及两个入口同时操作不会重复记录。
- 同一内容重复提交不重置确认；新版本保留旧记录并产生新的待确认状态。查看期间金额或版本变化会拒绝过期确认，等待期间撤权也会拦截。
- 加入来源一致性检查和按门店读取的轻量待办查询，沿用现有月报计算与权限，不改历史金额、原始凭证、旧“已阅”记录，不自动提交或确认任何月报。
- 142 项隔离 PostgreSQL 检查及原有 39 项身份检查通过，完整本地回归通过（含 111 组财务命令）；生产仅做结构只读核对。尚未接入实际接口、按钮和红点，也未部署生产，完整功能仍待后续联调。

## 未发布 · 月报股东确认：身份基础

- 增加独立的确认身份映射设计：经明确核实的两个登录入口可算同一位股东，不合并登录凭据，不继承对方门店权限，不按同名自动合并。
- 添加 39 项独立 PostgreSQL 验证，覆盖撤权、离职、账号停用、到期、跨店/跨公司、直接接口访问与不可变映射。
- 尚未应用生产迁移、登记真实映射或接入按钮/提醒；历史“已阅”、金额、已入账记录和权限均未修改。完整确认流程仍待后续实现和验收。

## v633 · 2026-10-13

- Fix confirmed daily correction archival coordinate collisions by reusing the existing logical-cell mapping, including matching each income line to its exact archived source. Preserve all logical cells, original coordinates, financial formulas, permissions and v632 transaction protections.
- Add a 542-logical/402-physical synthetic regression reproducing duplicate B3, then completing retail100 correction with unchanged cash controls, exact lineage, immutable history and atomic denial/duplicate tests.

## v632 · 2026-10-13 · 候选

- 修复老板已入账更正的来源核实闭环：金额校验与来源状态分开，一次明确确认原图、收款渠道及售卡实收；只刷新核实上下文，不覆盖未保存输入。
- 新核实凭据与实际老板 Auth、门店、日报、新修订、来源/单元格哈希及审计请求绑定；普通财务角色、金额公式、旧记录和表权限不变。
- 新路径增加最终现金入账口径断言；旧入账副本不支持的组合整笔回滚，不让来源核实掩盖金额差异。候选尚未上线，旧页未保存编辑保持。

## v631 · 2026-10-13

- 修复历史日报已有可核对电子凭证、但现金候选不可用时误走照片原件分支的问题；保持既有金额口径，缺少电子确认的旧页面返回明确提示，不查询空凭证 ID。
- 仅入账项目复核 RPC 增加 30 秒事务预算，保留 5 秒锁等待、函数正文、权限及全部金额/来源校验；超时提示明确事务回滚和草稿保留，不自动重试或入账。
- 新增手机/电脑旧来源回归及隔离 PostgreSQL/PostgREST 8 秒超时、函数级预算、回滚验证。不修改历史数据、人工金额或采集计划。

## 2026-10-12 · Reliable academy course directory (v630 unchanged)

- Online validation found today's reviewed course files deployed but directory did not reveal them through anonymous GitHub API. Read a same-site static catalog instead; include it in reviewed candidates and CI consistency checks.
- Preserve page style, navigation, known-course fallback, all reviewed body/image bytes and every App/finance/version/permission/schedule setting. No new lesson or scientific approval.

## 2026-10-12 · Reviewed academy handoff and original daily course (v630 unchanged)

- Replace direct-main academy publishing with a reviewed candidate artifact and ordinary protected-PR handoff; preserve existing schedule, concurrency, permissions and all App/finance behavior.
- Bind actual source/rights/privacy review records to正文、元数据及图片哈希；pending/missing/invalid cannot render, CI checks actual HTML and safe local figure rendering.
- Add the independently revised 10/12 foundation-reading course and three original, actually inspected SVGs; preserve 10/11 and four aesthetic cases. No new credentials or auto-approval; final online publication is a separate verified step.

## v630 · 2026-10-11

- 日报修改记录仅既有老板账号可读取，默认收起，保留紧凑查看/收起入口；切店、换月、重新进入或切号恢复收起。
- 服务器按已验证账号/Auth/公司 ID 和实时专属授权判断；普通账号不查询、不返回记录。撤销日报修改条目与旧快照的客户端读取，并仅限制审计表中的日报事件读取；不新增授权、不删除记录。
- 保留莫兰迪配色、真实差额提示、财务写入/入账、门店隔离和未保存表单保护；登出/降权清理缓存，合成 API/SQL/手机桌面回归纳入共用门禁。

## v629 · 2026-10-11

- 日报编辑区采用暖灰白、雾蓝表头与鼠尾草绿汇总；识别候选改为近白底与细线提示，正常入账保持黑色。
- 红色差额、黄色待核对、绿色完成及禁用/焦点语义保留；字段、纸表几何、金额、校验、API与入账流程不变。

## 2026-10-11 · Original aesthetic short-hair training (v628 unchanged)

- Add one fictional illustrated case “短发两侧撑开：继续推短，还是留长借重量？” with observation/assumption separation, practice question, six conditional reference sections and five self-review prompts.
- Preserve all three earlier cases and today’s existing academy lesson. Content/audit only; no App/runtime/version/finance/automation changes. Verify unique daily ID and actual feed/image hashes before reporting publication.

## v628 …34465 tokens truncated…syr_shareholder_registrations`；`operations-api` 新增 `shareholder_register`（公开）、`shareholder_registration_list`、`shareholder_registration_review` 接口。
- 需重新部署 `operations-api` 与执行数据库迁移；未提交、未推送、未发布。
- App version: v449

## 2026-08-27 · v448 月报表股东已阅 + 股东账号创建（本地候选，未发布）

- 月报表顶部新增“股东已阅”区：显示已确认股东名单与时间；股东账号可点“确认已阅”，表示已知晓本月经营情况，同一股东同月只记一次，重复确认更新已阅时间。
- 恢复驾驶舱“经营账号”入口（仅管理员/老板可见），账号角色新增“股东”；股东账号支持全部门店或指定门店权限范围，创建后拥有股东只读能力。
- 新增迁移：`zysyr_report_acknowledgements`（已阅记录）、`zysyr_acknowledge_report` RPC、`zysyr_admin_complete_shareholder_account` RPC；`overview` 返回已阅名单，新增 `report_acknowledge` 接口，`operations-auth-admin` 与登录桥接支持创建股东账号。
- 需重新部署 `operations-api` 与 `operations-auth-admin`，并执行数据库迁移；未提交、未推送、未发布。
- App version: v448


## 2026-08-27 · v447 填写日报并入日报表（本地候选，未发布）

- 左侧导航移除独立“填写日报”菜单；“日报表”月视图新增“填写日报”二级入口，点击进入原图对照人工电子日报填写页，并可返回日报表。
- “填写日报”入口沿用原权限（仅获授权门店账号或财务可见），仅页面导航/入口位置改动，无接口、数据库变化。
- App version: v447

## 2026-08-26 · v446 现金收支表补台账字段与股东追溯（本地候选，未发布）

- “财务”现金/备用金收支表补齐手工台账字段：凭证编号可手动登记，领款人可手动填写；凭证列保留“＋上传”上传消费凭证。
- 表格左上角新增“上月结余”，财务可登记本月期初剩余金额，结余按“上月结余 + 存入 - 支出”计算。
- 股东/店长可只读查看这张收支表，每笔开支有“追溯凭证”按钮（点击金额/凭证打开原始凭证）；新增、上传、保存、冲销仅财务可用。
- 新增数据库迁移：`zysyr_petty_cash_records` 增加 `voucher_number`、`recipient`，新增 `zysyr_cash_opening_balances` 表及登记函数；`operations-api` 保存与读取接口同步更新，需重新部署。
- App version: v446

## 2026-08-26 · v445 财务简化为单张现金收支表（本地候选，未发布）

- “财务”一级菜单只保留一张“现金 / 备用金收支记录”表：支出与备用金存入都在表末行直接填写（日期、说明、借方或贷方金额、科目、凭证），保存即登记。
- 上传凭证在表格凭证列内完成：点“＋上传”选择原始凭证上传，人工审核后回表选择关联；点击金额或凭证可打开原始凭证追溯；旧记录保留冲销。
- 支出分类、报表上传、凭证审核、支出付款、正式月报生成与锁账收进二级页面（从表格右上“报表上传 / 凭证审核 / 月结”进入），并可返回。
- 仅前端交互重构，复用现有 petty_cash_record / voucher_upload / expense_payment_confirm / monthly_generate 接口，不改数据库；后端无需重新部署。
- App version: v445


## 2026-08-26 · v444 备用金明细改为现金收支台账格式（本地候选，未发布）

- 备用金明细改成“现金 / 备用金收支记录”台账样式，列为：日期、凭证编号、说明、借方金额、贷方金额、科目、批准人（确认人）。
- 新增“凭证编号”列体现上传的凭证：自动读取该笔记录关联凭证在人工审核时填写的编号，未填编号则显示文件名，点击可直接打开凭证原件；借方=备用金存入，贷方=备用金支出。
- 后端 `petty_cash_report` 同步返回凭证编号（取最新一次人工审核的修正字段）。仅页面与 API 展示层改动，不涉及数据库表结构。
- 说明：数据模型暂未提供“领款人”字段，故未单列；如需，请在登记备用金表单补“领款人”并加数据库字段。
- App version: v444

## 2026-08-26 · v443 备用金明细并入财务录入（本地候选，未发布）

- 左侧导航移除独立“备用金明细表”菜单；备用金汇总与逐笔明细并入“财务录入”工作台，位于登记表单之后、月结之前，按“财务录入”与“备用金明细”分区展示。
- 仅页面导航与区块位置改动，备用金登记、明细读取接口和追溯逻辑不变。
- 注意：合并后“财务录入”沿用原财务可见规则，股东不再有独立的备用金明细只读入口。
- App version: v443

## 2026-08-26 · v442 财务上传合并与业绩报表选项隐藏（本地候选，未发布）

- 左侧导航将“上传报表”与“凭证中心”合并为“财务上传”入口；原凭证上传与审核队列并入财务上传页，按“上传报表”与“凭证审核”分区展示。
- 上传报表页隐藏“业绩报表（每日）”选项及对应说明，报表类型仅保留日报、工资表、月度盈亏表。
- 仅页面导航与表单选项改动，无接口、数据库、权限字段变化。
- App version: v442

## 2026-08-26 · v441 手机横屏适配（本地候选，未发布）

- 手机横屏（高度≤560px 且宽大于高）补响应式：顶部栏压缩并单行显示、隐藏副标题、导航与内容边距收紧；月报原表与日报电子表在横屏下同样自动缩到容器宽度整表完整显示，报表区域限高后可上下滚动，想看局部继续双指放大。
- 竖屏（≤560px）与平板（≤900px）、电脑端行为不变。仅样式改动，无接口/数据库变化。
- App version: v441

## 2026-08-26 · v440 适配手机 / 平板 / 电脑（本地候选，未发布）

- 手机端（≤560px）整体缩放：标题、导航、顶部栏、月历日期格、月报原表与日报电子表单元格字号；月历改为弹性列，不再固定 672px 最小宽度；月报原表与日报电子表自动缩到整表宽度完整显示，想看局部可双指放大。
- 平板（≤900px）沿用横向滚动导航与单列卡片布局；电脑端不变。仅样式改动，无接口/数据库变化。
- App version: v440

## 2026-08-26 · v439 月份改为可选择下拉（本地候选，未发布）

- 首页“原表月报”、日报表月视图、财务上传月报的月份控件由原生月份输入框改为下拉选择，覆盖近 10 年历史月份与未来 1 年，兼容 Safari 等不支持 `type="month"` 的浏览器；日报表月视图的“上一月 / 下一月”在超出下拉范围时自动补项。
- 仅页面控件改动，控件 ID 与 `YYYY-MM` 值格式保持不变，月份切换与报表读取逻辑不受影响。
- App version: v439

## 2026-08-26 · v438 4月人工日报测试导入保护

- 日报原图批量建立人工电子表时可显式跳过 OCR worker 唤醒；原图仍按 SHA-256 私有保存并由财务人工审核，审核会取消待处理 OCR 任务，金额继续只接受人工填写值。
- 新增可重复执行的4月测试导入工具，固化26张日报原图与营业日日期映射；密码只通过进程环境临时传入，不写入代码、日志或清单。
- `operations-api` v21 已在生产生效；26张原图及26份同版电子草稿导入完成。生产复核确认日期无缺漏、四个星期一无记录、26张凭证均为人工已审、OCR状态均为 `reviewed`，抽样日报含459个电子格且可打开对应私有原图；金额未自动填写，正式日报仍为0。
- 追加4月逻辑验收凭证：44张原始业务资料附件已上传并人工审核（3张采购单据登记日期/金额/往来单位/单号后通过，41张退回待人工复核留底），全部归属自由手艺人门店；26份日报草稿与已审核原图凭证一一关联，无断链、无跨店。金额保持为空、全部草稿，未生成正式日报/收入；完整追溯链（月报→明细→业务记录→原始凭证）待上传4月月报并人工填金额确认后核验。导入工具 `scripts/import-zysyr-april-test.mjs` 同步提交。
- App version: v438

## 2026-08-26 · v437 独立工资报表与备用金明细追溯（本地候选，未发布）

- 左侧导航在“日报表”下方新增两个独立只读入口：“工资报表”和“备用金明细表”。工资中心继续保留财务维护流程，新页面不暴露录入、审核、支付或冲销操作。
- 工资报表沿用原表列式阅读，底薪、提成、奖励、小计、扣款、社保、调整和实发数字均可点击，继续下钻到工资组成、业绩、考勤/奖罚、工资原表单元格及工资凭证。
- 备用金明细按月份展示存入、支出、余额变动和逐笔记录；只读接口严格绑定公司与门店，逐笔返回日报、日报行、原表单元格、上传原件和已关联凭证，支持从明细打开私有原表与原始凭证。
- 未新增重复业务表，也未改变财务权限、收银边界或美管加数据；备用金查询只读取现有财务已确认记录。完整 pre-push 回归通过；本地 Chrome 已实际点击两个入口、工资与备用金追溯抽屉，页面无脚本错误。两条待发布迁移已应用且数据库 lint 为 0，`operations-api` 生产 v20 为 ACTIVE，未登录新接口返回预期 403；静态页面随本版本发布到 GitHub Pages。
- App version: v437

## 2026-08-26 · v436 Word 报表上传与月报/日报/工资双向追溯（本地候选，未发布）

- 财务上传支持 `.xlsx` 与含可编辑表格的 `.docx`，覆盖日报、业绩表、工资表和月度盈亏表；原文件继续私有保存、计算 SHA-256、追加版本，旧版 `.doc` 与扫描型 Word 不猜测数字，扫描页仍作为原始凭证留底。
- Word 表格按原行列生成只读网格和可追溯数字单元格；月报追溯来源由日报/业绩表扩展到工资表。月报点击工资数字可打开工资原表，报表档案新增“查看关联”，可反向查看该日报/工资表被哪些月报单元格和工资记录采用。
- 修复 v435 人工日报的三个数据完整性问题：已有单元格的位置/类型以数据库为准；清空金额或文本可以明确保存；员工改名会同步该行全部格。文本与姓名修改补齐 before/after 审计，确认版本固化 `manual_text`。
- 日报填写权限按 `daily_report.write` 的公司/门店范围校验，获授权门店账号可录入，最终入账仍只允许财务确认；导航将“真实资料导入”改为更清楚的“填写日报”，页面仍保持上方电子表格、下方原图留底。
- 正式日报月历补齐 `source_report_id`，没有人工草稿但已有正式日报时可直接打开其私有原件；测试预览移除旧 Kimi/识别候选标记，避免与“日报不使用 AI 入账”的现行规则冲突。
- 已创建当日完整备份 `ZYSYR_2026-08-26_131238.tar.gz` 并复制到 iCloud；GitHub `main` 与本地基线同为 `b56539f`。完整 pre-push 回归、本地 DOCX 数字表格样例和浏览器版式检查均通过；电子表实际位于原图上方、关联入口可见且控制台无错误。生产迁移 dry-run 仅列出 v436/v435 两个待执行文件；未迁移、未部署函数、未提交或推送。
- App version: v436

## 2026-08-26 · v435 日报表改纸质同版式：上方电子版人工填写 + 下方原件留底（实施中未发布）

- “真实资料导入”日报表布局改为与纸质日报表完全一致：上方电子版（人工逐格填写、可修改），下方纸质原件留底照片（不可修改、可放大核对）；原有“左侧原图/右侧电子表”改为“上电子版/下原图留底”。
- 电子表格按纸质版式渲染：标题与日期、发型师表（姓名+17列+小计+老/新/卡类/疗程卡+签字）、公司行、发型师小计、技师表（姓名+18列+小计+签字+未结单号）、技师小计、产品/零售/实做卡类、支付表（美甲/产品/小计/签字+支付12列）、备注；自由手艺人/向里造型按各自员工名单生成对应版式。
- 第二轮调整：抬头改为“日报表＋门店名”；所有纸面空格可修改填写（含签字、未结单号、公司行、备注），员工姓名可直接改名；空白新格按位置 upsert 保存。
- 除前端静态页与版本号（operations.html、perm-app.html、frontdesk.html、version.txt、version.json）外，配套 Edge Function（saveDailySheetDraft 透传新格元数据与文本值）与新迁移 20260826120000（扩展 cell_role、新增 manual_text、保存 RPC 位置 upsert）；人工填写、原图留底、AI/OCR 结果不直接入账的边界保持不变。
- 第三轮（返回自动保存）：离开日报表时自动保存未提交修改（含改姓名/文本格），刷新/关闭有未提交修改时弹窗提醒并尽力 keepalive 再存一次；保存失败则不切换视图并提示。
- 第四轮（保存按键+未保存提示）：日报表页头新增「保存」按键（与底部保存按钮共用同一保存逻辑）；有未保存修改时页头实时显示红色「有 N 个单元格未保存」提示，保存后消失。
- 第五轮（导航 → 月度总览 → 单日明细）：左侧导航新增「日报表」入口，股东/财务/店长可见；点入为二级月视图（整月日历，每日显示日合计与“已确认/待确认/未录入”状态，含已确认月合计与待确认天数）；点击任一日期进入三级单日日报表只读明细（同版电子表逐格只读 + 纸质原件留底照片）。月份可自由切换（含 1–7 月等历史月份），为后续补录历史报表预留入口；只读查看不产生任何写入。
- 第五轮实现：`operations-api` 新增只读操作 `daily_sheet_month`（月历：正式日报+电子草稿按日合并，取人工确认后的总计）与 `daily_sheet_read`（单日明细，复用人工填写/原图数据但标记只读），权限放宽为 `voucher.read` 或 `daily_report.write`（股东仅可查看，无法修改或确认）；前端 `session` 新增 `can_read_daily_reports`，导航显隐与 `showView` 守卫同步；不改数据库、不改权限种子、不发布。
- App version: v435

## 2026-08-26 · v434 日报改为原图对照人工电子表格

- “真实资料导入”不再调用 AI 图片识别，也不再把 OCR/模型候选值用于日报计算。财务选择已审核日报原图后，系统生成同版空白电子表格；员工姓名可从当前门店员工档案带入，金额、项目、小计、支付方式和总计均由财务对照原图人工填写。
- 左侧原图支持缩放，右侧电子表格逐格录入；人工修改格以蓝色标识，行/列/实做/支付四组勾稽不一致以红色提示。未保存、控制数不平或未勾选“逐格检查”时，服务端和页面都禁止最终确认。
- 数据库有效值函数改为仅接受 `manual_override=true` 的人工值，并重新计算既有草稿；历史 AI 候选只保留为证据，不进入小计、合计、正式日报、收入或月报。AI 候选导入接口已明确停用。
- 生产迁移 `20260825161033_zysyr_daily_manual_entry_only.sql` 已应用，`operations-api` 已部署。4 月原图与既有草稿不删除、不覆盖；正式确认前仍保持草稿状态。
- App version: v434

## 2026-08-25 · 前台客户中心增强：日期筛选 + 新客标记 + 洗发合格率（生产部署）

- 客户数据表新增“日期”筛选框，可按日期精确查找客户（历史导入按 `visit_date`、当日接待按 `business_date`），并与姓名/手机号后4位、来源筛选叠加；前后端都做日期格式校验。
- 今日预约页客户抽屉新增红色“新客”按钮（`is_new_customer`）与绿色“洗发合格”按钮（`shampoo_qualified`），一键打标签、再点取消；客户数据表里新客客户名字旁显示红色“新客”标签。
- 新增「洗发合格率」统计页：按月一键统计各助理的洗发次数、合格次数与合格率（百分比，≥80% 绿 / 60~79% 金 / <60% 红）；口径为凡有“助理”的接待记录都算一次洗发。
- `frontdesk-api` 新增 `today_mark_new_customer`、`today_mark_shampoo_qualified`、`shampoo_qualification_stats` 操作，`ledger_records` 支持 `business_date` 日期过滤；迁移 `20260825150000`（`is_new_customer`）与 `20260825170000`（`shampoo_qualified`）已在生产手动应用。
- 版本保持 v432（仅前台页面与 Edge Function 变更，未改动主 App `perm-app.html`）。

## 2026-08-25 · 前台客户中心增强：客户数据表日期筛选 + 新客标记（本地候选，未部署）

- 客户数据表新增“日期”筛选框，可按日期精确查找客户（历史导入按 `visit_date`、当日接待按 `business_date`），可与姓名/手机号后4位、来源筛选叠加；前后端都做日期格式校验，不改变来源标签与可编辑字段。
- 今日预约页点击客户卡打开“客户接待信息”抽屉后，新增红色“新客”按钮；点击即标记该客户为首次到店并保存到 `frontdesk_today_customers.is_new_customer`，再次点击取消。未登记过接待的客户会自动建立一条“已经到店”的独立接待记录；只写前台独立数据，不修改客户主档与美管加收银。
- 新迁移 `20260825150000_frontdesk_new_customer_flag.sql`；`frontdesk-api` 新增 `today_mark_new_customer` 操作，`dashboard`/`ledger_records` 返回 `is_new_customer` 且台账支持日期过滤；`test-frontdesk.js` 已覆盖新增字段、日期筛选与按钮流程。
- 版本保持 v432（仅前台页面与 Edge Function 变更，未改动主 App `perm-app.html`）；前端已推送 `github/main` 上线，`frontdesk-api` 已部署为 `ACTIVE`，`is_new_customer` 列已在生产手动应用。

## 2026-08-24 · v432 原图同版电子日报与最终确认 Gate（生产发布）

- “真实资料导入”改为原图左侧、同版电子表格右侧。OpenAI 图片输入通过 Responses API 和严格 JSON Schema 只生成候选单元格；日期、金额、小计、实做、支付与总计均允许财务逐格修正，原始图片不修改。
- 新增电子日报草稿、精确位置单元格、逐次 before/after 修改记录和不可变确认版本。全部表带公司/门店复合范围、RLS、最小授权、外键索引；浏览器不能直写。
- 数据库独立计算员工每行、项目每列、实做/总计与支付方式四组控制数，差异超过 0.01 或缺少控制总数时整笔禁止确认。旧版文本行图片导入接口已停用。
- 最终确认只把非零“发型师 × 原子服务项目”单元格生成正式收入；员工小计、项目小计、支付、技师工作量和总计只用于核对，不重复计入。确认事务同时固化原图、来源单元格、导入批次、正式日报、收入、凭证关联和对账报告，不读取美管加。
- 发布前备份为 `ZYSYR_2026-08-24_175705.tar.gz` 并已复制到 iCloud；生产迁移已应用且错误级 lint 为 0，`operations-api` v9 为 `ACTIVE`。手机页不再整页横向溢出，宽表只在电子表格容器内滚动。
- 4 月 1 日生产识别试跑确认 OpenAI 当前返回 429“无可用余额”，因此未创建电子日报草稿、正式日报或收入。SiliconFlow PaddleOCR 与 Qwen3-VL-8B 在该空白密集表格上会产生重复数字幻觉，未作为自动降级写入候选；恢复自动预填须先为 OpenAI API 账号充值，再继续 26 张日报逐张人工复核。

## 2026-08-24 · v431 三项 P0 修复与 4 月验收前置稳定（生产发布）

- 修复“真实资料导入”和“AI 分析”共用月份校验缺失导致的 `parseMonth is not defined`；月份统一严格校验为 `YYYY-MM`，无效月份不再进入查询。
- 凭证上传和 OCR 人工重试成功后立即由 Edge 后台任务安全唤醒 OCR worker；worker 对延迟重试执行有界续跑，并新增财务专属手工唤醒入口，用于恢复历史遗留的排队任务。浏览器不持有 service role 或 worker 密钥。
- OCR 只信任合法结构化 JSON 中的日期和金额；原始坐标标记 `<|LOC_n|>` 会从识别全文移除，非结构化输出不再通过正则猜日期、金额，统一留空等待财务对照原图修正。识别候选不会自动落入日报、支出、工资、库存或月报。
- 新增独立运行时回归，覆盖月份格式、真实日历日期、金额上限、坐标数字隔离、非结构化人工复核和结构化 2026-04-21 / 6395.00 样例；Sprint 6/7、经营页、前台页、登录桥、版本同步与发布完整性检查均通过。
- 发布前备份为 `ZYSYR_2026-08-24_160018.tar.gz`，并已复制到 iCloud。`voucher-ocr-worker` v3 与 `operations-api` v8 已部署并为 `ACTIVE`；线上 4 月导入中心和分析中心均通过且明确不使用美管加。遗留 OCR 任务成功消费，非结构化结果的日期/金额为 null、LOC 标记已移除、人工审核仍为 pending。v431 静态页面随本版本发布后进入全量资料验收。

## 2026-08-22 · v429 ZYSYR V2 Sprint 6–7 OCR、AI、真实资料导入与对账（本地候选，未发布）

- OCR 队列补齐租约、指数退避、自动重试、死信和财务人工重试；新增 SiliconFlow PaddleOCR worker。自动结果只保存为候选字段和置信度，人工复核仍是正式落账前置条件。
- AI 经营分析仅读取正式月报的不可变证据快照，数据库逐条校验输出引用的月报行 ID 和金额；错误引用整笔拒绝。股东/店长问题与财务回复保存当时证据快照，消息只追加不覆盖。
- 新增真实日报图片导入、导入批次、原始行/映射行、冲突清单和逐行对账。财务只能选择已审核为“日报”的 JPG/PNG 原图；已有日报、无效行、跨店写入均在生成业务记录前阻断，不修改原数据。
- 无冲突批次生成带人工复核单元格的日报原件和正式日报；对账同时核对来源行数、业务行数、来源金额、业务金额和差额。审核日报后凭证自动继续关联到日报行和正式收入，追溯可回原图。
- 新增只读 AI worker 与经营分析/问答页面、真实资料导入页面；原表月报仍为默认首页，不增加营业额 KPI、趋势、排名，不读取或回写美管加。
- PostgreSQL 隔离库从 v425 结构顺序重放 v426–v429；v427、v428、v429 回滚式事务测试分别返回 `ZYSYR_V427_RUNTIME_OK`、`ZYSYR_V428_RUNTIME_OK`、`ZYSYR_V429_RUNTIME_OK`。已验证库存移动平均、OCR 死信/复核、AI 错误引用、跨店隔离、重复日报冲突、图片日报对账和收入凭证追溯。
- 当前仅为本地 v429 候选；未执行生产迁移、函数部署、页面发布、生产数据写入、Git 提交或推送。OCR/AI provider 密钥和生产定时触发仍须在发布 Gate 单独配置。

## 2026-08-22 · v427 ZYSYR V2 Sprint 5 采购库存与产品成本追溯（本地候选，未发布）

- 新增独立“采购库存”中心，原表月报继续作为默认首页；本模块不读取、不回写美管加。
- 建立采购单及明细、分批到货、不可变库存流水、可重建结存、消耗/报损、员工自购与收款。采购审批、到货和付款分别留痕，付款不会被误当成入库。
- 入库按实际采购价更新移动平均成本；每笔出库固化当时单位成本、变动前后数量与成本快照。库存不足、超采购到货、跨门店写入、锁账月份写入均由数据库原子阻断。
- 入库、消耗、报损、员工自购和收付款必须关联同门店已人工审核凭证；所有写 RPC 只授予 `service_role`，数据库再次核验 Auth 账号的 `inventory.write` / `payment.confirm` 范围。
- 正式月报新增员工自购收入、产品消耗成本和员工自购产品成本，并重算收入、支出和盈亏；建立“月报数字 → 消耗/员工自购 → 库存流水成本快照 → 入库/采购 → 原始凭证”追溯。
- PostgreSQL 隔离回放通过：10 瓶 × 100 与 10 瓶 × 200 得到移动平均 150；消耗 4 瓶成本 600、员工自购 2 瓶成本 300/收入 500，冲销后结存 14；月报支出 900、收入 500、盈亏 -400。超量入库、跨门店写入和已收款自购冲销均按预期被阻断，全部测试数据回滚。
- 当前仅完成本地 v427 候选；未执行生产迁移、函数部署、页面发布、生产写入、Git 提交或推送，发布须单独走 Gate。

## 2026-08-22 · v426 ZYSYR V2 Sprint 4 工资闭环（本地候选，未发布）

- 新增财务专属“工资中心”，原表月报继续作为默认首页；工资表按原来列式阅读，不恢复营业额卡片、趋势、业绩排名或美管加数据。
- 建立正式考勤、奖罚扣款、发型师业绩、提成规则、工资及工资明细。业绩必须来自财务上传原表的具体单元格且只计发型师；提成必须命中唯一有效规则，系统不猜比例。
- 新增正式形象/卫生/服务纪律检查记录及凭证；奖罚可引用检查记录并建立追溯。底薪、社保和非零其他调整不再接受无来源人工值，必须匹配同月工资原表的精确单元格和金额。
- 工资按“底薪 + 提成 + 奖励 - 扣款 - 社保 + 其他调整”生成不可变组成明细，审批、支付和冲销均保留工作流、before/after 审计、凭证和图追溯。员工 Supabase Auth 账号只能读取本人，店长按授权门店只读，财务按授权门店维护。
- 正式月报把已审核/已支付工资作为“人工成本”纳入支出合计，并建立 `月报人工成本 → 工资 → 工资组成 → 业绩/规则/考勤/奖罚 → 原表单元格/凭证` 追溯；存在草稿工资时禁止月结。
- 隔离 PostgreSQL 15 从只读 v425 生产结构重放 v426 成功；回滚式测试得到业绩 10,000 × 35% 提成 3,500、迟到扣款 200、底薪 6,000、社保 500、其他调整 100、实发 8,900，工资付款和月报人工成本均为 8,900，追溯链完整。
- “创建财务账号”扩展为受独立高风险能力保护的“创建经营账号”；店长和员工只允许绑定指定门店在职员工，Auth 元数据、账号、角色范围及审计由服务端原子完成。回滚测试验证创建成功和权限范围，浏览器验证表单强制单店/员工绑定且无控制台错误。
- 本版本当前仅为本地候选，未执行生产迁移、函数部署、页面发布、生产写入、Git 提交或推送；发布须单独走 Gate。

## 2026-08-20 · 向里客户历史导入准备（v425 数据维护）

- 历史客户表去重从全局 `row_hash` 改为门店内 `store + row_hash`，避免向里造型与自由手艺人恰好相同的日期、客户、项目和金额互相误判重复。
- 导入 RPC 继续只允许 `service_role` 调用，并新增空门店拒绝；已有自由手艺人历史记录内容不变，App 页面与美管加客户、套餐、消费、预约及收银数据不变。
- 本次不提升 App 版本；迁移仅用于安全导入用户提供的向里造型 2026 客户工作簿。

## 2026-08-20 · v425 ZYSYR V2 Sprint 3 财务业务闭环（生产发布）

- 新增财务专属“财务录入”区，原表月报仍是默认首页；支出、备用金、付款与正式月结在独立页面操作，不增加营业额卡片、趋势、排名或美管加同步。
- 支出改为“选择分类与已审核凭证 → 提交 → 财务审核 → 分次/全额付款”的正式流程；旧支出接口不再直接写表，无凭证历史批量导入被明确阻止。备用金、付款均必须关联至少一份已人工审核凭证。
- 新增仅 `service_role` 可执行的分类、支出、备用金、付款、冲销、月报生成、复核及锁账 RPC；数据库再次校验 Supabase Auth 财务角色、公司/门店、能力、锁账月份与业务状态，并同事务写 workflow、before/after 审计和凭证追溯。
- 正式月报从已审核收入、已审核/已付支出和已确认备用金汇总；备用金支出按原月报口径进入支出合计，流入不虚增经营收入。系统保存计算方式、来源数量及 `盈亏 → 合计 → 分类明细 → 正式业务记录 → 已审核凭证` 追溯边；首页仍展示财务上传的原 Excel 网格，避免改变原看表习惯。
- 支持付款部分确认、足额后自动标记已付清、阻止超付；冲销不删除历史。锁账后当月写入被拒绝，锁账月报冲销会留下解锁事件，再允许有权限财务处理差错。
- PostgreSQL 15 从空库重放 Sprint 2、v424 与 v425 后返回 `SPRINT2_RUNTIME_OK`、`SPRINT3_FOUNDATION_RUNTIME_OK`、`SPRINT3_WORKFLOWS_RUNTIME_OK`，新增覆盖支出/备用金/付款凭证、股东越权、超付、月报汇总、锁账拒写、月报解锁和付款冲销状态恢复。
- 生产部署没有修改远端迁移历史；10 个既有本地迁移文件以内容哈希不变的方式对齐生产登记时间戳。七个 v418–v425 迁移已成功应用，迁移历史完全一致且生产错误级 lint 为 0；`operations-api` 已升级为 v4、`ACTIVE`，保留函数内双通道鉴权所需的现有 `verify_jwt=false`，未登录请求返回预期 403。页面随 v425 推送 GitHub `main`。
- 未创建测试账号、未写入生产财务业务数据、未导入 2026 年 4 月资料；真实数据端到端验收仍须单独执行。OCR 队列和人工审核已上线，但实际 OCR provider 尚未配置。

## 2026-08-20 · v424 ZYSYR V2 Sprint 3 财务数据底座（本地候选，未发布）

- 保留财务上传的 XLSX 与单元格作为不可变原始资料层，新增正式日报、日报明细、收入、支出分类、备用金、付款、月报指标定义、月报及月报明细业务层；复用并扩展旧支出表，不新建第二套支出真相。
- 每个非备注日报数字必须绑定当前公司、当前门店、当前日报原件的具体单元格。财务提交与审核由仅 `service_role` 可执行的原子 RPC 完成，数据库再次核验财务角色、公司/门店范围和能力；股东、店长、旧会话及跨店/跨公司写入均被拒绝。
- 日报默认按星期一休息规则生成 `is_business_day`，保留人工覆盖来源；审核通过后只从已核对的收入明细生成正式收入记录，不读取美管加。已审核日报不能覆盖，锁账月份不能修改，明细不可原地改写。
- 新增正式财务记录与已人工审核凭证的安全关联 RPC：同一凭证仍可关联多个业务明细，关联前复核两端的公司、门店和状态，并写入原因与审计。审计枚举补入 `financial`，修复 Sprint 2/3 财务审计与 Sprint 0 旧约束的兼容问题。
- `operations-api` 已接入 `daily_report_save / daily_report_review / finance_voucher_link`，再次限制为 Supabase Auth 财务账号；页面本轮没有新增入口，原表月报继续作为默认首页，没有增加营业额卡片、趋势、排名或美管加同步。
- PostgreSQL 15 从空库重放 v423 基线与 v424 后返回 `SPRINT2_RUNTIME_OK` 和 `SPRINT3_FOUNDATION_RUNTIME_OK`，覆盖星期一休息、精确单元格来源、财务允许、股东/跨店拒绝、审核生成收入、凭证关联、不可变明细、跨公司 RLS、浏览器无直写和 RPC 最小授权；测试容器已删除。
- 本阶段只完成 Sprint 3 数据底座、正式日报链路和服务端入口；支出/备用金/付款录入工作流、月报生成及页面操作仍待后续 v425，不宣称 Sprint 3 已完成。本轮未执行生产迁移、函数部署、页面发布、生产写入或 GitHub 推送。

## 2026-08-20 · v423 ZYSYR V2 Sprint 2 凭证中心（本地候选，未发布）

- 按 V2.0 明确的 Sprint 顺序新增独立“凭证中心”，原表月报仍是默认首页；没有恢复营业额卡片、趋势、排名或美管加数据。
- 凭证可先独立上传 JPG/PNG/PDF，再进入 OCR 候选、人工审核和业务关联；相同公司内相同 SHA-256 文件被阻断，原件继续保存在私有存储并通过短时签名链接预览。
- 新增 OCR 任务与不可变人工审核版本，保存原始识别 JSON、候选字段、置信度、人工修正、审核人、原因和时间。OCR 候选不会直接生成正式收入、支出、工资或库存记录。
- 财务可在原图与字段并排页面审核，同一凭证可多选关联当前门店多张已上传报表；普通股东只读。上传、审核、修正及关联都绑定公司/门店权限并写入 before/after 审计。
- 最终多关联迁移已在一次性 PostgreSQL 15 完整重放并验证财务允许、普通股东/跨店/跨公司拒绝、重复阻断、OCR候选不转正式、审核版本不可修改、同一凭证关联两张报表、审计快照、RLS 与 RPC 最小授权，结果为 `SPRINT2_RUNTIME_OK`；测试容器已删除。完整 pre-push 和浏览器财务/股东、多选关联、零控制台错误回归已通过。
- 本轮未执行生产迁移、函数部署、页面发布、迁移 repair、生产写入或 GitHub 推送；生产迁移历史差异仍是部署前阻断。

## 2026-08-20 · v422 ZYSYR V2 Sprint 1 基础资料与组织维护（本地候选，未发布）

- 在原表月报保持默认首页的前提下新增独立“基础资料”入口，接入员工、服务项目、产品、供应商和门店目录；没有恢复营业额卡片、趋势、员工业绩排名或美管加读取。
- 新增员工与门店安全维护迁移：补齐创建人、修改人和软删除操作者 UUID，补足复合外键及覆盖索引；新增 `employee.write` 与公司范围 `org.store.write` 能力，财务/店长只维护授权门店员工；门店维护只继承 Gate C3 已精确批准的 `finance_account.create` 管理员边界，不赋给普通股东。
- 新增仅 `service_role` 可执行的员工和门店原子 RPC。新增/修改均重新核验活动公司、活动门店、活动账号、角色/直接能力及范围；跨门店调动同时核验原门店和目标门店，修改必须说明原因，写入与 before/after/actor/reason 审计在同一事务完成。
- 旧 `store_create` 接口不再直接写表，统一收口到门店审计 RPC；Supabase Auth 店长角色可按门店范围进入驾驶舱，旧用户名会话继续只读且不能获得基础资料写权限。
- 页面权限已按本地管理员股东/财务预览验证：管理员股东可编辑门店但不能编辑员工，普通股东仍只读；财务可编辑当前门店员工及项目/产品/供应商但不能编辑门店。编辑表单强制填写审计原因，停用和离职明确保留历史，不执行物理删除。
- 临时 PostgreSQL 15 已真实执行 v421 与 v422 完整迁移，验证允许写入、跨公司拒绝、跨门店双向权限、公司范围门店管理、停用公司拒绝、修改原因、审计快照及浏览器无 RPC 执行权；测试容器已自动删除。浏览器同时验证原表月报默认首页、390px 手机布局和零控制台错误。
- 完整 pre-push 全部通过，生产只读 `db lint --linked --schema public --level error` 无错误。当前仅为本地功能分支候选：未执行生产迁移、迁移历史修复、Edge Function 部署、页面发布、生产数据写入或 GitHub 推送；既有生产迁移历史差异仍是任何生产 Gate 的前置阻断。

## 2026-08-20 · v421 ZYSYR V2 Sprint 1 基础数据第一阶段（本地候选，未发布）

- 复用 Sprint 0 已有公司、门店、账号、角色和员工模型，新增 V2.0 要求的服务项目、产品、供应商三类公司级基础档案；产品参考成本使用 `numeric(14,4)`，三表均保留创建人、修改人、软删除人和时间字段。
- 三张表全部启用并强制 RLS，撤销默认浏览器写权限；有授权的股东、财务、店长只读公司目录，新增/修改只能经 `service_role` RPC 执行。
- 新增三个原子写入 RPC：服务项目复核 `daily_report.write`，产品与供应商复核 `inventory.write`；每次写入同时记录 `before_json / after_json / actor / store / reason`，修改缺少原因会拒绝，跨公司或跨门店能力不匹配会拒绝。
- `operations-api` 增加基础资料读取和三类保存接口；旧用户名会话仍保持只读，只有 Supabase Auth 账号及其明确能力可以写。未增加页面入口，原表月报首页、财务上传方式和“不读取美管加”边界保持不变。
- 新增 Sprint 1 专项回归并接入 CI/pre-push。本机隔离 PostgreSQL 15 已实际执行整份迁移，并验证允许写入、越权拒绝、修改原因、审计快照、授权读取及跨公司 RLS 隔离；完整 pre-push 及生产只读 `db lint --linked` 均通过，临时数据库测试完成后已删除。
- 当前仅本地开发：未执行生产迁移、未部署函数、未发布页面、未创建或修改生产业务数据，也未重试此前被安全审查拦截的功能分支推送。既有生产迁移时间戳差异仍须在任何生产 Gate 前单独解决。

## 2026-08-20 · v420 Gate D P0 安全修复（本地候选，未发布）

- 修复 Gate D 追溯修订审计事务：`zysyr_audit_events.channel` 从不允许的 `web` 改为约束允许的 `api`，避免保存追溯时整笔事务回滚。
- 修复消费凭证登记字段：Edge Function 改写 `immutable_version=1`，与 Gate A 已部署字段一致，不再写不存在的 `version`。
- 旧用户名经营会话不再获得费用写权限；只有 Supabase Auth 账号同时持有 `expense.create_submit` 能力才可保存或导入费用。
- 费用新增、更新与历史导入统一写入并过滤 `company_id/store_id`，同时保存创建人/更新人的 V2 账号 UUID；新增记录保持 `draft`，不冒充已提交或已审批。
- 已同步 GitHub `main` 的 v418 员工档案/上传校验修复到功能分支并保持 v419 经营候选内容；当前统一提升为 v420 候选。线上站点 `version.txt` 已是 v418，但经营驾驶舱页面仍是 v417；未执行迁移、函数部署或 v420 页面发布。
- 远端只读复核仍确认 10 组本地/生产迁移时间戳不一致，v418/v419 两个迁移只存在本地。生产 Gate 前必须逐组验证映射并在预演库执行，禁止直接 `db push` 或盲目 `migration repair`。

## 2026-08-13 · v419 Gate D 月报单元格级追溯（本地候选，未发布）

- 每次报表上传同时保存金额/公式单元格、工作表、A1 坐标、原表行列、显示值、公式和本表前置单元格；报表版本、单元格与公式关系在同一数据库事务中登记。
- 月报输入数字可由财务选择当月日报/业绩表的具体数字及具体凭证，生成不可覆盖的追溯修订；系统核对来源合计与月报金额，差额超过 0.01 元、缺凭证或未关联均明确标红。
- 股东点击月报任一金额可查看计算公式、组成数字、来源日期、原 Excel 行列、上传人、上传时间和凭证；财务在同一抽屉补全或修订映射。
- 新增按公司/门店隔离的 RLS 表、仅 service role 可调用且重新校验财务范围的注册/追溯 RPC，并把报表、单元格、修订、来源和凭证写入 Gate A 追溯图与追加审计。
- 当前仅为本地候选：未执行生产迁移、未部署 Edge Function、未发布页面。

## 2026-08-13 · v418 ZYSYR 原表月报纠偏（本地候选，未发布）

- 经营驾驶舱首页改为用户原始月度盈亏表网格，去掉营业额卡片、自动趋势和业绩排名；“美发收入”等栏目保留，但仅展示财务上传原件中的值。
- 经营接口移除美管加查询，新增按公司/门店隔离的财务报表版本、私有原 Excel、SHA-256、审计和消费凭证关联；同日同类重传追加版本，不覆盖历史。
- 财务每天从页面上传日报、业绩表及消费凭证，每月上传盈亏表；股东只读切换授权门店/月，并可追溯到原报表和私有凭证。
- 此版本只在本地验证，未提交、未推送、未执行数据库迁移、函数部署或页面发布。

## 2026-08-13 · v417 ZYSYR Gate C3 管理员创建财务账号

- 经营驾驶舱新增仅授权管理员可见的“财务账号”入口，可直接设置用户名、显示名称、密码，以及全部门店或指定门店范围；财务登录继续只填写用户名和密码，不要求业务邮箱。
- 新增 `operations-auth-admin`：只接受 Supabase Auth 用户 JWT，并再次通过 `operations-auth` 的 RLS 结果确认公司范围 `finance_account.create` 高风险能力。密码只交给 Auth Admin，不写入旧 `staff.password_hash`、经营数据库、审计、日志或响应。
- 新增原子 Gate C3 迁移：精确向已激活 `admin` 公司范围股东账号授予创建能力；完成 RPC 仅 `service_role` 可执行，并在同一事务创建 V2 账号、财务范围授权及不可变审计。Auth 已创建而数据库失败时会回查或删除新 Auth 用户，避免半账号。
- `operations-auth-migrate` 支持管理员直接创建的财务 Auth 账号用用户名密码登录；`operations-auth` 返回稳定登录名；`operations-api` 接受并逐次复核用户 JWT、角色、能力和公司/门店范围。Auth 股东的费用写入改为服从 V2 `expense.create_submit` 能力，不再从旧角色文字推断。
- 生产迁移登记为 `20260813091814_zysyr_finance_account_admin_gate`；迁移后创建能力 1、管理员有效授权 1、启用审计 1、财务账号 0、Auth 用户 1。完成 RPC 对 `public/anon/authenticated` 无执行权限，仅 `service_role` 可执行。
- 四个生产函数均为 `ACTIVE` 且与仓库源码一致：`operations-auth` v2（JWT）、`operations-auth-migrate` v2（自定义密码入口）、`operations-api` v3（兼容旧会话与 Auth JWT）、`operations-auth-admin` v1（JWT）。未登录探针分别返回预期 401/400/403，未创建测试财务账号。
- 发布版本提升到 v417；员工端与前台只同步版本和既有缓存标记，不改变预约、客户、收银或美管加业务逻辑。

## 2026-08-11 · v416 ZYSYR Gate C2 双通道认证过渡

- 现有 `operations.html` 登录框保持“用户名 + 现有密码”，不要求邮箱；旧经营接口先验证账号并建立兼容会话，只有旧接口确认的股东账号才进入 Supabase Auth 滚动迁移，普通员工不会调用迁移端点或产生无效限流事件。
- 新增独立 `operations-auth-bridge.js`：首次迁移后立即调用受用户 JWT 与 RLS 保护的 `operations-auth`，必须同时确认 `shareholder / company` 角色和 `dashboard.group.read / company` 能力；不使用 service role、旧密码摘要或 JWT user metadata 授权。
- 浏览器认证桥保存并轮换 Supabase access/refresh token，过期前刷新并用新 refresh token 原子覆盖旧值；退出时立即清除本地 token，并与旧经营会话一起执行本地范围注销。
- Auth 暂时不可用时股东仍可使用已验证的旧经营会话，页面明确显示“旧登录过渡”，避免营业中断；成功后显示“Supabase Auth 已验证”。现有收入只读、美管加边界、费用/凭证和门店范围继续由原经营接口承载，未提前重写数据层。
- `operations-auth` version 1 已部署为 `ACTIVE` 且 `verify_jwt=true`；无 Authorization 请求由 Supabase 网关返回预期 401。新增桥接模拟回归覆盖首次迁移、V2 范围核对、refresh token 轮换、恢复与双会话退出。
- 发布版本提升到 v416；`perm-app.html` 只同步版本和三个既有资源缓存标记，`frontdesk.html` 只同步页面版本，不改变员工端、前台、预约、收银或美管加业务逻辑。

## 2026-08-11 · ZYSYR V2 Gate C1 用户名/现有密码滚动迁移（已生产部署，App 保持 v415）

- 用户确认不填写邮箱，继续使用现有用户名和密码；新增独立 `operations-auth-migrate`，只对显式白名单账号做一次旧密码校验，再由 Supabase Auth 以同一密码重新加密保存，内部不可投递邮箱不展示为业务联系方式。
- 新增迁移源码 `20260811035138_zysyr_auth_rolling_migration.sql`：账号增加稳定登录名，新增带审批溯源的精确迁移白名单、只保存 HMAC 指纹的 append-only 限流事件，以及三个仅 `service_role` 可执行的原子迁移函数；基础迁移本身不预置任何白名单或用户。
- 每个用户名 15 分钟最多 5 次、每个客户端最多 30 次，并分别以事务锁串行计数；错误统一响应以阻止账号枚举。首次激活会复核公司、员工、旧 ID、在职状态、Auth metadata、角色和范围，原子创建账号/授权并记录 `legacy_password_auth_activated` 审计事件。
- 新增精确迁移 `20260811040207_zysyr_gate_c1_admin_shareholder_allowlist.sql`，只批准 `admin / ziyou` 与 `哈维 / xiangli` 两个既有管理员，以股东公司范围滚动迁移；执行前锁定 7 个查看/提问能力，审批记录和两条 allowlist 审计可追溯，不预创建 Auth 用户、账号或角色授权。
- 生产已登记 `20260811040423_zysyr_auth_rolling_migration` 与 `20260811040458_zysyr_gate_c1_admin_shareholder_allowlist`；白名单 2、审批审计 2、异常映射 0，两张控制表强制 RLS、浏览器权限 0，三个迁移 RPC 仅 `service_role` 可执行。
- `operations-auth-migrate` version 1 已部署并为 `ACTIVE`，线上源码与仓库逐字符一致；CORS 200、未知操作 400、非白名单假账号统一 403，探针事件仅保存 HMAC。Gate C Advisor 无 ERROR，只有无浏览器策略和新索引未使用的预期 INFO。
- 部署后 Auth 用户、V2 账号、有效角色授权和激活审计仍为 0；旧员工 28、美管加同步记录 1,083、旧经营会话 7、费用/凭证 0。未修改 `operations.html`、旧 `operations-api` 或业务数据，管理员尚未本人首次迁移登录。

## 2026-08-11 · ZYSYR V2 Gate B 公司/门店/员工映射（已生产部署，App 保持 v415）

- 用户批准将现有两店归入公司 `ZYSYR`（代码 `zysyr`）：向里造型代码 `xiangli`、自由手艺人代码 `ziyou`；迁移按门店唯一名称定位并使用数据库生成 UUID，不写死环境 UUID。
- 新增原子迁移 `20260811033042_zysyr_gate_b_company_store_employee_mapping.sql`，生产登记为 `20260811033600_zysyr_gate_b_company_store_employee_mapping`：已创建 1 个公司、更新 2 个既有门店、从旧 `staff` 映射 27 名员工（24 在职、3 离职）、建立 24 条当前主门店归属、27 条旧 ID 映射和 1 条 append-only 审计事件。
- 唯一无门店且无业务使用的 `staff.id=26 / test_staff` 明确排除，旧 `staff` 全表保持不变；未知入职/离职日期保持 `NULL`，归属生效日仅表示 V2 映射启用日，不冒充员工入职日。
- 不创建 Supabase Auth 用户、账号映射、角色或能力授权，不部署 Edge Function、不切换登录、不修改页面；美管加、经营会话、费用和凭证只做事务前后计数保护，不作为会随同步变化的固定条数前置条件。
- 生产执行前同步数据已自然增长到 1,082 条美管加记录和 5 条旧经营会话；迁移前后两者分别保持 1,082 / 5，旧员工保持 28，费用/凭证/Auth 用户保持 0。写后验证员工、归属和旧 ID 关联错配均为 0；17 张 Gate A 表继续强制 RLS、匿名授权为 0，Advisor 无 ZYSYR ERROR 或缺失外键索引。

## 2026-08-11 · ZYSYR V2 Sprint 0 Auth/RBAC 基础（Gate A 已部署，App 保持 v415）

- 新增 additive 迁移 `20260811024016_zysyr_v2_sprint0_auth_rbac_audit.sql`：建立公司、Supabase Auth 账号映射、角色/能力/范围授权、员工门店归属、append-only 审计/工作流/锁账事件、Trace 基础和旧费用/凭证的可空 UUID 租户桥接字段。
- 权限矩阵以 V2.0 为准：股东只有授权范围查看能力，不再获得费用录入、审核或凭证上传能力；财务可录入/审核，店长只能提交本店费用。按授权例外使用独立的 user capability grant，不从岗位文字或 JWT user metadata 推断。
- 新增 `operations-auth` Edge Function 本地源码：只验证 Supabase access token，并用同一用户 JWT 查询受 RLS 保护的账号、角色、能力和门店；不读取旧 `staff.password_hash`，不使用 service role 代用户查询。
- Gate A 已作为生产迁移 `20260811031221_zysyr_v2_sprint0_auth_rbac_audit` 应用；17 张新表全部启用并强制 RLS，6 个私有鉴权函数、3 个 append-only 触发器和 14 条策略存在，匿名角色对新表授权为 0。生产前后始终为 2 店、28 名员工、1,080 条美管加记录、4 条旧经营会话、0 条费用、0 条凭证、0 个 Auth 用户。
- 生产 Advisor 随后精确发现 3 个外键缺少左前缀覆盖索引：角色授权 `role_id`、能力授权 `capability_id`、锁账事件 `(company_id, period_lock_id)`。此前本地“缺失外键索引为 0”的检测条件不够严格，现已更正检测并将补丁登记为生产迁移 `20260811032136_zysyr_sprint0_fk_covering_indexes`；三个索引定义已逐项核对，目标外键缺失索引和对应 Advisor 告警均为 0。
- 本次没有部署 Edge Function、创建 Auth 用户、回填公司/门店/员工映射、切换登录或修改页面/业务数据；现有 v415 和美管加收入只读边界保持不变。既有 `staff` 等 7 张 public 表 RLS 风险继续单独登记，未在 Gate A 顺手修改。

## 2026-08-10 · v415

- 修复经营驾驶舱把美管加同一消费单内的技师、助理也重复计入业绩的问题；服务端现在读取当前门店在职员工岗位，只允许岗位明确包含“发型师”的人员进入业绩汇总。
- 每张消费单只归属 `staff` 列表中第一位能够唯一匹配的发型师；同单后续技师、助理或第二位发型师不会再次累加金额和单数。所有参与人员仍保留在消费明细中，不修改美管加原始记录。
- 前端“员工业绩 / 按参与流水”改为“发型师业绩 / 每单只归一位发型师”；新增回归覆盖发型师在技师之后、姓名别名、技师单独参与和同单两位发型师四种情况。
- 本次无数据库迁移，不修改费用、凭证、客户、消费、预约或收银数据；只更新 `operations-api` 的只读计算口径。
- `operations-api` 已由生产 version 1 更新为 version 2，状态 `ACTIVE` 且部署源码与仓库一致；未登录探针继续返回预期 403。按新口径只读复算的当月榜单只包含发型师岗位，技师/助理账号不再出现。

## 2026-08-10 · v414

- 新增独立 `operations.html` 经营驾驶舱，复用现有员工账号并按股东、财务、店长、员工四类视角限制门店和数据范围；股东可切换门店，普通员工只查看本人参与的美管加已同步流水。
- 收入只读读取 `mgj_service_records`，点击数字可下钻到日期、客户、员工、项目、美管加单号和同步时间；费用写入独立经营账，不执行美管加付款、退款、充值或其他收银写操作。
- 新增费用录入、CSV 历史费用导入和私有凭证中心；重复导入按内容指纹跳过，未上传凭证的费用进入醒目的“即时待补凭证”队列，JPG/PNG/PDF 使用 5 分钟签名链接查看。
- 新增 `zysyr_stores`、经营会话、费用、凭证元数据四张服务端专用表及私有 `zysyr-vouchers` Storage 桶；全部表启用 RLS，撤销浏览器角色权限，只允许受保护 Edge Function 的 `service_role` 访问。
- 后台增加“经营驾驶舱”入口，并新增静态回归保护角色范围、门店隔离、收银边界、历史导入、私有凭证、RLS 和显式权限。
- 同步修正前台页面遗留的 v412 文档标记为 v414；仅更新发布标记，不改变前台业务逻辑或收银边界。
- 员工端三个外部知识/训练脚本的缓存标记统一为 v414，避免新版本页面继续命中旧 v412 资源；脚本内容本身未修改。
- 生产已登记迁移 `20260810022101_zysyr_operations_foundation.sql` 并部署 `operations-api` version 1；只读核验四表 RLS 开启、浏览器角色无表权限、凭证桶为 private，未登录探针返回预期 403，费用和凭证仍为 0 条。
- Supabase 顾问没有出现本次对象的新 ERROR；服务端专用表“RLS 开启但无浏览器策略”属于预期提示。旧公共表已有的 RLS 告警未在本次扩大处理。

## 2026-08-06 · 美管加同步第一阶段稳定性（v412 运行维护）

- 客户与预约同步只对超时、断连、HTTP 408/425/429 和 5xx 做最多两次短间隔重试；400/401/403 等确定性错误不盲目重放。
- 两类同步增加 105 秒运行预算，在本机 120 秒任务上限前主动结束；预约删除仍只允许作用于已成功读取的“门店 + 日期”，未读取日期绝不删除。
- 客户增量同步仍每批最多 8 人，其中最多 2 个名额优先处理本机权限 600 的失败补偿队列；第五次仍失败转人工检查，不无限重试，也不清空既有套餐或消费历史。
- 健康巡检增加重复调度、连续部分失败、补偿队列积压和人工检查任务检测；正常客户同步唯一来源改为系统 crontab 的 `02/32`，重复 Hermes 客户同步任务停用。
- 健康巡检的源码哈希基准改回当前唯一仓库，不再引用 7 月 29 日的旧隔离工作树，避免部署正确后仍误报运行副本漂移。
- 本次不修改数据库结构、客户档案、套餐、消费、预约或收银业务数据；向里造型护理自动出库继续关闭，App 版本保持 v412。

## 2026-08-06 · v412

- 前台客户档案搜索与详情补齐严格门店隔离：客户主档、历史导入、美管加实时消费三类查询均由服务端按当前登录账号所属门店过滤。
- 套餐余项和客户主档内嵌消费历史增加第二层门店校验；即使上游数组混有明确标注为其他门店的项目，也不会返回给当前门店前台。
- 普通前台和分店管理员仍固定所属门店，不能通过请求参数切换；总管理员保留主动选择门店后查看该门店数据的能力。本次不修改客户、套餐、消费或收银数据。

## 2026-08-06 · v411

- 修复 v410 入口遗漏：“今日预约 → 编辑当天客户信息”现已增加“实际金额（元）”和“金额说明”，与客户数据表编辑入口使用同一份当日接待数据。
- 打开已有当天记录时会正确回填金额和说明；新建接待不会自动复制美管加消费金额，避免把上游消费误写成前台手工金额。
- 今日客户详情同步展示前台“金额 / 说明”；保存继续使用与客户数据表相同的金额范围和两位小数校验，不写回美管加收银、客户主档或历史导入原始行。

## 2026-08-06 · v410

- 客户数据表“编辑前台数据”新增“实际金额（元）”和“金额说明”，历史导入与当日接待两类记录均可编辑，表格会同时显示金额数字与付款、优惠或套餐扣次说明。
- 金额由服务端校验为非负数字并最多保留两位小数，金额说明最多500字；保存继续记录最近操作人和时间。
- 历史导入只更新前台台账字段，原始上传行 `raw_row` 保持不变；当日接待金额同样只属于前台独立数据，不创建或修改美管加收银单、客户主档、套餐或消费记录。

## 2026-08-06 · v409

- 客户档案和客户数据表统一支持“手机号后4位”查询：输入正好4位纯数字时，只匹配手机号结尾，不再误匹配项目、金额、日期或手机号中间数字。
- 客户数据表的后4位筛选改由受设备会话与门店范围保护的云端接口查询“当日接待”和“历史导入”，避免只在页面已加载的最近记录中筛选而漏掉旧年度数据。
- 同一后4位对应多个完整手机号时保留并显示全部不同客户，不合并、不自动选人；姓名、完整手机号、项目和员工等原有查询方式继续可用。

## 2026-08-05 · v408

- 前台客户数据表支持编辑“项目、发型师、技师、助理”：当日接待与历史导入均可补充修改，并记录最近操作人和时间；客户、日期、金额、原 CSV、美管加数据及后台客户主档保持不变。
- 今日接待表单补齐技师和助理字段；发型师时间表启用明确的横向滚动、iPad 惯性滑动和左右翻页按钮，解决只能上下滑动、难以查看后续时段的问题。
- 前台登录页新增注册入口，申请固定为“前台”岗位和 `pending` 状态，仍需管理员在现有“注册审核”通过后才能登录；密码仅保存 SHA-256 摘要。
- 后台新增“前台管理”，按管理员门店权限查看前台账号、已登录设备、导入批次和最近前台数据，并可让指定设备退出；分店管理员只能查看自己的门店。
- 修复短手机号/预约尾号查询客户详情：尾号只对应一个完整手机号时安全归并，存在冲突时再用客户姓名消歧，并兼容“女士 / 小姐”称呼，因此朱女士尾号 3360 的 4 个有余项套餐可在前台正常显示。
- 只读健康核查确认美管加预约、客户、会话、护理队列与运行副本均正常；朱女士客户主档已有 9 条套餐记录（4 个有余项），问题来自前台匹配规则，不是同步功能损坏，未修改或伪造任何套餐、消费或收银数据。

## 2026-08-05 · v407

- 前台客户中心改为电脑大屏优先布局，同时保留 iPad 横屏适配；登录设备继续记住会话和所选分店。
- “历史导入”升级为客户数据表，按真实表格列展示“当日接待”和“历史导入”两类记录，支持来源筛选、关键词筛选和门店切换后重新读取。
- “添加当天信息”保存后立即出现在客户数据表；当天接待可继续编辑，历史导入保持只读，两类信息均不覆盖美管加或后台客户原始档案。
- 客户详情强化手机号标准化匹配，并优先显示可识别的套餐名称，减少已有消费记录或套餐余项未被前台详情正确呈现的情况。
- 生产只读核查“无名 / 朱女士”：客户档案已有 36 条历史明细和 4 个有余项套餐；当天 11:00 预约已同步，但当天新消费单尚未从美管加数据源回传，因此不手工伪造或覆盖消费数据。

## 2026-08-05 · v406

- 前台“发型师时间预览”首次进入时固定从当天最早营业时段开始，不再自动跳到当前时间，早上已经过去的时间格和客户记录可直接看到。
- 已完成服务继续保留在当天对应发型师与时间格内，并维持绿色完成状态；页面刷新时保留前台当前手动查看的位置。
- 页面说明明确“已过去时段和已完成客户都会保留”，并增加回归检查，防止以后重新引入自动跳过早间时段或隐藏完成客户的行为。

## 2026-08-05 · v405

- “今日客户”升级为 iPad 发型师时间预览表：纵向固定显示当前分店的在职发型师，横向从 10:00 到 22:00 按 30 分钟分格，并支持横向滑动、固定时间表头和当前时间红线。
- 美管加真实预约、前台当天登记和已消费记录继续合并显示；不同接待状态使用待到店、已到店/服务中、已完成和取消颜色，点击客户卡仍可查看套餐余项、消费汇总与全部已同步明细。
- 美管加没有客户姓名和手机号的空工位占位不再误显示成“未填写客户”，改为参考预约表的蓝色手掌可登记时段；点击手掌或其他空白时间格直接带入发型师和时间添加当天客户。
- 增加美管加发型师显示名与员工账号的安全别名归并，例如唯一匹配的“郭小康”归到员工“小康”，避免同一发型师拆成两行；不能唯一判断的姓名保持原样，不做猜测绑定。
- 当天接待记录新增独立到店时间，旧记录没有该字段时继续按创建时间显示；该时间仅用于前台时间轴，不修改后台客户档案，也不写回美管加预约或收银数据。

## 2026-08-05 · v404

- 固定 iPad 前台改为长期设备登录：首次登录后持续有效，只有主动退出、员工停用/离职或前台权限撤销才重新登录；每次访问仍由服务端复核账号状态和最新门店权限。
- 增加多分店规则：普通前台和分店管理员固定所属门店，总管理员可在页面顶部切换分店，iPad 会记住上次选择；所有今日数据和新增接待记录均由服务端按分店过滤。
- “今日客户”改为按发型师分组，合并美管加预约、消费记录和前台当天登记；点击任一客户可直接查看当天信息、美管加消费汇总、套餐余项和全部已同步消费记录。
- 新增独立“添加今日客户”入口，记录客户姓名、手机号、发型师、到店来源、意向项目、当前状态和当天备注；该记录不覆盖后台客户档案，也不写入美管加收银单。
- 新增受保护的 `frontdesk_today_customers` 表，开启 RLS 并撤销浏览器角色权限；写入仅经过前台服务接口，保留创建人、门店、营业日期和更新时间。
- 前台调用按当前 Supabase API 规范仅在 `apikey` 头发送 publishable key，不再把 publishable key 误作 Bearer token。

## 2026-08-05 · v403

- 新增 iPad 横屏“前台客户中心”：独立登录后可查看今日预约、美管加已消费记录和两者匹配状态，每分钟在前台可见时自动刷新。
- 新增按姓名/手机号查询的客户档案，集中展示美管加到店次数、档案总消费、全部已同步消费时间线和醒目的套餐余项；历史表格与美管加数据标明来源，避免金额混算。
- 客户存在消费/到店汇总但美管加尚未回传逐笔明细时，档案内显示醒目缺口提示，不再把可用记录误称为完整历史。
- 明确功能边界：付款、退款、充值继续由美管加完成，本端只做客户查询、接待辅助和历史档案补充，不重复建设收银流程。
- 新增店长/管理员专用 CSV 历史导入，支持原表的消费日期、券码、姓名、手机号、项目、发型师、技师、助理及消费金额/扣卡说明，导入前预览并按行指纹防重复。
- 新增受保护的 `frontdesk-api`、独立前台会话以及开启 RLS 且仅 `service_role` 可访问的导入表；公开浏览器不持有服务角色密钥，也不能直接提交历史数据。
- 后台右上角新增“打开前台”入口，并增加前台页面、权限边界、RLS、导入批次与 iPad PWA 配置的 CI / pre-push 回归测试。

## 2026-08-01 · v402

- 修复 iPhone/PWA 点击“有新版本”后退出重进仍反复要求刷新的问题：更新按钮现在先解除旧 Service Worker、强制获取并核验目标版本页面，确认新文档可用后才跳转。
- 不再在新页面真正加载前提前写入“已更新”版本号；获取失败时保留可重试提示，避免本机版本记录与实际页面版本不一致。
- 从版本化地址成功进入后会后台刷新标准 App 入口缓存，降低手机桌面再次打开旧文档的概率；仍不在用户填写业务表单时自动强制刷新。

## 2026-08-01 · v401

- “我的任务”不再隐藏超过30天但尚未完成发型师回访的发质分析表；待技师填写、技师已完成、待发型师回访及旧版无回访证据记录会持续显示，直到真正完成回访。
- 30天显示范围现在只作用于已具备 A/B/C 评定或本单回访截图、且状态为“回访完成”的历史记录。
- 生产只读核验发现此前有11条未回访任务被隐藏；本次仅修正读取展示规则，不修改、补写或删除任何云端记录。

## 2026-08-01 · v400

- 修复“我的任务”日期分组展开高度固定为 2000px、较多记录被截断的问题；“更早 46 条”展开后现在可完整查看全部 46 条。
- “待技师填写”改为橙色高对比状态标签，卡片操作区的等待提示同步加粗高亮，便于发型师快速识别仍在等待技师处理的任务。
- 本次只调整任务列表展示，不修改发质记录数量、30 天可见范围、状态判定或云端数据。

## 2026-07-31 · v399

- 发质分析表不再在云端响应前显示“已保存”；现在写入 `hair_records` 后按同一档案编号回读，并逐字段确认完整原表一致，只有核验通过才显示成功。
- 本地存储空间不足或写入异常时不再中断云端保存；云端失败会保留本机草稿并显示明确的重试状态，两端都失败时阻止关闭页面并提示不要刷新。
- 本地待上传记录改为写入并回读完整 `hair_records`，不再降级成字段不完整的旧分析队列记录。
- 同一顾客每次到店继续新增独立档案；网络重试固定复用本次档案编号，既不覆盖历史，也不重复生成新表。

## 2026-07-30 · v398

- 预约页“查看方案”现在携带本次预约编号和日期，发质档案按预约编号优先、同手机号同服务日兼容匹配，不再只按顾客取最近一张表。
- 本次预约存在云端发质分析记录时，方案内明确显示“打开完整发质分析原表”，并复用保存发质表的同一套页面和字段加载完整记录。
- 完整原表以只读档案模式打开，隐藏保存入口并阻止自动保存；查看档案不会改写历史数据。
- 未找到本次预约记录或加载失败时显示明确提示，不再静默空白。

## 2026-07-30 · v397

- 客户档案不再只读取最新 200 条发质分析表；改为每页 1000 条持续分页，直到读取全部有效云端记录。
- 单顾客发质记录查询复用完整分页结果后再按手机号/姓名匹配，避免较早记录因全局前 100 条截断而漏档。
- 旧版已完成发质分析队列同样改为分页读取；不包含已删除记录，不修改任何历史数据。
- 缺少手机号和姓名的历史表不会丢弃或猜测归属，统一显示在“待关联顾客”档案组，等待人工确认。

## 2026-07-30 · v396

- 预约页只显示有姓名或手机号的真实顾客预约，不再把美管加空白工位占位显示成“待定”；源预约记录保留，不执行删除。
- 消费账单读取改用具备只读账单权限的隔离会话，总部客户/预约会话与护理出库写入边界保持不变；近期账单明细按 45 天窗口轮换，新增小批量对账刷新模式。
- 护理执行器补回 Supabase 短暂故障重试，以及“美管加已审核但完成状态回写失败时禁止重复出库”的保护。
- 新增美管加同步健康巡检，检查预约/客户/双会话新鲜度、运行副本哈希、护理队列和对账数据；向里造型自动出库继续强制关闭。
- 常规客户同步批次由 20 人降为轮换 8 人，避免超过 Hermes no-agent 120 秒执行上限并留下假性 running 状态。
- 健康巡检允许 10 分钟内的正常 running 窗口，超过 10 分钟才判定疑似卡住，避免同步执行中的瞬时误报警。

## 2026-07-23 · v393

- 发质分析表新增选填的“服务前 / 服务后”照片留档，手机可直接拍照或从相册选择，并在保存前自动压缩。
- 两张照片随当前 `hair_records.record_data` 保存，编辑旧档案时不会误删，顾客历史档案可按本次服务查看前后照片。

## 2026-07-23 · v392

- 顾客“AI分析建议”改用独立的 HTTPS Codex plan_server 配置，不再复用美感训练 Edge Function，也不再请求已失效的店内固定 IP。
- 重复点击分析时只保留一个进行中的请求；再次尝试会清除旧错误提示，并对 405、连接失败和超时显示明确的 Codex 服务状态。

## 2026-07-23 · v391

- 暂时隐藏发质分析表中的照片上传和 AI 照片诊断区域；保留后台能力和历史数据，人工发质判断与软化方案流程不受影响。

## 2026-07-21 · v390

- 发质分析表“从预约选择客户”每次打开都定位到手机本地当天日期，不再沿用上次查看的旧日期；前后翻日和手动选日保持不变。

## 2026-07-21 · v389

- 取消员工端工作台菜单中的“美感训练”入口；训练页面、历史数据和后台能力继续保留，便于后续按需恢复。

## 2026-07-16 · v387

- 员工端“美感训练”升级为“美感成长 V2”：每天根据个人弱项生成不同挑战，并轮换美学、技术、顾客、反证和大师五种导师模式。
- 新增每七个连续训练日出现一次的隐藏 Boss；同一图片继续轮换人物、风格、结构、适配和顾客异议，不再重复同一套问法。
- 修复“回答过就算完成”：服务端要求至少两个位置明确的有效证据，并建立证据、判断与设计影响的关系；未达到时留在当前检查点继续追问。
- AI减少空泛表扬，优先使用反证、相邻风格对比、变量变化和失败条件制造认知冲突。
- 每次完成固定输出新知识、新观察方法、沟通技巧、大师洞察、成长标签、昨日对比和下次挑战；大师洞察不得重复历史记录。
- 新增长期成长档案，记录五项能力、重复盲点、洞察历史、成长标签和大师值；本机即时保存并随训练 Session 同步云端快照。
- `aesthetic-coach` 与 `aesthetic-learning` 已部署，真实接口验证低证据回答保持 `incomplete`，不会错误推进检查点。

## 2026-07-14 · 护理出库双账号隔离（不发版）

- 总部客户/预约同步与自由手艺人护理出库改用两套独立美管加会话，避免 Cookie 续期时相互覆盖。
- 护理出库新增独立会话保活任务，每30分钟校验，仅在失效时使用分店凭据重登。
- 保持现有门店、员工、产品、幂等和创建/审核/回查保护不变。

## 2026-07-14 · 美管加库存连接器 MVP（不发版）

- 完成 Hermes 美管加库存对接审计，区分当前已验证、历史可用但已陈旧、被 WAF 阻断及尚未验证的接口能力。
- 新增服务端库存连接器内核：凭据仅从本机读取，所有门店、商品、数量、角色、批准和幂等条件通过后才可能进入写入阶段。
- 通用库存写能力默认关闭；网络结果不明确进入人工复核，禁止盲目重试和直接覆盖库存余额。
- DeepSeek 只生成字段映射和异常解释建议，不能批准、决定或执行库存数量变更。

## 2026-07-14 · v386

- 员工 APP“我的任务”新增待补开入口，只显示本月分配给本人的真实未开单烫染护顾客。
- 补开表自动带入并锁定美管加顾客、服务日期、项目、金额和门店；员工补充专业内容后生成正常发质表，并自动进入后续回访流程。
- 补开记录保存美管加来源 ID，提交成功后回写任务完成和发质表 ID，防止同一账单重复补开。
- 后台未开单列表新增转交和“无需开单”操作；无需开单必须填写原因，并保留处理时间。
- 生产数据库新增补开任务状态、负责人、发质表关联、处理原因和更新时间字段；本月 77 条任务中 74 条已按员工职位自动识别负责人，3 条等待后台转交。

## 2026-07-14 · v385

- 未开单对账改为只显示本月记录，不再加载最近 90 天历史。
- 根据消费项目名称与标准类型双重识别烫、染、护，排除剪发、洗吹等非目标项目；金额作为核对信息展示，零金额疗程扣次仍保留。
- 本月汇总新增烫/染/护单量、消费金额、已开单和未开单数量。

## 2026-07-14 · v384

- 修复已开单顾客被误标为“未开单”：对账同时识别预约日期、到店日期、服务日期和填写日期，并允许跨午夜结账前后 1 天。
- 手机号仍是首要身份条件；只有同一顾客在合理服务日期内没有任何发质分析表时，才进入未开单列表。

## 2026-07-14 · v383

- 后台将“未开单”和“未回访”拆成两条独立工作线，分别统计和展示，不再混入同一个待处理概念。
- 未开单对账按“门店 → 发型师”分组，并增加门店、发型师、开单状态筛选；未回访列表同样按门店、发型师分组。

## 2026-07-14 · v382

- 美管加客户同步新增烫、染、护账单标准化：仅根据真实账单项目名称分类，使用美管加账单 ID 幂等写入独立对账表。
- 后台“发质任务”新增最近 90 天自动对账，按手机号与服务日期匹配发质分析表，直接显示漏单顾客、项目、时间、门店、员工、单号和金额。
- 分店管理员只能查看本店对账；美管加明细表未迁移或单次写入失败时，原有预约和顾客档案同步继续运行，不会被新模块阻断。
- 新表尚未可用时，后台自动从现有 `customer_profiles.service_history` 生成对账记录，迁移分阶段上线期间仍可使用。
- 生产迁移完成后回填 691 条已有烫染护账单；最近 90 天形成 153 条可对账记录，其中 68 条匹配发质分析表、85 条进入疑似漏单列表。
- 根据美管加当前消费明细页的真实 Network 请求修复会员详情同步：员工 ID 改为读取当前会话 `userId`，会员详情请求统一使用总部 `shopId=1103470`，不再发送失效的旧员工 ID 和分店 shopId。
- 更换为当前美管加账号并完成线上验证：会员详情 403 已解除；增量同步 19/20 成功并新增 20 条烫染护记录，历史缺失回填 20/20 成功并新增 5 条烫染护记录。未找到的 1 人为美管加源系统无该手机号。

## 2026-07-13 · 美学知识每日收集（不发版）

- 新增 8 个已登记白名单来源，覆盖中文形象风格流派、CMB 地区版本、Kibbe 出版书目、CIE/ISO 色彩标准与面孔第一印象研究。
- 新增 macOS 每日 02:30 LaunchAgent；从本机受保护环境读取 DeepSeek 配置，候选写入独立待审核目录。
- 自动收集具备进程锁、内容哈希去重、来源失败隔离和日志记录；只生成 `pending_review` 候选，不自动修改正式知识、DSS、Prompt 或评分标准。
- 首次手动运行已生成 4 条 DeepSeek 结构化候选；失败或暂未完成的来源留待下一轮继续，不降低审核门槛。

## 2026-07-13 · v381

- 美学研究院全部 AI 流程切换到 DeepSeek，不再依赖 OpenAI Key。
- `deepseek-v4-flash` 作为批量收集、整理和低成本结构化处理模型；`deepseek-v4-pro` 负责形象设计适用性初审、独立训练质量评审和策略候选审核。
- DeepSeek Key 仅保存为 Supabase 服务端 Secret，不进入前端、仓库、日志或知识导出文件。
- 保留专家审核、案例验证和版本发布硬门槛，模型切换不赋予 AI 自动批准或自动发布权限。

## 2026-07-13 · v380

- 将总后台“美感知识”升级为“美学研究院”，建立收集、AI 初审、形象设计适用性审核、案例验证、专家审核和版本发布流水线。
- 知识候选新增领域、来源类型、作者/机构、年份、原文定位、A–E 证据等级、AI 初审结果、六项适用性和案例验证状态。
- AI 初审区分事实、理论、流派定义、实践、趋势、营销和假设，并列出来源能证明/不能证明的内容、争议、缺口及审核问题；AI 不能自动批准或发布。
- 专家审核新增人物分析、风格识别、设计动作、发型映射、训练方法和评分标准六项适用性；进入试用前必须复核 AI、适用性、版权和安全边界。
- 案例证据支持正例、反例、边界与失败案例，记录支持/反驳/不确定结果和图片授权状态。

## 2026-07-13 · v379

- 将“九型风格 + 风格美学”第一阶段研究纳入正式美感训练知识库：新增视觉基础、人物分析、风格识别、设计语言、发型映射、训练方法和评分标准七个领域。
- 明确区分当前 DSS 发型九型、中文个人形象八型、待确认的中文九型以及 Kibbe/九型人格等独立体系；未确认的第九型保持 `provisional`，不参与自动评分。
- 新增 A–E 证据等级、知识条目状态机、来源登记、机器 Schema 和外貌推断安全边界。
- 对话教练按需接收知识底座；继续用 DSS 九型完成发型归纳，同时只把中文八型作为有来源的比较知识。

## 2026-07-13 · 首批知识候选（不发版）

- 新增 30 条内部原创美学起始候选，覆盖观察边界、轮廓重量、层次纹理、风格归纳、人物适配和顾客沟通。
- 每条候选包含判断依据、适用与不适用边界、正例和反例，统一保持 `pending_review`，不会自动进入正式知识或评分标准。
- 种子迁移按标题与提交批次防重复，可安全重复检查；未加入药水、软化、温度等缺少现场专业标准的技术参数。

## 2026-07-13 · v378

- 建立云端美学知识获取闭环：候选知识记录客观事实、判断、依据、适用条件、不适用条件、正例、反例和版权状态。
- 总后台候选从当前设备 localStorage 升级为受服务端管理员令牌保护的云端记录，并保留旧本机候选用于兼容导出。
- 新增专家审核门槛与不可篡改审核快照；只有版权、安全、专业准确性和证据质量达到门槛才能进入小范围试用。
- 审核通过不会自动修改 DSS、Prompt、题库或正式评分标准，正式发布仍需版本化变更和回归验证。

## 2026-07-13

- 为美感训练的图片分析、自由对话、总结和阶段反馈增加统一结构化输出 Schema；模型首次输出失败时只自动修复一次，仍不合格则安全返回错误。
- 将部署中的人物/结构分析、训练教练、总结、评审与安全边界拆为可部署 Prompt 模块，并让 `packages/prompts` 复用同一实现，减少双源漂移。
- 在现有本机断点续练和 Supabase 云同步上增加向后兼容的训练状态机、状态版本与恢复载荷，不改变现有自由聊天交互。
- 新增模型输出追踪与能力历史迁移表；所有表仅允许 service role 访问，未把任何模型 API Key 写入前端或仓库。

## 2026-07-12

- 将5分钟从强制结束改为目标时间：到时仅提示并允许继续，完成五个训练重点后正常总结，15分钟才由 AI 快速收束。
- 移除“超过5分钟或对话达到5轮就自动完成”的旧判断，避免员工尚未完成训练时被提前结束。
- 增加训练管理发布过程的向前兼容，数据库接口切换期间仍保证默认每日 1 次训练可用。
- 新增后台“训练管理”：每位员工默认每天 1 次，管理员可按员工调整 0–20 次，并可独立暂停或禁用训练。
- 新增服务端训练次数核验、管理员短期令牌、门店权限隔离和数据库操作审计；不复用员工 active 字段，不修改历史训练结果。
- 移除“一名员工每天只能有一条 Session”的旧数据库约束，改由管理员策略控制当日可创建次数。
- 发布 Hair Vision 五分钟训练体系：人物、风格、解剖、适配和沟通五个隐藏检查点。
- 增加九型风格 DNA、十二项发型解剖和人物分析的事实/推测边界。
- 同款发型按历史完成次数轮换训练镜头，跨设备读取云端案例历史，避免重复相同问题和相同总结。
- 增加有效时间计时、4分30秒收束、5分钟宽限与6分钟安全结束，并保持断点续练。
- 强化完成幂等、晚响应保护、资源版本一致性和 Hair Vision 专项回归测试。

## 2026-07-11

- 建立 ZYSYR 企业级备份目录：每日、每周和发布归档。
- 新增 macOS 每日备份与 LaunchAgent 安装脚本；每日归档保留最近 30 天。
- 预留可选 iCloud Drive 同步配置，默认不向未确认的云端目录复制数据。
- 增加修改前恢复点、备份和推送规则，以及模块完成后的 Commit、Push 和 CHANGELOG 要求。
## 2026-09-21 · v514 App 股东报表与门店授权

- 自由手艺人 App 新增“股东报表”，后台员工编辑可独立勾选可查看门店；股东只读，不能保存、入账或管理财务账号。职位“股东”不自动赋权。
- 保留 operations.html 财务入口、账号、登录和入账流程；员工报表使用独立会话，退出／关闭不清除财务登录。
- 员工管理改为受保护接口：验证真实管理员、分店管理员范围、离职撤权、权限审计。员工表仅开放非敏感通讯录字段，密码字段与直接写入关闭；旧员工入口登录后进入维护版 App。
- 新增真实隔离 PostgreSQL／API／浏览器回归，覆盖跨店拒绝、只读限制、授予与撤销、财务会话隔离和横屏显示。未替真实账号授予股东权限，未修改或确认真实账目。
# 2026-09-24 · operations-api v95 生产部署

- 经用户明确授权，将 `operations-api` 整包（入口、共享模块、提示词模块、`deno.json`）部署至 Supabase 生产；平台状态 `ACTIVE`，版本 v95，import map 已启用，`verify_jwt=false` 沿用函数既有自定义会话校验。
- 线上未登录只读探测 `session`、`daily_sheet_get`、`monthly_summary` 均返回应用层 403 `AUTH_SESSION_INVALID`，未触发匿名数据访问；尚未使用真实财务登录完成端到端读写验收。未改动财务数据或登录端口。
- 仅 Edge Function 已部署；GitHub Pages / 前端尚未发布。因客户/预约权限边界与所依赖的生产迁移仍未全部确认，本次不推送整个前端整改批次。
# 2026-09-24 · v541 财务只读 API 超时兜底

- 月报、日报、工资、备用金、库存和凭证的只读接口在 45 秒无响应时会中止浏览器请求并明确提示“未提交任何修改，可刷新重试”，超时计时覆盖响应体解析。
- 超时白名单仅包含服务端只读操作；日报入账、月报/工资/费用保存、上传、审批、冲销及未识别操作不带 AbortSignal、不自动重试。员工股东独立页面请求器未改变。
- 新增超时回归并纳入统一财务门禁，覆盖网络等待、响应体等待和写/未知操作不被中止。仅前端请求处理，无数据库、公式、权限、财务账号或登录入口改动。
- 定向回归、统一财务回归 65/65、完整 pre-push 门禁通过。提交 `e9232cf` 已推送 `github/main`，Validate #35994819723 与 Pages #35994818768 成功；线上无缓存 `version.txt=541`。真实财务会话弱网实测未完成，员工/股东 iframe 和写请求结果不明恢复仍未覆盖。

# 2026-09-24 · v540 工资/业绩原表来源异步请求隔离

- 工资生成和发型师业绩来源格选择现在绑定当前页面、门店、月份、原表及请求序号；快速切换或清空原表时，迟到的旧成功/失败响应不会覆盖当前单元格候选。
- 新增隔离浏览器竞态回归并纳入共享财务测试清单；未改工资/业绩公式、数据库、正式账、权限或财务独立登录入口。
- 为遵守统一发布号，将员工 App 与前台页面的版本缓存标记一并同步；两处功能未变。
- 定向浏览器回归及统一财务回归 64/64 通过；提交 `baedd43` 推送 `github/main`，Validate #35991994482 与 Pages #35991993701 成功，线上 `version.txt=540`。状态记录后续文档提交 `e3787e3` 同样已同步 main。
## 2026-09-24 · C06 CI 固定 Supabase CLI 工具版本（Actions 已验证）

- GitHub Actions 固定 Supabase CLI 2.109.1，并以无遥测模式校验版本及数据库 dry-run / Edge deploy 命令参数。
- GitHub Actions run #35999863919（提交 `4c41fd1`）成功。仅增加 CI 检查；没有 Supabase 项目配置，因此不执行迁移 dry-run、函数部署或任何生产写操作；Edge 编译/部署和数据库发布验证仍开放。
- App 版本保持 v542；财务逻辑、数据库、权限、凭证及生产环境未改。
# 2026-09-25 · v554 股东报表读取超时保护

- 股东 iframe 报表读取和响应体解析现在有 45 秒上限；超时会中止客户端读取并提示可重新读取，不清除员工会话、不自动重试，也不影响财务登录入口或任何写操作。
- 新增回归覆盖网络挂起、响应体挂起、会话保留与成功读取；已纳入统一财务测试清单。
- 按全仓发布门禁将前台入口版本标记同步至 v554；未改前台业务代码。
- 完整 pre-push 与 GitHub Validate #36083168817 通过，Pages #36083168390 成功；线上无缓存核验 `version.txt=554`、报表页 `data-version=554` 及股东请求超时逻辑。
# 2026-09-26 · operations-api v106 月报总览只读并行化（已部署）

- 根据生产日志中 v105 月报 `overview` 的 3 个慢请求样本（约 14.4–14.7 秒），并行发起相互独立的日报来源、签认人员、凭证/上传人、单元格/证据规则及修订/期间锁/收入调整查询，减少串行等待。
- 只调整读取调度，不改查询范围、金额/公式逻辑、数据库、权限、财务独立登录入口或前端；App 保持 v562。
- 定向回归及统一财务回归 73/73、完整 pre-push 与 GitHub Validate #36234632685 通过（包含 Deno 2.9.6 frozen type check）。提交 `298de94` 已推送 `github/main`；生产 `operations-api` 为 v106 ACTIVE，完整 10 文件 bundle 与 main 逐文件一致，`verify_jwt=false` 保持。无会话 overview 探针返回 403 `AUTH_SESSION_INVALID`。没有修改数据库、历史账、权限或财务独立登录入口。
- v105 只有 3 个慢 overview 基线样本；尚无 v106 授权业务请求作为有效对照，不能据匿名拒绝探针宣称提速，后续需基于生产自然业务样本比较。
# v609 · 发型审美训练

- 烫发研习院入口改为发型审美训练，旧科研内容下架；新增2026-10-08虚构人物三视图、六步参考答案与五项自查复盘。
- 自由换算移至发质分析表工具弹窗，保留原计算和冷烫工具；关闭不重建未保存表单。
- 新增内容/图片契约与手机桌面隔离回归。上线以完整门禁及线上回读为准。
- 案例图片以原尺寸JPEG发布，降低传输和手机加载体积；浏览器验证转交独立PR检查，全部通过后再上线。
## v616 — 已入账更正后月历同步

- 月历只选取当天最新有效正式账，排除已冲销版本，避免旧版覆盖更正金额；保留原有门店权限与财务计算。
- 更正成功并读回新修订后，清除旧月历并只读刷新日期金额及月合计；失败明确提示，返回月历重读，不重复提交更正。
- 合成回归覆盖新旧版本、冲销、较新的驳回版本、历史单版本、电脑/手机刷新及断网恢复。无数据库迁移，不修改真实日报或历史金额。

## 2026-10-12 · 晚间发型审美训练（v630不变）

新增原创虚构教学案例《戴眼镜的中长发：脸周开口与侧面轮廓怎样协调？》和原创正侧面起始状态图，先练、六步参考和五项复盘。独立AI编辑检查与修订文案记录在当日审核JSON；非科学或人工认证。保留原四例与academy，未改App功能、业务数据、权限或定时任务。同日稳定ID复用，不重复生成。

学习记录浏览器测试夹具加载现有生产样式，避免较长案例标题使简化壳的默认下拉框溢出；保留全部身份、离线、时长与宽度断言，产品页面不变。

## 2026-10-13 · academy每日图文课（v630不变）

新增《卷度更明显，是否就等于头顶更蓬松？》：十章、三原创图、三原始来源与待验证的人物设计，区分毛束测量和整头轮廓，包含四题参考及低风险非化学观察。实际独立AI审查关闭多视角、页码与控制记录问题，批准绑定v2的正文/三图摘要，非人工认证或真人效果验证。旧两课与晚间审美feed保留；仅静态课程、目录、审核及交接更新，不改App功能、业务数据、权限凭据、费用或自动化。

课程目录浏览器断言从固定两堂/固定10月12日题目改为当前发布目录的数量和最新真实题目；保持离线/不安全URL回退检查，不改页面功能。

## 2026-10-13 · 晚间发型审美训练（保留最新main v631）

新增《同一发型遇到高领：肩颈留白与可扎长度怎样取舍？》与原创虚构成人四格起始着装图，六步参考/五项复盘；不假定现长可扎、不把图像差异当衣领因果或真人效果。真实独立AI内容/视觉审查绑定本版正文/PNG/feed摘要，非人工认证或法律权属保证。保留旧五例与academy；不改页面、答案解锁、业务数据权限费用或日程。


## 2026-10-14 审美训练内容
新增「想留长又要整洁：过渡期短发的边界怎样取舍？」及原创虚构成年人三视角示意。独立AI内容审核通过，非真人专家或科学认证。保留旧6例，内容更新不改App v635或业务接口。
## 2026-10-31 · Natural silver contrast and structural clarity aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about an undisplayed sharp jaw-bob reference, uneven natural silver distribution, zonal support, shallow nape bend, four-minute hand-dry routine and ten-to-twelve-week maintenance. Six conditional answers compare direct blunt geometric copying with a structure-first route that preserves optical transparency; five self-checks remain unscored without a user answer.
- Original same-person 1916×821 AI WebP shows one current salt-and-pepper collarbone bob only, not the reference, proposed cut, styling result or future grow-out. No real customer, measured gray percentage, verified density/diameter/cuticle condition, damage grade, personality, occupation, scientific validation or independent human expert certification is implied.
- Preserve the reviewed 2026-10-31 academy publication and all twenty-three earlier aesthetic feed objects. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; exact-head protected CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.

## 2026-11-01 · Ambiguous “natural” language-translation aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about translating the customer's word “natural” into curl visibility, outline order, surface feel and home reproducibility before choosing a technical route. Six conditional answers compare immediately visible S-wave styling with a reproducibility-first structure; five self-checks remain unscored without a user answer.
- Original same-person 2056×765 AI WebP shows one current shoulder-grazing lob only, not the undisplayed reference, proposed cut, test strand, perm, first-wash result or eight-to-ten-week state. No real customer, measured density/diameter/anatomy, verified chemical outcome, personality, occupation, scientific validation or independent human expert certification is implied.
- Preserve the reviewed 2026-11-01 academy publication and all twenty-four earlier aesthetic feed objects. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; exact-head protected CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.

## 2026-11-02 · Crown-versus-occipital volume-allocation aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about a tall/narrow short-hair silhouette and an undisplayed high-crown reference. Six conditional answers compare direct crown-height copying with moderate crown height plus temple-to-occipital width and depth; five self-checks remain unscored without a user answer.
- Original same-person 1774×887 AI WebP shows one current grown-out pixie-bob only, not the reference, proposed cut, styling result, first wash or eight-to-ten-week state. No real customer, measured cranial/facial proportion, verified density/diameter/whorl force, personality, occupation, scientific validation or independent human expert certification is implied.
- Preserve the reviewed 2026-11-02 academy publication and all twenty-five earlier aesthetic feed objects. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; exact-head protected CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.

## 2026-11-03 · AI-reference cross-view coherence aesthetic case (v638 unchanged)

- Add one original fictional four-view current-state case about three undisplayed AI “same-style” references whose front, profile and back views demand incompatible lightness, height and density. Six conditional answers compare combining every view's strongest feature with a coherence-first three-dimensional translation; five self-checks remain unscored without a user answer.
- Original same-person 2172×724 AI WebP shows one current chin-to-upper-neck grown-out bob only, not the customer's AI references, proposed cut, styling result, first wash or eight-week state. No real customer, measured density/diameter/anatomy, verified reference consistency, personality, occupation, scientific validation or independent human expert certification is implied.
- Preserve the reviewed 2026-11-03 academy publication and all twenty-six earlier aesthetic feed objects. App/runtime/version, retired feed, calculator, customer, finance, database, login, permissions, business sync and automation remain unchanged; exact-head protected CI, ordinary merge, Pages success and exact live feed/image readback are required before claiming App synchronization.
## 2026-11-10 · 发型审美训练：自然卷干湿回缩与短鲍伯落点（v641 不变）

- 新增 `aesthetic-2026-11-10`：训练法式下颌卷鲍伯在前区、侧区与后颈回缩量不同且只愿自然干时，如何在湿发统一底线与干发人物落点之间取舍。
- 新增同一虚构成年人物当前干发四视角 AI WebP；不展示湿发对照、参考图或改造结果，不把图片当作发径、密度、卷型、损伤与厘米回缩量的证据。
- 六步答案覆盖人物、风格、轮廓层次、发质质感、时间尺度验收与门店话术；五项复盘保持未作答自查，不虚构完成或成绩。仅更新 feed、图片、透明审核及交接记录，不改 App 代码、版本、旧研习院 feed、业务数据、权限、同步或自动化。

## 2026-11-11 · 发型审美训练：参考照姿态与中立结构（v641 不变）

- 新增 `aesthetic-2026-11-11`：训练顾客参考照存在低头、侧转和近距离镜头效应时，如何区分可剪结构、可逆造型、拍摄姿态与镜头透视，并在单张照片相似度和日常活动稳定之间取舍。
- 新增同一虚构成年人物中立头位的正面、两个真实侧面与背面 AI WebP；不展示参考照、低头对比或改造结果，不把配图当作真实头型、发径、密度、损伤或活动落点证据。
- 六步答案覆盖人物证据、风格翻译、轮廓安全量、动态质感、中立/低头/转头/别耳验收与门店话术；五项复盘保持未作答自查，不虚构成绩。仅更新 feed、图片、透明审核及交接记录，不改 App 代码、版本、旧研习院 feed、业务数据、权限、同步或自动化。
## 2026-11-12 · 恢复财务历史数据导入入口（v642）

- 恢复有既有历史导入权限的财务导航入口；保留角色、能力、个人范围及门店权限校验，其他收起入口不变。
- 补充权限和导航回归，不修改上传规则、金额、历史数据或日报入账行为。发布与原件入档分别核验。
- 经单独授权，修复日报长金额输入被单元格重复内边距挤压的问题：保留字号与表格宽度，补充手机横竖屏、电脑端的聚焦编辑、小数和零值回归；不改变金额、计算或入账规则。

## 2026-11-16 MGJ source transport repair

Owner approved direct HTTPS only for vip12.meiguanjia.net after the system proxy produced TLS EOF. Consumer source requests and audit curl now route only that validated host directly, retain TLS certificate/hostname verification and reject redirects/other destinations. Supabase routing, global proxies, schedules, credentials and confirmed ledgers stay unchanged. Isolated branch fix/mgj-source-transport-20261116; source tests cover host restrictions and TLS. Source-only runtime deployment and the authorized prior-day two-store readback completed on 2026-11-16; bill sets and source amounts matched. Drafts remain unposted, and cash scope/channel gaps remain explicitly unresolved. No customer data or business amounts are included here. No UI release/version change.

## 2026-11-17 · Bounded business-detail diagnostics (App version: v666 unchanged)

- Current owner: Codex. Last synchronized base checked: github/main bd5cb9d9; starting gates and daily backup passed. Owner authorized publication of program/tests/docs only and deployment; no private source payload or customer records are committed.
- Preserve the installed runner's existing history-kind fairness, June priority, safe-code handling and cash-empty backoff exactly. This reconciles runtime drift into canonical source; it does not introduce those scheduling changes.
- On existing failed batches report fixed phase and numeric HTTP status only. On cloud HTTP 400, optional fixed contract hints inspect the already-read in-memory payload without saving values, extra requests, retries or weakened validation. Unknown remains unknown; this is diagnostic, not proof of repaired sync.
- Install only the three tracked detail files with scripts/install_mgj_business_diagnostics.py --install. It requires exact known preimages or already-installed hashes, obtains both existing locks, retains a private recovery copy, and verifies hashes. No full six-file reinstall, scheduler, credentials, source records or formal-ledger change.
- Focused synthetic diagnostics/installer tests pass. Existing runtime scheduling tests are reconciled with separate preservation coverage. Full publication gates and natural-batch readback remain required before completion.

- Included proven gap-code correction: absent optional employee/config lists retain explicit missing evidence under `emp_list_missing` / `pay_configs_missing`, satisfying the unchanged lower-case server schema. No business amounts, source records or ledger semantics change. This reproducible defect is not yet established as the only live cause.
