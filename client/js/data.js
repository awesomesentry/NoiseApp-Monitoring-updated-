const DEFAULT_SETTINGS = {
  thresholdGreen: 60,
  thresholdYellow: 74,
  thresholdRed: 75,
  buzzerEnabled: true,
  maxBeeps: 3,
  buzzerCooldown: 10,
  audioLengthMin: 3,
  audioLengthMax: 5,
  alertCooldown: 30,
  retentionDays: 14,
  teacherAccessHours: 48,
};

let noiseEventsCache = null;
let classroomsCache = null;

const MANILA_TZ = "Asia/Manila";

function getManilaDateParts(isoOrDate) {
  const d = new Date(isoOrDate);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const month = get("month").padStart(2, "0");
  const day = get("day").padStart(2, "0");
  const year = get("year");
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  return {
    date: `${year}-${month}-${day}`,
    time: d.toLocaleTimeString("en-US", {
      timeZone: MANILA_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    hour,
    minute,
    dayShort: get("weekday"),
    minutesOfDay: hour * 60 + minute,
  };
}

function mapNoiseEvent(row) {
  const dt = row.event_time_utc || row.created_at;
  const manila = getManilaDateParts(dt);
  const color = (row.warning_color || "RED").toString().toLowerCase();
  let status = "red";
  if (color === "green" || color === "yellow") status = color;
  else if (color === "red") status = "red";

  return {
    id: row.id,
    date: manila.date,
    time: manila.time,
    datetime: dt,
    room: row.room || row.device_id || "—",
    deviceId: row.device_id,
    db: row.decibel,
    status,
    warningColor: row.warning_color,
    warningLevel: row.warning_level,
    buzzer: !!row.buzzer_triggered,
    audioRecorded: !!row.audio_recorded,
    audioUrl: row.audio_url,
    durationSec: row.duration_seconds || 0,
    subject: row.subject || "—",
    teacher: row.teacher_name || "—",
    classroomId: row.classroom_id,
    eventGroupId: row.event_group_id,
    createdAt: row.created_at,
  };
}

async function loadNoiseEvents(force = false, options = {}) {
  const hasOptions = options && Object.keys(options).length > 0;
  if (!hasOptions && noiseEventsCache && !force) return noiseEventsCache;
  const rows = await fetchNoiseEvents(options);
  const mapped = rows.map(mapNoiseEvent);
  if (!hasOptions) noiseEventsCache = mapped;
  return mapped;
}

function getDefaultAdminNoiseEventOptions() {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), limit: 1000 };
}

async function loadNoiseEventsForAdmin(force = false, extra = {}) {
  return loadNoiseEvents(force, { ...getDefaultAdminNoiseEventOptions(), ...extra });
}

async function loadNoiseEventsForTeacher(session, force = false) {
  const hours =
    (typeof teacherSettings !== "undefined" ? teacherSettings.teacherAccessHours : 48) || 48;
  const fromDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  return loadNoiseEvents(force, {
    from: fromDate.toISOString().slice(0, 10),
    severity: "red",
    limit: 500,
  });
}

async function loadClassrooms() {
  if (classroomsCache) return classroomsCache;
  try {
    classroomsCache = await fetchClassrooms();
  } catch {
    classroomsCache = [];
  }
  return classroomsCache;
}

function getRoomList(logs, classrooms) {
  const fromLogs = logs.map((l) => l.room).filter((r) => r && r !== "—");
  const fromDb = classrooms.map((c) => c.name || c.room_name || c.room).filter(Boolean);
  return [...new Set([...fromLogs, ...fromDb])].sort();
}

