# ChatGPT 原图与设计版本导入

`scripts/import-customer-design-archive.py` 是受信任工作台的有限导入工具。它只使用绑定顾客和本次服务、短期有效的 `ingest_token`，不登录员工、不读取服务密钥，也不替代 App 的手工记录入口。

配置和执行进度必须放在仓库之外、权限为 `0700` 的私有目录。工具会将配置原子保存为 `0600`；不要把配置、真实顾客资料、原图、令牌或签名下载链接提交到代码仓库。配置只包含明确要求归档的设计资料，现场闲聊不得录入。

以下为虚构数据的配置结构。`path` 必须指向已取得的原始文件；工具不下载聊天附件、不生成替代图、不压缩或重新编码图片。

```json
{
  "endpoint": "https://PROJECT.supabase.co/functions/v1/employee-bookings-api",
  "customer_profile_id": "123",
  "booking_id": "456",
  "booking_date": "2026-11-08",
  "photos": [
    {"path": "/workspace/private/original-front.png", "stage": "before", "angle": "front", "caption": "剪前正面原图"}
  ],
  "versions": [
    {
      "status": "baseline",
      "baseline": {
        "outline": "从照片可见的当前轮廓",
        "root_flow": "从照片可见的毛流；待现场核对处明确写出",
        "steps": {
          "style": "风格判断",
          "person": "顾客明确提供的需求与现场已确认条件",
          "length": "现有长度",
          "features": "发型特点",
          "layers": "层次",
          "bangs": "刘海",
          "curls": "卷度",
          "care": "打理条件"
        }
      },
      "optimized": {
        "outline": "从照片可见的当前轮廓",
        "root_flow": "从照片可见的毛流；待现场核对处明确写出",
        "steps": {
          "style": "风格判断",
          "person": "顾客明确提供的需求与现场已确认条件",
          "length": "现有长度",
          "features": "发型特点",
          "layers": "层次",
          "bangs": "刘海",
          "curls": "卷度",
          "care": "打理条件"
        }
      },
      "reasons": {},
      "archive_url": "https://chatgpt.com/space/page_synthetic_archive",
      "photo_indices": [0]
    }
  ]
}
```

实际项目名称必须使用小写 Supabase 项目标识。顾客和预约 ID 应先按现有预约数据核对，不能依靠照片识别身份。没有预约的独立到店记录可以省略 `booking_id`，仍须明确 `booking_date`。

八步人物设计之后可记录六区执行、十大流程参照与完成复盘。每一版使用独立的顶层 `execution`、`process`、`review` 对象，不能塞进八步的文字字段。以下为可追加到上述 `versions` 单项内的虚构片段，仅表示结构，不代表任何真实顾客的工艺或验收结果：

```json
{
  "execution": {
    "top": {
      "issue": "照片中顶区较贴，待自然干现场核对",
      "target": "适度支撑，保留表层完整",
      "actions": "待发型师确认具体操作",
      "check": "自然落发后复查顶部高度和表面覆盖"
    },
    "bottom": {
      "issue": "待现场检查底线重量",
      "target": "保留与肩颈比例协调的量感"
    }
  },
  "process": {
    "style_feel": "自然柔和为主，少量复古元素",
    "proposal": "设计讨论稿，尚未确认技术参数"
  },
  "review": {
    "pending": "完成照与洗后反馈待补"
  }
}
```

字段契约如下；允许只填写本次已经确认的区域或项目，不要求填满：

| 对象 | 固定键 | 含义 |
| --- | --- | --- |
| `execution` | `bangs`、`top`、`ear_front`、`ear_back`、`middle`、`bottom` | 刘海区、顶区、耳前区、耳后区、中区、底区 |
| 每个六区对象 | `issue`、`target`、`actions`、`check` | 当前问题、目标、具体怎么做、完成核对点 |
| `process` | `care_texture`、`styling`、`style_feel`、`application`、`winding`、`rod_direction`、`curl_control`、`thinning_space`、`proposal`、`technique_layers` | 打理与质感、造型方式、风格与感觉、上药位置、卷杠方法、排杠方向、卷度与控卷、打薄与空间、设计提案、技术与层次 |
| `review` | `achieved`、`pending`、`next` | 已达成、待调整、下次重点 |

上述对象可省略或为 `{}`。非空对象按固定键补齐空字符串；所有文字均最多 4000 字符并清理首尾空白，未知键、数组、`null` 和非文字字段会在联网前拒绝。所有文字均为空时归一化为 `{}`，不会由工具猜填。十大流程按实际服务选填，不从设计目标自动生成上药、卷杠或设备参数；旧五区烫发实操数据不自动映射为六区，也不补写旧顾客历史。

