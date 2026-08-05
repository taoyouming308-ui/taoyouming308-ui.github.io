# Agent Sync Status

## v406 (2026-08-05)

- iPad 前台发型师时间预览首次进入固定从当天最早营业时段开始，不再自动横向定位当前时间；早上已经过去的时间格和客户记录直接可见。
- 今日美管加已消费记录、预约匹配完成记录和前台手动标记“今日完成”的客户继续保留在原发型师时间格，不按当前时间或完成状态过滤；完成记录维持绿色状态。
- 刷新今日数据时继续保留用户当前手动滚动位置；页面说明明确已过去时段和已完成客户不会隐藏。
- 新增前台回归断言，覆盖首次滚动位置、刷新位置保持、完成服务继续显示及绿色完成状态；本次未修改数据库、Edge Function、美管加同步或生产业务数据。
- v406 完整本地回归已通过：版本、发布、更新流程、前台、预约、后台、客户档案、发质、护理、美感、28项美管加 Python 回归和 Agent 状态全部通过；未改动未跟踪 `aesthetic-coach-edge.ts`。
- App version: v406

## v405 (2026-08-05)

- iPad 前台“今日客户”从纵向分组卡片改为发型师 × 30分钟时间轴；默认营业时间 10:00–22:00，自动扩展超出范围的真实记录，顶部时间与左侧发型师均可吸附，页面首次打开自动定位当前时间或首位客户；预约、等待、完成、取消使用与参考表一致的明显分色。
- 时间轴加载当前分店全部在职发型师，即使当日没有客户也保留整行；预约、当天接待和美管加消费继续合并，客户卡按等待、到店/服务中、完成、取消分色，点击仍打开套餐余额、消费汇总和已同步明细。
- 美管加无姓名且无手机号的预约占位不再计入今日预约或渲染成客户，改为蓝色手掌可登记时段；只在唯一包含关系成立时把美管加发型师名归并到员工名，例如“郭小康”→“小康”，不唯一时保留原名。
- 新增 `frontdesk_today_customers.arrival_time` 与门店/日期/发型师/时间索引；表继续启用 RLS，`anon` 无读取、`authenticated` 无写入、`service_role` 可读。旧行允许为空并回退创建时间，不修改客户主档或美管加数据。
- 当天客户表单增加必填到店时间；点击空白格或手掌时自动带入发型师和30分钟时段，编辑预约/接待时回填原时间。服务端限制 `HH:MM`，所有写入继续通过前台设备会话与门店权限。
- 生产已应用 `frontdesk_reception_time` 迁移并部署 `frontdesk-api` version 5；线上函数内容确认包含预约时间、到店时间和格式校验。
- 生产只读检查 2026-08-05 预约：两个分店均存在 10:30 起的美管加空工位占位，向里真实预约延伸至 19:30；验证了空位与真实客户必须分开渲染，并确认员工“小康”与美管加“郭小康”的唯一别名场景。本次未修改任何预约或客户数据。
- v405 完整发布回归已通过：版本、发布、更新流程、前台运行时、预约、后台、客户档案、发质、护理、美感、28项美管加 Python 回归和 Agent 状态全部通过；线上函数空账号安全探针返回预期 403“请输入账号和密码”。主功能提交 `973f698` 已推送 GitHub `main`；GitHub Pages 已返回 `version.txt=405`，线上 `frontdesk.html` 已确认发型师时间轴、蓝色手掌空位、到店时间和快捷登记代码生效。未改动未跟踪 `aesthetic-coach-edge.ts`。
- App version: v405

## v404 (2026-08-05)

- 前台会话由12小时改为固定 iPad 长期会话；每次接口请求重新读取 `staff`，账号停用、离职或前台权限撤销时立即删除设备会话并拒绝继续访问。
- 总管理员获得服务端返回的有效分店列表，可切换并记住当前分店；普通前台/分店管理员仍被锁定到 `staff.store`，客户端传入其他门店不会越权。
- 今日页合并预约、消费和独立前台登记后按发型师分组；点击客户打开右侧接待抽屉，直接显示当天信息、套餐余项、消费汇总和已同步明细。
- 新增 `frontdesk_today_customers` 当天接待表和“添加/编辑当天信息”表单，字段包括门店、营业日期、客户、发型师、来源、意向项目、状态和备注；不修改 `customer_profiles`，不调用美管加收银写接口。
- 前端移除 `Authorization: Bearer <publishable key>`，只发送 Supabase `apikey`；Edge Function 保持自定义设备会话校验，服务角色密钥仅存在服务端。
- 生产已应用 `frontdesk_today_reception` 迁移并部署 `frontdesk-api` version 4；核验当天接待表 RLS 已开启，`anon/authenticated` 无读取或写入权限，`service_role` 可访问。
- 线上接口仅带 `apikey` 的空账号登录请求正常到达函数并返回 403，证明当前 Supabase publishable key 调用方式和自定义会话网关均生效。
- 生产只读确认有效分店为“向里造型”12名在职员工和“自由手艺人”11名在职员工；总管理员分店下拉由服务端动态生成，不在前端硬编码门店名称。
- v404 本地完整回归通过：版本、发布、更新流程、前台、预约、后台、客户档案、发质、护理、美感、28 项美管加 Python 回归和 Agent 状态全部通过；修改前沿用当日现有完整备份，未改动未跟踪 `aesthetic-coach-edge.ts`。
- 主功能提交 `ff8c3a4` 已推送到 GitHub `main`；GitHub Pages 已返回 `version.txt=404`，`frontdesk.html` 已包含 `data-version=404`、固定 iPad 登录说明、“添加今日客户”入口和按发型师分组逻辑。
- App version: v404

## v403 (2026-08-05)

- 新增独立 `frontdesk.html` iPad 横屏前台客户中心，包含今日预约/消费动态、客户搜索、全部已同步消费时间线、套餐余项和历史表格导入；后台提供直接入口。
- 前台不实现付款、退款、充值：美管加继续作为收银和实时客户数据源；页面仅展示同步结果，并把“预约待消费”“预约已消费”“已消费/无预约”分开标识。
- 新增 `frontdesk-api` 自定义短会话，允许管理员、店长和职位包含“前台”的在职员工登录；普通前台只读，历史导入仅店长/管理员可执行。
- 新增 `frontdesk_sessions`、`frontdesk_import_batches`、`frontdesk_import_records` 和受保护 RPC；三表均启用 RLS，撤销 `public/anon/authenticated` 权限，仅 Edge Function 的 `service_role` 可访问。
- 历史导入首版接受 Excel/WPS 导出的 CSV UTF-8，自动识别现有登记表列、预览校验、200 行分块提交，并用确定性行指纹跳过重复记录；导入数据与美管加记录分源显示。
- 2026-08-05 只读同步审计：15,889 个客户档案中，4,947 个有到店次数但缺少 `service_history`，其中 262 个有消费额但无逐笔明细；前台客户页会明确提示缺口，只把已经同步或导入的记录称为“全部已同步消费记录”。
- 已应用 `frontdesk_customer_center` 与 `frontdesk_import_batch_index` 两个生产迁移；核验三张前台表均启用 RLS，`anon/authenticated` 无读写权限，导入 RPC 仅 `service_role` 可执行。
- `frontdesk-api` Edge Function 已部署至生产 version 3；空账号登录返回 403，服务端无令牌退出返回 200，证明网关、CORS、自定义会话路由和线上运行状态正常。
- 新增 `scripts/test-frontdesk.js` 并接入 GitHub CI 和 pre-push；v403 完整 pre-push 通过版本、发布、更新流程、前台、预约、后台、客户档案、发质、护理、美感、28 项美管加 Python 回归及 Agent 同步检查。
- 主功能提交 `83788d2` 已推送到 GitHub `main`；GitHub Pages 已返回 `version.txt=403`，`frontdesk.html` 返回 HTTP 200 且包含 `data-version=403`、前台登录页和 iPad PWA 配置。
- 编辑前备份已生成 `ZYSYR_2026-08-05_110352.tar.gz` 并复制到 iCloud；未跟踪 `aesthetic-coach-edge.ts` 保持未修改、未纳入提交。
- 已知安全遗留：现有 `staff`、`bookings`、`customer_profiles` 等旧表仍未全面启用 RLS；v403 没有直接改动这些旧表，避免现有员工端中断，后续应单独迁移到服务端认证。
- App version: v403

## v402 (2026-08-01)

- 修复 iPhone/PWA 更新循环：显式点击更新后先注销旧 Service Worker，以 `cache:reload` 获取版本化页面并核验 `data-version`，成功后再 `location.replace`。
- 更新提示不再提前写入 `app-version`；只有新页面实际执行 `_onVersionReady` 后才记录成功，失败时恢复为明确的重试入口。
- 版本化页面加载成功后后台以 `cache:reload` 刷新标准入口文档，避免关闭再从桌面启动时继续命中旧页面；正常启动仍不强制二次导航。
- 新增更新流程动态回归和发布断言，模拟旧 v401 发现 v402、点击更新、新文档加载和标准入口缓存刷新，保护“用户主动触发、先核验后跳转、成功后写版本、标准入口缓存刷新”四项规则。
- 更新流程专项测试、版本同步、发布完整性、App 冒烟、31组发质任务、客户档案、预约、后台、UI、护理、美感模块及49项 Python 回归全部通过。
- App version: v402

## v401 (2026-08-01)

- “我的任务”可见性改为回访状态优先：未完成回访的任务不受30天限制，持续显示；只有真实回访完成记录在30天后隐藏。
- 生产只读核验226条有效发质记录：107条未完成回访，其中11条因旧版统一30天过滤被隐藏，日期为2026-06-25至2026-07-01；按状态为技师已完成7条、待技师填写2条、旧已完成1条、待回访1条。
- 隐藏任务按发型师为晓伟1条、娄云1条、大雄3条、董小强5条、无名1条；本次没有修改任何 Supabase 记录，发布后由页面读取规则自动恢复显示。
- 新增5组可见性回归用例，覆盖旧待技师、旧待回访、旧完成无证据、过期已回访和近期已回访。
- 版本同步、发布完整性、App 冒烟、31组发质任务状态、保存耐久性、客户档案、预约、后台、UI、护理、美感模块及49项 Python 回归全部通过。
- App version: v401

## v400 (2026-08-01)

- 修复“我的任务”日期分组展开容器固定 `max-height: 2000px` 导致记录数量正确、展开内容却只显示前十几条的问题；折叠改为 `display:none`，展开不再限制高度。
- “待技师填写”在任务卡标题和操作区统一使用橙色高对比标签，保持完成、待回访等其他状态语义不变。
- 新增静态回归断言，禁止重新引入展开高度上限，并保护待技师状态的醒目样式。
- 390×844 本地手机预览验证 46 张卡片全部渲染，展开区计算样式为 `max-height:none`，页面可滚动至最后一张；完整发布回归通过。
- 本次未修改 Supabase 数据、30 天任务可见窗口、任务状态机或保存流程。
- App version: v400

## v399 (2026-07-31)

- 发质分析新建、云端编辑和本地草稿重试统一使用 `persistAndVerifyHairRecord`：幂等写入 `hair_records` 后立即按记录 ID 回读，完整 `record_data` 一致才显示成功。
- 本地 `localStorage` 写入改为显式返回结果；本地失败仍继续直存云端，云端失败则保留可见重试状态，两端失败时阻止关闭表单。
- 移除新建记录分配助理时的重复乐观上传；不再在云端确认前把本地记录标成已同步。
- 本地“上传”改为保存完整 canonical `hair_records`，保留预约 ID、服务日期和全部原表字段，不再只写入旧版摘要队列。
- 新增 `scripts/test-hair-save-durability.js` 并接入 GitHub CI 与 pre-push，覆盖本地失败容错、云端写入、精确回读、内容不一致拒绝和重试 ID 稳定性。
- 生产只读核验：无名名下、8 月 1 日预约的石小姐没有本次新云端发质表或分析队列记录，只有 7 月 4 日旧档；本次已丢失内容未被猜测补写，旧档未修改。
- App version: v399

## v398 (2026-07-30)

