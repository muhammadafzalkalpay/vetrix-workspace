// Staff tasks: follow-ups the AI front desk (and later reminders) hand to a
// person, such as callbacks, refill requests and emergency alerts.
import { ForbiddenError, NotFoundError, ValidationError } from "@vetrix/domain";
import { writeAudit, type Actor } from "./clients";
import type { SqlClient } from "./sql-client";

export type TaskStatus = "open" | "in_progress" | "done";

export interface TaskItem {
  id: string;
  type: string;
  title: string | null;
  details: string | null;
  priority: "normal" | "urgent";
  status: TaskStatus;
  controlled_substance: boolean;
  created_at: Date;
  completed_at: Date | null;
  call_id: string | null;
  client_id: string | null;
  client_name: string | null;
  patient_id: string | null;
  patient_name: string | null;
}

/** Open tasks come urgent first, then oldest first; done tasks newest first. */
export async function listTasks(
  db: SqlClient,
  locationId: string,
  opts: { status?: "open" | "done"; limit?: number; offset?: number } = {},
): Promise<{ rows: TaskItem[]; total: number }> {
  const done = opts.status === "done";
  const { rows } = await db.query<TaskItem & { total: string }>(
    `SELECT t.id, t.type, t.title, t.details, t.priority, t.status, t.controlled_substance, t.created_at, t.completed_at,
            t.call_id, t.client_id, t.patient_id, p.name AS patient_name,
            nullif(trim(c.first_name || ' ' || c.last_name), '') AS client_name,
            count(*) OVER () AS total
     FROM staff_tasks t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN patients p ON p.id = t.patient_id
     WHERE t.location_id = $1 AND ${done ? "t.status = 'done'" : "t.status <> 'done'"}
     ORDER BY ${done ? "t.completed_at DESC" : "(t.priority = 'urgent') DESC, t.created_at"}
     LIMIT $2 OFFSET $3`,
    [locationId, Math.min(opts.limit ?? 50, 100), opts.offset ?? 0],
  );
  return { rows: rows.map(({ total: _total, ...r }) => r), total: Number(rows[0]?.total ?? 0) };
}

export async function countOpenTasks(db: SqlClient, locationId: string): Promise<{ open: number; urgent: number }> {
  const { rows } = await db.query<{ open: number; urgent: number }>(
    `SELECT count(*)::int AS open, count(*) FILTER (WHERE priority = 'urgent')::int AS urgent
     FROM staff_tasks WHERE location_id = $1 AND status <> 'done'`,
    [locationId],
  );
  return rows[0] ?? { open: 0, urgent: 0 };
}

/** Marks a task done or reopens it. Controlled-substance tasks need their own permission. */
export async function setTaskStatus(
  db: SqlClient,
  input: { locationId: string; taskId: string; status: TaskStatus; actor: Actor; canControlled: boolean },
): Promise<void> {
  if (!["open", "in_progress", "done"].includes(input.status)) throw new ValidationError("Choose a status.");
  const { rows } = await db.query<{ status: TaskStatus; controlled_substance: boolean }>(
    `SELECT status, controlled_substance FROM staff_tasks WHERE id = $1 AND location_id = $2 FOR UPDATE`,
    [input.taskId, input.locationId],
  );
  const task = rows[0];
  if (!task) throw new NotFoundError("Task", input.taskId);
  if (task.controlled_substance && !input.canControlled) throw new ForbiddenError();
  if (task.status === input.status) return;
  await db.query(
    `UPDATE staff_tasks SET status = $3, completed_at = CASE WHEN $3 = 'done' THEN now() ELSE NULL END WHERE id = $1 AND location_id = $2`,
    [input.taskId, input.locationId, input.status],
  );
  await writeAudit(db, {
    locationId: input.locationId,
    actor: input.actor,
    action: "task.status_changed",
    entityType: "staff_task",
    entityId: input.taskId,
    changes: { status: [task.status, input.status] },
  });
}
