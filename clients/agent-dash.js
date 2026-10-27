// Minimal Agent Dash client for Node 18+ (uses global fetch).
//
//   const { AgentDash } = require('./clients/agent-dash');
//   const dash = new AgentDash('code-reviewer', { name: 'Code Reviewer', model: 'claude-sonnet-5-5' });
//   dash.startHeartbeat();
//   await dash.update({ status: 'working', task: 'Review PR 42', progress: 30 });
//   await dash.log('Found 3 issues', 'warn');
'use strict';

class AgentDash {
  constructor(id, fields = {}, { url = process.env.AGENT_DASH_URL || 'http://localhost:4000', token = process.env.AGENT_DASH_TOKEN } = {}) {
    this.id = id;
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.timer = null;
    this.ready = this.update(fields);
  }

  async post(path, body) {
    try {
      const res = await fetch(`${this.url}/api/agents/${encodeURIComponent(this.id)}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.token && { Authorization: `Bearer ${this.token}` }) },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch (err) {
      console.error(`[agent-dash] ${err.message}`); // never let dashboard outages crash the agent
    }
  }

  /** fields: name, model, owner, status, task, progress (0-100), meta, message */
  update(fields) { return this.post('/heartbeat', fields); }

  /** level: info | warn | error */
  log(message, level = 'info') { return this.post('/events', { message, level }); }

  startHeartbeat(intervalMs = 20000) {
    this.timer = setInterval(() => this.post('/heartbeat', {}), intervalMs);
    this.timer.unref?.();
  }

  stopHeartbeat() { clearInterval(this.timer); }
}

module.exports = { AgentDash };
