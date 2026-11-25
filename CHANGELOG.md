# 变更记录

## 2026-11-25 · v1.4 收敛为 5 项每日作业 + 提交即完成 + 09:30 开工

**作业清单（9 项 → 5 项）**

- 每日固定作业只剩 5 项：`super_subsidy`（超级补贴）、`flash_sale`（秒杀）、`tejia_weekly`（特价）、
  `daily_tool_checkin`（AI 工具使用 + 双表打卡）、`bad_review_appeal`（品类新差评删除）。
- 5 项全部改为**全员作业**（`scope=all`、`owners=[]`）：每人都有，各人只处理本人名下 SKU。
- 不提报新人价；不做广告入池出池 / 广告止损看板 / SPU 骤降。
- 便宜包邮 / 官方直降打标 / 售后回收 / 新人价 4 项移入 `references/sop/_ondemand/`：
  **不是每日作业**，用户明确唤起才执行，不进 `plan`、不计完成率。
- 超级补贴不再等 18:50：按采销确认可直接跑，平台若提示未到报名时间记 `blocked` 并写原始报错。

**完成口径**

- 采销用技能跑完并**成功提交即 `done`**；提交回执 / 数量 / 失败明细写进 summary。
- 平台回读从「完成门槛」降为「建议记录」；读不到就写「回读未取到」，禁止编造。
- 没有提交回执的作业（差评删除、AI 工具提问）仍要写实际执行结果。

**开工时间与频道页限制规则**

- 默认开工时间改为 **09:30**（`automation/register-task.ps1` 默认 `-Time 09:30`、`init` 写入 `start_time`）。
- 新增 `python scripts/jx_task.py config`：`--start-time` / `--task <id> --time` / `--note` / `--disable/--enable`，
  写本机 `%USERPROFILE%\.jx-selfop\overrides.json`，不动仓库文件、重装不丢。
- `data/tasks.json` 每项新增 `constraints`（resourceId / areaId / 场次 / 毛利门槛 / 审核窗口），`plan` 原样打印。

**名册**

- `data/roster.json` 与 `cloud-app/data/roster.json` 只保留已确认 ERP（huoyujia6 霍煜嘉、yangxuemeng1 杨雪蒙）；
  其余 4 人（杨浩、刘富瑶、刘珍珍、罗咏心）记入 `data/roster.pending.json` 待补 ERP，**不猜拼音**。
- 成员本人跑 `install.ps1` 或在 `/token` 领令牌即自动入册，管理员不必改名册重部署。
- `cloud-app/data/tasks.json` 与根目录同步为 5 项，看板矩阵按 5 项 × 名册展开。

## 2026-11-25 · v1.3 安装即回读使用情况

- 新增使用心跳：`scripts/jx_task.py` 每条命令执行后自动 `POST /api/usage`（本人令牌鉴权），
  看板姓名行显示「今日已用 次数/最近时间」，KPI 增加「在用人数」。心跳只表示在用，**不计入完成率**。
- 心跳失败不阻塞业务：写入 `%USERPROFILE%\.jx-selfop\usage_offline.jsonl`，下条命令先补发；
  `doctor` 新增「使用心跳」一行（版本 / 最近同步 / 积压条数）。
- `/api/token` 自助领取改为**自动入册**：不在名册的本人 ERP 领取即登记，不再返回 403 让同事找管理员；
  看板名册与完成率按名册动态展开，新人不需改名册重部署。
- `/token` 页安装命令升级为整段可复制（`git clone` → `cd` → `install.ps1`，已填好本人 ERP / 姓名 / 令牌）。
- `deps` 心跳字段修正为字符串数组（此前被序列化成对象）。

## 2026-11-25 · v1.2 令牌自助领取

- 新增 `GET /api/token` + 页面 `/token`：同事用本人京东身份打开
  https://jx-selfop-board.joyapp.jd.com/token 就能领到自己的上报令牌（含姓名、ERP 和拼好的安装命令），
  不用管理员手工发。
- 只返回「当前 SSO 身份本人」的那一个令牌，不支持指定他人：未登录 401、不在名册 403、未配密钥 503。
- 令牌算法不变（HMAC-SHA256(secret, ERP) 前 32 位），与 `python scripts/jx_task.py token --erp` 逐字节一致；
  `INGEST_SECRET` 仍只存在于平台 `deployEnv`，页面只回令牌、不回密钥。
- 管理员 `token --erp` / `token --all` 保留为离线兜底。

## 2026-11-24 · v1.1 可分发版

**作业清单**

- 下线 `ad_profit_guard`（广告入池出池 / 广告止损）与 `spu_daily_drop_board`（SPU 每日骤降），
  默认清单 11 项 → **9 项**（P0 5 项 + P1 4 项）。SOP 移入 `references/sop/_retired/`，附恢复说明。

**安装与分发（本次重点）**

- `install.ps1`：新增 Python 版本校验（3.10+，建议 3.11+）、Node 探测（18+，仅本机看板需要）、
  安装结束自动跑 `doctor` 自检；看板地址默认 `https://jx-selfop-board.joyapp.jd.com`，成员不用再填 `-Server`。
- `init` 三件自愈：把本人写进 `data/roster.json`（修复覆盖安装丢名册）、把负责人专属作业的示例占位 `owners`
  改成本人（修复新成员看不到超补 / 秒杀 / 特价）、缺令牌时明确提示。
- 新增 `python scripts/jx_task.py doctor`：Python / Node / 名册 / 作业清单 / 看板可达 / 上报令牌 / 依赖技能一次看清。
- `data/roster.json` 出厂为空（每人只放本人），另留 `data/roster.example.json` 供管理员做团队矩阵。
- 新增 `发给同事.md`：一页纸安装说明，可直接转发；README 群消息模板同步更新。

**口径**

- 看板矩阵按名册展开，不再写死 7 人；`count_in_rate=false` 的作业只留痕不上矩阵。
- `data/tasks.json` 与 `cloud-app/data/tasks.json` 保持一致（v1.4 起为 5 项）。
