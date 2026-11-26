// Token Radar dashboard: renders window.RADAR (written by main.ts from the sealed
// snapshot). Fully offline: no fetch, no external links, no tracking. The model
// sandbox recomputes implied values from the per-row factors stored in the data.

const D = window.RADAR;
const $ = (id) => document.getElementById(id);
const WL = new Set(D.watchlist);

/** Escape text for HTML. */
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Compact money: $379.9M, $65.3M, $175K, $42. */
function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}

/** Full money with commas: $2,754,000,000. */
function moneyFull(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/** 7-day change: +2.4%, -2.2%, or — when unknown. */
function pct(v) {
  if (v === null || v === undefined) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

/** Age in days: 543d, or — when unknown. */
function age(v) {
  return v === null || v === undefined ? '—' : v + 'd';
}

const state = {
  tab: 'board',
  q: '',
  cat: '',
  chain: '',
  minTvl: 0,
  sortKey: 'rank',
  sortDir: 1,
  scale: 1,
  growthW: 0.6,
  matFloor: 0.5,
};

/** The sandbox's implied value for one row, from its stored factors. */
function sandboxImplied(r) {
  const g = r.growth_pct;
  const wUp = state.growthW;
  const wDown = wUp * (0.35 / 0.6);
  const gm = g >= 0 ? 1 + (g / 100) * wUp : 1 + (g / 100) * wDown;
  const days = r.age_days === null || r.age_days === undefined ? 365 : r.age_days;
  const mm = state.matFloor + (1 - state.matFloor) * (Math.min(days, 1460) / 1460);
  return Math.max(1, Math.round(r.tvl_usd * r.category_multiple * state.scale * gm * mm * r.breadth_multiplier));
}

function sandboxActive() {
  return state.scale !== 1 || state.growthW !== 0.6 || state.matFloor !== 0.5;
}

/** Rows after filters, with a display value and rank (sandbox recompute when active). */
function viewRows() {
  const q = state.q.trim().toLowerCase();
  let rows = D.rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q))) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (r.tvl_usd < state.minTvl) return false;
    return true;
  });
  if (sandboxActive()) {
    rows = rows.map((r) => ({ ...r, implied_value_usd: sandboxImplied(r) }));
    rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
    rows.forEach((r, i) => { r.viewRank = i + 1; });
  } else {
    rows = rows.map((r) => ({ ...r, viewRank: r.rank }));
  }
  const k = state.sortKey;
  const d = state.sortDir;
  const val = (r) => (k === 'name' ? r.name.toLowerCase() : k === 'rank' ? r.viewRank : r[k]);
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (va < vb ? -1 : va > vb ? 1 : 0) * d;
  });
  return rows;
}

function sortHeader(key, label, num) {
  const arrow = state.sortKey === key ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '';
  return `<th data-sort="${key}"${num ? ' class="num"' : ''}>${label}${arrow}</th>`;
}

function renderBoard() {
  const rows = viewRows();
  const total = D.rows.length;
  $('count').textContent = `Showing ${rows.length} of ${total} ranked protocols` +
    (sandboxActive() ? ' — sandbox active, ranks recomputed from your sliders' : '');
  let html = '<thead><tr>' +
    sortHeader('rank', '#') +
    sortHeader('name', 'Protocol') +
    sortHeader('category', 'Category') +
    '<th>Chains</th>' +
    sortHeader('tvl_usd', 'TVL', true) +
    sortHeader('change_7d', '7d', true) +
    sortHeader('age_days', 'Age', true) +
    sortHeader('category_multiple', 'Multiple', true) +
    sortHeader('implied_value_usd', 'Implied value', true) +
    '</tr></thead><tbody>';
  for (const r of rows) {
    const star = WL.has(r.slug) ? ' <span class="star">★</span>' : '';
    html += `<tr data-slug="${esc(r.slug)}" class="${WL.has(r.slug) ? 'watch' : ''}">` +
      `<td>${r.viewRank}</td>` +
      `<td><b>${esc(r.name)}</b>${star}<br><span class="note">${esc(r.slug)}</span></td>` +
      `<td>${esc(r.category ?? '—')}</td>` +
      `<td>${r.chains.length ? esc(r.chains[0]) + (r.chains.length > 1 ? ` <span class="badge">+${r.chains.length - 1}</span>` : '') : '—'}</td>` +
      `<td class="num">${money(r.tvl_usd)}</td>` +
      `<td class="num">${pct(r.change_7d)}</td>` +
      `<td class="num">${age(r.age_days)}</td>` +
      `<td class="num">${r.category_multiple.toFixed(3)}</td>` +
      `<td class="num"><b>${money(r.implied_value_usd)}</b></td></tr>`;
  }
  $('board').innerHTML = html + '</tbody>';
  $('board').querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.getAttribute('data-sort');
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else { state.sortKey = k; state.sortDir = k === 'name' || k === 'category' ? 1 : -1; }
      renderBoard();
    });
  });
  $('board').querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => openDetail(tr.getAttribute('data-slug')));
  });
}

