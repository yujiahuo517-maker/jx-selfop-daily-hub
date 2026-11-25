# 自营 AI 作业中枢（jx-selfop-daily-hub）

> 一个 Skill + 一块看板，把 9 项自营固定作业收成一个入口：
> **今天做什么 → 按 SOP 怎么做 → 做完留痕 → 管理员一屏看完成。**

这不是一套新的业务接口，而是**编排层**：把散在各人手里的提示词、活动参数、回读口径，
固化成可安装、可分发、可统计的作业台。真正的取数与提交仍由
`blacklight`（OSW / 黄金眼 / EasyBI / 营销）和 `yx-mcp`（yx.jd.com 报名）完成。

---

## 一、它解决什么问题

| 角色 | 之前 | 现在 |
|---|---|---|
| 采销成员 | 9 项作业靠记忆和群消息，口径每次现问 | 一条 `plan` 出今日执行单，每项带 SOP、依赖、完成标准 |
| 采销成员 | 做完没人知道，周会靠回忆 | `done` / `fail` 一条命令留痕，自动上报 |
| 管理员 | 挨个问「超补报了吗」「差评处理了吗」 | 看板一屏看全员 × 今日作业矩阵，缺谁一眼看到 |
| 团队 | 人一换，经验带走 | SOP 和参数在仓库里，新人装完就能跑 |

**一句话：让「做了没有」这件事，从口头确认变成可回读的记录。**

---

## 二、先看三条铁律

1. **只用本人登录态和业务权限**。不借号、不跨采销查数、不替别人接受协议或提交。
2. **没有回读就不算完成**。平台受理、接口 `success`、提交回执都不是成功判据，必须按各 SOP 的回读口径确认。
3. **没有留痕就不算完成**。执行后用 `done` 写摘要 / 指标 / 证据；失败必须写平台原始原因，禁止空口标完成。

---

## 三、目录结构

```text
jx-selfop-daily-hub/
├─ SKILL.md                     # 技能主文件（Agent 读这个）
├─ agents/openai.yaml           # 技能界面元信息
├─ install.ps1                  # 成员一键安装
├─ start-dashboard.ps1          # 管理员一键起看板
├─ data/
│  ├─ tasks.json                # 唯一任务注册表（排期 / 负责人 / 活动参数）
│  ├─ roster.json               # 本机名册（出厂为空，安装时自动写入本人）
│  └─ reports.jsonl             # 上报数据（默认空，运行时追加）
├─ scripts/jx_task.py           # 执行留痕 CLI（Python 标准库，无第三方依赖）
├─ dashboard/                   # 本机实时看板（Node 原生，零 npm 依赖）
├─ cloud-app/                   # 京东想象力平台部署版（实时矩阵 + 上报接口）
├─ automation/                  # 每日执行单生成 + Windows 计划任务注册
└─ references/
   ├─ sop/01..11               # 逐项 SOP（默认下发 9 项，已下线在 _retired/）
   ├─ task-matrix.md           # 作业清单与成熟度
   ├─ status-model.md          # 状态与完成率口径
   ├─ distribution.md          # 分发、部署、权限、安全
   └─ capability-boundary.md   # 能做什么 / 做不到什么
```

---

## 四、前置条件

| 依赖 | 版本 | 用途 | 是否必需 |
|---|---|---|---|
| Windows 10/11 + PowerShell | 5.1+ | 安装脚本、计划任务 | 必需 |
| Python | 3.11+ | `jx_task.py` 留痕 CLI（仅标准库） | 必需 |
| Node.js | 18+ | 看板（零 npm 依赖，不用 `npm install`） | 看板需要 |
| 京东内网登录态 | — | 所有平台取数与提交 | 必需 |
| `blacklight` 技能 | 最新 | OSW / 黄金眼 / EasyBI / 营销取数与写操作 | 写平台作业需要 |
| `yx-mcp` | 最新 | yx.jd.com 报名通道（超补 / 秒杀 / 特价） | 写平台作业需要 |

