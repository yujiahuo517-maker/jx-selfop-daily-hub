/*
 * 平台共享数据层读写（SQLite）。
 * - 线上：require('./_data_client.js')，由想象力平台在部署时注入，自带签名，无需本机凭证。
 * - 本机自测：注入文件不存在时退回 data/reports.local.jsonl，只在开发时使用。
 */
const fs = require('fs');
const path = require('path');

let client = null;
try {
  client = require('./_data_client.js');
} catch (error) {
  client = null;
}

const FALLBACK_FILE = path.join(__dirname, 'data', 'reports.local.jsonl');

const CREATE_SQL = [
  'CREATE TABLE IF NOT EXISTS reports (',
  '  id TEXT NOT NULL,',
  '  date TEXT NOT NULL,',
  '  task_id TEXT NOT NULL,',
  '  erp TEXT NOT NULL,',
  '  status TEXT NOT NULL,',
  '  payload TEXT NOT NULL,',
  '  updated_at TEXT NOT NULL,',
  '  received_at TEXT NOT NULL',
  ')',
].join('\n');

const INDEX_SQL = 'CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date)';

// 成员表：自助领取令牌 / 首次上报时自动登记，不必改 data/roster.json 再重部署
const CREATE_MEMBERS_SQL = [
  'CREATE TABLE IF NOT EXISTS members (',
  '  erp TEXT PRIMARY KEY,',
  '  name TEXT NOT NULL,',
  '  first_seen TEXT NOT NULL,',
  '  last_seen TEXT NOT NULL,',
  '  source TEXT NOT NULL',
  ')',
].join('\n');

// 使用表：每次用技能打一次心跳，按人按天累加；与作业完成状态完全分开
const CREATE_USAGE_SQL = [
  'CREATE TABLE IF NOT EXISTS usage (',
  '  erp TEXT NOT NULL,',
  '  date TEXT NOT NULL,',
  '  count INTEGER NOT NULL,',
  '  last_at TEXT NOT NULL,',
  '  command TEXT NOT NULL,',
  '  skill_version TEXT NOT NULL,',
  '  deps TEXT NOT NULL,',
  '  os_name TEXT NOT NULL,',
  '  PRIMARY KEY (erp, date)',
  ')',
].join('\n');

const MEMBERS_FALLBACK = path.join(__dirname, 'data', 'members.local.json');
const USAGE_FALLBACK = path.join(__dirname, 'data', 'usage.local.json');

// 每人随机令牌：库里只存 sha256(令牌)，明文只在领取那一刻返回一次。
// 这样看板不再需要全局 INGEST_SECRET，谁的令牌泄露只作废谁那一条。
const ALTER_MEMBERS_SQL = [
  'ALTER TABLE members ADD COLUMN token_hash TEXT',
  'ALTER TABLE members ADD COLUMN token_issued_at TEXT',
];

let schemaReady = false;

function rowsOf(result) {
  if (!result) return [];
  const body = result.data !== undefined ? result.data : result;
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  for (const key of ['rows', 'data', 'result', 'results']) {
    if (Array.isArray(body[key])) return body[key];
  }
  return [];
}

function readFallback() {
  if (!fs.existsSync(FALLBACK_FILE)) return [];
  const out = [];
  const lines = fs.readFileSync(FALLBACK_FILE, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (error) {
      /* 跳过损坏行 */
    }
  }
  return out;
}

async function ensureSchema() {
  if (!client || schemaReady) return;
  await client.call('POST', '/exec', { sql: CREATE_SQL });
  await client.call('POST', '/exec', { sql: INDEX_SQL });
  await client.call('POST', '/exec', { sql: CREATE_MEMBERS_SQL });
  await client.call('POST', '/exec', { sql: CREATE_USAGE_SQL });
  // 老库没有 token_hash/token_issued_at，逐条 ALTER，已存在就跳过
  for (const sql of ALTER_MEMBERS_SQL) {
    try {
      await client.call('POST', '/exec', { sql });
    } catch (error) {
      /* 列已存在则忽略 */
    }
  }
  schemaReady = true;
}

