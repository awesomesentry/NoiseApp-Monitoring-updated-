-- ============================================================
-- Complete Migration: All tables, RLS policies, and functions
-- ============================================================

-- 1. Create system_settings table
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

-- 2. Enable RLS on system_settings
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read for authenticated users" ON public.system_settings;
CREATE POLICY "Allow read for authenticated users" 
  ON public.system_settings FOR SELECT 
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow all for authenticated" ON public.system_settings;
CREATE POLICY "Allow all for authenticated" 
  ON public.system_settings FOR ALL 
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 3. Insert default settings
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
) ON CONFLICT (id) DO NOTHING;

-- 4. Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 5. Enable RLS on noise_events
ALTER TABLE public.noise_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read noise_events" ON public.noise_events;
CREATE POLICY "Authenticated users can read noise_events" 
  ON public.noise_events FOR SELECT 
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role can insert noise_events" ON public.noise_events;
CREATE POLICY "Service role can insert noise_events" 
  ON public.noise_events FOR INSERT 
  WITH CHECK (auth.role() = 'authenticated');

-- 6. Enable RLS on classrooms
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read classrooms" ON public.classrooms;
CREATE POLICY "Authenticated users can read classrooms" 
  ON public.classrooms FOR SELECT 
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage classrooms" ON public.classrooms;
CREATE POLICY "Authenticated users can manage classrooms" 
  ON public.classrooms FOR ALL 
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 7. Enable RLS on teacher_classrooms
ALTER TABLE public.teacher_classrooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read teacher_classrooms" ON public.teacher_classrooms;
CREATE POLICY "Authenticated users can read teacher_classrooms" 
  ON public.teacher_classrooms FOR SELECT 
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage teacher_classrooms" ON public.teacher_classrooms;
CREATE POLICY "Authenticated users can manage teacher_classrooms" 
  ON public.teacher_classrooms FOR ALL 
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 8. Enable RLS on teacher_schedules
ALTER TABLE public.teacher_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read teacher_schedules" ON public.teacher_schedules;
CREATE POLICY "Authenticated users can read teacher_schedules" 
  ON public.teacher_schedules FOR SELECT 
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage teacher_schedules" ON public.teacher_schedules;
CREATE POLICY "Authenticated users can manage teacher_schedules" 
  ON public.teacher_schedules FOR ALL 
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 9. Enable RLS on audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read audit_logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can read audit_logs" 
  ON public.audit_logs FOR SELECT 
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert audit_logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert audit_logs" 
  ON public.audit_logs FOR INSERT 
  WITH CHECK (auth.role() = 'authenticated');

-- 10. Create indexes for performance
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
CREATE INDEX IF NOT EXISTS idx_system_settings_id 
  ON public.system_settings (id);

-- 11. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 12. Create trigger for system_settings updated_at
DROP TRIGGER IF EXISTS update_system_settings_updated_at ON public.system_settings;
CREATE TRIGGER update_system_settings_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 13. Create function to log audit events
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action text,
  p_detail text DEFAULT '',
  p_user_name text DEFAULT 'system',
  p_actor_id uuid DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.audit_logs (action, detail, user_name, actor_id, created_at)
  VALUES (p_action, p_detail, p_user_name, p_actor_id, now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. Create function to delete expired noise events and audio
CREATE OR REPLACE FUNCTION public.delete_expired_noise_events(
  p_retention_days integer DEFAULT NULL
)
RETURNS integer AS $$
DECLARE
  v_retention_days integer;
  v_cutoff timestamp with time zone;
  v_deleted_count integer;
BEGIN
  -- Use provided retention days or fetch from system_settings
  IF p_retention_days IS NULL THEN
    SELECT COALESCE(retention_days, 14) INTO v_retention_days
    FROM public.system_settings
    LIMIT 1;
  ELSE
    v_retention_days := p_retention_days;
  END IF;

  v_cutoff := now() - (v_retention_days || ' days')::interval;

  DELETE FROM public.noise_events
  WHERE created_at < v_cutoff;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- Log the cleanup action
  INSERT INTO public.audit_logs (action, detail, user_name, created_at)
  VALUES (
    'System cleanup',
    format('Deleted %s expired noise events older than %s days (cutoff: %s)', v_deleted_count, v_retention_days, v_cutoff),
    'system',
    now()
  );

  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 15. Grant permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.system_settings TO authenticated;
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.noise_events TO authenticated;
GRANT ALL ON public.classrooms TO authenticated;
GRANT ALL ON public.teacher_classrooms TO authenticated;
GRANT ALL ON public.teacher_schedules TO authenticated;
GRANT ALL ON public.audit_logs TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 16. Grant execute on cleanup function to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_expired_noise_events(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expired_noise_events() TO authenticated;