import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUBMISSIONS_SUPABASE_URL ||
  "https://dxupgmsscysvztxdtaku.supabase.co";

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUBMISSIONS_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4dXBnbXNzY3lzdnp0eGR0YWt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODU2MzUsImV4cCI6MjA5MjM2MTYzNX0.Iek_fKX47_95Vxvo3V6C_5neh6OQay-2TGgf_VTBAZE";

export const submissionsSupabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);