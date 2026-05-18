import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';

export type TableStatus = 'open' | 'booked' | 'occupied' | 'closed';
export const TABLE_STATUSES: TableStatus[] = ['open', 'booked', 'occupied', 'closed'];

export interface VenueTable {
  id: string;
  label: string;
  capacity: number;
  zone: string | null;
  status: TableStatus;
  active_wallet_txn: string | null;
  notes: string | null;
  created_at: number;
}

export function listTables(): VenueTable[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM venue_tables ORDER BY label ASC
  `).all() as VenueTable[];
}

export function createTable(input: {
  label: string; capacity?: number; zone?: string; notes?: string;
}): VenueTable {
  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  db.prepare(`
    INSERT INTO venue_tables (id, label, capacity, zone, status, notes, created_at)
    VALUES (?, ?, ?, ?, 'open', ?, ?)
  `).run(id, input.label.trim(), input.capacity || 4, input.zone || null, input.notes || null, now);
  logAudit({ actor: 'admin', action: 'table_create', entityType: 'table', entityId: id, details: { label: input.label } });
  return db.prepare('SELECT * FROM venue_tables WHERE id = ?').get(id) as VenueTable;
}

export function updateTable(id: string, patch: Partial<Pick<VenueTable, 'label' | 'capacity' | 'zone' | 'status' | 'active_wallet_txn' | 'notes'>>): VenueTable | null {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM venue_tables WHERE id = ?').get(id) as VenueTable | undefined;
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(patch)) {
    fields.push(`${key} = ?`);
    values.push((val === undefined ? null : val) as string | number | null);
  }
  if (fields.length === 0) return existing;
  values.push(id);
  db.prepare(`UPDATE venue_tables SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  logAudit({ actor: 'admin', action: 'table_update', entityType: 'table', entityId: id, details: patch });
  return db.prepare('SELECT * FROM venue_tables WHERE id = ?').get(id) as VenueTable;
}

export function deleteTable(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM venue_tables WHERE id = ?').run(id);
  if (result.changes > 0) {
    logAudit({ actor: 'admin', action: 'table_delete', entityType: 'table', entityId: id });
    return true;
  }
  return false;
}

export function attachWalletToTable(tableId: string, txnId: string) {
  const db = getDb();
  db.prepare(`
    UPDATE venue_tables SET status = 'occupied', active_wallet_txn = ? WHERE id = ?
  `).run(txnId, tableId);
}
