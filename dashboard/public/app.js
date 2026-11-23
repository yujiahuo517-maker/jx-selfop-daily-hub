/* global fetch */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const STATUS = {
  pending: { label: '未开始', cls: 'pending' },
  running: { label: '进行中', cls: 'running' },
  done: { label: '已完成', cls: 'done' },
  failed: { label: '失败', cls: 'failed' },
  blocked: { label: '阻塞', cls: 'blocked' },
  skipped: { label: '已跳过', cls: 'skipped' },
};

const AVATAR_COLORS = ['#d92d20', '#175cd3', '#067647', '#6941c6', '#b54708', '#0e7090', '#c11574'];

const state = {
  date: localDate(new Date()),
  days: 14,
  demo: false,
  data: null,
  loading: false,
};

function localDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function avatar(name, size) {
  const text = String(name || '?').slice(0, 1);
  let hash = 0;
  for (const char of String(name || '?')) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return `<span class="avatar" style="background:${color};${size ? `width:${size}px;height:${size}px;` : ''}">${escapeHtml(text)}</span>`;
}

function statusMeta(status, overdue) {
  const meta = STATUS[status] || STATUS.pending;
  if (overdue && (status === 'pending' || status === 'running')) {
    return { label: '逾期未完成', cls: `${meta.cls} overdue` };
  }
  return meta;
}

function chip(status, overdue, compact) {
  const meta = statusMeta(status, overdue);
  return `<span class="chip ${meta.cls}"${compact ? ' style="min-width:52px;height:21px;font-size:9px"' : ''}>${escapeHtml(meta.label)}</span>`;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2400);
}

