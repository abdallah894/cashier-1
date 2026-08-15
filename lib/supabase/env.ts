// Supabase connection env. Supports both key namings:
// new dashboards issue "publishable" keys (sb_publishable_…), older
// docs call the same thing the "anon" key. Direct member access keeps
// Next.js' static NEXT_PUBLIC_ inlining working.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_PUBLISHABLE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
