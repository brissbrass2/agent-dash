// Spins up a handful of fake agents so you can see the dashboard move.
// Usage: node examples/simulate.js   (with the server running)
'use strict';

const { AgentDash } = require('../clients/agent-dash');

const FLEET = [
  { id: 'researcher', name: 'Research Agent', model: 'claude-opus-5-5', owner: 'alex',
    tasks: ['Compile competitor pricing', 'Summarize arXiv papers on RAG', 'Draft market brief'] },
  { id: 'coder-1', name: 'Coding Agent #1', model: 'claude-sonnet-5-5', owner: 'sam',
    tasks: ['Fix flaky login test', 'Add pagination to /orders', 'Upgrade to Node 22'] },
  { id: 'coder-2', name: 'Coding Agent #2', model: 'claude-sonnet-5-5', owner: 'sam',
    tasks: ['Refactor billing service', 'Write migration for user prefs'] },
  { id: 'support', name: 'Support Triage', model: 'claude-haiku-5-5', owner: 'jo',
    tasks: ['Triage inbox (42 tickets)', 'Tag refund requests', 'Escalate P1 outage reports'] },
  { id: 'reviewer', name: 'PR Reviewer', model: 'claude-opus-5-5', owner: 'alex',
    tasks: ['Review PR 118', 'Review PR 121', 'Review PR 124'] },
  { id: 'scraper', name: 'Data Scraper', model: 'claude-haiku-5-5', owner: 'jo',
    tasks: ['Crawl docs site', 'Refresh product catalog'] },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STEPS = ['Reading context', 'Calling tool: search', 'Calling tool: read_file', 'Planning next step',
  'Writing output', 'Running tests', 'Calling tool: web_fetch'];

async function run(def) {
  const dash = new AgentDash(def.id, { name: def.name, model: def.model, owner: def.owner, status: 'idle', task: null });
  dash.startHeartbeat(5000);
  await sleep(Math.random() * 3000);

  for (;;) {
    const task = pick(def.tasks);
    await dash.update({ status: 'working', task, progress: 0, meta: { tokensUsed: 0 } });
    let tokens = 0;
    for (let p = 0; p < 100;) {
      await sleep(1500 + Math.random() * 3000);
      p = Math.min(100, p + Math.round(10 + Math.random() * 25));
      tokens += Math.round(2000 + Math.random() * 8000);
      const roll = Math.random();
      if (roll < 0.05) {
        await dash.update({ status: 'error', progress: p, message: 'Tool call failed: rate limited', level: 'error' });
        await sleep(6000);
        await dash.update({ status: 'working', message: 'Retrying…' });
      } else if (roll < 0.1) {
        await dash.update({ status: 'waiting', progress: p, message: 'Needs human approval to continue', level: 'warn' });
        await sleep(8000);
        await dash.update({ status: 'working', message: 'Approval received' });
      } else {
        await dash.update({ progress: p, meta: { tokensUsed: tokens }, message: pick(STEPS) });
      }
    }
    await dash.update({ status: 'done', progress: 100, message: `Finished: ${task}` });
    await sleep(4000 + Math.random() * 4000);
    await dash.update({ status: 'idle', task: null, progress: null });
    await sleep(3000 + Math.random() * 6000);
  }
}

console.log(`Simulating ${FLEET.length} agents against ${process.env.AGENT_DASH_URL || 'http://localhost:4000'} — Ctrl+C to stop`);
FLEET.forEach(run);
