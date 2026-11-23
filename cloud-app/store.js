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

module.exports = {
  usingDataLayer: Boolean(client),
  loadAll,
  insert,
  remove,
  count,
};