function getDashboardStats(logs, role, assignedRoom) {
  const filtered =
    role === "teacher"
      ? logs.filter(
          (l) =>
            assignedRoom &&
            (l.room === assignedRoom ||
              (typeof session !== "undefined" &&
                session?.deviceIds?.includes(l.deviceId)))
        )
      : logs;

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const todayLogs = filtered.filter((l) => l.date === today);
  const weekRed = filtered.filter(
    (l) => l.status === "red" && new Date(l.datetime) >= weekAgo
  );

  const roomCounts = {};
  filtered.forEach((l) => {
    if (l.status !== "green") roomCounts[l.room] = (roomCounts[l.room] || 0) + 1;
  });
  const mostNoisy = Object.entries(roomCounts).sort((a, b) => b[1] - a[1])[0];

  const hourCounts = {};
  filtered.forEach((l) => {
    const h = new Date(l.datetime).getHours();
    hourCounts[h] = (hourCounts[h] || 0) + 1;
  });
  let peakHour = 10;
  let peakCount = 0;
  Object.entries(hourCounts).forEach(([h, c]) => {
    if (c > peakCount) {
      peakCount = c;
      peakHour = parseInt(h, 10);
    }
  });
  const formatHour = (h) => {
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 || 12;
    return `${hour12}:00 ${period}`;
  };
  const peakLabel = `${formatHour(peakHour)}–${formatHour(peakHour + 1)}`;

  return {
    incidentsToday: todayLogs.filter((l) => l.status !== "green").length,
    redAlertsWeek: weekRed.length,
    mostNoisyRoom: mostNoisy ? mostNoisy[0] : "—",
    mostNoisyCount: mostNoisy ? mostNoisy[1] : 0,
    peakTime: peakLabel,
    chartByRoom: aggregateIncidentsByRoom(filtered),
    chartByDateTime: aggregateIncidentsByDateTime(filtered, 14),
  };
}

function isIncident(log) {
  return log.status !== "green";
}

function aggregateIncidentsByRoom(logs) {
  const counts = {};
  logs.forEach((l) => {
    if (!isIncident(l)) return;
    const key = l.room || l.deviceId || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([room, count]) => ({ room, count }))
    .sort((a, b) => b.count - a.count);
}

function aggregateIncidentsByDateTime(logs, dayWindow = 14) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - dayWindow);
  cutoff.setHours(0, 0, 0, 0);

  const buckets = new Map();
  logs.forEach((l) => {
    if (!isIncident(l)) return;
    const d = new Date(l.datetime);
    if (d < cutoff) return;

    const bucket = new Date(d);
    bucket.setMinutes(0, 0, 0);
    const key = bucket.getTime();
    if (!buckets.has(key)) {
      buckets.set(key, {
        ts: key,
        date: bucket.toISOString().slice(0, 10),
        label: bucket.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          hour12: true,
        }),
        count: 0,
      });
    }
    buckets.get(key).count += 1;
  });

  const series = [...buckets.values()].sort((a, b) => a.ts - b.ts);

  if (series.length === 0) {
    const anchor = new Date();
    for (let i = dayWindow - 1; i >= 0; i--) {
      const d = new Date(anchor);
      d.setDate(d.getDate() - i);
      d.setHours(12, 0, 0, 0);
      series.push({
        ts: d.getTime(),
        date: d.toISOString().slice(0, 10),
        label: d.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          hour12: true,
        }),
        count: 0,
      });
    }
  }

  return series.slice(-36);
}

function buildReportsHeatmap(logs) {
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hours = [7, 8, 9, 10, 11, 12, 13, 14];
  const grid = {};

  logs
    .filter((l) => l.status === "red")
    .forEach((l) => {
      const d = new Date(l.datetime);
      const key = `${d.getDay()}-${d.getHours()}`;
      grid[key] = (grid[key] || 0) + 1;
    });

  const cells = [];
  for (let d = 1; d <= 5; d++) {
    for (const h of hours) {
      cells.push({
        day: d,
        dayLabel: dayLabels[d],
        hour: h,
        count: grid[`${d}-${h}`] || 0,
      });
    }
  }
  return { cells, hours, dayLabels: ["Mon", "Tue", "Wed", "Thu", "Fri"] };
}

function mapAudioClip(log, role) {
  const retentionDays = role === "teacher" ? 2 : DEFAULT_SETTINGS.retentionDays;
  return {
    id: log.id,
    recordingId: log.id.slice(0, 8).toUpperCase(),
    room: log.room,
    db: log.db,
    time: `${log.date} ${log.time}`,
    lengthSec: DEFAULT_SETTINGS.audioLengthMax,
    audioUrl: log.audioUrl,
    warningLevel: log.warningLevel,
    expiresIn: role === "teacher" ? "36 hours" : "11 days",
    retentionDays,
  };
}

function getAudioClipsFromLogs(logs, role, assignedRoom) {
  const redWithAudio = logs.filter(
    (l) =>
      l.status === "red" &&
      l.audioRecorded &&
      l.audioUrl &&
      (l.warningColor || "RED").toUpperCase() === "RED"
  );
  const filtered =
    role === "teacher"
      ? redWithAudio.filter(
          (l) => l.room === assignedRoom || l.deviceId === session?.deviceIds?.[0]
        )
      : redWithAudio;
  return filtered.map((l) => mapAudioClip(l, role));
}

