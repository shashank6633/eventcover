import { getDb } from './db';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { ALL_ROLES, ROLE_LABEL, type UserRole, type PublicUser } from './roles';

export { ALL_ROLES, ROLE_LABEL };
export type { UserRole, PublicUser };

export interface UserRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: UserRole;
  pin_hash: string;
  active: number;
  created_at: number;
  created_by: string | null;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id, name: row.name, phone: row.phone, email: row.email,
    role: row.role, active: !!row.active,
    created_at: row.created_at, created_by: row.created_by,
  };
}

export function listUsers(): PublicUser[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM users ORDER BY role, name`).all() as UserRow[];
  return rows.map(toPublic);
}

export function getUser(id: string): PublicUser | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return row ? toPublic(row) : null;
}

export function getUserByPhone(phone: string): UserRow | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(normalizePhone(phone)) as UserRow | undefined;
  return row ?? null;
}

export function getUserByEmail(email: string): UserRow | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE LOWER(email) = LOWER(?)`).get(email.trim()) as UserRow | undefined;
  return row ?? null;
}

/**
 * Resolve a user by either phone or email. Caller passes the raw input + type.
 * Used by OTP request flow.
 */
export function getUserByIdentifier(identifier: string, type: 'email' | 'phone'): UserRow | null {
  if (type === 'email') return getUserByEmail(identifier);
  return getUserByPhone(identifier);
}

export function normalizePhone(input: string): string {
  return input.trim().replace(/\s+/g, '');
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function normalizeIdentifier(identifier: string, type: 'email' | 'phone'): string {
  return type === 'email' ? normalizeEmail(identifier) : normalizePhone(identifier);
}

export interface CreateUserInput {
  name: string;
  phone: string;
  email?: string;
  role: UserRole;
  pin: string;
  createdBy: string;
}

export function createUser(input: CreateUserInput): PublicUser {
  if (!ALL_ROLES.includes(input.role)) throw new Error(`Invalid role: ${input.role}`);
  if (!/^\d{4,6}$/.test(input.pin)) throw new Error('PIN must be 4–6 digits');
  if (!input.name.trim()) throw new Error('Name is required');
  if (!input.phone.trim()) throw new Error('Phone is required');

  const db = getDb();
  const existing = getUserByPhone(input.phone);
  if (existing) throw new Error(`A user with phone ${input.phone} already exists`);

  const id = nanoid();
  const hash = bcrypt.hashSync(input.pin, 10);
  db.prepare(`
    INSERT INTO users (id, name, phone, email, role, pin_hash, active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, input.name.trim(), input.phone.trim(), input.email?.trim() || null, input.role, hash, Date.now(), input.createdBy);

  logAudit({
    actor: input.createdBy, action: 'user_create', entityType: 'user', entityId: id,
    details: { name: input.name, role: input.role, phone: input.phone },
  });
  return getUser(id)!;
}

export function updateUser(
  id: string,
  patch: Partial<Pick<CreateUserInput, 'name' | 'phone' | 'email' | 'role' | 'pin'>> & { active?: boolean },
  actor: string,
): PublicUser | null {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.name != null) { fields.push('name = ?'); values.push(patch.name.trim()); }
  if (patch.phone != null) { fields.push('phone = ?'); values.push(patch.phone.trim()); }
  if ('email' in patch) { fields.push('email = ?'); values.push(patch.email?.trim() || null); }
  if (patch.role != null) {
    if (!ALL_ROLES.includes(patch.role)) throw new Error(`Invalid role: ${patch.role}`);
    fields.push('role = ?'); values.push(patch.role);
  }
  if (patch.pin != null) {
    if (!/^\d{4,6}$/.test(patch.pin)) throw new Error('PIN must be 4–6 digits');
    fields.push('pin_hash = ?'); values.push(bcrypt.hashSync(patch.pin, 10));
  }
  if (patch.active !== undefined) { fields.push('active = ?'); values.push(patch.active ? 1 : 0); }

  if (fields.length === 0) return toPublic(existing);
  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  logAudit({
    actor, action: 'user_update', entityType: 'user', entityId: id,
    details: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, k === 'pin' ? '***' : v])),
  });
  return getUser(id);
}

export function deleteUser(id: string, actor: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  if (result.changes > 0) {
    logAudit({ actor, action: 'user_delete', entityType: 'user', entityId: id });
    return true;
  }
  return false;
}

export function verifyUserPin(phone: string, pin: string): UserRow | null {
  const user = getUserByPhone(phone);
  if (!user || !user.active) return null;
  if (!bcrypt.compareSync(pin, user.pin_hash)) return null;
  return user;
}

export function countUsers(): number {
  const db = getDb();
  return (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c;
}
