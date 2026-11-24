# 分发、部署与管理员运维

## 一、分发物

把整个 `jx-selfop-daily-hub/` 打包发给成员，包含：

```
jx-selfop-daily-hub/
  SKILL.md
  agents/openai.yaml
  install.ps1
  start-dashboard.ps1
  data/tasks.json          # 任务注册表（管理员统一维护）
  data/roster.json         # 本机名册（出厂空，安装时写入本人）
  scripts/jx_task.py       # 执行留痕 CLI
  dashboard/               # 零依赖看板
  references/              # 逐项 SOP 与口径（默认 9 项）
```

## 二、成员安装（每人一次）

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 `
  -Erp <ERP> -Name <姓名>   # 看板地址默认 https://jx-selfop-board.joyapp.jd.com
```

脚本动作：

1. 复制到 `%USERPROFILE%\.joycode\skills\jx-selfop-daily-hub`。
2. 写入 `%USERPROFILE%\.jx-selfop\config.json`（看板地址默认通用看板）。
3. 把本人写进 `data/roster.json`，并把负责人专属作业的 `owners` 指向本人。
4. 运行一次 `doctor` 自检（Python / Node / 名册 / 看板可达 / 令牌 / 依赖技能）。
5. 不安装任何第三方依赖；Python 3.11+ 即可，Node 只有本机看板需要。

成员每天：

```powershell
python scripts/jx_task.py today
python scripts/jx_task.py start --task <task_id>
# 执行 SOP
python scripts/jx_task.py done --task <task_id> --summary "..." --metric key=value
```

## 三、管理员部署采集看板

要求：

- 一台团队可访问的 Windows 电脑，Node.js 18+。
- 固定 IP 或稳定主机名；防火墙放通 8080/TCP（管理员 PowerShell 执行一次）：

```powershell
New-NetFirewallRule -DisplayName "JX Selfop Dashboard" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```
- 电脑不休眠；建议用计划任务开机自启。
- 只想本机查看、不开放给团队时，加 `-Bind 127.0.0.1`（等价于 `node dashboard/server.js --host 127.0.0.1`）。

启动：

```powershell
cd jx-selfop-daily-hub
node dashboard/server.js --port 8080
```

或：

```powershell
powershell -ExecutionPolicy Bypass -File start-dashboard.ps1 -Port 8080
```

验收：

1. 管理员本机打开 `http://127.0.0.1:8080/`。
2. 成员电脑打开 `http://<管理员IP>:8080/`。
3. 成员运行 `python scripts/jx_task.py report`，看板出现该成员记录。
4. 需要线下表格时用看板「导出 CSV」，改完用 `python scripts/jx_task.py import --file x.csv` 回导（中文状态自动映射，重复记录按 日期+作业+ERP 去重）。
5. `POST /api/report` 返回 `{"ok":true}`。

## 四、数据与备份

- 采集端：`data/reports.jsonl`，一行一条，只追加。
- 成员端：`%USERPROFILE%\.jx-selfop\reports.jsonl`，离线积压。
- 每日备份：复制 `data/reports.jsonl` 到备份目录，按日期命名。
- 迁移：把 `data/reports.jsonl` 带到新机器即可，无需数据库。
- 注意：`data/reports.jsonl` 是唯一采集数据，不要用演示数据覆盖；演示数据单独在 `data/demo.jsonl`。

## 五、安全边界

1. 采集接口只接受状态记录，不接受平台账号、Cookie、Token、密码。
2. 看板展示的是作业完成状态与执行摘要，不展示商品经营明细中的敏感成本。
3. 成员只上报本人 ERP；如需限制，可在反向代理层加 IP 白名单和 HTTPS。
4. 建议仅在内网/办公网开放端口，不映射公网。
5. 管理员手工修正仅用于纠错，保留 `manual-admin` 来源。

## 六、与现有 JoySpace 作业表的关系

团队现有的 `jx-homework-assigner` 作业记录表是「临时作业」台账，本技能不默认写入，避免污染。

如需把每日固定作业也同步到 JoySpace：

1. 在 `config.json` 增加 `joyspace.page_id`、`sheet_id`、字段映射。
2. 由执行技能的 Agent 在 `done` 后用 `joyspace_aitable_create_records` 追加一行并回读。
3. 或由管理员定期导出看板 CSV，再导入 JoySpace/Excel 汇总表。

## 七、常见问题

| 现象 | 处理 |
|---|---|
| `today` 没有作业 | 检查 ERP 是否在 `data/roster.json`，当天是否命中排期 |
| 上报 404/连接失败 | 管理员服务未启动或 IP/端口不对；记录仍在本地，恢复后 `report` |
| 看板是 0 | 未开演示且没有真实上报；先让一位成员 `report` 验证 |
| 看板端口被占用 | 换端口 `serve --port 8090`，同步修改成员 `--server` |
| Python 中文乱码 | 使用 Windows Terminal / PowerShell 7；CLI 已强制 UTF-8 输出 |
| 成员换人 | 更新 `data/roster.json` 和 `tasks.json` 的 owners，重新分发 |