async function loadDashboard(showSpinner = true) {
  if (state.loading) return;
  state.loading = true;
  if (showSpinner) $('#livePill').innerHTML = '<i></i> 加载中';
  const query = new URLSearchParams({ date: state.date, days: String(state.days) });
  if (state.demo) query.set('demo', '1');
  try {
    const response = await fetch(`/api/dashboard?${query.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    render();
    $('#livePill').className = `live-pill${state.demo ? ' demo' : ''}`;
    $('#livePill').innerHTML = `<i></i> ${state.demo ? '演示数据' : '实时数据'}`;
    $('#exportBtn').href = `/api/export.csv?${query.toString()}`;
  } catch (error) {
    $('#livePill').className = 'live-pill demo';
    $('#livePill').innerHTML = '<i></i> 连接失败';
    toast(`看板加载失败：${error.message}`);
  } finally {
    state.loading = false;
  }
}

function render() {
  const data = state.data;
  if (!data) return;
  renderDate(data);
  renderKpis(data);
  renderMatrix(data);
  renderTaskProgress(data);
  renderAlerts(data);
  renderPeople(data);
  renderTrend(data);
  renderPeriodic(data);
  renderConnect(data);
  $('#generatedAt').textContent = `更新于 ${new Date(data.generated_at).toLocaleString('zh-CN', { hour12: false })} · ${data.source === 'demo' ? '演示模式' : '生产数据'}`;
}

function renderDate(data) {
  const [y, m, d] = data.date.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  $('#dateStamp').textContent = `${m}月${d}日`;
  $('#dateWeek').textContent = `${y} · ${week}`;
  $('#datePicker').value = data.date;
}

function ring(rate) {
  const p = Math.max(0, Math.min(100, Number(rate) || 0));
  return `<div class="ring-wrap"><div class="ring" style="--p:${p}%" data-label="${p}%"></div></div>`;
}

function sparkline(trend, key, color) {
  if (!trend || trend.length < 2) return '';
  const values = trend.map((item) => Number(item[key]) || 0);
  const max = Math.max(1, ...values);
  const w = 58;
  const h = 26;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * w},${h - (value / max) * (h - 3) - 1}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderKpis(data) {
  const k = data.kpis;
  const trend = data.trend || [];
  const html = `
    <div class="kpi main">
      <div class="kpi-label">今日完成率</div>
      <div class="kpi-value">${k.rate}<small>%</small></div>
      <div class="kpi-foot"><b>${k.done}</b> / ${k.expected} 项作业已完成</div>
      ${ring(k.rate)}
    </div>
    <div class="kpi">
      <div class="kpi-label">已完成</div>
      <div class="kpi-value">${k.done}<small> 项</small></div>
      <div class="kpi-foot">应完成 <b>${k.expected}</b> 项 · 覆盖 <b>${k.tasks_total}</b> 类作业</div>
      ${sparkline(trend, 'done', '#067647')}
    </div>
    <div class="kpi danger">
      <div class="kpi-label">失败 / 阻塞</div>
      <div class="kpi-value">${k.failed}<small> 项</small></div>
      <div class="kpi-foot">${k.failed ? '需要人工介入处理' : '当前没有失败项'}</div>
      ${sparkline(trend, 'failed', '#d92d20')}
    </div>
    <div class="kpi warn">
      <div class="kpi-label">逾期未完成</div>
      <div class="kpi-value">${k.overdue}<small> 项</small></div>
      <div class="kpi-foot">超过计划时间且未留痕</div>
      ${sparkline(trend, 'overdue', '#b54708')}
    </div>
    <div class="kpi">
      <div class="kpi-label">今日有留痕</div>
      <div class="kpi-value">${k.people_reported}<small> / ${k.people_total} 人</small></div>
      <div class="kpi-foot">${k.people_total ? Math.round((k.people_reported / k.people_total) * 100) : 0}% 成员已产生执行记录</div>
    </div>`;
  $('#kpis').innerHTML = html;
}

function renderMatrix(data) {
  const tasks = data.matrix.tasks || [];
  const people = data.matrix.people || [];
  if (!tasks.length) {
    $('#matrix').innerHTML = '<div class="empty-state"><b>—</b>今日没有应完成作业</div>';
    return;
  }
  const head = tasks.map((task) => `
    <th title="${escapeHtml(task.name)} · ${escapeHtml(task.time)}">
      <span class="th-inner">
        <span class="prio ${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>
        <span>${escapeHtml(task.short || task.name)}</span>
        <span style="font-weight:400;color:#98a2b3">${escapeHtml(task.time || '')}</span>
      </span>
    </th>`).join('');
  const body = people.map((person) => {
    const cells = tasks.map((task) => {
      const cell = person.cells[task.id];
      if (!cell) return '<td><span class="chip na">—</span></td>';
      return `<td><button class="cell-btn" data-erp="${escapeHtml(person.erp)}" data-task="${escapeHtml(task.id)}" type="button">${chip(cell.status, cell.overdue)}</button></td>`;
    }).join('');
    return `<tr>
      <th scope="row">
        <div class="person-cell">
          ${avatar(person.name)}
          <div class="person-meta">
            <strong>${escapeHtml(person.name)}</strong>
            <small>${escapeHtml(person.erp)}</small>
            <span class="person-rate">${person.done}/${person.expected} · ${person.rate}%</span>
          </div>
        </div>
      </th>
      ${cells}
    </tr>`;
  }).join('');
  $('#matrix').innerHTML = `<table class="matrix"><thead><tr><th style="text-align:left;padding-left:16px">成员 / 作业</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderTaskProgress(data) {
  const tasks = data.by_task || [];
  $('#taskCount').textContent = `${tasks.length} 项`;
  if (!tasks.length) {
    $('#taskProgress').innerHTML = '<div class="alert-empty">今日无任务</div>';
    return;
  }
  $('#taskProgress').innerHTML = tasks.map((task) => {
    const percent = task.expected ? Math.round((task.done / task.expected) * 100) : 0;
    const cls = task.failed ? 'bad' : percent === 100 ? 'full' : '';
    return `<div class="progress-item" title="${escapeHtml(task.name)}">
      <div class="progress-top">
        <span class="progress-name">${escapeHtml(task.name)}</span>
        <span class="progress-val">${task.done}/${task.expected}${task.failed ? ` · <span style="color:#d92d20">${task.failed}失败</span>` : ''}</span>
      </div>
      <div class="bar"><i class="${cls}" style="width:${percent}%"></i></div>
    </div>`;
  }).join('');
}

function renderAlerts(data) {
  const alerts = data.alerts || [];
  $('#alertCount').textContent = String(alerts.length);
  if (!alerts.length) {
    $('#alerts').innerHTML = '<div class="alert-empty"><b>✓</b>今日暂无异常，全部按计划推进</div>';
    return;
  }
  $('#alerts').innerHTML = alerts.slice(0, 12).map((alert) => `
    <div class="alert-item" data-erp="${escapeHtml(alert.erp)}" data-task="${escapeHtml(alert.task_id)}">
      <i class="alert-icon${alert.overdue ? ' overdue' : ''}"></i>
      <div class="alert-main">
        <div class="alert-title">${escapeHtml(alert.name)} · ${escapeHtml(alert.task_name)}</div>
        <div class="alert-sub">${escapeHtml(alert.status === 'failed' || alert.status === 'blocked' ? ((STATUS[alert.status] || {}).label || '异常') : alert.overdue ? '逾期未完成' : (STATUS[alert.status] || {}).label || alert.status)}${alert.error ? ` · ${escapeHtml(alert.error).slice(0, 42)}` : ''}</div>
      </div>
    </div>`).join('');
}

function renderPeople(data) {
  const people = data.matrix.people || [];
  const tasks = data.matrix.tasks || [];
  if (!people.length) {
    $('#tab-people').innerHTML = '<div class="empty-state">暂无人员数据</div>';
    return;
  }
  $('#tab-people').innerHTML = `<div class="people-grid">${people.map((person) => {
    const rows = tasks.filter((task) => person.cells[task.id]).map((task) => {
      const cell = person.cells[task.id];
      return `<div class="mini-task">
        <span class="name" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</span>
        ${chip(cell.status, cell.overdue, true)}
      </div>`;
    }).join('');
    return `<article class="person-card">
      <div class="person-card-head">
        ${avatar(person.name, 34)}
        <div><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(person.erp)}</p></div>
        <div class="score"><strong>${person.rate}%</strong><span>${person.done}/${person.expected}</span></div>
      </div>
      <div class="mini-tasks">${rows || '<span class="muted">今日无作业</span>'}</div>
    </article>`;
  }).join('')}</div>`;
}

function svgTrend(trend) {
  const width = 1000;
  const height = 270;
  const pad = { left: 38, right: 18, top: 18, bottom: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (trend.length <= 1 ? innerW / 2 : (index / (trend.length - 1)) * innerW);
  const y = (rate) => pad.top + innerH - (Math.max(0, Math.min(100, rate)) / 100) * innerH;
  const grid = [0, 25, 50, 75, 100].map((value) => `
    <line x1="${pad.left}" y1="${y(value)}" x2="${width - pad.right}" y2="${y(value)}" stroke="#e4e7ec" stroke-width="1" stroke-dasharray="${value === 0 ? '0' : '3 5'}"/>
    <text x="${pad.left - 9}" y="${y(value) + 3}" text-anchor="end" font-size="9" fill="#98a2b3">${value}%</text>`).join('');
  const points = trend.map((item, index) => `${x(index)},${y(item.rate)}`).join(' ');
  const area = `M ${x(0)} ${y(0)} L ${points.split(' ').join(' L ')} L ${x(trend.length - 1)} ${y(0)} Z`;
  const dots = trend.map((item, index) => `<circle cx="${x(index)}" cy="${y(item.rate)}" r="3.2" fill="#fff" stroke="#d92d20" stroke-width="2"><title>${escapeHtml(item.date)} · 完成率 ${item.rate}% · ${item.done}/${item.expected} · 失败 ${item.failed}</title></circle>`).join('');
  const labels = trend.map((item, index) => (index % Math.ceil(trend.length / 8) === 0 || index === trend.length - 1)
    ? `<text x="${x(index)}" y="${height - 12}" text-anchor="middle" font-size="9" fill="#98a2b3">${escapeHtml(item.date.slice(5))}</text>`
    : '').join('');
  return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="近 14 天完成率趋势">
    <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f97066" stop-opacity="0.28"/><stop offset="100%" stop-color="#f97066" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#areaFill)"/>
    <polyline points="${points}" fill="none" stroke="#d92d20" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}${labels}
  </svg>`;
}

function renderTrend(data) {
  const trend = data.trend || [];
  if (!trend.length) {
    $('#tab-trend').innerHTML = '<div class="empty-state">暂无趋势数据</div>';
    return;
  }
  const avg = Math.round((trend.reduce((sum, item) => sum + item.rate, 0) / trend.length) * 10) / 10;
  const best = trend.reduce((a, b) => (b.rate > a.rate ? b : a), trend[0]);
  const totalDone = trend.reduce((sum, item) => sum + item.done, 0);
  const totalFailed = trend.reduce((sum, item) => sum + item.failed, 0);
  $('#tab-trend').innerHTML = `
    <div class="trend-wrap">
      <div class="trend-legend"><span><i style="background:#d92d20"></i>完成率</span><span>悬停数据点查看当日明细</span></div>
      ${svgTrend(trend)}
      <div class="trend-note">统计口径：当日应完成作业（按人员与排期展开）中，状态为已完成或已跳过的占比。</div>
    </div>
    <div class="trend-stats">
      <div class="trend-stat"><span>区间平均完成率</span><strong>${avg}%</strong></div>
      <div class="trend-stat"><span>最佳单日</span><strong>${escapeHtml(best.date.slice(5))} · ${best.rate}%</strong></div>
      <div class="trend-stat"><span>累计完成</span><strong>${totalDone} 项</strong></div>
      <div class="trend-stat"><span>累计失败</span><strong style="color:${totalFailed ? '#d92d20' : '#067647'}">${totalFailed} 项</strong></div>
    </div>`;
}

function renderPeriodic(data) {
  const items = data.periodic || [];
  if (!items.length) {
    $('#tab-periodic').innerHTML = '<div class="empty-state">暂无定期作业</div>';
    return;
  }
  $('#tab-periodic').innerHTML = `
    <table class="data">
      <thead><tr><th style="width:28%">作业</th><th>优先级</th><th>负责人</th><th>排期</th><th>启用状态</th><th style="width:30%">说明</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><b>${escapeHtml(item.name)}</b><div class="muted">${escapeHtml(item.id)}</div></td>
          <td><span class="prio ${escapeHtml(item.priority)}" style="font-size:9px;padding:2px 5px;border-radius:4px;background:#f2f4f7">${escapeHtml(item.priority)}</span></td>
          <td>${escapeHtml(item.owner_label)}</td>
          <td>${escapeHtml(item.schedule_label)}</td>
          <td>${item.status === 'ready' ? '<span class="status-note ready">已启用</span>' : item.status === 'needs_confirmation' ? '<span class="status-note">待确认</span>' : '<span class="status-note">待补 SOP</span>'}</td>
          <td class="muted">${escapeHtml(item.summary)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function renderConnect(data) {
  const origin = location.origin;
  $('#tab-connect').innerHTML = `
    <div class="connect-grid">
      <div class="connect-card">
        <h3>管理员：采集全员状态</h3>
        <p>在本机运行看板服务，把局域网地址发给团队。采销完成作业后会自动上报，也可手动补报。</p>
        <div class="code">cd jx-selfop-daily-hub
<span class="accent">python</span> scripts/jx_task.py serve --port 8080

<span class="accent"># 采集接口</span>
POST ${escapeHtml(origin)}/api/report</div>
        <button class="btn btn-ghost copy-btn" data-copy="python scripts/jx_task.py serve --port 8080" type="button">复制启动命令</button>
        <div class="flow">
          <div class="flow-step"><b>1</b><span>管理员在固定电脑启动服务，保证同事可访问；端口需放通。</span></div>
          <div class="flow-step"><b>2</b><span>把技能包 + 采集地址分发给 7 位采销。</span></div>
          <div class="flow-step"><b>3</b><span>成员执行 <code>init --server ${escapeHtml(origin)}</code>，之后每项作业完成自动上报。</span></div>
          <div class="flow-step"><b>4</b><span>管理员刷新本页，按日期、人员、任务查看完成率与异常。</span></div>
        </div>
      </div>
      <div class="connect-card">
        <h3>采销：一次初始化，执行即留痕</h3>
        <p>每项作业开始前 <code>start</code>，完成后 <code>done</code>。没有留痕不会计为完成。</p>
        <div class="code"><span class="accent">python</span> scripts/jx_task.py init \\
  --erp &lt;本人ERP&gt; --name &lt;姓名&gt; \\
  --server ${escapeHtml(origin)}

<span class="accent">python</span> scripts/jx_task.py today
<span class="accent">python</span> scripts/jx_task.py start --task super_subsidy
<span class="accent">python</span> scripts/jx_task.py done --task super_subsidy \\
  --summary "候选12/预检10/新增8" \\
  --metric 候选数=12 --metric 预检通过数=10</div>
        <button class="btn btn-ghost copy-btn" data-copy="python scripts/jx_task.py today" type="button">复制查看今日作业</button>
        <div class="flow">
          <div class="flow-step"><b>!</b><span>只允许本人登录态；失败必须写原始原因，禁止把未完成标成完成。</span></div>
          <div class="flow-step"><b>↻</b><span>断网或服务未开时记录留在本机，恢复后运行 <code>report</code> 补报。</span></div>
          <div class="flow-step"><b>⇩</b><span>也可导出 CSV 归档；看板支持导入 JoySpace / Excel 状态表。</span></div>
        </div>
      </div>
    </div>`;
  $$('.copy-btn').forEach((button) => {
    button.addEventListener('click', () => copyText(button.dataset.copy || ''));
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch (error) {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast('已复制');
  }
}

function findContext(erp, taskId) {
  const data = state.data;
  if (!data) return null;
  const person = (data.matrix.people || []).find((item) => item.erp === erp);
  const task = (data.matrix.tasks || []).find((item) => item.id === taskId);
  if (!person || !task) return null;
  return { person, task, cell: person.cells[taskId] || null };
}

function openDrawer(erp, taskId) {
  const ctx = findContext(erp, taskId);
  if (!ctx) return;
  const { person, task, cell } = ctx;
  const meta = cell ? statusMeta(cell.status, cell.overdue) : { label: '不适用', cls: 'na' };
  $('#drawerKicker').textContent = `${task.priority} · ${task.category || '作业'} · ${task.time || ''}`;
  $('#drawerTitle').textContent = task.name;
  const metrics = cell && cell.metrics ? Object.entries(cell.metrics) : [];
  const evidence = cell && cell.evidence ? Object.entries(cell.evidence) : [];
  $('#drawerBody').innerHTML = `
    <div class="detail-hero">
      ${avatar(person.name, 38)}
      <div><h4>${escapeHtml(person.name)}</h4><p>${escapeHtml(person.erp)}</p></div>
      <span class="chip ${meta.cls}">${escapeHtml(meta.label)}</span>
    </div>
    <div class="detail-grid">
      <div class="detail-box"><span>作业日期</span><strong>${escapeHtml(state.data.date)}</strong></div>
      <div class="detail-box"><span>计划时间</span><strong>${escapeHtml(task.time || '按通知')}</strong></div>
      <div class="detail-box"><span>最后更新</span><strong>${escapeHtml(cell && cell.updated_at ? new Date(cell.updated_at).toLocaleString('zh-CN', { hour12: false }) : '无记录')}</strong></div>
      <div class="detail-box"><span>耗时</span><strong>${cell && cell.duration_sec ? `${Math.round(cell.duration_sec / 60)} 分钟` : '—'}</strong></div>
    </div>
    <div class="detail-section">
      <h5>执行摘要</h5>
      <p>${escapeHtml(cell && cell.summary ? cell.summary : '暂无执行摘要')}</p>
    </div>
    ${cell && cell.error ? `<div class="detail-section"><h5>异常 / 原始原因</h5><p style="color:#b42318">${escapeHtml(cell.error)}</p></div>` : ''}
    ${metrics.length ? `<div class="detail-section"><h5>关键指标</h5><div class="kv-list">${metrics.map(([key, value]) => `<div class="kv"><span>${escapeHtml(key)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</div></div>` : ''}
    ${evidence.length ? `<div class="detail-section"><h5>证据 / 回执</h5><div class="kv-list">${evidence.map(([key, value]) => `<div class="kv"><span>${escapeHtml(key)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</div></div>` : ''}
    ${cell && cell.url ? `<div class="detail-section"><h5>结果链接</h5><p><a href="${escapeHtml(cell.url)}" target="_blank" rel="noreferrer">${escapeHtml(cell.url)}</a></p></div>` : ''}
    <p class="hint" style="padding:0">管理员手工修正会以「手工修正」写入采集端，不覆盖历史记录。</p>`;
  $('#drawerFoot').innerHTML = cell ? `
    <button class="btn btn-green" data-action="done" data-erp="${escapeHtml(erp)}" data-task="${escapeHtml(taskId)}" type="button">标记完成</button>
    <button class="btn btn-red" data-action="failed" data-erp="${escapeHtml(erp)}" data-task="${escapeHtml(taskId)}" type="button">标记失败</button>
    <button class="btn btn-plain" data-action="pending" data-erp="${escapeHtml(erp)}" data-task="${escapeHtml(taskId)}" type="button">重置未开始</button>` : '<span class="muted">该成员今日不适用此作业</span>';
  $('#drawer').classList.add('show');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawerMask').classList.add('show');
}

function closeDrawer() {
  $('#drawer').classList.remove('show');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawerMask').classList.remove('show');
}

async function submitManual(erp, taskId, action) {
  const ctx = findContext(erp, taskId);
  if (!ctx) return;
  const { person, task } = ctx;
  let summary = '管理员手工修正';
  let error = '';
  let status = action;
  if (action === 'done') {
    const note = window.prompt('填写完成说明（可留空）：', '管理员手工修正');
    if (note === null) return;
    summary = note || '管理员手工修正';
  } else if (action === 'failed') {
    const reason = window.prompt('请填写失败原因：', '需人工复核');
    if (!reason) return;
    error = reason;
    summary = '管理员标记失败';
  } else {
    status = 'pending';
    summary = '';
  }
  const body = {
    date: state.data.date,
    task_id: taskId,
    task_name: task.name,
    priority: task.priority,
    erp: person.erp,
    name: person.name,
    status,
    summary,
    error,
    source: 'manual-admin',
  };
  try {
    const response = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
    toast('状态已更新');
    closeDrawer();
    await loadDashboard(false);
  } catch (error) {
    toast(`更新失败：${error.message}`);
  }
}

function bindEvents() {
  $('#datePicker').addEventListener('change', (event) => {
    state.date = event.target.value || localDate(new Date());
    loadDashboard();
  });
  $('#rangePicker').addEventListener('change', (event) => {
    state.days = Number(event.target.value) || 14;
    loadDashboard();
  });
  $('#demoToggle').addEventListener('change', (event) => {
    state.demo = event.target.checked;
    loadDashboard();
  });
  $('#refreshBtn').addEventListener('click', () => loadDashboard());
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerMask').addEventListener('click', closeDrawer);

  $('#matrix').addEventListener('click', (event) => {
    const button = event.target.closest('.cell-btn');
    if (button) openDrawer(button.dataset.erp, button.dataset.task);
  });
  $('#alerts').addEventListener('click', (event) => {
    const item = event.target.closest('.alert-item');
    if (item) openDrawer(item.dataset.erp, item.dataset.task);
  });
  $('#drawerFoot').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (button) submitManual(button.dataset.erp, button.dataset.task, button.dataset.action);
  });

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((item) => item.classList.toggle('active', item === tab));
      $$('.tab-body').forEach((body) => body.classList.add('hidden'));
      $(`#tab-${tab.dataset.tab}`).classList.remove('hidden');
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
  });

  setInterval(() => {
    if (!document.hidden) loadDashboard(false);
  }, 60000);
}

function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('date')) state.date = params.get('date');
  if (params.get('days')) state.days = Number(params.get('days')) || 14;
  if (params.get('demo') === '1') state.demo = true;
  $('#datePicker').value = state.date;
  $('#rangePicker').value = String(state.days);
  $('#demoToggle').checked = state.demo;
  bindEvents();
  loadDashboard();
}

init();
