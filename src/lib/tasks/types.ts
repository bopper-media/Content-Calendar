// Shared contract for the Task / to-do module (Mia). Both the API routes and the
// /tasks UI build against these types + the endpoint shapes documented below.
//
// ENDPOINTS (all staff-gated + region-scoped; service-role writes):
//   GET    /api/v1/tasks?assignee=<userId|me|unassigned>&priority=<p>&status=<s>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
//            -> { tasks: Task[], users: TaskUser[], provisioned: boolean }
//            provisioned=false when the tasks table doesn't exist yet (migration
//            0042 not applied), the UI then shows a "being set up" empty state
//            instead of erroring.
//   POST   /api/v1/tasks  { title, description?, priority?, size?, start_date?, due_date?, assigned_to?, status? }  -> { task: Task }
//   PATCH  /api/v1/tasks/:id  { title?, description?, status?, priority?, size?, start_date?, due_date?, assigned_to? } -> { task: Task }
//            (start_date needs a due_date and must be <= it, else 422)
//            (status:'complete' stamps completed_at; leaving 'complete' clears it)
//   DELETE /api/v1/tasks/:id  -> { ok: true }
//   POST   /api/v1/tasks/extract  { notes, meeting_title?, default_assignee? }
//            -> { created: Task[], count: number }   (AI pulls action items from meeting notes)
//   POST   /api/v1/webhooks/granola  (x-granola-secret) { title?, notes|transcript, attendees? } -> { created, count }

/** A link or an uploaded image pinned to a task (migration 0046). */
export interface TaskAttachment {
  type: "link" | "image";
  url: string;
  name?: string;
}

export type TaskStatus = "todo" | "in_progress" | "complete";
export type TaskPriority = "low" | "medium" | "high";
export type TaskSize = "micro" | "macro";
export type TaskSource = "manual" | "granola";

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Complete" },
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const TASK_SIZES: { value: TaskSize; label: string }[] = [
  { value: "micro", label: "Micro" },
  { value: "macro", label: "Macro" },
];

/** A staff profile a task can belong to (from the users table). */
export interface TaskUser {
  id: string;
  full_name: string;
  email: string;
  title?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  color?: string | null;
  last_seen_at?: string | null; // presence: recent stamp = online
}

/** True when a user's presence heartbeat is fresh (within ~3 min). */
export function isOnline(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false;
  const t = Date.parse(lastSeen);
  return !Number.isNaN(t) && Date.now() - t < 3 * 60_000;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  size: TaskSize | null;
  due_date: string | null; // YYYY-MM-DD (London day)
  // Range start (migration 0073): with due_date it makes the task a date RANGE
  // (due_date stays the end). null = a plain single-date task, as before.
  start_date: string | null;
  assigned_to: string | null;
  // 'all' = assigned to the whole team (assigned_to stays null); otherwise null.
  assigned_scope: "all" | null;
  assignee: TaskUser | null;
  created_by: string | null;
  completed_at: string | null;
  // Pinned into the owner's "Top priority" lane; sort_order carries the manual
  // (drag) order within a lane, fractional so a card slots between two others
  // without renumbering the rest (migration 0054).
  top_priority: boolean;
  sort_order: number | null;
  // Escalated for someone else's approval / input: the task is blocked on this
  // person, waiting_note says what is needed. Both null = not blocked.
  waiting_on: string | null;
  waiting_note: string | null;
  source: TaskSource;
  source_ref: string | null;
  attachments: TaskAttachment[];
  created_at: string;
  updated_at: string;
}

/** A comment on a task card (migration 0047). */
export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string | null;
  author_name: string | null;
  author_color?: string | null;
  body: string;
  created_at: string;
}

/** Initials for the avatar chip when there's no avatar_url. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Postgres "table/column absent" signals (migration 0042 not applied yet). */
export function isMissingTasksSchema(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /(?:relation|table).*tasks|tasks.*does not exist/i.test(err.message ?? "");
}
