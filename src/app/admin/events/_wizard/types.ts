import type { BookingType, MessagesConfig, Event, TableType, OccupancyRule, CoverRates } from '@/lib/events';
import { DEFAULT_PRICING, DEFAULT_TABLE_TYPES } from '@/lib/pricing';

export type Step = 1 | 2 | 3 | 4;

export interface WizardState {
  // Step 1 — Event Details
  name: string;
  description: string;       // HTML
  image_data: string | null; // base64
  event_date: string;        // YYYY-MM-DD
  start_time: string;        // "21:30"
  is_public: boolean;
  artist_ids: string[];
  venue_id: string;
  genre: string;
  tags: string[];

  // Step 2 — Terms & FAQs
  terms: string;
  faqs: string;

  // Step 3 — Pricing & Tables
  entry_fee_per_person: number;
  cover_rates: CoverRates;
  entry_enabled: boolean;
  cover_enabled: boolean;
  table_types: TableType[];
  occupancy_rule: OccupancyRule;
  gst_percent: number;
  discount_percent: number;

  // Legacy field — kept for backward compat with offline ticketing,
  // not shown in the wizard UI anymore.
  booking_types: BookingType[];

  // Step 4 — Messages
  messages_config: MessagesConfig;
}

export const EMPTY_STATE: WizardState = {
  name: '',
  description: '',
  image_data: null,
  event_date: '',
  start_time: '',
  is_public: true,
  artist_ids: [],
  venue_id: '',
  genre: '',
  tags: [],
  terms: '',
  faqs: '',
  entry_fee_per_person: DEFAULT_PRICING.entry_fee_per_person,
  cover_rates: { ...DEFAULT_PRICING.cover_rates },
  entry_enabled: DEFAULT_PRICING.entry_enabled,
  cover_enabled: DEFAULT_PRICING.cover_enabled,
  table_types: [...DEFAULT_TABLE_TYPES],
  occupancy_rule: DEFAULT_PRICING.occupancy_rule,
  gst_percent: DEFAULT_PRICING.gst_percent,
  discount_percent: DEFAULT_PRICING.discount_percent,
  booking_types: [],
  messages_config: {},
};

export function hydrateFromEvent(e: Event): WizardState {
  return {
    name: e.name,
    description: e.description ?? '',
    image_data: e.image_data ?? null,
    event_date: e.event_date,
    start_time: e.start_time ?? '',
    is_public: e.is_public,
    artist_ids: e.artist_ids,
    venue_id: e.venue_id ?? '',
    genre: e.genre ?? '',
    tags: e.tags,
    terms: e.terms ?? '',
    faqs: e.faqs ?? '',
    entry_fee_per_person: e.entry_fee_per_person ?? DEFAULT_PRICING.entry_fee_per_person,
    cover_rates: e.cover_rates,
    entry_enabled: e.entry_enabled,
    cover_enabled: e.cover_enabled,
    table_types: e.table_types.length > 0 ? e.table_types : [...DEFAULT_TABLE_TYPES],
    occupancy_rule: e.occupancy_rule,
    gst_percent: e.gst_percent ?? 0,
    discount_percent: e.discount_percent ?? 0,
    booking_types: e.booking_types,
    messages_config: e.messages_config,
  };
}

export const STEP_LABELS: Record<Step, string> = {
  1: 'Event Details',
  2: "Terms & Conditions, FAQ's",
  3: 'Pricing & Tables',
  4: 'Messages',
};
