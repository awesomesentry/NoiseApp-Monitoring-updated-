const USERS = {
  admin: {
    password: "admin123",
    role: "admin",
    name: "System Administrator",
    assignedRooms: [],
  },
};

const SESSION_KEY = "noise_monitor_session";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

async function logAdminAudit(action, detail = "") {
  if (typeof insertAuditLog !== "function") return;
  try {
    const session = getSession();
    await insertAuditLog({
      action,
      user_name: session?.username || "admin",
      detail,
    });
  } catch (e) {
    console.warn("Audit log failed:", e);
  }
}

async function login(username, password) {
  const user = USERS[username.trim().toLowerCase()];
  if (!user || user.password !== password) return null;
  const session = {
    username: username.trim().toLowerCase(),
    role: user.role,
    name: user.name,
    assignedRooms: user.assignedRooms || [],
    deviceIds: user.deviceIds || [],
    loginAt: Date.now(),
    lastActivity: Date.now(),
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  await logAdminAudit("Admin login", `${session.username} signed in`);
  return session;
}

function getSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (Date.now() - session.lastActivity > SESSION_TIMEOUT_MS) {
      logout();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function touchSession() {
  const s = getSession();
  if (s) {
    s.lastActivity = Date.now();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }
}

async function logout() {
  const session = getSession();
  if (session) {
    await logAdminAudit("Admin logout", `${session.username} signed out`);
  }
  sessionStorage.removeItem(SESSION_KEY);
  if (typeof stopAutoRefresh === 'function') try { stopAutoRefresh(); } catch (_) {}
  if (typeof stopTeacherAutoRefresh === 'function') try { stopTeacherAutoRefresh(); } catch (_) {}
  await new Promise(r => setTimeout(r, 100));
  window.location.href = "index.html";
}

function requireAuth() {
  const session = getSession();
  if (!session || session.role !== "admin") {
    window.location.href = "index.html";
    return null;
  }
  touchSession();
  return session;
}

function isAdmin(session) {
  return session && session.role === "admin";
}

function filterLogsForUser(logs, sess) {
  if (isAdmin(sess)) return logs;
  return logs.filter(
    (l) =>
      sess.assignedRooms.includes(l.room) ||
      (sess.deviceIds && sess.deviceIds.includes(l.deviceId))
  );
}

function getRemainingSessionMs(session) {
  return Math.max(0, SESSION_TIMEOUT_MS - (Date.now() - session.lastActivity));
}
