// ─── Teacher Auth using Supabase Auth (GoTrue) + profiles/teacher_classrooms/teacher_schedules ───
const TEACHER_SESSION_KEY = "noise_monitor_teacher_session";
// teacherAccessHours is loaded dynamically from system_settings
const TEACHER_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// ─── Login ───
async function loginTeacher(email, password) {
  try {
    const authData = await signInWithPassword(email, password);
    const { access_token, refresh_token, user } = authData;
    if (!access_token || !user) return null;

    // Save auth token
    saveAuthToken(access_token, refresh_token);

    // Load profile
    let profile = await getProfileById(user.id);
    if (!profile) {
      // Create profile automatically for new teacher signups (from admin or signup flow)
      return null; // Teacher must be created via signup or admin first
    }

    // Only teachers can sign in via teacher portal
    if (profile.role !== "teacher") {
      return null;
    }

    // Load assigned classrooms + schedule rooms (device IDs)
    const assignedClassrooms = await fetchTeacherClassrooms(user.id);
    const classroomRooms = assignedClassrooms.map(c => c.name).filter(Boolean);
    const scheduleSlots = await fetchTeacherSchedules(user.id).catch(() => []);
    const scheduleRooms = (scheduleSlots || [])
      .map((s) => s.room)
      .filter((r) => r && r !== "—");
    const assignedRooms = [...new Set([...classroomRooms, ...scheduleRooms])];
    const deviceIds = [...assignedRooms];

    // Build session
    const session = {
      id: user.id,
      username: user.email,
      email: user.email,
      role: "teacher",
      name: profile.full_name || user.email,
      assignedRooms: assignedRooms,
      deviceIds: deviceIds,
      loginAt: Date.now(),
      lastActivity: Date.now(),
      accessToken: access_token,
      refreshToken: refresh_token,
    };

    sessionStorage.setItem(TEACHER_SESSION_KEY, JSON.stringify(session));
    setCurrentSessionInfo({ profile: { id: user.id, role: "teacher" } });

    await logTeacherAudit("Teacher login", `${session.email} signed in`);
    return session;
  } catch (e) {
    console.warn("Teacher login failed:", e);
    return null;
  }
}

