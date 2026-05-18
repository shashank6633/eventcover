import { getDb } from './db';

export interface AuditInput {
  actor: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown> | string;
}

export function logAudit(input: AuditInput) {
  const db = getDb();
  const details =
    typeof input.details === 'string'
      ? input.details
      : input.details
        ? JSON.stringify(input.details)
        : null;
  db.prepare(`
    INSERT INTO audit_log (timestamp, actor, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(Date.now(), input.actor, input.action, input.entityType || null, input.entityId || null, details);
}
