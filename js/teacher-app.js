let teacherSession = null;
let teacherAutoRefreshInterval = null;
const TEACHER_AUTO_REFRESH_INTERVAL = 10000;
const teacherEventState = {
  currentPage: 1,
  filterFrom: "",
  filterTo: "",
  filterTimeFrom: "",
  filterTimeTo: "",
};

const TEACHER_ROUTES = {
  dashboard: { title: "Overview", keyword: "RED events — last 48 hours" },
  events: { title: "RED Events", keyword: "Your classroom & subject reports only" },
  schedule: { title: "My Schedule", keyword: "Customize your class schedule & subjects" },
  audio: { title: "Audio Clips", keyword: "Read-only · 3–5 seconds" },
  policy: { title: "Access Policy", keyword: "Controlled teacher access model" },
};

function getTeacherRoute() {
  const hash = (location.hash || "#dashboard").slice(1);
  return TEACHER_ROUTES[hash] ? hash : "dashboard";
}

function setTeacherNav(route) {
  document.querySelectorAll(".nav-links a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });
}

function teacherAssignmentLabel(session) {
  const parts = [];
  if (session.assignedRooms?.length) parts.push(`Room: ${session.assignedRooms.join(", ")}`);
  if (session.deviceIds?.length) parts.push(`Device: ${session.deviceIds.join(", ")}`);
  return parts.join(" · ") || "—";
}

function renderEventCard(l, options = {}) {
  const displaySubject = options.subjectOverride ?? l.subject;
  const displayTeacher = options.teacherOverride ?? l.teacher;
  const showAccessExpiry = options.showAccessExpiry;
  const accessExpiry = showAccessExpiry
    ? `<div class="event-card-field"><span class="field-label">Access expires</span><span class="field-value" style="color:var(--yellow);font-size:0.8rem">${formatAccessWindowRemaining(l.datetime)}</span></div>`
    : "";
  const audioBtn =
    l.audioRecorded && l.audioUrl
      ? `<button type="button" class="btn btn-secondary btn-sm play-teacher-audio" data-id="${l.id}">Review Clip</button>`
      : `<span class="yes-no no">No</span>`;

  return `
    <div class="event-card" data-id="${l.id}">
      <div class="event-card-main">
        <div class="event-card-field">
          <span class="field-label">Date</span>
          <span class="field-value">${l.date}</span>
        </div>
        <div class="event-card-field">
          <span class="field-label">Time</span>
          <span class="field-value">${l.time}</span>
        </div>
        <div class="event-card-field">
          <span class="field-label">Room / Device</span>
          <span class="field-value">${l.room}</span>
        </div>
        <div class="event-card-field">
          <span class="field-label">Noise (dB)</span>
          <span class="field-value"><strong>${l.db}</strong> dB</span>
        </div>
      </div>
      <div class="event-card-details">
        <div class="event-card-field">
          <span class="field-label">Level</span>
          <span class="field-value"><span class="status-pill red">${l.warningLevel || "RED"}</span></span>
        </div>
        <div class="event-card-field">
          <span class="field-label">Duration</span>
          <span class="field-value">${l.durationSec ? l.durationSec + "s" : "—"}</span>
        </div>
        <div class="event-card-field">
          <span class="field-label">Buzzer</span>
          <span class="field-value yes-no ${l.buzzer ? "yes" : "no"}">${l.buzzer ? "Yes" : "No"}</span>
        </div>
        <div class="event-card-field">
          <span class="field-label">Subject</span>
          <span class="field-value">${displaySubject}</span>
        </div>
        <div class="event-card-field">
          <span class="field-label">Teacher</span>
          <span class="field-value">${displayTeacher}</span>
        </div>
        <div class="event-card-field">
          <span class="field-label">Audio</span>
          <span class="field-value">${audioBtn}</span>
        </div>
        ${accessExpiry}
      </div>
    </div>`;
}

function getTeacherScheduleSlotForEvent(log, session) {
  const schedule = getTeacherSchedule(session.id);
  const slots = schedule.slots || [];
  if (!slots.length) return null;

  const eventDate = new Date(log.datetime);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const eventDay = dayNames[eventDate.getDay()];
  const eventMins = eventDate.getHours() * 60 + eventDate.getMinutes();

  return slots.find((slot) => {
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

function decorateTeacherEventForDisplay(log, session) {
  if (!session) return log;
  const slot = getTeacherScheduleSlotForEvent(log, session);
  const subject =
    (slot?.subject && slot.subject !== "—")
      ? slot.subject
      : session.defaultSubject || log.subject || "—";
  const teacher = session.name || log.teacher || "—";
  return { ...log, subject, teacher };
}

function renderTeacherPolicyBanner() {
  return `
    <div class="policy-banner teacher-access-banner">
      <strong>Time-limited access</strong>
      You can only view RED-level events and audio from the last <strong>${TEACHER_ACCESS_HOURS} hours</strong>.
      Older recordings are archived and not available to teachers.
    </div>`;
}

function renderAccessPolicyPage() {
  document.getElementById("page-content").innerHTML = `
    <div class="policy-banner">
      <strong>Official access policy</strong>
      Teachers are granted limited, read-only access to short, event-triggered audio clips from their own classes for validation purposes only. All access is time-bound and logged.
    </div>
    <div class="access-grid">
      <div class="panel access-panel access-can">
        <h3>Teachers CAN</h3>
        <ul class="access-list">
          <li>View <strong>RED-level events</strong> from their assigned classroom</li>
          <li>Listen to <strong>short audio clips</strong> (read-only stream)</li>
          <li>Access recordings within <strong>24–48 hours</strong> of the event only</li>
        </ul>
      </div>
      <div class="panel access-panel access-cannot">
        <h3>Teachers CANNOT</h3>
        <ul class="access-list">
          <li>Download or share audio</li>
          <li>Access other classrooms</li>
          <li>Access long-term archives</li>
          <li>Delete records</li>
        </ul>
      </div>
    </div>
    <div class="panel">
      <h3>Your current access</h3>
      <div class="setting-row"><span>Classroom</span><span>${teacherSession.assignedRooms.join(", ") || "—"}</span></div>
      <div class="setting-row"><span>Device</span><span>${teacherSession.deviceIds.join(", ") || "—"}</span></div>
      <div class="setting-row"><span>Access window</span><span>${TEACHER_ACCESS_HOURS} hours from event time</span></div>
      <div class="setting-row"><span>Audio mode</span><span>Read-only streaming (no download)</span></div>
    </div>
  `;
}

async function renderTeacherDashboard() {
  showLoading();
  try {
    const allLogs = await loadNoiseEvents();
    const events = filterTeacherEvents(allLogs, teacherSession).map((l) => decorateTeacherEventForDisplay(l, teacherSession));
    const withAudio = filterTeacherAudioLogs(allLogs, teacherSession).map((l) => decorateTeacherEventForDisplay(l, teacherSession));

    document.getElementById("page-content").innerHTML = `
      ${renderTeacherPolicyBanner()}
      <div style="margin:0.5rem 0"><button type="button" class="btn btn-secondary" id="teacher-export-weekly-pdf">Download weekly PDF</button></div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">RED events (48h)</div>
          <div class="value red">${events.length}</div>
        </div>
        <div class="stat-card">
          <div class="label">Audio clips available</div>
          <div class="value">${withAudio.length}</div>
        </div>
        <div class="stat-card">
          <div class="label">Assigned classroom</div>
          <div class="value" style="font-size:1rem">${teacherSession.assignedRooms[0] || teacherSession.deviceIds[0] || "—"}</div>
        </div>
        <div class="stat-card">
          <div class="label">Access window</div>
          <div class="value green" style="font-size:1.1rem">${TEACHER_ACCESS_HOURS}h</div>
        </div>
      </div>
      <div class="panel">
        <h3>Recent RED events</h3>
        ${
          events.length === 0
            ? `<div class="empty-state">No RED-level events in the last ${TEACHER_ACCESS_HOURS} hours for your classroom.</div>`
            : `<div class="event-list">${events.slice(0, 5).map((l) => renderEventCard(l, { showAccessExpiry: false })).join("")}</div>`
        }
      </div>
    `;
    bindTeacherAudioButtons(events);
    const btn = document.getElementById('teacher-export-weekly-pdf');
    if (btn) {
      btn.addEventListener('click', async () => {
        const all = await loadNoiseEvents();
        generateWeeklyPdf(all, { role: 'teacher', session: teacherSession, days: 7 });
      });
    }
  } catch (e) {
    showError(e.message);
  }
}

async function renderTeacherEvents() {
  showLoading();
  try {
    const allLogs = await loadNoiseEvents();
    const events = filterTeacherEvents(allLogs, teacherSession).map((l) => decorateTeacherEventForDisplay(l, teacherSession));
    let currentPage = 1;
    let filterFrom = teacherEventState.filterFrom;
    let filterTo = teacherEventState.filterTo;
    let filterTimeFrom = teacherEventState.filterTimeFrom;
    let filterTimeTo = teacherEventState.filterTimeTo;

    function renderEventsPage() {
      teacherEventState.currentPage = currentPage;
      teacherEventState.filterFrom = filterFrom;
      teacherEventState.filterTo = filterTo;
      teacherEventState.filterTimeFrom = filterTimeFrom;
      teacherEventState.filterTimeTo = filterTimeTo;

      let filtered = filterLogsByDateTime(events, filterFrom, filterTo, filterTimeFrom, filterTimeTo);
      const pagination = paginateItems(filtered, currentPage);
      filtered = pagination.items;

      document.getElementById("teacher-events-list").innerHTML =
        filtered.length === 0
          ? `<div class="empty-state">No RED events match your filters within the ${TEACHER_ACCESS_HOURS}-hour access window.</div>`
          : `<div class="event-list">${filtered.map((l) => renderEventCard(l, { showAccessExpiry: true })).join("")}</div>`;

      const pagEl = document.getElementById("teacher-events-pagination");
      if (pagEl) {
        pagEl.innerHTML = renderPaginationHtml(pagination, "teacher-event");
        bindPagination("teacher-event", pagination.page, pagination.totalPages, (p) => {
          currentPage = p;
          renderEventsPage();
          document.getElementById("page-content").scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      bindTeacherAudioButtons(events);
    }

    document.getElementById("page-content").innerHTML = `
      ${renderTeacherPolicyBanner()}
      <div class="filters-bar" id="teacher-event-filters">
        <div class="form-group">
          <label>From date</label>
          <input type="date" id="te-filter-from" />
        </div>
        <div class="form-group">
          <label>To date</label>
          <input type="date" id="te-filter-to" />
        </div>
        <div class="form-group">
          <label>From time</label>
          <input type="time" id="te-filter-time-from" />
        </div>
        <div class="form-group">
          <label>To time</label>
          <input type="time" id="te-filter-time-to" />
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="te-filter-reset">Reset</button>
      </div>
      <div class="panel">
        <p style="font-size:0.75rem;color:var(--muted);margin:0 0 0.75rem">
          Showing <strong>RED-level only</strong> · ${teacherAssignmentLabel(teacherSession)} · Last ${TEACHER_ACCESS_HOURS} hours
        </p>
        <div id="teacher-events-list"></div>
        <div id="teacher-events-pagination"></div>
      </div>
    `;

    ["te-filter-from", "te-filter-to", "te-filter-time-from", "te-filter-time-to"].forEach((id) => {
      document.getElementById(id).addEventListener("input", () => {
        filterFrom = document.getElementById("te-filter-from").value;
        filterTo = document.getElementById("te-filter-to").value;
        filterTimeFrom = document.getElementById("te-filter-time-from").value;
        filterTimeTo = document.getElementById("te-filter-time-to").value;
        currentPage = 1;
        renderEventsPage();
      });
    });
    document.getElementById("te-filter-reset").addEventListener("click", () => {
      document.getElementById("teacher-event-filters").querySelectorAll("input").forEach((el) => { el.value = ""; });
      filterFrom = filterTo = filterTimeFrom = filterTimeTo = "";
      currentPage = 1;
      renderEventsPage();
    });

    renderEventsPage();
  } catch (e) {
    showError(e.message);
  }
}

function renderTeacherSchedulePage() {
  const schedule = getTeacherSchedule(teacherSession.id);
  let editingIndex = null;

  document.getElementById("page-content").innerHTML = `
    <div class="policy-banner">
      <strong>Your schedule</strong>
      Set your weekly class times. Noise reports are filtered to match your schedule and assigned classroom.
    </div>
    <div class="panel">
      <h3>Add schedule slot</h3>
      <div class="schedule-form-grid">
        <div class="form-group">
          <label for="slot-day">Day</label>
          <select id="slot-day">
            <option value="Mon">Monday</option>
            <option value="Tue">Tuesday</option>
            <option value="Wed">Wednesday</option>
            <option value="Thu">Thursday</option>
            <option value="Fri">Friday</option>
            <option value="Sat">Saturday</option>
          </select>
        </div>
        <div class="form-group">
          <label for="slot-start">Start</label>
          <input type="time" id="slot-start" value="08:00" />
        </div>
        <div class="form-group">
          <label for="slot-end">End</label>
          <input type="time" id="slot-end" value="09:00" />
        </div>
        <div class="form-group">
          <label for="slot-subject">Subject</label>
          <input type="text" id="slot-subject" placeholder="e.g. ICT" />
        </div>
        <div class="form-group">
          <label for="slot-room">Room</label>
          <input type="text" id="slot-room" value="" />
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="add-slot-btn" style="height:fit-content">Add slot</button>
        <button type="button" class="btn btn-secondary btn-sm hidden" id="cancel-edit-btn" style="height:fit-content">Cancel</button>
      </div>
      <p class="error-msg hidden" id="schedule-error"></p>
    </div>
    <div class="panel">
      <h3>Your weekly schedule</h3>
      <ul class="schedule-list" id="schedule-slots-list"></ul>
      <div class="empty-state hidden" id="no-slots-msg">No schedule slots yet. Add your class times above.</div>
    </div>
  `;

  function isTimeOverlap(a, b) {
    const [aStartH, aStartM] = a.startTime.split(":").map(Number);
    const [aEndH, aEndM] = a.endTime.split(":").map(Number);
    const [bStartH, bStartM] = b.startTime.split(":").map(Number);
    const [bEndH, bEndM] = b.endTime.split(":").map(Number);
    const aStart = aStartH * 60 + aStartM;
    const aEnd = aEndH * 60 + aEndM;
    const bStart = bStartH * 60 + bStartM;
    const bEnd = bEndH * 60 + bEndM;
    return aStart < bEnd && bStart < aEnd;
  }

  function validateSlot(slot, slots, excludedIndex = null) {
    if (!slot.startTime || !slot.endTime) {
      return "Start and end time are required.";
    }
    if (slot.startTime >= slot.endTime) {
      return "End time must be after start time.";
    }
    const normalizedSubject = normalizeName(slot.subject || "");
    const normalizedRoom = normalizeName(slot.room || "");

    for (let idx = 0; idx < slots.length; idx++) {
      if (idx === excludedIndex) continue;
      const existing = slots[idx];
      if (
        existing.day === slot.day &&
        existing.startTime === slot.startTime &&
        existing.endTime === slot.endTime &&
        normalizeName(existing.subject || "") === normalizedSubject &&
        normalizeName(existing.room || "") === normalizedRoom
      ) {
        return "This schedule slot already exists.";
      }
      if (existing.day === slot.day && isTimeOverlap(existing, slot)) {
        return "Cannot add slot: this time slot overlaps with another on the same day.";
      }
      if (
        existing.day === slot.day &&
        normalizedSubject &&
        normalizeName(existing.subject || "") === normalizedSubject &&
        isTimeOverlap(existing, slot)
      ) {
        return "This subject already has a conflicting time slot on the same day.";
      }
    }
    return null;
  }

  function resetForm() {
    editingIndex = null;
    document.getElementById("slot-day").value = "Mon";
    document.getElementById("slot-start").value = "08:00";
    document.getElementById("slot-end").value = "09:00";
    document.getElementById("slot-subject").value = "";
    document.getElementById("slot-room").value = "";
    document.getElementById("add-slot-btn").textContent = "Add slot";
    document.getElementById("cancel-edit-btn").classList.add("hidden");
    const errorEl = document.getElementById("schedule-error");
    errorEl.classList.add("hidden");
    errorEl.classList.remove("visible");
    errorEl.textContent = "";
  }

  function renderSlotsList() {
    const current = getTeacherSchedule(teacherSession.id);
    const list = document.getElementById("schedule-slots-list");
    const empty = document.getElementById("no-slots-msg");
    const slots = current.slots || [];

    if (slots.length === 0) {
      list.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    list.innerHTML = slots
      .map(
        (slot, idx) => `
      <li>
        <div class="schedule-slot-info">
          <strong>${slot.day}</strong> · ${slot.startTime}–${slot.endTime}
          <div class="schedule-slot-meta">
            ${slot.subject || "—"} · ${slot.room || teacherSession.assignedRooms[0] || "—"}
          </div>
        </div>
        <div class="schedule-slot-actions">
          <button type="button" class="btn btn-secondary btn-sm edit-slot" data-idx="${idx}">Edit</button>
          <button type="button" class="btn btn-secondary btn-sm remove-slot" data-idx="${idx}">Remove</button>
        </div>
      </li>
    `
      )
      .join("");

    list.querySelectorAll(".edit-slot").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const s = getTeacherSchedule(teacherSession.id);
        const slot = s.slots[idx];
        editingIndex = idx;
        document.getElementById("slot-day").value = slot.day;
        document.getElementById("slot-start").value = slot.startTime;
        document.getElementById("slot-end").value = slot.endTime;
        document.getElementById("slot-subject").value = slot.subject;
        document.getElementById("slot-room").value = slot.room;
        document.getElementById("add-slot-btn").textContent = "Save slot";
        document.getElementById("cancel-edit-btn").classList.remove("hidden");
      });
    });

    list.querySelectorAll(".remove-slot").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = getTeacherSchedule(teacherSession.id);
        s.slots.splice(parseInt(btn.dataset.idx, 10), 1);
        saveTeacherSchedule(teacherSession.id, s);
        resetForm();
        renderSlotsList();
      });
    });
  }

  const errorEl = document.getElementById("schedule-error");
  const addSlotBtn = document.getElementById("add-slot-btn");
  const cancelEditBtn = document.getElementById("cancel-edit-btn");

  addSlotBtn.addEventListener("click", () => {
    const slot = {
      day: document.getElementById("slot-day").value,
      startTime: document.getElementById("slot-start").value,
      endTime: document.getElementById("slot-end").value,
      subject: document.getElementById("slot-subject").value.trim(),
      room: document.getElementById("slot-room").value.trim(),
    };

    const s = getTeacherSchedule(teacherSession.id);
    s.slots = s.slots || [];
    const validationError = validateSlot(slot, s.slots, editingIndex);
    if (validationError) {
      errorEl.textContent = validationError;
      errorEl.classList.remove("hidden");
      errorEl.classList.add("visible");
      return;
    }

    if (editingIndex !== null) {
      s.slots[editingIndex] = slot;
    } else {
      s.slots.push(slot);
    }
    saveTeacherSchedule(teacherSession.id, s);
    resetForm();
    renderSlotsList();
  });

  cancelEditBtn.addEventListener("click", () => {
    resetForm();
  });

  renderSlotsList();
}