// ─── Sign up (creates auth user + profile) ───
async function signupTeacher({ name, email, password }) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (password.length < 6) {
      return { ok: false, error: "Password must be at least 6 characters." };
    }

    // Create user via Supabase Auth
    const authData = await signUpWithPassword(normalizedEmail, password);
    const user = authData.user || authData;
    if (!user || !user.id) {
      return { ok: false, error: authData.msg || "Failed to create account. The email may already be registered." };
    }

    // Create profile
    await upsertProfile(user.id, {
      role: "teacher",
      full_name: name.trim(),
      mobile: null,
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function logTeacherAudit(action, detail = "") {
  if (typeof insertAuditLog !== "function") return;
  try {
    const session = getTeacherSession();
    const record = { action, detail };
    if (session?.id) record.actor_id = session.id;
    await insertAuditLog(record);
  } catch (e) {
    console.warn("Audit log failed:", e);
  }
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
  const email = session?.email;
  const token = session?.accessToken;
  sessionStorage.removeItem(TEACHER_SESSION_KEY);
  clearAuthToken();
  setCurrentSessionInfo(null);
  if (typeof stopTeacherAutoRefresh === "function") try { stopTeacherAutoRefresh(); } catch (_) {}
  if (typeof stopAutoRefresh === "function") try { stopAutoRefresh(); } catch (_) {}
  window.location.href = "teacher-login.html";
  if (session) {
    logTeacherAudit("Teacher logout", `${email} signed out`).catch(() => {});
    if (token) signOutUser(token).catch(() => {});
  }
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

// ─── Teacher Schedule (database-backed) ───
async function getTeacherScheduleDb(teacherId, force = false) {
  try {
    const slots = await getCachedTeacherSchedules(teacherId, force);
    return { slots: slots || [] };
  } catch (_) {
    return { slots: [] };
  }
}

async function saveTeacherScheduleDb(teacherId, schedule) {
  // schedule is { slots: [...] }
  // We do a diff-based approach: fetch existing, delete removed, add new
  const existing = await fetchTeacherSchedules(teacherId);
  const existingIds = new Set(existing.map(s => s.id));
  const newSlots = schedule.slots || [];

  // Remove slots that are no longer present
  const newSlotKeys = new Set(newSlots.map(s => s._clientId || s.id));
  for (const ex of existing) {
    if (!newSlotKeys.has(ex.id) && !newSlotKeys.has(ex._clientId)) {
      try {
        await deleteTeacherSchedule(ex.id);
      } catch (_) {}
    }
  }

  // Add or update slots
  for (const slot of newSlots) {
    if (slot.id && existingIds.has(slot.id)) {
      // Update existing
      await upsertTeacherSchedule({
        id: slot.id,
        teacher_id: teacherId,
        day: slot.day,
        start_time: slot.startTime,
        end_time: slot.endTime,
        subject: slot.subject,
        room: slot.room,
      });
    } else {
      // Create new
      await upsertTeacherSchedule({
        teacher_id: teacherId,
        day: slot.day,
        start_time: slot.startTime,
        end_time: slot.endTime,
        subject: slot.subject,
        room: slot.room,
      });
    }
  }
}

async function addTeacherScheduleSlot(teacherId, slot) {
  return upsertTeacherSchedule({
    teacher_id: teacherId,
    day: slot.day,
    start_time: slot.startTime,
    end_time: slot.endTime,
    subject: slot.subject,
    room: slot.room,
  });
}

async function removeTeacherScheduleSlot(slotId) {
  return deleteTeacherSchedule(slotId);
}

// ─── Profile update ───
async function updateTeacherProfile(teacherId, updates) {
  return upsertProfile(teacherId, updates);
}

// ─── Sync session with latest data from DB ───
async function syncTeacherSessionFromDb(session) {
  if (!session) return null;
  try {
    const profile = await getProfileById(session.id);
    if (!profile) return session;
    const classrooms = await fetchTeacherClassrooms(session.id);
    const classroomRooms = classrooms.map(c => c.name).filter(Boolean);
    const scheduleSlots = await fetchTeacherSchedules(session.id).catch(() => []);
    const scheduleRooms = (scheduleSlots || [])
      .map((s) => s.room)
      .filter((r) => r && r !== "—");
    const assignedRooms = [...new Set([...classroomRooms, ...scheduleRooms])];
    const deviceIds = [...new Set([...(session.deviceIds || []), ...assignedRooms])];
    return {
      ...session,
      name: profile.full_name || session.name,
      assignedRooms,
      deviceIds,
    };
  } catch (_) {
    return session;
  }
}

// ─── Utility functions (unchanged from localStorage version) ───
function getTeacherRemainingSessionMs(session) {
  return Math.max(0, TEACHER_SESSION_TIMEOUT_MS - (Date.now() - session.lastActivity));
}

function isWithinTeacherAccessWindow(datetime) {
  const eventTime = new Date(datetime).getTime();
  const hours = (typeof teacherSettings !== 'undefined' ? teacherSettings.teacherAccessHours : 48);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return eventTime >= cutoff;
}

function normalizeDeviceRoom(value) {
  return (value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function deviceRoomMatches(a, b) {
  const na = normalizeDeviceRoom(a);
  const nb = normalizeDeviceRoom(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function getLogDeviceRoomKeys(log) {
  return [log.room, log.deviceId].filter((v) => v && v !== "—");
}

function mergeTeacherIdentifiers(session, slots = []) {
  const ids = new Set();
  (session.assignedRooms || []).forEach((r) => ids.add(r));
  (session.deviceIds || []).forEach((d) => ids.add(d));
  (slots || []).forEach((s) => {
    if (s.room && s.room !== "—") ids.add(s.room);
  });
  return [...ids];
}

function matchesTeacherAssignment(log, session, slots = []) {
  if (!session) return false;
  const identifiers = mergeTeacherIdentifiers(session, slots);
  if (!identifiers.length) return false;
  const logKeys = getLogDeviceRoomKeys(log);
  if (!logKeys.length) return false;
  return identifiers.some((id) =>
    logKeys.some((key) => deviceRoomMatches(key, id))
  );
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

function getManilaEventParts(log) {
  if (typeof getManilaDateParts === "function") {
    return getManilaDateParts(log.datetime);
  }
  const eventDate = new Date(log.datetime);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    dayShort: dayNames[eventDate.getDay()],
    minutesOfDay: eventDate.getHours() * 60 + eventDate.getMinutes(),
  };
}

function eventMatchesTeacherSchedule(log, slots) {
  if (!slots?.length) return false;

  const manila = getManilaEventParts(log);
  const eventDay = manila.dayShort;
  const eventMins = manila.minutesOfDay;

  return slots.some((slot) => {
    const slotDay = slot.day ? slot.day.substring(0, 3) : slot.day;
    if (slotDay !== eventDay) return false;

    const slotRoom = slot.room;
    if (slotRoom && slotRoom !== "—") {
      const logKeys = getLogDeviceRoomKeys(log);
      if (!logKeys.some((k) => deviceRoomMatches(k, slotRoom))) return false;
    }

    const startStr = slot.start_time || slot.startTime || "00:00";
    const endStr = slot.end_time || slot.endTime || "23:59";
    const [sh, sm] = startStr.split(":").map(Number);
    const [eh, em] = endStr.split(":").map(Number);
    const startMins = sh * 60 + (sm || 0);
    const endMins = eh * 60 + (em || 0);
    if (eventMins < startMins || eventMins > endMins) return false;

    const slotSubject = slot.subject || "";
    if (slotSubject && slotSubject !== "—" && log.subject && log.subject !== "—") {
      return normalizeName(log.subject).includes(normalizeName(slotSubject));
    }
    return true;
  });
}

async function matchesTeacherEvent(log, session, slots = null) {
  if (!session) return false;

  const scheduleSlots =
    slots !== null ? slots : (await getTeacherScheduleDb(session.id)).slots || [];

  if (!matchesTeacherAssignment(log, session, scheduleSlots)) return false;

  const ownName = teacherNameMatches(log.teacher, session.name);

  if (log.teacher && log.teacher !== "—") {
    if (ownName) return eventMatchesTeacherSchedule(log, scheduleSlots);
    return false;
  }

  return eventMatchesTeacherSchedule(log, scheduleSlots);
}

function filterLogsByDateTime(logs, fromDate, toDate, fromTime, toTime) {
  return logs.filter((l) => {
    if (fromDate && l.date < fromDate) return false;
    if (toDate && l.date > toDate) return false;
    if (fromTime || toTime) {
      const manila =
        typeof getManilaDateParts === "function"
          ? getManilaDateParts(l.datetime)
          : {
              minutesOfDay:
                new Date(l.datetime).getHours() * 60 +
                new Date(l.datetime).getMinutes(),
            };
      const eventMins = manila.minutesOfDay;
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

async function filterTeacherEvents(logs, session, slots = null) {
  const scheduleSlots =
    slots !== null ? slots : (await getTeacherScheduleDb(session.id)).slots || [];
  const results = [];
  for (const l of logs) {
    if (
      isRedEvent(l) &&
      (await matchesTeacherEvent(l, session, scheduleSlots)) &&
      isWithinTeacherAccessWindow(l.datetime)
    ) {
      results.push(l);
    }
  }
  return results;
}

async function filterTeacherAudioLogs(logs, session, slots = null) {
  const events = await filterTeacherEvents(logs, session, slots);
  return events.filter((l) => l.audioRecorded && l.audioUrl);
}

function formatAccessWindowRemaining(datetime) {
  const hours = (typeof teacherSettings !== 'undefined' ? teacherSettings.teacherAccessHours : 48);
  const expires = new Date(datetime).getTime() + hours * 60 * 60 * 1000;
  const msLeft = expires - Date.now();
  if (msLeft <= 0) return "Expired";
  const hoursLeft = Math.floor(msLeft / (60 * 60 * 1000));
  if (hoursLeft >= 24) return `${Math.floor(hoursLeft / 24)}d ${hoursLeft % 24}h left`;
  return `${hoursLeft}h left`;
}
