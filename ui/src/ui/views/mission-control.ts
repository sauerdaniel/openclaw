import { html, nothing } from "lit";
import { map } from "lit/directives/map.js";
import { repeat } from "lit/directives/repeat.js";
import { when } from "lit/directives/when.js";
import { icons } from "../icons.js";

export interface MissionControlProps {
  tasksLoading: boolean;
  tasks: any[];
  tasksError: string | null;
  agentsLoading: boolean;
  agents: any[];
  agentsError: string | null;
  activityLoading: boolean;
  activity: any[];
  activityError: string | null;
  selectedTask?: string;
  filter: any;
  lastPoll: number;
  onRefresh: () => void;
  onFilterChange: (filter: any) => void;
  onTaskSelect: (taskId?: string) => void;
}

function mapStatus(status: string): string {
  const s = status.toLowerCase();
  if (s === "in_progress") return "in_progress";
  if (s === "assigned") return "assigned";
  if (s === "review") return "review";
  if (s === "closed" || s === "done") return "done";
  return "inbox";
}

function mapPriority(priority: number | string): string {
  const p = typeof priority === "number" ? priority : parseInt(String(priority), 10);
  if (p <= 1) return "P0";
  if (p <= 2) return "P1";
  if (p <= 3) return "P2";
  return "P3";
}

function getTasksByStatus(tasks: any[], status: string): any[] {
  if (status === "all") return tasks;
  return tasks.filter((t) => mapStatus(t.status) === status);
}