## 八、发布到想象力平台（joyapp.jd.com）

看板除了在本机跑 Node 服务，还可以打成**单文件静态页**发布到想象力平台，供团队直接访问。

### 1. 装一次 imagination MCP

```powershell
npm install --prefix "$env:USERPROFILE\.joycode\mcp-servers\imagination-mcp" `
  @jd/imagination-mcp --registry=https://registry.m.jd.com --no-audit --no-fund
```

然后在编辑器 MCP 配置里注册（JoyCode 是 `~/.joycode/joycode-mcp.json` 顶层 `mcpServers`）：

```json
"imagination": {
  "command": "C:\\<node.exe 绝对路径>",
  "args": ["C:\\<用户目录>\\.joycode\\mcp-servers\\imagination-mcp\\node_modules\\@jd\\imagination-mcp\\dist\\index.js"],
  "env": {}
}
```

注册后**重启编辑器**（MCP 启动时加载），新会话即可用 `imagination_*` 工具。
鉴权读本机 JoyCode 登录态（`state.vscdb` 里的 ptKey），不需要单独发 key；
CI/headless 场景可用 `JOYCODE_PTKEY` / `JOYCODE_LOGIN_TYPE` 覆盖。
`LLM_GW_KEY` 只在用 `imagination_llm_review` 时必填。

### 2. 导出静态快照

```powershell
node dashboard/export-static.js --out dashboard-static.html            # 真实上报数据
node dashboard/export-static.js --out dashboard-demo.html --demo       # 演示数据（对外演示用）
```

产物是单个 HTML：样式、脚本、数据、CSV 全部内联，不依赖 Node/网络。
静态页是**只读快照**：日期筛选与演示开关隐藏，导出 CSV 走内嵌数据，上报接口返回 403。

### 3. 发布与回读

1. 先调 `imagination_guide` 取当前平台的发布规范与参数（不要凭记忆拼参数）。
2. 用 `imagination_deploy` 把含 `dashboard-static.html` 的目录发布，得到 `*.joyapp.jd.com` 地址。
3. 用 `imagination_deploy_status` 回读部署状态，再用浏览器打开地址确认页面渲染正常。
4. `imagination_list_apps` 可查看本人名下已发布应用，避免重复创建。

> 静态快照只代表发布时刻的数据。要看实时完成率、失败项和手工纠错，仍然用第 3 节的 Node 看板服务。

### 4. 已发布实例（实时版）与成员上报

| 项 | 值 |
|---|---|
| appCode / projectId | `<你的应用码>` / `<你的项目 ID>` |
| 地址 | **https://jx-selfop-board.joyapp.jd.com**（全员共用，已内置为安装默认值） |
| 门户 | https://<你的门户域名>/app/<你的应用码>/ |
| 页面 | `/` 实时矩阵（60 秒刷新）· `/full.html` 完整快照 · `/demo.html` 演示快照 |
| 数据 | 平台共享分库 `jx-selfop-board.db`（2 号底座），重部署不丢 |
| 上报 | `POST /api/tunnel/report`（每人一个 HMAC 令牌）+ `POST /api/report`（浏览器 SSO 身份） |
| 访问控制 | SSO 守卫（`withGuard`）+ 门户白名单 |

成员改成上报线上（每人一次；`Token` 由管理员按 ERP 生成）：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Erp <ERP> -Name <姓名> -Token <本人令牌>
```

管理员生成令牌（`INGEST_SECRET` 只在本机 `publish/ingest-secret.txt` 与平台 `deployEnv`，不要外发）：

```powershell
$env:JX_INGEST_SECRET = "<secret>"
python scripts/jx_task.py token --all   # ERP / 姓名 / 令牌
```

上报口径：

- `done` / `fail` 会自动上报；`start` / `skip` 只写本机，补一条 `report` 即上看板。
- 服务端校验：令牌 = HMAC-SHA256(secret, ERP) 前 32 位；只能上报本人 ERP（管理员 `ADMIN_ERPS` 例外，可纠错）。
- 只接受本人当日排期内的作业；`done` 必须带 summary / metric / evidence / url 之一。
- 断网时记录留在本机，`report` 重试；页面每 60 秒刷新，也能手动刷新。

完整快照 / 演示快照如需更新（实时首页不需要重新部署）：

```powershell
node dashboard/export-static.js --entry full --out ..\publish\jx-selfop-board\public\full.html --days 14 --no-export
node dashboard/export-static.js --entry simple --demo --out ..\publish\jx-selfop-board\public\demo.html --no-export
# 再调 imagination_deploy（同一 appCode，迭代不要再传 domainPrefix / portal*）
```

两条踩过的坑：

- **导出必须加 `--no-export`**：页面里的 CSV 下载动作会命中平台静态审查的高风险「数据导出」规则，导致 `overallVerdict=block`。
- **审查要跑干净目录**：部署会在项目里注入 `_ssa_guard.js`（平台自己的守卫），直接审原目录会被它误判 `block`；先复制 `server.js` / `package.json` / `public/` 到临时目录再 `imagination_static_review`。