async function renderTeacherAudio() {
  showLoading();
  try {
    const allLogs = await loadNoiseEvents();
    const clips = filterTeacherAudioLogs(allLogs, teacherSession);

    document.getElementById("page-content").innerHTML = `
      ${renderTeacherPolicyBanner()}
      <div class="policy-banner">
        <strong>Read-only streaming</strong>
        Play button only — no download, no sharing. Clips are 3–5 seconds and event-triggered.
      </div>
      ${
        clips.length === 0
          ? `<div class="empty-state">No audio clips available within the ${TEACHER_ACCESS_HOURS}-hour access window.</div>`
          : `<div class="audio-grid">${clips.map((l) => `
        <div class="audio-card">
          <div class="room">${l.room}</div>
          <div class="meta">${l.date} ${l.time} · ${l.durationSec || 5}s · ${formatAccessWindowRemaining(l.datetime)}</div>
          <div class="db">${l.db} dB <span class="status-pill red">RED</span></div>
          <div class="audio-player-mock">
            <button type="button" class="play-btn play-teacher-audio" data-id="${l.id}" title="Stream only — no download">▶</button>
            <div class="waveform"></div>
          </div>
          <div class="retention-tag">Read-only · Access logged · No download</div>
        </div>`).join("")}</div>`
      }
    `;
    bindTeacherAudioButtons(clips);
  } catch (e) {
    showError(e.message);
  }
}

