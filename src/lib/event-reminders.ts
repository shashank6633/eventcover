/**
 * Per-event WhatsApp reminders.
 *
 * The host opts in to reminders for an event and picks up to TWO offsets
 * (in minutes before the event start). A cron-triggered sweep walks every
 * active schedule and, for each schedule whose target moment falls inside
 * the next sweep window, fires the Interakt template once per confirmed
 * reservation. Each send is logged in event_reminder_attempts with a
 * UNIQUE(schedule_id, reservation_id) so a re-sweep can never double-fire.
 *
 * Template (host must register + Meta-approve):
 *   Name:     akan_event_reminder
 *   Language: en
 *   Body:     "Hi {{1}}, this is a reminder for {{2}} starting at {{3}}.
 *              See you soon!"
 *
 * Server-side only — never import from a client component. The Interakt
 * sender enforces the 1500 ms gap so sequential sends are rate-safe; we
 * call it sequentially (await) per the WA-rate-limit risk in the spec.
 */

import { nanoid } from 'nanoid';
import { getDb } from './db';
import { logAudit } from './audit';
import { getEvent } from './events';
import { sendInteraktTemplate, splitPhone, isInteraktConfigured } from './providers/whatsapp/interakt';

const MAX_ACTIVE_SCHEDULES = 2;
/**
 * The sweep fires schedules whose target moment is within this many minutes
 * of "now". The expected cron cadence is every 1-5 minutes, so a 5-minute
 * window means we catch every schedule even if the cron is a few seconds
 * late. The UNIQUE(schedule_id, reservation_id) dedup means duplicate hits
 * across consecutive sweeps are a no-op.
 */
const SWEEP_WINDOW_MINUTES = 5;

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export interface ReminderScheduleRow {
  id: string;
  event_id: string;
  minutes_before: number;
  enabled: number;
  last_fired_at: number;
  created_at: number;
  created_by: string | null;
}

export interface ReminderSchedule {
  id: string;
  eventId: string;
  minutesBefore: number;
  enabled: boolean;
  lastFiredAt: number;
  createdAt: number;
  createdBy: string | null;
}

