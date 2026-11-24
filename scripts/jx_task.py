#!/usr/bin/env python3
"""自营 AI 作业中枢 - 本地执行与状态留痕 CLI（仅标准库）。

设计目标：
1. 每位采销在自己的机器上运行，使用本人登录态执行作业；
2. 每项作业开始/完成/失败都写入本地 JSONL，可离线积压；
3. 配置管理员采集地址后，一条命令上报，管理员看板汇总全员完成情况。
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date as Date, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HOME = Path(os.environ.get("JX_SELFOP_HOME", Path.home() / ".jx-selfop"))
CONFIG_PATH = HOME / "config.json"
REPORTS_PATH = HOME / "reports.jsonl"
SYNC_PATH = HOME / "synced.json"

# 统一的作业完成看板（全员共用，成员装完即指向这里）
DEFAULT_SERVER = (os.environ.get("JX_BOARD_URL") or "https://jx-selfop-board.joyapp.jd.com").rstrip("/")
SKILL_ROOTS = [Path.home() / ".joycode" / "skills", Path.home() / ".agents" / "skills"]

STATUS_LABEL = {
    "pending": "未开始",
    "running": "进行中",
    "done": "已完成",
    "failed": "失败",
    "blocked": "阻塞",
    "skipped": "已跳过",
}


def _stdout_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise SystemExit(f"无法读取 {path}: {exc}")


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def load_tasks() -> list[dict[str, Any]]:
    return _read_json(DATA / "tasks.json", [])


def load_roster() -> list[dict[str, Any]]:
    return _read_json(DATA / "roster.json", [])


def load_config() -> dict[str, Any]:
    return _read_json(CONFIG_PATH, {})


def save_config(cfg: dict[str, Any]) -> None:
    _write_json(CONFIG_PATH, cfg)


def resolve_person(erp: str | None, name: str | None) -> dict[str, Any]:
    roster = load_roster()
    if erp:
        for person in roster:
            if person["erp"].lower() == erp.lower():
                return person
        return {"erp": erp, "name": name or erp, "team_id": ""}
    if name:
        for person in roster:
            if person["name"] == name:
                return person
    cfg = load_config()
    if cfg.get("erp"):
        return {"erp": cfg["erp"], "name": cfg.get("name", cfg["erp"]), "team_id": cfg.get("team_id", "")}
    raise SystemExit("未指定执行人。请先运行 init --erp <ERP> --name <姓名>，或传入 --erp。")


def parse_date(value: str | None) -> Date:
    if not value:
        return Date.today()
    try:
        return Date.fromisoformat(value)
    except ValueError:
        raise SystemExit(f"日期格式应为 YYYY-MM-DD：{value}")


def expected_pairs(for_date: Date, include_periodic: bool = False) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """返回 (task, person) 列表；periodic 作业默认不进入每日应完成口径。"""
    roster = load_roster()
    pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for task in load_tasks():
        schedule = task.get("schedule", {})
        kind = schedule.get("type")
        if kind == "weekly" and for_date.isoweekday() != int(schedule.get("weekday_iso", 1)):
            continue
        if kind == "periodic" and not include_periodic:
            continue
        if task.get("scope") == "all":
            people = roster
        else:
            people = []
            for erp in task.get("owners", []):
                match = next((p for p in roster if p["erp"].lower() == erp.lower()), None)
                if match:
                    people.append(match)
                else:
                    people.append({"name": erp, "erp": erp, "team_id": ""})
        for person in people:
            pairs.append((task, person))
    return pairs


def is_tracked(task: dict[str, Any]) -> bool:
    """是否计入完成率：count_in_rate=False 的作业只落库留痕，不进完成率与看板矩阵。"""
    return task.get("count_in_rate", True) is not False


def tracked_pairs(for_date: Date, include_periodic: bool = False) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """只保留计入完成率的 (task, person) 组合。"""
    return [pair for pair in expected_pairs(for_date, include_periodic=include_periodic) if is_tracked(pair[0])]


def read_records() -> list[dict[str, Any]]:
    if not REPORTS_PATH.exists():
        return []
    records: list[dict[str, Any]] = []
    for line_no, line in enumerate(REPORTS_PATH.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            print(f"[warn] 跳过损坏的记录行 {line_no}", file=sys.stderr)
    return records


def latest_records(records: list[dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for record in records if records is not None else read_records():
        key = record_key(record)
        latest[key] = record
    return latest


def record_key(record: dict[str, Any]) -> str:
    return f"{record.get('date')}:{record.get('task_id')}:{str(record.get('erp', '')).lower()}"


def append_record(record: dict[str, Any]) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    record["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    with REPORTS_PATH.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def find_task(task_id: str) -> dict[str, Any]:
    normalized = task_id.strip().lower()
    tasks = load_tasks()
    for task in tasks:
        if task["id"].lower() == normalized:
            return task
    for task in tasks:
        if task["name"] == task_id:
            return task
    aliases = [t for t in tasks if normalized in t["name"].lower() or normalized in t["id"].lower()]
    if len(aliases) == 1:
        return aliases[0]
    raise SystemExit("未找到任务：" + task_id + "\n可用任务：" + "、".join(t["id"] for t in tasks))


def parse_kv(items: list[str] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in items or []:
        if "=" not in item:
            raise SystemExit(f"指标格式应为 key=value：{item}")
        key, value = item.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def task_status(task_id: str, erp: str, for_date: Date, latest: dict[str, dict[str, Any]] | None = None) -> str:
    latest = latest or latest_records()
    record = latest.get(f"{for_date.isoformat()}:{task_id}:{erp.lower()}")
    return record.get("status", "pending") if record else "pending"


def is_overdue(task: dict[str, Any], for_date: Date, status: str, now: datetime | None = None) -> bool:
    if status in ("done", "skipped"):
        return False
    now = now or datetime.now()
    if for_date < now.date():
        return True
    if for_date > now.date():
        return False
    schedule = task.get("schedule", {})
    if schedule.get("type") == "periodic":
        return False
    due_time = schedule.get("time")
    if not due_time:
        return False
    hour, minute = (int(x) for x in due_time.split(":"))
    due = now.replace(hour=hour, minute=minute, second=0, microsecond=0) + timedelta(
        minutes=int(schedule.get("grace_minutes", 0))
    )
    return now > due


def ensure_roster(person: dict[str, Any]) -> bool:
    """把本人写进 data/roster.json。

    重装/覆盖安装会带走手工改过的名册，这里做自愈：缺人补人、姓名不一致改名。
    返回是否发生了写入。
    """
    roster = load_roster()
    target = str(person["erp"]).lower()
    for item in roster:
        if str(item.get("erp", "")).lower() == target:
            changed = False
            if person.get("name") and item.get("name") != person["name"]:
                item["name"] = person["name"]
                changed = True
            if person.get("team_id") and item.get("team_id") != person["team_id"]:
                item["team_id"] = person["team_id"]
                changed = True
            if changed:
                _write_json(DATA / "roster.json", roster)
            return changed
    roster.append({"name": person["name"], "erp": person["erp"], "team_id": person.get("team_id", "")})
    _write_json(DATA / "roster.json", roster)
    return True


def rebind_owners(person: dict[str, Any]) -> int:
    """把负责人专属作业的示例占位 owner 换成本人。

    仓库里的 tasks.json 用 zhangsan1 / lisi2 之类占位，直接发给同事会导致对方看不到
    超补、秒杀、特价这类 owner 作业。安装时统一指向执行人，返回改动的作业数。
    scope=all（全员项）和 owners 为空（待指派）的作业不动。
    """
    tasks = load_tasks()
    changed = 0
    for task in tasks:
        if task.get("scope") == "all":
            continue
        owners = task.get("owners") or []
        if not owners:
            continue
        if [str(erp).lower() for erp in owners] == [str(person["erp"]).lower()] and task.get("owner_label") == person["name"]:
            continue
        task["owners"] = [person["erp"]]
        task["owner_label"] = person["name"]
        changed += 1
    if changed:
        _write_json(DATA / "tasks.json", tasks)
    return changed


def cmd_init(args: argparse.Namespace) -> int:
    person = resolve_person(args.erp, args.name)
    cfg = load_config()
    server = (args.server or cfg.get("server") or DEFAULT_SERVER).rstrip("/")
    cfg.update(
        {
            "erp": person["erp"],
            "name": person["name"],
            "team_id": person.get("team_id", ""),
            "server": server,
            "ingest_token": (args.token or cfg.get("ingest_token", "")).strip(),
            "installed_at": cfg.get("installed_at") or datetime.now().isoformat(timespec="seconds"),
        }
    )
    save_config(cfg)
    HOME.mkdir(parents=True, exist_ok=True)
    ensure_roster(person)
    rebound = rebind_owners(person)
    print(f"已初始化：{person['name']}（{person['erp']}）")
    print(f"本地数据目录：{HOME}")
    print(f"作业完成看板：{server}")
    if rebound:
        print(f"已把 {rebound} 项负责人专属作业指向本人（示例占位已替换）")
    if cfg.get("ingest_token"):
        print("已配置上报令牌：done/fail 会自动汇总到线上看板")
    else:
        print("未配置上报令牌：本地留痕照常，线上看板不会汇总；向管理员要本 ERP 的令牌后重跑 init --token <令牌>")
    return 0


def cmd_whoami(args: argparse.Namespace) -> int:
    cfg = load_config()
    if not cfg.get("erp"):
        print("尚未初始化，请运行：python scripts/jx_task.py init --erp <ERP> --name <姓名>")
        return 1
    if args.json:
        safe = dict(cfg)
        if safe.get("ingest_token"):
            safe["ingest_token"] = str(safe["ingest_token"])[:4] + "****"
        print(json.dumps(safe, ensure_ascii=False, indent=2))
    else:
        line = f"{cfg['name']}（{cfg['erp']}）"
        if cfg.get("server"):
            line += f" · 采集地址 {cfg['server']}"
        if cfg.get("ingest_token"):
            line += " · 已配置上报令牌"
        print(line)
    return 0


def cmd_today(args: argparse.Namespace) -> int:
    cfg = load_config()
    person = resolve_person(args.erp, args.name)
    for_date = parse_date(args.date)
    latest = latest_records()
    rows: list[dict[str, Any]] = []
    for task, owner in expected_pairs(for_date, include_periodic=args.all):
        if owner["erp"].lower() != person["erp"].lower():
            continue
        record = latest.get(f"{for_date.isoformat()}:{task['id']}:{person['erp'].lower()}")
        status = record.get("status", "pending") if record else "pending"
        rows.append(
            {
                "task_id": task["id"],
                "name": task["name"],
                "priority": task["priority"],
                "time": task.get("schedule_label"),
                "status": status,
                "overdue": is_overdue(task, for_date, status),
                "last_summary": (record or {}).get("summary", ""),
                "last_error": (record or {}).get("error", ""),
                "sop": task["sop"],
                "tracked": is_tracked(task),
            }
        )
    if args.json:
        print(json.dumps({"date": for_date.isoformat(), "person": person, "tasks": rows}, ensure_ascii=False, indent=2))
        return 0
    print(f"{person['name']} 的作业 · {for_date.isoformat()}")
    if not rows:
        print("今天没有登记在你名下的作业。")
        return 0
    tracked_rows = [row for row in rows if row["tracked"]]
    done = sum(1 for row in tracked_rows if row["status"] in ("done", "skipped"))
    extra = len(rows) - len(tracked_rows)
    print(f"进度：{done}/{len(tracked_rows)}" + (f"（另有 {extra} 项仅记录，不计完成率）" if extra else ""))
    print("-" * 78)
    for index, row in enumerate(rows, 1):
        flag = "!!" if row["overdue"] else "  "
        print(f"{flag}{index}. [{row['priority']}] {row['name']}")
        print(f"    id={row['task_id']} | {row['time']} | {STATUS_LABEL.get(row['status'], row['status'])}"
              + ("" if row["tracked"] else " · 仅记录，不计完成率"))
        if row["last_summary"]:
            print(f"    上次结果：{row['last_summary']}")
        if row["last_error"]:
            print(f"    上次异常：{row['last_error']}")
        print(f"    SOP：{ROOT / row['sop']}")
    print("-" * 78)
    print("执行前先读对应 SOP；完成后用 done 留痕：python scripts/jx_task.py done --task <id> --summary \"...\"")
    return 0


def _record_base(args: argparse.Namespace, status: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    cfg = load_config()
    person = resolve_person(args.erp or cfg.get("erp"), args.name)
    task = find_task(args.task)
    for_date = parse_date(args.date)
    record = {
        "id": f"{for_date.isoformat()}:{task['id']}:{person['erp'].lower()}",
        "date": for_date.isoformat(),
        "task_id": task["id"],
        "task_name": task["name"],
        "category": task["category"],
        "priority": task["priority"],
        "erp": person["erp"],
        "name": person["name"],
        "status": status,
        "source": "skill",
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    return record, task, person


def cmd_start(args: argparse.Namespace) -> int:
    record, task, _ = _record_base(args, "running")
    record["note"] = args.note or ""
    append_record(record)
    print(f"已开始：{task['name']}（{record['date']}）。完成后运行 done --task {task['id']}。")
    return 0


def cmd_done(args: argparse.Namespace) -> int:
    metrics = parse_kv(args.metric)
    evidence = parse_kv(args.evidence)
    if not any([args.summary, metrics, evidence, args.url]):
        raise SystemExit("完成必须留痕：至少提供 --summary、--metric、--evidence 或 --url 之一，禁止空口标记完成。")
    record, task, _ = _record_base(args, "done")
    record.update(
        {
            "summary": args.summary or "",
            "metrics": metrics,
            "evidence": evidence,
            "url": args.url or "",
            "note": args.note or "",
        }
    )
    started = latest_records().get(record["id"], {})
    if started.get("status") == "running" and started.get("created_at"):
        try:
            start_dt = datetime.fromisoformat(started["created_at"])
            record["duration_sec"] = max(0, int((datetime.now().astimezone() - start_dt).total_seconds()))
        except Exception:
            pass
    append_record(record)
    print(f"已记录完成：{task['name']} · {record['date']} · {record['name']}")
    if args.no_report:
        return 0
    cfg = load_config()
    if cfg.get("server"):
        code = cmd_report(argparse.Namespace(server=cfg["server"], all=False, quiet=True))
        if code != 0:
            print("提示：本次上报未完成，记录已保存在本机；恢复后运行 report 补报。")
        return 0
    print("提示：未配置管理员采集地址，记录仅保存在本机，可稍后运行 report 补报。")
    return 0


def cmd_fail(args: argparse.Namespace) -> int:
    record, task, _ = _record_base(args, args.status)
    record.update(
        {
            "summary": args.summary or "",
            "metrics": parse_kv(args.metric),
            "evidence": parse_kv(args.evidence),
            "error": args.error,
            "url": args.url or "",
            "note": args.note or "",
        }
    )
    append_record(record)
    print(f"已记录{STATUS_LABEL.get(args.status, args.status)}：{task['name']} · {record['date']}")
    cfg = load_config()
    if cfg.get("server") and not args.no_report:
        cmd_report(argparse.Namespace(server=cfg["server"], all=False, quiet=True))
    return 0


def cmd_skip(args: argparse.Namespace) -> int:
    record, task, _ = _record_base(args, "skipped")
    record.update({"summary": args.reason, "reason": args.reason, "evidence": parse_kv(args.evidence)})
    append_record(record)
    print(f"已跳过：{task['name']} · {record['date']} · 原因：{args.reason}")
    return 0


def _serialize_date_range(records: list[dict[str, Any]], date_from: Date, date_to: Date) -> list[dict[str, Any]]:
    return [r for r in records if date_from.isoformat() <= r.get("date", "") <= date_to.isoformat()]


def cmd_status(args: argparse.Namespace) -> int:
    for_date = parse_date(args.date)
    latest = latest_records()
    pairs = expected_pairs(for_date, include_periodic=False)
    by_person: dict[str, list[dict[str, Any]]] = {}
    for task, person in pairs:
        record = latest.get(f"{for_date.isoformat()}:{task['id']}:{person['erp'].lower()}")
        status = record.get("status", "pending") if record else "pending"
        by_person.setdefault(person["erp"], []).append(
            {"task": task, "person": person, "status": status, "record": record, "overdue": is_overdue(task, for_date, status)}
        )
    if args.json:
        print(json.dumps(by_person, ensure_ascii=False, indent=2, default=str))
        return 0
    print(f"全员作业状态 · {for_date.isoformat()}（{for_date.strftime('%A')}）")
    print("=" * 96)
    for person in load_roster():
        items = by_person.get(person["erp"], [])
        if not items:
            continue
        tracked_items = [item for item in items if is_tracked(item["task"])]
        done = sum(1 for item in tracked_items if item["status"] in ("done", "skipped"))
        failed = sum(1 for item in tracked_items if item["status"] in ("failed", "blocked"))
        print(f"{person['name']:<5}  {done}/{len(tracked_items)} 完成" + (f"  失败/阻塞 {failed}" if failed else ""))
        for item in items:
            mark = {"done": "✓", "failed": "×", "blocked": "!", "running": "…", "skipped": "-"}.get(item["status"], "·")
            if item["overdue"]:
                mark = "!"
            suffix = "" if is_tracked(item["task"]) else " · 仅记录，不计完成率"
            print(f"   {mark} {item['task']['name']}（{STATUS_LABEL.get(item['status'], item['status'])}）{suffix}")
    print("=" * 96)
    return 0


def cmd_summary(args: argparse.Namespace) -> int:
    for_date = parse_date(args.date)
    latest = latest_records()
    pairs = tracked_pairs(for_date, include_periodic=False)
    by_person: dict[str, dict[str, Any]] = {}
    by_task: dict[str, dict[str, Any]] = {}
    total = 0
    done = 0
    failed = 0
    overdue = 0
    for task, person in pairs:
        total += 1
        record = latest.get(f"{for_date.isoformat()}:{task['id']}:{person['erp'].lower()}")
        status = record.get("status", "pending") if record else "pending"
        is_done = status in ("done", "skipped")
        done += 1 if is_done else 0
        failed += 1 if status in ("failed", "blocked") else 0
        over = is_overdue(task, for_date, status)
        overdue += 1 if over else 0
        p = by_person.setdefault(person["erp"], {"erp": person["erp"], "name": person["name"], "expected": 0, "done": 0, "failed": 0, "overdue": 0})
        p["expected"] += 1
        p["done"] += 1 if is_done else 0
        p["failed"] += 1 if status in ("failed", "blocked") else 0
        p["overdue"] += 1 if over else 0
        t = by_task.setdefault(task["id"], {"task_id": task["id"], "name": task["name"], "priority": task["priority"], "expected": 0, "done": 0, "failed": 0})
        t["expected"] += 1
        t["done"] += 1 if is_done else 0
        t["failed"] += 1 if status in ("failed", "blocked") else 0
    payload = {
        "date": for_date.isoformat(),
        "total": total,
        "done": done,
        "failed": failed,
        "overdue": overdue,
        "rate": round(done / total * 100, 1) if total else 0,
        "by_person": list(by_person.values()),
        "by_task": list(by_task.values()),
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    print(f"{for_date.isoformat()} 汇总：{done}/{total} = {payload['rate']}% · 失败 {failed} · 逾期 {overdue}")
    print("-" * 72)
    for p in payload["by_person"]:
        print(f"{p['name']:<5} {p['done']}/{p['expected']}  {p['failed']} 失败  {p['overdue']} 逾期")
    print("-" * 72)
    for t in payload["by_task"]:
        print(f"[{t['priority']}] {t['name']:<32} {t['done']}/{t['expected']}")
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    cfg = load_config()
    server = (args.server or cfg.get("server") or "").rstrip("/")
    if not server:
        raise SystemExit("未配置采集地址。使用 --server http://<管理员IP>:8080 或先 init --server。")
    synced = _read_json(SYNC_PATH, {})
    latest = latest_records()
    pending = []
    for key, record in latest.items():
        if args.all or record.get("updated_at", "") > synced.get(key, ""):
            pending.append(record)
    if not pending:
        if not args.quiet:
            print("没有待上报记录。")
        return 0
    ok = 0
    for record in pending:
        body = json.dumps(record, ensure_ascii=False).encode("utf-8")
        token = str(cfg.get("ingest_token") or "").strip()
        headers = {"Content-Type": "application/json; charset=utf-8"}
        path = "/api/report"
        if token:
            path = "/api/tunnel/report"
            headers["X-Ingest-Erp"] = str(record.get("erp") or cfg.get("erp") or "")
            headers["X-Ingest-Token"] = token
        request = urllib.request.Request(
            server + path,
            data=body,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                if 200 <= response.status < 300:
                    synced[record_key(record)] = record.get("updated_at", "")
                    ok += 1
                else:
                    print(f"[warn] {record_key(record)} 上报失败：HTTP {response.status}", file=sys.stderr)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            print(f"[warn] {record_key(record)} 上报失败：{exc}", file=sys.stderr)
            break
    _write_json(SYNC_PATH, synced)
    if not args.quiet:
        print(f"上报完成：{ok}/{len(pending)}。")
    return 0 if ok == len(pending) else 2


def _http_probe(url: str, timeout: float = 6.0) -> tuple[bool, str]:
    """探活：只要服务应答（含 4xx）就算可达，网络不通才算不可达。"""
    try:
        request = urllib.request.Request(url, method="GET", headers={"User-Agent": "jx-selfop-doctor"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return True, f"HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        return True, f"HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return False, str(exc)


def cmd_doctor(args: argparse.Namespace) -> int:
    """安装自检：Python / Node / 名册 / 作业清单 / 看板可达 / 上报令牌 / 依赖技能。"""
    problems: list[str] = []

    def ok(label: str, detail: str) -> None:
        print(f"[ok]   {label}：{detail}")

    def warn(label: str, detail: str) -> None:
        print(f"[warn] {label}：{detail}")

    def bad(label: str, detail: str) -> None:
        problems.append(label)
        print(f"[fail] {label}：{detail}")

    version = ".".join(str(part) for part in sys.version_info[:3])
    if sys.version_info[:2] >= (3, 10):
        ok("Python", version)
    else:
        bad("Python", f"{version}，需要 3.10+（建议 3.11+）")

    node = shutil.which("node")
    if node:
        try:
            raw = subprocess.run([node, "-v"], capture_output=True, text=True, timeout=20).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            raw = "未知"
        major_text = raw.lstrip("v").split(".")[0]
        major = int(major_text) if major_text.isdigit() else 0
        if major >= 18:
            ok("Node", f"{raw}（仅看板需要）")
        else:
            warn("Node", f"{raw}，看板需要 18+；日常留痕不依赖它")
    else:
        warn("Node", "未安装；只有本地看板/云端部署需要，日常留痕不依赖它")

    cfg = load_config()
    if cfg.get("erp"):
        ok("执行人", f"{cfg.get('name', '')}（{cfg['erp']}）")
    else:
        bad("执行人", "未初始化，先跑 install.ps1 -Erp <ERP> -Name <姓名>")

    erp = str(cfg.get("erp", "")).lower()
    roster = load_roster()
    myself = next((p for p in roster if str(p.get("erp", "")).lower() == erp), None)
    if myself:
        ok("名册", f"{len(roster)} 人，含本人")
    else:
        warn("名册", f"{len(roster)} 人，不含本人；重跑 init 会自愈写入")

    tasks = load_tasks()
    if tasks:
        p0 = sum(1 for task in tasks if task.get("priority") == "P0")
        ok("作业清单", f"{len(tasks)} 项（P0 {p0} 项）")
    else:
        bad("作业清单", "data/tasks.json 为空")

    server = (args.server or cfg.get("server") or "").rstrip("/")
    if server:
        reachable, detail = _http_probe(server + "/api/health")
        if reachable and detail in ("HTTP 401", "HTTP 403"):
            ok("看板", f"{server}（{detail}，需登录态/令牌，属正常）")
        elif reachable:
            ok("看板", f"{server}（{detail}）")
        else:
            warn("看板", f"{server} 不可达：{detail}；本地留痕照常，恢复后跑 report 补报")
    else:
        warn("看板", "未配置采集地址，可跑 init --server <看板地址>")

    if cfg.get("ingest_token"):
        ok("上报令牌", "已配置")
    else:
        warn("上报令牌", "未配置；线上看板不会自动汇总（向管理员要本 ERP 的令牌）")

    for dep in ("blacklight", "yx-mcp"):
        found = next((str(root / dep) for root in SKILL_ROOTS if (root / dep).exists()), "")
        if found:
            ok(f"依赖技能 {dep}", found)
        else:
            warn(f"依赖技能 {dep}", "未安装；用到它的作业会被标 blocked，不会猜数")

    print("-" * 72)
    if problems:
        print("自检未通过：" + "；".join(problems))
        return 2
    print("自检通过：下一步跑 python scripts/jx_task.py plan")
    return 0


def cmd_token(args: argparse.Namespace) -> int:
    """按 INGEST_SECRET 生成成员上报令牌（线上看板校验用）。"""
    secret = args.secret or os.environ.get("JX_INGEST_SECRET", "")
    if not secret:
        raise SystemExit("需要 --secret，或设置环境变量 JX_INGEST_SECRET（与部署时的 INGEST_SECRET 一致）")

    def make(erp: str) -> str:
        return hmac.new(secret.encode("utf-8"), erp.lower().encode("utf-8"), hashlib.sha256).hexdigest()[:32]

    if args.all:
        for person in load_roster():
            print(person["erp"] + "\t" + person["name"] + "\t" + make(person["erp"]))
        return 0
    erp = (args.erp or load_config().get("erp") or "").strip()
    if not erp:
        raise SystemExit("需要 --erp，或先 init 本人信息")
    print(make(erp))
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    date_to = parse_date(args.date)
    date_from = parse_date(args.from_date) if args.from_date else date_to - timedelta(days=int(args.days) - 1)
    records = _serialize_date_range(list(latest_records().values()), date_from, date_to)
    records.sort(key=lambda r: (r.get("date", ""), r.get("erp", ""), r.get("task_id", "")))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    fields = ["date", "task_id", "task_name", "priority", "erp", "name", "status", "summary", "error", "updated_at"]
    with out.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for record in records:
            writer.writerow({key: record.get(key, "") for key in fields})
    print(f"已导出 {len(records)} 条到 {out}")
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if not path.exists():
        raise SystemExit(f"文件不存在：{path}")
    name_to_erp = {p["name"]: p["erp"] for p in load_roster()}
    task_by_name = {t["name"]: t["id"] for t in load_tasks()}
    count = 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            normalized = {str(k).strip(): (v or "").strip() for k, v in row.items() if k}
            person_name = normalized.get("姓名") or normalized.get("name") or ""
            erp = normalized.get("ERP") or normalized.get("erp") or name_to_erp.get(person_name, "")
            task_id = normalized.get("任务ID") or normalized.get("task_id") or task_by_name.get(normalized.get("任务", ""), "")
            if not erp or not task_id:
                continue
            row_date = normalized.get("日期") or normalized.get("date") or ""
            if not row_date:
                continue
            try:
                task = find_task(task_id)
            except SystemExit:
                continue
            raw_status = normalized.get("状态") or normalized.get("status") or "done"
            status_map = {
                "已完成": "done",
                "完成": "done",
                "未开始": "pending",
                "进行中": "running",
                "失败": "failed",
                "阻塞": "blocked",
                "已跳过": "skipped",
                "不适用": "skipped",
            }
            record = {
                "id": f"{row_date}:{task['id']}:{erp.lower()}",
                "date": row_date,
                "task_id": task["id"],
                "task_name": task["name"],
                "category": task["category"],
                "priority": task["priority"],
                "erp": erp,
                "name": person_name or erp,
                "status": status_map.get(raw_status, raw_status),
                "summary": normalized.get("摘要") or normalized.get("summary") or "外部表格导入",
                "source": "import",
                "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            }
            append_record(record)
            count += 1
    print(f"已导入 {count} 条记录。")
    return 0


def _demo_records(days: int = 14) -> list[dict[str, Any]]:
    import random

    random.seed(20261119)
    roster = load_roster()
    tasks = load_tasks()
    records: list[dict[str, Any]] = []
    today = Date.today()
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        for task, person in expected_pairs(day, include_periodic=False):
            roll = random.random()
            # 让演示数据的“今日”稳定呈现失败与进行中，便于管理员预览
            if offset == 0 and task["id"] == "ad_profit_guard":
                status = "failed"
            elif offset == 0 and task["id"] == "spu_daily_drop_board":
                status = "running"
            elif offset == 0 and roll < 0.35:
                continue
            elif roll < 0.08:
                status = "failed"
            elif roll < 0.13 and offset > 0:
                status = "skipped"
            else:
                status = "done"
            updated = datetime.combine(day, datetime.strptime(task.get("schedule", {}).get("time", "12:00"), "%H:%M").time())
            records.append(
                {
                    "id": f"{day.isoformat()}:{task['id']}:{person['erp'].lower()}",
                    "date": day.isoformat(),
                    "task_id": task["id"],
                    "task_name": task["name"],
                    "category": task["category"],
                    "priority": task["priority"],
                    "erp": person["erp"],
                    "name": person["name"],
                    "status": status,
                    "summary": "演示数据：已完成并回读" if status == "done" else "演示数据：平台预检失败，待人工复核" if status == "failed" else "演示数据：当日不适用",
                    "error": "演示：接口返回非 JSON / 登录态过期" if status == "failed" else "",
                    "source": "demo",
                    "created_at": updated.astimezone().isoformat(timespec="seconds"),
                    "updated_at": updated.astimezone().isoformat(timespec="seconds"),
                }
            )
    return records


def cmd_seed_demo(args: argparse.Namespace) -> int:
    records = _demo_records(args.days)
    out = DATA / "demo.jsonl"
    out.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n", encoding="utf-8")
    print(f"已生成演示数据 {len(records)} 条：{out}")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    server = ROOT / "dashboard" / "server.js"
    cmd = ["node", str(server), "--port", str(args.port)]
    if args.demo:
        cmd.append("--demo")
    print("启动看板：" + " ".join(cmd))
    return subprocess.call(cmd, cwd=str(ROOT / "dashboard"))


PRIORITY_RANK = {"P0": 0, "P1": 1, "P2": 2}


def _minutes_of_time(value: Any) -> int:
    try:
        hour, minute = (int(part) for part in str(value or "").split(":"))
    except ValueError:
        return 24 * 60
    return hour * 60 + minute


def _readiness(task: dict[str, Any]) -> tuple[str, str]:
    state = str(task.get("status", "ready"))
    if state == "needs_sop":
        return "needs_sop", "PDF 未给负责人/操作细则，须补 SOP 后启用，禁止猜测执行"
    if state == "needs_confirmation":
        return "needs_confirmation", "流程待负责人确认，未确认前只登记不执行"
    return "ready", ""


def _done_template(task: dict[str, Any]) -> str:
    metrics = [str(item) for item in (task.get("metrics") or [])][:3]
    parts = [
        "python scripts/jx_task.py done",
        f'--task {task["id"]}',
        '--summary "<结果与关键数字>"',
    ]
    if metrics:
        parts.append(" ".join(f"--metric {name}=<数值>" for name in metrics))
    parts.append("--evidence 回读=<回读方式与结果>")
    return " ".join(parts)


def build_plan(
    for_date: Date,
    person: dict[str, Any],
    include_periodic: bool = False,
    auto_only: bool = False,
    latest: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """生成当日执行单：时间顺序 + SOP + 依赖 + 可自动化标记 + 留痕模板。"""
    latest = latest if latest is not None else latest_records()
    rows: list[dict[str, Any]] = []
    for task, owner in expected_pairs(for_date, include_periodic=include_periodic):
        if owner["erp"].lower() != person["erp"].lower():
            continue
        record = latest.get(f"{for_date.isoformat()}:{task['id']}:{person['erp'].lower()}") or {}
        status = record.get("status", "pending")
        readiness, readiness_hint = _readiness(task)
        sop_relative = str(task.get("sop", ""))
        sop_path = ROOT / sop_relative if sop_relative else None
        rows.append(
            {
                "task_id": task["id"],
                "name": task["name"],
                "priority": str(task.get("priority", "")),
                "seq": int(task.get("seq", 99)),
                "time": str(task.get("schedule", {}).get("time", "")),
                "schedule_label": task.get("schedule_label", ""),
                "status": status,
                "overdue": is_overdue(task, for_date, status),
                "readiness": readiness,
                "readiness_hint": readiness_hint,
                "auto": bool(task.get("auto")),
                "auto_executable": bool(task.get("auto")) and readiness == "ready",
                "sop": sop_relative,
                "sop_path": str(sop_path) if sop_path else "",
                "sop_exists": bool(sop_path and sop_path.exists()),
                "dependencies": list(task.get("dependencies", [])),
                "completion": list(task.get("completion", [])),
                "metrics": list(task.get("metrics", [])),
                "note": task.get("summary", ""),
                "last_summary": record.get("summary", ""),
                "last_error": record.get("error", ""),
                "done_template": _done_template(task),
                "tracked": is_tracked(task),
            }
        )
    rows.sort(key=lambda row: (_minutes_of_time(row["time"]), PRIORITY_RANK.get(row["priority"], 9), row["seq"]))
    tracked_rows = [row for row in rows if row["tracked"]]
    totals = {
        "expected": len(tracked_rows),
        "done": sum(1 for row in tracked_rows if row["status"] in ("done", "skipped")),
        "record_only": len(rows) - len(tracked_rows),
        "overdue": sum(1 for row in rows if row["overdue"]),
        "auto_executable": sum(1 for row in rows if row["auto_executable"]),
        "needs_manual": sum(1 for row in rows if row["readiness"] == "ready" and not row["auto"]),
        "needs_sop": sum(1 for row in rows if row["readiness"] == "needs_sop"),
        "needs_confirmation": sum(1 for row in rows if row["readiness"] == "needs_confirmation"),
    }
    totals["remaining"] = totals["expected"] - totals["done"]
    payload: dict[str, Any] = {
        "date": for_date.isoformat(),
        "weekday": "周" + "一二三四五六日"[for_date.isoweekday() - 1],
        "person": {"erp": person["erp"], "name": person.get("name", person["erp"])},
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "totals": totals,
        "tasks": [row for row in rows if row["auto_executable"]] if auto_only else rows,
        "next_action": "",
    }
    payload["next_action"] = _next_action(payload)
    return payload


def _next_action(payload: dict[str, Any]) -> str:
    pending = [row for row in payload["tasks"] if row["status"] not in ("done", "skipped")]
    if not pending:
        return "今日作业已全部收口；运行 status 自查后即可结束。"
    head = pending[0]
    if head["readiness"] != "ready":
        return f"{head['name']}（{head['readiness']}）— {head['readiness_hint']}"
    return f"{head['name']} — 读 {head['sop']}，执行后按 done 模板留痕。"


def _plan_markdown(payload: dict[str, Any]) -> str:
    totals = payload["totals"]
    lines = [
        f"# 每日执行单 {payload['date']}（{payload['weekday']}）· {payload['person']['name']}（{payload['person']['erp']}）",
        "",
        f"进度 {totals['done']}/{totals['expected']}（仅记录 {totals.get('record_only', 0)} 项不计率） · 逾期 {totals['overdue']} · 可自动执行 {totals['auto_executable']}"
        f" · 待人工 {totals['needs_manual']} · 待补 SOP {totals['needs_sop']} · 待确认 {totals['needs_confirmation']}",
        "",
        f"**下一个动作**：{payload['next_action']}",
        "",
    ]
    for index, row in enumerate(payload["tasks"], 1):
        mark = "x" if row["status"] in ("done", "skipped") else " "
        clock = row["time"] or "无固定时间"
        lines.append(
            f"- [{mark}] {index}. {clock} [{row['priority']}] {row['name']}"
            f"（{STATUS_LABEL.get(row['status'], row['status'])}）"
        )
        head = f"  - task_id：`{row['task_id']}` · 自动执行：{'是' if row['auto_executable'] else '否'}"
        if row["dependencies"]:
            head += " · 依赖：" + "、".join(row["dependencies"])
        lines.append(head)
        lines.append(f"  - SOP：`{row['sop'] or '待补'}`" + ("" if row["sop_exists"] else "（文件缺失）"))
        _meta = _task_meta(row["task_id"])
        if _meta.get("area_id"):
            _rid = _meta.get("resource_id")
            _act = _meta.get("activity_id")
            lines.append(
                f"  - 资源位：resourceId=`{_rid}` → areaId=`{_meta['area_id']}`"
                + (f" · activityId=`{_act}`" if _act else "")
                + f" · {_meta.get('channel', '')}"
                f" · applySkuType={_meta.get('apply_sku_type', '3')}"
            )
        if row["completion"]:
            lines.append("  - 完成标准：" + "；".join(row["completion"]))
        if row["readiness_hint"]:
            lines.append(f"  - 阻塞：{row['readiness_hint']}")
        if row["last_error"]:
            lines.append(f"  - 上次异常：{row['last_error']}")
        lines.append(f"  - 留痕：`{row['done_template']}`")
    return "\n".join(lines) + "\n"


def _task_meta(task_id: str) -> dict[str, Any]:
    for task in load_tasks():
        if task.get("id") == task_id:
            return task
    return {}


def _print_plan(payload: dict[str, Any]) -> None:
    totals = payload["totals"]
    print(f"{payload['person']['name']} 的每日执行单 · {payload['date']}（{payload['weekday']}）")
    print(
        f"进度 {totals['done']}/{totals['expected']}（仅记录 {totals.get('record_only', 0)} 项不计率） · 逾期 {totals['overdue']} · 可自动执行 {totals['auto_executable']}"
        f" · 待人工 {totals['needs_manual']} · 待补 SOP {totals['needs_sop']} · 待确认 {totals['needs_confirmation']}"
    )
    if not payload["tasks"]:
        print("今天没有登记在你名下的作业。")
        return
    print("-" * 88)
    for index, row in enumerate(payload["tasks"], 1):
        flag = "!!" if row["overdue"] else "  "
        clock = row["time"] or "无固定时间"
        print(
            f"{flag}{index}. {clock} [{row['priority']}] {row['name']}"
            f" · {STATUS_LABEL.get(row['status'], row['status'])}"
        )
        if row["readiness"] == "needs_sop":
            label = "待补 SOP"
        elif row["readiness"] == "needs_confirmation":
            label = "待确认"
        elif row["auto_executable"]:
            label = "可自动执行"
        else:
            label = "需人工执行"
        print(f"    id={row['task_id']} | {label} | 依赖={'、'.join(row['dependencies']) or '无'}")
        print(f"    SOP：{row['sop_path'] if row['sop_exists'] else (row['sop'] or '待补') + '（缺失）'}")
        _meta = _task_meta(row["task_id"])
        if _meta.get("area_id"):
            _rid = _meta.get("resource_id")
            _act = _meta.get("activity_id")
            print(
                f"    资源位：resourceId={_rid} → areaId={_meta['area_id']}"
                + (f" · activityId={_act}" if _act else "")
                + f" · {_meta.get('channel', '')}"
                f" · applySkuType={_meta.get('apply_sku_type', '3')}"
            )
        if row["readiness_hint"]:
            print(f"    阻塞：{row['readiness_hint']}")
        if row["last_error"]:
            print(f"    上次异常：{row['last_error']}")
        print(f"    留痕：{row['done_template']}")
    print("-" * 88)
    print(f"下一个动作：{payload['next_action']}")


def cmd_plan(args: argparse.Namespace) -> int:
    person = resolve_person(args.erp, args.name)
    for_date = parse_date(args.date)
    payload = build_plan(for_date, person, include_periodic=args.all, auto_only=args.auto_only)
    saved_to = ""
    if args.save:
        out_dir = HOME / "daily"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{for_date.isoformat()}-plan.md"
        out_path.write_text(_plan_markdown(payload), encoding="utf-8")
        saved_to = str(out_path)
        payload["saved_to"] = saved_to
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    _print_plan(payload)
    if saved_to:
        print(f"执行单已保存：{saved_to}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="自营 AI 作业中枢：执行留痕 + 管理员看板数据")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="初始化执行人")
    init.add_argument("--erp", required=True)
    init.add_argument("--name", required=True)
    init.add_argument("--server", default="")
    init.add_argument("--token", default="", help="线上看板上报令牌（管理员按 ERP 生成）")
    init.set_defaults(func=cmd_init)

    whoami = sub.add_parser("whoami", help="查看当前配置")
    whoami.add_argument("--json", action="store_true")
    whoami.set_defaults(func=cmd_whoami)

    doctor = sub.add_parser("doctor", help="安装自检：Python / Node / 名册 / 看板 / 令牌 / 依赖")
    doctor.add_argument("--server", default="")
    doctor.set_defaults(func=cmd_doctor)

    today = sub.add_parser("today", help="查看本人今日作业")
    today.add_argument("--date")
    today.add_argument("--erp")
    today.add_argument("--name")
    today.add_argument("--all", action="store_true", help="包含定期作业")
    today.add_argument("--json", action="store_true")
    today.set_defaults(func=cmd_today)

    start = sub.add_parser("start", help="标记作业开始")
    start.add_argument("--task", required=True)
    start.add_argument("--date")
    start.add_argument("--erp")
    start.add_argument("--name")
    start.add_argument("--note", default="")
    start.set_defaults(func=cmd_start)

    done = sub.add_parser("done", help="标记作业完成并留痕")
    done.add_argument("--task", required=True)
    done.add_argument("--date")
    done.add_argument("--erp")
    done.add_argument("--name")
    done.add_argument("--summary", default="")
    done.add_argument("--metric", action="append", help="可重复，如 --metric 候选数=12")
    done.add_argument("--evidence", action="append", help="可重复，如 --evidence 表链接=https://...")
    done.add_argument("--url", default="")
    done.add_argument("--note", default="")
    done.add_argument("--no-report", action="store_true")
    done.set_defaults(func=cmd_done)

    fail = sub.add_parser("fail", help="标记失败、阻塞或需人工处理")
    fail.add_argument("--task", required=True)
    fail.add_argument("--date")
    fail.add_argument("--erp")
    fail.add_argument("--name")
    fail.add_argument("--error", required=True)
    fail.add_argument("--summary", default="")
    fail.add_argument("--metric", action="append")
    fail.add_argument("--evidence", action="append")
    fail.add_argument("--url", default="")
    fail.add_argument("--note", default="")
    fail.add_argument("--status", choices=["failed", "blocked"], default="failed")
    fail.add_argument("--no-report", action="store_true")
    fail.set_defaults(func=cmd_fail)

    skip = sub.add_parser("skip", help="标记当日不适用")
    skip.add_argument("--task", required=True)
    skip.add_argument("--date")
    skip.add_argument("--erp")
    skip.add_argument("--name")
    skip.add_argument("--reason", required=True)
    skip.add_argument("--evidence", action="append")
    skip.set_defaults(func=cmd_skip)

    status = sub.add_parser("status", help="查看全员今日状态")
    status.add_argument("--date")
    status.add_argument("--json", action="store_true")
    status.set_defaults(func=cmd_status)

    summary = sub.add_parser("summary", help="管理员汇总")
    summary.add_argument("--date")
    summary.add_argument("--json", action="store_true")
    summary.set_defaults(func=cmd_summary)

    report = sub.add_parser("report", help="上报到管理员采集服务")
    report.add_argument("--server", default="")
    report.add_argument("--all", action="store_true")
    report.add_argument("--quiet", action="store_true")
    report.set_defaults(func=cmd_report)
    token = sub.add_parser("token", help="生成成员上报令牌（管理员）")
    token.add_argument("--erp", default="")
    token.add_argument("--secret", default="")
    token.add_argument("--all", action="store_true", help="打印全名册令牌")
    token.set_defaults(func=cmd_token)

    export = sub.add_parser("export", help="导出 CSV")
    export.add_argument("--out", default="jx-selfop-status.csv")
    export.add_argument("--date")
    export.add_argument("--from", dest="from_date")
    export.add_argument("--days", type=int, default=14)
    export.set_defaults(func=cmd_export)

    imp = sub.add_parser("import", help="导入 CSV（JoySpace/Excel 导出）")
    imp.add_argument("--file", required=True)
    imp.set_defaults(func=cmd_import)

    demo = sub.add_parser("seed-demo", help="生成看板演示数据")
    demo.add_argument("--days", type=int, default=14)
    demo.set_defaults(func=cmd_seed_demo)

    plan = sub.add_parser("plan", help="生成当日执行单（时间顺序 + SOP + 自动化标记 + 留痕模板）")
    plan.add_argument("--date")
    plan.add_argument("--erp")
    plan.add_argument("--name")
    plan.add_argument("--all", action="store_true", help="包含按通知触发的定期作业")
    plan.add_argument("--auto-only", action="store_true", help="只输出可自动执行的作业")
    plan.add_argument("--save", action="store_true", help="同时保存 Markdown 执行单到 ~/.jx-selfop/daily/")
    plan.add_argument("--json", action="store_true")
    plan.set_defaults(func=cmd_plan)

    serve = sub.add_parser("serve", help="启动本地看板")
    serve.add_argument("--port", type=int, default=8080)
    serve.add_argument("--demo", action="store_true")
    serve.set_defaults(func=cmd_serve)
    return parser


def main() -> int:
    _stdout_utf8()
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