省略与显式空对象的写入含义不同：未写入配置的新增对象不会加入请求，保持旧配置的重试内容；明确写入 `{}` 会发送，表示本次快照明确为空，可用于经核对后的清空。继续已有六区、十大流程或复盘的服务时，应先核对最新记录，携带需要保留的完整对象；不能用遗漏字段表达“保持原样”。若最新版本对应字段已有内容，旧客户端省略该字段的新保存会收到 HTTP 409 升级提示，服务端拒绝覆盖已有内容。保留草稿，在安全时机更新客户端后继续，不强制刷新正在工作的页面；已成功的旧请求 UUID 幂等重放不受该保护影响。

旧配置未包含这些新对象时，准备摘要、请求编号、保存内容和重试前提保持兼容。工具不会把新默认字段写入原配置。已准备的配置不能直接添加六区或复盘：新的讨论、执行、完成反馈用新的私有配置追加版本，避免用旧请求编号提交改变后的内容。

无预约记录默认使用 `manual:日期` 作为本次服务标识；同一天有多次独立服务时，在配置中显式添加 `visit_key`，格式为 `manual:日期:UUID`，并使用同一个值注册授权。带预约的标识固定为 `booking:预约ID`。导入会逐条核对照片、版本的顾客、预约、日期和本次服务标识。

`versions` 按初始判断、优化方案的时间顺序排列，每一项都新增不可变版本。优化后字段与初始判断不同且非空时，`reasons` 必须填写对应键的理由；整体轮廓和发根毛流同样适用。优化后的内容写入 `optimized`，初始判断继续完整保留在 `baseline`，不要用新结论覆盖旧判断。没有完成反馈时不要使用 `completed`，也不要把剪前照片标成完成照片。

App 每次服务只展示当前最终方案（若还没有确认方案则展示最新讨论稿），中间更新和旧照片继续在后台保存。只更新六区执行或复盘时同样新增版本，不能修改已保存快照。发质分析表与设计档案通过已核对的顾客和本次服务关联，不在两个入口各存一份设计。

每版可以选填 `archive_url`，仅允许 HTTPS `chatgpt.com/space/…` 页面地址。它用于打开原协作档案，App 里的原图仍来自私有存储中的原始文件副本。

支持状态为 `baseline`、`optimizing`、`confirmed`、`completed`、`followup`；照片类别为 `before`、`after`、`reference`；角度为 `front`、`back`、`left`、`right`、`detail`。每张 JPEG/PNG/WebP 原文件最多 8 MiB。每版默认引用全部照片，也可以用从零开始的 `photo_indices` 选择部分原图。设计文字的首尾空白按服务端约定清理，空缺的理由键补为空字符串；原图字节不做任何更改。

先准备私有配置，生成绑定内容摘要和稳定请求编号：

```sh
python3 scripts/import-customer-design-archive.py prepare --config /workspace/private/design-import.json
```

该命令只打印令牌的 SHA-256、顾客 ID、预约 ID 和日期。通过现有受信任管理连接注册这一摘要的短期导入授权，并核对顾客、门店和预约范围；明文令牌只保留在私有配置内。授权的服务端来源固定为 ChatGPT。注册授权的 RPC 只允许受信任管理端调用，不得向员工浏览器提供服务密钥。

管理端调用 `register_customer_design_ingest_grant`，参数为 `p_token_hash`（准备输出的 64 位小写十六进制摘要）、`p_customer_profile_id`、`p_booking_id`、`p_booking_date`，以及 `p_created_by`（默认 `ChatGPT`）、`p_expires_minutes`（1 至 15，默认 15）、`p_visit_key`（无预约时可用，默认空）。服务端核对真实顾客与预约范围；RPC 只返回授权元信息，不生成或返回明文令牌。

授权注册成功后执行：

```sh
python3 scripts/import-customer-design-archive.py import --config /workspace/private/design-import.json --verify-originals
```

导入会检查上传后服务端返回的 SHA-256 和文件大小，回读全部新版本及其照片引用，同时逐项比对八步、调整理由、六区执行、十大流程和完成复盘；服务返回成功但内容丢失也会停止。`--verify-originals` 还会获取短期私有链接并下载原图，按字节验证与本地原始文件一致；这些链接和明文令牌不会打印。成功输出只有数量、校验数量和记录 ID。

网络中断、丢失保存响应或进程退出后，使用**同一份未经改动的私有配置**重新执行即可。照片上传和设计保存复用已经落盘的请求 UUID，并保留首次写入前的并发条件；工具不会自动反复提交写操作。若 App 已新增其他版本并触发冲突，应先人工核对，不能删除进度或换请求编号绕过冲突。需要延长授权时使用 `prepare --rotate-token` 并重新注册短期授权；这会保留原来的请求 UUID 和进度。

工具拒绝在准备后更改图片或设计内容。后续服务、新照片或新设计使用新的私有配置，生成新的不可变版本。不要删除旧配置以强制重新导入同一批数据。

离线测试只使用生成的合成资料和模拟服务：

```sh
python3 -m unittest scripts/test_import_customer_design_archive.py
```
