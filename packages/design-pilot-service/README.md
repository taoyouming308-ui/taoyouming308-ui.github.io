# 本地合成设计服务

这是显式启动、仅监听 `127.0.0.1` 的后台测试路径，用于验证 HTTP 接口、v2 事件契约、完整五步 UI 草稿和本机耐久记录。完整 UI 通过专用 connected 页面复用原交互，并使用独立的 UI projection 契约持久化；原离线页仍保持离线。没有模型调用、生产数据库、真实顾客、照片上传或真实鉴权。**不能用于门店生产、真实资料或密钥。**

## 明确的安全边界

- 只有两个固定合成身份：`demo-stylist-a` 对应 `demo-customer-a / demo-visit-a`；`demo-stylist-b` 对应 `demo-customer-b / demo-visit-b`。
- 上述两个身份用于原 event API。完整 UI 使用单独固定 `demo-ui-owner`，对应三个明确的合成预约/散客 scope；切顾客不切员工身份。`GET /api/ui-catalog` 按当前 actor 和关系撤销状态筛选候选；原 B 身份没有 owner 的 UI 读写权限。此白名单只用于合成场景，不是生产授权。
- 请求头 `X-Design-Pilot-Actor` 是人工选择的模拟身份，不是密码、登录、可信员工身份或生产授权。任何能访问本机端口的人都可以选择这两个公开身份。本测试只验证服务端范围检查逻辑，不能据此声称已完成生产身份认证。
- 服务忽略客户端“owner/权限”之类声明，并通过严格字段校验拒绝额外字段。每次读写、幂等重放、进入事务及最终原子提交前，重新核对固定服务关系。测试钩子只能撤销已有关系，不能扩大白名单。
- 仅 JSON、固定路由、结构深度与文本限制。旧 event 请求仍为 128 KiB；专用 UI 请求最多 768 KiB，内部 draft 最多 512 KiB。没有 multipart、文件下载路径、任意静态目录或代理接口。禁止图片描述、模型来源、data/blob URL、长编码载荷和明显密钥格式。完整 UI 非空文本必须来自固定、按字段划分的合成 catalog，不提供自由填写或上传真实照片的存储入口。
- 原话只接受 `text / speech_transcript`、`customer / employee`，且文本必须以 `【合成测试】` 开头。这是防误用提示与格式约束，**不是自动匿名化或真实资料检测证明**。转写字段只是文本，不接收录音。
- 绑定地址不可改成公网或局域网接口；Host、Origin、fetch-site 检查拒绝跨站与意外主机。没有 CORS 通配。Authorization/Cookie 请求被拒绝。`NODE_ENV=production` 拒绝启动。
- 服务没有外呼网络代码，不读取 API 密钥，不创建定时任务，不自动运行。仅启动进程在运行时监听临时本机端口。

## 显式启动

在仓库根目录运行，数据目录应为独立的合成测试目录，放在仓库之外：

```sh
node packages/design-pilot-service/cli.mjs \
  --enable-synthetic-pilot \
  --data-dir /tmp/design-pilot-synthetic-demo \
  --port 0 \
  --ui-root /absolute/path/to/this/repository
```

`--port 0` 分配随机本机端口，也可明确指定端口。CLI 打印本机地址。省略 `--enable-synthetic-pilot` 不会启动。`Ctrl-C` / `SIGTERM` 正常关闭 HTTP 服务并释放本目录锁。

可选的同源页面白名单仅为：

- `/` 或 `/ai-design-pilot-service-test.html`
- `/ai-design-pilot-service-test.js`
- `/ai-design-pilot-service-test.css`
- `/ai-design-pilot-connected.html`
- `/ai-design-pilot-connected.js`
- `/ai-design-pilot.js`
- `/ai-design-pilot.css`

不提供整个仓库或 packages 目录的静态服务器。所有页面只允许同源脚本与 API。简化 service-test 页的 img-src 仍为 none；只有 connected 页允许 `img-src data:` 展示客户端生成的固定合成人头，外部图片、媒体和 frame 均禁止。catalog 通过 JSON API 获取，无需开放模块目录。没有 `uiRoot` 时仅提供 API。`/` 仍打开简化接口测试页；完整 UI 请打开 `/ai-design-pilot-connected.html`。原 `ai-design-pilot.html` 不在本机服务白名单，原页的离线 CSP 保持不变。

编程启动：