> 本仓库**不包含**任何账号、Cookie、Token、APP Secret，也不包含业务接口实现。
> 缺依赖时技能只会记 `blocked` 并写清缺什么，不会造假、不会手拼接口。

---

## 五、5 分钟安装（成员）

### 1. 拿到代码

```powershell
git clone <仓库地址> jx-selfop-daily-hub
cd jx-selfop-daily-hub
```

没有 Git 就让管理员发 zip，解压后进目录即可。

### 2. 安装到技能目录并初始化

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 `
  -Erp <你的ERP> -Name <你的姓名> `
  -Server http://<管理员IP>:8080
```

脚本做三件事：复制到 `%USERPROFILE%\.joycode\skills\jx-selfop-daily-hub`、
写本人配置到 `%USERPROFILE%\.jx-selfop\config.json`、跑一次身份校验。

> `-Erp` 填**你自己的 ERP**（例如 `huoyujia6`）。
> 仓库自带的 `data/roster.json` 里是 `zhangsan1` / `lisi2` 这类**示例占位**，不是真人，
> 也不需要你改成他们——管理员分发前会把名册换成真实团队。

> 走线上看板时把 `-Server` 换成管理员给的地址，并加 `-Token <本人令牌>`。
> 令牌一人一个，按 ERP 生成，不能自选也不能手改，用别人的 ERP 领不到也上报不上去。
> **自助领取**：用本人京东身份打开 https://jx-selfop-board.joyapp.jd.com/token ，
> 页面直接给出你的 32 位令牌和拼好的整条安装命令，复制即可，不用等管理员发。

### 3. 看今天有哪些作业

```powershell
python scripts/jx_task.py plan
```

输出按计划时间排序，每项带：`task_id`、SOP 路径、依赖、完成标准、留痕模板、下一个动作。

### 4. 执行闭环

```powershell
# 开始
python scripts/jx_task.py start --task super_subsidy

# 按 references/sop/01-super-subsidy.md 执行，完成平台回读

# 完成留痕（至少一项证据）
python scripts/jx_task.py done --task super_subsidy `
  --summary "候选12/预检10/回读新增8/异常0" `
  --metric 候选数=12 --metric 预检通过数=10 --metric 回读新增数=8 `
  --evidence 回读=applied_sku_ids 前后差
```

失败 / 阻塞 / 当天不适用，分别用 `fail` / `skip`，不要用 `done` 掩盖：

```powershell
python scripts/jx_task.py fail --task bad_review_appeal --error "提报程序返回 401，Cookie 失效（原始响应已保存）"
python scripts/jx_task.py skip --task tejia_weekly --reason "活动停报，已由负责人确认"
```

---

## 六、通用提示词（复制即用）

下面 5 条与具体人无关，把 `<>` 里的内容换成自己的即可。粘给任意支持本 Skill 的 Agent 都能跑。

### 提示词 1 · 每天开工：今天我要做什么

```text
使用 jx-selfop-daily-hub 技能，我是 <ERP>（<姓名>）。
先运行 python scripts/jx_task.py plan，把今天的作业按时间顺序列出来。
每一项给我：要做什么、依赖是否就绪、完成标准、大概耗时。
先只做规划和检查，不要执行任何写操作，等我逐项确认。
```

### 提示词 2 · 执行单项作业（最常用）

```text
使用 jx-selfop-daily-hub 技能，执行今天的 <task_id>（<作业名>）。
要求：
1. 先读 references/sop/<NN-xxx>.md，向我复述前置条件和回读口径；
2. 只用我本人的登录态，只处理我名下的 SKU；
3. 有 dry-run 的先 dry-run，把「候选 / 剔除 / 待提交」清单给我确认；
4. 我确认后再提交；
5. 提交后按 SOP 回读，拿到真实结果；
6. 用 done / fail 留痕并上报看板；失败必须写平台原始原因。
注意：特价（tejia_weekly）必须先出确认表，未经我确认禁止提交。
```

