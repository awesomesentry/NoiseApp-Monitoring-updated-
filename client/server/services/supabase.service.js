const env = require("../config/env");
const TABLES = require("../config/tables");

function baseHeaders(useServiceRole = false, userToken = null) {
  const key = useServiceRole && env.supabaseServiceRoleKey
    ? env.supabaseServiceRoleKey
    : env.supabaseAnonKey;

  const headers = {
    apikey: key,
    Authorization: `Bearer ${userToken || key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "return=representation",
  };

  return headers;
}

function restUrl(table, query = "") {
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return `${env.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${table}${q}`;
}

async function parseResponse(res, context) {
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
    const message =
      (data && (data.message || data.msg || data.error_description || data.error)) ||
      text ||
      res.statusText;
    const err = new Error(`${context}: ${res.status} ${message}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function get(table, query = "", userToken = null) {
  const res = await fetch(restUrl(table, query), { headers: baseHeaders(false, userToken) });
  return parseResponse(res, table);
}

async function post(table, body, userToken = null, useServiceRole = false) {
  const res = await fetch(restUrl(table), {
    method: "POST",
    headers: baseHeaders(useServiceRole, userToken),
    body: JSON.stringify(body),
  });
  return parseResponse(res, table);
}

async function patch(table, query, body, userToken = null, useServiceRole = false) {
  const res = await fetch(restUrl(table, query), {
    method: "PATCH",
    headers: baseHeaders(useServiceRole, userToken),
    body: JSON.stringify(body),
  });
  return parseResponse(res, table);
}

async function del(table, query, userToken = null) {
  const res = await fetch(restUrl(table, query), {
    method: "DELETE",
    headers: baseHeaders(false, userToken),
  });
  return parseResponse(res, table);
}

async function rpc(functionName, params = {}, useServiceRole = false) {
  const url = `${env.supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${functionName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: baseHeaders(useServiceRole),
    body: JSON.stringify(params),
  });
  return parseResponse(res, `rpc/${functionName}`);
}

const AUTH_URL = `${env.supabaseUrl.replace(/\/+$/, "")}/auth/v1`;

async function authRequest(path, body) {
  const res = await fetch(`${AUTH_URL}/${path}`, {
    method: "POST",
    headers: {
      apikey: env.supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.msg || data.error_description || data.error || "Auth failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

async function signUp(email, password) {
  return authRequest("signup", { email, password });
}

async function signIn(email, password) {
  return authRequest("token?grant_type=password", { email, password });
}

async function signOut(token) {
  const res = await fetch(`${AUTH_URL}/logout`, {
    method: "POST",
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Sign out: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return true;
}

async function getUser(token) {
  const res = await fetch(`${AUTH_URL}/user`, {
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function updateUserPassword(token, password) {
  const res = await fetch(`${AUTH_URL}/user`, {
    method: "PUT",
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.msg || data.error_description || data.message || "Password update failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getProfileById(id, userToken) {
  const list = await get(TABLES.profiles, `id=eq.${id}&select=*`, userToken);
  return list.length ? list[0] : null;
}

async function upsertProfile(id, updates, userToken, useServiceRole = false) {
  const existing = await getProfileById(id, userToken);
  const payload = { ...updates, updated_at: new Date().toISOString() };
  if (existing) {
    return patch(TABLES.profiles, `id=eq.${id}`, payload, userToken, useServiceRole);
  }
  return post(
    TABLES.profiles,
    { id, ...payload, created_at: new Date().toISOString() },
    userToken,
    useServiceRole
  );
}

async function fetchTeacherClassrooms(teacherId, userToken) {
  const url = restUrl(
    TABLES.teacherClassrooms,
    `select=classrooms!inner(name,id)&teacher_id=eq.${teacherId}`
  );
  const res = await fetch(url, { headers: baseHeaders(false, userToken) });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r) => r.classrooms).filter(Boolean);
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTime12h(timeStr) {
  if (!timeStr) return "—";
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m || 0).padStart(2, "0")} ${period}`;
}

module.exports = {
  TABLES,
  get,
  post,
  patch,
  del,
  rpc,
  signUp,
  signIn,
  signOut,
  getUser,
  updateUserPassword,
  getProfileById,
  upsertProfile,
  fetchTeacherClassrooms,
  timeToMinutes,
  formatTime12h,
};