```js
import { startSyntheticDesignService, SYNTHETIC_OPT_IN } from './server.mjs';
const server = await startSyntheticDesignService({
  optIn: SYNTHETIC_OPT_IN,
  dataDir: '/absolute/dedicated-fixture-directory',
  port: 0,
  uiRoot: '/absolute/repository'
});
// server.url, server.actors
await server.close();
```

`relationshipAllowed(actor, scope)` 和 `fault(stage)` 是模块级合成测试钩子；不通过 HTTP 或 CLI 暴露。前者只能撤销已在固定白名单里的关系，后者仅用于模拟提交前中断 / 提交后丢失响应。

## HTTP 接口

所有 API 需要 `X-Design-Pilot-Actor: demo-stylist-a` 或 `demo-stylist-b`。POST 使用 `Content-Type: application/json`。`scope` 始终为精确的 `{customerId, visitId, sessionId}`；sessionId 和 requestId 为 1–80 位字母、数字、下划线或连字符，保留对象属性名被拒绝。

| 方法与路径 | 请求 / 结果 |
| --- | --- |
| GET `/api/demo` | `{ok, mode, warning, actors:[{id,customerId,visitId}]}` |
| POST `/api/sessions` | `{requestId,customerId,visitId,sessionId}` |
| GET `/api/sessions/:sessionId` | 返回 `{ok,mode,session,view}` |
| POST `/api/sessions/:sessionId/events` | 契约原样 `{requestId,expectedRevision,scope,event}` |
| POST `/api/sessions/:sessionId/archive` | `{requestId,expectedRevision,scope}`，session 必须已到 archive 阶段 |
| GET `/api/sessions/:sessionId/archives` | 返回 `{ok,mode,archives}`，按 `archive.revision` 数字升序 |
| POST `/api/sessions/:sessionId/revisions` | `{requestId,expectedRevision,scope,resumePhase,reasonSource}` |

写操作统一返回 `{ok:true,mode:'synthetic-only',replayed,appliedRevision,session,view}`，归档相关操作另带 `archive`。归档记录为 `{archiveId,actor,sessionId,archive,sha256}`；其中 `archive` 是 analysis-engine 的精确冻结快照契约。错误返回 `{ok:false,error:{code,message}}`，冲突通常为 409，关系越界为 403，格式错误为 400，体积限制为 413。未知本机文件错误不回显路径或原始异常细节。

`events` 只接受 source_recorded、entry_recorded、entry_confirmed、phase_advanced。**直接 revision_opened / schema_migrated 被拒绝**，防止绕过持久化父档检查。

归档后修订保持同一个 session/scope，`resumePhase` 为 proposal / execution / completed_review。`reasonSource` 是全新的 employee text/speech_transcript，含合成前缀。服务先找到 `expectedRevision` 对应的已持久化档案，再调用 `createDesignRevision` 校验精确父检查点。新修改必须遵守契约的新 entry ID、replacesEntryId 与重新确认规则。服务不重置历史或覆盖旧档。当前本地 API 不开放 v1 迁移；迁移能力留在纯契约，另需明确适配路径。

v2 技术字段的 groupId/service/side 原样保留；同区多组杠具和配方不会被压平。具体字段、阶段和引用约束见 `../analysis-engine/README.md`。

## 完整 UI 草稿接口与 projection 边界

`packages/analysis-engine/design-pilot-ui-draft.mjs` 是独立纯契约。它保留原 UI 的整个设计草稿结构，**不把页面字段假装成模型提取的 source_recorded / entry_recorded 事件**。`origin=demo_extract/demo_suggest` 仍只表示固定虚构示例；confirmed 是合成 UI 的人工核对标记，不是可信员工签名或真实服务完成证明。

UI 请求固定使用 `X-Design-Pilot-Actor: demo-ui-owner`，scope 必须完整来自 catalog：

| 方法与路径 | 请求 / 结果 |
| --- | --- |
| GET `/api/ui-catalog` | 返回 schemaVersion、fixtureText、fixtureTexts、按字段划分的 fieldOptions、emptyDraft 和当前 actor 可访问的 customers（每项含 id/title/kind/scope） |
| POST `/api/ui-drafts` | `{requestId,scope}`，建立空白草稿 |
| GET `/api/ui-drafts/:sessionId` | 读取当前草稿、服务端版本和该 scope 的追加归档摘要 |
| POST `/api/ui-drafts/:sessionId/save` | `{requestId,expectedRevision,scope,draft}` |
| POST `/api/ui-drafts/:sessionId/archive` | `{requestId,expectedRevision,scope}`，只归档服务端当前已保存 draft，不接收客户端快照 |
| POST `/api/ui-drafts/:sessionId/reopen` | `{requestId,expectedRevision,scope,reason}`；reason 必须为 catalog 的固定 revisionReason，关联同 scope 的精确持久化父档 |