function renderLive() {
  $('count').textContent = `Showing ${D.live.length} live-token protocols, by market cap — the market's own values, never mixed into the ranked board.`;
  let html = '<thead><tr><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th><th class="num">7d</th></tr></thead><tbody>';
  for (const r of D.live) {
    const ratio = r.tvl_usd > 0 && r.mcap_usd !== null ? (r.mcap_usd / r.tvl_usd).toFixed(3) : '—';
    html += '<tr><td><b>' + esc(r.name) + '</b><br><span class="note">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category ?? '—') + '</td>' +
      '<td>' + (r.chains.length ? esc(r.chains[0]) + (r.chains.length > 1 ? ` <span class="badge">+${r.chains.length - 1}</span>` : '') : '—') + '</td>' +
      `<td class="num">${money(r.tvl_usd)}</td>` +
      `<td class="num">${r.mcap_usd === null ? '—' : money(r.mcap_usd)}</td>` +
      `<td class="num">${ratio}</td>` +
      `<td class="num">${pct(r.change_7d)}</td></tr>`;
  }
  $('board').innerHTML = html + '</tbody>';
}

function renderExcluded() {
  $('count').textContent = `${D.excluded.length} pre-token protocols are not ranked. Centralised exchanges, wrapped / staked / bridged products and versioned pools never launch a token this radar watches.`;
  let html = '<thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th>Reason</th></tr></thead><tbody>';
  for (const r of D.excluded) {
    html += '<tr><td><b>' + esc(r.name) + '</b><br><span class="note">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category ?? '—') + '</td>' +
      `<td class="num">${money(r.tvl_usd)}</td>` +
      '<td>' + esc(r.reason) + '</td></tr>';
  }
  $('board').innerHTML = html + '</tbody>';
}

function renderTab() {
  $('tab-board').setAttribute('aria-selected', String(state.tab === 'board'));
  $('tab-live').setAttribute('aria-selected', String(state.tab === 'live'));
  $('tab-excluded').setAttribute('aria-selected', String(state.tab === 'excluded'));
  if (state.tab === 'board') renderBoard();
  else if (state.tab === 'live') renderLive();
  else renderExcluded();
}

/** The detail dialog: factor breakdown plus the farm plan. */
function openDetail(slug) {
  const r = D.rows.find((x) => x.slug === slug);
  if (!r) return;
  const star = WL.has(r.slug) ? ' <span class="star">★ watchlist</span>' : '';
  const base = r.tvl_usd * r.category_multiple;
  const rows = [
    ['TVL', moneyFull(r.tvl_usd), ''],
    ['Category multiple', r.category_multiple.toFixed(3), r.category_multiple === D.global_multiple ? 'global median (too few peers)' : 'peer median, ' + (r.category ?? 'no category')],
    ['Growth', r.growth_multiplier.toFixed(4) + '×', '7d ' + pct(r.change_7d)],
    ['Maturity', r.maturity_multiplier.toFixed(4) + '×', (r.age_days === null ? 'age unknown, counted as 365d' : age(r.age_days) + ' listed')],
    ['Breadth', r.breadth_multiplier.toFixed(2) + '×', r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's')],
  ];
  let html = '<div class="dlg"><button class="close" id="dlg-close">Close</button>' +
    `<h2>${esc(r.name)}${star}</h2>` +
    `<p class="meta">${esc(r.slug)} · ${esc(r.category ?? 'no category')} · ${esc(r.chains.join(', ') || 'no chains')} · rank #${r.rank} of ${D.rows.length}</p>` +
    '<h3>How the value is built</h3><table class="factors"><tbody>';
  for (const [k, v, note] of rows) html += `<tr><td>${k}</td><td>${v}</td><td>${esc(note)}</td></tr>`;
  html += `<tr class="total"><td>Implied value</td><td>${moneyFull(r.implied_value_usd)}</td><td>${money(base)} base × factors</td></tr></tbody></table>`;
  html += `<p class="note">Maturity uses a 4-year curve (floor 0.5); the sandbox above can move it. Base = TVL × multiple.</p>`;
  html += '<h3>Farm plan — concrete steps, cost and time</h3><ol class="steps">';
  for (const s of r.farm_steps) html += '<li>' + esc(s) + '</li>';
  html += '</ol><p class="note">Steps are templated by category and chain, never by protocol name. Costs are the capital at risk plus gas; never pay to claim.</p></div>';
  const dlg = $('detail');
  dlg.innerHTML = html;
  dlg.showModal();
  $('dlg-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }, { once: true });
}

