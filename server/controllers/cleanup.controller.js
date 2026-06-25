const env = require("../config/env");
const supabase = require("../services/supabase.service");
const { asyncHandler } = require("../middleware/utils");

const cleanupExpired = asyncHandler(async (req, res) => {
  if (env.cleanupApiKey) {
    const key = req.headers["x-cleanup-key"];
    if (key !== env.cleanupApiKey) {
      return res.status(401).json({ error: "Invalid cleanup API key" });
    }
  } else if (!req.profile || req.profile.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  const useServiceRole = !!env.supabaseServiceRoleKey;
  const result = await supabase.rpc("delete_expired_noise_events", {}, useServiceRole);
  res.json({ ok: true, result });
});

module.exports = { cleanupExpired };