### 提示词 3 · 管理员：今天大家做得怎么样

```text
使用 jx-selfop-daily-hub 技能，以管理员身份工作：
1. 启动看板：powershell -ExecutionPolicy Bypass -File start-dashboard.ps1 -Port 8080；
2. 汇总今天的完成率、未完成的人和项、失败/阻塞原因、逾期项；
3. 导出近 14 天 CSV，给出趋势结论（是能力问题还是流程问题）；
4. 不要替成员补 done；纠错只能基于确有其事的证据。
```

### 提示词 4 · 新成员接入

```text
使用 jx-selfop-daily-hub 技能，帮我接入团队作业看板。
我的 ERP 是 <ERP>，姓名 <姓名>，看板地址 <URL>，令牌 <TOKEN>。
请运行 install.ps1 完成安装与初始化，再跑一次 plan 验证。
如果缺 blacklight / yx-mcp / Node / Python，明确告诉我缺什么、怎么装，
不要跳过依赖直接执行写操作。
```

### 提示词 5 · 先搞清楚能力边界

```text
使用 jx-selfop-daily-hub 技能，说明这套工具能做什么、不能做什么，
以及哪些环节必须我人工确认。
按「已自动化 / 半自动 / 必须人工」三档回答，并给出对应文件位置。
```

---

## 七、9 项作业与完成口径

| # | task_id | 作业 | 优先级 | 排期 | 计入看板 |
|---|---|---|---|---|---|
| 01 | `super_subsidy` | 超级补贴自动提报 | P0 | 每天 18:50 | ✅ |
| 03 | `flash_sale` | 秒杀提报 | P0 | 每天（T+3～T+5） | ✅ |
| 04 | `tejia_weekly` | 特价提报与后续券池 | P0 | 每天 11:30（需采销确认） | ✅ |
| 05 | `daily_tool_checkin` | 每日工具使用与双表打卡 | P0 | 每天 11:00 | ✅ |
| 06 | `bad_review_appeal` | 差评 / 中评申诉治理 | P0 | 每天 10:10 | ✅ |
| 08 | `cheap_free_shipping` | 特价便宜包邮 5.9-5 / 4.9-4 | P1 | 按周（默认周一） | ✅（周一） |
| 09 | `official_discount_mark` | 官方直降打标 & 国补 & 9 折 | P1 | 按通知 | ❌ 待补 SOP |
| 10 | `aftersale_recovery` | 售后 & 未合单 & 直赔 & 运费回收 | P1 | 按通知 | ❌ 待补 SOP |
| 11 | `newcomer_price` | 新人价 SKU 提报 | P1 | 按通知 | ❌ 待补 SOP |

> **2026-11-24 起下线两项**：`ad_profit_guard`（广告入池出池 / 广告止损）与 `spu_daily_drop_board`（SPU 骤降）不再进入每日清单，`plan` / `today` / 看板都不再调度。
> SOP 存档在 `references/sop/_retired/`，恢复步骤见该目录 README。

**固定参数**（已写入 `data/tasks.json`，`plan` 会打印完整链路）：

| 作业 | resourceId | areaId | activityId | 场域 |
|---|---|---|---|---|
| 超级补贴 | 2935 | 319901 | 101664799 | 京喜自营（`applySkuType=3`） |
| 秒杀 | 2858 | 313601 | 101666814 | 京喜自营（`applySkuType=3`） |
| 特价（前置） | 5177 | 38801203 | 101766465 | 京喜自营 |
| 特价后续券池 | 7186 | 42839704 | 101857088 | 只评估、不直接报 |

> `resourceId` 不等于 `areaId`：接口传错会返回「开放收品池未发布」或「获取时间信息失败」。
> 换活动时三值必须一起改。

### 状态口径