/** Static sections: chips, multiples table, excluded summary. */
function renderStatic() {
  $('chips').innerHTML =
    `<span><b>${D.board_size}</b> ranked</span>` +
    `<span><b>${D.watchlist_size}</b> watchlist ★</span>` +
    `<span><b>${D.excluded_size}</b> excluded</span>` +
    `<span>snapshot <b>${esc(D.as_of)}</b></span>` +
    `<span>global multiple <b>${D.global_multiple.toFixed(3)}</b></span>`;
  const cats = [...new Set(D.rows.map((r) => r.category))].filter(Boolean).sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
  let m = '<thead><tr><th>Category</th><th class="num">Multiple</th><th class="num">Peers</th><th>Source</th></tr></thead><tbody>';
  for (const row of D.multiples) {
    m += `<tr><td>${esc(row.category)}</td><td class="num">${row.multiple.toFixed(3)}</td><td class="num">${row.peer_count}</td><td>${row.source === 'peers' ? 'peer median' : 'global fallback'}</td></tr>`;
  }
  $('multiples').innerHTML = m + '</tbody>';
  const byReason = {};
  for (const r of D.excluded) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  $('excluded-summary').textContent = Object.entries(byReason).map(([k, v]) => `${v} ${k}`).join(' · ') +
    `. The watchlist is the floor: 3 of its 40 protocols sit in normally-excluded categories and still rank.`;
  let ex = '<thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th>Reason</th></tr></thead><tbody>';
  for (const r of D.excluded.slice(0, 12)) {
    ex += '<tr><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.category ?? '—') + '</td>' +
      `<td class="num">${money(r.tvl_usd)}</td><td>` + esc(r.reason) + '</td></tr>';
  }
  $('excluded').innerHTML = ex + '</tbody>';
}

/** Sandbox sliders. */
function renderSliders() {
  const defs = [
    ['scale', 'Multiple scale', 0.5, 2.0, 0.05, 1, '×'],
    ['growthW', 'Growth weight', 0, 1, 0.05, 0.6, ''],
    ['matFloor', 'Maturity floor', 0.3, 0.8, 0.05, 0.5, ''],
  ];
  $('sliders').innerHTML = defs.map(([key, label, min, max, step, val, suffix]) =>
    `<label>${label}: <b id="val-${key}">${val}${suffix}</b><br>` +
    `<input type="range" id="sl-${key}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`).join('');
  for (const [key] of defs) {
    $('sl-' + key).addEventListener('input', (e) => {
      state[key] = parseFloat(e.target.value);
      $('val-' + key).textContent = e.target.value + (key === 'scale' ? '×' : '');
      $('sandbox-note').textContent = sandboxActive()
        ? 'Sandbox active — the table below recomputes from your sliders. Reset to 1 / 0.6 / 0.5 for the submitted board.'
        : 'Defaults shown. The submitted board uses the default model; the sandbox is a what-if.';
      renderBoard();
    });
  }
}

function init() {
  renderStatic();
  renderSliders();
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('mintvl').addEventListener('change', (e) => { state.minTvl = parseInt(e.target.value, 10); renderBoard(); });
  $('tab-board').addEventListener('click', () => { state.tab = 'board'; renderTab(); });
  $('tab-live').addEventListener('click', () => { state.tab = 'live'; renderTab(); });
  $('tab-excluded').addEventListener('click', () => { state.tab = 'excluded'; renderTab(); });
  renderTab();
  const shot = new URLSearchParams(location.search).get('shot');
  if (shot === 'filtered') {
    state.cat = 'Risk Curators';
    $('cat').value = 'Risk Curators';
    renderBoard();
  } else if (shot === 'detail') {
    openDetail(D.rows[0].slug);
  }
}

init();