- 预约页“查看方案”补齐预约 ID 传递，发质档案优先使用 `findHairRecordForBooking` 精确关联本次预约，兼容同手机号、同服务日的旧记录。
- 生产只读核验：夏女士最新发质分析记录已存在于云端，且 `booking_id`、预约日期和手机号均与本次预约一致；问题来自客户端此前只取顾客摘要，不是保存失败或数据缺失。
- 方案弹窗新增“打开完整发质分析原表”，通过云端记录 ID 加载原发质分析页面的全部字段，并锁定为只读；关闭时不会触发自动保存。
- 未命中本次预约或云端加载失败时显示明确状态；不删除、不迁移、不改写历史数据。
- App version: v398

## v397 (2026-07-30)

- 客户档案发质分析记录改为分页读取全部 `hair_records` 有效记录，不再被全局最新 200 条截断。
- 单顾客匹配先完整读取云端有效记录，再按标准化手机号优先、姓名兜底关联；旧版已完成队列也分页读取。
- 生产只读核验：当前 224 条有效发质分析记录、191 位有手机号顾客、0 条空 `record_data`；此前固定 200 条上限会漏掉最早 24 条。217 条可按手机号或姓名关联，另 7 条源数据没有任何顾客身份，保留在“待关联顾客”组，不做猜测绑定。
- 本次只改变客户端读取完整性，不删除、不迁移、不改写任何发质分析历史数据。
- App version: v397

## v396 (2026-07-30)

- 向里造型自动出库继续保持关闭：仓库与运行配置均要求 `enabled=false` 且商品映射为空；护理执行器增加 Supabase 短暂故障重试，已在美管加完成但回写失败的任务进入人工复核，禁止重复出库。
- 预约同步保留数据库原始记录，仅在员工端隐藏没有手机号且没有有效顾客姓名的空工位占位，不删除真实预约。
- 客户搜索与金额汇总继续使用总部会话；消费账单列表/明细只读使用隔离护理会话，不续期、不改写凭据，也不调用库存写接口。
- 近期消费明细按最近 45 天轮换，并优先刷新近期发质客户及预约客户；只读核验的最新服务日期已推进到 2026-07-23，两个门店均有近期记录。更早历史缺口继续小批量渐进补齐，不宣称一次性完成。
- 生产验证发现 20 人常规批次超过 Hermes no-agent 120 秒上限；现改为每次轮换 8 人，保留每小时两次调度并由独立回填任务承担历史缺口。
- 新增只读健康巡检：检查预约、客户、两套会话保活、护理队列、消费明细新鲜度、仓库/运行副本哈希，并持续确认向里造型自动出库关闭；健康时静默，异常时告警。
- 巡检把 10 分钟内的 `running` 视为正常执行，只有超过 10 分钟才报告疑似卡住，避免与合法同步窗口重叠时误报。
- 唯一调度拓扑已配置：常规同步每小时 `00/30` 分、客户回填 `05/20/35` 分、近期消费明细 `15` 分、会话保活 `50` 分、健康巡检 `12/27/42/57` 分；旧的重复 Agent 同步任务已停用，Hermes Gateway 已恢复加载。
- App version: v396

## v395 (2026-07-29)

- 员工管理新增“在职／已离职／全部员工”筛选；离职员工仍可查看、编辑和恢复在职。
- “办理离职”会将账号停用并记录离职状态，员工不能继续登录；发质、预约、护理、训练和审计历史保留不删。
- 注册审核与离职状态分离，待审核账号不会再和离职员工混在一起。
- 已应用员工状态迁移并完成后台、版本、发布完整性和页面冒烟验证。
- App version: v395

## Customer AI tunnel recovery (2026-07-26, no app version bump)

- Replaced the missing tunnel-update entry point with a tracked, tested publisher that reads the managed tunnel log, probes `/api/codex-plan`, and only publishes a changed HTTPS address after the probe succeeds.
- The customer-plan tunnel now runs through a dedicated launcher that writes its startup URL to a stable log; this removes the previous dependency on an unmanaged process with inaccessible output.
- Added a small regression suite for URL discovery and the expected no-phone API response. The runtime publisher uses an isolated worktree so automated URL refreshes never modify an active developer checkout.
- App version remains v394; this is runtime maintenance and the customer-plan configuration is fetched dynamically.

## v394 (2026-07-26)

- 修复发质分析表“从预约选择客户”错误读取可编辑表单发型师的问题；现在始终按当前登录账号和所属门店加载预约，和预约页保持一致。
- 新增预约界面回归检查：若客户选择器再次使用表单发型师筛选，发布校验会失败。
- 已完成预约界面、版本同步、发布完整性和页面冒烟检查。
- App version: v394

## v393 (2026-07-23)

- 发质分析表步骤5新增“照片留档（选填）”，分别提供服务前、服务后照片；每组支持手机拍照、相册选择、替换和删除。
- 照片在浏览器端缩放压缩后，分别保存为 `record_data.serviceBeforePhoto` 与 `record_data.serviceAfterPhoto`；不新增表、不改变旧字段和旧档案兼容性。
- 本地草稿、云端任务保存、发型师归档和再次编辑均保留照片；顾客历史档案按每次服务展示对应的前后照片。
- 新增 `scripts/test-hair-service-photos.js` 并接入本地 pre-push 与 GitHub CI，覆盖入口、压缩、双保存路径、恢复、兼容合并和历史展示。
- App version: v393

## v392 (2026-07-23)

- 顾客“AI分析建议”与美感训练接口正式分流：新增 `customer-plan-url.json`，只指向 Mac `plan_server` 的 HTTPS `/api/codex-plan`。
- 移除员工端已失效的 `192.168.3.250:8890` 本地优先请求，避免 HTTPS 手机页面先触发混合内容/旧 IP 失败再走错误备用接口。
- AI分析增加单请求保护；重试前清除旧错误，405、连接失败和超时改为明确的 Codex 服务提示。
- 新增 `scripts/test-ai-codex-route.js` 并接入本地 pre-push 与 GitHub CI，禁止顾客分析再次复用 `aesthetic-coach` 或旧局域网地址。
- 只读验证：Mac `plan_server` 健康接口 200；独立公网 `/api/codex-plan` 无手机号时返回预期 400；Codex CLI 已登录并使用 `gpt-5.5` 完成无顾客数据的最小返回测试。
- 本地 v392 页面已确认加载 `customer-plan-url.json`，页面与三个版本化运行时均返回 200，浏览器控制台无错误；版本、发布完整性、App 冒烟、Codex 路由、护理、22 组发质任务、客户档案、后台、预约、全局 UI、模块边界、美感系统及 42 项 Python 测试通过。
- 当前 Cloudflare Quick Tunnel 没有固定域名配置；现有地址可用，但隧道进程重启后仍需更新 `customer-plan-url.json`。在用户确认前不推送 v392。
- App version: v392

## v391 (2026-07-23)

- 暂时隐藏员工端发质分析中的“上传照片分析”和 AI 照片诊断区域。
- 保留照片分析队列、历史数据和分析代码，通过功能开关可随时恢复。
- 根/中/尾人工诊断、发质类型匹配和软化方案流程保持不变。
- App version: v391

## v390 (2026-07-21)

- 发质分析表“从预约选择客户”每次打开时固定以本地当天日期加载预约，避免上次日期残留导致选错客户或服务日。
- 日期前后切换和手动选择继续可用；仅取消跨次打开时的旧日期记忆。
- App version: v390

## v389 (2026-07-21)

- 取消员工端首页工作台菜单中的“美感训练”入口。
- 保留美感训练页面、历史数据、训练运行时和后台管理能力，本次不做数据删除。
- App version: v389

## v388 (2026-07-16)

- 重构“美学研究院”为工作流后台：工作台、待审核、已发布知识、来源库、规则与结构五个独立视图。
- 新增候选以 `NEW 新增`、蓝色边线和日期醒目标记；工作台按最新时间优先显示真正需要处理的内容。
- 候选列表从移动端横向大表格改为卡片，每条只显示当前流程的一个下一步操作：AI 初审、补充案例或专家审核。
- 增加新增、需要处理、试用中和发布版本四项关键指标，以及按新增和状态筛选、关键词搜索与流程进度汇总。
- App version: v388

## v387 (2026-07-16)

- 美感成长 V2 保留现有图片分析、自由对话、权限、计时和断点续练，新增独立 `aesthetic-growth.v2.js` 运行时。
- 每日计划按个人最低能力生成挑战并轮换五类导师；七日连续训练触发隐藏 Boss，同款案例继续复用 Hair Vision 差异化计划。
- `aesthetic-coach` 使用 `coach-growth-v3`：检查点只有通过证据数量、回答长度、支持信息和无依据判断的服务端硬门槛才成为 `mastered`。
- 结束总结强制包含新知识、观察方法、沟通技巧、大师洞察、今日突破、昨日比较、标签和大师值；历史洞察传入模型用于去重。
- 成长档案保存在 `hair_aesthetic_growth_v2:<员工>`，并写入 Session `goal_states._growthV2`；`growth_profile` 返回最近云端快照供新设备恢复。
- 两个 Edge Function 已部署；真实低证据回答探针确认返回 `needs_evidence`、当前检查点保持不变。
- App version: v387

## 护理出库双账号隔离（2026-07-14，不发版）

- 客户/预约同步继续使用总部 `meiguanjia-config.json` 与 `meiguanjia-auth.json`；护理出库改用独立分店会话与凭据文件，避免任一侧续期覆盖另一侧账号。
- `mgj_keepalive.py` 增加可配置的 session/auth/lock/status 路径，默认总部行为保持不变；护理保活使用独立 LaunchAgent 每30分钟按需续期。
- 护理执行器默认只读取 `meiguanjia-care-config.json`，分店会话失效时不会再回退到总部账号。
- 郑惠华 110g 护理批次已在分店会话下完成并审核，美管加单号 `CPKY20260714001`；幂等队列四项均为 `completed`。
- App version: v386

## 美管加库存连接器 MVP（2026-07-14，不发版）

- 审计确认 Hermes 使用美管加网页内部 API；Cookie/Token 只从本机 `~/.hermes/meiguanjia-config.json` 读取，账号密码继续只存权限 600 的 `~/.hermes/meiguanjia-auth.json`。
- 当前可靠能力为会话校验/刷新及护理出库的创建、审核、回查；商品、库存、入库和流水接口存在跨日期状态冲突，必须逐项只读复验，不能宣称全部可用。
- 新增 `scripts/meiguanjia_inventory_connector.py` 服务端内核，提供门店白名单、商品 ID/正数量校验、角色与显式批准、幂等、SQLite 审计和异常清单；通用写能力默认关闭。
- DeepSeek 输出固定标记为 `advisory_only`，只允许字段识别、结构归纳、异常解释和辅助映射，不进入库存执行函数。
- 6 组连接器测试和 8 组现有护理出库测试通过；本次未调用美管加库存写接口、未修改库存、未部署运行任务。
- App version: v386

## v386 (2026-07-14)

- 新增 `mgj_service_records` 独立对账表，以美管加账单 ID 去重，保存顾客、门店、服务日期时间、员工、真实项目明细及烫/染/护分类。
- `sync_mgj_customer_profiles.py` 在客户档案写入成功后同步已取得项目明细的烫染护账单；新表暂不可用时只记录告警，不中断原客户同步。
- 后台“发质任务”新增最近 90 天美管加烫染护与 `hair_records` 对账，手机号+同日为主匹配，无手机号时才使用姓名+同日备用匹配，并默认只显示漏单。
- 对账表返回 404 时自动回退到现有 `customer_profiles.service_history`，避免数据库迁移与页面发布存在时间差时整页失败。
- 生产迁移 `20260714013000` 已应用并通过 REST 200 验证；同步运行副本与仓库源文件 SHA-256 一致。
- 已扫描 8,380 份含消费历史的顾客档案，向独立对账表幂等回填 691 条烫染护账单记录。
- 最近 90 天只读核验：美管加烫染护 153 单、APP 发质分析表 123 份、同日手机号/备用姓名匹配 68 单、疑似漏单 85 单；自由手艺人 101 单、向里造型 52 单。
- 当日真实增量同步 18 位预约顾客：16 位档案成功、2 位未找到；已有历史明细同步到新表正常。
- 已从登录中的美管加消费明细页核对真实 Network：`memberDetail!detail.action` 使用当前会话员工 `empId=831819`，且 JSON `parentShopId/shopId` 与 multipart `shopid` 均为总部 `1103470`。同步脚本已改为从当前 cookie `userId` 读取员工 ID，并按真实总部 shop 参数请求，移除导致 code 403 的旧员工 ID/分店参数组合。
- 新账号凭据已通过本机隐藏输入保存（权限 `0600`），强制重登和会员详情接口验证成功；正式增量同步 20 人中 19 人成功、1 人在美管加未找到，新增写入 20 条烫染护记录；历史缺失回填 20 人全部成功，新增写入 5 条烫染护记录。运行脚本已部署到 `~/.hermes/scripts/sync_mgj_all.py`。
- 后台已将未开单与未回访拆分为独立工作线，并统一按门店、发型师分组。
- 已修复开单对账日期误判：使用发质表全部业务日期，并允许跨天结账前后 1 天。
- 未开单对账只读取本月数据，并按消费项目识别烫染护、汇总金额。
- 补开任务数据库迁移已应用；APP 支持本人补开，后台支持转交与无需开单原因，完成后自动关联发质表并进入回访。
- App version: v386