| 状态 | 含义 | 计入完成 |
|---|---|---|
| `done` | 已按 SOP 执行并回读验收 | ✅ |
| `skipped` | 当天确实不适用，且写明原因 | ✅（不计失败） |
| `running` | 已开始未收口 | ❌ |
| `failed` | 执行失败，保留原始原因 | ❌ |
| `blocked` | 被登录 / 权限 / 配置阻塞 | ❌ |
| `pending` | 没有任何记录 | ❌ |

逾期 = 超过「计划时间 + 宽限」仍未完成；历史日期未完成一律算逾期。

---

## 八、管理员：起看板

### 本机 / 局域网实时版

```powershell
python scripts/jx_task.py serve --port 8080
# 或
powershell -ExecutionPolicy Bypass -File start-dashboard.ps1 -Port 8080
```

- `/`：简洁矩阵版，名册内成员 × 今日计入项，绿=完成、蓝=进行中、红=失败、灰=未开始、浅灰=不适用。
- `/full.html`：完整版，含失败原因、14 天趋势、人员明细、CSV 导出。
- 采集接口：`POST http://<管理员IP>:8080/api/report`，成员 `done/fail` 自动调用。
- 只有这个 Node 服务能收上报；导出的静态页是只读快照。

对外开放端口（管理员 PowerShell 执行一次）：

```powershell
New-NetFirewallRule -DisplayName "JX Selfop Dashboard" -Direction Inbound `
  -Protocol TCP -LocalPort 8080 -Action Allow
```

管理员机器要固定地址、不休眠；这是多人汇总的唯一依赖。

### 京东想象力平台（joyapp）实时版

`cloud-app/` 是部署到想象力平台的版本（已部署：**https://jx-selfop-board.joyapp.jd.com/**，全员共用），
提供 `/` 实时矩阵、`/full.html`、`/demo.html` 和上报接口。
部署要点（完整步骤见 `references/distribution.md` 第八节）：

1. 导出静态快照时必须加 `--no-export`，否则 CSV 导出会触发平台静态审查的「数据导出」规则。
2. 部署会注入 `_ssa_guard.js` 等平台文件，**这些文件含密钥，不要提交到 Git**（本仓库 `.gitignore` 已排除）。
3. 迭代部署同一 appCode 时不要再传 `domainPrefix` / `portalName`，域名不变。
4. 门户访问需在管理端「配置权限」逐个加白名单，不在名单里的人会被 SSO 拦住。

> 线上版只接收状态与摘要，不会替人执行作业；也不能替代本机 `done/fail` 的真实回读。

---

## 九、每日自动执行（计划任务）

确定性部分交给脚本，写操作仍由人在会话里完成。

```powershell
# 手动验证一次：生成执行单 + 写日志
powershell -ExecutionPolicy Bypass -File automation\daily-run.ps1 -Erp <你的ERP>

# 注册每天 08:55 自动生成（可顺带起本机看板）
powershell -ExecutionPolicy Bypass -File automation\register-task.ps1 -Erp <你的ERP> -Time 08:55 -StartDashboard

