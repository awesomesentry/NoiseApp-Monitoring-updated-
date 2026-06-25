-- ============================================================
-- RUN THIS FIRST in Supabase SQL Editor
-- Creates the auto-cleanup function for old recordings
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_expired_noise_events(
  p_retention_days integer DEFAULT NULL
)
RETURNS integer AS $$
DECLARE
  v_retention_days integer;
  v_cutoff timestamp with time zone;
  v_deleted_count integer;
BEGIN
  IF p_retention_days IS NULL THEN
    SELECT COALESCE(retention_days, 14) INTO v_retention_days
    FROM public.system_settings LIMIT 1;
  ELSE
    v_retention_days := p_retention_days;
  END IF;

  v_cutoff := now() - (v_retention_days || ' days')::interval;

  DELETE FROM public.noise_events WHERE created_at < v_cutoff;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  INSERT INTO public.audit_logs (action, detail, created_at)
  VALUES ('System cleanup',
    format('Deleted %s expired noise events older than %s days', v_deleted_count, v_retention_days),
    now());

  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_expired_noise_events(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expired_noise_events() TO authenticated;

-- Also grant to anon role (needed for REST API calls with anon key)
GRANT EXECUTE ON FUNCTION public.delete_expired_noise_events(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.delete_expired_noise_events() TO anon;
