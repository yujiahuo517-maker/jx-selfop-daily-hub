#!/usr/bin/env node
/*
 * 把看板导出为单文件静态页（只读快照）。
 * 适用场景：发布到内部平台 / 静态托管 / 直接发 HTML 给团队预览。
 *
 * 用法：
 *   node dashboard/export-static.js --out dashboard-static.html
 *   node dashboard/export-static.js --out preview.html --demo
 *   node dashboard/export-static.js --out 1119.html --date 2026-11-19 --days 14
 */

const fs = require('fs');
const path = require('path');
const { buildDashboard, buildCsv, isoDate } = require('./server.js');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const PUBLIC = path.join(__dirname, 'public');
const OUT = path.resolve(arg('--out', path.join(__dirname, '..', 'dashboard-static.html')));
const DATE = arg('--date', isoDate(new Date()));
const DAYS = Math.max(1, Math.min(60, Number(arg('--days', 14)) || 14));
const DEMO = args.includes('--demo');
// 发布到平台时建议关闭 CSV 导出：平台的静态审查会把浏览器端下载动作判为“数据导出”高风险
const EXPORT_ENABLED = !args.includes('--no-export');

const SHIM = `
(function () {
  var S = window.__JX_SNAPSHOT__;
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  function jsonResponse(obj, status) {
    return Promise.resolve(new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }));
  }
  window.fetch = function (input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/dashboard') >= 0) return jsonResponse(S.dashboard);
    if (url.indexOf('/api/tasks') >= 0) return jsonResponse({ tasks: [] });
    if (url.indexOf('/api/roster') >= 0) return jsonResponse({ roster: [] });
    if (url.indexOf('/api/report') >= 0) {
      return jsonResponse({ ok: false, error: '静态快照只读，请访问管理员看板服务上报' }, 403);
    }
    // 其余请求（同站其他页面、健康检查等）放行，避免静态页把整个 fetch 堵死
    if (nativeFetch) return nativeFetch(input, arguments[1]);
    return Promise.reject(new Error('static snapshot: ' + url));
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('static-snapshot');
    var pill = document.getElementById('livePill');
    if (pill) {
      pill.innerHTML = '<i></i> ' + (S.demo ? '演示快照' : '静态快照');
      pill.style.background = S.demo ? '#fffaeb' : '#eff4ff';
      pill.style.color = S.demo ? '#b54708' : '#175cd3';
    }
    ['datePicker', 'rangePicker', 'refreshBtn'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    var demoSwitch = document.getElementById('demoToggle');
    if (demoSwitch && demoSwitch.closest('.demo-switch')) {
      demoSwitch.closest('.demo-switch').style.display = 'none';
    }
    var note = document.createElement('div');
    note.setAttribute('style', 'margin:16px 0 0;padding:10px 14px;border:1px solid #e4e7ec;border-left:3px solid #175cd3;background:#f9fafb;border-radius:8px;font-size:13px;line-height:1.6;color:#475467;');
    note.innerHTML =
      '只读静态快照 · 数据截至 <b>' + S.date + '</b>（统计近 ' + S.days + ' 天，' +
      (S.demo ? '含演示数据' : '真实上报数据') + '）· 生成于 ' +
      new Date(S.generated_at).toLocaleString('zh-CN') +
      '。需要实时数据与手工纠错，请访问管理员看板服务。';
    var hero = document.querySelector('.hero');
    if (hero && hero.parentNode) hero.parentNode.insertBefore(note, hero.nextSibling);
  }, { once: true });

  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('#exportBtn') : null;
    if (!target) return;
    event.preventDefault();
    var blob = new Blob([S.csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'jx-selfop-' + S.date + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }, true);
})();
`;

function guard(code) {
  return String(code).replace(/<\/script/gi, '<\\/script');
}

function buildShim(exportEnabled) {
  if (exportEnabled) return SHIM;
  const marker = "['datePicker', 'rangePicker', 'refreshBtn']";
  if (!SHIM.includes(marker)) throw new Error('隐藏控件列表标记丢失');
  let out = SHIM.replace(marker, "['datePicker', 'rangePicker', 'refreshBtn', 'exportBtn']");
  const start = out.indexOf("  document.addEventListener('click', function (event) {");
  const end = out.indexOf('}, true);', start);
  if (start === -1 || end === -1) throw new Error('导出逻辑标记丢失');
  out = out.slice(0, start) + out.slice(end + '}, true);'.length);
  return out;
}

const snapshot = {
  date: DATE,
  days: DAYS,
  demo: DEMO,
  generated_at: new Date().toISOString(),
  dashboard: buildDashboard(DATE, DAYS, DEMO),
  csv: EXPORT_ENABLED ? buildCsv(DATE, DAYS, DEMO) : '',
};

const ENTRY = (arg('--entry', 'full') || 'full').toLowerCase() === 'simple' ? 'simple' : 'full';
const PAGE_FILE = ENTRY === 'simple' ? 'simple.html' : 'index.html';
const JS_FILE = ENTRY === 'simple' ? 'simple.js' : 'app.js';

const html = fs.readFileSync(path.join(PUBLIC, PAGE_FILE), 'utf8');
const css = ENTRY === 'simple' ? '' : fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(PUBLIC, JS_FILE), 'utf8');

const styleTag = ENTRY === 'simple' ? '' : '<style>\n' + css + '\n</style>';
const scriptTags = [
  '<script>window.__JX_SNAPSHOT__ = ' + guard(JSON.stringify(snapshot)) + ';</script>',
  '<script>' + guard(buildShim(EXPORT_ENABLED)) + '</script>',
  '<script>' + guard(app) + '</script>',
].join('\n  ');

if (ENTRY === 'full' && !html.includes('<link rel="stylesheet" href="/styles.css" />')) {
  throw new Error('index.html 中未找到 styles.css 引用，导出模板已变更');
}
if (!html.includes('<script src="/' + JS_FILE + '"></script>')) {
  throw new Error(PAGE_FILE + ' 中未找到 ' + JS_FILE + ' 引用，导出模板已变更');
}

let out = html
  // 必须用函数式替换：样式/脚本内容里含 `$` 等字符，字符串替换会被当成 $& / $' 等替换模式。
  .replace('<script src="/' + JS_FILE + '"></script>', () => scriptTags);
if (ENTRY === 'full') {
  out = out.replace('<link rel="stylesheet" href="/styles.css" />', () => styleTag);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');

const kpis = snapshot.dashboard.kpis || {};
console.log('');
console.log('  静态快照已生成');
console.log('  文件：' + OUT);
console.log('  日期：' + DATE + ' · 近 ' + DAYS + ' 天 · ' + (DEMO ? '演示数据' : '真实数据'));
console.log('  完成率：' + kpis.rate + '%（' + kpis.done + '/' + kpis.expected + '）');
console.log('  大小：' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB');
console.log('');
