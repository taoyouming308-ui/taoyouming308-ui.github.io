# 烫发研习院发布与每日任务接口

员工入口仍为 `plans`；默认 `academy`，`switchPlan('calc')` / `switchPlan('cold')` 和原 `perm_data_offline` 不变。新增收藏/学完记录使用独立 `perm_academy_learning_v1`，仅当前浏览器，无跨设备同步，禁用存储时退化为当前页面。

## 审核来源

页面只读取公开静态 `academy-feed.v1.json`，不使用业务数据库。初始审核内容不足时留空，不能用 AI 模拟论文或案例补足每天 5–8 条目标。热烫栏目应覆盖 TGA/CA、pH、软化、温度与含水率，但没有适用条件的固定配方不得入库。设计/排杠/中发栏目须注明观察和设计推断；真实案例须有允许公开的授权，不上传客户资料或授权书。

每条记录含 `title, category, batchDate, source:{url,author,publishedAt}, evidence:{level,basis}, coreKnowledge, shopApplication, openQuestions, tags, reviewStatus, reviewedBy, reviewedAt, isExample, isRealCase, authorization`。发布日期未知用 null；证据 level 为强/中/弱，basis 写明研究方法与适用限制，示例只能弱证据。批准是来源核验的编辑状态，不代表科学已获证实。

## 现有任务接入契约（尚未实际接通）

已核实：本会话可见的自动化中没有“每日烫发专业学习”。旧 02:30 审美 LaunchAgent 仅采候选，不是傍晚任务，不更改或安装它。需获得原任务 ID、实际执行器及它现有的输出路径/读取接口后，才可修改该任务的调用链。若需要新凭据、持续授权或权限扩展，先获得用户批准。不得对财务、客户或业务表写入。

1. 原每日任务按 Asia/Shanghai 日历日产生候选批次；同批次重试不创建新批次。
2. 采集端写 pending，保留来源获取/解析失败清单；最多三次指数退避的有界重试，失败次日继续。不能拿旧内容改日期充当新日更。
3. 人工来源、版权和专业适用范围审核后将批准记录交给构建器：`node scripts/build-perm-academy-feed.js reviewed.json docs/perm/academy-feed.v1.json`。
4. 构建器按规范 HTTPS URL + 标题派生稳定 ID，重复执行保持原入库日期；原子替换，不接受待审记录、未授权真实案例或强证据示例。失败不会覆盖正式文件。
5. 审查生成差异、确认无敏感数据，走仓库完整测试/版本/发布门禁后发布。内容不足不凑数；空批次不伪造成功。
6. 自动接通验收必须有原任务执行日志、批次 ID、审核记录、提交哈希及在线页面对应条目。接口文件存在不能当作接通证据。

尚缺：原傍晚任务入口/ID、可读取的候选输出、审核责任人及批准传递方式。未新增 cron，未改变现有自动化，未部署任何后端或扩展权限。
