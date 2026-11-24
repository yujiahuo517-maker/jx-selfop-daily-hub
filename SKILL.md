---
name: jx-selfop-daily-hub
description: 京喜自营采销「AI 作业中枢」：把超级补贴、秒杀、特价、每日工具打卡、差评申诉等 9 项固定作业汇总为一个入口，按本人 ERP 生成每日执行单、逐个按 SOP 执行并留痕，再汇总到通用作业完成看板 https://jx-selfop-board.joyapp.jd.com/ ；支持安装自检（doctor）与注册 Windows 计划任务每日常规生成执行单。用户说「今天有什么作业」「每日执行单」「跑自营作业」「每天自动跑一遍」「自营作业看板」「看大家作业完成情况」「看板怎么装/怎么发给同事」「这套工具能做什么、边界在哪」「超级补贴/秒杀/特价/差评/工具打卡」时使用。也用于把技能分发给团队成员并配置统一上报地址。
---

# 自营 AI 作业中枢（jx-selfop-daily-hub）

一个入口，管住 9 项自营固定作业：**知道今天做什么 → 按 SOP 执行 → 执行即留痕 → 管理员看完成**。

本技能来自《自营AI能力研发进展.pdf》，把原本分散在各人手里的提示词合并成统一作业台。PDF 原件与逐项拆解见 `references/task-matrix.md`。

## 先记住三条铁律

1. **只用本人登录态和业务权限**。不借号、不跨采销查数、不替别人接受协议或提交。
2. **没有回读就不算完成**。平台受理、接口 success、提交回执都不是成功判据；必须按各 SOP 的回读口径确认。
3. **没有留痕就不算完成**。执行后用 `done` 写入摘要/指标/证据；失败必须写平台原始原因。禁止空口标完成。

## 快速开始

```powershell
cd jx-selfop-daily-hub
python scripts/jx_task.py init --erp <本人ERP> --name <姓名>   # 看板地址默认已是通用看板
python scripts/jx_task.py plan
python scripts/jx_task.py today
```

`--erp` 填**本人 ERP**；`--server` 默认就是通用看板 `https://jx-selfop-board.joyapp.jd.com`，一般不用填。
`data/tasks.json` 的 `owners` 里 `zhangsan1` / `lisi2` 是**示例占位（非真人）**：`init` 会把负责人专属
作业自动指向本人，并把本人写进 `data/roster.json`，所以装完就能看到超补 / 秒杀 / 特价。

`plan` 是每日主入口：按计划时间排出今天该做的作业，带 SOP 路径、依赖、完成标准、留痕模板和「下一个动作」。
`today` 是同一份数据的简版列表（兼容旧用法）。每项作业都有固定 `task_id`，SOP 在 `references/sop/`。

### 每项作业的执行闭环

```powershell
# 1. 开始
python scripts/jx_task.py start --task super_subsidy

# 2. 按 references/sop/01-super-subsidy.md 执行，完成平台回读

# 3. 完成留痕（至少一项证据）
python scripts/jx_task.py done --task super_subsidy `
  --summary "候选12/预检10/回读新增8/异常0" `
  --metric 候选数=12 --metric 预检通过数=10 --metric 回读新增数=8 `
  --evidence 回读=applied_sku_ids 前后差
```

失败、阻塞、当天不适用分别用 `fail` / `skip`，不要用 `done` 掩盖：

```powershell
python scripts/jx_task.py fail --task bad_review_appeal --error "提报程序返回 401，Cookie 失效（原始响应已保存）"
python scripts/jx_task.py skip --task tejia_weekly --reason "本周活动停报，已由负责人确认"
```

## 每日自动执行（计划任务）

确定性部分交给脚本，写操作仍由人在会话里完成。

```powershell
# 手动验证一次：生成执行单 + 写日志
powershell -ExecutionPolicy Bypass -File automation\daily-run.ps1 -Erp <本人ERP>

# 注册每天 08:55 自动生成（顺带起本地看板）
powershell -ExecutionPolicy Bypass -File automation\register-task.ps1 -Erp <本人ERP> -Time 08:55 -StartDashboard

