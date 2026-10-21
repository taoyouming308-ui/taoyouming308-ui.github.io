# 三入口启动最小补丁（本地候选 v636，未上线）

基线：GitHub main `b713720a0970cf66c4d55de4f83ea63fd5e57a99` / v635。独立克隆及分支 `fix/startup-isolation-20261021`，未修改旧工作区。修改前完成版本/完整性/交接检查、启用原钩子、运行每日完整源码备份。未提交业务数据、真实凭据或依赖缓存；没有推送、合并、部署或生产业务测试。

## 具体变化

- 经营页：身份和角色/门店校验仍先完成，随后启动月报读取但不再以月报完成作为全页启动结束条件。月报区域显示加载状态，失败保留原有明确错误/刷新重试，编辑按钮仍须读取成功后才启用。保留原有未保存金额/名称及店月响应隔离。其他栏目的既有独立加载与权限逻辑不变。
- 经营页权限桥：只读 `operations-auth` 范围校验 15 秒超时，失败保留凭据；原只读业务请求仍为 45 秒。刷新令牌轮换、登录、写入均未增加中止或重放。
- 前台：会话恢复和首屏 dashboard 读取上限 15 秒；网络故障和普通权限拒绝不会清除登录凭据。只有明确失效代码/既有后端失效信息才注销。未验证身份不进入业务 scope；恢复请求去重，迟到响应须匹配当前存储凭据。提供原地重试与 online 恢复。导入批次推迟到进入导入页，首屏不再额外读取。既有 dashboard 数据失败提示保留，加载提示明确。
- 主 App：缓存身份须经服务器确认再应用到当前员工身份和预约缓存展示；会话读取 15 秒超时，显示原地重试，联网后恢复，保留凭据；取消所有 403 都视为失效的处理。报表入口使用已验证的身份提供器，避免提前/重复权限读取。已有非首屏按需加载、本地静态方案缓存及注销旧 SW 逻辑保留。
- 三入口及版本文件同步为本地候选 v636；上线前必须重新检查最新 main 和版本号，不能把候选号视为预留。

未改变账目、业务保存/入账顺序、防重、后端权限、认证配置、数据库、密钥、持久访问权限。没有新增敏感客户/财务数据持久缓存；没有重启旧 SW。

## 自动化验证

全部浏览器场景使用合成账号/数据，拦截外部请求；桌面浏览器临时配置与用户日常浏览器分离。WebKit 26.5 是固定 Playwright 1.62.1 官方测试引擎（临时路径），390×844 视口模拟，不是 iPhone 真机。

- 新增 `test-startup-recovery-browser.js`：Chromium 与 WebKit 各 14 场景通过。前台/主 App 各覆盖断网后 online 恢复、真实会话过期、普通 403 权限拒绝、15 秒超时、删除凭据后的迟到响应、启动完成后重试不清除现有输入；经营页覆盖月报仍待返回时框架可用、月报失败/刷新、范围校验超时不显示敏感内容。
- 旧资源覆盖边界：新场景带 `?v=1` 验证不自动重载；`test-version-update-flow.js` 验证先校验后标记安装、规范 URL 缓存更新。既有资源 404/延迟/离线场景通过。未宣称测试完整新旧 SW 原子切换，本轮未实现该机制。
- 既有 Chromium 冷启动 6 场景、两个入口启动 7 场景、主 App 样式启动 5 场景通过。
- `test-monthly-load-browser-v499.js`：合成月报编辑/保存读回、空白边框、失败恢复和迟到响应隔离通过（保存仅测试替身，不写生产）。
- `test-zysyr-period-response-isolation.js`：财务工作台、备用金、薪资、工资表、库存的店/月迟到成功和错误隔离通过。
- 版本同步、release integrity、smoke、前台、预约 UI、账号 Auth scope/migration/bridge、版本更新、护理出库关闭保护、31 项发质任务状态、2205 行客户档案分页、后台工作流、统一测试清单集成检查通过。新增回归已加入共享 finance manifest，未删除或放宽原检查。
- `test-staff-report-browser-v514.js`：主 App 报表 iframe、月/日报可见性、无登录闪现、重试、管理员授权、财务隔离、撤销与横屏通过。
- Python 同步隔离测试用本机已有 `/opt/homebrew/bin/python3.11` 运行，42 项通过；默认 Python 3.14 最初缺少 cryptography，未为此修改系统依赖。
- 未跑完整 finance/SQL/全部 pre-push；本轮不发布。这些以及精确提交的受保护 CI 仍为未来上线门槛。

