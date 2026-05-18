/**
 * Client-safe role enums. Do NOT import DB or server code here — this file is
 * bundled into client components (AdminShell, Staff page).
 */
export type UserRole = 'host' | 'manager' | 'cashier' | 'captain' | 'entry';
export const ALL_ROLES: UserRole[] = ['host', 'manager', 'cashier', 'captain', 'entry'];
export const ROLE_LABEL: Record<UserRole, string> = {
  host: 'Host',
  manager: 'Manager',
  cashier: 'Cashier',
  captain: 'Captain',
  entry: 'Entry / Bouncer',
};

export interface PublicUser {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  created_at: number;
  created_by: string | null;
}