# 查看 / 移除
schtasks /Query /TN JX-Selfop-Daily /FO LIST
powershell -ExecutionPolicy Bypass -File automation\register-task.ps1 -Unregister
```

- 产出：`%USERPROFILE%\.jx-selfop\daily\<日期>-plan.md`、`logs\daily-*.log`、`logs\last-run.json`。
- 只做清单与提醒：不会自动提交活动、停投广告、打卡、申诉。
- 机器休眠/关机时任务不执行，唤醒后手动跑一次 `daily-run.ps1` 补生成，历史记录不丢。
- 计划任务跑过 ≠ 作业完成；看板只认 `done` / `skipped` 记录。

## 今日执行顺序（默认）

1. 运行 `plan`：按计划时间排序（无固定时间的排最后，同一时段 P0 优先），先做最早到期的一项。
2. 到 `references/sop/` 读对应 SOP，**先确认前置条件**（登录态、活动配置、数据日期、本人商品范围）。
3. 调用对应依赖技能/工具执行；平台要求 dry-run 的必须先预演。
4. 回读验收，记录关键数字和证据链接。
5. `done` 或 `fail`，有管理员采集地址时自动上报。
6. 一天结束运行 `status` 自查；管理员运行 `summary` 或打开看板。

## 9 项作业索引

| task_id | 作业 | 优先级 | 负责人 | 排期 | SOP |
|---|---|---|---|---|---|
| `super_subsidy` | 超级补贴自动提报 | P0 | 张三 | 每天 18:50 | [01](references/sop/01-super-subsidy.md) |
| `flash_sale` | 秒杀提报 | P0 | 张三 | 每天（T+3～T+5） | [03](references/sop/03-flash-sale.md) |
| `tejia_weekly` | 特价提报与后续券池评估 | P0 | 张三 | 每天 11:30（需采销确认） | [04](references/sop/04-tejia-weekly.md) |
| `daily_tool_checkin` | 每日工具使用与双表打卡 | P0 | 全员 | 每天 11:00 | [05](references/sop/05-daily-tool-checkin.md) |
| `bad_review_appeal` | 差评 / 中评申诉治理 | P0 | 全员 | 每天 10:10 | [06](references/sop/06-bad-review-appeal.md) |
| `cheap_free_shipping` | 特价便宜包邮 5.9-5 / 4.9-4 | P1 | 张三 | 按周（默认周一） | [08](references/sop/08-cheap-free-shipping.md) |
| `official_discount_mark` | 官方直降打标 & 国补 & 9 折 | P1 | 待指派 | 按通知 | [09](references/sop/09-official-discount-mark.md) |
| `aftersale_recovery` | 售后 & 未合单 & 直赔 & 运费回收 | P1 | 待指派 | 按通知 | [10](references/sop/10-aftersale-recovery.md) |
| `newcomer_price` | 新人价 SKU 提报 | P1 | 待指派 | 按通知 | [11](references/sop/11-newcomer-price.md) |

### 固定资源位（2026-11-20 起，本机实跑校准）

| 作业 | 资源位 ID（resourceId） | 接口 areaId | 活动编号 | 场域 |
|---|---|---|---|---|
| 超级补贴 `super_subsidy` | **2935** | **319901** | `101664799`（bybt 配置） | 京喜自营（`applySkuType=3`） |
| 秒杀 `flash_sale` | **2858** | **313601** | `101666814`（当前场次） | 京喜自营（`applySkuType=3`） |
| 特价（前置池）`tejia_weekly` | **5177** | **38801203** | `101766465`（时长 30 天，库存 5000） | 京喜自营 |
| 特价后续券池（只评估） | **7186** | **42839704** | `101857088`（5.9-5 / 4.9-4） | 京喜自营 |

**2935 / 2858 是 resourceId，不是 areaId**：接口传 `areaId=2935` 会返回「开放收品池未发布」、传 `areaId=319901` 给秒杀会返回「获取时间信息失败」。三个值都已写入 `data/tasks.json`（`resource_id` / `area_id` / `activity_id`），`plan` 会打印完整链路。

秒杀回读按 **SKU + batchId** 比对；超补回读查 `/apply/bid/applied/page` 的 **`activityProgressStatus=0`**（新报名档位）。

特价 `requires_confirm=true`：**提交前必须给采销出确认表**（报哪些 SKU / 报名价 / 库存），
确认后才允许 `table_apply`；报名价取建议价，不超额、不降价报入。后续券池只做评估，不直接报名。

> 09/10/11 在 PDF 中只有作业名称，没有负责人和操作细则。**禁止自行编造流程**；先补 `references/sop/` 与 `data/tasks.json` 的 owners，再启用。

## 管理员看板

管理员在一台团队可访问的电脑上运行：

```powershell
python scripts/jx_task.py serve --port 8080
# 浏览器打开 http://127.0.0.1:8080/
```

- 首页 `/` 是**简洁矩阵版**：一屏名册内成员 × 各自今日计入项（全员项按人展开，负责人专属项只落在本人名下；周一含便宜包邮），绿=完成、蓝=进行中、红=失败、灰=未开始、浅灰=不适用；顶部只有日期和合计完成率。`count_in_rate=false` 的作业（官方直降打标 / 售后回收 / 新人价这类待补 SOP 项）只留痕、不上矩阵。
- 需要完成率明细、失败原因、14 天趋势、人员明细和 CSV 时开 `/full.html`（完整版）。
- 采集接口：`POST http://<管理员IP>:8080/api/report`，由成员技能自动调用。
- 成员只需在初始化时填 `--server http://<管理员IP>:8080`；断网时记录留在本机，恢复后 `report` 补报。
- 演示预览：`python scripts/jx_task.py serve --port 8080 --demo`，或页面勾选「演示数据」。
- 管理员可在格子详情里手工修正状态，记录会标记 `manual-admin`，不覆盖历史。
- 需要发布成外网可访问的只读页：`node dashboard/export-static.js --entry simple --out index.html --days 1`（首页矩阵版）、`--entry full --out full.html --days 14`（完整版）、加 `--demo` 出演示页；发布时必须加 `--no-export`，再按 `references/distribution.md` 第八节发布到想象力平台。
- **只有本机实时版能收上报**：`serve` 起的服务才有 `POST /api/report`、页面 60 秒自动刷新、格子可手工改状态；发布出去的静态快照是只读的，不能上报、不是实时。