function mapAuditRow(row) {
  const time = row.created_at
    ? new Date(row.created_at).toLocaleString()
    : row.time || "—";
  const actorProfile = row.profiles || null;
  return {
    action: row.action || row.event_type || "Event",
    user:
      row.actor_name ||
      actorProfile?.full_name ||
      row.actor_id ||
      "system",
    time,
    detail: row.detail || row.description || row.metadata || "—",
  };
}

function showLoading(containerId = "page-content") {
  const el = document.getElementById(containerId);
  if (el) {
    el.innerHTML = `<div class="empty-state"><span class="page-spinner"></span> Loading from database…</div>`;
  }
}

function setButtonLoading(btn, loading, loadingText = "Please wait…") {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("is-loading");
    btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
  } else {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

function setFormLoading(form, loading, submitBtn) {
  const btn = submitBtn || form?.querySelector('button[type="submit"]');
  if (loading) {
    form?.querySelectorAll("input, button, select, textarea").forEach((el) => {
      if (el !== btn) el.disabled = true;
    });
    setButtonLoading(btn, true, "Signing in…");
  } else {
    form?.querySelectorAll("input, button, select, textarea").forEach((el) => {
      el.disabled = false;
    });
    setButtonLoading(btn, false);
  }
}

function initPasswordToggles(root = document) {
  root.querySelectorAll("[data-password-toggle]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.passwordToggle);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });
}

function formatManilaDateTime(isoOrDate) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoOrDate));
}

function formatHourLabel(hour24) {
  const period = hour24 >= 12 ? "PM" : "AM";
  const h12 = hour24 % 12 || 12;
  return `${h12} ${period}`;
}

function getExportPeriodMeta(period) {
  const now = new Date();
  const today = getManilaDateParts(now);

  if (period === "daily") {
    return {
      startDate: today.date,
      endDate: today.date,
      startTime: "12:00 AM",
      endTime: "11:59 PM",
      filterLabel: `Filter: ${today.date} 12:00 AM – 11:59 PM (Manila)`,
      filename: `daily_report_${today.date}.pdf`,
      titleSuffix: "Daily noise incidents",
    };
  }

  if (period === "weekly") {
    const endParts = today;
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    const startParts = getManilaDateParts(start);
    return {
      startDate: startParts.date,
      endDate: endParts.date,
      startTime: "12:00 AM",
      endTime: "11:59 PM",
      filterLabel: `Filter: ${startParts.date} 12:00 AM – ${endParts.date} 11:59 PM (Manila)`,
      filename: `weekly_report_${endParts.date}.pdf`,
      titleSuffix: "Weekly noise incidents",
    };
  }

  const { start } = getMonthlyMondayToSaturdayRange();
  const monthName = start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const dates = getMonthlyDateStrings();
  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    startTime: "12:00 AM",
    endTime: "11:59 PM",
    filterLabel: `Filter: ${dates[0]} 12:00 AM – ${dates[dates.length - 1]} 11:59 PM (Manila) · ${monthName}`,
    filename: `monthly_report_${start.toISOString().slice(0, 7)}.pdf`,
    titleSuffix: "Monthly noise incidents",
  };
}

function getPdfCategoryLabel(log) {
  if (log.subject && log.subject !== "—") return log.subject;
  if (log.room && log.room !== "—") return log.room;
  if (log.deviceId) return log.deviceId;
  return "Unassigned";
}

function buildPdfTimeSeries(logs, period) {
  const incidents = logs.filter(isIncident);
  if (period === "daily") {
    const day = incidents[0]?.date || getManilaDateParts(new Date()).date;
    const dayLogs = incidents.filter((l) => l.date === day);
    const hours = [];
    const counts = [];
    for (let h = 6; h <= 21; h++) {
      hours.push(formatHourLabel(h));
      counts.push(
        dayLogs.filter((l) => getManilaDateParts(l.datetime).hour === h).length
      );
    }
    return { labels: hours, counts, chartTitle: "Incidents by hour (Manila time)" };
  }

  const dateMap = new Map();
  incidents.forEach((l) => {
    dateMap.set(l.date, (dateMap.get(l.date) || 0) + 1);
  });
  const sortedDates = [...dateMap.keys()].sort();
  if (sortedDates.length === 0) {
    const meta = getExportPeriodMeta(period);
    return {
      labels: [meta.startDate],
      counts: [0],
      chartTitle: period === "weekly" ? "Incidents by day" : "Incidents by day (month)",
    };
  }
  return {
    labels: sortedDates,
    counts: sortedDates.map((d) => dateMap.get(d)),
    chartTitle: period === "weekly" ? "Incidents by day (7 days)" : "Incidents by day (month)",
  };
}

