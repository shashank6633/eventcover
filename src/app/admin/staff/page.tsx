'use client';

import { useEffect, useState } from 'react';
import { ROLE_LABEL, ALL_ROLES, type PublicUser, type UserRole } from '@/lib/roles';
import { relativeTime } from '@/lib/format';

interface Me { id: string; name: string; role: UserRole; }

export default function StaffPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => { if (d.ok) setMe(d.user); });
    load();
  }, []);

  async function load() {
    setLoading(true); setError(null);
    const res = await fetch('/api/users');
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    const data = await res.json();
    if (!data.ok) setError(data.message);
    else setUsers(data.users || []);
    setLoading(false);
  }

  async function toggleActive(u: PublicUser) {
    await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !u.active }),
    });
    load();
  }

  async function resetPin(u: PublicUser) {
    const pin = prompt(`Set a new PIN for ${u.name} (4–6 digits)`);
    if (!pin) return;
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    }).then((r) => r.json());
    if (!res.ok) alert(res.message);
    else alert(`PIN updated for ${u.name}.`);
  }

  async function remove(u: PublicUser) {
    if (u.role === 'host') {
      alert('Cannot delete a host account from here. Change the role first.');
      return;
    }
    if (!confirm(`Delete ${u.name}? This cannot be undone.`)) return;
    const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' }).then((r) => r.json());
    if (!res.ok) alert(res.message);
    load();
  }

  if (forbidden) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="card">
          <div className="font-semibold text-rose-700">Not allowed</div>
          <p className="text-sm text-slate-400 mt-2">
            Only the host can manage staff accounts. Ask your host to give you access.
          </p>
        </div>
      </div>
    );
  }

  const isHost = me?.role === 'host';

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] tracking-widest uppercase text-slate-400">Access</div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Staff</h1>
          <p className="text-sm text-slate-400 mt-1">
            Create accounts for your managers, captains, and entry/bouncer staff. Each account
            signs in with phone + PIN and only sees the pages allowed for their role.
          </p>
        </div>
      </div>

      {isHost && <CreateUserForm onCreated={load} />}

      <div className="card mt-6">
        {loading ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : error ? (
          <div className="text-rose-700 text-sm">{error}</div>
        ) : users.length === 0 ? (
          <div className="text-slate-400 text-sm">No staff yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-200">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Phone</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2">Created</th>
                  <th className="pb-2">Status</th>
                  {isHost && <th className="pb-2"></th>}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-200 last:border-0">
                    <td className="py-2.5 text-slate-900">
                      {u.name}
                      {u.id === me?.id && <span className="ml-2 text-[10px] text-emerald-700 uppercase tracking-wider">you</span>}
                    </td>
                    <td className="py-2.5 text-slate-700 font-mono text-xs">{u.phone}</td>
                    <td className="py-2.5">
                      <span className={`tag ${roleTag(u.role)}`}>{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td className="py-2.5 text-slate-400 text-xs">{relativeTime(u.created_at)}</td>
                    <td className="py-2.5">
                      <span className={`tag ${u.active ? 'tag-active' : 'tag-exhausted'}`}>
                        {u.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    {isHost && (
                      <td className="py-2.5 whitespace-nowrap text-right">
                        <button className="text-xs text-slate-400 hover:text-slate-900 mr-3" onClick={() => toggleActive(u)}>
                          {u.active ? 'Disable' : 'Enable'}
                        </button>
                        <button className="text-xs text-sky-600 hover:text-sky-700 mr-3" onClick={() => resetPin(u)}>
                          Reset PIN
                        </button>
                        {u.id !== me?.id && u.role !== 'host' && (
                          <button className="text-xs text-rose-600 hover:text-rose-700" onClick={() => remove(u)}>
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!isHost && (
        <div className="card mt-4 border-amber-200 bg-amber-50">
          <div className="text-sm text-amber-700">
            You're signed in as <b>{ROLE_LABEL[me?.role || 'captain']}</b> — you can view staff but only the host can create/edit accounts.
          </div>
        </div>
      )}
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('captain');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setMessage(null);

    if (!name.trim() || !phone.trim() || !/^\d{4,6}$/.test(pin) || !role) {
      setError('Name, phone, role, and 4–6 digit PIN are required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim() || undefined, role, pin }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.message); return; }
      setMessage(`Created ${data.user.name}. They can now sign in with phone ${data.user.phone} and PIN ${pin}.`);
      setName(''); setPhone(''); setEmail(''); setPin(''); setRole('captain');
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mt-6">
      <div className="font-semibold text-slate-900">Add staff member</div>
      <div className="text-xs text-slate-500 mt-1">
        Manager = everything except staff management. Captain = redemptions only. Entry = door/issue only.
      </div>
      {error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">
          {message}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Arjun Reddy" />
        </div>
        <div>
          <label className="label">Phone (login)</label>
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91..." />
        </div>
        <div>
          <label className="label">Email (optional)</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Staff PIN (4–6 digits)</label>
          <input className="input input-pin" type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                 value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
        </div>
        <div className="flex items-end">
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </div>
    </form>
  );
}

function roleTag(r: UserRole): string {
  if (r === 'host') return 'border-emerald-200 text-emerald-700 bg-emerald-50';
  if (r === 'manager') return 'border-sky-200 text-sky-700 bg-sky-50';
  if (r === 'captain') return 'border-amber-200 text-amber-700 bg-amber-50';
  return 'border-slate-200 text-slate-700 bg-slate-50';
}
