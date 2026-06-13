let session = null;
let settings = { ...DEFAULT_SETTINGS };
let chartInstances = [];
let autoRefreshInterval = null;
const AUTO_REFRESH_INTERVAL = 10000;
const LOG_FILTER_STATE = {
  currentPage: 1,
  filterFrom: "",
  filterTo: "",
  room: "",
  severity: "",
  subject: "",
};

const ROUTES = {
  dashboard: { title: "Dashboard", keyword: "At-a-glance monitoring" },
  logs: { title: "Noise Logs", keyword: "Primary system records — noise_events" },
  audio: { title: "Audio Evidence", keyword: "RED events with audio — noise_events" },
  settings: { title: "System Settings", keyword: "Admin — thresholds & alerts" },
  reports: { title: "Reports & Analytics", keyword: "Evaluation & decision support" },
  audit: { title: "Audit Trail", keyword: "audit_logs table" },
};

function destroyCharts() {
  chartInstances.forEach((c) => c.destroy());
  chartInstances = [];
}

function getRoute() {
  const hash = (location.hash || "#dashboard").slice(1);
  return ROUTES[hash] ? hash : "dashboard";
}

function setActiveNav(route) {
  document.querySelectorAll(".nav-links a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });
}

function updateTeacherNav() {
  document.querySelectorAll(".nav-links .admin-only").forEach((el) => {
    el.classList.remove("hidden");
  });
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: "#8b9cb3" }, grid: { color: "#2d3a4f44" } },
      y: { ticks: { color: "#8b9cb3", precision: 0 }, grid: { color: "#2d3a4f44" }, beginAtZero: true },
    },
  };
}

function isMobileView() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function truncateLabel(label, max = 14) {
  if (!label || label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function barChartOptions(labels) {
  const mobile = isMobileView();
  const tickColor = "#8b9cb3";
  const gridColor = "#2d3a4f44";
  const horizontal = !mobile && labels.length > 3;

  if (horizontal) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      layout: { padding: { left: 4, right: 12, top: 8, bottom: 4 } },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: tickColor, precision: 0 },
          grid: { color: gridColor },
        },
        y: {
          ticks: {
            color: tickColor,
            autoSkip: false,
            font: { size: 11 },
            callback: (_v, i) => truncateLabel(labels[i], 16),
          },
          grid: { display: false },
        },
      },
    };
  }

  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { left: 8, right: mobile ? 20 : 12, top: 8, bottom: 8 } },
    plugins: { legend: { display: false } },
    scales: {
      x: {
        offset: true,
        ticks: {
          color: tickColor,
          maxRotation: mobile ? 25 : 35,
          minRotation: 0,
          autoSkip: false,
          font: { size: mobile ? 10 : 12 },
          callback: (_v, i) => truncateLabel(labels[i], mobile ? 12 : 20),
        },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { color: tickColor, precision: 0 },
        grid: { color: gridColor },
      },
    },
  };
}

function lineDateChartOptions(pointCount = 12) {
  const mobile = isMobileView();
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        left: 10,
        right: mobile ? 28 : 16,
        top: 12,
        bottom: mobile ? 16 : 8,
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => (items[0] ? String(items[0].label) : ""),
          label: (ctx) => `${ctx.parsed.y} incident(s)`,
        },
      },
    },
    scales: {
      x: {
        offset: true,
        ticks: {
          color: "#8b9cb3",
          maxRotation: mobile ? 40 : 45,
          minRotation: mobile ? 25 : 0,
          autoSkip: true,
          maxTicksLimit: mobile ? Math.min(6, pointCount) : 14,
          font: { size: mobile ? 9 : 11 },
        },
        grid: { color: "#2d3a4f44" },
      },
      y: {
        ticks: { color: "#8b9cb3", precision: 0 },
        grid: { color: "#2d3a4f44" },
        beginAtZero: true,
      },
    },
    elements: {
      point: { radius: mobile ? 3 : 4, hitRadius: 8 },
      line: { tension: 0.25 },
    },
  };
}

