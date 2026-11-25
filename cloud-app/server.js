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
const ADMIN_ERPS = String(process.env.ADMIN_ERPS || 'huoyujia6')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const STATUSES = ['pending', 'running', 'done', 'failed', 'blocked', 'skipped'];

// 名册 = 静态 roster.json ∪ 数据层 members（自助领取令牌 / 首次上报自动登记）
let MEMBERS = [];
function rosterMap() {
  const map = new Map();
  for (const person of core.roster()) map.set(String(person.erp).toLowerCase(), person);
  return map;
}

async function refreshMembers() {
  try {
    MEMBERS = await store.members();
    core.setMembers(MEMBERS);
  } catch (error) {
    console.error('[members] 加载成员失败：', error.message);
  }
  return MEMBERS;
}

async function enroll(erp, name, source) {
  const key = String(erp || '').toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(key)) return false;
  if (rosterMap().has(key)) return false;
  await store.upsertMember({ erp: key, name: String(name || key), source: source || 'report' });
  await refreshMembers();
  return true;
}

function headerName(req) {
  try {
    return decodeURIComponent(String(req.headers['x-user-name'] || '').trim()).slice(0, 40);
  } catch (error) {
    return '';
  }
}

async function usageMapFor(dateText) {
  const out = {};
  try {
    for (const row of await store.usageSince(dateText)) {
      if (row.date !== dateText) continue;
      let deps = row.deps;
      try {
        deps = JSON.parse(row.deps);
      } catch (error) {
        /* 保留原始字符串 */
      }
      out[row.erp] = {
        count: Number(row.count) || 0,
        last_at: row.last_at,
        command: row.command,
        skill_version: row.skill_version,
        deps,
        os_name: row.os_name,
      };
    }
  } catch (error) {
    console.error('[usage] 读取失败：', error.message);
  }
  return out;
}

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

// 心跳里的 deps 是字符串数组（如 ["blacklight"]），不能走 sanitizeFields 变成对象
function sanitizeList(input, max) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).map((item) => clip(item, max)).filter(Boolean);
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

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

// 令牌校验：先比对库里存的 sha256（每人一条随机令牌，可单独作废）；
// 老部署若仍配了 INGEST_SECRET，继续兼容按 HMAC 算出来的老令牌。
async function verifyIngest(erp, token) {
  const key = String(erp || '').toLowerCase();
  const raw = String(token || '').trim();
  if (!key || !raw) return false;
  const stored = await store.tokenHashOf(key);
  if (stored && safeEqual(stored, hashToken(raw))) return true;
  if (SECRET && safeEqual(tokenFor(key), raw)) return true;
  return false;
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
    const token = String(req.headers['x-ingest-token'] || '').trim();
    if (!(await verifyIngest(identity, token))) {
      return {
        status: 401,
        body: {
          ok: false,
          error: '上报令牌无效或已被重置：打开 /token 重新领取，再在本机跑 install.ps1 -Token <新令牌>',
        },
      };
    }
  }

  // 首次上报即自助入册（令牌/SSO 已证明是本人），不用管理员改名册再重部署
  const enrolled = await enroll(identity, clip(payload.name, 40), via === 'sso' ? 'sso' : 'report');

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
  const people = rosterMap();
  if (!people.has(erp)) return { status: 403, body: { ok: false, error: '目标 ERP 不在名册' } };

  const assignment = assignmentOf(taskId, erp, dateText);
  if (!assignment) {
    return {
      status: 400,
      body: { ok: false, error: '该作业不在该成员当日排期（新人先做全员项：每日工具使用、差评治理）' },
    };
  }

  const summary = clip(payload.summary, 2000);
  const metrics = sanitizeFields(payload.metrics, 300);
  const evidence = sanitizeFields(payload.evidence, 300);
  const url = clip(payload.url, 500);
  if (status === 'done' && !summary && !Object.keys(metrics).length && !Object.keys(evidence).length && !url) {
    return { status: 400, body: { ok: false, error: '完成必须留痕：summary / metric / evidence / url 至少一项' } };
  }

  const now = new Date().toISOString();
  const person = people.get(erp) || { erp, name: erp };
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
  return { status: 200, body: { ok: true, id: record.id, erp, date: dateText, status, enrolled } };
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

