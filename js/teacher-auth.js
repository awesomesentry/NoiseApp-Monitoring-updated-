const TEACHER_ACCOUNTS_KEY = "noise_monitor_teacher_accounts";
const TEACHER_SESSION_KEY = "noise_monitor_teacher_session";
const TEACHER_SCHEDULES_KEY = "noise_monitor_teacher_schedules";
const TEACHER_ACCESS_HOURS = 48;
const TEACHER_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function getTeacherAccounts() {
  try {
    const raw = localStorage.getItem(TEACHER_ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTeacherAccounts(accounts) {
  localStorage.setItem(TEACHER_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function initDefaultTeacherAccount() {
  const accounts = getTeacherAccounts();
  if (accounts.some((a) => a.email === "teacher@school.edu")) return;
  accounts.push({
    id: "demo-teacher-1",
    name: "Mr. Chiong, Joriz",
    email: "teacher@school.edu",
    password: "teacher123",
    assignedRooms: ["ICT Lab 2"],
    deviceIds: ["esp32_noise_01"],
    defaultSubject: "ICT",
    createdAt: new Date().toISOString(),
  });
  saveTeacherAccounts(accounts);
}

function signupTeacher({ name, email, password, room }) {
  const normalizedEmail = email.trim().toLowerCase();
  const accounts = getTeacherAccounts();

  if (accounts.some((a) => a.email === normalizedEmail)) {
    return { ok: false, error: "An account with this email already exists." };
  }
  if (password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  accounts.push({
    id: `teacher-${Date.now()}`,
    name: name.trim(),
    email: normalizedEmail,
    password,
    assignedRooms: room.trim() ? [room.trim()] : [],
    deviceIds: [],
    defaultSubject: "",
    createdAt: new Date().toISOString(),
  });
  saveTeacherAccounts(accounts);
  return { ok: true };
}

async function logTeacherAudit(action, detail = "") {
  if (typeof insertAuditLog !== "function") return;
  try {
    const session = getTeacherSession();
    await insertAuditLog({
      action,
      user_name: session?.username || "teacher",
      detail,
    });
  } catch (e) {
    console.warn("Audit log failed:", e);
  }
}

async function loginTeacher(email, password) {
  initDefaultTeacherAccount();
  const normalizedEmail = email.trim().toLowerCase();
  const account = getTeacherAccounts().find(
    (a) => a.email === normalizedEmail && a.password === password
  );
  if (!account) return null;

  const session = {
    id: account.id,
    username: account.email,
    role: "teacher",
    name: account.name,
    assignedRooms: account.assignedRooms || [],
    deviceIds: account.deviceIds || [],
    loginAt: Date.now(),
    lastActivity: Date.now(),
  };
  sessionStorage.setItem(TEACHER_SESSION_KEY, JSON.stringify(session));
  await logTeacherAudit("Teacher login", `${session.username} signed in`);
  return session;
}

function getTeacherSession() {
  const raw = sessionStorage.getItem(TEACHER_SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (Date.now() - session.lastActivity > TEACHER_SESSION_TIMEOUT_MS) {
      teacherLogout();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function touchTeacherSession() {
  const s = getTeacherSession();
  if (s) {
    s.lastActivity = Date.now();
    sessionStorage.setItem(TEACHER_SESSION_KEY, JSON.stringify(s));
  }
}

async function teacherLogout() {
  const session = getTeacherSession();
  if (session) {
    await logTeacherAudit("Teacher logout", `${session.username} signed out`);
  }
  sessionStorage.removeItem(TEACHER_SESSION_KEY);
  if (typeof stopTeacherAutoRefresh === 'function') try { stopTeacherAutoRefresh(); } catch (_) {}
  if (typeof stopAutoRefresh === 'function') try { stopAutoRefresh(); } catch (_) {}
  await new Promise(r => setTimeout(r, 100));
  window.location.href = "teacher-login.html";
}

function requireTeacherAuth() {
  const session = getTeacherSession();
  if (!session) {
    window.location.href = "teacher-login.html";
    return null;
  }
  touchTeacherSession();
  return session;
}

function getTeacherSchedulesStore() {
  try {
    const raw = localStorage.getItem(TEACHER_SCHEDULES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTeacherSchedulesStore(store) {
  localStorage.setItem(TEACHER_SCHEDULES_KEY, JSON.stringify(store));
}

function getTeacherSchedule(teacherId) {
  const store = getTeacherSchedulesStore();
  return store[teacherId] || { slots: [], defaultSubject: "" };
}

function saveTeacherSchedule(teacherId, schedule) {
  const store = getTeacherSchedulesStore();
  store[teacherId] = schedule;
  saveTeacherSchedulesStore(store);
}

function updateTeacherAccountProfile(teacherId, updates) {
  const accounts = getTeacherAccounts();
  const idx = accounts.findIndex((a) => a.id === teacherId);
  if (idx === -1) return false;
  accounts[idx] = { ...accounts[idx], ...updates };
  saveTeacherAccounts(accounts);
  return true;
}

function getTeacherAccountById(teacherId) {
  return getTeacherAccounts().find((a) => a.id === teacherId) || null;
}

function syncTeacherSessionFromAccount(session) {
  const account = getTeacherAccountById(session.id);
  if (!account) return session;
  return {
    ...session,
    name: account.name,
    assignedRooms: account.assignedRooms || [],
    deviceIds: account.deviceIds || [],
    defaultSubject: account.defaultSubject || "",
  };
}

function getTeacherRemainingSessionMs(session) {
  return Math.max(0, TEACHER_SESSION_TIMEOUT_MS - (Date.now() - session.lastActivity));
}

function isWithinTeacherAccessWindow(datetime) {
  const eventTime = new Date(datetime).getTime();
  const cutoff = Date.now() - TEACHER_ACCESS_HOURS * 60 * 60 * 1000;
  return eventTime >= cutoff;
}

function matchesTeacherAssignment(log, session) {
  if (!session) return false;
  const roomMatch =
    session.assignedRooms?.length &&
    session.assignedRooms.some(
      (r) => r && (log.room === r || log.room?.includes(r))
    );
  const deviceMatch =
    session.deviceIds?.length && session.deviceIds.includes(log.deviceId);
  return roomMatch || deviceMatch;
}

function isRedEvent(log) {
  return (
    log.status === "red" ||
    (log.warningColor && log.warningColor.toUpperCase() === "RED")
  );
}

function normalizeName(value) {
  return (value || "").trim().toLowerCase();
}

function teacherNameMatches(logTeacher, sessionName) {
  const a = normalizeName(logTeacher);
  const b = normalizeName(sessionName);
  if (!a || a === "—" || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function eventMatchesTeacherSchedule(log, session) {
  const schedule = getTeacherSchedule(session.id);
  const slots = schedule.slots || [];
  if (slots.length === 0) return false;

  const eventDate = new Date(log.datetime);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const eventDay = dayNames[eventDate.getDay()];
  const eventMins = eventDate.getHours() * 60 + eventDate.getMinutes();

  return slots.some((slot) => {
    if (slot.day !== eventDay) return false;
    const [sh, sm] = (slot.startTime || "00:00").split(":").map(Number);
    const [eh, em] = (slot.endTime || "23:59").split(":").map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    if (eventMins < startMins || eventMins > endMins) return false;
    if (slot.subject && slot.subject !== "—" && log.subject && log.subject !== "—") {
      return normalizeName(log.subject).includes(normalizeName(slot.subject));
    }
    return true;
  });
}

function matchesTeacherEvent(log, session) {
  if (!session) return false;

  const roomMatch = matchesTeacherAssignment(log, session);
  if (!roomMatch) return false;

  const ownName = teacherNameMatches(log.teacher, session.name);

  if (log.teacher && log.teacher !== "—") {
    if (ownName) return eventMatchesTeacherSchedule(log, session);
    return false;
  }

  return eventMatchesTeacherSchedule(log, session);
}

function filterLogsByDateTime(logs, fromDate, toDate, fromTime, toTime) {
  return logs.filter((l) => {
    if (fromDate && l.date < fromDate) return false;
    if (toDate && l.date > toDate) return false;
    if (fromTime || toTime) {
      const eventDate = new Date(l.datetime);
      const eventMins = eventDate.getHours() * 60 + eventDate.getMinutes();
      const parseTime = (t) => {
        if (!t) return null;
        const [h, m] = t.split(":");
        return parseInt(h, 10) * 60 + parseInt(m, 10);
      };
      const fromMins = parseTime(fromTime);
      const toMins = parseTime(toTime);
      if (fromMins !== null && eventMins < fromMins) return false;
      if (toMins !== null && eventMins > toMins) return false;
    }
    return true;
  });
}

function filterTeacherEvents(logs, session) {
  return logs.filter(
    (l) =>
      isRedEvent(l) &&
      matchesTeacherEvent(l, session) &&
      isWithinTeacherAccessWindow(l.datetime)
  );
}

function filterTeacherAudioLogs(logs, session) {
  return filterTeacherEvents(logs, session).filter(
    (l) => l.audioRecorded && l.audioUrl
  );
}

function formatAccessWindowRemaining(datetime) {
  const expires = new Date(datetime).getTime() + TEACHER_ACCESS_HOURS * 60 * 60 * 1000;
  const msLeft = expires - Date.now();
  if (msLeft <= 0) return "Expired";
  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
  return `${hours}h left`;
}

initDefaultTeacherAccount();