## 美学知识每日收集（2026-07-13，不发版）

- 已安装 `com.freecraftsman.aesthetic-knowledge-collector`，每天 02:30（Asia/Shanghai 本地时间）运行。
- 唯一源为仓库中的收集器、运行脚本和来源白名单；安装器逐文件校验 SHA-256 后部署到 `~/.hermes/aesthetic-knowledge/runtime/`，禁止只改运行副本。
- 来源白名单为 `scripts/aesthetic-sources.json`；输出隔离在 `~/.hermes/aesthetic-knowledge/pending/`，日志位于 `~/.hermes/logs/`。
- DeepSeek Key 只从 `~/.hermes/.env` 读取；plist、仓库、日志和候选文件均不保存密钥。
- 首次运行已产生 4 条 `pending_review` 候选。当前还未接入 Supabase 后台队列；没有 service role 凭据时禁止绕过受保护接口直接写库。
- 自动任务不得批准、试用或发布知识；正式知识仍需专家审核、案例验证和版本发布。
- App version: v381

## v381 (2026-07-13)

- 美学研究院 AI Provider 从 OpenAI 全面切换到 DeepSeek：Flash 负责批量整理，Pro 负责知识适用性、训练质量和策略深度审核。
- 本机 `/Users/a1/.hermes/.env` 中找到现有 DeepSeek Key；只确认存在并安全传入 Supabase Secret，未输出或提交密钥内容。
- `aesthetic-learning` 不再读取 `OPENAI_API_KEY`；模型默认值固定为 `deepseek-v4-flash` 与 `deepseek-v4-pro`，可由服务端 Secret 覆盖。
- 生产 Secret 已设置，`aesthetic-learning` 已部署；Flash 与 Pro 官方 API 均返回 HTTP 200 且 JSON 输出有效，未执行知识或业务数据写入。
- 待完成：完整回归、GitHub 推送与线上核验。
- App version: v381

## v380 (2026-07-13)

- 总后台“美感知识”升级为“美学研究院”：收集 → AI 初审 → 形象设计适用性审核 → 案例验证 → 专家审核 → 版本发布。
- 新增 additive migration `20260713210000_aesthetic_research_institute.sql`，扩展知识领域、来源定位、证据等级、AI 初审、六项适用性、案例验证和专家复核字段；不改变旧候选字段语义。
- 新增受总管理员令牌保护的 `admin_assess_knowledge_candidate` 与 `admin_add_case_evidence`；AI 只能给初审建议，不能批准或发布。
- 进入试用前必须完成 AI 初审，并确认形象设计适用性、版权、安全、专业准确性和证据质量。
- 生产数据库已应用 `20260713210000`，迁移历史本地/远端一致；`aesthetic-learning` 已部署。
- 完整知识、版本、发布完整性、App/后台/护理/发质/客户档案/预约/UI/模块边界及 17 项 Python 同步测试通过；未登录 AI 初审探针受控返回 403。
- 待完成：GitHub 推送和线上核验。
- App version: v380

## v379 (2026-07-13)

- 将九型风格与风格美学研究底座纳入 `aesthetic-knowledge.v1.js` 1.4.0，覆盖 VIS/PER/STY/DES/HAI/TRN/SCR 七个领域、连续视觉维度、A–E 证据等级和统一条目合同。
- 保留现有 DSS 发型九型为生产训练分类；中文个人形象八型作为 `sourced_reference`；来源未冻结的中文九型保持 `provisional`，不得作为标准答案或自动评分依据。
- 新增中国丝绸博物馆、CMB UK/JP、Kibbe 出版方、CIE/ISO 与面孔印象研究共 8 条来源记录，并写明每项来源能证明和不能证明的内容。
- 对话教练现在接收 `knowledgeFoundation`，Prompt 明确区分各类型体系并执行外貌推断安全边界；无数据库迁移，无生产业务数据写入。
- `aesthetic-coach` 已部署；知识/版本/发布完整性/冒烟/模块边界/App UI/护理/发质任务/客户档案/后台/预约及 17 项 Python 同步测试通过。
- 待完成：GitHub 推送与线上版本核验。
- App version: v379

## 美学知识起始包 v1（2026-07-13，不发版）

- 新增 30 条 `system-starter-v1` 内部原创候选，覆盖六组基础美学能力；全部为 `pending_review`、置信度 70。
- 每条均包含理由、正例、反例、适用与不适用边界；不包含药水、软化、温度等未经现场标准验证的参数。
- 种子迁移只写受保护候选表，不修改 DSS、Prompt、题库、评分标准或 App 版本。
- 生产 Supabase 已应用 `20260713190000`；只读表统计确认 `aesthetic_knowledge_candidates` 当前为 30 行，审核与案例证据表仍为 0 行，等待专家操作。
- App version: v378

## v378 (2026-07-13)

- 建立美学知识来源、候选、专家审核与案例证据四类服务端表；全部启用 RLS，只允许 service role 经 Edge Function 访问。
- 总后台支持跨设备提交知识候选，结构包括观察事实、美学判断、依据、适用/不适用条件、正例、反例和版权状态。
- 总管理员可执行“需修订 / 进入试用 / 拒绝”审核；进入试用必须版权与安全核验通过、专业准确性不低于80、证据质量不低于70。
- 候选或审核不能自动写入 `aesthetic-knowledge.v1.js`、DSS、Prompt 或评分标准；正式知识仍需版本发布。
- 生产 Supabase 已应用 `20260713170000`，`aesthetic-learning` 已部署；无管理员令牌的知识接口探针返回 HTTP 403。
- GitHub Pages 已验证员工端 `data-version=378`，后台加载 `aesthetic-knowledge.v1.js?v=378`；完整业务回归与 28 项 Python 测试通过。
- App version: v378

## v377 (2026-07-13)

- 美感训练四类模型输出新增统一 Schema 校验；首次失败自动修复一次，第二次失败安全中止并返回可理解错误，不把不合格 JSON 传给页面。
- 部署 Prompt 拆分为分析、教练/总结、评审和安全边界模块；`packages/prompts` 改为复用部署模块，避免 Edge Function 与包目录继续双源漂移。
- 训练 Session 在原有 `status` 兼容字段之外增加细粒度状态机、状态版本、最后保存时间和恢复载荷；本机恢复继续兼容旧记录。
- 新增 `aesthetic_model_outputs` 与 `aesthetic_ability_history` 的 additive migration，RLS 开启且仅 service role 可访问；未改生产数据、未提交 API Key。
- 迁移 `20260713140000` 已应用到生产 Supabase；`aesthetic-learning` 与 `aesthetic-coach` 已部署，非法参数探针返回受控 HTTP 400。
- GitHub Pages 已验证 `version.txt=377` 且 `perm-app.html data-version=377`；完整业务回归与 28 项 Python 测试通过。
- App version: v377

## v376 (2026-07-12)

- 5分钟改为建议目标而非强制结束：到达5分钟后继续累计有效训练时间，并明确提示员工完成剩余重点。
- 只有人物、风格、解剖、适配、沟通五项全部完成才正常总结；不再因达到5轮对话或超过5分钟提前结束。
- 15分钟设为安全上限，届时 AI 快速收束；切后台和离开训练页仍暂停计时，断点续练保持不变。
- Hair Vision 时间运行时升级为 v1.1.0，新增 extended 阶段与15分钟 hard stop 回归断言。
- App version: v376

## v375 (2026-07-12)

- 增加训练次数核验的无停机兼容：数据库迁移或 Edge Function 尚未完成时，员工端继续按本机默认每日 1 次执行，不因旧接口返回未知操作而阻断首次训练。
- 服务端训练策略上线后，员工端自动使用管理员设置的次数与状态，无需再次发版。
- App version: v375

## v374 (2026-07-12)

- 后台新增“训练管理”，总管理员可管理全部员工，分店管理员只可管理本店员工。
- 每位员工在没有单独策略时默认每天 1 次；管理员可把每日次数设为 0–20，并设置启用、暂停或禁用及原因。
- 训练权限与 `staff.active` 完全分离，避免把注册待审核员工、账号状态和训练权限混为一谈。
- 新建 Session 前由服务端核验当日次数；继续已有 Session 不重复占用次数，完成记录和员工原始回答不可由后台改写。
- 新增训练策略、后台短期令牌和数据库审计表；匿名与普通认证角色无直接表权限。
- App version: v374

## v373 (2026-07-12)

- 美感训练升级为 Hair Vision 五分钟设计陪练，员工端继续保持自然自由聊天，不重新暴露机械 STEP 表单。
- 每次训练隐藏经过人物分析、风格美学、发型解剖、适配分析、客户沟通五个检查点；4分30秒开始收束，5分钟进入宽限，6分钟安全结束。
- 计时只累计训练页可见的有效时间；切后台、离开训练页或中断后暂停，恢复 Session 后继续，不因离开门店工作而超时。
- 新增四大正式知识体系、八类人物视觉表达边界、九型风格 DNA 与十二项发型解剖；职业、性格、年龄、工具痕迹和吹风方式不得由单图武断确认。
- 同一案例按完成次数生成确定性差异化计划：轮换深练检查点、人物镜头、相邻风格、解剖焦点、适配条件和客户异议，并保存 variantId 与 lessonSignature。
- 前端结合本机历史与 Supabase 云端案例完成次数；同款重复训练会向导师提供最近收获，要求本次总结输出独有收获及与上次的差异。
- 完成流程增加幂等、晚响应保护和计时器停止，避免手动结束、自动结束或慢网络造成重复积分和 Session 复活。
- App version: v373

## v372 (2026-07-11)

- 保持现有美感训练自由聊天方式不变，新增后台静默云同步：Session、员工回答、导师追问、目标状态、Prompt/策略/模型版本进入 Supabase。
- 新增独立 AI 训练评审器，不由训练导师给自己评分；自动评估回答改善、专业准确性、引导质量、证据增长和安全性。
- 新增有效/失败样本自动分类；每累计 100 次独立评审，优化 AI 自动生成候选追问策略，不修改专业知识标准。
- 新增策略生命周期、确定性实验分组、最低样本量、准确性、安全性和改善率门槛。
- 合格候选自动进入 10% 灰度；累计 100 个实验样本后，按真实改善、专业准确性和安全性自动晋升 active 或淘汰 rejected。
- 新增五张 RLS 隔离表，匿名及普通认证角色无直接访问权限，仅 Edge Function 服务角色读写。
- aesthetic-learning 与更新后的 aesthetic-coach 已部署至生产 Supabase。
- App version: v372

## ZYSYR enterprise backup system (2026-07-11, no app release)

- Added daily, weekly, and release backup directories plus a macOS daily archive script that keeps 30 days.
- Added an optional iCloud Drive destination, a LaunchAgent installer for 02:00 daily execution, backup documentation, and mandatory recovery-point rules in `AGENTS.md`.
- App version remains v371; no production page, database, runtime worker, or version file was changed.

## v371 (2026-07-11)

- 美感训练升级为每日任务：同一员工每天只完成一次，完成后首页直接进入成长记录，次日自动生成新任务。
- 新增进行中 Session 本机持久化，保存 sessionId、currentStep、messages、goalStates、status、version 和输入草稿；每轮对话立即保存，草稿输入 900ms 自动保存。
- 中途退出、杀进程或重新打开页面后，首页优先显示“继续今日训练”，恢复到原对话目标和未发送草稿，不再丢失进度。
- 成长页新增本月积分、月完成率和连续训练天数；每日完成计 20 分，完成至少 5 轮深度对话加 10 分。
- 保持旧 guided-v2 和当前 guided-chat-v1 记录兼容；本版本不修改 Supabase 生产表，跨设备同步与店长团队聚合留待后续数据库迁移。
- App version: v371