const PAGE_ALIASES = { '/': 'index.html', '/full': 'full.html', '/demo': 'demo.html', '/token': 'token.html' };

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
    return sendJson(res, 200, {
      ok: true,
      dataLayer: store.usingDataLayer,
      ingest: true,
      tokenMode: SECRET ? 'per-person+legacy' : 'per-person',
    });
  }

  // 自助领取上报令牌：只发「当前 SSO 身份本人」那一条，不支持指定他人
  // GET 只回报状态；要拿令牌必须 POST（重新领取会让旧令牌立刻失效）
  if (pathname === '/api/token' && req.method === 'GET') {
    const identity = identityOf(req);
    if (!identity) {
      return sendJson(res, 401, {
        ok: false,
        error: '未取到登录身份：请从内部门户打开本页，不要直接从外部浏览器访问',
      });
    }
    // 不在名册也发令牌：领到的同时自动入册，管理员不用再改名册重部署
    const person = rosterMap().get(identity);
    const enrolled = person ? false : await enroll(identity, headerName(req), 'token');
    const name = person ? person.name : headerName(req) || identity;
    const list = await store.members();
    const mine = list.find((item) => item.erp === identity);
    const hasToken = Boolean(mine && mine.hasToken);
    return sendJson(res, 200, {
      ok: true,
      erp: identity,
      name,
      hasToken,
      // 老部署带 INGEST_SECRET、且本人还没领随机令牌时，仍给兼容令牌，已装好的机器不断
      token: hasToken ? '' : tokenFor(identity),
      mode: SECRET ? 'per-person+legacy' : 'per-person',
      board: '/',
      enrolled,
    });
  }

  // 领取 / 重新领取：随机 32 位，一人一条；覆盖即作废该人旧令牌，可单独吊销
  if (pathname === '/api/token' && req.method === 'POST') {
    const identity = identityOf(req);
    if (!identity) {
      return sendJson(res, 401, {
        ok: false,
        error: '未取到登录身份：请从内部门户打开本页，不要直接从外部浏览器访问',
      });
    }
    const person = rosterMap().get(identity);
    const enrolled = person ? false : await enroll(identity, headerName(req), 'token');
    const name = person ? person.name : headerName(req) || identity;
    const list = await store.members();
    const mine = list.find((item) => item.erp === identity);
    const rotated = Boolean(mine && mine.hasToken);
    const token = crypto.randomBytes(16).toString('hex');
    await store.saveTokenHash(identity, hashToken(token));
    return sendJson(res, 200, {
      ok: true,
      erp: identity,
      name,
      token,
      rotated,
      enrolled,
      mode: 'per-person',
    });
  }

  // 使用心跳：装了技能、每次用它就自动打点一次；只表示「在用」，不代表作业完成
  // /api/tunnel/usage 是给成员本机用的：平台 SSO 守卫只放行 /api/tunnel/*，本机没有 SSO Cookie
  if ((pathname === '/api/usage' || pathname === '/api/tunnel/usage') && req.method === 'POST') {
    const erp = String(req.headers['x-ingest-erp'] || '').trim().toLowerCase();
    if (!erp) return sendJson(res, 401, { ok: false, error: '缺少 X-Ingest-Erp' });
    if (!(await verifyIngest(erp, req.headers['x-ingest-token']))) {
      return sendJson(res, 401, {
        ok: false,
        error: '上报令牌无效或已被重置：打开 /token 重新领取（旧令牌会失效）',
      });
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || '{}');
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: 'JSON 解析失败' });
    }
    const enrolled = await enroll(erp, clip(payload.name, 40), 'usage');
    const rawDate = String(payload.date || '');
    const dateText = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : isoDate(new Date());
    await store.bumpUsage({
      erp,
      date: dateText,
      command: clip(payload.command, 40),
      skill_version: clip(payload.skill_version, 20),
      deps: sanitizeList(payload.deps, 40),
      os_name: clip(payload.os_name, 40),
    });
    return sendJson(res, 200, { ok: true, erp, date: dateText, enrolled });
  }

  if (pathname === '/api/usage' && req.method === 'GET') {
    const dateText = url.searchParams.get('date') || isoDate(new Date());
    return sendJson(res, 200, { ok: true, date: dateText, usage: await usageMapFor(dateText) });
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
    const usage = await usageMapFor(dateText);
    return sendJson(res, 200, core.buildDashboard(dateText, days, demo, usage));
  }

  if (pathname === '/api/tasks') return sendJson(res, 200, { tasks: core.TASKS });
  if (pathname === '/api/roster') return sendJson(res, 200, { roster: core.roster() });

  if (pathname === '/api/admin/delete' && req.method === 'POST') {
    const identity = identityOf(req);
    const tokenErp = String(req.headers['x-ingest-erp'] || '').trim().toLowerCase();
    const tokenOk = tokenErp ? await verifyIngest(tokenErp, req.headers['x-ingest-token']) : false;
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
  const list = await refreshMembers();
  console.log(`[boot] 成员 ${core.roster().length} 人（静态 ${core.ROSTER.length} + 自助入册 ${Math.max(0, core.roster().length - core.ROSTER.length)}，数据层成员 ${list.length}）`);
  server.listen(PORT, HOST, () => {
    console.log(`自营作业完成看板（实时版）已启动：http://0.0.0.0:${PORT}/ · 数据层=${store.usingDataLayer}`);
  });
}

boot();
