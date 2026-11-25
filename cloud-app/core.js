#!/usr/bin/env node
/*
 * 自营 AI 作业完成看板 - 零依赖 Node 服务。
 *
 * 用法：
 *   node server.js --port 8080            # 管理员采集 + 看板
 *   node server.js --port 8080 --demo     # 演示数据（不写入真实数据）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

// 云端版：数据由 store.js 从平台数据层加载后注入，不再读本地 jsonl 文件。
let LIVE_RECORDS = [];
let DEMO_RECORDS = [];
function setRecords(live, demo) {
  LIVE_RECORDS = Array.isArray(live) ? live : [];
  DEMO_RECORDS = Array.isArray(demo) ? demo : [];
}
const FORCE_DEMO = false;

const STATUS_LABEL = {
  pending: '未开始',
  running: '进行中',
  done: '已完成',
  failed: '失败',
  blocked: '阻塞',
  skipped: '已跳过',
};

const TASKS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tasks.json'), 'utf8'));
const ROSTER = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'roster.json'), 'utf8'));
const TASK_BY_ID = new Map(TASKS.map((task) => [task.id, task]));

// 动态成员：自助领取令牌 / 首次上报时由数据层 members 表补充，不必改 roster.json 重部署
let MEMBERS = [];
function setMembers(list) {
  MEMBERS = Array.isArray(list) ? list : [];
}

function roster() {
  const seen = new Set(ROSTER.map((person) => String(person.erp).toLowerCase()));
  const out = ROSTER.slice();
  for (const item of MEMBERS) {
    const erp = String((item && item.erp) || '').toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(erp) || seen.has(erp)) continue;
    seen.add(erp);
    out.push({
      erp,
      name: String((item && item.name) || erp),
      team_id: '',
      enrolled: true,
      source: String((item && item.source) || ''),
      first_seen: String((item && item.first_seen) || ''),
    });
  }
  return out;
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, delta) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + delta);
  return next;
}

function isoWeekday(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const records = [];
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      console.warn(`[warn] 跳过损坏行 ${file}:${index + 1}`);
    }
  });
  return records;
}

function loadRecords(useDemo) {
  const records = LIVE_RECORDS.slice();
  if (useDemo) records.push(...DEMO_RECORDS);
  const latest = new Map();
  for (const record of records) {
    if (!record || !record.task_id || !record.erp || !record.date) continue;
    const key = `${record.date}:${record.task_id}:${String(record.erp).toLowerCase()}`;
    const previous = latest.get(key);
    if (!previous || timeValue(record) >= timeValue(previous)) {
      latest.set(key, record);
    }
  }
  return latest;
}

function timeValue(record) {
  const raw = record.updated_at || record.created_at || '';
  const value = Date.parse(raw);
  return Number.isNaN(value) ? 0 : value;
}

function ownersFor(task) {
  if (task.scope === 'all') return roster();
  const owners = [];
  for (const erp of task.owners || []) {
    const person = roster().find((p) => p.erp.toLowerCase() === String(erp).toLowerCase());
    owners.push(person || { name: erp, erp, team_id: '' });
  }
  return owners;
}

function appliesOn(task, date) {
  const schedule = task.schedule || {};
  if (schedule.type === 'daily') return true;
  if (schedule.type === 'weekly') return isoWeekday(date) === Number(schedule.weekday_iso || 1);
  return false;
}

function expectedPairs(date) {
  const pairs = [];
  for (const task of TASKS) {
    if (!appliesOn(task, date)) continue;
    for (const person of ownersFor(task)) {
      pairs.push({ task, person });
    }
  }
  return pairs;
}

// 口径：只有计入口径的作业才进完成率与矩阵；count_in_rate=false 的作业仅落库留痕。
function isTracked(task) {
  return task.count_in_rate !== false;
}

function trackedPairs(date) {
  return expectedPairs(date).filter(({ task }) => isTracked(task));
}

function isOverdue(task, date, status, now = new Date()) {
  if (status === 'done' || status === 'skipped') return false;
  const dateText = isoDate(date);
  const todayText = isoDate(now);
  if (dateText < todayText) return true;
  if (dateText > todayText) return false;
  const schedule = task.schedule || {};
  if (schedule.type === 'periodic' || !schedule.time) return false;
  const [hour, minute] = schedule.time.split(':').map(Number);
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  due.setMinutes(due.getMinutes() + Number(schedule.grace_minutes || 0));
  return now > due;
}

function cellFor(record) {
  if (!record) return { status: 'pending', overdue: false };
  return {
    status: record.status || 'pending',
    overdue: false,
    summary: record.summary || '',
    error: record.error || '',
    metrics: record.metrics || {},
    evidence: record.evidence || {},
    url: record.url || '',
    updated_at: record.updated_at || record.created_at || '',
    duration_sec: record.duration_sec,
    source: record.source || '',
  };
}

function buildDashboard(dateText, days, useDemo, usageByErp) {
  const end = parseDate(dateText);
  const start = addDays(end, -(days - 1));
  const latest = loadRecords(useDemo);
  const now = new Date();

  const trend = [];
  const daily = new Map();
  for (let i = 0; i < days; i += 1) {
    const day = addDays(start, i);
    const dayText = isoDate(day);
    const pairs = trackedPairs(day);
    let done = 0;
    let failed = 0;
    let overdue = 0;
    for (const { task, person } of pairs) {
      const key = `${dayText}:${task.id}:${person.erp.toLowerCase()}`;
      const record = latest.get(key);
      const status = record ? record.status || 'pending' : 'pending';
      if (status === 'done' || status === 'skipped') done += 1;
      if (status === 'failed' || status === 'blocked') failed += 1;
      if (isOverdue(task, day, status, now)) overdue += 1;
    }
    const row = {
      date: dayText,
      expected: pairs.length,
      done,
      failed,
      overdue,
      rate: pairs.length ? Math.round((done / pairs.length) * 1000) / 10 : 0,
    };
    trend.push(row);
    daily.set(dayText, row);
  }

  const pairs = trackedPairs(end);
  const matrixTasks = [];
  const matrixPeople = [];
  const byTaskMap = new Map();
  const personIndex = new Map();
  const alerts = [];

  for (const task of TASKS) {
    if (!pairs.some((pair) => pair.task.id === task.id)) continue;
    matrixTasks.push({
      id: task.id,
      name: task.name,
      priority: task.priority,
      time: task.schedule_label,
      category: task.category,
        short: task.short || task.name.replace(/自动|提报|监控|治理|与/g, '').slice(0, 8),
    });
    byTaskMap.set(task.id, {
      task_id: task.id,
      name: task.name,
      priority: task.priority,
      time: task.schedule_label,
      expected: 0,
      done: 0,
      failed: 0,
      overdue: 0,
      cells: [],
    });
  }

  for (const person of roster()) {
    const usage = usageByErp ? usageByErp[String(person.erp).toLowerCase()] : null;
    personIndex.set(person.erp, {
      erp: person.erp,
      name: person.name,
      expected: 0,
      done: 0,
      failed: 0,
      overdue: 0,
      rate: 0,
      enrolled: Boolean(person.enrolled),
      usage: usage || null,
      cells: {},
    });
  }

  let totalDone = 0;
  for (const { task, person } of pairs) {
    const key = `${isoDate(end)}:${task.id}:${person.erp.toLowerCase()}`;
    const record = latest.get(key);
    const status = record ? record.status || 'pending' : 'pending';
    const overdue = isOverdue(task, end, status, now);
    const cell = { ...cellFor(record), overdue };
    const personRow = personIndex.get(person.erp);
    const taskRow = byTaskMap.get(task.id);
    if (personRow) {
      personRow.expected += 1;
      personRow.cells[task.id] = cell;
      if (status === 'done' || status === 'skipped') personRow.done += 1;
      if (status === 'failed' || status === 'blocked') personRow.failed += 1;
      if (overdue) personRow.overdue += 1;
    }
    if (taskRow) {
      taskRow.expected += 1;
      if (status === 'done' || status === 'skipped') taskRow.done += 1;
      if (status === 'failed' || status === 'blocked') taskRow.failed += 1;
      if (overdue) taskRow.overdue += 1;
      taskRow.cells.push({ erp: person.erp, name: person.name, status, overdue });
    }
    if (status === 'done' || status === 'skipped') totalDone += 1;
    if (status === 'failed' || status === 'blocked' || overdue) {
      alerts.push({
        erp: person.erp,
        name: person.name,
        task_id: task.id,
        task_name: task.name,
        priority: task.priority,
        status,
        overdue,
        error: (record && record.error) || '',
        summary: (record && record.summary) || '',
        updated_at: (record && (record.updated_at || record.created_at)) || '',
      });
    }
  }

  // 仅记录类作业：不进完成率与矩阵，但把状态回填到 cells / record_only，便于回读核验。
  const recordOnly = [];
  for (const { task, person } of expectedPairs(end)) {
    if (isTracked(task)) continue;
    const key = `${isoDate(end)}:${task.id}:${person.erp.toLowerCase()}`;
    const record = latest.get(key);
    const status = record ? record.status || 'pending' : 'pending';
    const cell = { ...cellFor(record), overdue: isOverdue(task, end, status, now), record_only: true };
    const personRow = personIndex.get(person.erp);
    if (personRow) personRow.cells[task.id] = cell;
    recordOnly.push({
      erp: person.erp,
      name: person.name,
      task_id: task.id,
      task_name: task.name,
      status,
      summary: cell.summary,
      metrics: cell.metrics,
      evidence: cell.evidence,
      url: cell.url,
      updated_at: cell.updated_at,
    });
  }

  for (const person of personIndex.values()) {
    person.rate = person.expected ? Math.round((person.done / person.expected) * 1000) / 10 : 0;
    matrixPeople.push(person);
  }
  for (const task of byTaskMap.values()) {
    task.rate = task.expected ? Math.round((task.done / task.expected) * 1000) / 10 : 0;
  }
  alerts.sort((a, b) => {
    const rank = (item) => (item.status === 'failed' || item.status === 'blocked' ? 0 : item.overdue ? 1 : 2);
    return rank(a) - rank(b) || (a.priority === b.priority ? 0 : a.priority === 'P0' ? -1 : 1);
  });

  const todayRow = daily.get(isoDate(end)) || { expected: 0, done: 0, failed: 0, overdue: 0, rate: 0 };
  const reportedPeople = matrixPeople.filter((person) => Object.keys(person.cells).some((id) => person.cells[id].status !== 'pending')).length;
  const periodic = TASKS.filter((task) => (task.schedule || {}).type === 'periodic').map((task) => {
    const record = latest.get(`${isoDate(end)}:${task.id}:${(task.owners[0] || '').toLowerCase()}`);
    return {
      id: task.id,
      name: task.name,
      priority: task.priority,
      owner_label: task.owner_label,
      schedule_label: task.schedule_label,
      status: task.status,
      count_in_rate: task.count_in_rate,
      summary: task.summary,
      last: record ? cellFor(record) : null,
    };
  });

  return {
    date: isoDate(end),
    range: { from: isoDate(start), to: isoDate(end), days },
    generated_at: new Date().toISOString(),
    source: useDemo ? 'demo' : 'live',
    kpis: {
      expected: todayRow.expected,
      done: todayRow.done,
      failed: todayRow.failed,
      overdue: todayRow.overdue,
      rate: todayRow.rate,
      people_total: roster().length,
      people_reported: reportedPeople,
      people_active: matrixPeople.filter((person) => person.usage && Number(person.usage.count) > 0).length,
      tasks_total: matrixTasks.length,
    },
    matrix: { tasks: matrixTasks, people: matrixPeople },
    by_task: Array.from(byTaskMap.values()).sort((a, b) => a.priority.localeCompare(b.priority) || b.expected - a.expected),
    record_only: recordOnly,
    trend,
    periodic,
    alerts,
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('请求体超过 1MB'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(dateText, days, useDemo) {
  const end = parseDate(dateText);
  const start = addDays(end, -(days - 1));
  const latest = loadRecords(useDemo);
  const rows = [['日期', '任务ID', '任务名称', '优先级', '姓名', 'ERP', '状态', '摘要', '异常', '更新时间']];
  for (const record of latest.values()) {
    if (record.date < isoDate(start) || record.date > isoDate(end)) continue;
    rows.push([
      record.date,
      record.task_id,
      record.task_name || '',
      record.priority || '',
      record.name || '',
      record.erp,
      STATUS_LABEL[record.status] || record.status,
      record.summary || '',
      record.error || '',
      record.updated_at || record.created_at || '',
    ]);
  }
  return '\ufeff' + rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

module.exports = {
  buildDashboard,
  buildCsv,
  isoDate,
  parseDate,
  addDays,
  expectedPairs,
  trackedPairs,
  isTracked,
  roster,
  setMembers,
  TASKS,
  ROSTER,
  TASK_BY_ID,
  STATUS_LABEL,
  setRecords,
};
