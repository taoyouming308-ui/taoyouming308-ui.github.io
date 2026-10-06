# 研习院单次导入与后续自动接入（本地候选）

此改进保持 v607 页面、业务逻辑和正式 feed 不变。没有安装服务、启用日程、联网生成、调用收费模型、添加凭据或改 GitHub Actions 权限。用户确认旧每日任务已暂停；原任务工具不可见，不能声称由工具关停。旧 02:30 审美 LaunchAgent 与本流程不同，未动它。

## 完整批次输入

新任务应产出 UTF-8 JSON，使用下列完整契约。旧版已审核数组继续支持；新流程应使用批次封装，禁止靠 UTC 日期字符串截断产生上海日批次。

```json
{
  "schemaVersion": 1,
  "batch": {
    "id": "perm-YYYY-MM-DD",
    "timezone": "Asia/Shanghai",
    "producedAt": "带 Z 或 ±HH:MM 的真实产出 ISO 时间",
    "label": "基础精读 · 非近7天新发现",
    "dailySummary": "区分测量、观察、推测的本日总结",
    "lowRiskPractice": "低风险练习及不得外推的边界"
  },
  "items": [
    {
      "title": "条目标题",
      "category": "热烫原理",
      "batchDate": "YYYY-MM-DD（可省略；由批次时间按上海派生）",
      "source": {
        "url": "公开 HTTPS 原始来源",
        "author": "实际作者或发布机构",
        "publishedAt": null,
        "updatedAt": null,
        "onlinePublishedAt": null,
        "verifiedOn": "YYYY-MM-DD",
        "dateNote": "首次、更新、线上发表日期的区别；未知不补造"
      },
      "evidence": {
        "level": "中",
        "basis": "证据方法、条件、限制和不能推广的结论",
        "parts": [
          { "type": "原始研究/教材/职业原则/制造商建议/原创示意", "level": "中", "basis": "分项依据与限制" }
        ]
      },
      "coreKnowledge": "核心知识，明确来源观点与原创教学推断",
      "shopApplication": "门店应用，不生成未经验证的固定药水/温度配方",
      "openQuestions": "待验证问题",
      "tags": ["基础精读", "非近7天新发现"],
      "reviewStatus": "pending",
      "reviewedBy": null,
      "reviewedAt": null,
      "isExample": false,
      "isRealCase": false,
      "authorization": "not_applicable"
    }
  ]
}
```

- `batch.id` 必须等于 `producedAt` 按 Asia/Shanghai 换算后的日期。不存在的日历日期及无时区时间拒绝。
- 其余栏目：烫发设计、排杠技法、中发方案库、顾客沟通、科研与验证。
- 来源日期未知用 null。`updatedAt`、`onlinePublishedAt`、`verifiedOn`、`dateNote` 和 `evidence.parts` 是可选扩展；保留原 schema。分项证据防止把制造商原则和原创示意混成已验证科学。完整示例条目整体仍只能弱证据。
- 真正批准后由受信审核人设置 `reviewStatus=approved`、实际 `reviewedBy`、带时区的实际 `reviewedAt`。这三项不是任务自行改字即可完成的审核。真实案例必须有公开授权；禁止案例和教学示例同时为 true。
- `contentFingerprint` 和 `id` 由构建器产生。不要把模型自报指纹当作独立证明。

## 单次验证路径

1. 在已授权本机执行环境产生上述 JSON。研究/审核输出能力必须先在一次真实执行中证明；仅有分享链接、聊天文本或任务存在不算文件交接成功。
2. `node scripts/build-perm-academy-feed.js --preflight candidate.json` 只校验结构，返回 `preflightOnly=true / approvalRequired=true`，保留 pending，不写正式 feed。
3. 核实原始公开来源、作者日期、证据与条件、版权和专业适用性。审批标准后续单独明确；当前解析器不联网核验，也不自动批准。
4. 审核批准后，在隔离目录复制现有 feed，执行：

   `node scripts/build-perm-academy-feed.js approved.json staged-feed.json private-recovery-dir`

   看 `changed`、稳定 ID、首批日期、来源分项与证据边界。真实候选未批准时应失败且旧 feed 字节不变；合成测试通过不代替真实审核。
5. 重复运行须 `changed=false`，文件字节、mtime、updatedAt 都不变。不凑 5–8 条；不足如实记为不足。
6. 仅有新且批准的内容才进入已授权 Git 分支/PR/完整检查/合并/Pages 核验。原有验证工作流会通过 `test-perm-academy.js` 加载新的安全测试，不更改 workflow 文件或权限。当前只是本地改进，没有推送。
7. 真接通的证据须包括实际新任务运行、批次、审核、Git 提交、在线条目。日程配置和导入契约不能代替这些证据。

## 幂等、锁、重试与恢复

- 已有 ID 保留，保护浏览器收藏/学习记录。URL 仅规范顺序、剔除常见追踪参数和 fragment，保留语义查询参数。内容指纹不把新标题、复查时间或审核人标签当新知识；重复内容保持原批次，语义变化须更晚审批，同时间冲突拒绝。
- 独占 `<output>.lock` 保护同一 staging feed。锁存在立即退出，不偷锁、不自动删除旧锁。锁应由原进程正常释放；异常遗留须人工确认所属进程后处理。此锁不替代 Git 远端 expected-head/最新 main 和 CI 门禁。
- 全部输入校验后才写临时文件，fsync 后原子 rename。提交前再比对原输出字节；不经锁的外部更新会导致拒绝覆盖。禁止 output symlink。
- 只对 EBUSY/EAGAIN/ETIMEDOUT 重试；最多 3 次，退避每次不超过 1 秒。权限、审核、schema、并发冲突不重试。没有网络采集重试或后台循环。
- 私有恢复目录默认在系统临时目录；正式执行须明确稳定、非公开且已授权的恢复目录。任何失败不回滚覆盖别人后来写入的内容。临时目录恢复点不承诺长期留存。
- 本地恢复：`node scripts/build-perm-academy-feed.js --restore snapshot.json staged-feed.json CURRENT_SHA256 private-recovery-dir`。哈希不一致拒绝，恢复动作也受锁与原子写保护。线上恢复仍须新的 Git 提交和正常发布门禁，不自动触发，也不降低 App 版本。

## 无新增 API key 的可行边界与额度

本 dot 已能通过本机工具写 JSON、运行 Node，以及用已授权 Git SSH/GitHub 连接器处理 Git。但一次会话成功不证明未来日程运行仍拥有相同本机和连接器能力，需要一次手动真实任务运行证明路径、认证可用与读取结果一致。无需调用收费生成接口即可完成当前五条候选的结构预检和导入测试。

若正式任务可以沿用该执行环境/现有授权，内容审核后可交接既有 Git 流程，未必需要新 API key；若改用 GitHub Actions 自动提交，当前 `contents:read` 不足，新增 write/令牌权限须另获用户确认，不可静默扩展。模型和日程仍占用账户额度，不能承诺免费或无限预算。

节省额度：一天一个真实批次；稳定来源先按内容指纹跳过未变化正文；不为满额重复摘要；仅获取候选所需原文；不足留空；无变化不提交、不触发重复全套 CI；有界失败次日处理，不同一日无限生成。不要同时启用两个执行器。