# 查看 / 移除
schtasks /Query /TN JX-Selfop-Daily /FO LIST
powershell -ExecutionPolicy Bypass -File automation\register-task.ps1 -Unregister
```

- 产出：`%USERPROFILE%\.jx-selfop\daily\<日期>-plan.md`、`logs\daily-*.log`、`logs\last-run.json`。
- **只做清单与提醒**：不会自动报名、停投、打卡、申诉。
- 任务按「仅交互式」注册：不登录桌面不触发；休眠/关机错过就手动补跑一次。
- 计划任务跑过 ≠ 作业完成；看板只认 `done` / `skipped`。

---

## 十、改成你自己的团队

只需要改两个文件，不用动代码。

### `data/roster.json` — 名册

出厂是空数组 `[]`，`init`（`install.ps1 -Erp -Name` 内部会调）自动把执行人写进来：

```json
[
  { "name": "张三", "erp": "zhangsan1", "team_id": "00000000" }
]
```

`erp` 必须唯一；看板按 `erp` 统计。

- **成员机器**：保持“只有本人”即可，重装不会丢（`init` 会自愈补回本人）。
- **管理员机器**：要按团队矩阵看，就把 `data/roster.example.json` 复制成 `data/roster.json`，
  换成真实姓名 + ERP，并同步 `data/tasks.json` 里各任务的 `owners`。
- 仓库里的 `zhangsan1` / `lisi2` 等是**示例占位（非真人）**，只出现在 `tasks.json` 的 `owners` 与
  `roster.example.json` 中；安装时 `init` 会把这些负责人专属作业自动指向执行人，
  所以同事装完就能看到超补 / 秒杀 / 特价，不需要管理员手工改 JSON。

### `data/tasks.json` — 任务注册表

| 字段 | 说明 |
|---|---|
| `owners` | 负责人 ERP 列表；`[]` 表示待指派 |
| `scope` | `owner` = 只处理本人名下 SKU；`all` = 全员作业 |
| `schedule` | `daily` / `weekly` + `time` + `grace_minutes` |
| `resource_id` / `area_id` / `activity_id` | 活动参数，换活动三值一起改 |
| `requires_confirm` | `true` 时提交前必须给采销确认表（特价默认开） |
| `count_in_rate` | 是否进入看板完成率矩阵 |
| `dependencies` | 缺依赖时只允许 `blocked`，不允许硬跑 |
| `status` | `ready` / `needs_confirmation` / `needs_sop` |

改完跑 `python scripts/jx_task.py plan` 验证，不要口头改口径。

---

## 十一、能力边界（对外承诺前先读）

### 已自动化

- 今日执行单生成、按时间/优先级排序、依赖检查。
- 执行留痕、失败原因、指标、证据、CSV 导出与回导。
- 看板聚合：完成率、逾期、失败分布、14 天趋势、人员明细。
- Windows 计划任务每日生成执行单与日志。

### 半自动（Agent 执行 + 人确认）

- 超级补贴 / 秒杀 / 特价 / 便宜包邮：能拉候选、做归属与毛利过滤、生成提交清单；
  **提交前必须人确认**，提交后必须回读。
- 广告入池出池 / 广告止损：2026-11-24 起不在默认清单内；历史 SOP 见 `references/sop/_retired/`。
- 差评申诉：依赖本机提报程序与有效 Cookie，缺了就 `blocked`。
- 特价后续券池（5.9-5 / 4.9-4）：**只评估、不直接报**，两条承担公式都 ≥0 才允许进池。

### 明确做不到

| 做不到 | 原因 |
|---|---|
| 无人值守自动报名 / 停投 / 打卡 / 申诉 | 平台写操作需本人登录态与会话内确认 |
| 自动识别「没走技能、自己手工做完」的人 | 没有平台侧回读就无法判定，只能人工登记 |
| 09 / 10 / 11 三项按猜测执行 | PDF 只有名称，没有负责人和细则，标 `needs_sop` |
| 代查别人商品、借用他人账号 | 越权，直接禁止 |
| 自动改标题 / 京东价 / 券促 / 上下架 | 不可逆写操作，必须人工决策 |
| 断网/休眠期间继续跑 | 计划任务仅交互式触发，唤醒后手动补 |

完整版见 `references/capability-boundary.md`。

---

## 十二、安全与合规

- 只处理本人名下 SKU，只上报本人 ERP。
- 采集接口只接收作业状态记录，不接收 Cookie / Token / 密码。
- 仓库内**不得**出现：`_env.js`、`_data_client.js`、`_ssa_guard.js`、`INGEST_SECRET`、
  `JOYCODE_PTKEY`、任何人的令牌或 `reports.jsonl` 真实数据（`.gitignore` 已排除）。
- 令牌一人一个，由管理员按 ERP 生成；离职/调岗立即作废。
- 看板只放内网或加 SSO，不映射公网。

---

## 十三、发给同事（可直接复制）

### 京ME / 群消息模板

```text
【自营 AI 作业中枢】自营采销的每日作业台，装上就能用：
<仓库地址 / zip 包地址>

