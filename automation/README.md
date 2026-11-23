# automation：每日自动执行

两个脚本，只做「生成执行单 + 留痕入口」，**不做平台写操作**。

| 脚本 | 作用 |
|---|---|
| `daily-run.ps1` | 调用 `python scripts/jx_task.py plan --save` 生成当日执行单 Markdown，写运行日志；可选后台启动本地看板 |
| `register-task.ps1` | 用 `schtasks` 把 `daily-run.ps1` 注册成每天固定时间的 Windows 计划任务；`-Unregister` 移除 |

## 用法

```powershell
# 1. 先手动验证一次
powershell -ExecutionPolicy Bypass -File automation\daily-run.ps1 -Erp <本人ERP>

# 2. 注册每天 08:55 自动生成（顺带启动本地看板）
powershell -ExecutionPolicy Bypass -File automation\register-task.ps1 -Erp <本人ERP> -Time 08:55 -StartDashboard

# 3. 查看 / 移除
schtasks /Query /TN JX-Selfop-Daily /FO LIST
powershell -ExecutionPolicy Bypass -File automation\register-task.ps1 -Unregister
```

产出：

- 执行单：`%USERPROFILE%\.jx-selfop\daily\<日期>-plan.md`
- 运行日志：`%USERPROFILE%\.jx-selfop\logs\daily-<时间戳>.log`、`last-run.json`

## 边界

- 计划任务只能生成清单、按时间排序、标出下一个动作和留痕模板；**活动提报、广告停投、打卡、申诉等写操作必须由人在会话里按 SOP 执行并回读**。
- 机器休眠或关机时任务不执行；唤醒后手动跑一次 `daily-run.ps1` 补生成，历史记录不会丢。
- 任务以「仅交互式」注册（`Logon Mode: Interactive only`），需要本人登录桌面才触发；长期不登录的日子不会自动生成。
- 需要记录「今天做不了」时只能写 `fail --status blocked`（写明缺什么），不能写 `done`。
- 管理员侧的准时率看的是 `done/skipped` 记录，不是计划任务是否跑过。