## v370 (2026-07-11)

- 修复 iOS/PWA 旧页面缓存误报“线上版本异常”：本机已知 v369 但仍加载 v368 时，现在显示正常、可点击的版本更新提示。
- 保留只升级保护和用户主动刷新机制，不强制刷新正在填写的预约、档案或发质表。
- 新增冒烟测试，禁止旧缓存状态再次显示不可点击的降级异常文案。
- App version: v370

## v369 (2026-07-11)

- 美感训练“我的训练图库”移除手动分类下拉框，上传入口和个人图库保持不变。
- 新上传图片使用中性的内部兼容分类“发型作品”；已有个人图片及其原分类不修改。
- 新增回归断言，防止手动分类控件再次出现在个人训练图库。
- App version: v369

## Architecture refactor (2026-07-11, no app release)

- Added `ARCHITECTURE.md`, a root development README, focused package READMEs and a domain-indexed `docs/` tree so new sessions can read only the relevant boundary.
- Added initial executable boundaries for DSS definitions, Prompt builders and AI operation contracts under `packages/`; kept the root GitHub Pages entry files unchanged for URL and zero-build compatibility.
- Added `scripts/test-module-boundaries.js` to the local pre-push hook and GitHub CI, plus `.rgignore` rules that keep historical release snapshots and generated caches out of normal Codex searches without deleting them.
- Updated `AGENTS.md` with the product mission, Prompt/DSS/knowledge separation, AI Engine contract, UI and low-coupling rules.
- No production page, database, environment variable, version file or runtime worker was changed. The deployed Edge Function still contains its existing Prompt implementation until Supabase external-import packaging is verified; do not delete that implementation merely to satisfy directory shape.
- App version remains v368. Version, release integrity, smoke, UI/business regression, module-boundary and 36 Python unit tests passed locally; standalone Deno type-checking was unavailable.

## v368 (2026-07-10)

- 美感训练主交互从固定五步“填写答案—提交点评—进入下一步”改为有剧本的自由聊天：用户看到连续对话，系统内部维护轮廓、重量、层次、线条纹理、风格、人物适配、技术转化和顾客沟通八类隐藏目标。
- 新聊天页每轮只发送一条发型师消息，AI 设计陪练只追问一个关键问题；保留明确的“结束训练/查看总结”入口，不再在训练区暴露 STEP 1/5、阶段评分或补充次数。
- 导师接口新增 `coach_turn` 和 `summarize_session` 协议，区分可见事实、合理推测、无依据判断和无法确认内容；支持动态难度、目标状态、重复误判、能力更新、自然转场和顾客沟通训练。
- 页面提示升级为三层：随目标变化的常驻方法提示、后端依据能力画像生成的个性化引导、用户点击“我卡住了”后逐层缩小观察范围的提示。
- 保留首次 GPT-5.5 图片深度分析、结构化知识卡、DSS 九型标准和相关模块裁剪；后续聊天不重复上传图片，只发送当前目标相关模块与最近消息。
- 新增聊天式训练总结：看对内容、主要遗漏、误判模式、可迁移方法和下次重点；旧 `hair_aesthetic_progress_v1` 与能力档案继续兼容，新记录类型为 `guided-chat-v1`。
- App version: v368
- Supabase `aesthetic-coach` Edge Function 已部署；真实 GPT-5.5 `coach_turn` 验证返回 HTTP 200、保持轮廓目标、只提出一个主要问题。
- 待完成：发布 App v368、手机端真实对话验证和 GitHub Pages 版本核对。

## v367 (2026-07-10)

- “知识体系”页新增 DSS 九型风格知识库，支持展开查看九型的关键词、视觉语言、相邻风格区别和设计动作映射。
- 九型知识由 `aesthetic-knowledge.v1.js` 作为版本化数据源，前端只负责展示；训练页继续使用同一套知识标准。
- 待完成：发布 v367 并核对 GitHub Pages 线上版本。

## v366 (2026-07-10)

- 美感训练每个阶段新增 DSS 风格知识卡：从视觉变量、相邻风格、风格语言到设计动作和人物适配，知识在训练动作中即时出现。
- 保留用户先观察、再回答、再接受 AI 纠偏的流程，不提前泄露本题完整答案。
- 待完成：发布 v366 并核对 GitHub Pages 线上版本。

## Knowledge candidate collector (local, not published)

- 新增 `scripts/collect-aesthetic-candidates.js` 和来源配置示例，支持抓取明确允许的 HTTPS 公开来源。
- DeepSeek 仅用于原创摘要、主题分类和版权风险提示，候选写入 `knowledge-candidates/pending/`，不会自动修改正式知识或评分标准。
- API Key 只读取 `DEEPSEEK_API_KEY` 环境变量；支持 `--no-ai` 先做无模型候选采集。

## v365 (2026-07-10)

- 修复快速观察标签重复插入“观察标签：”导致认真回答被低质量检测误判的问题。
- 标签现在按“观察事实：长度、外轮廓、重量位置”合并显示；系统标签会从重复词组检测中剔除，保留真实内容质量判断。
- 待完成：发布 v365 并核对 GitHub Pages 线上版本。

## v364 (2026-07-10)

- 修复更新提示在 iOS/PWA 环境点击后仍命中旧页面缓存的问题。
- 用户点击更新时改为跳转到带版本号和时间戳的新地址；启动时仍不强制刷新，不打断正在填写的业务。
- 待完成：发布 v364 并核对 GitHub Pages 线上版本。

## v363 (2026-07-10)

- 美感训练前端在现有五步流程上增加阶段化“快速观察标签”：视觉识别、结构拆解、DSS风格归纳、技术转化和人物适配分别提供对应标签，点击后可插入回答并保留自由表达。
- 每个阶段新增单独的回答提示，明确事实、结构关系、主副风格证据、技术未知项和人物取舍，减少直接写大段泛泛答案的负担。
- 保留原有 AI 点评、补充回答、本机能力记录和知识卡逻辑；版本同步为 v363。
- 待完成：完整回归、App v363 发布及 GitHub Pages 核对。

## v362 (2026-07-10)

- 发型知识卡模块升级为可解释证据链：结论、直接观察、专业推测、支持证据、冲突信号、0-100置信度和建议补充信息；低于60置信度必须保持推测表达。
- 每轮教学反馈新增已观察点、遗漏点、误判、相较上轮进步、观察完整度，以及准确度/覆盖度/证据/逻辑/事实推测区分/技术推导/补充进步7项可解释指标。
- 第3次补充点评作为本题最终轮，GPT-5.5结合全部回答与反馈生成当前模块完整解析；页面隐藏继续补充并提供“查看本题完整解析”和“进入下一步”。
- 新增员工本机能力档案 `hair_aesthetic_ability_v1`，累计五步能力、7项解释指标和反复遗漏点；训练完成页显示当前最弱的两项指标。
- App version: v367
- Edge Function 已部署并通过真实 GPT-5.5 验证：首次视觉知识卡返回11模块，每模块均含结论、观察、推测、证据、冲突、置信度和待补信息；测试风格模块置信度86。
- 最终补充轮真实返回 HTTP 200、已观察点/遗漏/误判/进步/82%完整度、7项能力指标和当前模块完整解析；模型确认为 `gpt-5.5`。
- 待完成：完整回归、App v362 发布及 GitHub Pages 核对。

## v361 (2026-07-10)

- 美感训练新增“首次深度分析、后续模块复用”：每张图片首次进入训练时由 GPT-5.5 视觉分析生成完整分析、精简摘要和11个结构化模块，并按员工、案例和图片哈希保存在当前设备。
- 后续回答不再上传或重复识别原图；导师接口按观察、分析、判断、设计、复盘动态选取相关模块，只传当前阶段最近4次回答和3次AI反馈，降低视觉识别与上下文成本。
- 完整底稿训练期间不直接展示，完成五步后才在完整解析中开放；底稿保存初始版本、修订原因、时间和受影响模块，最多保留最近10版。
- 训练页新增“补充真实信息”，只让 GPT-5.5 修订受新增事实影响的模块，并合并到新版本，不默认重做整张图片分析。
- App version: v361
- Edge Function 已部署并完成三项真实 GPT-5.5 验证：首次视觉分析返回完整底稿、摘要及11模块；后续无图片点评返回 HTTP 200；补充粗硬多发量和5分钟打理信息后只修订 `texture/suitability/cuttingLogic/maintenance/uncertainties`。
- 待完成：完整发布检查、App v361 发布和 GitHub Pages 版本核对。

## v360 (2026-07-10)

- 美感训练每个阶段改为首次回答后最多补充3次，共最多4次成功 AI 点评；每次有效提交都重新调用 GPT-5.5，并显示“AI点评 x/4、已补充 x/3”。
- 只有真实 AI 点评成功才累计次数，网络备用提示不消耗补充机会；低质量本地拦截同样不计入 AI 点评次数。
- 第3次补充点评完成后停止继续补充，并强制显示“进入下一步”；即使最后一次点评仍建议完善，也不会把员工卡在当前阶段。
- App version: v360
- 待完成：发布前全量检查与发布后手机端真实流程验证。

## v359 (2026-07-10)

- 美感训练 AI 导师升级为 OpenAI `gpt-5.5`；官方模型页确认该模型支持 Chat Completions、图片输入和结构化输出。
- 修复 Supabase Edge Function 调用授权：前端对函数请求增加公开发布密钥的 `apikey` 与 `Authorization` 请求头，避免网关在进入函数前返回 401。
- 修复 Edge Function 旧部署中的字符串插值错误，改用 GPT-5.5 兼容的 `max_completion_tokens`；保留启用员工校验和模型名称回传。
- App version: v359
- Supabase `aesthetic-coach` Edge Function 已成功部署；使用启用员工“无名”的观察阶段测试真实返回 HTTP 200、有效中文点评、`ready=true` 和 `model=gpt-5.5`。
- 已通过：版本同步、发布完整性、美感训练、App 冒烟、Agent 状态及11组导师后端测试；待发布 App v359 后核对 GitHub Pages。

## v358 (2026-07-10)

- 修复美感训练导师服务地址兼容：Supabase Edge Function 使用完整函数地址，Cloudflare 隧道地址自动追加 `/api/aesthetic-coach`，避免切换服务后请求到错误路径。
- 导师请求失败时明确标记为“等待点评”，不再把尚未获得模型结果的回答误写成“未通过”；重试按钮改为“重新请求点评”，保留员工已填写的原答案。
- 当前 `tunnel-url.json` 采用稳定的 Supabase Edge Function；只读连通性检查确认 Edge Function OPTIONS 与备用 Cloudflare `/api/health` 均返回 200。
- 合并线上最新代码时同时清理了违规加入的 `perm-app.v350.html`、`perm-app.v352.html` 运行快照，并恢复被覆盖的后台美感知识入口，专项 CI 已恢复通过。
- App version: v358
- 已通过：版本同步、App 冒烟、美感训练、护理出库、22组发质任务、顾客档案、后台、预约、全局 UI、11组导师后端及17组美管加同步测试。
- 待完成：发布后核对 GitHub Pages 版本与导师真实点评流程。

## v352 (2026-07-08)

- 美感训练前端新增低质量回答预检：明显重复词组、中文乱码、随机键盘串或缺少发型画面关键词的回答会直接要求重写。
- `ready:false` 的导师反馈不再显示“继续下一步”；本地备用评分也不能通过训练阶段，必须拿到真实 AI 导师点评后才能继续。
- 个人上传训练图提交 AI 点评时会临时压缩为小尺寸 data image 发给导师服务；后端允许该临时图片输入并继续不落库保存。
- 后端低质量识别同步补强截图中的中文重复乱码场景，避免只靠字数误判为有效回答。
- 运行诊断确认导师 API 当前不是前端未接线：`OPENROUTER_API_KEY` 已读取但模型返回 402，`OPENAI_API_KEY` 已读取但官方 API 返回 401；公网 tunnel 已切到新的单实例地址。
- AI导师后端改为优先使用官方 `OPENAI_API_KEY`，默认 `gpt-4o`，失败后回退 `gpt-4o-mini`，OpenRouter 只作为最后备用。

## v351 runtime maintenance (2026-07-08)

