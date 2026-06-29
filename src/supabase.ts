import { createClient } from '@supabase/supabase-js';

export type AvailabilityRow = {
  id?: string;
  user_name: string;
  day_of_week: number;
  slot_time: string;
  is_available: boolean;
  created_at?: string;
  updated_at?: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      realtime: {
        params: {
          eventsPerSecond: 20,
        },
      },
    })
  : null;