function hydrate(row: ReminderScheduleRow): ReminderSchedule {
  return {
    id: row.id,
    eventId: row.event_id,
    minutesBefore: row.minutes_before,
    enabled: row.enabled === 1,
    lastFiredAt: row.last_fired_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function listSchedules(eventId: string): ReminderSchedule[] {
  if (!eventId) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM event_reminder_schedule
        WHERE event_id = ?
        ORDER BY minutes_before ASC`,
    )
    .all(eventId) as ReminderScheduleRow[];
  return rows.map(hydrate);
}

export function getSchedule(scheduleId: string): ReminderSchedule | null {
  if (!scheduleId) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM event_reminder_schedule WHERE id = ?')
    .get(scheduleId) as ReminderScheduleRow | undefined;
  return row ? hydrate(row) : null;
}

export interface UpsertScheduleInput {
  eventId: string;
  /** New schedule when omitted; update when provided. */
  scheduleId?: string;
  /** Minutes before event start, 1..1440. */
  minutesBefore: number;
  /** Defaults to true. */
  enabled?: boolean;
  actor: string;
}

/**
 * Add (or update) a schedule. Enforces:
 *   • minutesBefore ∈ (0, 1440]
 *   • max 2 ACTIVE schedules per event (disabled rows don't count)
 *   • UNIQUE(event_id, minutes_before) — same offset cannot be added twice
 *
 * Throws Error with a human-readable message on violation.
 */
export function upsertSchedule(input: UpsertScheduleInput): ReminderSchedule {
  if (!input.eventId) throw new Error('eventId is required.');
  const minutes = Math.floor(Number(input.minutesBefore));
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    throw new Error('Reminder offset must be between 1 and 1440 minutes.');
  }
  const ev = getEvent(input.eventId);
  if (!ev) throw new Error('Event not found.');

  const db = getDb();
  const enabledFlag = input.enabled === false ? 0 : 1;

  const existing = listSchedules(input.eventId);

  // Block duplicate offsets — except when updating in place
  const dup = existing.find(
    (s) => s.minutesBefore === minutes && s.id !== input.scheduleId,
  );
  if (dup) {
    throw new Error('A reminder for this offset already exists.');
  }

  // Cap on active schedules — only blocks NEW active rows, not toggles
  if (enabledFlag === 1) {
    const activeCount = existing.filter(
      (s) => s.enabled && s.id !== input.scheduleId,
    ).length;
    if (activeCount >= MAX_ACTIVE_SCHEDULES) {
      throw new Error(
        `You can have at most ${MAX_ACTIVE_SCHEDULES} active reminders per event.`,
      );
    }
  }

  const now = Date.now();
  if (input.scheduleId) {
    const current = getSchedule(input.scheduleId);
    if (!current || current.eventId !== input.eventId) {
      throw new Error('Schedule not found.');
    }
    db.prepare(
      `UPDATE event_reminder_schedule
          SET minutes_before = ?, enabled = ?
        WHERE id = ?`,
    ).run(minutes, enabledFlag, input.scheduleId);
    logAudit({
      actor: input.actor,
      action: 'event_reminder_schedule_update',
      entityType: 'event',
      entityId: input.eventId,
      details: { schedule_id: input.scheduleId, minutes_before: minutes, enabled: !!enabledFlag },
    });
    return getSchedule(input.scheduleId)!;
  }

  const id = nanoid();
  db.prepare(
    `INSERT INTO event_reminder_schedule
       (id, event_id, minutes_before, enabled, last_fired_at, created_at, created_by)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, input.eventId, minutes, enabledFlag, now, input.actor || null);

  logAudit({
    actor: input.actor,
    action: 'event_reminder_schedule_add',
    entityType: 'event',
    entityId: input.eventId,
    details: { schedule_id: id, minutes_before: minutes, enabled: !!enabledFlag },
  });

  return getSchedule(id)!;
}

export function deleteSchedule(scheduleId: string, actor: string): boolean {
  const existing = getSchedule(scheduleId);
  if (!existing) return false;
  const db = getDb();
  db.prepare('DELETE FROM event_reminder_schedule WHERE id = ?').run(scheduleId);
  logAudit({
    actor,
    action: 'event_reminder_schedule_delete',
    entityType: 'event',
    entityId: existing.eventId,
    details: { schedule_id: scheduleId, minutes_before: existing.minutesBefore },
  });
  return true;
}

/**
 * The "master" toggle simply reports whether ANY schedule for this event
 * is currently active. There is no separate boolean column — the master
 * switch is derived state.
 */
export function getMasterEnabled(eventId: string): boolean {
  if (!eventId) return false;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM event_reminder_schedule
        WHERE event_id = ? AND enabled = 1`,
    )
    .get(eventId) as { c: number };
  return (row?.c ?? 0) > 0;
}

/**
 * Bulk toggle every schedule for the event. enabling=true sets every row
 * to enabled=1 BUT preserves the max-2 cap — if there are >2 disabled rows
 * we only re-enable the first 2 (sorted by minutes_before) and leave the
 * rest off. enabling=false simply zeroes every row.
 */
export function setMasterEnabled(eventId: string, enabled: boolean, actor: string): boolean {
  if (!eventId) return false;
  const db = getDb();
  if (!enabled) {
    db.prepare(
      `UPDATE event_reminder_schedule SET enabled = 0 WHERE event_id = ?`,
    ).run(eventId);
    logAudit({
      actor,
      action: 'event_reminder_master_toggle',
      entityType: 'event',
      entityId: eventId,
      details: { enabled: false },
    });
    return true;
  }
  // Re-enable up to the cap
  const all = listSchedules(eventId);
  const toEnable = all.slice(0, MAX_ACTIVE_SCHEDULES).map((s) => s.id);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE event_reminder_schedule SET enabled = 0 WHERE event_id = ?`).run(eventId);
    if (toEnable.length === 0) return;
    const stmt = db.prepare(`UPDATE event_reminder_schedule SET enabled = 1 WHERE id = ?`);
    for (const id of toEnable) stmt.run(id);
  });
  tx();
  logAudit({
    actor,
    action: 'event_reminder_master_toggle',
    entityType: 'event',
    entityId: eventId,
    details: { enabled: true, count: toEnable.length },
  });
  return true;
}

// ─── Sweep ────────────────────────────────────────────────────────────────

/**
 * Compute the epoch ms for the event's start moment in IST. event_date is
 * YYYY-MM-DD and start_time is HH:MM (optional). When start_time is null
 * we treat the event as starting at midnight IST of the day — best-effort,
 * the host who opted into reminders almost always sets a start_time anyway.
 *
 * Mirrors the conversion in src/lib/expiry.ts so behavior stays consistent.
 */
function eventStartIstMs(eventDate: string, startTime: string | null): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate || '');
  if (!dateMatch) return null;
  const [, y, m, d] = dateMatch;
  let hh = 0;
  let mm = 0;
  if (startTime) {
    const tm = /^(\d{2}):(\d{2})/.exec(startTime);
    if (tm) { hh = Number(tm[1]); mm = Number(tm[2]); }
  }
  // Date.UTC interprets args as UTC, so we then back off by IST_OFFSET_MS to
  // turn that into the equivalent IST wall-clock moment.
  const asIfUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), hh, mm, 0);
  return asIfUtc - IST_OFFSET_MS;
}