- 美感训练 AI 导师默认模型从 OpenRouter `qwen/qwen3-vl-32b-instruct` 切换为 GPT：`openai/gpt-4o-mini`。
- 新增环境变量 `AESTHETIC_COACH_MODEL`，运行时可覆盖默认模型，无需再次改动代码。
- 训练接口行为、限流和员工核验逻辑保持不变；现有后端单测继续通过。
- 新增低质量回答拦截：对明显敷衍/乱码/重复字符/随机键盘字符串直接返回低分与重写提示，不再误进入正常点评。
- 提示词补充“无效回答必须低分并要求重写”的约束，进一步降低乱答误判为通过的概率。
- 默认模型升级为 `openai/o3`（更强推理），新增 `AESTHETIC_COACH_FALLBACK_MODEL` 回退到 `openai/gpt-4o-mini`，在主模型不可用时自动续用。

## v351 (2026-07-08)

- 美感训练新增“我的训练图库”：支持发型师在今日训练页上传个人图片并按登录员工隔离存储，默认仅本人可见。
- 上传图片会自动压缩并生成可用的五步训练引导（观察/分析/判断/设计/复盘），保证 AI 导师点评流程可直接复用。
- 今日训练案例改为“个人图库优先、系统案例兜底”，删除个人图片后会立即刷新今日案例与图库展示。
- 新增个人图库可视化列表与删除入口，列表标记当日命中案例，便于发型师维护自己的训练素材。

## v349 (2026-07-04)

- “今日训练”从 5 道选择题重做为单作品五步训练：观察、分析、判断、设计、复盘逐步完成，前一步提交后再进入下一步。
- 五步页面每次只呈现一个核心问题、3–4 个短提示和一个输入框，避免一次展示大量任务；首页明确训练“会看、会拆、会判断、会设计、会审美”。
- 新增 5 个版本化短发训练案例，每个案例都包含观察边界、五步引导和完整大师解析；单张照片看不到的脸型、发质或头型信息明确禁止猜测。
- 接入真实 AI 导师短点评：每一步返回一个具体肯定、1–3 个遗漏和一个追问；完成五步后才显示完整解析，AI 不直接代替发型师作答。
- 运行时新增 `scripts/aesthetic_coach_endpoint.py`，使用 OpenRouter `qwen/qwen3-vl-32b-instruct`，核验启用员工并按员工、IP 和全局限流；不保存训练请求，模型失败时 App 明确使用非 AI 的网络备用提示。
- AI 点评只使用仓库内已审核公开作品，不上传顾客照片；训练文字仍只在员工本机形成成长记录，正式知识标准继续由版本文件和后台来源治理控制。

## v348 (2026-07-04)

- App 工作台新增“美感训练”，包含每日 5 题、知识体系、六维成长记录和作品复盘；训练进度与复盘文字按登录员工保存在本机，顾客照片只做本机预览、不上传也不写入记录。
- 首版 `Hair Aesthetic System` 落地为 9 个章节、8 条统一风格坐标、6 个评分维度和 18 道带解释训练题；设计流程补入顾客目标与限制，不把风格标签直接当结论。
- 新增 14 条版本化知识来源，区分稳定标准、门店方法和趋势候选；每条来源记录机构、用途、证据类型、版权方式、审核状态和复核日期，外部教材只保存书目、链接与原创摘要。
- 总后台新增仅总管理员可见的“美感知识”页面，可查看来源、发布规则、章节和题库；支持登记当前设备的待评审候选和导出知识清单，候选不会直接进入 App 评分标准。
- 新增知识治理说明与自动检查，明确候选收集、来源和版权核验、专业审核、试用、版本发布、效果复盘的流程，以及 AI、顾客照片和匿名写入边界。
- 当前自定义员工会话无法为 Supabase RLS 提供可靠身份，因此本版不开放线上知识写权限；跨设备候选、审核和训练同步要在服务端认证、角色、RLS、私有图片存储与数据库审计完成后再启用。

## v347 (2026-07-03)

- 发质分析与预约改为一对一：预约卡携带美管加预约 ID，新建发质表把 `bookingId`、`bookingDate` 和 `visitDate` 保存到 `hair_records.record_data`。
- 预约页“待分析/已分析”不再按手机号跨历史判断；优先精确匹配预约 ID，旧表没有预约 ID 时只允许“同手机号＋同一天”兼容，不会把上次到店误当成本次已分析。
- 点击已分析只打开当前预约对应的表；从预约选择另一位或另一次预约时会启动全新表单并清除旧编辑 ID，避免覆盖上一次到店记录。
- 顾客档案继续按顾客显示一张汇总卡，详情循环展示每次预约保存的独立发质分析表。
- 只读核对哈维样本：2026-07-03 贺小姐预约 `291662726` 当前只有发质表 `#049`，历史11次到店/14条消费并没有另外的 `hair_records`，不是档案页面隐藏了已有表。

## v345 (2026-07-03)

- App 员工登录从固定12小时过期改为30天滚动有效期；每次打开 App 且云端确认员工仍有效、门店未变时，刷新本地 `loggedAt`。
- 停用、删除或更换门店的员工不会续期，仍会清理本地会话并要求重新登录；网络验证失败时也不会延长有效期。
- 已经被旧版清除登录信息的设备无法自动恢复，需要重新登录一次；之后正常打开 App 即可滚动续期。

## v344 runtime maintenance (2026-07-03)

- 修复护理出库员工为空：美管加员工选择实际读取 `outdepot.employeeid`，不再把发型师 ID 错写到 `operatid/staffId`；登录账号继续作为操作人，发型师作为出库员工。
- 自由手艺人人员映射改为门店内显式姓名→美管加员工 ID；未填写或未映射的发型师会在外部写入前安全失败，禁止生成无员工出库单。
- 创建、审核和最终完成前都会回查美管加单据的 `employeeid`；已有单据员工为空或与发型师不一致时进入 `needs_review`，不会误报完成。
- 部署目录曾存在未进入仓库的临时实现；本次恢复 `scripts/care_outbound_worker.py` 与 `scripts/care_outbound_store_config.json` 为唯一源，部署必须重新校验哈希。
- 用户确认 Gitee 已停用；GitHub `main` 现为唯一发布源，发布检查和协作说明不再访问 Gitee。
- 用户选择隔离7月1日旧批次：3个批次共14条队列已精确标记 `needs_review` 和“未自动出库”，未调用美管加写接口；修复版已部署并重新启用60秒任务。

## v344 (2026-07-01)

- 护理出库实验范围固定为自由手艺人；向里造型护理记录照常保存，但 App 明确显示暂未启用且不会生成美管加出库任务。
- App 出库队列升级为协议 v2：按发质表、门店、产品和累计目标克数生成确定性负数队列 ID；重复保存、网络中断恢复或重复提交会复用同一行。
- 新增仓库唯一执行器 `scripts/care_outbound_worker.py` 和门店映射 `scripts/care_outbound_store_config.json`；已通过部署脚本同步到 `~/.hermes/scripts/` 并校验哈希。
- 执行器只处理协议 v2 负数 ID，按真实克数和 `outwaretype=8` 创建出库单，再调用审核接口并回查单据；只有状态为已审核且 depotId/克数完全一致才标记完成。
- 美管加结果不明确时进入 `needs_review`，App 不提供盲目重试；总后台按同批次核对后重试，并显示门店、发型师、关联发质表和新版处理状态。
- 旧版待处理正数队列 7-17 共 11 条已按 ID 和 pending 状态条件隔离为 `legacy_review`，没有触发美管加出库。
- 生产队列使用负数 ID `-4343000000000001` 做过一次幂等协议探针：首次插入 1 行、重复插入 0 行，确认主键冲突保护有效；该探针未调用美管加，因匿名策略不允许删除，已明确标记 `completed` 和“未扣库存”。
- 受控真实测试已完成：自由手艺人 `歌薇酸性护理6A` 出库1克，美管加单号 `CPKY20260701001` 已审核，库存从756克准确降至755克。
- 实测确认保存载荷必须使用顶层 `shopId` 和 `outdepot.details`；旧字段会生成无明细空壳单。测试中产生的未审核空壳单 `73539954` 已安全删除，未改变库存。
- 自由手艺人真实运行开关已开启，LaunchAgent `com.freecraftsman.care-outbound` 已安装，每60秒运行一次；向里造型仍保持关闭。

## v342 (2026-06-30)

- 后台新增绑定门店的 `store_admin` 分店管理员角色；总管理员可在员工管理中为指定门店设置分店管理员，登录会话必须携带门店。
- 向里造型分店后台只保留工作台、注册审核、员工管理、发质任务、护理管理、月度报表、本店作品审核和本店操作记录；顾客档案、回访任务、异常中心、AI分析队列和首页推荐不展示且有直接调用守卫。
- 注册和员工管理锁定本店；分店管理员只能新增、审核或修改本店普通员工，不能授予管理员、切换门店或编辑管理员账号。
- 发质任务和月报按发型师所属门店过滤；护理明细、用量更正和月度统计固定 `shop_name`，全局护理产品配置仅总后台可见。
- 作品审核按上传员工所属门店过滤，分店可通过、拒绝和下架本店作品；首页展示开关、排序和上传继续只允许总后台操作。
- 本机操作记录增加角色和门店范围，分店端只显示及清理本店记录；本次未创建分店管理员账号，也未修改生产员工或业务数据。

## v341 (2026-06-30)

- 修复发质分析选择按钮选中与未选中颜色过于接近的问题：实际交互使用的 `.active` 状态现在为纯黑底、白字、加粗、外描边并显示 ✓，未选中保持浅灰。
- 协作技师、发质诊断等同类选项统一使用明确选中态；涂抹顺序继续保留数字序号，不重复显示 ✓。
- A/B/C 效果评定增加独立选中类、纯黑高亮和 ✓；切换评定时旧选项会完整恢复未选中状态。
- 仅调整前端视觉反馈和状态类，不修改表单字段、保存条件、回传流程或云端数据。

## v340 (2026-06-30)

- 发质分析页拆分为“新建分析 / 我的任务”两个独立视图，顶部吸附切换；任务不再埋在超长表单底部。
- 客户信息区改为两列姓名/电话、整行预约选择、独立发型师与助理区域，手机填写层级更清楚。
- 排杠参数从手机五列拥挤表格改为按头顶、枕骨、两侧、刘海、后颈分区的 2×2 输入块，杠号、手法、起点和角度均保留原字段与保存逻辑。
- 任务页增加说明标题，待处理任务优先；从任务点编辑或填写回访会自动切回对应表单，云端编辑期间不显示任务列表。
- 修复刷新时恢复发质分析页早于渲染函数注册、导致空白页面和 `renderHairAnalysis is not defined` 的初始化时序问题。
- 未修改开单、技师回传、回访完成判定、客户归档、护理出库或 Supabase 数据结构。

## v339 (2026-06-30)

- 首页恢复 v337 原有的完整企业文化文案，不再只显示 v338 的两行精简说明。
- “自由手艺人”主标题由 39px 调整为 35px，380px 以下小屏为 33px；文化文案提高灰度对比并保持极简左对齐版式。
- 新增统一 UI 测试断言，防止完整企业文化文案或首页标题尺寸再次被意外覆盖。

## v338 (2026-06-30)

- 前端 App 从预约页扩展为整套统一的黑白极简设计系统，覆盖首页与工作台菜单、员工登录注册、专业方案、冷烫、作品、预约、发质分析、护理、我的任务及客户方案/档案内容。
- 首页改为编辑式品牌排版和精简文案，作品轮播增加明确入口；工作台菜单补齐作品入口和功能说明，手机与桌面固定导航统一跟随 480px App 容器。
- 方案与冷烫移除厚重卡片、彩色边框和多余阴影；作品页改为黑底画廊与文字筛选；发质表、任务和客户档案统一为留白、细分隔线和黑白控件。
- 登录注册弹窗重做信息层级、输入框、职位选择和主次按钮；修复统一输入样式误放大职位复选框，以及居中桌面布局下关闭菜单仍露在页面左侧的问题。
- 不修改预约查询、药水计算、发质任务状态、回访归档、护理出库、客户数据或保存流程。
- 新增 `scripts/test-app-ui-system.js` 并加入 pre-push 与 GitHub CI，保护统一页面标题、菜单入口、桌面抽屉关闭状态、注册复选框、发质表和客户档案的公共样式结构。

## v337 (2026-06-30)