### 管理员每天看什么

1. 先看顶部：今日完成率、失败/阻塞、逾期未完成、有留痕人数。
2. 再看「今日完成矩阵」：谁缺哪项，一眼定位；点击格子看摘要/指标/证据。
3. 看「需要关注」：失败原因和逾期项优先处理。
4. 周会看「近 14 天趋势」和「人员明细」，区分能力问题与流程问题。

## 状态口径

| 状态 | 含义 | 是否计入完成 |
|---|---|---|
| `done` | 已按 SOP 执行并回读验收 | 是 |
| `skipped` | 当天确实不适用，且写明原因 | 是（不计失败） |
| `running` | 已开始、未收口 | 否 |
| `failed` | 执行失败，保留原始原因 | 否 |
| `blocked` | 被登录/权限/配置阻塞，需人工处理 | 否 |
| `pending` | 没有任何记录 | 否 |

逾期 = 超过计划时间 + 宽限仍未完成；历史日期未完成一律视为逾期。

## 分发与安装

两种方式二选一：

- 直接给成员 GitHub 地址：`git clone https://github.com/yujiahuo517-maker/jx-selfop-daily-hub.git`
- 或把打包好的 zip 解压，在目录里运行：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Erp <ERP> -Name <姓名> -Token <管理员给的令牌>
```

`install.ps1` 的动作：检查 Python 版本（3.10+，建议 3.11+）→ 探测 Node（18+，仅本机看板需要）→
复制到 `%USERPROFILE%\.joycode\skills\jx-selfop-daily-hub` → 初始化本人配置（看板地址默认
`https://jx-selfop-board.joyapp.jd.com`）→ 自动跑一次 `doctor` 自检。

安装时自动完成三件自愈动作，不需要手工改 JSON：

1. 把本人写进 `data/roster.json`（覆盖安装不会丢名册）；
2. 把负责人专属作业的示例占位 `owners` 改成本人 ERP（否则新成员看不到超补 / 秒杀 / 特价）；
3. 缺上报令牌时给出提示，本地留痕照常可用。

成员数据在 `%USERPROFILE%\.jx-selfop\`，卸载技能不丢历史。

装完自查：

```powershell
python scripts/jx_task.py doctor   # Python / Node / 名册 / 作业清单 / 看板可达 / 令牌 / 依赖技能
python scripts/jx_task.py plan
```

分发前管理员必须确认：

- 通用看板 `https://jx-selfop-board.joyapp.jd.com/` 可打开，成员在门户白名单里。
- 每人一个上报令牌（`token --erp <ERP>` 生成，`INGEST_SECRET` 不外发）。
- 涉及写平台的 SOP，成员已安装并登录 `blacklight` / OSW 等依赖。

## 依赖与降级

| 作业 | 依赖 | 不可用时的处理 |
|---|---|---|
| 超级补贴 / 秒杀 / 特价 / 便宜包邮 / 新人价 | `blacklight`（yx / bybt / jzt / osw / EasyBI） | 停止写操作，`fail --status blocked`，不手拼接口 |
| 每日工具打卡 | 浏览器 + JoySpace 登录态 | 未实际提问/未保存成功即 `fail`，不得虚假打卡 |
| 差评治理 | 本机 `京东采销自动化助手_直接提报` | 缺程序或 cookie 过期时 `fail`，附缺失路径/日志 |
| 看板采集 | 管理员 Node 服务 | 离线可用，恢复后 `report` 补报 |

## 强制边界

- 不自动修改商品标题、京东价、券促、上下架状态；不自动退出活动。
- 不把平台受理、接口 success、提交回执当作最终成功；以 SOP 指定回读为准。
- 不编造缺失数据；接口失败/字段缺失就写「未取到」。
- 不跨账号、不借用他人登录态、不替他人接受协议。
- 09/10/11 未补 SOP 前只允许登记和提醒，不允许执行猜测性写操作。
- 管理员手工修正只用于纠错，不作为日常完成手段；看板会保留 `manual-admin` 来源。
- 完整能力清单与明确做不到的事见 `references/capability-boundary.md`；对外承诺前先读它。

## 相关文件

- `references/task-matrix.md`：PDF 作业的完整映射、负责人、排期、成熟度（默认下发 9 项，2 项已下线）。
- `references/status-model.md`：状态、指标、上报与看板计算口径。
- `references/distribution.md`：分发、采集服务部署、权限与安全。
- `references/capability-boundary.md`：这套工具能做什么、做不到什么、什么时候必须找人。
- `automation/`：每日常规执行单生成与 Windows 计划任务注册脚本。
- `data/tasks.json`：唯一任务注册表；改排期/负责人只改这里。
- `data/roster.json`：本机名册（出厂空，`init` 写入本人）；`roster.example.json` 是团队矩阵示例。
- `发给同事.md`：一页纸的同事安装说明，可直接转发。
- `dashboard/`：零依赖看板（Node + 原生前端）。
