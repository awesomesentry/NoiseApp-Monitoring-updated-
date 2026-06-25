const supabase = require("../services/supabase.service");
const { asyncHandler } = require("../middleware/utils");

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const data = await supabase.signIn(String(email).trim().toLowerCase(), password);
  res.json(data);
});

const signup = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  const data = await supabase.signUp(String(email).trim().toLowerCase(), password);
  res.status(201).json(data);
});

const logout = asyncHandler(async (req, res) => {
  if (!req.accessToken) {
    return res.status(400).json({ error: "No token provided" });
  }
  await supabase.signOut(req.accessToken);
  res.json({ ok: true });
});

const me = asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ user: req.user, profile: req.profile });
});

const updatePassword = asyncHandler(async (req, res) => {
  const { password } = req.body || {};
  if (!req.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  await supabase.updateUserPassword(req.accessToken, String(password));
  res.json({ ok: true });
});

module.exports = { login, signup, logout, me, updatePassword };
