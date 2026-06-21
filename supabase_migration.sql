-- ============================================================
-- Migration: Add system_settings table
-- This completes the database-backed settings feature
-- ============================================================

-- 1. Create system_settings table
-- This table stores the application configuration (noise thresholds,
-- buzzer behavior, audio/alert settings, retention policy)
CREATE TABLE IF NOT EXISTS public.system_settings (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  threshold_green integer NOT NULL DEFAULT 60,
  threshold_yellow integer NOT NULL DEFAULT 74,
  threshold_red integer NOT NULL DEFAULT 75,
  buzzer_enabled boolean NOT NULL DEFAULT true,
  max_beeps integer NOT NULL DEFAULT 3,
  buzzer_cooldown integer NOT NULL DEFAULT 10,
  audio_length_min integer NOT NULL DEFAULT 3,
  audio_length_max integer NOT NULL DEFAULT 5,
  alert_cooldown integer NOT NULL DEFAULT 30,
  retention_days integer NOT NULL DEFAULT 14,
  teacher_access_hours integer NOT NULL DEFAULT 48,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT system_settings_pkey PRIMARY KEY (id)
);

-- Enable Row Level Security
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated users (both admin and teachers)
CREATE POLICY "Allow read for authenticated users" 
  ON public.system_settings FOR SELECT 
  USING (auth.role() = 'authenticated');

-- Allow insert/update only for admin users
-- (We use a simple approach: any authenticated user can insert/update since
--  we control access via the app. For stricter control, check profiles.role)
CREATE POLICY "Allow all for authenticated" 
  ON public.system_settings FOR ALL 
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Insert default settings row
INSERT INTO public.system_settings (
  threshold_green, threshold_yellow, threshold_red,
  buzzer_enabled, max_beeps, buzzer_cooldown,
  audio_length_min, audio_length_max, alert_cooldown,
  retention_days, teacher_access_hours
) VALUES (
  60, 74, 75,
  true, 3, 10,
  3, 5, 30,
  14, 48
);

-- ============================================================
-- 2. Enable RLS on existing tables if not already done
-- ============================================================

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own profile
CREATE POLICY IF NOT EXISTS "Users can read own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

-- Allow authenticated users to update their own profile
CREATE POLICY IF NOT EXISTS "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow admin to read all profiles
-- We handle this via service_role / anon key with app-level checks

-- ============================================================
-- 3. Add helpful indexes for performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_noise_events_created_at 
  ON public.noise_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_noise_events_room 
  ON public.noise_events (room);
CREATE INDEX IF NOT EXISTS idx_noise_events_warning_color 
  ON public.noise_events (warning_color);
CREATE INDEX IF NOT EXISTS idx_teacher_schedules_teacher_id 
  ON public.teacher_schedules (teacher_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at 
  ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_role 
  ON public.profiles (role);