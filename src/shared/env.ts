// Variables públicas de compilación (Vite). Ver .env.example.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
export const CLOUD_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
