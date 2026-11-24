# 已下线 SOP

以下 SOP 对应的作业已从默认作业清单移除（2026-11-24），文件仅作历史留存，plan / today 不再调度：

- 02-ad-profit-guard.md — 广告入池与出池监控（ad_profit_guard）
- 07-spu-daily-drop-board.md — SPU 每日骤降 + 机会看板（spu_daily_drop_board）

如需恢复：把 SOP 移回上级目录，并在 data/tasks.json 中补回对应作业条目（id 与 seq 保持不变），
同时把 count_in_rate 设为 false，避免影响完成率与看板矩阵。