function formatStartTimeIst(eventStartMs: number): string {
  return new Date(eventStartMs).toLocaleString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

export interface SweepResult {
  schedulesConsidered: number;
  schedulesFired: number;
  sendsAttempted: number;
  sendsSucceeded: number;
  sendsFailed: number;
  skippedDuplicate: number;
}

interface DueSchedule {
  schedule: ReminderSchedule;
  eventId: string;
  eventName: string;
  eventStartMs: number;
}

/**
 * Find schedules whose fire moment (event start - minutes_before) falls
 * inside [now, now + SWEEP_WINDOW_MINUTES). We do NOT fire schedules whose
 * moment has already passed — the host shouldn't send a "starting in 30
 * minutes" reminder 4 hours after the event began.
 */
function findDueSchedules(now: number): DueSchedule[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.*, e.id AS ev_id, e.name AS ev_name, e.event_date, e.start_time, e.status
         FROM event_reminder_schedule s
         JOIN events e ON e.id = s.event_id
        WHERE s.enabled = 1
          AND e.status = 'live'`,
    )
    .all() as Array<
      ReminderScheduleRow & {
        ev_id: string;
        ev_name: string;
        event_date: string;
        start_time: string | null;
        status: string;
      }
    >;

  const due: DueSchedule[] = [];
  const windowEnd = now + SWEEP_WINDOW_MINUTES * 60 * 1000;
  for (const row of rows) {
    const startMs = eventStartIstMs(row.event_date, row.start_time);
    if (!startMs) continue;
    const fireAt = startMs - row.minutes_before * 60 * 1000;
    if (fireAt < now) continue;          // already missed
    if (fireAt >= windowEnd) continue;   // not yet in window
    due.push({
      schedule: hydrate(row),
      eventId: row.ev_id,
      eventName: row.ev_name,
      eventStartMs: startMs,
    });
  }
  return due;
}

/**
 * Sweep all due schedules and fire WhatsApp reminders for confirmed
 * reservations of each. Sequential — never concurrent (Interakt rate
 * limit). On 429 we stop the sweep early; the next cron tick will resume.
 *
 * Idempotent: UNIQUE(schedule_id, reservation_id) on event_reminder_attempts
 * means re-running this for the same window is safe.
 */
export async function sweepReminders(): Promise<SweepResult> {
  const result: SweepResult = {
    schedulesConsidered: 0,
    schedulesFired: 0,
    sendsAttempted: 0,
    sendsSucceeded: 0,
    sendsFailed: 0,
    skippedDuplicate: 0,
  };

  if (!isInteraktConfigured()) {
    logAudit({
      actor: 'system',
      action: 'event_reminder_sweep_skipped',
      details: { reason: 'interakt_not_configured' },
    });
    return result;
  }

  const now = Date.now();
  const dueList = findDueSchedules(now);
  result.schedulesConsidered = dueList.length;

  if (dueList.length === 0) return result;

  const db = getDb();
  const insAttempt = db.prepare(
    `INSERT INTO event_reminder_attempts
       (id, schedule_id, reservation_id, sent_at, interakt_message_id, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const updFired = db.prepare(
    `UPDATE event_reminder_schedule SET last_fired_at = ? WHERE id = ?`,
  );

  let stopSweep = false;
  for (const due of dueList) {
    if (stopSweep) break;
    const reservations = db
      .prepare(
        `SELECT r.id, r.name, r.phone
           FROM reservations r
          WHERE r.event_id = ?
            AND r.status != 'cancelled'
            AND r.status != 'no_show'
            AND r.phone IS NOT NULL
            AND r.phone != ''`,
      )
      .all(due.eventId) as Array<{ id: string; name: string; phone: string }>;

    let firedAny = false;
    for (const r of reservations) {
      if (stopSweep) break;
      // Pre-check dedup so we don't even send when an attempt row exists.
      const existing = db
        .prepare(
          `SELECT 1 FROM event_reminder_attempts
             WHERE schedule_id = ? AND reservation_id = ? LIMIT 1`,
        )
        .get(due.schedule.id, r.id);
      if (existing) {
        result.skippedDuplicate++;
        continue;
      }

      result.sendsAttempted++;
      const { countryCode, phoneNumber } = splitPhone(r.phone);
      const startLabel = formatStartTimeIst(due.eventStartMs);
      const send = await sendInteraktTemplate({
        countryCode,
        phoneNumber,
        templateName: 'akan_event_reminder',
        languageCode: 'en',
        bodyValues: [r.name || 'Guest', due.eventName, startLabel],
        callbackData: `event_reminder:${due.schedule.id}:${r.id}`,
      });

      const attemptId = nanoid();
      try {
        insAttempt.run(
          attemptId,
          due.schedule.id,
          r.id,
          Date.now(),
          send.ok ? send.messageId || null : null,
          send.ok ? null : (send.error || 'unknown'),
          Date.now(),
        );
      } catch (err) {
        // UNIQUE violation = a parallel sweep beat us to it. Treat as success.
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE/i.test(msg)) {
          result.skippedDuplicate++;
          continue;
        }
        throw err;
      }

      if (send.ok) {
        result.sendsSucceeded++;
        firedAny = true;
      } else {
        result.sendsFailed++;
        // 429 — Interakt rate limit. Stop the whole sweep; next cron will retry.
        if (send.status === 429) {
          stopSweep = true;
        }
      }
    }

    if (firedAny) {
      updFired.run(Date.now(), due.schedule.id);
      result.schedulesFired++;
    }
  }

  logAudit({
    actor: 'system',
    action: 'event_reminder_sweep',
    details: result as unknown as Record<string, unknown>,
  });

  return result;
}
