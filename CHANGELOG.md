# 变更记录

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
