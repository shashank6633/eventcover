'use client';

import { useEffect, useState } from 'react';

/**
 * Reusable phone number input with country code dropdown.
 *
 * Defaults to India (+91), 10-digit national number. The `value` and `onChange`
 * speak E.164 format ("+917207666333") so server-side normalisation and DB
 * storage stay simple. If the input is incomplete or invalid, `onChange` is
 * called with an empty string so caller forms can detect "not yet valid".
 *
 * Validation rules are per-country (length range, allowed leading digits).
 * To add a country, append a row to COUNTRIES below.
 *
 * Usage:
 *   const [phone, setPhone] = useState('');
 *   <PhoneInput value={phone} onChange={setPhone} required />
 */

export interface PhoneCountry {
  code: string;       // dial code with leading +, e.g. "+91"
  iso: string;        // ISO 3166-1 alpha-2 — used as the option label
  flag: string;       // emoji for visual
  minDigits: number;  // min national number length
  maxDigits: number;  // max national number length
  leadingPattern?: RegExp; // first-digit pattern, e.g. /^[6-9]/ for IN mobile
}

export const COUNTRIES: PhoneCountry[] = [
  { code: '+91',  iso: 'IN', flag: '🇮🇳', minDigits: 10, maxDigits: 10, leadingPattern: /^[6-9]/ },
  { code: '+1',   iso: 'US', flag: '🇺🇸', minDigits: 10, maxDigits: 10 },
  { code: '+44',  iso: 'GB', flag: '🇬🇧', minDigits: 10, maxDigits: 11 },
  { code: '+971', iso: 'AE', flag: '🇦🇪', minDigits: 9,  maxDigits: 9  },
  { code: '+65',  iso: 'SG', flag: '🇸🇬', minDigits: 8,  maxDigits: 8  },
  { code: '+61',  iso: 'AU', flag: '🇦🇺', minDigits: 9,  maxDigits: 9  },
  { code: '+966', iso: 'SA', flag: '🇸🇦', minDigits: 9,  maxDigits: 9  },
];

const DEFAULT_COUNTRY = COUNTRIES[0]; // India

interface PhoneInputProps {
  value: string;
  onChange: (e164: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** Optional callback fired on every keystroke with current validity. */
  onValidityChange?: (valid: boolean) => void;
}

/** Parse an E.164 string back into { country, national }. */
function parseE164(value: string): { country: PhoneCountry; national: string } {
  const cleaned = String(value || '').replace(/[^\d+]/g, '');
  if (!cleaned) return { country: DEFAULT_COUNTRY, national: '' };

  // Longest dial-code prefix wins so "+971" matches before "+9"
  const sorted = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (cleaned.startsWith(c.code)) {
      return { country: c, national: cleaned.slice(c.code.length) };
    }
  }
  // Bare digits — assume default country
  if (/^\d+$/.test(cleaned)) {
    return { country: DEFAULT_COUNTRY, national: cleaned };
  }
  return { country: DEFAULT_COUNTRY, national: cleaned.replace(/^\+/, '') };
}

/** Is the national number valid for the given country? */
function isValid(country: PhoneCountry, national: string): boolean {
  if (national.length < country.minDigits || national.length > country.maxDigits) return false;
  if (country.leadingPattern && !country.leadingPattern.test(national)) return false;
  return /^\d+$/.test(national);
}

export function PhoneInput({
  value,
  onChange,
  placeholder = 'Enter 10-digit mobile number',
  required,
  disabled,
  autoFocus,
  className,
  onValidityChange,
}: PhoneInputProps) {
  const [country, setCountry] = useState<PhoneCountry>(() => parseE164(value).country);
  const [national, setNational] = useState<string>(() => parseE164(value).national);

  // Keep local state in sync when the parent updates `value` externally
  // (e.g., form reset, hydrating from server).
  useEffect(() => {
    const parsed = parseE164(value);
    if (parsed.country.code !== country.code) setCountry(parsed.country);
    if (parsed.national !== national) setNational(parsed.national);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(c: PhoneCountry, n: string) {
    if (isValid(c, n)) {
      onChange(`${c.code}${n}`);
      onValidityChange?.(true);
    } else {
      onChange('');
      onValidityChange?.(false);
    }
  }

  function handleCountryChange(iso: string) {
    const next = COUNTRIES.find((c) => c.iso === iso) ?? DEFAULT_COUNTRY;
    setCountry(next);
    emit(next, national);
  }

  function handleNationalChange(raw: string) {
    // Strip non-digits, hard-cap at the country's max length
    const digits = raw.replace(/\D/g, '').slice(0, country.maxDigits);
    setNational(digits);
    emit(country, digits);
  }

  const showError = required && national.length > 0 && !isValid(country, national);

  return (
    <div className={`flex items-stretch gap-2 ${className ?? ''}`}>
      <select
        className="input !w-auto pl-3 pr-8 font-medium"
        value={country.iso}
        onChange={(e) => handleCountryChange(e.target.value)}
        disabled={disabled}
        aria-label="Country code"
        style={{ maxWidth: 110 }}
      >
        {COUNTRIES.map((c) => (
          <option key={c.iso} value={c.iso}>
            {c.flag}  {c.code}
          </option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="tel-national"
        className={`input flex-1 ${showError ? '!border-rose-300' : ''}`}
        value={national}
        onChange={(e) => handleNationalChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={country.maxDigits}
      />
    </div>
  );
}