function buildPdfRoomBreakdown(logs) {
  const map = new Map();
  logs.filter(isIncident).forEach((l) => {
    const key = getPdfCategoryLabel(l);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function showError(message) {
  document.getElementById("page-content").innerHTML = `
    <div class="empty-state" style="color:var(--red)">
      Failed to load data: ${message}
      <br><br>
      <button type="button" class="btn btn-secondary btn-sm" onclick="location.reload()">Retry</button>
    </div>`;
}

const LOGS_PAGE_SIZE = 15;

function paginateItems(items, page, pageSize = LOGS_PAGE_SIZE) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
    startIndex: total === 0 ? 0 : start + 1,
    endIndex: Math.min(start + pageSize, total),
  };
}

function renderPaginationHtml(pagination, prefix = "log") {
  if (pagination.total === 0) return "";
  return `
    <div class="pagination-bar" id="${prefix}-pagination">
      <span class="pagination-info">
        Showing ${pagination.startIndex}–${pagination.endIndex} of ${pagination.total}
      </span>
      <div class="pagination-controls">
        <button type="button" class="btn btn-secondary btn-sm" id="${prefix}-prev" ${pagination.page <= 1 ? "disabled" : ""}>← Prev</button>
        <span class="page-num">Page ${pagination.page} / ${pagination.totalPages}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="${prefix}-next" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>Next →</button>
      </div>
    </div>`;
}

function bindPagination(prefix, currentPage, totalPages, onPageChange) {
  document.getElementById(`${prefix}-prev`)?.addEventListener("click", () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  });
  document.getElementById(`${prefix}-next`)?.addEventListener("click", () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  });
}

// --- CSV export helper ---
function exportLogsToCsv(logs, filename) {
  const headers = ["Date", "Time", "Room/Device", "Noise (dB)", "Status", "Level", "Buzzer", "Audio", "Duration (s)", "Subject", "Teacher"];
  const rows = logs.map((l) => [
    l.date || "",
    l.time || "",
    l.room || "",
    l.db || "",
    l.status || "",
    l.warningLevel || "",
    l.buzzer ? "Yes" : "No",
    l.audioRecorded ? "Yes" : "No",
    l.durationSec || "",
    l.subject || "",
    l.teacher || "",
  ]);

  const escape = (val) => {
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const bom = "\uFEFF";
  const csv = bom + [headers.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `noise_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- PDF export helpers (weekly report) ---
function _loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
}

async function _ensurePdfLibraries() {
  if (!window.jspdf) {
    await _loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  }
  // try load autotable (optional)
  if (!window.jspdfAutoTable && !window.jspdf.pluginAutoTable) {
    try {
      await _loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.27/jspdf.plugin.autotable.min.js");
    } catch (_) {}
  }
}

function _normalizeName(v) {
  return (v || "").toString().trim().toLowerCase();
}

function getTeacherWeeklyEvents(logs, days = 7) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const inWindow = logs.filter((l) => {
    const d = new Date(l.datetime);
    return d >= start && d <= end && isIncident(l);
  });

  // group by teacher name; fallback to assignedRooms/device matching is optional
  const map = new Map();
  inWindow.forEach((l) => {
    const name = l.teacher && l.teacher !== "—" ? l.teacher : `Unknown`;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(l);
  });

  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d).toISOString().slice(0, 10));
  }

  const teachers = [...map.entries()].map(([teacher, events]) => ({ teacher, events }));
  return { dates, teachers };
}

function getMonthlyMondayToSaturdayRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));

  const start = new Date(firstDay);
  const dayOfWeek = start.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  start.setUTCDate(start.getUTCDate() - daysToMonday);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(lastDay);
  const lastDayOfWeek = end.getUTCDay();
  const daysToSaturday = lastDayOfWeek === 6 ? 0 : 6 - lastDayOfWeek;
  end.setUTCDate(end.getUTCDate() + daysToSaturday);
  end.setUTCHours(23, 59, 59, 999);

  return { start, end };
}

function getMonthlyDateStrings() {
  const { start, end } = getMonthlyMondayToSaturdayRange();
  const dates = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function filterLogsToMonthlyRange(logs) {
  const { start, end } = getMonthlyMondayToSaturdayRange();
  return logs.filter((l) => {
    const d = new Date(l.datetime);
    return d >= start && d <= end;
  });
}

function filterLogsToDailyRange(logs, dateStr) {
  const day = dateStr || new Date().toISOString().slice(0, 10);
  return logs.filter((l) => l.date === day);
}

function filterLogsToWeeklyRange(logs, days = 7) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return logs.filter((l) => {
    const d = new Date(l.datetime);
    return d >= start && d <= end;
  });
}

function filterLogsForExportPeriod(logs, period) {
  if (period === "daily") return filterLogsToDailyRange(logs);
  if (period === "weekly") return filterLogsToWeeklyRange(logs, 7);
  return filterLogsToMonthlyRange(logs);
}

function getExportPeriodLabel(period) {
  if (period === "daily") return "Today";
  if (period === "weekly") return "Last 7 days";
  return "This month (Mon–Sat)";
}

function showConfirmModal({ title, message, confirmText = "Confirm", cancelText = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "audio-modal-backdrop confirm-modal-backdrop";
    backdrop.innerHTML = `
      <div class="panel audio-modal-panel confirm-modal-panel">
        <h3 style="margin-top:0">${title}</h3>
        <p style="font-size:0.9rem;color:var(--muted);margin:1rem 0">${message}</p>
        <div style="display:flex;gap:0.75rem;justify-content:flex-end">
          <button type="button" class="btn btn-secondary btn-sm" id="confirm-modal-cancel">${cancelText}</button>
          <button type="button" class="btn btn-sm ${danger ? "btn-danger" : "btn-primary"}" id="confirm-modal-ok">${confirmText}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const cleanup = (result) => {
      backdrop.remove();
      resolve(result);
    };
    backdrop.querySelector("#confirm-modal-cancel").addEventListener("click", () => cleanup(false));
    backdrop.querySelector("#confirm-modal-ok").addEventListener("click", () => cleanup(true));
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) cleanup(false);
    });
  });
}