function bindTeacherAudioButtons(logs) {
  document.querySelectorAll(".play-teacher-audio").forEach((btn) => {
    btn.addEventListener("click", () => {
      playTeacherAudio(btn.dataset.id, logs);
    });
  });
}

function playTeacherAudio(logId, logs) {
  const log = logs.find((l) => l.id === logId);
  if (!log || !log.audioUrl) return;
  if (!isWithinTeacherAccessWindow(log.datetime)) {
    alert("This recording is no longer available. Teacher access expires after 48 hours.");
    return;
  }

  const modal = document.createElement("div");
  modal.className = "audio-modal-backdrop";
  modal.innerHTML = `
    <div class="panel audio-modal-panel">
      <h3 style="margin-top:0">Review clip (read-only)</h3>
      <p style="font-size:0.85rem;color:var(--muted)">${log.room} · ${log.db} dB · ${log.date} ${log.time}</p>
      <p style="font-size:0.75rem;color:var(--yellow)">${formatAccessWindowRemaining(log.datetime)}</p>
      <audio
        class="teacher-audio-player"
        controls
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        src="${log.audioUrl}"
        style="width:100%"
      ></audio>
      <p style="font-size:0.75rem;color:var(--muted)">No download or sharing. Access logged for ${teacherSession.name}.</p>
      <button type="button" class="btn btn-secondary btn-sm" id="close-audio">Close</button>
    </div>`;
  document.body.appendChild(modal);

  const audio = modal.querySelector("audio");
  audio.addEventListener("contextmenu", (e) => e.preventDefault());
  modal.querySelector("#close-audio").onclick = () => modal.remove();
  modal.onclick = (ev) => { if (ev.target === modal) modal.remove(); };
  console.info("[AUDIT] Teacher audio", teacherSession.username, logId, new Date().toISOString());
}

