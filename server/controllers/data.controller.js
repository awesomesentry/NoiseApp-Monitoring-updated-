const supabase = require("../services/supabase.service");
const { asyncHandler } = require("../middleware/utils");

const listNoiseEvents = asyncHandler(async (req, res) => {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");

  const { limit, room, deviceId, severity, audioOnly, from, to } = req.query;
  if (limit) params.set("limit", String(limit));
  if (room) params.set("room", `eq.${room}`);
  if (deviceId) params.set("device_id", `eq.${deviceId}`);
  if (severity) params.set("warning_color", `eq.${String(severity).toUpperCase()}`);
  if (audioOnly === "true") {
    params.set("audio_recorded", "eq.true");
    params.set("audio_url", "not.is.null");
    params.set("warning_color", "eq.RED");
  }
  if (from) params.set("created_at", `gte.${from}T00:00:00`);
  if (to) params.append("created_at", `lte.${to}T23:59:59`);

  const rows = await supabase.get(
    supabase.TABLES.noiseEvents,
    params.toString(),
    req.accessToken
  );
  res.json(rows);
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
  let rows = [];
  try {
    rows = await supabase.get(
      supabase.TABLES.auditLogs,
      "select=*,profiles:actor_id(full_name)&order=created_at.desc&limit=50",
      req.accessToken
    );
  } catch {
    rows = await supabase.get(
      supabase.TABLES.auditLogs,
      "select=*&order=created_at.desc&limit=50",
      req.accessToken
    );
  }

  res.json(
    rows.map((row) => ({
      ...row,
      actor_name: row.profiles?.full_name || null,
      profiles: undefined,
    }))
  );
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
  listClassrooms,
  listAuditLogs,
  createAuditLog,
  getSettings,
  updateSettings,
};
