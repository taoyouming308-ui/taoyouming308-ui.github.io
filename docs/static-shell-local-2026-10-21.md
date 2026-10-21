# 三入口静态应用壳：第二阶段本地候选

基于第一阶段草稿 PR #64 的 `2d9cea7`（包含学院 main `251c5b1`），独立工作树/分支 `fix/static-shell-local-20261021`。候选 v637 仅本地，未修改 PR #64、未推送、合并或部署。学院文件保持与基线完全一致。

## 缓存范围与启动

`scripts/app-shell-files.json` 是人工审阅的37项公开文件白名单：三个HTML、直接及已知延迟加载JS/CSS、公开PWA清单和图标。约1.8MB，以实际测试输出为准。没有通配扩展、运行期自动缓存、认证响应、顾客、预约、报表、照片或私有下载；唯一额外缓存键是公开版本完成标记。缓存键不含门店/月份/token等查询参数。

首次仍需联网正常加载页面；load之后注册worker，不claim当前页面、不重载。worker以`credentials:omit`、`no-store`抓取白名单，拒绝重定向、非200、opaque、错误MIME及SHA-256不符。3路并发，每个下载15秒上限；整套完成后写完成标记，才允许安装成功。下载/存储失败不影响在线应用或旧完整壳。

随后重新打开页面，静态壳由本机缓存提供；身份和业务数据继续网络验证，未验证不显示私有页面。离线不能登录放行、不能提交写入，不排队/重放、不伪称保存成功。课程/feed及未列入白名单的内容仍需网络；这不是整站离线功能。

根scope虽覆盖本站，但非导航静态请求会查客户端所属文档。仅三个入口的资源使用固定壳；后台/学院等其他文档的共享脚本原样网络加载，避免它们既有版本参数被错误阻挡。三个入口导航保留原URL参数供业务处理，但只取同一公开HTML缓存键。入口已知资源的不匹配版本或未知query明确拒绝，不从网络混入新版代码。

## 更新、恢复与旧worker

- 生成器把文件hash和worker逻辑一起纳入cache ID。新候选完整下载后等待；没有skipWaiting、clients.claim、controllerchange自动刷新。
- 提示先保存，再关闭**本站全部页面及主屏幕窗口**，然后重新打开。根scope的后台/学院旧窗口也可能延后激活。关闭与自然激活之间存在短暂异步时间，不承诺立即秒切。
- 下载失败保持旧worker；已完成更高版本是版本下限，低版本安装被拒绝。浏览器清空全部站点存储后不能再记住这个下限，此时重新联网安装。
- 缓存缺项仅允许从网络取回同hash字节；不符返回真实503，不混旧/新文件。自然激活后保留当前与上一套完整缓存，清理仅本命名空间的更早/未完成资源。
- 同版本重注册可复用完整缓存；缺项修复失败不删除原完整标记及其他资源。旧页面已存在的广泛unregister逻辑可能注销新注册，无法修改用户已打开的旧代码；不强行接管，新的入口下次可重建。未知旧worker的任意行为不在已验证兼容范围。
- “失败回退”是安装失败继续旧完整壳，不是新版业务运行错误自动降级。运行异常仍遵守更高版本的前向回退流程。
- 新主App移除了两处无差别注销。更新按钮不刷新受控页面，失败可重试；若无控制器且注册不可用，保留原先经用户确认、核验文档后的网络更新流程。

首次尚未受控的网络页面仍受原站点发布一致性约束，本补丁不会使GitHub Pages首次加载天然原子化。只有通过全套校验的缓存可以提供后续整套一致性。设备可能清缓存，缓存成功也不是永久驻留保证。

## 维护和检查

```sh
node scripts/build-app-shell.js
node scripts/build-app-shell.js --check
node scripts/test-app-shell-build.js
node scripts/test-app-shell-browser.js
PLAYWRIGHT_BROWSERS_PATH=/tmp/zysyr-startup-browsers STARTUP_BROWSER=webkit node scripts/test-app-shell-browser.js
node scripts/test-version-update-flow.js
```

每次白名单文件或worker逻辑变更都须重新生成`app-shell-sw.js`。生成器检查三个入口版本、HTML的本地脚本/样式和manifest图标依赖；`check-release-integrity.js`强制`--check`，漏生成会阻止原发布门禁。两个新测试加入统一财务manifest，原检查未删除。

独立reviewer发现并推动修复：防降级、runtime同cache碰撞、同版本重装失败删除完整缓存、后台共享资源误拦截、额外query版本旁路、更新按钮busy/失败fallback及缺失512图标。最终精确提交、完整门禁、浏览器结果与实测数字记录于任务目录`validation-review/static-shell-results.md`。

测试全部使用loopback合成服务器、拦截外部请求和隔离数据库，不操作生产数据。Chromium使用浏览器offline模拟；WebKit原offline模拟导航报内部错误，保留失败日志，另以服务器关闭socket模拟网络不可用；二者不混为相同证据。coldInstallMs包含整套预装，warmNavigationMs是后续导航，不能相除宣称真实手机提速倍数；可验证的是重复导航的静态网络请求数。

## 手机验收缺口与所需批准

本轮没有已确认支持的隔离iPhone测试入口。现有README只有Mac localhost，现有工作流无PR预览部署；USB Web Inspector本身不会映射Mac localhost到手机。没有打开局域网端口、建立隧道、改安全设置、新建凭据或外部部署。

最小后续方案：先由用户指定一个已有、获批准的隔离HTTPS测试站及合成测试账号，并明确批准仅部署该候选到测试站；再用iPhone Safari/主屏幕进行首次联网、重复打开、飞行模式、锁屏/系统回收、跨窗口更新、未保存表单、退出/换账号、断网写入失败验收。如果没有现成站点，需另行批准创建隔离测试环境；本轮没有执行。WebKit不是iPhone真机通过，候选不具备上线授权。

## WebKit follow-up diagnosis

The old test helper passed async predicates to `page.waitForFunction`; the installed Playwright implementation treats the Promise itself as truthy and adopts its first result, rather than polling until true. Logs showed a second update only 5ms after the first update resolved, before installation downloads completed. Explicit awaited polling with the same hard 30-second bound fixes the full WebKit suite without changing the worker. A small client guard additionally prevents update button/online events from queueing updates while installing/waiting; real browser coverage checks duplicate events and unchanged inputs before natural activation and failed runtime-only update. No timeout extension or scenario removal. See task validation logs for exact runs.

Concrete iPhone choices (not executed):
1. Use an existing approved **separate HTTPS origin**: the owner supplies its deployment target and authorizes only this isolated candidate deployment. Test with synthetic fixtures, no production login or production API access.
2. If none exists, approve creation/deployment of a temporary isolated HTTPS test site in an already connected hosting account. Serve only public candidate assets plus synthetic APIs, enforce `connect-src 'self'`, and set an expiry/removal plan. Hosting/public static exposure and the test deployment require explicit approval. Do not use a subpath of the production origin: the existing root worker may affect results.

After one option is approved: open the URL on iPhone Safari and add it to the Home Screen; test first online load, cached reopen, airplane mode auth/write denial, two open windows plus unsaved form during update, close all windows then reopen, failed/missing static resource recovery, sign-out/account switch, and OS cache eviction. Capture device/iOS version and observed results. First install, update and recovery after storage eviction require network. No local port/tunnel, new credential or production change is needed under these options. Neither option is currently approved or provisioned.
