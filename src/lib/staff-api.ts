import { jsonEndpoint, post } from '@/lib/api-request';
import type { StaffRole } from '@/lib/staff-session';

/** Staff accounts, through public/api/staff.php (owner only). */
const request = jsonEndpoint('/api/staff.php', 'Staff accounts');

export type StaffAccount = {
  username: string;
  name: string;
  role: StaffRole;
  /** db = made on the dashboard; env = STAFF_USERS in hPanel, read-only here */
  source: 'db' | 'env';
};

export async function listAccounts(): Promise<{ accounts: StaffAccount[]; me: string }> {
  const { accounts, me } = await request<{ accounts: StaffAccount[]; me: string }>('');
  return { accounts, me };
}

export async function createAccount(input: { username: string; name: string; role: StaffRole; password: string }): Promise<void> {
  await request('', post({ action: 'create', ...input }));
}

export async function updateAccount(input: { username: string; name: string; role: StaffRole }): Promise<void> {
  await request('', post({ action: 'update', ...input }));
}

/** Also signs them out everywhere. */
export async function setPassword(username: string, password: string): Promise<void> {
  await request('', post({ action: 'password', username, password }));
}

/** Returns how many upcoming bookings they were taken off. */
export async function deleteAccount(username: string): Promise<number> {
  return (await request<{ removedFrom: number }>('', post({ action: 'delete', username }))).removedFrom;
}

/** 14 characters without look-alikes (0/O, 1/l/I), easy to read out or text. */
export function generatePassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // Bytes at or above the largest multiple of chars.length are skipped, so every character is equally likely.
  const limit = 256 - (256 % chars.length);
  let out = '';
  while (out.length < 14) {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) if (b < limit && out.length < 14) out += chars[b % chars.length];
  }
  return out;
}