统一响应含 `{ok,mode,projection:'ui-draft-not-event-contract',replayed,appliedRevision,uiDraft,revision,status,draft,archives}`。`uiDraft` 为 `{schemaVersion:'design-pilot-ui-state-v1',scope,revision,status,draft,history}`，status 是 draft/archived。顶层 revision/status/draft 是同一状态的便利投影。`archives` 为按 revision 升序的摘要 `{number,createdAt,revision,archiveId,sha256,previousArchiveRevision,draft}`；其中 draft 是旧档的精确内容，不重复发送所有旧 history。服务端仍保存完整 archive envelope、完整历史及摘要。

客户端先显式保存成功，再追加归档。archive 是单独 CAS 操作，会增加服务端 revision。归档后 save 被拒绝，必须先通过 reopen 关联原档，再修改保存并追加新档；旧档的值、来源、确认、计划/实做和照片元数据不变。归档不会把 planned 改成 actual，不自动确认字段，也不声称模型分析或服务已完成。同 requestId 和载荷重试不重复保存/归档；变更载荷、目标或操作冲突。旧请求重放返回原 appliedRevision 和当前同 scope 状态。

### 草稿精确结构

draft 必须是 `schemaVersion:'design-pilot-ui-draft-v1'`、`synthetic:true`，且仅包含：

- step、selectedZone、text、transcript；basic、proposal、care；zones、zoneProcesses、services、perm、dye、review；photos、side；materialRevision、designRevision、analysis、comparison、demoLoaded。
- 每个 record 保留 `{value,original,origin,confirmed,phase,edited,tracks:{planned,actual}}`，缓存 track 为同样六项但不再嵌套 tracks。人物字段固定 context；care/review 固定 actual 观察且不能夹带隐藏 planned；其余字段独立保存 planned/actual 值、来源和确认。不会用计划补实际。原始来源仅接受该字段的固定选项、固定示例引文及方向标签。
- 六区为 bangs/top/ear_front/ear_back/middle/bottom。每区 perm/dye 分别最多 8 组；每组的字段和数组位置原样保存，placement 记录左右，烫/染不混合、不压成一项。这里的数组位置与 placement 不是 event v2 的 groupId/service/side；未来真正模型接入仍需显式逐组适配、证据映射和审核，当前没有自动转换。
- photos 只接受 before/after 的 `{id:正整数,kind:'demo',angle:'front'|'back'|'left'|'right'}`。它们仅是内置合成示意图标记，绝不包含 URL、data/blob、文件名、图片字节、录音或真实照片。每位置最多 4 张，左右侧合计也是 4 张；每阶段最多 12 条。图片仅由 UI 根据 marker 本地重建。
- 文本不能自由扩充 catalog；字段选项由 `getUIFieldOptions(path)` 与服务端校验共享。身份、权限、history、revisions、server revision、任意新字段和自称 owner 均不能放入 draft。客户端只提出 expectedRevision，真正服务端 revision/history 由操作追加产生。
- material/design counter 是 UI 的素材变化标记，不是服务器 CAS 版本。值不准倒退；原话/照片发生变化必须前进 material counter，设计/来源/确认发生变化必须前进 design counter。analysis/comparison 不能指向未来版本或声称缺失角度/不一致侧别已经匹配。当前固定示例分析只允许固定原话配空转写或精确的 catalog 固定口述文本，其他转写不能冒充此示例。这些仍只是模拟状态，不是效果验证。

纯接口包括 createUIDraftPayload、createUIProcessGroup、getUIDraftCatalogue、validateUIDraftPayload、createUIDraftState、validateUIDraftState、saveUIDraft、archiveUIDraft、createUIDraftArchive、validateUIDraftArchive 和 reopenUIDraft。每次保存是完整 projection 的追加历史，不是逐条模型证据的提取。客户端不能上传历史，所有状态重建与归档前缀校验在服务端完成。达到 100 个 UI 历史操作或文件/归档容量上限会明确拒绝，不删除旧版本腾位置。

