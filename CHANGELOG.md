# 变更记录

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
- `data/tasks.json` 与 `cloud-app/data/tasks.json` 保持一致（9 项）。
