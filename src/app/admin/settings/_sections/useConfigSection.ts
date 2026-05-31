'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Tiny hook that wraps /api/config GET + POST for a single section's keys.
 * Each section owns its own draft state but reuses one save flow.
 */
export function useConfigSection(keys: string[]) {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable identity for the keys array — fine to pass freshly each render
  // because we serialize for the effect dep.
  const keyList = keys.join(',');

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          const all = d.config || {};
          const slice: Record<string, string> = {};
          for (const k of keyList.split(',')) {
            if (k) slice[k] = all[k] ?? '';
          }
          setConfig(slice);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
  }, [keyList]);

  const set = useCallback((key: string, value: string) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setSaved(false);
  }, []);

  const save = useCallback(
    async (overrides?: Record<string, string>) => {
      setSaving(true);
      setError(null);
      setSaved(false);
      try {
        const updates: Record<string, string> = { ...config, ...(overrides || {}) };
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates }),
        });
        const data = await res.json();
        if (!data.ok) {
          setError(data.message || 'Save failed');
          return false;
        }
        // Refresh the local slice from server response so masked secrets read
        // back correctly (e.g. BANK_ACCOUNT_NUMBER becomes '••••••••').
        const all = data.config || {};
        const slice: Record<string, string> = {};
        for (const k of keyList.split(',')) {
          if (k) slice[k] = all[k] ?? '';
        }
        setConfig(slice);
        setSaved(true);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [config, keyList],
  );

  return { config, set, save, loaded, saving, saved, error };
}
