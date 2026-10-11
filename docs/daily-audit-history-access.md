# 日报修改记录读取与折叠（v630）

用户授权：老板可查看且默认收起；其他账号不能在页面或服务器读取日报修改历史。保留审计写入、普通日报/入账与门店隔离，不删除记录或增加权限。

## 身份依据

既有 `20261009063120_zysyr_admin_confirmed_daily_correction.sql` 与 `finance-release-runbook.md` 明确：唯一 active/Auth-bound 的 admin 是老板，公司范围股东，专属 `daily_report.correct_confirmed` 直接授予该账号，不授予角色。生产只读查询确认账号 57aba56a-23ca-482b-acc2-e00da5a5d1f7、Auth d205de6f-2bbe-46f3-a591-4725a2423777、公司 02463a53-dfdb-4291-b04d-dd1d85f9d998 的映射和未撤销授权。

`operations-auth` 验证 Auth 并实时读取 active 账号/有效授权；API 必须同时匹配上述服务器 ID、公司范围股东与专属 capability。登录名和显示名不参与新历史权限判断。未来换老板账号需明确批准新的映射，不能自动采用另一个 admin/财务账号。

## 最小读取边界

- `dailySheetData` 默认不查询/返回历史，详情仅在服务器验证老板后读取；普通列表、保存/创建响应不包含修改条目。不存在的历史详情/导出操作拒绝，客户端 read_history/role/actor 参数无效。
- 撤销 cell_changes 和 daily_sheet_versions 对 PUBLIC/anon/authenticated 的 SELECT，服务端 broker 和事务审计写入 ACL 不变。
- 仅为 audit_events 的 daily_sheet_draft 行增加 restrictive SELECT policy，要求既有老板 Auth/公司和实时专属授权。其他审计行保持原 policy，所有 INSERT 与审计保护触发器保持不变。
- 不修改金额、入账函数、RLS 原策略、门店范围或现有更正权限。

## 页面行为

老板看到 44px 紧凑查看入口，默认折叠，原生 button 支持键盘与 aria-expanded/aria-controls。切店/月份/返回再进入/切号收起。折叠不修改 dirty 金额、原因或校验。非老板无入口且清理 history/DOM；登出、降权和旧账号迟到的详情响应也不能恢复历史。

## 验证与发布边界

共用财务门禁增加 actual-handler HTTP、隔离 PostgreSQL ACL/RLS 与手机/桌面交互测试，全部使用合成数据。已有入账/更正事务、不可变历史、现金复核端到端回归保持。冻结 Deno check 通过。合成 Library 预览：libfile_f7aceece41608191b9060c4ffbc1f755。

原任务产物恢复提交 32bebcd、当天完整备份和专属 daily-audit-collapse-v630 锁保留；原过程日志读取失败，未发现仍在运行的本任务测试进程。参考图经当前 Library 流程及一次明确本地目录重试均下载失败，未使用猜测 URL 或公开上传原图。

当前发布阻断：GitHub classic main protection 为 404，effective branch rules=[]。仓库 AI_COLLABORATION_RULES 明确要求保护强制 Validate shared app 后才可合并。未获仓库权限配置授权，不能自行创建保护；本 PR 不合并，数据库迁移与 Edge 均不部署。生产保持 v629 / operations-api v126。恢复该门禁后，继续正常 PR CI/合并、后端 ACL/源码/JWT/无会话拒绝回读及最终 Pages 精确文件/版本核验；此文和本地回归不代表已上线。
