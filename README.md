# Agent Dash

A live dashboard that shows all of your LLM agents, what each one is assigned to, and its status.

- **Zero dependencies.** Plain Node 18+ server, plain HTML/JS frontend.
- **Live.** The dashboard updates over Server-Sent Events, with no refresh needed.
- **Works with any framework.** Agents report in over HTTP, so you can use the bundled Python or JS client, or `curl`.

## Quick start

```bash
npm start          # dashboard at http://localhost:4000
npm run demo       # in another terminal: 6 simulated agents
```

## Statuses

| Status    | Meaning                                                           |
|-----------|-------------------------------------------------------------------|
| `working` | Actively executing its task                                       |
| `waiting` | Blocked on something (human approval, input, another agent)       |
| `error`   | Something failed                                                  |
| `idle`    | Online with no task                                               |
| `done`    | Finished its task                                                 |
| `offline` | *Derived*: no heartbeat for `STALE_SECONDS` (default 60s)         |

## Reporting from your agents

### Python

```python
from agent_dash import AgentDash   # clients/agent_dash.py, stdlib only

dash = AgentDash("research-bot", name="Research Bot", model="claude-opus-5-5", owner="alex")
dash.start_heartbeat()                                   # keeps it "online"
dash.update(status="working", task="Summarize Q3 reports", progress=10)
dash.log("Fetched 12 documents")
dash.update(status="waiting", message="Need approval to send email", level="warn")
dash.update(status="done", progress=100)
```

### JavaScript

```js
const { AgentDash } = require('./clients/agent-dash');
const dash = new AgentDash('code-reviewer', { name: 'Code Reviewer', model: 'claude-sonnet-5-5' });
dash.startHeartbeat();
await dash.update({ status: 'working', task: 'Review PR 42', progress: 30 });
await dash.log('Found 3 issues', 'warn');
```

Both clients read `AGENT_DASH_URL` and `AGENT_DASH_TOKEN` from the environment. They swallow network errors, so if the dashboard goes down, your agents keep running.

### Raw HTTP

```bash
curl -X POST localhost:4000/api/agents/my-agent/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"name":"My Agent","status":"working","task":"Triage issues","progress":40}'
```

## API

| Method   | Path                         | Body / notes |
|----------|------------------------------|--------------|
| `POST`   | `/api/agents/:id/heartbeat`  | Create or update the agent and mark it as seen. Fields: `name`, `model`, `owner`, `status`, `task`, `progress` (0–100), `meta` (any JSON), `message`, `level` |
| `POST`   | `/api/agents/:id/events`     | `{ message, level }`: append to the activity log |
| `PATCH`  | `/api/agents/:id`            | Same fields as heartbeat. Used by the dashboard to reassign; does not count as a heartbeat |
| `DELETE` | `/api/agents/:id`            | Remove the agent |
| `GET`    | `/api/agents`                | All agents (JSON) |
| `GET`    | `/api/agents/:id`            | One agent |
| `GET`    | `/api/stream`                | SSE stream: `snapshot`, `agent`, `remove` events |

Status and task changes are logged to the activity feed automatically.

## Config

| Env var            | Default       | |
|--------------------|---------------|-|
| `PORT`             | `4000`        | |
| `AGENT_DASH_TOKEN` | *(unset)*     | If set, write endpoints require `Authorization: Bearer <token>`. The dashboard asks for it once. |
| `STALE_SECONDS`    | `60`          | Time without a heartbeat before an agent shows as offline |
| `DATA_FILE`        | `./data.json` | Where state is saved |

## Ideas for next steps

- Push tasks *to* agents: agents poll `GET /api/agents/:id` and pick up reassignments made in the dashboard
- Token and cost tracking per agent (send it in `meta`)
- Swap the JSON file for SQLite or Postgres to keep longer history
- Hooks for Claude Agent SDK, LangGraph, and CrewAI that report automatically on each tool call