它会做三件事：
1. 每天告诉你该做哪几项作业，按时间排好（超补 / 秒杀 / 特价 / 差评申诉 / 工具打卡 等 9 项）；
2. 每项都有 SOP，照步骤执行，不用再问口径；
3. 做完自动留痕并上报到通用看板 https://jx-selfop-board.joyapp.jd.com/ ，谁没做一眼看到。

安装（Windows，5 分钟）：
git clone <仓库地址>
cd jx-selfop-daily-hub
powershell -ExecutionPolicy Bypass -File install.ps1 -Erp <你的ERP> -Name <你的姓名> -Token <管理员给的令牌>
python scripts/jx_task.py plan

前置：Python 3.11+；Node 18+ 只有本机看板需要；京东内网登录态；
以及 blacklight / yx-mcp 两个依赖技能（缺了会标 blocked，不会瞎跑）。

看板地址已内置，不用再填 -Server；装完会自动跑 doctor 自检，
有 [fail] 按提示补齐再开工。

规矩：写平台前一定先给确认清单，你点头才提交；没有平台回读的，不算完成。
```

令牌首选让同事自己领（一人一个、按 ERP 生成、离职自动失效）：

https://jx-selfop-board.joyapp.jd.com/token

用他本人的京东身份打开，页面会显示姓名、ERP、32 位令牌和拼好的安装命令，复制粘贴即可；
不在名册的人会看到「把 ERP 发给管理员登记」，没登录会看到「请从内部门户打开」。

管理员兜底（离线发放 / 核对名单）：

```powershell
$env:JX_INGEST_SECRET = "<secret>"
python scripts/jx_task.py token --erp <同事ERP>
```

### 打包成 zip 分发

```powershell
git archive --format=zip --prefix=jx-selfop-daily-hub/ HEAD -o jx-selfop-daily-hub.zip
```

### 仓库维护者：首次上传

```powershell
git init -b main
git add -A
git commit -m "feat: 自营 AI 作业中枢（skill + 看板 + 上线版）"
git remote add origin <仓库地址>
git push -u origin main
```

推送前自查：

```powershell
git ls-files | Select-String -Pattern "_env.js|_data_client.js|_ssa_guard.js|reports.jsonl|\.pyc"
```

---

## 十四、常见问题

| 现象 | 处理 |
|---|---|
| `plan` 没有作业 | ERP 不在 `data/roster.json`，或当天没命中排期 |
| 看板全灰 | 还没有真实 `done`；先跑一位成员验证，别开演示数据当真实 |
| 上报 404 / 连不上 | 管理员服务没起或地址不对；记录留在本机，恢复后 `report` 补报 |
| 端口被占用 | 换 `--port 8090`，同步改成员 `--server` |
| PowerShell 5.1 抓 CSV 报 `NullReferenceException` | 用 `curl.exe` 或 `Invoke-RestMethod` 取原始内容，不要用 `Invoke-WebRequest` 解析 |
| Python 中文乱码 | 用 Windows Terminal / PowerShell 7；CLI 已强制 UTF-8 |
| 计划任务没触发 | 任务仅交互式；确认已登录桌面、机器未休眠，或手动跑 `daily-run.ps1` |
| 成员换人 / 调岗 | 改 `data/roster.json` 与 `tasks.json` 的 `owners`，重新分发 |
| `plan` 里没有超补 / 秒杀 / 特价 | 重跑 `install.ps1 -Erp <本人ERP> -Name <姓名>`，`init` 会把负责人作业自动指向本人；仍缺再查 `tasks.json` 的 `owners` |
| 线上看板打不开 | 门户白名单没加人，或 SSO 未登录；找管理员在「配置权限」里加 |

---

## 十五、许可

MIT，见 `LICENSE`。内部业务 SOP 与平台参数仅限团队内部使用，请勿外发。