async function loadAll(sinceDate) {
  if (!client) return readFallback();
  await ensureSchema();
  const result = await client.call('POST', '/query', {
    sql: 'SELECT payload FROM reports WHERE date >= ? ORDER BY updated_at ASC',
    args: [sinceDate],
  });
  const records = [];
  for (const row of rowsOf(result)) {
    const raw = row && typeof row === 'object' ? (row.payload !== undefined ? row.payload : row[0]) : row;
    if (!raw) continue;
    try {
      records.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch (error) {
      /* 忽略坏 payload */
    }
  }
  return records;
}

async function insert(record) {
  const args = [
    record.id,
    record.date,
    record.task_id,
    String(record.erp).toLowerCase(),
    record.status,
    JSON.stringify(record),
    record.updated_at,
    record.received_at,
  ];
  if (client) {
    await ensureSchema();
    await client.call('POST', '/exec', {
      sql: 'INSERT INTO reports(id,date,task_id,erp,status,payload,updated_at,received_at) VALUES (?,?,?,?,?,?,?,?)',
      args,
    });
    return;
  }
  fs.mkdirSync(path.dirname(FALLBACK_FILE), { recursive: true });
  fs.appendFileSync(FALLBACK_FILE, JSON.stringify(record) + '\n', 'utf8');
}

async function remove(date, taskId, erp) {
  if (client) {
    await ensureSchema();
    await client.call('POST', '/exec', {
      sql: 'DELETE FROM reports WHERE date=? AND task_id=? AND erp=?',
      args: [date, taskId, String(erp).toLowerCase()],
    });
    return;
  }
  if (!fs.existsSync(FALLBACK_FILE)) return;
  const lines = fs.readFileSync(FALLBACK_FILE, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const keep = lines.filter((line) => {
    if (!line.trim()) return false;
    try {
      const record = JSON.parse(line);
      return !(
        record.date === date &&
        record.task_id === taskId &&
        String(record.erp).toLowerCase() === String(erp).toLowerCase()
      );
    } catch (error) {
      return true;
    }
  });
  fs.writeFileSync(FALLBACK_FILE, keep.join('\n') + (keep.length ? '\n' : ''), 'utf8');
}

async function count() {
  if (!client) return readFallback().length;
  await ensureSchema();
  const result = await client.call('POST', '/query', { sql: 'SELECT COUNT(*) AS n FROM reports' });
  const rows = rowsOf(result);
  const first = rows[0];
  if (!first) return 0;
  const value = typeof first === 'object' ? (first.n !== undefined ? first.n : first[0]) : first;
  return Number(value) || 0;
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/* 成员：erp / name / first_seen / last_seen / source / hasToken */
async function members() {
  if (!client) {
    return readJsonFile(MEMBERS_FALLBACK, []).map((item) => ({
      erp: String(item.erp || '').toLowerCase(),
      name: String(item.name || ''),
      first_seen: String(item.first_seen || ''),
      last_seen: String(item.last_seen || ''),
      source: String(item.source || ''),
      hasToken: Boolean(item.token_hash),
    }));
  }
  await ensureSchema();
  const result = await client.call('POST', '/query', {
    sql: 'SELECT erp, name, first_seen, last_seen, source, token_hash FROM members ORDER BY first_seen ASC',
  });
  return rowsOf(result).map((row) => ({
    erp: String(row.erp || '').toLowerCase(),
    name: String(row.name || ''),
    first_seen: String(row.first_seen || ''),
    last_seen: String(row.last_seen || ''),
    source: String(row.source || ''),
    hasToken: Boolean(row.token_hash),
  }));
}

async function upsertMember(person) {
  const erp = String(person.erp || '').toLowerCase();
  if (!erp) return;
  const name = String(person.name || erp);
  const source = String(person.source || 'report');
  const now = new Date().toISOString();
  if (client) {
    await ensureSchema();
    await client.call('POST', '/exec', {
      sql:
        'INSERT INTO members(erp,name,first_seen,last_seen,source) VALUES (?,?,?,?,?) ' +
        'ON CONFLICT(erp) DO UPDATE SET name=excluded.name, last_seen=excluded.last_seen',
      args: [erp, name, now, now, source],
    });
    return;
  }
  const list = readJsonFile(MEMBERS_FALLBACK, []);
  const hit = list.find((item) => String(item.erp).toLowerCase() === erp);
  if (hit) {
    hit.name = name;
    hit.last_seen = now;
  } else {
    list.push({ erp, name, first_seen: now, last_seen: now, source });
  }
  writeJsonFile(MEMBERS_FALLBACK, list);
}

/* 读取某人的令牌哈希（没领过返回空串） */
async function tokenHashOf(erp) {
  const key = String(erp || '').toLowerCase();
  if (!key) return '';
  if (!client) {
    const hit = readJsonFile(MEMBERS_FALLBACK, []).find(
      (item) => String(item.erp || '').toLowerCase() === key,
    );
    return hit && hit.token_hash ? String(hit.token_hash) : '';
  }
  await ensureSchema();
  const result = await client.call('POST', '/query', {
    sql: 'SELECT token_hash FROM members WHERE erp = ?',
    args: [key],
  });
  const row = rowsOf(result)[0];
  if (!row) return '';
  const raw = typeof row === 'object' && row !== null ? row.token_hash : row;
  return raw ? String(raw) : '';
}

/* 写入/覆盖令牌哈希：覆盖即让该人旧令牌立即失效 */
async function saveTokenHash(erp, hash, issuedAt) {
  const key = String(erp || '').toLowerCase();
  if (!key) return;
  const now = issuedAt || new Date().toISOString();
  const value = String(hash || '');
  if (client) {
    await ensureSchema();
    // 名册里已有的人（静态 roster）原本没有 members 行，这里顺手建出来，
    // 否则 UPDATE 会影响 0 行、令牌白领一次。
    await client.call('POST', '/exec', {
      sql:
        'INSERT INTO members(erp,name,first_seen,last_seen,source,token_hash,token_issued_at) ' +
        'VALUES (?,?,?,?,?,?,?) ' +
        'ON CONFLICT(erp) DO UPDATE SET token_hash=excluded.token_hash, ' +
        'token_issued_at=excluded.token_issued_at, last_seen=excluded.last_seen',
      args: [key, key, now, now, 'token', value, now],
    });
    return;
  }
  const list = readJsonFile(MEMBERS_FALLBACK, []);
  const hit = list.find((item) => String(item.erp || '').toLowerCase() === key);
  if (hit) {
    hit.token_hash = value;
    hit.token_issued_at = now;
  } else {
    list.push({ erp: key, name: key, first_seen: now, last_seen: now, source: 'token', token_hash: value, token_issued_at: now });
  }
  writeJsonFile(MEMBERS_FALLBACK, list);
}

/* 使用心跳：同人同天累加次数，保留最近一次命令 / 版本 / 依赖 */
async function bumpUsage(beat) {
  const erp = String(beat.erp || '').toLowerCase();
  const date = String(beat.date || '').slice(0, 10);
  if (!erp || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const now = new Date().toISOString();
  const deps = typeof beat.deps === 'string' ? beat.deps : JSON.stringify(beat.deps || {});
  const payload = {
    count: 1,
    last_at: now,
    command: String(beat.command || '').slice(0, 40),
    skill_version: String(beat.skill_version || '').slice(0, 20),
    deps,
    os_name: String(beat.os_name || '').slice(0, 40),
  };
  if (client) {
    await ensureSchema();
    await client.call('POST', '/exec', {
      sql:
        'INSERT INTO usage(erp,date,count,last_at,command,skill_version,deps,os_name) VALUES (?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(erp,date) DO UPDATE SET count=usage.count+1, last_at=excluded.last_at, ' +
        'command=excluded.command, skill_version=excluded.skill_version, deps=excluded.deps, os_name=excluded.os_name',
      args: [erp, date, payload.count, now, payload.command, payload.skill_version, payload.deps, payload.os_name],
    });
    return;
  }
  const list = readJsonFile(USAGE_FALLBACK, []);
  const hit = list.find((item) => String(item.erp).toLowerCase() === erp && item.date === date);
  if (hit) {
    hit.count = Number(hit.count || 0) + 1;
    Object.assign(hit, { last_at: now, command: payload.command, skill_version: payload.skill_version, deps, os_name: payload.os_name });
  } else {
    list.push({ erp, date, ...payload });
  }
  writeJsonFile(USAGE_FALLBACK, list);
}

/* 取某天之后的全部心跳，按人聚合 */
async function usageSince(dateText) {
  if (!client) {
    return readJsonFile(USAGE_FALLBACK, []).filter((item) => String(item.date || '') >= dateText);
  }
  await ensureSchema();
  const result = await client.call('POST', '/query', {
    sql: 'SELECT erp, date, count, last_at, command, skill_version, deps, os_name FROM usage WHERE date >= ? ORDER BY date ASC',
    args: [dateText],
  });
  return rowsOf(result).map((row) => ({
    erp: String(row.erp || '').toLowerCase(),
    date: String(row.date || ''),
    count: Number(row.count || 0),
    last_at: String(row.last_at || ''),
    command: String(row.command || ''),
    skill_version: String(row.skill_version || ''),
    deps: String(row.deps || ''),
    os_name: String(row.os_name || ''),
  }));
}

module.exports = {
  usingDataLayer: Boolean(client),
  loadAll,
  insert,
  remove,
  count,
  members,
  upsertMember,
  tokenHashOf,
  saveTokenHash,
  bumpUsage,
  usageSince,
};
