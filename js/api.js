// ─── Supabase REST helpers ───
function supabaseHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "return=representation",
  };
}

function authHeaders(token) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "return=representation",
  };
}

function restUrl(table, query = "") {
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return `${SUPABASE_URL}/rest/v1/${table}${q}`;
}

async function supabaseGet(table, query = "", headers = null) {
  const h = headers || supabaseHeaders();
  const res = await fetch(restUrl(table, query), { headers: h });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table}: ${res.status} ${text}`);
  }
  return res.json();
}

async function supabasePost(table, body, headers = null) {
  const h = headers || supabaseHeaders();
  const res = await fetch(restUrl(table), {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table}: ${res.status} ${text}`);
  }
  return res.json();
}

async function supabasePatch(table, query, body, headers = null) {
  const h = headers || supabaseHeaders();
  const url = restUrl(table, query);
  const res = await fetch(url, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table}: ${res.status} ${text}`);
  }
  return res.json();
}

async function supabaseDelete(table, query, headers = null) {
  const h = headers || supabaseHeaders();
  const res = await fetch(restUrl(table, query), {
    method: "DELETE",
    headers: h,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table}: ${res.status} ${text}`);
  }
  return res.json();
}

// ─── Supabase Auth (GoTrue) ───
const AUTH_URL = `${SUPABASE_URL}/auth/v1`;

async function _supabaseAuth(method, body) {
  const res = await fetch(`${AUTH_URL}/${method}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.msg || data.error_description || data.error || "Auth failed");
  }
  return data;
}

async function signUpWithPassword(email, password) {
  return _supabaseAuth("signup", { email, password });
}

async function signInWithPassword(email, password) {
  return _supabaseAuth("token?grant_type=password", { email, password });
}

async function signOutUser(token) {
  const res = await fetch(`${AUTH_URL}/logout`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sign out: ${res.status} ${text}`);
  }
  return true;
}

async function getUser(token) {
  const res = await fetch(`${AUTH_URL}/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

// ─── Auth token storage ───
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

// ─── Profile helpers ───
async function getProfileById(id) {
  const list = await supabaseGet(TABLES.profiles, `id=eq.${id}&select=*`);
  return list.length ? list[0] : null;
}

async function upsertProfile(id, updates) {
  // Check if profile exists
  const existing = await getProfileById(id);
  if (existing) {
    return supabasePatch(
      TABLES.profiles,
      `id=eq.${id}`,
      { ...updates, updated_at: new Date().toISOString() }
    );
  } else {
    return supabasePost(TABLES.profiles, {
      id,
      ...updates,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}

async function fetchProfiles() {
  return supabaseGet(TABLES.profiles, "select=*&order=full_name.asc");
}

// ─── Teacher Classrooms ───
async function fetchTeacherClassrooms(teacherId) {
  // Get classroom names via the junction table
  const url = `${SUPABASE_URL}/rest/v1/${TABLES.teacherClassrooms}?select=classrooms!inner(name,id)&teacher_id=eq.${teacherId}`;
  const headers = supabaseHeaders();
  headers["Accept"] = "application/json";
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map(r => r.classrooms).filter(Boolean);
}

async function setTeacherClassrooms(teacherId, classroomIds) {
  // Delete existing, then insert new ones
  await supabaseDelete(TABLES.teacherClassrooms, `teacher_id=eq.${teacherId}`);
  if (classroomIds.length === 0) return [];
  const inserts = classroomIds.map(cid => ({
    teacher_id: teacherId,
    classroom_id: cid,
  }));
  const results = [];
  for (const ins of inserts) {
    try {
      const r = await supabasePost(TABLES.teacherClassrooms, ins);
      results.push(r);
    } catch (e) {
      console.warn("Failed to link classroom:", e);
    }
  }
  return results;
}

// ─── Teacher Schedules ───
async function fetchTeacherSchedules(teacherId) {
  return supabaseGet(
    TABLES.teacherSchedules,
    `teacher_id=eq.${teacherId}&order=day.asc,start_time.asc`
  );
}

async function upsertTeacherSchedule(schedule) {
  const { id, teacher_id, day, start_time, end_time, subject, room } = schedule;
  const body = {
    teacher_id,
    day,
    start_time,
    end_time,
    subject: subject || null,
    room: room || null,
    updated_at: new Date().toISOString(),
  };
  if (id) {
    await supabasePatch(TABLES.teacherSchedules, `id=eq.${id}`, body);
    return { ...body, id };
  } else {
    body.created_at = new Date().toISOString();
    const result = await supabasePost(TABLES.teacherSchedules, body);
    return result.length ? result[0] : result;
  }
}

async function deleteTeacherSchedule(id) {
  return supabaseDelete(TABLES.teacherSchedules, `id=eq.${id}`);
}

// ─── System Settings ───
async function fetchSystemSettings() {
  try {
    const rows = await supabaseGet(TABLES.systemSettings, "select=*&limit=1");
    if (rows.length) return rows[0];
  } catch (_) {}
  return null;
}

async function saveSystemSettings(settings) {
  const existing = await fetchSystemSettings();
  const body = {
    ...settings,
    updated_at: new Date().toISOString(),
  };
  if (existing && existing.id) {
    await supabasePatch(TABLES.systemSettings, `id=eq.${existing.id}`, body);
  } else {
    body.created_at = new Date().toISOString();
    await supabasePost(TABLES.systemSettings, body);
  }
}

// ─── Existing API functions (unchanged) ───
async function insertAuditLog(record) {
  // If actor_id is not provided, try to get it from profile
  if (!record.actor_id) {
    const session = getCurrentSessionInfo();
    if (session?.profile?.id) {
      record.actor_id = session.profile.id;
    }
  }
  return supabasePost(TABLES.auditLogs, record);
}

async function fetchNoiseEvents(options = {}) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");
  if (options.limit) params.set("limit", String(options.limit));

  if (options.room) params.set("room", `eq.${options.room}`);
  if (options.deviceId) params.set("device_id", `eq.${options.deviceId}`);
  if (options.severity) {
    params.set("warning_color", `eq.${options.severity.toUpperCase()}`);
  }
  if (options.audioOnly) {
    params.set("audio_recorded", "eq.true");
    params.set("audio_url", "not.is.null");
    params.set("warning_color", "eq.RED");
  }
  if (options.from) {
    params.set("created_at", `gte.${options.from}T00:00:00`);
  }
  if (options.to) {
    params.append("created_at", `lte.${options.to}T23:59:59`);
  }

  return supabaseGet(TABLES.noiseEvents, params.toString());
}

async function fetchClassrooms() {
  return supabaseGet(TABLES.classrooms, "select=*&order=name.asc");
}

async function fetchAuditLogs() {
  return supabaseGet(
    TABLES.auditLogs,
    "select=*&order=created_at.desc&limit=50"
  );
}

// ─── Current session info from sessionStorage ───
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