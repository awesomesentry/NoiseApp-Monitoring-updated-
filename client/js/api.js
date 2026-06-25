// ─── Backend REST API client (no Supabase credentials in browser) ───

const AUTH_TOKEN_KEY = "noise_monitor_auth_token";

function saveAuthToken(accessToken, refreshToken) {
  const data = { accessToken, refreshToken, savedAt: Date.now() };
  sessionStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(data));
}

function getAuthToken() {
  try {
    const raw = sessionStorage.getItem(AUTH_TOKEN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.accessToken || null;
  } catch {
    return null;
  }
}

function clearAuthToken() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

function getSessionAccessToken() {
  const adminRaw = sessionStorage.getItem("noise_monitor_session");
  const teacherRaw = sessionStorage.getItem("noise_monitor_teacher_session");
  for (const raw of [adminRaw, teacherRaw]) {
    if (!raw) continue;
    try {
      const session = JSON.parse(raw);
      if (session?.accessToken) return session.accessToken;
    } catch (_) {}
  }
  return getAuthToken();
}

async function apiRequest(path, options = {}) {
  const token = getSessionAccessToken();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message = (data && data.error) || text || res.statusText;
    throw new Error(message);
  }

  return data;
}

// ─── Auth ───
async function signUpWithPassword(email, password) {
  const data = await apiRequest("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (data.access_token) {
    saveAuthToken(data.access_token, data.refresh_token);
  }
  return data;
}

async function signInWithPassword(email, password) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (data.access_token) {
    saveAuthToken(data.access_token, data.refresh_token);
  }
  return data;
}

async function signOutUser(token) {
  await apiRequest("/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return true;
}

async function getUser(token) {
  try {
    const data = await apiRequest("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data.user;
  } catch {
    return null;
  }
}

// ─── Profiles ───
async function getProfileById(id) {
  const token = getSessionAccessToken();
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(id)}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) return null;
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    throw new Error((data && data.error) || text || res.statusText);
  }
  return data;
}

async function upsertProfile(id, updates) {
  return apiRequest(`/profiles/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

async function fetchProfiles() {
  return apiRequest("/profiles");
}

// ─── Teacher Classrooms ───
async function fetchTeacherClassrooms(teacherId) {
  return apiRequest(`/teachers/${encodeURIComponent(teacherId)}/classrooms`);
}

async function setTeacherClassrooms(teacherId, classroomIds) {
  return apiRequest(`/teachers/${encodeURIComponent(teacherId)}/classrooms`, {
    method: "PUT",
    body: JSON.stringify({ classroomIds }),
  });
}

// ─── Teacher Schedules ───
async function fetchTeacherSchedules(teacherId) {
  return apiRequest(`/teachers/${encodeURIComponent(teacherId)}/schedules`);
}

async function fetchAllTeacherSchedules() {
  return apiRequest("/teachers/schedules/all");
}

async function checkScheduleConflictWithOtherTeachers(
  teacherId,
  day,
  startTime,
  endTime,
  excludeId = null
) {
  return apiRequest("/teachers/schedules/check-conflict", {
    method: "POST",
    body: JSON.stringify({ teacherId, day, startTime, endTime, excludeId }),
  });
}

async function upsertTeacherSchedule(schedule) {
  return apiRequest("/teachers/schedules", {
    method: "POST",
    body: JSON.stringify(schedule),
  });
}

async function deleteTeacherSchedule(id) {
  return apiRequest(`/teachers/schedules/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ─── System Settings ───
async function fetchSystemSettings() {
  try {
    return await apiRequest("/settings");
  } catch (_) {
    return null;
  }
}

async function saveSystemSettings(settings) {
  return apiRequest("/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

// ─── Cleanup ───
async function cleanupExpiredNoiseEvents() {
  return apiRequest("/cleanup/expired-events", { method: "POST" });
}

// ─── Audit & Data ───
async function insertAuditLog(record) {
  if (!record.actor_id) {
    const session = getCurrentSessionInfo();
    if (session?.profile?.id) {
      record.actor_id = session.profile.id;
    }
  }
  // audit_logs schema: id, actor_id, action, detail, created_at only
  const payload = {
    action: record.action,
    detail: record.detail || "",
    actor_id: record.actor_id || null,
  };
  return apiRequest("/audit-logs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function fetchNoiseEvents(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.room) params.set("room", options.room);
  if (options.deviceId) params.set("deviceId", options.deviceId);
  if (options.severity) params.set("severity", options.severity);
  if (options.audioOnly) params.set("audioOnly", "true");
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  const qs = params.toString();
  return apiRequest(`/noise-events${qs ? `?${qs}` : ""}`);
}

async function fetchClassrooms() {
  return apiRequest("/classrooms");
}

async function fetchAuditLogs() {
  return apiRequest("/audit-logs");
}

// ─── Session info ───
function getCurrentSessionInfo() {
  try {
    const raw = sessionStorage.getItem("noise_monitor_current_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCurrentSessionInfo(info) {
  if (info) {
    sessionStorage.setItem("noise_monitor_current_user", JSON.stringify(info));
  } else {
    sessionStorage.removeItem("noise_monitor_current_user");
  }
}
