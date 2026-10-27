'use strict';

const STATUSES = ['working', 'waiting', 'error', 'idle', 'done', 'offline'];
const agents = new Map();
let filter = null;     // status chip filter
let selected = null;   // id shown in drawer

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ago(iso) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Optional auth: if the server has AGENT_DASH_TOKEN set, prompt once and remember it.
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('agentDashToken');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body && JSON.stringify(body) });
  if (res.status === 401) {
    const t = prompt('This dashboard requires a token (AGENT_DASH_TOKEN):');
    if (t) { localStorage.setItem('agentDashToken', t); return api(method, path, body); }
  }
  if (!res.ok) alert((await res.json().catch(() => ({}))).error || res.statusText);
  return res;
}

// ---------- rendering ----------

function renderSummary() {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const a of agents.values()) counts[a.status]++;
  $('summary').innerHTML =
    `<span class="chip ${filter ? '' : 'active'}" data-filter="">All <b>${agents.size}</b></span>` +
    STATUSES.map((s) =>
      `<span class="chip ${filter === s ? 'active' : ''}" data-filter="${s}" data-status="${s}">
         <span class="badge ${s}">${s}</span><b>${counts[s]}</b></span>`).join('');
}

function cardHTML(a) {
  const progress = typeof a.progress === 'number'
    ? `<div class="progress"><div style="width:${Math.min(100, Math.max(0, a.progress))}%"></div></div>` : '';
  const last = a.events?.[0];
  return `
    <div class="card ${a.status}" data-status="${a.status}" data-id="${esc(a.id)}">
      <div class="card-top">
        <span class="card-name" title="${esc(a.name)}">${esc(a.name)}</span>
        <span class="badge ${a.status}">${a.status}</span>
      </div>
      <div class="task ${a.task ? '' : 'none'}">${a.task ? esc(a.task) : 'Unassigned'}</div>
      ${progress}
      ${last ? `<div class="last-event" title="${esc(last.message)}">${esc(last.message)}</div>` : ''}
      <div class="card-meta">
        ${a.model ? `<span>${esc(a.model)}</span>` : ''}
        ${a.owner ? `<span>@${esc(a.owner)}</span>` : ''}
        <span>seen ${ago(a.lastSeen)}</span>
      </div>
    </div>`;
}

function renderGrid() {
  const q = $('search').value.trim().toLowerCase();
  const order = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
  const list = [...agents.values()]
    .filter((a) => !filter || a.status === filter)
    .filter((a) => !q || [a.name, a.id, a.task, a.model, a.owner].some((v) => v && String(v).toLowerCase().includes(q)))
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  $('grid').innerHTML = list.map(cardHTML).join('');
  $('empty').hidden = agents.size > 0;
}

function renderDrawer() {
  const a = selected && agents.get(selected);
  $('drawer').hidden = !a;
  if (!a) return;
  const opts = ['idle', 'working', 'waiting', 'error', 'done']
    .map((s) => `<option ${a.reportedStatus === s ? 'selected' : ''}>${s}</option>`).join('');
  $('detail').innerHTML = `
    <h2>${esc(a.name)}</h2>
    <span class="badge ${a.status}" data-status="${a.status}">${a.status}</span>

    <h3>Details</h3>
    <dl class="kv">
      <dt>ID</dt><dd>${esc(a.id)}</dd>
      <dt>Model</dt><dd>${esc(a.model) || '—'}</dd>
      <dt>Owner</dt><dd>${esc(a.owner) || '—'}</dd>
      <dt>Task</dt><dd>${esc(a.task) || '—'}</dd>
      <dt>Task started</dt><dd>${ago(a.taskStartedAt)}</dd>
      <dt>Progress</dt><dd>${typeof a.progress === 'number' ? a.progress + '%' : '—'}</dd>
      <dt>Last seen</dt><dd>${ago(a.lastSeen)}</dd>
      <dt>Registered</dt><dd>${ago(a.createdAt)}</dd>
    </dl>

    <h3>Assign</h3>
    <form class="assign" id="assign">
      <textarea name="task" rows="2" placeholder="Task description">${esc(a.task)}</textarea>
      <div class="row">
        <select name="status">${opts}</select>
        <button type="submit">Update</button>
      </div>
    </form>

    ${a.meta ? `<h3>Metadata</h3><pre class="meta">${esc(JSON.stringify(a.meta, null, 2))}</pre>` : ''}

    <h3>Activity</h3>
    <ul class="events">
      ${(a.events || []).map((e) =>
        `<li><time title="${esc(e.at)}">${ago(e.at)}</time><span class="${esc(e.level)}">${esc(e.message)}</span></li>`
      ).join('') || '<li><span></span><span>No activity yet</span></li>'}
    </ul>

    <h3>Danger zone</h3>
    <button class="danger" id="remove">Remove agent</button>`;

  $('assign').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    api('PATCH', `/api/agents/${encodeURIComponent(a.id)}`, { task: f.get('task').trim() || null, status: f.get('status') });
  };
  $('remove').onclick = () => {
    if (confirm(`Remove ${a.name}? It will reappear if it checks in again.`)) {
      api('DELETE', `/api/agents/${encodeURIComponent(a.id)}`);
    }
  };
}

function render() {
  renderSummary();
  renderGrid();
  // Don't clobber the assign form while the user is typing in it.
  if (!$('drawer').contains(document.activeElement) || $('drawer').hidden) renderDrawer();
}

// ---------- events ----------

$('summary').onclick = (e) => {
  const chip = e.target.closest('.chip');
  if (chip) { filter = chip.dataset.filter || null; render(); }
};
$('grid').onclick = (e) => {
  const card = e.target.closest('.card');
  if (card) { selected = card.dataset.id; renderDrawer(); }
};
$('close').onclick = () => { selected = null; renderDrawer(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('close').click(); });
$('search').oninput = renderGrid;

// ---------- live stream ----------

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('conn').textContent = 'live'; $('conn').className = 'conn live'; };
  es.onerror = () => { $('conn').textContent = 'reconnecting…'; $('conn').className = 'conn down'; };
  es.addEventListener('snapshot', (e) => {
    agents.clear();
    for (const a of JSON.parse(e.data)) agents.set(a.id, a);
    render();
  });
  es.addEventListener('agent', (e) => { const a = JSON.parse(e.data); agents.set(a.id, a); render(); });
  es.addEventListener('remove', (e) => {
    const { id } = JSON.parse(e.data);
    agents.delete(id);
    if (selected === id) selected = null;
    render();
  });
}
connect();