已验证全 96 组、各字段计划/实做独立快照与 24 个合成照片 marker 的最大填充 fixture：纯契约约 391845 字节，HTTP round-trip 约 391684 字节，均小于 512 KiB。原 event API 的 128 KiB 上传限制没有放宽。

## 本机持久化与故障语义

- 一个专用目录内有固定 `store.json`、持久初始化标记 `.initialized` 和运行锁 `.service.lock`；临时提交文件为随机 `.store-*.tmp`。用户输入的 ID 不作为文件路径。首次启动先原子创建空合成存储，再 fsync 初始化标记。
- 进程取得独占锁，第二个进程不能成为并发写入者。进程内所有读取与写入经过串行队列。每次操作重新读取并校验整个存储，而不是相信客户端快照。
- 每个写请求通过 revision CAS、精确幂等载荷 SHA-256、契约 journal 重建、原档摘要和前缀校验。加载时也核对 receipt 的 actor/session/操作/appliedRevision/父档绑定及载荷摘要，拒绝损坏收据跨模拟顾客回放。每条 revision_opened 必须仍有同范围持久化父档。相同 actor/requestId 的完全相同重试不重复追加；改变路径、内容或 scope 的重试冲突。相同归档检查点不重复制造新档。
- UI 使用独立 uiDrafts/uiArchives/uiReceipts maps，并复用同一独占锁、串行队列、关系重查、原子文件提交。每条 UI archive/reopen 历史必须有精确的同 scope 持久化档；UI 收据也与操作/历史载荷/父档重算绑定。对阶段 2 的旧 store，只在内存添加空 UI maps；读取不重写文件，下一次授权写入才保存扩展结构。原 sessions/archives/receipts 与档案摘要完整保留，部分缺失或未知格式仍失败关闭。
- 写入全量候选到新临时文件，fsync 后再次核对服务关系，再原子 rename 固定文件并 fsync 目录。提交前中断不改变旧文件；提交后响应丢失属于结果不确定，客户端应使用相同 requestId 重试或读回，不能换 ID 盲目重复。
- 正常关闭后再启动会恢复 session、所有 archive 和幂等 receipt。未提交的残留 tmp 文件不被当成数据加载。损坏主文件或不匹配摘要会失败关闭，不重置为空库。只要初始化标记仍在，主文件缺失在运行中和重启后都会拒绝；人为同时删除主文件与标记不在防篡改保证范围内。
- **进程崩溃 / 强制终止会保留锁，下一次启动默认阻止。这里没有自动崩溃锁回收。** 应由操作者先确认原进程已结束、保存目录备份并检查原文件，再处理这一个合成测试目录的过期锁；不要通过改路径或删锁绕过仍运行的进程。
- 上限：20 个会话、200 个归档、2400 个幂等 receipt、32 MiB 存储文件；单会话事件上限另外遵循契约。达到限制即停止，不自动删旧档。
- 摘要用于一致性与回归核验，不是签名、加密或防本机所有者篡改的安全凭证。本文的“耐久”是本机文件和正常重启语义，不代表云备份、高可用、正式数据库事务或多实例生产能力。

## 隔离存储适配准备

文件存储边界是 `load / persist(candidate, authorizeImmediatelyBeforeCommit) / close`。默认仍为上述本机文件实现。`createSyntheticMemoryStorageAdapter()` 提供唯一允许通过 `storageAdapter` 注入的隔离内存 fixture，可用于不触碰磁盘的测试；每次 open 有独占 writer lease，旧 handle 不能读取、写入或关闭后来的 lease，但不宣称跨进程或重启耐久。未知 adapter 对象默认拒绝，不启用外部数据库、URL、凭据或自定义生产身份。真实存储和员工身份接线刻意未配置；另行准备的 access gate 也没有自动赋予本服务生产权限。

## 验证

```sh
node scripts/test-design-pilot-service.mjs
node scripts/test-design-pilot-ui-draft.mjs
```

测试只创建并清理自己的系统临时目录，用内置 Node HTTP 访问本机，保留原 26 项 event 回归并扩展至 37 项服务检查。新增完整 UI schema/版本与历史注入拒绝、照片 URL/文件名/bytes 拒绝、单 owner 多顾客隔离、撤权、CAS 并发、完整 96 组 round-trip、旧档/父档完整性、正常重启、旧 store 增量升级、默认拒绝外部 adapter 及旧 memory handle 隔离。纯 UI 契约另有 14 项检查，包含固定口述→演示整理→保存→重读顺序。不调用模型、真实鉴权或任何业务数据库。