## 可复现命令

在仓库根目录使用锁定 Node 22.22.1 和 `npm ci` 安装的 Playwright 1.62.1。当前 Mac 复用了已有同版本依赖，只用本地排除的 symlink，未提交依赖。

```sh
node scripts/check-version-sync.js
node scripts/check-release-integrity.js
node scripts/smoke-test-app.js
node scripts/test-cold-start-browser.js
node scripts/test-entry-startup-browser.js
node scripts/test-startup-style-browser.js
node scripts/test-startup-recovery-browser.js
node scripts/test-monthly-load-browser-v499.js
node scripts/test-zysyr-period-response-isolation.js
node scripts/test-version-update-flow.js
node scripts/test-operations-auth-bridge.js
node scripts/test-frontdesk.js
node scripts/check-agent-sync-status.js
PLAYWRIGHT_BROWSERS_PATH=/tmp/zysyr-startup-browsers STARTUP_BROWSER=webkit node scripts/test-startup-recovery-browser.js
```

本机 AGENTS 要求 shell 启动浏览器走正式 `require_escalated` 审批，不在受限 shell 绕过；测试始终使用独立临时配置。WebKit 如需重新准备，使用仓库固定 Playwright 官方下载器；不是安装来源不明浏览器。

## iPhone 手动验收（未执行）

在经过批准的隔离测试站和合成账号上，分别用 Safari 与添加到主屏幕模式验证：

1. 三入口首次打开：页面立即有启动提示；慢资源超过 8 秒出现恢复说明，无自动反复刷新。
2. 经营页验证身份后，延迟/失败月报时已授权导航可用；月报仍加载/明确失败，编辑不可用；恢复读取后正常展示。
3. 主 App 与前台断网启动：不显示未验证客户/财务资料，不丢登录凭据；网络恢复或点重试后正确回到所属门店。不能把离线缓存当新的服务端认证。
4. 服务端明确使测试会话过期/撤销：进入登录或受限页面；一般接口 403 与网络 503 不误报注销。测试身份切换期间旧请求返回不能覆盖新身份。
5. 用合成月报金额/名称、主 App 发质表和前台表单输入未提交内容，触发晚到资源错误、重试提示、切换后台再恢复；内容不得丢失、不得自动刷新、不得假报保存成功。不要真实预约/入账。
6. 老页面版本、资源缺失、新版本提示：用户编辑时不能强制刷新；主动更新后资源完整一致；确认 iOS 内存回收、低电量和锁屏恢复行为。

## 下一阶段：只缓存静态应用壳（本轮未完成）

方向是让手机保存 HTML/CSS/JS/字体/公开静态图等界面资源，日常主要向网络读取授权数据。但首次安装、新版本更新或 iOS 清理站点缓存后仍需要联网；离线壳不能承诺敏感业务离线可用，也不能替代身份验证。

建议独立设计版本 manifest 与内容哈希，将一整套资源预取到新缓存，全部验证成功后才标为可用版本。旧页面继续使用旧整套资源；新版本在用户没有未保存输入且主动确认后启用。下载失败保留旧完整缓存，避免新 HTML 配旧 JS；仅清理无活动客户端使用的历史缓存。回退用新的发布版本封装已验证旧实现，遵循现有向前回滚和防降级规则。

SW 使用明确资源白名单，禁止缓存 Auth、客户、财务、会话、带令牌 URL 或任何写接口；不得离线排队预约/入账/保存或展示假成功。重启 SW 前单独评估当前主动注销机制、iOS 主屏幕升级生命周期、跨标签页切换、缓存配额/清理、公开资源隐私、旧入口兼容及整套资源回退演练。本补丁没有实施持久应用壳缓存或原子切换。

## 剩余限制

- 网络恢复依赖浏览器 online 事件或手动重试；网络已显示 online 但服务端仍不可用时需手动重试。
- Supabase 刷新令牌轮换仍沿用原流程，不因 15 秒 UI 预算中止或自动重放；极慢刷新仍可能长于只读校验预算，后续应独立设计单请求结果协调，不能靠超时并发重刷。
- 已有学习 bootstrap 等自身鉴权的读取路径未做全 App 网络重构；本次没有承诺消除所有后台请求。
- 失效消息匹配沿用当前后端约定，未来后端改文案须增加稳定错误码并同步回归。
- 本轮无真实 iPhone、无生产端到端验证、无性能百分比承诺，未把旧白屏根因视为已证实。