- 前端 App 预约页改为极简黑白信息架构：无底色身份栏、选中日期标题、无边框日期按钮、紧凑门店二段切换和时间优先的预约列表。
- 预约卡取消浅色整块背景、左侧竖线和彩色项目胶囊；时间只显示一次，客户、手机号、发型师分层排列。
- 美管加 `service_name` 明确显示为“预约项目”普通文字；只有烫染、待分析和已分析保留状态标签，避免预约项目被误认为客户持有卡项。
- “查看方案”改为语义化文字按钮并兼容点击箭头子元素，客户方案与发质入口逻辑保持不变。
- 日期渲染改为函数内自包含星期文案，修复直接恢复预约页时星期数组尚未初始化、页面停在加载中的问题。
- 新增 `scripts/test-booking-ui.js` 并加入 pre-push 与 GitHub CI，锁定预约项目标识、时间不重复、按钮语义和初始化顺序；现有后台工作流测试也补入 CI。

## v336 (2026-06-30)

- 护理管理的月度统计为每个发型师增加“编辑用量”按钮；按钮按当前统计年月自动定位该门店和发型师的护理明细，再通过既有“更正”入口逐条修改并填写原因，避免直接篡改由多条明细汇总出的合计值。
- 护理明细更正成功后同时刷新明细和月度汇总。
- 修复后台已登录会话刷新时初始化过早的问题；所有页面加载器注册完成后才恢复会话和绑定导航，避免 `loadDashboard is not defined` 导致侧栏失效。
- 只读核对 2026-07-01 10:30 的邓小姐预约（尾号 4880）：Supabase 预约 `service_name`、美管加原始 `categoryName` 和 `itemProp.items` 均为“资生堂短发680（3折）”；客户档案套餐实际只有“酸护套餐9”和“健康染长发1460补染”。截图标签是预约中选定的服务项目，不是客户持有卡项；本次未修改预约或客户数据。

## v335 (2026-06-29)

- 后台改为分组侧栏与工作台，注册审核、在职员工、客户回访、发质任务、护理、月报、作品、异常和本机操作记录各自独立；手机端使用抽屉侧栏。
- `发质配置`、`款式管理`、`烫发方案` 三个管理模块仅从 `admin.html` 移除；未执行数据库删除、迁移或配置数据写入，App 的 `perm_data` 读取保持不变。
- 注册申请与在职员工分开；通过注册时核对门店/职位并固定普通员工角色，新建或重置员工密码统一保存 SHA-256 摘要。
- 回访任务按 `notes.follow_ups[].next` 计划日判断今日、逾期和未来 7 天；月度报表改用 `hair_records`，只有 `回访完成` 且存在评定或本单截图才计为流程完成。
- 作品审核与首页展示分离：移出首页只清除 `is_carousel`，不再拒绝作品；支持排序。App 首页先显示静态首图，后台轮播图片全部预加载成功后再无闪白切换。
- 护理产品已有历史引用时禁止删除；历史护理记录更正必须填写原因并记录更正前后内容。异常中心支持查看和安全重试失败出库记录。
- `admin-panel.html` 统一跳转到规范后台 `admin.html`；新增 `scripts/test-admin-workflow.js` 并加入 pre-push。

## v334 (2026-06-29)

- 修复 App 首页启动闪屏：普通 `perm-app.html` 启动不再为了追加 `?_v=版本号` 执行 `location.replace`，避免首页完整渲染后立即发生第二次整页加载。
- 保留 `version.txt` 防缓存检测和用户主动更新提示；发现新版本时仍只提示，不强制刷新正在使用的页面。
- 浏览器复现确认 v333 普通启动会连续请求 `perm-app.html` 与 `perm-app.html?_v=333`；v334 回归要求普通启动只加载一份页面文档。
- App 冒烟测试新增首页启动不得强制二次导航的发布保护。

## v333 (2026-06-29)

- 发型师在云端发质表中完成 A/B/C 评定或上传本单聊天截图后，点击「保存档案」会直接把行状态和 `record_data.status` 写为 `回访完成`，不再停留在 `技师已完成/待发型师回访`。
- 技师或助理本人新建发质表并选择其他发型师时，系统自动把当前员工记为技师并以 `技师已完成` 直接回传发型师；技师未选择发型师或未填写实际内容时禁止回传。
- 技师尚未回传时，即使误填评定也不会提前结束任务；回访完成仍严格要求评定或本单截图二选一。
- 线上只读核对 6 张技师回传单，仅发现 `1782479086695_yk6t`（宣女士，尾号 3150）已有 A 评定但仍是 `技师已完成`；已按 id、姓名、电话、原状态条件只修复该行并复查为 `回访完成`。
- 发质任务状态测试扩展到 22 个状态、归档和开单场景。

## v332 (2026-06-29)

- 合并 Hermes 的 v331 提交历史但保留稳定页面，避免旧整页再次覆盖消费项目、金额、服务人员、套餐有效期和最新到店排序。
- 步骤4新增烫发备注，草稿、云端归档和再次编辑均保存/恢复同一字段。
- 预约同步改为稳定 ID 全字段 upsert；只有对应门店和日期的接口成功后才允许删除缺失预约，HTTP/API/写入失败会真实返回失败。
- 预约同步与保活只从本机权限 600 的认证文件读取账号，仓库及运行脚本不再保存明文密码。
- 客户回填恢复受版本控制的 2 秒限速，停止无限循环；回填只保留一个限速调度入口。
- 新增客户档案回归测试和预约同步单元测试，并加入 pre-push 铁律。

## v331 (2026-06-27)

- 美管加消费记录接口已实测恢复：账单列表 `member!queryMemberBillListnew.action`，账单明细 `bill!detail.action`。
- 唯一受版本控制的客户同步源是 `scripts/sync_mgj_customer_profiles.py`；Hermes cron 路径 `/Users/a1/.hermes/scripts/sync_mgj_all.py` 必须由该文件部署，禁止单独修改后不回写仓库。
- 同步改为非破坏性合并：套餐或账单接口失败时保留旧数据；成功时按美管加账单 ID 去重，并保存项目、金额、服务人员、门店和套餐有效期。
- App v331 客户档案展示完整同步账单和套餐明细。
- 双店账单参数已按美管加 SPA 修正：账单 `shopid` 使用客户详情所属门店，多卡客户跳过首张默认空卡。
- 正常同步在每小时 `00/30` 分轮换 20 人；缺失字段回填在 `15/45` 分断点处理 20 人。两者共用文件锁，回填只补空字段，不覆盖已有消费或套餐。
- 2026-06-28 样本验证：尾号 5050 为 20 笔消费、5 个套餐；回填 id 63 保留原 32 个套餐并新增 348 笔消费。
- 2026-06-28 全量分页审计：`customer_profiles` 共 15748 行；5629 行有到店次数但无消费明细，3291 行有消费金额但无明细，261 行有套餐。此前 1000 行统计仅是 Supabase 单页样本。
- 美管加保活唯一源文件为 `scripts/mgj_keepalive.py`，Hermes 任务 `25e56b7f1ac0` 每小时 50 分运行。它先验证 `code=0`，仅过期时重登，原子更新 Cookie，并与客户同步共用 `/tmp/sync_mgj_all.lock`。
- 保活凭据仅存于本机权限 600 的 `~/.hermes/meiguanjia-auth.json`，状态写入 `~/.hermes/mgj_keepalive_status.json`；禁止把账号密码写回仓库脚本。

This file is the live handoff baton between Codex, Hermes, and any other assistant.
Every meaningful change must update this file before commit/push.

## Current Shared State

- App version: v352
- Last synchronized base checked: GitHub `6317238`
- GitHub live branch: `github/main`
- Gitee: retired; do not fetch or push
- Required state before editing: local `HEAD` includes `github/main`
- Current owner: handoff ready for either Codex or Hermes

## Last Completed Work