function renderBarChart(canvasId, items, color = "#38bdf8") {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  // Destroy any existing Chart instance on this canvas
  const existingChart = Chart.getChart(canvas);
  if (existingChart) {
    existingChart.destroy();
  }

  const labels = items.length ? items.map((x) => x.room) : ["No data"];
  const data = items.length ? items.map((x) => x.count) : [0];
  const mobile = isMobileView();
  const few = labels.length <= 2;

  chartInstances.push(
    new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Incidents",
          data,
          backgroundColor: color,
          borderRadius: 6,
          maxBarThickness: mobile ? 64 : 48,
          categoryPercentage: few ? 0.55 : 0.7,
          barPercentage: few ? 0.65 : 0.85,
        }],
      },
      options: barChartOptions(labels),
    })
  );
}

function resizeChartsSoon() {
  requestAnimationFrame(() => {
    setTimeout(() => {
      chartInstances.forEach((c) => {
        try {
          c.resize();
        } catch (_) {}
      });
    }, 50);
  });
}

async function renderDashboard(useLoading = true) {
  destroyCharts();
  if (useLoading) showLoading();
  try {
    const logs = filterLogsForUser(await loadNoiseEvents(), session);
    const assigned = session.assignedRooms[0] || session.deviceIds?.[0];
    const stats = getDashboardStats(logs, session.role, assigned);

    document.getElementById("page-content").innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">Noise incidents today</div>
          <div class="value" id="stat-incidents-today">${stats.incidentsToday}</div>
        </div>
        <div class="stat-card">
          <div class="label">Red-level alerts this week</div>
          <div class="value red" id="stat-red-alerts-week">${stats.redAlertsWeek}</div>
        </div>
        <div class="stat-card">
          <div class="label">Most noisy classroom</div>
          <div class="value" id="stat-most-noisy-room">${stats.mostNoisyRoom}</div>
          <div style="font-size:0.8rem;color:var(--muted)" id="stat-most-noisy-count">${stats.mostNoisyCount} incidents</div>
        </div>
        <div class="stat-card">
          <div class="label">Peak noise time</div>
          <div class="value green" id="stat-peak-time">${stats.peakTime}</div>
        </div>
      </div>
      <div class="charts-row">
        <div class="panel">
          <h3>Noise incidents per room / device</h3>
          <div class="chart-wrap"><canvas id="chart-rooms"></canvas></div>
        </div>
        <div class="panel">
          <h3>Incidents by date & time</h3>
          <div class="chart-wrap"><canvas id="chart-datetime"></canvas></div>
        </div>
      </div>
    `;

    const dtSeries = stats.chartByDateTime;
    renderBarChart("chart-rooms", stats.chartByRoom, "rgba(56, 189, 248, 0.75)");
    const lineCanvas = document.getElementById("chart-datetime");
    if (lineCanvas) {
      // Destroy any existing Chart instance on this canvas
      const existingLineChart = Chart.getChart(lineCanvas);
      if (existingLineChart) {
        existingLineChart.destroy();
      }
      
      chartInstances.push(
        new Chart(lineCanvas, {
          type: "line",
          data: {
            labels: dtSeries.map((x) => x.label),
            datasets: [{
              label: "Incidents",
              data: dtSeries.map((x) => x.count),
              borderColor: "#38bdf8",
              backgroundColor: "rgba(56, 189, 248, 0.12)",
              fill: true,
              tension: 0.25,
              pointRadius: 4,
              pointHoverRadius: 6,
            }],
          },
          options: lineDateChartOptions(dtSeries.length),
        })
      );
    }
    resizeChartsSoon();
  } catch (e) {
    showError(e.message);
  }
}

async function refreshDashboard() {
  try {
    const logs = filterLogsForUser(await loadNoiseEvents(), session);
    const assigned = session.assignedRooms[0] || session.deviceIds?.[0];
    const stats = getDashboardStats(logs, session.role, assigned);

    if (document.getElementById("stat-incidents-today")) {
      document.getElementById("stat-incidents-today").textContent = stats.incidentsToday;
      document.getElementById("stat-red-alerts-week").textContent = stats.redAlertsWeek;
      document.getElementById("stat-most-noisy-room").textContent = stats.mostNoisyRoom;
      document.getElementById("stat-most-noisy-count").textContent = `${stats.mostNoisyCount} incidents`;
      document.getElementById("stat-peak-time").textContent = stats.peakTime;
    }

    destroyCharts();
    renderBarChart("chart-rooms", stats.chartByRoom, "rgba(56, 189, 248, 0.75)");
    const dtSeries = stats.chartByDateTime;
    const lineCanvas = document.getElementById("chart-datetime");
    if (lineCanvas) {
      // Destroy any existing Chart instance on this canvas
      const existingLineChart = Chart.getChart(lineCanvas);
      if (existingLineChart) {
        existingLineChart.destroy();
      }
      
      chartInstances.push(
        new Chart(lineCanvas, {
          type: "line",
          data: {
            labels: dtSeries.map((x) => x.label),
            datasets: [{
              label: "Incidents",
              data: dtSeries.map((x) => x.count),
              borderColor: "#38bdf8",
              backgroundColor: "rgba(56, 189, 248, 0.12)",
              fill: true,
              tension: 0.25,
              pointRadius: 4,
              pointHoverRadius: 6,
            }],
          },
          options: lineDateChartOptions(dtSeries.length),
        })
      );
    }
    resizeChartsSoon();
  } catch (e) {
    console.warn("Dashboard refresh failed:", e);
  }
}

async function renderLogs() {
  showLoading();
  try {
    const logs = filterLogsForUser(await loadNoiseEvents(), session);
    const classrooms = await loadClassrooms();
    const rooms = getRoomList(logs, classrooms);
    let currentPage = LOG_FILTER_STATE.currentPage || 1;

    document.getElementById("page-content").innerHTML = `
      <div class="filters-bar" id="log-filters">
        <div class="form-group">
          <label>From</label>
          <input type="date" id="filter-from" />
        </div>
        <div class="form-group">
          <label>To</label>
          <input type="date" id="filter-to" />
        </div>
        <div class="form-group">
          <label>Room / Device</label>
          <select id="filter-room">
            <option value="">All</option>
            ${rooms.map((r) => `<option value="${r}">${r}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Severity</label>
          <select id="filter-severity">
            <option value="">All</option>
            <option value="green">Green</option>
            <option value="yellow">Yellow</option>
            <option value="red">Red</option>
          </select>
        </div>
        <div class="form-group">
          <label>Subject / Teacher</label>
          <input type="text" id="filter-subject" placeholder="Search..." />
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="filter-reset">Reset</button>
        <button type="button" class="btn btn-secondary btn-sm" id="filter-refresh">Refresh</button>
      </div>
        <div class="panel">
          <p style="font-size:0.75rem;color:var(--muted);margin:0 0 0.75rem" id="logs-count">${logs.length} records from <code>noise_events</code></p>
          <div class="table-scroll" id="logs-table-wrap">
            <table class="data-table" id="logs-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Room / Device</th>
                  <th>Noise (dB)</th>
                  <th>Indicator</th>
                  <th>Level</th>
                  <th>Buzzer</th>
                  <th>Audio</th>
                  <th>Duration</th>
                  <th>Subject</th>
                  <th></th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
          <div class="event-list" id="logs-list" style="display:none"></div>
          <div id="logs-pagination"></div>
        </div>
    `;

    function applyFilters(page = currentPage) {
      const from = document.getElementById("filter-from").value;
      const to = document.getElementById("filter-to").value;
      const room = document.getElementById("filter-room").value;
      const sev = document.getElementById("filter-severity").value;
      const subj = document.getElementById("filter-subject").value.toLowerCase();

      let filtered = [...logs];
      if (from) filtered = filtered.filter((l) => l.date >= from);
      if (to) filtered = filtered.filter((l) => l.date <= to);
      if (room) filtered = filtered.filter((l) => l.room === room);
      if (sev) filtered = filtered.filter((l) => l.status === sev);
      if (subj)
        filtered = filtered.filter(
          (l) =>
            l.subject.toLowerCase().includes(subj) ||
            l.teacher.toLowerCase().includes(subj)
        );

      currentPage = page;
      LOG_FILTER_STATE.currentPage = currentPage;
      LOG_FILTER_STATE.filterFrom = from;
      LOG_FILTER_STATE.filterTo = to;
      LOG_FILTER_STATE.room = room;
      LOG_FILTER_STATE.severity = sev;
      LOG_FILTER_STATE.subject = subj;

      const pagination = paginateItems(filtered, currentPage);
      const pageItems = pagination.items;

      document.getElementById("logs-count").textContent =
        `${pagination.total} record(s) from noise_events · Page ${pagination.page} of ${pagination.totalPages}`;

      const tbody = document.querySelector("#logs-table tbody");
      const mobileView = isMobileView();
      const logsListEl = document.getElementById("logs-list");
      const tableWrap = document.getElementById("logs-table-wrap");
      if (mobileView) {
        // render as vertical cards for small screens
        tableWrap.style.display = "none";
        logsListEl.style.display = "block";
        logsListEl.innerHTML =
          pageItems.length === 0
            ? `<div class="empty-state">No records in noise_events match your filters.</div>`
            : pageItems
                .map((l) => {
                  const reviewBtn =
                    l.status === "red" && l.audioRecorded && l.audioUrl
                      ? `<button type="button" class="btn btn-secondary btn-sm review-clip" data-id="${l.id}">Review Clip</button>`
                      : l.status === "red" && l.audioRecorded
                        ? `<span style="color:var(--muted);font-size:0.75rem">Processing…</span>`
                        : "—";
                  return `
            <div class="event-card">
              <div class="event-card-main">
                <div class="event-card-field">
                  <div class="field-label">Time</div>
                  <div class="field-value"><strong>${l.date} ${l.time}</strong></div>
                </div>
                <div class="event-card-field">
                  <div class="field-label">Room</div>
                  <div class="field-value">${l.room}</div>
                </div>
                <div class="event-card-field">
                  <div class="field-label">Noise</div>
                  <div class="field-value"><strong>${l.db}</strong> dB</div>
                </div>
                <div class="event-card-field">
                  <div class="field-label">Level</div>
                  <div class="field-value"><span class="status-pill ${l.status}">${l.status}</span></div>
                </div>
              </div>
              <div class="event-card-details">
                <div class="event-card-field"><div class="field-label">Duration</div><div class="field-value">${l.durationSec ? l.durationSec + "s" : "—"}</div></div>
                <div class="event-card-field"><div class="field-label">Buzzer</div><div class="field-value yes-no ${l.buzzer ? "yes" : "no"}">${l.buzzer ? "Yes" : "No"}</div></div>
                <div class="event-card-field"><div class="field-label">Audio</div><div class="field-value yes-no ${l.audioRecorded ? "yes" : "no"}">${l.audioRecorded ? "Yes" : "No"}</div></div>
                <div class="event-card-field"><div class="field-label">Subject</div><div class="field-value">${l.subject}<br><small style="color:var(--muted)">${l.teacher}</small></div></div>
                <div class="event-card-field"><div class="field-label">Action</div><div class="field-value">${reviewBtn}</div></div>
              </div>
            </div>`;
                })
                .join("");
      } else {
        // desktop/table view
        tableWrap.style.display = "block";
        logsListEl.style.display = "none";
        tbody.innerHTML =
          pageItems.length === 0
            ? `<tr><td colspan="10" class="empty-state">No records in noise_events match your filters.</td></tr>`
            : pageItems
                .map((l) => {
                  const reviewBtn =
                    l.status === "red" && l.audioRecorded && l.audioUrl
                      ? `<button type="button" class="btn btn-secondary btn-sm review-clip" data-id="${l.id}">Review Clip</button>`
                      : l.status === "red" && l.audioRecorded
                        ? `<span style="color:var(--muted);font-size:0.75rem">Processing…</span>`
                        : "—";
                  return `<tr>
                  <td>${l.date} ${l.time}</td>
                  <td>${l.room}</td>
                  <td><strong>${l.db}</strong> dB</td>
                  <td><span class="status-pill ${l.status}">${l.status}</span></td>
                  <td>${l.warningLevel || "—"}</td>
                  <td class="yes-no ${l.buzzer ? "yes" : "no"}">${l.buzzer ? "Yes" : "No"}</td>
                  <td class="yes-no ${l.audioRecorded ? "yes" : "no"}">${l.audioRecorded ? "Yes" : "No"}</td>
                  <td>${l.durationSec ? l.durationSec + "s" : "—"}</td>
                  <td>${l.subject}<br><small style="color:var(--muted)">${l.teacher}</small></td>
                  <td>${reviewBtn}</td>
                </tr>`;
                })
                .join("");
      }

      const pagEl = document.getElementById("logs-pagination");
      pagEl.innerHTML = renderPaginationHtml(pagination, "log");
      bindPagination("log", pagination.page, pagination.totalPages, (p) => {
        applyFilters(p);
        document.getElementById("page-content").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    ["filter-from", "filter-to", "filter-room", "filter-severity", "filter-subject"].forEach(
      (id) => document.getElementById(id).addEventListener("input", () => applyFilters(1))
    );

    document.getElementById("filter-from").value = LOG_FILTER_STATE.filterFrom;
    document.getElementById("filter-to").value = LOG_FILTER_STATE.filterTo;
    document.getElementById("filter-room").value = LOG_FILTER_STATE.room;
    document.getElementById("filter-severity").value = LOG_FILTER_STATE.severity;
    document.getElementById("filter-subject").value = LOG_FILTER_STATE.subject;

    applyFilters(LOG_FILTER_STATE.currentPage || 1);
    document.getElementById("filter-reset").addEventListener("click", () => {
      LOG_FILTER_STATE.currentPage = 1;
      LOG_FILTER_STATE.filterFrom = "";
      LOG_FILTER_STATE.filterTo = "";
      LOG_FILTER_STATE.room = "";
      LOG_FILTER_STATE.severity = "";
      LOG_FILTER_STATE.subject = "";
      document.getElementById("log-filters").querySelectorAll("input, select").forEach((el) => {
        el.value = "";
      });
      applyFilters(1);
    });
    document.getElementById("filter-refresh").addEventListener("click", async () => {
      noiseEventsCache = null;
      await renderLogs();
    });
    document.getElementById("page-content").addEventListener("click", (e) => {
      if (e.target.classList.contains("review-clip")) {
        playAudioClip(e.target.dataset.id, logs);
      }
    });
    applyFilters(1);
  } catch (e) {
    showError(e.message);
  }
}

function playAudioClip(logId, logs) {
  const log = logs.find((l) => l.id === logId);
  if (!log || !log.audioUrl) return;

  const modal = document.createElement("div");
  modal.className = "audio-modal-backdrop";
  modal.innerHTML = `
    <div class="panel audio-modal-panel">
      <h3 style="margin-top:0">Review clip (read-only)</h3>
      <p style="font-size:0.85rem;color:var(--muted)">${log.room} · ${log.db} dB · ${log.date} ${log.time}</p>
      <audio controls src="${log.audioUrl}" style="width:100%"></audio>
      <p style="font-size:0.75rem;color:var(--muted)">No download. Access logged.</p>
      <button type="button" class="btn btn-secondary btn-sm" id="close-audio">Close</button>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#close-audio").onclick = () => modal.remove();
  modal.onclick = (ev) => { if (ev.target === modal) modal.remove(); };
  console.info("[AUDIT] Audio play", session.username, logId, new Date().toISOString());
}

async function renderAudio() {
  if (!isAdmin(session)) {
    document.getElementById("page-content").innerHTML =
      `<div class="empty-state">Audio Evidence is admin-only. Teachers can review clips from Noise Logs.</div>`;
    return;
  }

  showLoading();
  try {
    const logs = filterLogsForUser(await loadNoiseEvents(), session);
    const clips = getAudioClipsFromLogs(logs, "admin", null);

    document.getElementById("page-content").innerHTML = `
      <div class="policy-banner">
        <strong>Official policy</strong>
        Audio from <code>noise_events</code> (audio_url). Event-triggered, short, access-controlled. No continuous recording.
        <br><br>
        RED only · ${clips.length} clip(s) with audio · Retention ${settings.retentionDays} days
      </div>
      ${
        clips.length === 0
          ? `<div class="empty-state">No RED events with audio_url in noise_events.</div>`
          : `<div class="audio-grid">${clips
              .map(
                (c) => `
        <div class="audio-card">
          <div class="room">${c.room}</div>
          <div class="meta">${c.time} · ${c.lengthSec}s · ${c.recordingId}</div>
          <div class="db">${c.db} dB <span class="status-pill red">RED</span> ${c.warningLevel ? `<span style="font-size:0.7rem;color:var(--muted)">${c.warningLevel}</span>` : ""}</div>
          <div class="audio-player-mock">
            <button type="button" class="play-btn" data-url="${c.audioUrl}" data-id="${c.id}" title="Stream only">▶</button>
            <div class="waveform"></div>
            <span style="font-size:0.75rem;color:var(--muted)">${c.lengthSec}s</span>
          </div>
          <audio class="hidden-audio" data-id="${c.id}" src="${c.audioUrl}" style="display:none"></audio>
          <div class="retention-tag">Expires in ${c.expiresIn} · Retention ${c.retentionDays} days</div>
        </div>`
              )
              .join("")}</div>`
      }
    `;

    document.querySelectorAll(".play-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const audio = document.querySelector(`audio[data-id="${btn.dataset.id}"]`);
        if (audio) {
          audio.style.display = "block";
          audio.style.width = "100%";
          audio.style.marginTop = "0.5rem";
          audio.play();
        }
        console.info("[AUDIT] Admin audio", btn.dataset.id, session.username);
      });
    });
  } catch (e) {
    showError(e.message);
  }
}

function renderSettings() {
  if (!isAdmin(session)) {
    document.getElementById("page-content").innerHTML =
      `<div class="empty-state">System settings are restricted to administrators.</div>`;
    return;
  }

  document.getElementById("page-content").innerHTML = `
    <form id="settings-form">
      <div class="settings-grid">
        <div class="panel setting-group">
          <h4>Noise thresholds (dB)</h4>
          <div class="setting-row">
            <span>Green (below)</span>
            <input type="number" name="thresholdGreen" value="${settings.thresholdGreen}" min="40" max="90" />
          </div>
          <div class="setting-row">
            <span>Yellow (up to)</span>
            <input type="number" name="thresholdYellow" value="${settings.thresholdYellow}" min="50" max="95" />
          </div>
          <div class="setting-row">
            <span>Red (from)</span>
            <input type="number" name="thresholdRed" value="${settings.thresholdRed}" min="55" max="100" />
          </div>
        </div>
        <div class="panel setting-group">
          <h4>Buzzer behavior</h4>
          <div class="setting-row">
            <span>Enable buzzer</span>
            <label class="toggle">
              <input type="checkbox" name="buzzerEnabled" ${settings.buzzerEnabled ? "checked" : ""} />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-row">
            <span>Max beeps per event</span>
            <input type="number" name="maxBeeps" value="${settings.maxBeeps}" min="1" max="5" />
          </div>
          <div class="setting-row">
            <span>Cooldown (seconds)</span>
            <input type="number" name="buzzerCooldown" value="${settings.buzzerCooldown}" min="5" max="120" />
          </div>
        </div>
        <div class="panel setting-group">
          <h4>Audio & alerts</h4>
          <div class="setting-row">
            <span>Recording length (sec)</span>
            <span>${settings.audioLengthMin}–${settings.audioLengthMax}</span>
          </div>
          <div class="setting-row">
            <span>Alert cooldown (sec)</span>
            <input type="number" name="alertCooldown" value="${settings.alertCooldown}" min="10" max="300" />
          </div>
          <div class="setting-row">
            <span>Retention (days)</span>
            <input type="number" name="retentionDays" value="${settings.retentionDays}" min="7" max="14" />
          </div>
          <div class="setting-row">
            <span>Teacher access window (hours)</span>
            <input type="number" name="teacherAccessHours" value="${settings.teacherAccessHours}" min="24" max="48" />
          </div>
        </div>
      </div>
      <button type="submit" class="btn btn-primary" style="margin-top:1rem">Save configuration</button>
      <p id="settings-saved" class="hidden" style="color:var(--green);margin-top:0.5rem">Saved locally (no settings table in Supabase yet).</p>
    </form>
  `;

  document.getElementById("settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    settings.thresholdGreen = Number(fd.get("thresholdGreen"));
    settings.thresholdYellow = Number(fd.get("thresholdYellow"));
    settings.thresholdRed = Number(fd.get("thresholdRed"));
    settings.buzzerEnabled = !!fd.get("buzzerEnabled");
    settings.maxBeeps = Number(fd.get("maxBeeps"));
    settings.buzzerCooldown = Number(fd.get("buzzerCooldown"));
    settings.alertCooldown = Number(fd.get("alertCooldown"));
    settings.retentionDays = Number(fd.get("retentionDays"));
    settings.teacherAccessHours = Number(fd.get("teacherAccessHours"));
    document.getElementById("settings-saved").classList.remove("hidden");
  });
}

async function renderReports() {
  showLoading();
  try {
    const logs = filterLogsForUser(await loadNoiseEvents(), session);
    const byRoom = aggregateIncidentsByRoom(
      logs.filter((l) => l.status === "red")
    );
    const trendByDate = aggregateIncidentsByDateTime(logs, 14);
    const heatmap = buildReportsHeatmap(logs);

    document.getElementById("page-content").innerHTML = `
      <div class="export-bar">
        <button type="button" class="btn btn-secondary" id="export-weekly-pdf">Export weekly PDF</button>
      </div>
      <div class="charts-row">
        <div class="panel">
          <h3>Noise trend (from noise_events)</h3>
          <div class="chart-wrap"><canvas id="chart-trend"></canvas></div>
        </div>
        <div class="panel">
          <h3>RED incidents per room / device</h3>
          <div class="chart-wrap"><canvas id="chart-report-bars"></canvas></div>
        </div>
      </div>
      <div class="panel" style="margin-top:1rem">
        <h3>Heatmap — RED events by weekday × hour</h3>
        <div class="heatmap-layout">
          <div class="heatmap-row-labels">${heatmap.dayLabels.map((d) => `<span>${d}</span>`).join("")}</div>
          <div class="heatmap-wrap">
            <div class="heatmap" id="heatmap"></div>
            <div class="heatmap-labels"><span>7 AM</span><span>10 AM</span><span>1 PM</span><span>2 PM</span></div>
          </div>
        </div>
      </div>
    `;

    const trendCanvas = document.getElementById("chart-trend");
    if (trendCanvas) {
      // Destroy any existing Chart instance on this canvas
      const existingTrendChart = Chart.getChart(trendCanvas);
      if (existingTrendChart) {
        existingTrendChart.destroy();
      }
      
      chartInstances.push(
        new Chart(trendCanvas, {
          type: "line",
          data: {
            labels: trendByDate.map((x) => x.label),
            datasets: [
              {
                label: "All incidents",
                data: trendByDate.map((x) => x.count),
                borderColor: "#ef4444",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                fill: true,
                tension: 0.25,
                pointRadius: 3,
              },
            ],
          },
          options: lineDateChartOptions(trendByDate.length),
        })
      );
    }
    renderBarChart("chart-report-bars", byRoom, "rgba(239, 68, 68, 0.75)");
    resizeChartsSoon();

    const hm = document.getElementById("heatmap");
    const maxH = Math.max(1, ...heatmap.cells.map((c) => c.count));
    heatmap.cells.forEach((cell) => {
      const el = document.createElement("div");
      el.className = "heatmap-cell";
      el.title = `${cell.dayLabel} ${cell.hour}:00 — ${cell.count} event(s)`;
      const intensity = cell.count / maxH;
      const r = Math.floor(239 * intensity + 34 * (1 - intensity));
      const g = Math.floor(68 * intensity + 197 * (1 - intensity));
      el.style.background = `rgb(${r},${g},80)`;
      if (cell.count > 0) el.textContent = cell.count;
      hm.appendChild(el);
    });

    document.getElementById("export-weekly-pdf").addEventListener("click", async () => {
      const all = await loadNoiseEvents();
      generateWeeklyPdf(all, { role: isAdmin(session) ? 'admin' : 'teacher', session, days: 7 });
    });
  } catch (e) {
    showError(e.message);
  }
}

// CSV export removed — weekly PDF reports are used instead.

async function renderAudit() {
  if (!isAdmin(session)) {
    document.getElementById("page-content").innerHTML =
      `<div class="empty-state">Audit trail is visible to administrators only.</div>`;
    return;
  }

  showLoading();
  try {
    let rows = [];
    try {
      rows = await fetchAuditLogs();
    } catch {
      rows = [];
    }
    const entries = rows.length ? rows.map(mapAuditRow) : [];

    document.getElementById("page-content").innerHTML = `
      <div class="policy-banner">
        <strong>audit_logs table</strong>
        Threshold changes · Buzzer configuration · Audio access
      </div>
      <div class="panel">
        ${
          entries.length === 0
            ? `<div class="empty-state">No rows in audit_logs yet.</div>`
            : `<ul class="audit-list">${entries
                .map(
                  (a) =>
                    `<li><span>${a.time}</span> — <strong>${a.action}</strong> by ${a.user}: ${a.detail}</li>`
                )
                .join("")}</ul>`
        }
      </div>
    `;
  } catch (e) {
    showError(e.message);
  }
}

const RENDERERS = {
  dashboard: renderDashboard,
  logs: renderLogs,
  audio: renderAudio,
  settings: renderSettings,
  reports: renderReports,
  audit: renderAudit,
};

async function navigate() {
  let route = getRoute();
  if (!isAdmin(session) && ["audio", "settings", "audit"].includes(route)) {
    route = "dashboard";
    location.hash = "dashboard";
  }

  destroyCharts();
  const meta = ROUTES[route];
  document.getElementById("page-title").textContent = meta.title;
  document.getElementById("page-keyword").textContent = meta.keyword;
  setActiveNav(route);
  await RENDERERS[route]();
  resizeChartsSoon();
}

function initSessionTimer() {
  function tick() {
    const ms = getRemainingSessionMs(session);
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    document.getElementById("session-timer").textContent =
      `Session: ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    if (ms <= 0) logout();
  }
  tick();
  setInterval(tick, 1000);
}

function initMobileNav() {
  const toggle = document.getElementById("menu-toggle");
  const overlay = document.getElementById("sidebar-overlay");
  const sidebar = document.getElementById("sidebar");

  function setOpen(open) {
    document.body.classList.toggle("sidebar-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    overlay.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) document.body.style.overflow = "";
    else document.body.style.overflow = "hidden";
  }

  toggle.addEventListener("click", () => {
    setOpen(!document.body.classList.contains("sidebar-open"));
  });
  overlay.addEventListener("click", () => setOpen(false));
  sidebar.querySelectorAll(".nav-links a").forEach((a) => {
    a.addEventListener("click", () => setOpen(false));
  });
  document.getElementById("btn-logout")?.addEventListener("click", () => setOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) setOpen(false);
  });
}

function initAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = setInterval(() => {
    const route = getRoute();
    if (route === "dashboard") {
      loadNoiseEvents(true)
        .then(() => refreshDashboard())
        .catch(() => {});
      return;
    }
    const pageEl = document.getElementById("page-content");
    if (pageEl) pageEl.classList.add("refreshing");
    loadNoiseEvents(true)
      .then(() => navigate())
      .catch(() => navigate())
      .finally(() => {
        if (pageEl) pageEl.classList.remove("refreshing");
      });
  }, AUTO_REFRESH_INTERVAL);
}

function updateAutoRefresh() {
  const route = getRoute();
  if (shouldAutoRefreshAdminRoute(route)) {
    if (!autoRefreshInterval) initAutoRefresh();
    return;
  }
  stopAutoRefresh();
}

function shouldAutoRefreshAdminRoute(route) {
  return ["dashboard", "audio"].includes(route);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

function init() {
  session = requireAuth();
  if (!session) return;

  initMobileNav();
  document.getElementById("sidebar-user").textContent = session.name;
  const badge = document.getElementById("sidebar-role");
  badge.textContent = session.role;
  badge.className = `role-badge ${session.role}`;
  document.getElementById("sidebar-rooms").textContent = "All classrooms / devices";

  updateTeacherNav();
  document.getElementById("btn-logout").addEventListener("click", logout);
  window.addEventListener("hashchange", () => {
    navigate();
    updateAutoRefresh();
  });
  document.addEventListener("click", touchSession);

  navigate();
  initSessionTimer();
  updateAutoRefresh();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      chartInstances.forEach((c) => c.resize());
    }, 150);
  });
}

init();
