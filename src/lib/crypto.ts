import bcrypt from 'bcryptjs';
import { nanoid, customAlphabet } from 'nanoid';

const txnRand = customAlphabet('0123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 5);

export function generatePin(length = 6): string {
  let pin = '';
  for (let i = 0; i < length; i++) pin += Math.floor(Math.random() * 10);
  return pin;
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export function generateTxnId(venue: string): string {
  const prefix = (venue || 'EVT').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'EVT';
  const d = new Date();
  const mmdd = String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return `${prefix}-${mmdd}-${txnRand()}`;
}

export function generateRedemptionId(): string {
  return 'RED-' + nanoid(10);
}
