/* 简洁版看板：今日完成矩阵（7 人 × 今日作业），一屏看完谁还没做。零依赖。 */
(function () {
  var SNAPSHOT = window.__JX_SNAPSHOT__ || null;
  var WEEK = '日一二三四五六';
  var STATUS_TEXT = { done: '完成', skipped: '不适用', running: '进行中', failed: '失败', blocked: '阻塞', pending: '未开始' };
  var params = new URLSearchParams(location.search);

  function localDate() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  var date = params.get('date') || (SNAPSHOT && SNAPSHOT.date) || localDate();
  var demoQuery = !SNAPSHOT && params.get('demo') === '1' ? '&demo=1' : '';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function prettyDate(text) {
    var parts = String(text).split('-');
    if (parts.length !== 3) return text;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return parts[0] + '年' + Number(parts[1]) + '月' + Number(parts[2]) + '日 · 周' + WEEK[d.getDay()];
  }

  function isDone(status) {
    return status === 'done' || status === 'skipped';
  }

  // 心跳时间戳（ISO）→ 本地 HH:MM，用来展示「今天几点还在用」
  function clockOf(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function kvText(obj) {
    if (!obj) return '';
    var keys = Object.keys(obj);
    return keys.map(function (k) {
      var v = obj[k];
      return k + ' ' + (v === null || v === undefined ? '—' : v);
    }).join(' · ');
  }

  function locate(key) {
    var card = document.getElementById('detailCard');
    var body = document.getElementById('detailWrap');
    var totals = document.getElementById('detailTotals');
    var btn = document.getElementById('toggleDetail');
    if (!card) return;
    if (body && body.style.display === 'none') {
      body.style.display = '';
      if (totals) totals.style.display = '';
      if (btn) btn.textContent = '收起';
    }
    var row = document.querySelector('tr[data-key="' + key + '"]');
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.className = 'flash';
    setTimeout(function () { row.className = ''; }, 2200);
  }

  function renderDetail(data) {
    var card = document.getElementById('detailCard');
    if (!card) return;
    if (SNAPSHOT) { card.style.display = 'none'; return; }
    var tasks = (data.matrix && data.matrix.tasks) || [];
    var people = (data.matrix && data.matrix.people) || [];
    var tbody = document.getElementById('detailRows');
    var totalBox = document.getElementById('detailTotals');
    if (!tbody || !totalBox) return;
    tbody.textContent = '';
    totalBox.textContent = '';

    tasks.forEach(function (task) {
      var sums = {};
      var rows = [];
      people.forEach(function (person) {
        var cell = (person.cells || {})[task.id];
        if (!cell) return;
        var metrics = cell.metrics || {};
        var evidence = cell.evidence || {};
        var hasDetail = cell.summary || Object.keys(metrics).length || Object.keys(evidence).length;
        if (!hasDetail) return;
        Object.keys(metrics).forEach(function (k) {
          var num = Number(metrics[k]);
          if (isFinite(num) && String(metrics[k]).trim() !== '') sums[k] = (sums[k] || 0) + num;
        });
        rows.push({ person: person, cell: cell, metrics: metrics, evidence: evidence });
      });
      if (!rows.length) return;

      var sumText = kvText(sums);
      var item = el('span');
      item.appendChild(el('b', null, task.short || task.name));
      item.appendChild(document.createTextNode(' ' + (sumText || '已留痕') + ' （' + rows.length + ' 人留痕）'));
      totalBox.appendChild(item);

      rows.forEach(function (row) {
        var tr = el('tr');
        tr.setAttribute('data-key', String(row.person.erp).toLowerCase() + '|' + task.id);
        var who = el('td');
        who.appendChild(el('div', null, row.person.name));
        who.appendChild(el('small', null, row.person.erp));
        tr.appendChild(who);
        tr.appendChild(el('td', null, task.name || task.short));
        var statusCell = el('td');
        statusCell.appendChild(el('span', 'chip ' + (row.cell.status || 'pending'),
          STATUS_TEXT[row.cell.status || 'pending'] || row.cell.status));
        tr.appendChild(statusCell);
        tr.appendChild(el('td', 'sum', row.cell.summary || ''));
        tr.appendChild(el('td', 'meta-cell', kvText(row.metrics)));
        tr.appendChild(el('td', 'meta-cell', kvText(row.evidence)));
        tr.appendChild(el('td', null, row.cell.updated_at || row.cell.error || ''));
        tbody.appendChild(tr);
      });
    });

    if (!tbody.children.length) {
      totalBox.textContent = '今天还没有留痕记录。';
    }
  }

  function render(data) {
    var kpis = data.kpis || {};
    var tasks = (data.matrix && data.matrix.tasks) || [];
    var people = (data.matrix && data.matrix.people) || [];

    document.getElementById('dateLabel').textContent = prettyDate(data.date || date);
    document.getElementById('rateLabel').textContent =
      (kpis.done || 0) + '/' + (kpis.expected || 0) + ' · ' + (kpis.rate || 0) + '%' +
      (kpis.people_active === undefined ? '' : ' · 在用 ' + (kpis.people_active || 0) + ' 人');

    if (SNAPSHOT) {
      var pill = document.getElementById('livePill');
      pill.innerHTML = '<i></i> ' + (SNAPSHOT.demo ? '演示快照' : '静态快照');
      pill.style.background = SNAPSHOT.demo ? '#fffaeb' : '#eff4ff';
      pill.style.color = SNAPSHOT.demo ? '#b54708' : '#175cd3';
    }

    var headRow = document.getElementById('headRow');
    // 每次刷新先清掉上一次渲染的作业列，避免表头越刷越多（保留左上角「成员 / 作业」）
    Array.prototype.slice.call(headRow.querySelectorAll('th:not(.who)')).forEach(function (th) {
      th.parentNode.removeChild(th);
    });
    tasks.forEach(function (task) {
      var th = el('th');
      if (task.priority) th.appendChild(el('span', 'pri', task.priority));
      th.appendChild(el('span', 'tname', task.short || task.name));
      if (task.time) th.appendChild(el('span', 'tmeta', String(task.time).replace(/^每天\s*/, '')));
      headRow.appendChild(th);
    });

    var body = document.getElementById('rows');
    body.textContent = '';
    people.forEach(function (person) {
      var tr = el('tr');

      var who = el('td', 'who');
      var inner = el('div', 'who-inner');
      inner.appendChild(el('div', 'avatar', String(person.name || '?').slice(0, 1)));
      var text = el('div', 'who-text');
      text.appendChild(el('b', null, person.name));
      text.appendChild(el('small', null, person.erp));
      text.appendChild(el('small', null, (person.done || 0) + '/' + (person.expected || 0) + ' · ' + (person.rate || 0) + '%'));
      // 使用情况：心跳自动上报，和作业完成分开看
      var use = person.usage;
      var used = use && Number(use.count) > 0;
      var useEl = el(
        'small',
        used ? 'use use-on' : 'use use-off',
        used ? '今日已用 ' + Number(use.count) + ' 次' + (clockOf(use.last_at) ? ' · ' + clockOf(use.last_at) : '') : '今日未用技能'
      );
      var tip = [];
      if (use && use.skill_version) tip.push('技能 v' + use.skill_version);
      if (use && use.command) tip.push('最近命令 ' + use.command);
      if (person.enrolled) tip.push('自助入册（首次领令牌/上报自动登记）');
      if (tip.length) useEl.title = tip.join(' · ');
      text.appendChild(useEl);
      inner.appendChild(text);
      who.appendChild(inner);
      tr.appendChild(who);

      var cells = person.cells || {};
      tasks.forEach(function (task) {
        var cell = cells[task.id];
        var td = el('td', 'cell');
        if (!cell) {
          td.className = 'cell na';
          td.textContent = '—';
        } else {
          var status = cell.status || 'pending';
          var chip = el('span', 'chip ' + status, STATUS_TEXT[status] || status);
          if (cell.overdue && !isDone(status)) chip.textContent += ' · 逾期';
          td.appendChild(chip);
          if (isDone(status)) {
            td.className = 'cell done';
            td.title = '点击查看该格明细';
            td.addEventListener('click', (function (key) {
              return function () { locate(key); };
            })(String(person.erp).toLowerCase() + '|' + task.id));
          }
        }
        tr.appendChild(td);
      });

      body.appendChild(tr);
    });

    renderDetail(data);

    document.getElementById('note').textContent = (SNAPSHOT
      ? (SNAPSHOT.demo ? '只读演示快照（示例数据，不代表真实完成情况）' : '只读快照')
        + ' · 生成于 ' + new Date(SNAPSHOT.generated_at).toLocaleString('zh-CN') + '，不会自动更新'
      : '实时数据 · 每 60 秒自动刷新 · 成员留痕后自动出现')
      + ' · 口径：只认「完成 / 不适用」；逾期 = 超过计划时间 + 宽限仍未留痕；'
      + '「今日已用」= 技能心跳自动上报，只表示在用，不代表该项作业完成。';
  }

  function load() {
    fetch('/api/dashboard?date=' + encodeURIComponent(date) + '&days=1' + demoQuery)
      .then(function (res) { return res.json(); })
      .then(render)
      .catch(function (error) {
        var note = document.getElementById('note');
        note.textContent = '加载失败：' + error.message;
      });
  }

  var toggle = document.getElementById('toggleDetail');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var body = document.getElementById('detailWrap');
      var totals = document.getElementById('detailTotals');
      var collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      if (totals) totals.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '收起' : '展开';
    });
  }

  load();
  if (!SNAPSHOT) {
    setInterval(function () {
      if (!document.hidden) load();
    }, 60000);
  }
})();
