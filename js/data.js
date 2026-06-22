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

function mapNoiseEvent(row) {
  const dt = row.event_time_utc || row.created_at;
  const d = new Date(dt);
  const color = (row.warning_color || "RED").toString().toLowerCase();
  let status = "red";
  if (color === "green" || color === "yellow") status = color;
  else if (color === "red") status = "red";

  return {
    id: row.id,
    date: d.toISOString().slice(0, 10),
    time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }),
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

async function loadNoiseEvents(force = false) {
  if (noiseEventsCache && !force) return noiseEventsCache;
  const rows = await fetchNoiseEvents();
  noiseEventsCache = rows.map(mapNoiseEvent);
  return noiseEventsCache;
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
  const peakLabel = `${peakHour}:00–${peakHour + 1}:00`;

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
  return {
    action: row.action || row.event_type || "Event",
    user: row.user_name || row.username || row.user_id || "system",
    time,
    detail: row.detail || row.description || row.metadata || "—",
  };
}

function showLoading(containerId = "page-content") {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="empty-state">Loading from database…</div>`;
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

async function generateWeeklyPdf(logs, options = {}) {
  const { role = 'admin', session = null, days = 7 } = options;
  try {
    await _ensurePdfLibraries();
  } catch (e) {
    alert('Failed to load PDF libraries: ' + e.message);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();

  async function renderChartImage(labels, data, title, width = 900, height = 250, horizontal = false) {
    if (typeof Chart === 'undefined') {
      try {
        await _loadScriptOnce('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');
      } catch (e) {
        return null;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = 'fixed';
    canvas.style.left = '-9999px';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: title || 'Incidents', data, backgroundColor: 'rgba(54, 162, 235, 0.7)' }]
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0 } },
          y: { grid: { color: '#eeeeee' } }
        }
      }
    });
    await new Promise((r) => setTimeout(r, 50));
    const img = canvas.toDataURL('image/png');
    try { chart.destroy(); } catch (_) {}
    canvas.remove();
    return img;
  }

  const filteredLogs =
    role === 'teacher' && session
      ? logs.filter((l) => (session.deviceIds?.includes(l.deviceId) || session.name === l.teacher || session.username === l.teacher))
      : logs;

  const { dates } = getTeacherWeeklyEvents(filteredLogs, days);
  const weeklyCounts = dates.map((date) =>
    filteredLogs.filter((l) => l.date === date && isIncident(l)).length
  );

  const subjectMap = new Map();
  filteredLogs.forEach((l) => {
    if (!isIncident(l)) return;
    const d = new Date(l.datetime);
    const start = new Date(dates[0]);
    const end = new Date(dates[dates.length - 1]);
    end.setHours(23, 59, 59, 999);
    if (d < start || d > end) return;
    const subj = l.subject && l.subject !== '—' ? l.subject : 'Unknown';
    if (!subjectMap.has(subj)) {
      subjectMap.set(subj, { count: 0 });
    }
    subjectMap.get(subj).count += 1;
  });

  const subjects = [...subjectMap.entries()]
    .map(([name, { count }]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const reportTitle =
    role === 'teacher'
      ? `Weekly noise incidents — ${session.name || session.username || 'Teacher'}`
      : 'Weekly noise incidents — All teachers';

  doc.setFontSize(16);
  doc.text(reportTitle, margin, 18);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 24);
  doc.setFontSize(11);
  doc.text(`Week: ${dates[0]} — ${dates[dates.length - 1]}`, margin, 30);

  const firstChartY = 38;
  const secondChartY = 110;

  const weeklyChartImg = await renderChartImage(dates, weeklyCounts, 'Incidents per day (last 7 days)');
  if (weeklyChartImg) {
    const imgWidthMm = pageWidth - margin * 2;
    const imgHeightMm = 60;
    doc.addImage(weeklyChartImg, 'PNG', margin, firstChartY, imgWidthMm, imgHeightMm);
  }

  if (subjects.length > 0) {
    const subjectChartImg = await renderChartImage(
      subjects.map((s) => s.name),
      subjects.map((s) => s.count),
      'Subject comparison — incidents',
      900,
      180,
      true
    );
    if (subjectChartImg) {
      const imgWidthMm = pageWidth - margin * 2;
      const imgHeightMm = 60;
      doc.addImage(subjectChartImg, 'PNG', margin, secondChartY, imgWidthMm, imgHeightMm);
    }
  } else {
    doc.setFontSize(10);
    doc.text('No subject comparison data available for this week.', margin, secondChartY + 10);
  }

  doc.save(`weekly_report_${new Date().toISOString().slice(0,10)}.pdf`);
}
