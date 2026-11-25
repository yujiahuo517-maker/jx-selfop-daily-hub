# 06 品类新差评删除

- task_id：`bad_review_appeal`
- 优先级：P0
- 执行人：采销全员（只删本人名下类别新差评）
- 流程负责人：全员各自负责
- 排期：每天 10:10
- 依赖：本机「京东采销自动化助手_直接提报」程序目录

## 一次性配置（每台机器做一次）

1. 找启动器：在 `C:\` 和 `D:\` 下按文件名搜索 `京东采销自动化助手_直接提报.bat`，优先桌面；选桌面那份为 `LAUNCHER`，不修改它。
2. 确认程序目录 `APPDIR`：从 `LAUNCHER` 所在目录向下最多两级，查找同时含 `main.py` 和 `requirements.txt` 的文件夹。
3. 每天动作等价于：手动打开 LAUNCHER → 模式输入 `2`（差评/中评申诉快速提报）→ 页数输入 `0`（不限页数，全部页处理）。
4. **禁止用管道回显 2 和 0 喂 bat**：`cmd` 的 `set /p` 会一次吞掉整段管道输入，第二个输入读到空值，已验证会退化成只跑 1 页。

正确调用：

```bat
"%APPDIR%\.venv\Scripts\python.exe" main.py --fast-chaping --real-submit --max-pages 0
```

5. 在 LAUNCHER 同目录新建 `京东采销自动化助手_每日1010自动执行.bat`：
   - `set APPDIR` / `LOG=APPDIR\logs\auto_submit_1010.log` / `PY=APPDIR\.venv\Scripts\python.exe`；
   - `PY` 或 `main.py` 不存在时写 ERROR 日志并 `exit /b 1`，不自动装依赖；
   - 默认 `REAL=--real-submit`；第一个参数是 `dryrun` 时 `REAL` 为空；
   - `cd /d "%APPDIR%"`，`set PYTHONIOENCODING=utf-8`；
   - 执行 `"%PY%" main.py --fast-chaping %REAL% --max-pages 0 >> "%LOG%" 2>&1`，记录 START/END 与 `%errorlevel%`；
   - 文件按 ANSI(GBK) 保存，路径含中文时不要用 UTF-8 写 bat。
6. 注册计划任务：
   - 任务名固定 `京东采销自动化助手_每日1010`；
   - 动作 `cmd.exe /c ""<bat 路径>""`，起始目录 = LAUNCHER 所在目录；
   - 触发器每天 10:10；
   - 设置：允许电池供电启动、错过则尽快补跑、执行时限 2 小时、同一实例不并发；
   - 身份：当前登录用户，交互式（LogonType Interactive），普通权限；
   - 注册后 `Get-ScheduledTask` / `Get-ScheduledTaskInfo` 回读，确认 `State=Ready` 且 `NextRunTime` 是下一个 10:10。

## 验收（必须做）

1. 运行 bat `dryrun`：退出码 0；日志出现 `levels: 差评, 中评` 与 `dry_run: True`；生成 `logs\fast_chaping_*.json`。
2. 确认 `APPDIR\user_data\chrome_profile\Default\Network\Cookies` 存在且修改时间较新（说明登录态在里面）。

## 每日完成判定

- 计划任务 `State=Ready`，`NextRunTime` 正确；
- 当天真实执行日志有 START/END，`errorlevel=0`；
- 申诉结果JSON/日志留存；
- cookie 过期时手动跑一次原 bat 登录，并在当天记录中说明。

## 禁止事项

- 不改原 `京东采销自动化助手_直接提报.bat` 和程序文件；
- 不执行 `--real-submit` 试跑；
- 不创建超过一个计划任务；
- 不用 UTF-8 写 bat。

## 完成留痕

```powershell
python scripts/jx_task.py done --task bad_review_appeal `
  --summary "计划任务Ready，next=2026-11-20 10:10；今日申诉12条，失败0" `
  --metric dryrun退出码=0 --metric 申诉条数=12 --metric 失败数=0 `
  --evidence 日志="<APPDIR>\logs\auto_submit_1010.log" --evidence cookie=近期修改
```
