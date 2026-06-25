const supabase = require("../services/supabase.service");
const { asyncHandler } = require("../middleware/utils");

const listNoiseEvents = asyncHandler(async (req, res) => {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");

  const { limit, room, deviceId, severity, audioOnly, from, to, offset } = req.query;
  const rowLimit = limit ? String(limit) : "1000";
  params.set("limit", rowLimit);
  if (offset) params.set("offset", String(offset));
  if (room) params.set("room", `eq.${room}`);
  if (deviceId) params.set("device_id", `eq.${deviceId}`);
  if (severity) params.set("warning_color", `eq.${String(severity).toUpperCase()}`);
  if (audioOnly === "true") {
    params.set("audio_recorded", "eq.true");
    params.set("audio_url", "not.is.null");
    params.set("warning_color", "eq.RED");
  }
  if (from) params.set("event_time_utc", `gte.${from}T00:00:00`);
  if (to) params.append("event_time_utc", `lte.${to}T23:59:59`);

  const rows = await supabase.get(
    supabase.TABLES.noiseEvents,
    params.toString(),
    req.accessToken
  );
  res.json(rows);
});

const deleteNoiseEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Event id is required" });
  await supabase.del(
    supabase.TABLES.noiseEvents,
    `id=eq.${id}`,
    req.accessToken
  );
  res.json({ ok: true, id });
});

const listClassrooms = asyncHandler(async (req, res) => {
  const rows = await supabase.get(
    supabase.TABLES.classrooms,
    "select=*&order=name.asc",
    req.accessToken
  );
  res.json(rows);
});

function buildAuditRecord(body, user) {
  const action = body.action || "Event";
  let detail = body.detail || "";
  const userLabel = user?.email || user?.user_metadata?.email;

  if (userLabel && !detail.includes(userLabel)) {
    detail = detail ? `${detail} (by ${userLabel})` : `by ${userLabel}`;
  }

  const record = { action, detail };

  const actorId = body.actor_id || user?.id;
  if (actorId) record.actor_id = actorId;

  return record;
}

const listAuditLogs = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const search = (req.query.search || "").trim();
  const actionFilter = (req.query.action || "").trim();

  let query = `select=*,profiles:actor_id(full_name)&order=created_at.desc&limit=${limit}&offset=${offset}`;
  if (actionFilter) query += `&action=ilike.*${encodeURIComponent(actionFilter)}*`;

  let rows = [];
  try {
    rows = await supabase.get(supabase.TABLES.auditLogs, query, req.accessToken);
  } catch {
    query = `select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (actionFilter) query += `&action=ilike.*${encodeURIComponent(actionFilter)}*`;
    rows = await supabase.get(supabase.TABLES.auditLogs, query, req.accessToken);
  }

  let entries = rows.map((row) => ({
    ...row,
    actor_name: row.profiles?.full_name || null,
    profiles: undefined,
  }));

  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(
      (row) =>
        (row.action || "").toLowerCase().includes(q) ||
        (row.detail || "").toLowerCase().includes(q) ||
        (row.actor_name || "").toLowerCase().includes(q)
    );
  }

  res.json(entries);
});

const createAuditLog = asyncHandler(async (req, res) => {
  const record = buildAuditRecord(req.body || {}, req.user);
  const result = await supabase.post(
    supabase.TABLES.auditLogs,
    record,
    req.accessToken
  );
  res.status(201).json(result);
});

const getSettings = asyncHandler(async (_req, res) => {
  try {
    const rows = await supabase.get(supabase.TABLES.systemSettings, "select=*&limit=1");
    res.json(rows.length ? rows[0] : null);
  } catch {
    res.json(null);
  }
});

const updateSettings = asyncHandler(async (req, res) => {
  const body = {
    ...(req.body || {}),
    updated_at: new Date().toISOString(),
  };
  await supabase.patch(supabase.TABLES.systemSettings, "id=eq.1", body, req.accessToken);
  res.json({ ok: true });
});

module.exports = {
  listNoiseEvents,
  deleteNoiseEvent,
  listClassrooms,
  listAuditLogs,
  createAuditLog,
  getSettings,
  updateSettings,
};
