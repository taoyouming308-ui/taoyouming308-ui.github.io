# 独立烫发研习院：审核与受保护 PR 交接

本说明只针对 `academy/` 每日图文课，不恢复旧科研 feed、不修改审美 feed。已有静态课程保持原样。
原计划仍为 UTC 00:15（上海 08:15），并发组与权限不变。工作流只核验和保留候选包；不生成科学正文、不批准、不直接推 main、不自行建 PR。

## 正文与图片

`academy/drafts/YYYY-MM-DD.json` 使用 `schemaVersion:2,date,title,caseType,caseAuthorization,sources,images`，
可选metadata仅含learningMode、freshnessNote、estimatedStudyMinutes、continuityNote，均进入正文摘要。
并保留十项字符串（各至少30字符）：`theory,evidence,case,design,diagrams,winding,communication,exercise,experiment,conclusion`。
它们对应热烫理论、科研证据、案例、人物设计、图示、排杠、沟通、先练后答案、毛束实验和结论。
`caseType` 为 `simulation` 或 `authorized_real`；真实案例须有可公开使用依据 `caseAuthorization`，不附私人授权书/客户资料。

`sources` 至少一条，各含：
`id,title,url,author,publishedAt,evidenceLevel,basis,supports,limits`。
URL须HTTPS；作者未知用null，发表日期未知用null，否则为年份或ISO日期。证据级别为strong/medium/weak或强/中/弱。
核验者须实际查看来源并记录结论的支持范围与限制，不能把结构校验或资料摘要称作新增科学验证。

`images` 至少一条，各含 `id,path,alt,caption,section,rights`。
`section` 省略时为diagrams，也可为任一十章节字段。
路径为ASCII本地 `assets/YYYY-MM-DD/figure.svg`（相对于academy），支持SVG/PNG/JPEG/WebP、单图不超过5MiB。
不允许跨目录、符号链接、活动SVG或外部SVG资源；图示以真实img/figure渲染，正文仍转义。
`rights` 含 `type,credit,basis`：type为original/licensed/public_domain/permission，basis记录实际原创依据、许可证或使用许可。
不虚构论文、真人授权、固定适用的药水/温度参数或改造效果。

## 摘要与实际审核记录

先完成正文与本地图片，再计算摘要：

```sh
python3 scripts/publish-academy.py --date 2026-10-12 --digest
```

命令只输出摘要，不填审核人、不创建批准或课程。
正文摘要为固定PAYLOAD字段（含十章节、caseType/authorization、来源和图片元数据）的排序键紧凑JSON、UTF-8 SHA256；
图片摘要按原始字节计算。不要手工猜算；任一正文、来源、版权元数据或图片变化均须重新核验。

`academy/reviews/YYYY-MM-DD.json` 使用模板中的：
`schemaVersion:1,date,status,reviewedBy,reviewedAt,approvalReference,privacyVerified,sourceChecks,rightsChecks,contentSha256,assetSha256`。
approvalReference只写获准公开的审查依据，不写私密会话、Library ID或凭据。
status保持pending/rejected，实际完成后才可approved。reviewedBy填写真实执行者身份或如实AI来源核验角色，不强迫编造人名；
reviewedAt须带时区，approvalReference须为真实审查记录依据。privacyVerified须经实际公开隐私检查。
sourceChecks/rightsChecks须逐一列出对应id、verified:true及实际basis，不能遗漏或多出项目。
摘要必须与命令结果一致。`approved:true` 旧字段本身没有批准效力；显式approved:false会与批准记录冲突并阻止候选。
CI还运行`python3 scripts/publish-academy.py --verify-published`：实际新增HTML必须与经审正文渲染字节一致，图片和审核摘要必须相符。10/11旧课仅在原始哈希完全不变时保留，不冒称重审。
软件验证记录完整性和内容绑定，不联网替代来源审查，也不能证明填写记录者确实做了科学判断；真实责任与复核仍属于审核者及普通受保护PR。

## 交接而非自然发布

```sh
python3 scripts/publish-academy.py --date 2026-10-12 --output-dir /tmp/academy-2026-10-12-candidate
```

输出目录须不存在，或为相同完整候选包；不同已有包不会覆盖。
包内含manifest.json、academy日期HTML、原稿、审核记录和图片。manifest列出每份文件SHA256。
missing_draft退出2；awaiting_review退出3；invalid_review/invalid_input退出4；already_published退出0且保持仓库原课（不代表在线部署已核验）；
candidate_ready退出0，只表示可交接，绝不表示已上线。原计划遇缺稿/待审会明确失败并保留状态摘要，不生成凑数内容。

既有授权执行者核对包及真正审核依据后，复制manifest中的文件到最新main隔离分支，正常PR→required validate→合并→Pages→线上日期/图文哈希核验。
同日已发布不再生成或覆盖，最新main/独占发布窗口与仓库完整门禁仍必需。
使用现有GitHub连接，不新增日程、workflow权限或令牌；真正全自动交接与今日课程状态必须另行验证。

## 静态课程目录

课程候选同时携带academy/catalog.json，按日期降序记录真实题目和同站HTML路径。目录网页读取同站清单，不依赖匿名GitHub API；失败时保留当前已知两课。普通PR须同步复制清单，CI将它与实际审核通过的课程文件核对，避免文件已部署却入口缺课。样式、原课和现有日程权限不变。