- v352: 美感训练乱答拦截扩展到前端本地备用与后端模型入口，`ready:false` 时禁止继续下一步；个人上传图会临时压缩传给 AI 导师点评，不保存到公共库。
- v352 runtime maintenance: 停掉并禁用重复 cloudflared tunnel，仅保留 `com.hermes.cloudflared-tunnel`；`tunnel-url.json` 更新为当前可用地址，后续需更换/修复有效模型 API key 后再恢复真实点评。
- v352 runtime maintenance: 写入新的官方 OpenAI API key 后，后端改为 OpenAI 官方 API 优先，避免 OpenRouter 402 继续阻断美感训练点评。
- v351 runtime maintenance: 美感训练 AI 导师默认改为 `openai/o3`，并新增主模型失败自动回退机制，优先保证深思考质量同时避免服务中断。
- v351 runtime maintenance: 美感训练后端新增乱答识别与重写引导，明显无效回答会被直接低分拦截，不调用模型。
- v351 runtime maintenance: 美感训练点评模型默认切到 GPT（`openai/gpt-4o-mini`），并支持 `AESTHETIC_COACH_MODEL` 环境变量覆盖。
- v351: 美感训练支持个人私有上传图库（上传/删除/当日训练命中），并为上传图片自动生成五步训练引导；今日训练优先使用个人案例，无个人图时回退内置案例。
- v349: 今日训练升级为作品驱动的五步 AI 导师训练，新增 5 个带观察边界和大师解析的案例；OpenRouter 点评服务已部署并通过公网实测。
- v348: App 新增美感训练、每日答题、知识地图、成长记录与本机作品复盘；总后台新增版本化来源目录和本机知识候选登记，正式知识使用三层治理和自动完整性检查。
- v347: 每个预约独立保存发质分析表，预约状态和打开旧表均按预约 ID 匹配；旧数据仅同手机号同日兼容，并在后续编辑时保留原到店日期。
- v345: 员工登录改为30天滚动续期，同时保留云端停用、删除和门店变更的强制退出检查。
- v344 runtime maintenance: 护理出库改用美管加真实员工字段 `employeeid`，操作人与发型师分离，并在创建后、审核后回查员工；未映射人员禁止出库。
- v344: 自由手艺人护理出库升级为确定性队列、创建/审核/回查三阶段执行器并每60秒自动运行；向里暂不接入，旧版任务隔离。
- v342: 增加绑定门店的分店管理员后台；向里造型仅管理本店员工、发质、护理、月报和作品审核，首页推荐及客户/回访/系统权限保留总后台。
- v341: 发质分析选择项和 A/B/C 评定改为纯黑底、白字、✓ 的高对比选中反馈。
- v340: 发质分析页增加表单/任务双视图，重排客户信息和手机排杠输入，并修复刷新恢复空白页。
- v339: 首页恢复完整企业文化文案并缩小“自由手艺人”标题，保留 v338 极简视觉系统。
- v338: 整套前端 App 完成统一黑白极简重构，覆盖首页菜单、登录注册、方案、冷烫、作品、发质分析、任务和客户档案内容；业务逻辑保持不变。
- v337: 前端预约页完成极简黑白重构，预约项目与客户卡项视觉语义分离，修复直接恢复预约页的日期初始化时序。
- v336: 护理月度统计增加按发型师进入明细更正的入口，修复后台已登录刷新初始化时序；确认截图项目来自美管加原始预约而非客户卡项。
- v335: 后台信息架构和注册审核重做，三个不用的配置模块只从后台移除，回访/月报/作品轮播/护理更正/异常重试按真实业务规则收口。
- v334: 移除正常首页启动的版本参数强制跳转，保留用户主动更新机制，消除整页二次加载闪屏。
- v333: 修复发型师已评定后「保存档案」仍停留在回访的问题，并补齐技师直接开单回传发型师的入口状态。
- v332: 烫发备注随发质表保存、归档和再次编辑；客户消费/套餐丰富展示受到发布测试保护。
- v332: 预约同步按门店+日期隔离删除授权，完整回写手机号/发型师/服务/状态，失败不再伪装成功。
- v332: 停止 Hermes 遗留无限回填，统一预约、客户回填和保活的唯一源文件与调度规则。
- v330: 发质分析任务统一为“待技师填写 → 技师已完成/待发型师回访 → 回访完成”；旧 `已完成/已保存` 不再被误判为回访完成。回访完成必须有 A/B/C 评定或本单截图，App 与后台统计使用同一规则。
- v330: 所有任务统一只展示最近 30 天；技师未回传时不显示“填写回访”，技师回传后不再显示“待技师填写”，技师仍可继续修改，发型师最终回访后归档。
- v330: 回访截图从全局 localStorage 改为压缩后保存到当前 `hair_records.record_data.followUpScreenshot`，杜绝上一位顾客截图串到下一张表。
- v330: 员工登录直接绑定本人和所属门店，不再登录后任选身份；预约选择器按门店与发型师双重过滤，发型师/助理选项继续限定同门店。员工会话 12 小时，后台管理员会话 2 小时。
- v330: 客户档案列表扩大到 1000 条摘要，点开客户后按手机号/姓名重新读取完整 profile 字段，已有 `service_history/card_packages/notes` 会完整参与显示。
- v330: 护理出库增加两阶段待提交标记；队列写入后若快照保存中断，重试会恢复原批次而不是再次扣库存。
- v330: 发质表新编号保存前会读取云端最大编号抬高本机计数器；已有 `record_data.seq` 继续原样保留，版本更新不会重编号。
- v330: 新增 GitHub `Validate shared app` CI、版本单调/旧快照覆盖检查、发质任务状态测试；Codex 与 Hermes 本地仓库均启用 `.githooks/pre-push`。
- v329: 向前恢复被 GitHub 提交 `737394b` 用 v322 整页覆盖的 `perm-app.html` 与 `admin.html`，保留 v328 的任务软删除、后台管理和护理差额出库功能；未回退 Git 历史。
- v329: 修复发质分析表直接查询烫发方案时 `perm_data` 尚未加载的问题。并发入口共享同一个加载任务，查询按钮会等待云端或离线数据完成后再计算。
- v329: 浏览器检测到线上版本低于本机见过的最高版本时不再清空最高版本记录，而是显示版本异常提示。
- v328: 修复护理出库从 v321 起静默失败的问题。根因是 App 向 `care_outbound_queue` 写入数据库不存在的 `barber` 字段，PostgREST 返回 400，但旧代码没有检查 HTTP 状态。
- v328: 护理产品不再在点击“添加”时立即出库；只有技师回传或发型师最终保存成功后才批量进入美管加出库队列。
- v328: 同一张发质分析表按品牌/产品累计克数，只提交相对上次出库快照的新增差额，防止重复保存造成重复扣库存；已出库数量不能直接减少。
- v328: 出库队列写入与护理记录写入均检查 HTTP 错误；出库状态显示“同步中/已完成/失败”，失败项目支持单独重试。
- v328: `care_records` 改为先删除该发质表旧明细，再一次性批量重建，移除旧流程多处重复插入导致的护理记录重复。
- v328: 发布检查新增护理出库铁律：点击“添加”不得直接写出库队列、队列载荷不得包含不存在的 `barber` 字段，并自动测试首次 15g、重复 0g、增量 5g、减量阻止。
- v327: 修复后台软删除发质分析表后，App「我的任务」仍显示旧云任务的问题；任务查询与前端渲染双重排除 `status=deleted`。
- v327: 预约烫染标记、客户档案、客户历史发质记录、后台统计与未完成明细统一排除已删除的 `hair_records`。
- v327: 修复 v326 页面版本与 `version.txt/version.json` 仍停在 v322 的不一致，三处版本统一为 327。
- v327: 冒烟检查新增铁律，`renderMyTasks` 的云任务查询必须排除软删除记录。
- v326: 懒加载 `perm_data`，首次进入方案页时再请求。
- v325: 待处理任务不受日期限制，已完成任务只显示最近 30 天。
- v324: 我的任务增加待处理优先区并调整为黑白配色。
- v323: 我的任务按日期分组。
- v322: 降低轮询频率并精简查询字段。
- v321: 修复版本降级导致的无限跳转闪屏。
- v320: 护理产品添加后自动推送出库队列。
- v319: 发质分析表预约选择器改为展示所有客户（不再仅限烫染/护理），删除 `bookingNeedsHairAnalysis` 过滤条件。空列表文案改为「暂无预约」。
- v317 prevents pure haircut appointments from entering the hair-analysis booking picker/task path.
- v317 prevents silent close/autosave from creating empty `hair_records` tasks.
- v317 prevents assistants from returning an empty cloud hair form as `技师已完成`.
- v317 prevents empty hair forms from being archived as customer records.
- v317 adds admin deletion for `hair_records` from the backend hair-analysis record list, deleting linked `care_records` first.
- Investigated sample `宋奕 / 15858274326 / #012 / hair_records id 1782448281615_3cp3`: the booking source is `预约剪发`, while the cloud hair record has mostly empty analysis/perm/dye/care fields and was marked `技师已完成`.
- Added this shared Codex/Hermes handoff baton and `scripts/check-agent-sync-status.js`.
- Added the baton check to `.githooks/pre-push`, `AGENTS.md`, `CLAUDE.md`, `PUBLISH_RULES.md`, `AI_COLLABORATION_RULES.md`, and `HERMES_HANDOFF.md`.
- v316 reviewed Meiguanjia synchronization risk areas.
- Booking cache now includes shop/date/barber context to reduce stale appointment display.
- Booking DOM change detection now includes phone and reservation time.
- Customer profile reads sample more rows for archive/package visibility.
- Added `MEIGUANJIA_SYNC_REVIEW.md` and `scripts/audit-meiguanjia-sync.js`.

## Last Verification