export function renderMissionControl(props: MissionControlProps) {
  const { tasks, agents, activity, filter } = props;
  const statuses = ["all", "inbox", "assigned", "in_progress", "review", "done"];

  return html`
    <div class="mission-control-container">
      <div class="mission-sidebar">
        <div class="mission-panel">
          <div class="mission-panel-header">
            <span>Agents</span>
            <button
              class="mission-refresh-btn"
              @click=${props.onRefresh}
              ?disabled=${props.agentsLoading}
              title="Refresh"
            >
              ${icons.refresh}
            </button>
          </div>
          <div class="mission-panel-content">
            ${when(
              props.agentsLoading,
              () =>
                html`
                  <div class="mission-loading">Loading...</div>
                `,
              () =>
                when(
                  props.agentsError,
                  () => html`<div class="mission-error">${props.agentsError}</div>`,
                  () =>
                    when(
                      agents.length === 0,
                      () =>
                        html`
                          <div class="mission-empty">No agents found</div>
                        `,
                      () => html`
                    <div class="mission-agent-list">
                      ${repeat(
                        agents,
                        (a) => a.id,
                        (agent) => renderAgentCard(agent),
                      )}
                    </div>
                  `,
                    ),
                ),
            )}
          </div>
        </div>
      </div>

      <div class="mission-kanban">
        <div class="mission-kanban-header">
          <h3>Tasks</h3>
          <button
            class="mission-refresh-btn"
            @click=${props.onRefresh}
            ?disabled=${props.tasksLoading}
            title="Refresh"
          >
            ${icons.refresh}
          </button>
        </div>
        <div class="mission-kanban-columns">
          ${map(statuses, (status) => {
            const filteredTasks = getTasksByStatus(tasks, status);
            return renderColumn(status, filteredTasks, props.selectedTask, props.onTaskSelect);
          })}
        </div>
        ${when(
          props.tasksLoading,
          () => nothing,
          () =>
            when(
              props.tasksError,
              () => html`<div class="mission-error">${props.tasksError}</div>`,
            ),
        )}
      </div>

      <div class="mission-sidebar">
        <div class="mission-panel">
          <div class="mission-panel-header">
            <span>Activity</span>
            <button
              class="mission-refresh-btn"
              @click=${props.onRefresh}
              ?disabled=${props.activityLoading}
              title="Refresh"
            >
              ${icons.refresh}
            </button>
          </div>
          <div class="mission-panel-content">
            ${when(
              props.activityLoading,
              () =>
                html`
                  <div class="mission-loading">Loading...</div>
                `,
              () =>
                when(
                  props.activityError,
                  () => html`<div class="mission-error">${props.activityError}</div>`,
                  () =>
                    when(
                      activity.length === 0,
                      () =>
                        html`
                          <div class="mission-empty">No activity yet</div>
                        `,
                      () => html`
                    <div class="mission-activity-list">
                      ${repeat(
                        activity,
                        (a, i) => `${a.type}-${a.timestamp}-${i}`,
                        (item) => renderActivityItem(item),
                      )}
                    </div>
                  `,
                    ),
                ),
            )}
          </div>
          ${when(props.lastPoll > 0, () => {
            const ago = Math.floor((Date.now() - props.lastPoll) / 1000);
            return html`<div class="mission-poll-info">Last poll: ${ago}s ago</div>`;
          })}
        </div>
      </div>
    </div>

    <style>
      .mission-control-container {
        display: grid;
        grid-template-columns: 200px 1fr 280px;
        gap: 1rem;
        height: calc(100vh - 180px);
        min-height: 400px;
      }

      .mission-panel {
        background: var(--surface, #1e1e1e);
        border-radius: 8px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border, #333);
        height: 100%;
      }

      .mission-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-muted, #888);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border, #333);
        margin-bottom: 0.75rem;
      }

      .mission-panel-content {
        flex: 1;
        overflow-y: auto;
      }

      .mission-refresh-btn {
        background: transparent;
        border: none;
        color: var(--text-muted, #888);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }

      .mission-refresh-btn:hover:not(:disabled) {
        background: var(--surface-hover, #2a2a2a);
        color: var(--text, #e5e5e5);
      }

      .mission-refresh-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .mission-refresh-btn svg {
        width: 16px;
        height: 16px;
      }

      .mission-loading,
      .mission-empty,
      .mission-error {
        padding: 2rem;
        text-align: center;
        color: var(--text-muted, #888);
        font-size: 0.875rem;
      }

      .mission-error {
        color: #ef4444;
        background: rgba(239, 68, 68, 0.1);
        border-radius: 4px;
      }

      .mission-agent-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .mission-agent-card {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        border-radius: 4px;
        background: var(--background, #0d0d0d);
        transition: background 0.15s;
      }

      .mission-agent-card:hover {
        background: var(--surface-hover, #2a2a2a);
      }

      .mission-agent-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .mission-agent-dot.active {
        background: #22c55e;
        box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
      }

      .mission-agent-dot.idle {
        background: #6b7280;
      }

      .mission-agent-name {
        font-size: 0.875rem;
        color: var(--text, #e5e5e5);
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .mission-kanban {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border, #333);
        border-radius: 8px;
        background: var(--surface, #1e1e1e);
        padding: 1rem;
        overflow: hidden;
      }

      .mission-kanban-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border, #333);
      }

      .mission-kanban-header h3 {
        font-size: 1rem;
        font-weight: 600;
        color: var(--text, #e5e5e5);
        margin: 0;
      }

      .mission-kanban-columns {
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        overflow-y: hidden;
        flex: 1;
        padding-bottom: 0.5rem;
      }

      .mission-column {
        flex: 0 0 220px;
        background: var(--background, #0d0d0d);
        border-radius: 4px;
        padding: 0.75rem;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border, #333);
        height: 100%;
      }

      .mission-column-header {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--text-muted, #888);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border, #333);
      }

      .mission-column-count {
        background: var(--primary, #3b82f6);
        color: white;
        font-size: 0.7rem;
        padding: 2px 6px;
        border-radius: 10px;
        margin-left: 0.25rem;
      }

      .mission-column-tasks {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .mission-task-card {
        background: var(--surface, #1e1e1e);
        border-radius: 4px;
        padding: 0.75rem;
        cursor: pointer;
        border-left: 3px solid transparent;
        transition: all 0.15s;
      }

      .mission-task-card:hover {
        outline: 1px solid var(--primary, #3b82f6);
        transform: translateX(2px);
      }

      .mission-task-card.selected {
        outline: 2px solid var(--primary, #3b82f6);
      }

      .mission-task-card.priority-P0 {
        border-left-color: #ef4444;
      }

      .mission-task-card.priority-P1 {
        border-left-color: #f59e0b;
      }

      .mission-task-card.priority-P2 {
        border-left-color: #3b82f6;
      }

      .mission-task-card.priority-P3 {
        border-left-color: #6b7280;
      }

      .mission-task-title {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text, #e5e5e5);
        margin-bottom: 0.375rem;
        line-height: 1.4;
      }

      .mission-task-meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.75rem;
        color: var(--text-muted, #888);
      }

      .mission-task-id {
        font-family: monospace;
        background: var(--background, #0d0d0d);
        padding: 1px 4px;
        border-radius: 2px;
      }

      .mission-activity-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .mission-activity-item {
        padding: 0.5rem;
        border-radius: 4px;
        background: var(--background, #0d0d0d);
        border-left: 2px solid var(--border, #333);
      }

      .mission-activity-item.type-task_created {
        border-left-color: #22c55e;
      }

      .mission-activity-item.type-task_updated {
        border-left-color: #f59e0b;
      }

      .mission-activity-type {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--text-muted, #888);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 0.25rem;
      }

      .mission-activity-content {
        font-size: 0.8rem;
        color: var(--text, #e5e5e5);
        line-height: 1.4;
      }

      .mission-activity-time {
        font-size: 0.7rem;
        color: var(--text-muted, #888);
        margin-top: 0.25rem;
      }

      .mission-poll-info {
        font-size: 0.7rem;
        color: var(--text-muted, #888);
        text-align: center;
        padding: 0.5rem;
        border-top: 1px solid var(--border, #333);
        margin-top: auto;
      }

      @media (max-width: 1200px) {
        .mission-control-container {
          grid-template-columns: 180px 1fr 240px;
        }

        .mission-column {
          flex: 0 0 180px;
        }
      }

      @media (max-width: 900px) {
        .mission-control-container {
          grid-template-columns: 1fr;
          grid-template-rows: auto 1fr auto;
        }

        .mission-kanban-columns {
          overflow-x: auto;
          overflow-y: visible;
        }
      }
    </style>
  `;
}

