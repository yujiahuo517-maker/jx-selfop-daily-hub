# 状态模型与看板口径

## 一、记录结构

每次 `start` / `done` / `fail` / `skip` 追加一条 JSONL 记录到 `%USERPROFILE%\.jx-selfop\reports.jsonl`：

```json
{
  "id": "2026-11-19:super_subsidy:wangwu3",
  "date": "2026-11-19",
  "task_id": "super_subsidy",
  "task_name": "超级补贴自动提报",
  "priority": "P0",
  "erp": "wangwu3",
  "name": "王五",
  "status": "done",
  "summary": "候选12/预检10/回读新增8/异常0",
  "metrics": { "候选数": "12", "预检通过数": "10" },
  "evidence": { "回读": "applied_sku_ids 前后差" },
  "url": "",
  "error": "",
  "duration_sec": 1830,
  "source": "skill",
  "created_at": "2026-11-19T18:50:03+08:00",
  "updated_at": "2026-11-19T19:20:33+08:00"
}
```

同一 `date + task_id + erp` 以 `updated_at` 最新一条为准；历史记录不删除，便于审计。

## 二、应完成作业的计算

对某一天 D：

1. 遍历 `data/tasks.json`。
2. 排期命中：`daily` 每天命中；`weekly` 在 `weekday_iso` 命中；`periodic` 默认不进入每日应完成口径。
3. 展开人员：`scope=all` 展开为 `data/roster.json` 里的全体成员；`scope=owner` 展开为 `owners` 中的人。
4. 得到 `(task, person)` 对，即为当天应完成清单。

示例（设名册 N 人）：

- 全员项 2 个 × N 人 = 2N：每日工具打卡、差评治理。
- 负责人专属项：超级补贴、秒杀、特价，只落在 `owners` 指定的人身上。
- 应完成项合计 = 2N + 当日命中作业的负责人数。
- `official_discount_mark` / `aftersale_recovery` / `newcomer_price` 等 `count_in_rate=false` 的作业**只落库留痕，不计入完成率与看板矩阵**（2026-11-20 起口径；原 `ad_profit_guard`、`spu_daily_drop_board` 已于 2026-11-24 下线）。
- 特价与便宜包邮默认只在周一命中。

## 三、完成率

```
完成率 = (done + skipped) / expected × 100%
```

- 失败、阻塞、进行中、未开始都不计入完成。
- 只有 `count_in_rate !== false` 的作业进入 expected；`仅记录`类作业照常 `done`/`fail` 留痕，但不影响完成率。
- 单人完成率 = 该人 done+skipped / 该人 expected。
- 任务完成率 = 该任务在所有应执行人上的 done+skipped / expected。
- `skipped` 必须有原因；管理员可抽查原因是否成立。

## 四、逾期

- 历史日期：状态不是 `done` / `skipped` 即逾期。
- 当天：超过 `schedule.time + grace_minutes` 仍未完成即逾期。
- `periodic` 作业没有固定时间，不计逾期。
- 宽限时间在 `data/tasks.json` 的 `schedule.grace_minutes` 调整。

## 五、上报协议

成员配置 `server` 后，`done` / `fail` 会自动 `POST {server}/api/report`，body 即上面的记录 JSON。

服务端行为：

- 校验 `task_id` 存在、`erp/date/status` 非空、状态枚举合法。
- 追加写入 `data/reports.jsonl`，不覆盖历史。
- 读取时按 `date:task:erp` 取 `updated_at` 最新一条。
- 离线失败不丢数据：本地 JSONL 保留，`synced.json` 记录已上报版本，恢复后 `report` 只补未上报版本。

## 六、防作弊设计

1. `done` 至少要有 `--summary` / `--metric` / `--evidence` / `--url` 之一，CLI 直接拒绝空完成。
2. 失败必须写 `--error`，不能用完成掩盖。
3. 管理员手工修正写 `source=manual-admin`，看板保留来源，便于审计。
4. 所有记录保留原始时间戳和摘要，不提供「删除记录」命令。
5. 成员只能上报自己的 ERP；管理员看板不提供代执行接口。

## 七、CSV 字段

导入/导出字段：`日期, 任务ID, 任务名称, 优先级, 姓名, ERP, 状态, 摘要, 异常, 更新时间`。

导入时兼容中文表头与英文表头（`date/task_id/name/erp/status/summary`），状态可写中文（已完成/失败/已跳过）。
