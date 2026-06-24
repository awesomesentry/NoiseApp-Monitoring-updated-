// ============================================================
// Configuration Template
// ============================================================
// 
// To configure the application:
// 1. Copy this file to config.js
// 2. Update the values below with your Supabase project credentials
// 3. Never commit config.js with real credentials to version control
//
// For production, set these values via your deployment platform's
// environment variable injection, or build a small server-side
// endpoint that serves config.js with injected environment variables.
//
// ============================================================

// Configuration is loaded dynamically. Defaults are used as fallback.
let SUPABASE_URL = "https://your-project-id.supabase.co";
let SUPABASE_ANON_KEY = "your-supabase-anon-key";

const TABLES = {
  noiseEvents: "noise_events",
  classrooms: "classrooms",
  auditLogs: "audit_logs",
  profiles: "profiles",
  teacherClassrooms: "teacher_classrooms",
  teacherSchedules: "teacher_schedules",
  systemSettings: "system_settings",
};