const TEACHER_RENDERERS = {
  dashboard: renderTeacherDashboard,
  events: renderTeacherEvents,
  schedule: renderTeacherSchedulePage,
  audio: renderTeacherAudio,
  policy: renderAccessPolicyPage,
};

async function teacherNavigate() {
  const route = getTeacherRoute();
  const meta = TEACHER_ROUTES[route];
  document.getElementById("page-title").textContent = meta.title;
  document.getElementById("page-keyword").textContent = meta.keyword;
  setTeacherNav(route);
  await TEACHER_RENDERERS[route]();
}

function initTeacherMobileNav() {
  const toggle = document.getElementById("menu-toggle");
  const overlay = document.getElementById("sidebar-overlay");
  const sidebar = document.getElementById("sidebar");

  function setOpen(open) {
    document.body.classList.toggle("sidebar-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    overlay.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.style.overflow = open ? "hidden" : "";
  }

  toggle.addEventListener("click", () => setOpen(!document.body.classList.contains("sidebar-open")));
  overlay.addEventListener("click", () => setOpen(false));
  sidebar.querySelectorAll(".nav-links a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  document.getElementById("btn-logout")?.addEventListener("click", () => setOpen(false));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  window.addEventListener("resize", () => { if (window.innerWidth > 768) setOpen(false); });
}

function initTeacherSessionTimer() {
  function tick() {
    const ms = getTeacherRemainingSessionMs(teacherSession);
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    document.getElementById("session-timer").textContent =
      `Session: ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    if (ms <= 0) teacherLogout();
  }
  tick();
  setInterval(tick, 1000);
}

function shouldAutoRefreshTeacherRoute(route) {
  return ["dashboard", "events", "audio"].includes(route);
}

function initTeacherAutoRefresh() {
  if (teacherAutoRefreshInterval) clearInterval(teacherAutoRefreshInterval);
  teacherAutoRefreshInterval = setInterval(() => {
    const pageEl = document.getElementById("page-content");
    if (pageEl) pageEl.classList.add("refreshing");
    loadNoiseEvents(true)
      .then(() => teacherNavigate())
      .catch(() => teacherNavigate())
      .finally(() => {
        if (pageEl) pageEl.classList.remove("refreshing");
      });
  }, TEACHER_AUTO_REFRESH_INTERVAL);
}

function updateTeacherAutoRefresh() {
  const route = getTeacherRoute();
  if (shouldAutoRefreshTeacherRoute(route)) {
    if (!teacherAutoRefreshInterval) initTeacherAutoRefresh();
    return;
  }
  stopTeacherAutoRefresh();
}

function stopTeacherAutoRefresh() {
  if (teacherAutoRefreshInterval) {
    clearInterval(teacherAutoRefreshInterval);
    teacherAutoRefreshInterval = null;
  }
}

function initTeacherApp() {
  teacherSession = requireTeacherAuth();
  if (!teacherSession) return;
  teacherSession = syncTeacherSessionFromAccount(teacherSession);
  sessionStorage.setItem(TEACHER_SESSION_KEY, JSON.stringify(teacherSession));

  document.getElementById("sidebar-user").textContent = teacherSession.name;
  document.getElementById("sidebar-rooms").textContent = teacherAssignmentLabel(teacherSession);

  initTeacherMobileNav();
  document.getElementById("btn-logout").addEventListener("click", teacherLogout);
  window.addEventListener("hashchange", () => {
    teacherNavigate();
    updateTeacherAutoRefresh();
  });
  document.addEventListener("click", touchTeacherSession);

  teacherNavigate();
  initTeacherSessionTimer();
  updateTeacherAutoRefresh();
}

initTeacherApp();