async function adminDeleteNoiseEvent(id, detail = "") {
  await deleteNoiseEvent(id);
  noiseEventsCache = null;
  if (typeof logAdminAudit === "function") {
    await logAdminAudit("Deleted noise event", detail || `Removed event ${id}`);
  }
}

function showExportModal({ title = "Export report", onExport }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "audio-modal-backdrop export-modal-backdrop";
    backdrop.innerHTML = `
      <div class="panel audio-modal-panel export-modal-panel">
        <h3 style="margin-top:0">${title}</h3>
        <p style="font-size:0.85rem;color:var(--muted);margin:0 0 1rem">Choose a time range and format.</p>
        <div class="form-group">
          <label for="export-period">Time range</label>
          <select id="export-period">
            <option value="daily">Daily (today)</option>
            <option value="weekly">Weekly (last 7 days)</option>
            <option value="monthly" selected>Monthly (Mon–Sat this month)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="export-format">Format</label>
          <select id="export-format">
            <option value="pdf">PDF report</option>
            <option value="csv">CSV spreadsheet</option>
          </select>
        </div>
        <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1.25rem">
          <button type="button" class="btn btn-secondary btn-sm" id="export-modal-cancel">Cancel</button>
          <button type="button" class="btn btn-primary btn-sm" id="export-modal-ok">Export</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    function cleanup(result) {
      backdrop.remove();
      resolve(result);
    }

    backdrop.querySelector("#export-modal-cancel").addEventListener("click", () => cleanup(null));
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) cleanup(null);
    });
    backdrop.querySelector("#export-modal-ok").addEventListener("click", async () => {
      const period = backdrop.querySelector("#export-period").value;
      const format = backdrop.querySelector("#export-format").value;
      const okBtn = backdrop.querySelector("#export-modal-ok");
      setButtonLoading(okBtn, true, "Exporting…");
      try {
        await onExport({ period, format });
        cleanup({ period, format });
      } catch (e) {
        alert("Export failed: " + e.message);
        setButtonLoading(okBtn, false);
      }
    });
  });
}

async function generateWeeklyPdf(logs, options = {}) {
  const { role = "admin", session = null, period = null, monthly = false } = options;
  const exportPeriod = period || (monthly ? "monthly" : "weekly");
  try {
    await _ensurePdfLibraries();
  } catch (e) {
    alert("Failed to load PDF libraries: " + e.message);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const periodMeta = getExportPeriodMeta(exportPeriod);

  const reportLogs = logs.filter(isIncident);
  const redCount = reportLogs.filter(
    (l) => l.status === "red" || (l.warningColor || "").toUpperCase() === "RED"
  ).length;

  async function renderLineChartImage(labels, data, title, width = 920, height = 280) {
    if (typeof Chart === "undefined") {
      try {
        await _loadScriptOnce("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js");
      } catch {
        return null;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = "fixed";
    canvas.style.left = "-9999px";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: title,
            data,
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.18)",
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: "#38bdf8",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: "#334155", boxWidth: 12 } },
          title: { display: !!title, text: title, color: "#334155", font: { size: 14 } },
        },
        scales: {
          x: {
            grid: { color: "rgba(148,163,184,0.25)" },
            ticks: { color: "#475569", maxRotation: 45, minRotation: 0, font: { size: 10 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(148,163,184,0.25)" },
            ticks: { color: "#475569", precision: 0 },
          },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 120));
    const img = canvas.toDataURL("image/png");
    try {
      chart.destroy();
    } catch (_) {}
    canvas.remove();
    return img;
  }

  async function renderBarChartImage(labels, data, title, horizontal = true) {
    if (typeof Chart === "undefined") {
      try {
        await _loadScriptOnce("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js");
      } catch {
        return null;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = 920;
    canvas.height = horizontal ? Math.max(220, labels.length * 36) : 260;
    canvas.style.position = "fixed";
    canvas.style.left = "-9999px";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: title,
            data,
            backgroundColor: "rgba(239, 68, 68, 0.75)",
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: !!title, text: title, color: "#334155", font: { size: 14 } },
        },
        scales: {
          x: { beginAtZero: true, grid: { color: "rgba(148,163,184,0.2)" }, ticks: { precision: 0 } },
          y: { grid: { display: false }, ticks: { color: "#475569", font: { size: 11 } } },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 120));
    const img = canvas.toDataURL("image/png");
    try {
      chart.destroy();
    } catch (_) {}
    canvas.remove();
    return img;
  }

  const who =
    role === "teacher"
      ? session?.name || session?.username || "Teacher"
      : "All rooms";
  const reportTitle = `${periodMeta.titleSuffix} — ${who}`;
  const timeSeries = buildPdfTimeSeries(reportLogs, exportPeriod);
  const roomBreakdown = buildPdfRoomBreakdown(reportLogs);

  let y = 18;
  doc.setFontSize(16);
  doc.text(reportTitle, margin, y);
  y += 8;
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(periodMeta.filterLabel, margin, y);
  y += 5;
  doc.text(`Downloaded: ${formatManilaDateTime(new Date())} (Manila)`, margin, y);
  y += 5;
  doc.text(
    `Summary: ${reportLogs.length} incident(s) · ${redCount} RED · ${roomBreakdown.length} room/device(s)`,
    margin,
    y
  );
  doc.setTextColor(0, 0, 0);
  y += 10;

  const lineImg = await renderLineChartImage(
    timeSeries.labels,
    timeSeries.counts,
    timeSeries.chartTitle
  );
  if (lineImg) {
    doc.addImage(lineImg, "PNG", margin, y, pageWidth - margin * 2, 72);
    y += 78;
  }

  if (roomBreakdown.length > 0) {
    const barImg = await renderBarChartImage(
      roomBreakdown.map((r) => r.name),
      roomBreakdown.map((r) => r.count),
      "Incidents by room / device / subject"
    );
    if (barImg) {
      const barHeight = Math.min(90, 24 + roomBreakdown.length * 10);
      doc.addImage(barImg, "PNG", margin, y, pageWidth - margin * 2, barHeight);
      y += barHeight + 6;
    }
  }

  if (reportLogs.length > 0 && y < 250) {
    doc.setFontSize(11);
    doc.text("Recent events in filter range", margin, y);
    y += 6;
    doc.setFontSize(9);
    reportLogs.slice(0, 12).forEach((l) => {
      if (y > 280) return;
      doc.text(
        `${l.date} ${l.time} · ${l.room || l.deviceId} · ${l.db} dB · ${l.warningLevel || l.status}`,
        margin,
        y
      );
      y += 5;
    });
  }

  doc.save(periodMeta.filename);
}
