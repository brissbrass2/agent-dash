"""Minimal Agent Dash client (stdlib only).

    from agent_dash import AgentDash

    dash = AgentDash("research-bot", name="Research Bot", model="claude-opus-5-5")
    dash.start_heartbeat()                      # keeps the agent "online" in the background
    dash.update(status="working", task="Summarize Q3 reports", progress=10)
    dash.log("Fetched 12 documents")
    dash.update(status="done", progress=100)
"""

import json
import os
import threading
import urllib.request


class AgentDash:
    def __init__(self, agent_id, url=None, token=None, **fields):
        self.agent_id = agent_id
        self.url = (url or os.environ.get("AGENT_DASH_URL", "http://localhost:4000")).rstrip("/")
        self.token = token or os.environ.get("AGENT_DASH_TOKEN")
        self._stop = threading.Event()
        self.update(**fields)

    def _post(self, path, body):
        req = urllib.request.Request(
            f"{self.url}/api/agents/{self.agent_id}{path}",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     **({"Authorization": f"Bearer {self.token}"} if self.token else {})},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return json.load(res)
        except Exception as e:  # never let dashboard outages crash the agent
            print(f"[agent-dash] {e}")

    def update(self, **fields):
        """Fields: name, model, owner, status, task, progress (0-100), meta (dict), message."""
        return self._post("/heartbeat", fields)

    def log(self, message, level="info"):
        """level: info | warn | error"""
        return self._post("/events", {"message": message, "level": level})

    def start_heartbeat(self, interval=20):
        def beat():
            while not self._stop.wait(interval):
                self._post("/heartbeat", {})
        threading.Thread(target=beat, daemon=True).start()

    def stop_heartbeat(self):
        self._stop.set()