function renderAgentCard(agent: any) {
  const isActive = agent.active || Date.now() - (agent.lastSeen || 0) < 300000;
  return html`
    <div class="mission-agent-card">
      <span class="mission-agent-dot ${isActive ? "active" : "idle"}"></span>
      <span class="mission-agent-name">${agent.name || agent.id}</span>
    </div>
  `;
}

function renderColumn(
  status: string,
  tasks: any[],
  selectedTask: string | undefined,
  onTaskSelect: (taskId?: string) => void,
) {
  const count = tasks.length;
  const label = status === "all" ? "All Tasks" : status.replace("_", " ");

  return html`
    <div class="mission-column">
      <div class="mission-column-header">
        ${label} <span class="mission-column-count">${count}</span>
      </div>
      <div class="mission-column-tasks">
        ${
          tasks.length === 0
            ? html`
                <div class="mission-empty" style="padding: 1rem">No tasks</div>
              `
            : repeat(
                tasks,
                (t) => t.id,
                (task) => {
                  const priority = mapPriority(task.priority);
                  return html`
                  <div
                    class="mission-task-card priority-${priority} ${task.id === selectedTask ? "selected" : ""}"
                    @click=${() => onTaskSelect(task.id)}
                  >
                    <div class="mission-task-title">${task.title}</div>
                    <div class="mission-task-meta">
                      <span class="mission-task-id">${task.id}</span>
                      ${task.owner ? html`<span>${task.owner}</span>` : ""}
                    </div>
                  </div>
                `;
                },
              )
        }
      </div>
    </div>
  `;
}

function renderActivityItem(item: any) {
  const time = new Date(item.timestamp).toLocaleTimeString();
  return html`
    <div class="mission-activity-item type-${item.type}">
      <div class="mission-activity-type">${item.type.replace("_", " ")}</div>
      <div class="mission-activity-content">${item.content || ""}</div>
      <div class="mission-activity-time">${time}</div>
    </div>
  `;
}
