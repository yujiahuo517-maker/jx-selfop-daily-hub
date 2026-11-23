#!/usr/bin/env node
/*
 * 自营作业完成看板 · 线上实时版
 * - 页面：/ 今日完成矩阵（60 秒自动刷新）、/full.html 完整快照、/demo.html 演示快照
 * - 读接口：GET /api/dashboard
 * - 写接口：POST /api/report（浏览器 SSO 身份）、POST /api/tunnel/report（成员 CLI 令牌）
 * - 数据：平台共享数据层（SQLite），部署时注入 _data_client.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const core = require('./core.js');
const store = require('./store.js');

const PORT = Number(process.env.PORT || 3001);
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SECRET = String(process.env.INGEST_SECRET || '');
const ADMIN_ERPS = String(process.env.ADMIN_ERPS || 'zhangsan1')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const STATUSES = ['pending', 'running', 'done', 'failed', 'blocked', 'skipped'];
const ROSTER_BY_ERP = new Map(core.ROSTER.map((person) => [String(person.erp).toLowerCase(), person]));

const records = [];
core.setRecords(records, []);

function isoDate(date) {
  return core.isoDate(date);
}

function addDays(date, delta) {
  return core.addDays(date, delta);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > (limit || 256 * 1024)) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function clip(value, max) {
  const text = String(value == null ? '' : value);
  return text.length > max ? text.slice(0, max) : text;
}

function sanitizeFields(input, max) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const key of Object.keys(input).slice(0, 20)) {
    out[clip(key, 40)] = clip(input[key], max);
  }
  return out;
}

function tokenFor(erp) {
  if (!SECRET) return '';
  return crypto.createHmac('sha256', SECRET).update(String(erp).toLowerCase()).digest('hex').slice(0, 32);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function identityOf(req) {
  const raw = String(req.headers['x-user-erp'] || '').trim().toLowerCase();
  return /^[a-z0-9._-]{2,40}$/.test(raw) ? raw : '';
}

function assignmentOf(taskId, erp, dateText) {
  const date = core.parseDate(dateText);
  const pairs = core.expectedPairs(date);
  return pairs.find(
    (pair) => pair.task.id === taskId && String(pair.person.erp).toLowerCase() === erp,
  );
}

async function acceptReport(req, via) {
  const body = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch (error) {
    return { status: 400, body: { ok: false, error: 'JSON 解析失败' } };
  }

  let identity = '';
  if (via === 'sso') {
    identity = identityOf(req);
    if (!identity) return { status: 401, body: { ok: false, error: '未取到登录身份，请从门户打开看板' } };
  } else {
    identity = String(req.headers['x-ingest-erp'] || '').trim().toLowerCase();
    if (!identity) return { status: 401, body: { ok: false, error: '缺少 X-Ingest-Erp' } };
    if (!SECRET) return { status: 503, body: { ok: false, error: '服务未配置上报密钥' } };
    const token = String(req.headers['x-ingest-token'] || '').trim();
    if (!safeEqual(tokenFor(identity), token)) {
      return { status: 401, body: { ok: false, error: '上报令牌无效' } };
    }
  }

  if (!ROSTER_BY_ERP.has(identity) && !ADMIN_ERPS.includes(identity)) {
    return { status: 403, body: { ok: false, error: '不在团队名册，无法上报' } };
  }

  const taskId = clip(payload.task_id, 60);
  if (!core.TASK_BY_ID.has(taskId)) return { status: 400, body: { ok: false, error: '未知 task_id' } };

  const dateText = clip(payload.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return { status: 400, body: { ok: false, error: 'date 需为 YYYY-MM-DD' } };

  const status = clip(payload.status, 20);
  if (STATUSES.indexOf(status) < 0) return { status: 400, body: { ok: false, error: 'status 非法' } };

  const claimed = String(payload.erp || '').trim().toLowerCase();
  const isAdmin = ADMIN_ERPS.includes(identity);
  if (claimed && claimed !== identity && !isAdmin) {
    return { status: 403, body: { ok: false, error: '只能上报本人作业' } };
  }
  const erp = claimed || identity;
  if (!ROSTER_BY_ERP.has(erp)) return { status: 403, body: { ok: false, error: '目标 ERP 不在名册' } };

  const assignment = assignmentOf(taskId, erp, dateText);
  if (!assignment) return { status: 400, body: { ok: false, error: '该作业不在该成员当日排期' } };

  const summary = clip(payload.summary, 2000);
  const metrics = sanitizeFields(payload.metrics, 300);
  const evidence = sanitizeFields(payload.evidence, 300);
  const url = clip(payload.url, 500);
  if (status === 'done' && !summary && !Object.keys(metrics).length && !Object.keys(evidence).length && !url) {
    return { status: 400, body: { ok: false, error: '完成必须留痕：summary / metric / evidence / url 至少一项' } };
  }

  const now = new Date().toISOString();
  const person = ROSTER_BY_ERP.get(erp);
  const task = assignment.task;
  const record = {
    id: `${dateText}:${taskId}:${erp}`,
    date: dateText,
    task_id: taskId,
    task_name: task.name,
    category: task.category,
    priority: task.priority,
    erp,
    name: person.name,
    status,
    source: payload.source === 'manual-admin' ? 'manual-admin' : via === 'sso' ? 'web' : 'skill',
    summary,
    metrics,
    evidence,
    url,
    error: clip(payload.error, 1000),
    note: clip(payload.note, 1000),
    duration_sec: Number(payload.duration_sec) > 0 ? Math.floor(Number(payload.duration_sec)) : undefined,
    created_at: clip(payload.created_at, 40) || now,
    updated_at: now,
    received_at: now,
  };
  if (!record.duration_sec) delete record.duration_sec;

  await store.insert(record);
  records.push(record);
  return { status: 200, body: { ok: true, id: record.id, erp, date: dateText, status } };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const PAGE_ALIASES = { '/': 'index.html', '/full': 'full.html', '/demo': 'demo.html' };

function serveStatic(res, pathname) {
  const alias = PAGE_ALIASES[pathname];
  const relative = alias || decodeURIComponent(pathname.replace(/^\/+/, ''));
  let file = path.resolve(PUBLIC_DIR, relative);
  if (file.indexOf(PUBLIC_DIR) !== 0) file = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not Found');
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Ingest-Erp,X-Ingest-Token' });
    return res.end();
  }

  if (pathname === '/health' || pathname === '/healthz' || pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, dataLayer: store.usingDataLayer, ingest: Boolean(SECRET) });
  }

  if (pathname === '/api/report' && req.method === 'POST') {
    const result = await acceptReport(req, 'sso');
    return sendJson(res, result.status, result.body);
  }

  if (pathname === '/api/tunnel/report' && req.method === 'POST') {
    const result = await acceptReport(req, 'token');
    return sendJson(res, result.status, result.body);
  }

  if (pathname === '/api/dashboard' && req.method === 'GET') {
    const dateText = url.searchParams.get('date') || isoDate(new Date());
    const days = Math.max(1, Math.min(60, Number(url.searchParams.get('days') || 1)));
    const demo = url.searchParams.get('demo') === '1';
    return sendJson(res, 200, core.buildDashboard(dateText, days, demo));
  }

  if (pathname === '/api/tasks') return sendJson(res, 200, { tasks: core.TASKS });
  if (pathname === '/api/roster') return sendJson(res, 200, { roster: core.ROSTER });

  if (pathname === '/api/admin/delete' && req.method === 'POST') {
    const identity = identityOf(req);
    const tokenErp = String(req.headers['x-ingest-erp'] || '').trim().toLowerCase();
    const tokenOk = SECRET && safeEqual(tokenFor(tokenErp), String(req.headers['x-ingest-token'] || '').trim());
    const actor = identity || (tokenOk ? tokenErp : '');
    if (!actor || !ADMIN_ERPS.includes(actor)) {
      return sendJson(res, 403, { ok: false, error: '仅管理员可操作' });
    }
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: 'JSON 解析失败' });
    }
    const target = {
      date: clip(payload.date, 10),
      task_id: clip(payload.task_id, 60),
      erp: String(payload.erp || '').toLowerCase(),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target.date) || !target.task_id || !target.erp) {
      return sendJson(res, 400, { ok: false, error: 'date/task_id/erp 不能为空' });
    }
    await store.remove(target.date, target.task_id, target.erp);
    const keep = records.filter(
      (item) => !(item.date === target.date && item.task_id === target.task_id && String(item.erp).toLowerCase() === target.erp),
    );
    records.length = 0;
    records.push(...keep);
    return sendJson(res, 200, { ok: true, removed: target });
  }

  if (pathname.indexOf('/api/') === 0) return sendJson(res, 404, { ok: false, error: 'API 不存在' });
  return serveStatic(res, pathname);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('[error]', error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
    else res.end();
  });
});

async function boot() {
  const since = isoDate(addDays(new Date(), -400));
  try {
    const loaded = await store.loadAll(since);
    records.push(...loaded);
    console.log(`[boot] 已加载 ${loaded.length} 条记录（数据层=${store.usingDataLayer}）`);
  } catch (error) {
    console.error('[boot] 数据层加载失败，先以空数据启动：', error.message);
  }
  server.listen(PORT, HOST, () => {
    console.log(`自营作业完成看板（实时版）已启动：http://0.0.0.0:${PORT}/ · 数据层=${store.usingDataLayer}`);
  });
}

boot();
