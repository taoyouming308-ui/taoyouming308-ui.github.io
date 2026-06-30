# Agent Sync Status

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

- App version: v339
- Last synchronized base checked: GitHub `f59f4b0`, Gitee `f59f4b0`
- GitHub live branch: `github/main`
- Gitee Hermes branch: `origin/master`
- Required state before editing: local `HEAD` includes both `github/main` and `origin/master`
- Current owner: handoff ready for either Codex or Hermes

## Last Completed Work

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

- GitHub CLI 当前未登录，无法从本机替用户开启分支保护；仓库已提供 CI，但仓库设置仍需把 `Validate shared app` 设为 `main` 必需检查，才能彻底阻止绕过检查的直接推送。
- `staff.password_hash` 仍能被公开 Supabase key 查询。前端已缩短会话并限制管理员角色，但真正安全需要 Supabase Edge Function/Auth + RLS，不能仅靠静态 HTML 完成。
- 客户消费/套餐接口和写入逻辑已恢复，断点回填仍在补齐历史缺失；2026-06-29 仍有 2,265 个有到店次数的客户缺少 `service_history`，完成前不得宣称全量数据已经补齐。
- `care_outbound_queue` 仍没有 `hair_record_id/shop_name/idempotency_key` 数据库字段；v330 用两阶段批次恢复降低重复出库风险，后续仍应扩展表结构和 worker 的数据库级幂等。
- 护理出库仍需用户确认后做一笔真实 1g 测试，并在美管加库存流水核对实际扣减；禁止把队列 `completed` 单独当成库存已核实。
- 当前 `care_outbound_queue` 没有 `shop_name/barber`，现有执行器无法从队列区分两家门店；如两店维护独立库存，需先扩展表结构和执行器映射，再开启跨店出库。
- For Meiguanjia sync, use the logged-in Meiguanjia page with DevTools Network in read-only mode before changing endpoint mappings.
- Verify real endpoints/fields for appointments, customer packages/cards, remaining package items, and consumption history.
- Ensure sync writers never overwrite existing package/history arrays with empty arrays when an external request partially fails.
- Improve customer archive display only after confirming the source data mapping.
- Keep hair-analysis task status rules from `HERMES_HANDOFF.md`; do not reintroduce `已回传` as a stylist final state.
- Use backend admin deletion for confirmed erroneous `hair_records`; do not delete production records from scripts unless the row id, phone, name, and current status have been verified.

## Required Checks Before Editing

```sh
git fetch github main
git fetch origin master
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
git push origin main:master
```

## Handoff Rule

Before any agent says the work is done, update this file with:

- the app version after the work
- what changed
- what remains open
- any data examples that were inspected
- any checks that passed or could not be run

Do not hand work to another agent through chat memory only. The repository must contain the current handoff.
