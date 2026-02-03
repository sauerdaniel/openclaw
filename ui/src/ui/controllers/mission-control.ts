import type { GatewayBrowserClient } from "../gateway";
import type { AgentStatus, Activity, Task, MissionStatus } from "../types/mission-control.js";

export type MissionControlState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  tasksLoading: boolean;
  tasks: Task[];
  tasksError: string | null;
  agentsLoading: boolean;
  agents: AgentStatus[];
  agentsError: string | null;
  activityLoading: boolean;
  activity: Activity[];
  activityError: string | null;
  selectedTask?: string;
  filter: MissionStatus | "all";
  lastPoll: number;
};

// Cache path for mission control data - uses env var or defaults to ~/.openclaw
const CACHE_BASE =
  process.env.OPENCLAW_MISSION_CACHE ||
  `${process.env.HOME || "~"}/.openclaw/workspace/mission/cache`;

function mapBeadTaskToTask(bead: any): Task {
  const status = bead.status || "open";
  return {
    id: bead.id,
    title: bead.title,
    status: mapStatus(status),
    assignees: bead.owner ? [bead.owner] : [],
    updatedAt: bead.updated_at ? new Date(bead.updated_at).getTime() : Date.now(),
    priority: mapPriority(bead.priority),
    labels: bead.labels || [],
    _raw: bead,
  };
}

function mapStatus(status: string): MissionStatus {
  const s = status.toLowerCase();
  if (s === "in_progress") {
    return "in_progress";
  }
  if (s === "assigned") {
    return "assigned";
  }
  if (s === "review") {
    return "review";
  }
  if (s === "closed" || s === "done") {
    return "done";
  }
  return "inbox";
}

function mapPriority(priority: number | string): "P0" | "P1" | "P2" | "P3" {
  const p = typeof priority === "number" ? priority : parseInt(String(priority), 10);
  if (p <= 1) {
    return "P0";
  }
  if (p <= 2) {
    return "P1";
  }
  if (p <= 3) {
    return "P2";
  }
  return "P3";
}

export async function loadTasks(state: MissionControlState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.tasksLoading = true;
  state.tasksError = null;
  try {
    const res = await state.client.request("exec.exec", {
      command: ["cat", `${CACHE_BASE}/tasks.json`],
    });
    if (res.stdout) {
      const beads = JSON.parse(res.stdout);
      state.tasks = Array.isArray(beads) ? beads.map(mapBeadTaskToTask) : [];
    }
  } catch (err) {
    state.tasksError = String(err);
  } finally {
    state.tasksLoading = false;
  }
}

export async function loadAgents(state: MissionControlState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request("exec.exec", {
      command: ["cat", `${CACHE_BASE}/agents.json`],
    });
    if (res.stdout) {
      const data = JSON.parse(res.stdout);
      state.agents = Array.isArray(data) ? data : [];
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
  }
}

export async function loadActivity(state: MissionControlState, limit = 50) {
  if (!state.client || !state.connected) {
    return;
  }
  state.activityLoading = true;
  state.activityError = null;
  try {
    const res = await state.client.request("exec.exec", {
      command: ["tail", "-n", String(limit), `${CACHE_BASE}/activity.jsonl`],
    });
    if (res.stdout) {
      const lines = res.stdout.trim().split("\n").filter(Boolean);
      state.activity = lines
        .map((line: string) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .toReversed();
    }
  } catch (err) {
    state.activityError = String(err);
  } finally {
    state.activityLoading = false;
  }
}

export async function loadAll(state: MissionControlState) {
  await Promise.all([loadTasks(state), loadAgents(state), loadActivity(state)]);
  state.lastPoll = Date.now();
}

export function getTasksByStatus(tasks: Task[], status: MissionStatus | "all"): Task[] {
  if (status === "all") {
    return tasks;
  }
  return tasks.filter((t) => t.status === status);
}

export function setSelectedTask(state: MissionControlState, taskId: string | undefined) {
  state.selectedTask = taskId;
}

export function setFilter(state: MissionControlState, filter: MissionStatus | "all") {
  state.filter = filter;
}
