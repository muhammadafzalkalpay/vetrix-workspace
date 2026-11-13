// Reads for the app shell and the Overview screen. "Today" is the clinic's
// own calendar day in its time zone, never the server's.
import type { SqlClient } from "./sql-client";

export interface LocationSummary {
  id: string;
  name: string;
  timezone: string;
  status: "onboarding" | "live" | "paused" | "closed";
}

/** Locations in this clinic database, limited to the ids given (what the person may open). */
export async function listLocations(client: SqlClient, ids: string[]): Promise<LocationSummary[]> {
  if (ids.length === 0) return [];
  const { rows } = await client.query<LocationSummary>(
    `SELECT id, name, timezone, status FROM locations WHERE id = ANY($1::uuid[]) ORDER BY name`,
    [ids],
  );
  return rows;
}

export interface TodayAppointment {
  id: string;
  start_at: Date;
  end_at: Date;
  status: string;
  triage_level: "routine" | "urgent" | "emergency";
  patient_name: string;
  species: string;
  client_name: string;
  service_name: string;
  provider_name: string | null;
  room_name: string | null;
}

export interface OpenTask {
  id: string;
  type: string;
  priority: "normal" | "urgent";
  title: string | null;
  details: string | null;
  patient_name: string | null;
  created_at: Date;
}

export interface OverviewData {
  appointments: TodayAppointment[];
  tasks: OpenTask[];
  counts: { activePatients: number; clients: number; unconfirmedToday: number; openTasks: number };
}

// Start and end of the clinic's current day, as timestamps.
const TODAY = `
  WITH day AS (
    SELECT (date_trunc('day', now() AT TIME ZONE l.timezone) AT TIME ZONE l.timezone) AS starts
    FROM locations l WHERE l.id = $1
  )`;

export async function loadOverview(client: SqlClient, locationId: string): Promise<OverviewData> {
  const [appointments, tasks, counts] = await Promise.all([
    client.query<TodayAppointment>(
      `${TODAY}
       SELECT a.id, a.start_at, a.end_at, a.status, a.triage_level,
              p.name AS patient_name, p.species,
              trim(c.first_name || ' ' || coalesce(c.last_name, '')) AS client_name,
              s.name AS service_name, pr.display_name AS provider_name, r.name AS room_name
       FROM day
       JOIN appointments a ON a.start_at >= day.starts AND a.start_at < day.starts + interval '1 day'
       JOIN patients p ON p.id = a.patient_id
       JOIN clients c ON c.id = a.client_id
       JOIN services s ON s.id = a.service_id
       LEFT JOIN providers pr ON pr.id = a.provider_id
       LEFT JOIN rooms r ON r.id = a.room_id
       WHERE a.location_id = $1 AND a.status NOT IN ('cancelled')
       ORDER BY a.start_at`,
      [locationId],
    ),
    client.query<OpenTask>(
      `SELECT t.id, t.type, t.priority, t.title, t.details, p.name AS patient_name, t.created_at
       FROM staff_tasks t LEFT JOIN patients p ON p.id = t.patient_id
       WHERE t.location_id = $1 AND t.status <> 'done'
       ORDER BY (t.priority = 'urgent') DESC, t.created_at
       LIMIT 6`,
      [locationId],
    ),
    client.query<{ active_patients: number; clients: number; unconfirmed_today: number; open_tasks: number }>(
      `${TODAY}
       SELECT
         (SELECT count(*)::int FROM patients WHERE location_id = $1 AND status = 'active') AS active_patients,
         (SELECT count(*)::int FROM clients WHERE location_id = $1) AS clients,
         (SELECT count(*)::int FROM appointments, day
            WHERE location_id = $1 AND status = 'requested'
              AND start_at >= day.starts AND start_at < day.starts + interval '1 day') AS unconfirmed_today,
         (SELECT count(*)::int FROM staff_tasks WHERE location_id = $1 AND status <> 'done') AS open_tasks`,
      [locationId],
    ),
  ]);
  const c = counts.rows[0]!;
  return {
    appointments: appointments.rows,
    tasks: tasks.rows,
    counts: {
      activePatients: c.active_patients,
      clients: c.clients,
      unconfirmedToday: c.unconfirmed_today,
      openTasks: c.open_tasks,
    },
  };
}
