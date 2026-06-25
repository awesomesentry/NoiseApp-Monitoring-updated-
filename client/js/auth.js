// ─── Auth using Supabase Auth (GoTrue) + profiles table ───
const SESSION_KEY = "noise_monitor_session";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// ─── Login: authenticates via Supabase Auth, then loads profile ───
async function login(email, password) {
  try {
    const authData = await signInWithPassword(email, password);
    const { access_token, refresh_token, user } = authData;
    if (!access_token || !user) return null;

    // Save the auth token
    saveAuthToken(access_token, refresh_token);

    // Load or create profile
    let profile = await getProfileById(user.id);
    if (!profile) {
      // First login — create profile with default role
      await upsertProfile(user.id, {
        role: "admin",
        full_name: user.email,
        mobile: null,
      });
      profile = await getProfileById(user.id);
    }

    // Build session
    const session = {
      id: user.id,
      email: user.email,
      role: profile?.role || "admin",
      name: profile?.full_name || user.email,
      assignedRooms: [],
      deviceIds: [],
      loginAt: Date.now(),
      lastActivity: Date.now(),
      accessToken: access_token,
      refreshToken: refresh_token,
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setCurrentSessionInfo({ profile: { id: user.id, role: session.role } });

    await logAdminAudit("Admin login", `${session.email} signed in`);
    return session;
  } catch (e) {
    console.warn("Login failed:", e);
    return null;
  }
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
  const email = session?.email;
  const token = session?.accessToken;
  sessionStorage.removeItem(SESSION_KEY);
  clearAuthToken();
  setCurrentSessionInfo(null);
  if (typeof stopAutoRefresh === "function") try { stopAutoRefresh(); } catch (_) {}
  if (typeof stopTeacherAutoRefresh === "function") try { stopTeacherAutoRefresh(); } catch (_) {}
  window.location.href = "index.html";
  if (session) {
    logAdminAudit("Admin logout", `${email} signed out`).catch(() => {});
    if (token) signOutUser(token).catch(() => {});
  }
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

async function logAdminAudit(action, detail = "") {
  if (typeof insertAuditLog !== "function") return;
  try {
    const session = getSession();
    const record = { action, detail };
    if (session?.id) record.actor_id = session.id;
    await insertAuditLog(record);
  } catch (e) {
    console.warn("Audit log failed:", e);
  }
}
