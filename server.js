// Agent Dash — zero-dependency server.
// Agents report in over HTTP; the dashboard gets live updates over Server-Sent Events.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4000;
const TOKEN = process.env.AGENT_DASH_TOKEN || '';         // optional shared secret for write calls
const STALE_SECONDS = Number(process.env.STALE_SECONDS) || 60; // no heartbeat for this long => offline
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const MAX_EVENTS = 50;                                      // activity log entries kept per agent

const STATUSES = ['idle', 'working', 'waiting', 'error', 'done'];

// ---------- state ----------

let agents = {};
try {
  agents = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch { /* first run */ }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(agents, null, 2), () => {});
  }, 250);
}

// "offline" is derived from the last heartbeat, never stored.
function view(agent) {
  const ageSec = (Date.now() - Date.parse(agent.lastSeen)) / 1000;
  return { ...agent, status: ageSec > STALE_SECONDS ? 'offline' : agent.status, reportedStatus: agent.status };
}

function upsert(id, patch) {
  const now = new Date().toISOString();
  const prev = agents[id] || { id, name: id, status: 'idle', task: null, events: [], createdAt: now };
  const next = { ...prev, lastSeen: now };

  for (const key of ['name', 'model', 'owner', 'task', 'progress', 'meta']) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw httpError(400, `status must be one of: ${STATUSES.join(', ')}`);
    next.status = patch.status;
  }
  if (patch.task !== undefined && patch.task !== prev.task) next.taskStartedAt = now;

  // Auto-log meaningful changes so the timeline is useful even if agents never post events.
  if (prev.status !== next.status) pushEvent(next, 'info', `status → ${next.status}`);
  if (patch.task !== undefined && patch.task !== prev.task) pushEvent(next, 'info', `assigned: ${next.task ?? '(none)'}`);
  if (patch.message) pushEvent(next, patch.level || 'info', patch.message);

  agents[id] = next;
  save();
  broadcast('agent', view(next));
  return next;
}

function pushEvent(agent, level, message) {
  agent.events = [{ at: new Date().toISOString(), level, message: String(message).slice(0, 500) }, ...(agent.events || [])]
    .slice(0, MAX_EVENTS);
}

// ---------- SSE ----------

const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

// Re-broadcast periodically so agents flip to "offline" on screen without any new traffic.
setInterval(() => broadcast('snapshot', Object.values(agents).map(view)), 5000);

// ---------- HTTP ----------

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(httpError(413, 'body too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(httpError(400, 'invalid JSON')); }
    });
  });
}

function requireAuth(req) {
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) throw httpError(401, 'unauthorized');
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serveStatic(req, res) {
  const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0].slice(1);
  const file = path.normalize(path.join(__dirname, 'public', rel));
  if (!file.startsWith(path.join(__dirname, 'public'))) return send(res, 404, { error: 'not found' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/api\/agents\/([^/]+)(\/heartbeat|\/events)?$/);

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      return res.end();
    }

    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: snapshot\ndata: ${JSON.stringify(Object.values(agents).map(view))}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname === '/api/agents' && req.method === 'GET') {
      return send(res, 200, Object.values(agents).map(view));
    }

    if (m) {
      const id = decodeURIComponent(m[1]);
      const sub = m[2];

      if (req.method === 'GET' && !sub) {
        if (!agents[id]) throw httpError(404, 'agent not found');
        return send(res, 200, view(agents[id]));
      }

      // Agent check-in: create-or-update and refresh lastSeen.
      if (req.method === 'POST' && sub === '/heartbeat') {
        requireAuth(req);
        return send(res, 200, view(upsert(id, await readBody(req))));
      }

      // Append to the activity log without changing status.
      if (req.method === 'POST' && sub === '/events') {
        requireAuth(req);
        const body = await readBody(req);
        if (!body.message) throw httpError(400, 'message is required');
        return send(res, 200, view(upsert(id, { message: body.message, level: body.level })));
      }

      // Dashboard edits (reassign task, rename, etc.). Doesn't count as a heartbeat.
      if (req.method === 'PATCH' && !sub) {
        requireAuth(req);
        if (!agents[id]) throw httpError(404, 'agent not found');
        const lastSeen = agents[id].lastSeen;
        const updated = upsert(id, await readBody(req));
        updated.lastSeen = lastSeen;
        broadcast('agent', view(updated));
        return send(res, 200, view(updated));
      }

      if (req.method === 'DELETE' && !sub) {
        requireAuth(req);
        delete agents[id];
        save();
        broadcast('remove', { id });
        return send(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(req, res);
    throw httpError(404, 'not found');
  } catch (err) {
    send(res, err.status || 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Agent Dash running on http://localhost:${PORT}`);
  if (TOKEN) console.log('Write endpoints require: Authorization: Bearer $AGENT_DASH_TOKEN');
});
