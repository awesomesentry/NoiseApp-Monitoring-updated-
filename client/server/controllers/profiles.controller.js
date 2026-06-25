const supabase = require("../services/supabase.service");
const { asyncHandler } = require("../middleware/utils");

const listProfiles = asyncHandler(async (req, res) => {
  const rows = await supabase.get(
    supabase.TABLES.profiles,
    "select=*&order=full_name.asc",
    req.accessToken
  );
  res.json(rows);
});

const getProfile = asyncHandler(async (req, res) => {
  const profile = await supabase.getProfileById(req.params.id, req.accessToken);
  if (!profile) {
    return res.status(404).json({ error: "Profile not found" });
  }
  res.json(profile);
});

const upsertProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  const useServiceRole = !req.profile && updates.role;
  const result = await supabase.upsertProfile(
    id,
    updates,
    req.accessToken,
    useServiceRole && !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  res.json(result);
});

module.exports = { listProfiles, getProfile, upsertProfile };
