function supabaseHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function restUrl(table, query = "") {
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return `${SUPABASE_URL}/rest/v1/${table}${q}`;
}

async function supabaseGet(table, query = "") {
  const res = await fetch(restUrl(table, query), { headers: supabaseHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table}: ${res.status} ${text}`);
  }
  return res.json();
}

async function supabasePost(table, body) {
  const res = await fetch(restUrl(table), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table}: ${res.status} ${text}`);
  }
  return res.json();
}

async function insertAuditLog(record) {
  return supabasePost(TABLES.auditLogs, record);
}

async function fetchNoiseEvents(options = {}) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");
  if (options.limit) params.set("limit", String(options.limit));

  if (options.room) params.set("room", `eq.${options.room}`);
  if (options.deviceId) params.set("device_id", `eq.${options.deviceId}`);
  if (options.severity) {
    params.set("warning_color", `eq.${options.severity.toUpperCase()}`);
  }
  if (options.audioOnly) {
    params.set("audio_recorded", "eq.true");
    params.set("audio_url", "not.is.null");
    params.set("warning_color", "eq.RED");
  }
  if (options.from) {
    params.set("created_at", `gte.${options.from}T00:00:00`);
  }
  if (options.to) {
    params.append("created_at", `lte.${options.to}T23:59:59`);
  }

  return supabaseGet(TABLES.noiseEvents, params.toString());
}

async function fetchClassrooms() {
  return supabaseGet(TABLES.classrooms, "select=*&order=name.asc");
}

async function fetchAuditLogs() {
  return supabaseGet(
    TABLES.auditLogs,
    "select=*&order=created_at.desc&limit=50"
  );
}
