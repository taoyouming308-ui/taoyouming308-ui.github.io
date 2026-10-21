# 启动补丁独立复核与本地发布门禁

审查对象：本地 `78e84bb`（v636 候选），基线 `b713720`。用户仅授权离线/合成复核和范围内修复，未授权推送、合并或部署。本次使用一个独立只读 reviewer，实际阅读源代码并执行了恢复发质页的合成复现；其余全量测试由实施代理执行。

## 独立发现与修复

1. **未验证时恢复私有发质页**：原 saved-page 恢复先于身份校验，发质页层级高于身份门层。reviewer 实证会话悬挂时已显示发质字段并发出私有读取（测试全部拦截）。现只在服务器验证身份后恢复保存的页面，发质页入口本身也检查已验证身份。
2. **预约迟到响应覆盖与误注销**：主 App 预约页和发质预约选择器增加身份 token、当前存储 token、门店/日期和请求代次检查。过时成功不得绘制或写缓存，旧身份的失败不得清新身份。
3. **跨标签页退出/换账号**：报表身份提供器校验当前存储 token；变化时清除本页内存身份、阻止新私有读取、遮盖现有表单，但不删除另一标签页的新凭据。需用户明确确认放弃未保存输入才重新载入。同一账号正常过期后重新登录不重建原表单。
4. **真实未保存表单、键盘及隐私门层**：不只测试计算器；增加实际发质表姓名、电话字段与 DOM 身份检查。门层将既有私有根节点设为 inert 并隐藏，防止 Tab/键盘进入背景保存控件；确认同账号后还原原 DOM。原 CSS 的 `!important` 半透明背景被明确覆盖为不透明，测试检查 computed style。
5. **不同账号不能接管旧发质草稿**：记录当前发质页所属员工/店。新身份不同则保留并锁定旧输入，要求用户决定是否放弃并重载；不把旧草稿显示给新身份。

独立 reviewer 未发现本次补丁修改账目/预约写入 payload、提交顺序、防重或后端权限。超时只针对读取；保存和令牌轮换没有增加中止/重放。经营页原 dirty 保留与店/月隔离保留。没有新增敏感持久缓存、后台权限变更、真实预约或真实入账。

## 新增合成验证

- `node scripts/test-startup-request-scope.js`：直接执行实际读取函数，延迟响应验证日期竞态、旧失效/新身份、跨标签页 token 删除、发质选择器日期/身份竞态；通过。
- `node scripts/test-startup-private-view-browser.js`：保存的 hair 页身份待验时无私有页/私有读取；验证后恢复；实际姓名/电话不因晚到启动错误而清空；会话过期时表单 inert、Tab 无法进入；同账号重新登录保留同一 DOM；跨标签页退出遮盖表单，取消重载保留输入；计算样式背景不透明。Chromium 与 WebKit 均通过。
- `scripts/test-startup-recovery-browser.js` 原 14 场景已保留；最终 WebKit 复跑通过，Chromium 纳入完整原门禁。
- 两个新增脚本均加入原统一 finance manifest，不绕过或删除旧测试。

## 环境与命令记录

Node `22.22.1`，Python `/opt/homebrew/bin/python3.11` (`3.11.15`)，Playwright `1.62.1`。WebKit `26.5 / v2336` 来自该固定 Playwright 官方下载器，仅存 `/tmp/zysyr-startup-browsers`。浏览器临时独立配置；全部业务请求合成/拦截。数据库测试使用 `postgres:17` 无网络隔离测试容器，不连接 Supabase 生产。

初次调用原 `.githooks/pre-push` 在 finance 111/115 的合成测试停止，原因是复用依赖缺 `exceljs`，不是业务断言失败。随后用仓库 package-lock 在独立 `../validation-deps` 执行 `npm ci --ignore-scripts`，不修改系统或共享依赖。保留初次失败日志，不把失败抹掉。第二轮 finance 117/117 全通过，之后旧 UI 检查硬编码原始定时器文本而停止；现改为执行实际恢复函数验证未认证不调度、认证后延后恢复和只恢复一次，保留并加强原意，未删除检查。最终冻结提交再运行原完整门禁，结果单独记录在 `validation-review/results.md`。

最终完整门禁命令（不会执行 git push）：

```sh
NODE_PATH=/Users/a1/Documents/Codex/2026-10-21/task/validation-deps/node_modules \
ZYSYR_HOOK_PYTHON=/opt/homebrew/bin/python3.11 \
sh .githooks/pre-push
```

补充 WebKit 命令：

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/zysyr-startup-browsers \
STARTUP_BROWSER=webkit node scripts/test-startup-recovery-browser.js
PLAYWRIGHT_BROWSERS_PATH=/tmp/zysyr-startup-browsers \
STARTUP_BROWSER=webkit node scripts/test-startup-private-view-browser.js
```

本机 shell 启动浏览器/访问 Docker 使用正式审批。测试服务器仅本机 loopback，不暴露到局域网或公网。完整命令副本、统一清单及各轮日志保存在任务目录 `validation-review/`；测试生成图片留在隔离工作区，不作为源码提交。

## iPhone 真机如何验收

**本轮没有可用且已确认支持的通路，真机待办。** 手机 Safari 的 localhost 指向手机自身；USB Safari Web Inspector 能检查手机页面，但不会自动把 Mac localhost 映射到手机。不能把桌面 WebKit、390px 视口或模拟器算作真机，也不能通过本机文件直接打开来替代真实 HTTP/鉴权流程验收。

本轮不开放 Mac 监听到 0.0.0.0、不调整防火墙、不启动隧道、不新增凭据、不上传到生产。后续如已存在组织批准的非生产测试站及合成测试账号，可在用户明确授权测试候选发布到该测试站后，使用 iPhone Safari/主屏幕模式执行前一份验收清单；或使用既有受支持的签名测试 App 通路，但本次未发现/未配置任何此类通路。若不存在，先批准并建立隔离测试通路再验收，当前只列待办。

## 上线前仍须完成

- iPhone 真机的 Safari/主屏幕、弱网、系统回收、锁屏恢复和真实触摸交互验收。
- 用户上线决定；重新同步最新 main/版本，候选 v636 不代表版本号已预留。
- 最终精确提交的正常受保护 CI、正常合并与 Pages/线上读回（本轮均未执行）。
- 令牌轮换沿用原流程，极慢刷新仍可能超过只读校验等待上限；不以危险的并发重刷来伪造恢复。

静态应用壳缓存第二阶段未实施。本轮没有引入新的 SW 生命周期或整套版本缓存切换。
