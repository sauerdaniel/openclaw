/**
 * Mission Control data types and interfaces
 */

/** Mission Control UI task states */
export type MissionStatus =
  | "inbox" // New/unassigned tasks
  | "assigned" // Tasks assigned to current user
  | "in_progress" // Currently being worked on
  | "review" // Completed but pending review
  | "done" // Completed tasks
  | "blocked"; // Cannot proceed, waiting on something

/** Activity type for tracking agent actions */
export type ActivityType =
  | "task_created"
  | "task_updated"
  | "comment_added"
  | "task_assigned"
  | "task_completed"
  | "agent_heartbeat";

/** Task entity representing a bead/task in Mission Control */
export interface Task {
  id: string;
  title: string;
  status: MissionStatus;
  assignees: string[];
  updatedAt: number; // Unix timestamp
  priority?: "P0" | "P1" | "P2" | "P3";
  labels?: string[];
  // Raw bead data for reference
  _raw?: unknown;
}

/** Comment entity for task discussions */
export interface Comment {
  id: string;
  taskId: string;
  author: string;
  content: string;
  timestamp: number; // Unix timestamp
  // Raw comment data for reference
  _raw?: unknown;
}

/** Agent session status tracking */
export interface AgentStatus {
  id: string;
  name: string;
  active: boolean;
  lastSeen: number; // Unix timestamp
  model: string;
  currentTask?: string; // Task ID if currently working on something
  sessionKey?: string;
}

/** Activity event for logging agent and task actions */
export interface Activity {
  type: ActivityType;
  agentId: string;
  taskId?: string;
  content?: string;
  timestamp: number; // Unix timestamp
}

/** Cache state for poller data */
export interface CacheState {
  tasks: Task[];
  comments: Map<string, Comment[]>; // taskId -> comments
  agents: AgentStatus[];
  lastUpdated: {
    tasks: number;
    comments: number;
    agents: number;
  };
}

/** Mission Control view state for UI components */
export interface MissionControlState {
  selectedTask?: string;
  filter: MissionStatus | "all";
  filterAssignee?: string;
  showComments: boolean;
  lastPoll: number;
}