- 2026-07-08: AI导师连通性诊断确认本机 `/api/health` 正常、`OPENROUTER_API_KEY` 已读取但模型调用返回 402、`OPENAI_API_KEY` 已读取但官方 API 返回 401；新 tunnel `waiver-jaguar-logged-curves.trycloudflare.com` 的 `/api/health` 与低质量 POST 均返回 200。
- 2026-07-08: 新 OpenAI API key 最小请求返回 200；OpenAI 优先/失败回退 OpenRouter 逻辑通过 `python3 -m unittest scripts/test_aesthetic_coach_endpoint.py`（11项）与 `python3 -m py_compile scripts/aesthetic_coach_endpoint.py`；运行端已部署重启，本机与公网 tunnel 正常回答均返回 200 且 `model=gpt-4o`。
- 2026-07-08: v352 通过 `python3 -m unittest scripts/test_aesthetic_coach_endpoint.py`（9项，覆盖截图中的中文重复乱码与个人上传 data image）、`python3 -m py_compile scripts/aesthetic_coach_endpoint.py`、`node scripts/check-version-sync.js`、`node scripts/test-aesthetic-system.js`、`node scripts/smoke-test-app.js`、`node scripts/check-release-integrity.js`、`node scripts/check-agent-sync-status.js`。
- 2026-07-08: 美感训练模型升级为 `openai/o3` 并新增自动回退后，`python3 -m unittest scripts/test_aesthetic_coach_endpoint.py`（7项）与 `python3 -m py_compile scripts/aesthetic_coach_endpoint.py` 通过；新增断言验证主模型失败会切换到回退模型。
- 2026-07-08: 美感训练“乱答拦截”新增后，`python3 -m unittest scripts/test_aesthetic_coach_endpoint.py`（6项）与 `python3 -m py_compile scripts/aesthetic_coach_endpoint.py` 通过；新增断言验证低质量回答不会调用模型且直接低分返回。
- 2026-07-08: 美感训练模型切换到 GPT 后，`python3 -m unittest scripts/test_aesthetic_coach_endpoint.py`（5项）与 `python3 -m py_compile scripts/aesthetic_coach_endpoint.py` 通过；未改动训练接口入参、限流与员工核验。
- 2026-07-03: v347 预约ID精确匹配测试覆盖同手机号跨日期、同日不同预约、旧表同日兼容和精确队列优先；版本/发布完整性、App语法、预约UI、22组发质任务、顾客档案、全局UI、后台、护理出库及25组Python同步测试全部通过。
- 2026-07-03: v345 版本一致性、发布完整性、App JavaScript语法、30天有效期/云端验证后续期/停用与门店变更退出断言、全局UI、预约和22组发质任务测试通过。
- 2026-07-03: 美管加库存前端只读源码确认员工选择绑定 `bill.employeeid`；最近护理 App 出库单回查为 `operatid` 有值而 `employeeid=null`，确认员工为空的直接根因。
- 2026-07-03: Supabase 只读检查发现 7 月 1 日仍有 3 个协议 v2 待处理批次；两批产品映射完整，共169克，第三批169.3克包含错误品牌下的1/2/4/5号并会安全失败。重新启用前必须明确这些旧批次是否处理。
- 2026-07-03: 新增员工字段、员工回查和未映射阻断测试，8组执行器单元测试、护理队列静态测试、Python语法和 whitespace 检查通过；未调用美管加写接口、未改变库存。
- 2026-07-03: 旧批次14条按明确ID从 `pending` 隔离为 `needs_review`，复查 active pending/processing 为0；仓库与 `~/.hermes/scripts` 的执行器和配置哈希一致，`runtime_enabled=true`，LaunchAgent最近退出码0并记录“没有协议v2待处理任务”。
- 2026-07-01: v344 代码提交 `ca8853c` 已同步到 GitHub `main` 和 Gitee `master`，双远端哈希一致；GitHub Pages 已返回 `version.txt=344` 和 `data-version=344`。
- 2026-07-01: 自由手艺人6A真实出库1克验证成功；美管加单据 `73539957 / CPKY20260701001` 为已审核，明细 depotId `23043758` 数量1，库存756克→755克。首次错误字段生成的未审核空壳单 `73539954` 已删除，回查不存在且库存未变。
- 2026-07-01: LaunchAgent `com.freecraftsman.care-outbound` 已加载，运行间隔60秒，最近退出码0；日志显示没有协议v2待处理任务，Supabase负数队列无 pending/processing/failed/needs_review。
- 2026-07-01: v344 App确定性队列测试、6组执行器创建/审核/回查单元测试、22组发质任务、后台工作流、客户档案、预约和全局UI测试全部通过；17组美管加同步Python测试、版本/发布完整性、脚本语法、Agent状态和 whitespace 检查通过。
- 2026-07-01: 仓库执行器、门店配置、LaunchAgent 与部署副本一致；真实运行开关只对自由手艺人开启，后台任务最近退出码0，当前没有协议v2待处理任务。
- 2026-07-01: 美管加只读核对确认自由手艺人20个护理产品均有独立 depotId；真实已审核出库单使用 `outwaretype=8` 和原始整数/小数克数。前端库存组件源码确认审核载荷包含单据ID、审核人、门店、原类型和待审核状态。
- 2026-07-01: 旧队列正数 ID 7-17 共11条从 `pending` 条件隔离为 `legacy_review` 并逐条复查；协议探针验证确定性负数ID首次插入成功、重复插入被主键忽略，未调用美管加、未扣库存。
- 2026-06-30: v342 代码提交 `c95deb5` 已同步到 GitHub `main` 和 Gitee `master`，双远端哈希一致；GitHub Pages 已返回 `version.txt=342`，线上后台确认 `store_admin`、8 模块白名单、本店作品/发质过滤和首页推荐总后台守卫均已生效。
- 2026-06-30: v342 本地浏览器验证向里造型 `store_admin`：桌面和 390×844 手机端只显示 8 个授权模块；员工列表 11 行全部为向里造型，门店选择锁定，新增员工仅有普通员工角色；护理明细/月报锁定本店，发质页没有全局 AI 队列。作品审核只显示向里员工陈浩的真实作品，操作仅有拒绝/下架而没有首页推荐。切换总管理员后客户、回访、异常和首页展示入口仍完整；控制台无 error/warning，未执行任何保存或生产数据写入。
- 2026-06-30: v341 代码提交 `58ef11f` 已同步到 GitHub `main` 和 Gitee `master`，双远端哈希一致；GitHub Pages 已返回 `version.txt=341`，线上文件确认高对比 `.active` 选中态、✓ 标记和 A/B/C 独立选中类均已生效。
- 2026-06-30: v341 本地浏览器在 390×844 下实际点击发根色度、协作技师和 A/B/C 评定；选中项计算样式为 `rgb(17,17,17)` 黑底、白字、✓ 和外描边，取消或切换后恢复浅灰。控制台无 error/warning，未保存表单或写入生产数据。
- 2026-06-30: v340 代码提交 `b0a03d4` 已同步到 GitHub `main` 和 Gitee `master`，双远端哈希一致；GitHub Pages 已返回 `version.txt=340`，线上文件确认双视图、预约选择、手机排杠区和刷新恢复时序修复均已生效。
- 2026-06-30: v340 本地浏览器在 390×844 下验证新建分析、客户区、五个排杠分区和“我的任务”8张真实任务卡；任务 #021 点编辑后正确回到张小姐表单并显示“保存档案”。页面无横向溢出，刷新恢复发质页后渲染完整，未执行保存或生产数据写入。
- 2026-06-30: v339 代码提交 `fc454ca` 已同步到 GitHub `main` 和 Gitee `master`，双远端哈希一致；GitHub Pages 已返回 `version.txt=339`，线上文件确认完整企业文化首尾文案及 35px/33px 标题字号规则均已生效。
- 2026-06-30: v339 本地浏览器在 390×844 下确认完整五段企业文化均显示，主标题计算字号为 35px，文案区域无遮挡和横向溢出；浏览器控制台无新增 error/warning。
- 2026-06-30: v338 代码提交 `ee583ca` 已同步到 GitHub `main` 和 Gitee `master`，两端远端哈希一致；GitHub Pages 已返回 `version.txt=338`，线上 `perm-app.html` 已包含统一设计系统、员工登录注册层级和新版发质分析页壳。
- 2026-06-30: v338 本地浏览器在 390×844 下逐页验证首页菜单、员工登录注册、方案换算、冷烫、作品、预约、发质分析、护理/保存区和 8 张真实任务卡；默认 1280×720 下确认 App 维持 480px 居中、固定导航对齐，关闭菜单不再露出。浏览器控制台无新增 error/warning，未提交表单或修改生产业务数据。
- 2026-06-30: v338 新增统一 UI 静态回归测试；现有预约 UI、22 组发质任务状态、客户档案和 App 冒烟测试在改版后通过。
- 2026-06-30: v337 代码提交 `e11204a` 已同步到 GitHub `main` 和 Gitee `master`，远端哈希一致；GitHub Pages 已返回 `version.txt=337`，线上 `perm-app.html` 包含新版日期标题、时间列、预约项目说明和极简空状态。
- 2026-06-30: v337 本地浏览器在 390×844 手机尺寸验证 2026-07-01 邓小姐预约：时间、客户、发型师、手机号和“预约项目”层级正确，“查看方案”可打开客户方案；默认 1280×720 下 App 保持 480px 居中。未修改预约、客户或卡项数据。
- 2026-06-30: v337 浏览器首次恢复预约页时发现并修复 `renderDateStrip` 初始化时序；修复后今天/未来 7 天日期按钮与选中日期标题正常渲染。
- 2026-06-30: v336 本地浏览器使用真实护理数据只读验证“编辑用量”：cesi 行自动筛选自由手艺人/cesi，打开 4 条明细和 4 个更正入口，合计 9.0g；未保存任何更正。后台刷新后工作台和护理导航正常，无新增控制台错误。
- 2026-06-30: 通过当前有效美管加会话只读请求原始预约接口，预约 id 291979007 的 `categoryId=-1`，`categoryName` 与 `itemProp.items[51437].name` 均为“资生堂短发680（3折）”；未执行同步写入或数据修复。
- 2026-06-29: v335 提交 `f1f34a6` 已同步到 GitHub `main` 和 Gitee `master`，两端远端哈希一致；GitHub Pages 已返回 `version.txt=335`。线上文件确认新后台导航、注册审核、异常中心、动态轮播和旧后台跳转均生效，三个配置模块的导航与后台 REST 接口均不存在。
- 2026-06-29: v335 后台与 App JavaScript 语法、后台工作流静态约束、HTML 页面层级和重复 ID 检查通过；本地浏览器确认后台桌面/390px 登录页、旧后台地址跳转、App 首页动态轮播和控制台无错误。未写入生产业务数据。
- 2026-06-29: v334 完整回归通过：版本/发布完整性、App 冒烟、护理出库、22 组发质状态、客户档案及 17 个 Python 同步测试全部通过。
- 2026-06-29: v334 本地浏览器普通 URL 启动后仍停留在 `perm-app.html`、页面版本为 334、控制台无错误；HTTP 日志仅有 1 次页面文档请求。
- 2026-06-29: v334 修改前浏览器与本地 HTTP 日志复现同一次首页启动请求两份页面文档；新增冒烟断言阻止正常启动重新引入 `location.replace`。
- 2026-06-29: v333 发质任务 22 组状态/归档/开单测试、App 冒烟和 JavaScript 语法检查通过；本地页面可正常加载，未使用测试数据写入线上。
- 2026-06-29: 线上异常单 `1782479086695_yk6t` 条件修复恰好更新 1 行；复查行状态、`record_data.status` 均为 `回访完成`，A 评定保留。
- 2026-06-29: 新预约脚本真实执行成功：双店未来 8 天共 16 个门店/日期请求全部成功，读取并 upsert 237 条，删除 0 条；随后 Hermes 每 5 分钟自动任务再次运行，状态仍为 `healthy`。
- 2026-06-29: 预约、客户和保活的仓库源文件与 `~/.hermes/scripts` 部署文件 SHA-256 一致；旧预约脚本已被无明文凭据版本覆盖。
- 2026-06-29: 无限回填进程已通过 Hermes 进程注册表终止并注销；OS crontab 只保留 `:00/:30` 常规客户同步，Hermes 回填为 `:05/:20/:35`，保活为 `:50`。
- 2026-06-29: 首个 50 人回填批次触发 Hermes 120 秒脚本上限，已将单批调整为 15 人并保留每人 2 秒限速，避免进程被超时中断。
- 2026-06-29: 调整后真实回填 15/15 成功，耗时 82.2 秒；消费记录和套餐均有实际写入，状态正常结束为 `healthy`。
- 2026-06-29: 全量只读审计：15,758 个客户中 7,730 个已有消费明细，1,870 个已有套餐；仍有 2,265 个有到店次数但消费明细为空，将由断点回填继续补齐。预约表共 863 条，当前同步窗口已按稳定 ID 全字段刷新。
- 2026-06-29: v332 版本、发布完整性、App 冒烟、护理出库、7 组任务状态、客户档案防降级及 17 个 Python 同步测试通过。
- 2026-06-27: v330 版本、发布完整性、冒烟、护理两阶段出库、7 组任务状态、App/后台脚本语法与 whitespace 检查通过。
- 2026-06-27: 只读核对 13 条有效 `hair_records`：2 条 `回访完成` 均有 A 评定；2 条旧 `已完成` 没有评定，v330 会正确显示为待回访。
- 2026-06-27: 美管加同步只读审计 1000 条客户档案：839 条有到店次数但无消费/到店明细，821 条有消费金额但无明细，60 条有套餐、50 条有剩余套餐。
- 2026-06-27: Chrome 中 App/美管加旧标签页被已有自动化会话占用，本次没有抢占或在美管加执行写操作。
- 2026-06-27: v329 版本一致性、冒烟、护理差额出库、Agent 同步、App/后台脚本语法检查均通过。
- 2026-06-27: 确认 GitHub `737394b` 把线上页面版本从 v328 降为 v322，同时 Gitee 仍停留在 v328；v329 使用向前提交恢复，不允许对共享分支强制回退。
- 2026-06-27: 只读检查 `care_outbound_queue`：旧 v320 测试共 5 条，4 条 `completed`、1 条因测试产品无 `depotId` 为 `failed`，证明后台执行器存在。
- 2026-06-27: 只读查询 `care_outbound_queue.barber` 明确返回 PostgreSQL `42703 column does not exist`，确认 v321 后的静默 400 根因。
- 2026-06-27: 只读检查 `care_records` 发现同一发质表、同一护理产品存在重复明细，已在 v328 合并保存路径。
- 2026-06-27: `node scripts/audit-meiguanjia-sync.js` 只读审计完成；本次出库修复未改动预约、客户档案和套餐同步。
- 2026-06-27: v328 版本、冒烟、护理差额出库、Agent 同步、HTML 脚本语法和 `git diff --check` 均通过；队列模拟载荷确认只发送 5g 差额且不含 `barber`。
- 2026-06-27: 已从 GitHub 拉取并快进到 v326；确认 GitHub 比 Gitee 多 13 个提交，禁止从旧的 Gitee v317 基线直接发布。
- 2026-06-27: v326 同步前检查发现页面为 326、`version.txt/version.json` 为 322；已在 v327 修复。
- 2026-06-27: Supabase 只读检查确认当前有 10 条 `hair_records.status=deleted`，包含截图里的 `cesi` 与多条“小爱/未填写”；v327 正常页面查询均不会返回这些记录。
- 2026-06-27: v327 `check-version-sync`、`smoke-test-app`、`check-agent-sync-status`、HTML 脚本语法和 `git diff --check` 均通过。
- 2026-06-26: `node scripts/check-version-sync.js` passed at v319.
- 2026-06-26: `node scripts/smoke-test-app.js` passed at v319.
- 2026-06-26: `node scripts/check-agent-sync-status.js` passed at v317.
- 2026-06-26: `admin.html` script syntax check passed.
- 2026-06-26: `node scripts/check-version-sync.js` passed at v316.
- 2026-06-26: `node scripts/smoke-test-app.js` passed.
- 2026-06-26: `node scripts/check-agent-sync-status.js` passed.
- 2026-06-26: `node scripts/audit-meiguanjia-sync.js` completed read-only.
- Latest audit sample still shows Meiguanjia data gaps: 838 profile rows have visit/consumption counters but no `service_history`, 820 have consumption but no `service_history`, and only 55 sampled profiles have any `card_packages`.

## Open Work For Next Agent

- 美感训练 V1 的正式知识是只读版本文件，训练进度和后台候选只保存在当前设备；跨设备同步必须先接入可由 RLS 识别的服务端认证、角色、私有图片存储和数据库审计，禁止直接给公开 Supabase key 增加写权限。
- GitHub CLI 当前未登录，无法从本机替用户开启分支保护；仓库已提供 CI，但仓库设置仍需把 `Validate shared app` 设为 `main` 必需检查，才能彻底阻止绕过检查的直接推送。
- `staff.password_hash` 仍能被公开 Supabase key 查询。前端已缩短会话并限制管理员角色，但真正安全需要 Supabase Edge Function/Auth + RLS，不能仅靠静态 HTML 完成。
- 客户消费/套餐接口和写入逻辑已恢复，断点回填仍在补齐历史缺失；2026-06-29 仍有 2,265 个有到店次数的客户缺少 `service_history`，完成前不得宣称全量数据已经补齐。
- `care_outbound_queue` 仍没有新增数据库字段；v344 暂以确定性负数主键实现数据库幂等，并把门店、发质表、发型师和批次元数据保存在 `hair_records.record_data`。后续如有受控数据库迁移窗口，可再增加专用列和唯一约束。
- 自由手艺人真实1克出库已经验证；发布后仍需由员工在App完成一张带护理用量的发质表，做一次完整“App入队→后台任务→美管加审核→App状态”验收。
- 下一步由用户新建一张少量护理测试单，确认美管加单据同时显示正确发型师员工、克数和已审核状态。
- 向里造型美管加当前只有一个汇总“歌薇酸性护理”库存商品，欧拉裴/上色水及色号没有独立映射；用户已决定本阶段不接入向里自动出库。
- For Meiguanjia sync, use the logged-in Meiguanjia page with DevTools Network in read-only mode before changing endpoint mappings.
- Verify real endpoints/fields for appointments, customer packages/cards, remaining package items, and consumption history.
- Ensure sync writers never overwrite existing package/history arrays with empty arrays when an external request partially fails.
- Improve customer archive display only after confirming the source data mapping.
- Keep hair-analysis task status rules from `HERMES_HANDOFF.md`; do not reintroduce `已回传` as a stylist final state.
- Use backend admin deletion for confirmed erroneous `hair_records`; do not delete production records from scripts unless the row id, phone, name, and current status have been verified.

## Required Checks Before Editing

```sh
git fetch github main
git status --short --branch
node scripts/check-version-sync.js
node scripts/smoke-test-app.js
node scripts/test-care-outbound.js
node scripts/check-agent-sync-status.js
```

For Meiguanjia/customer data work also run:

```sh
node scripts/audit-meiguanjia-sync.js
```

## Required Checks Before Publishing

```sh
node scripts/check-version-sync.js
node scripts/smoke-test-app.js
node scripts/check-agent-sync-status.js
git push github main
```

## Handoff Rule

Before any agent says the work is done, update this file with:

- the app version after the work
- what changed
- what remains open
- any data examples that were inspected
- any checks that passed or could not be run

Do not hand work to another agent through chat memory only. The repository must contain the current handoff.
