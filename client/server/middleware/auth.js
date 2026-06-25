const { getUser, getProfileById } = require("../services/supabase.service");
const { getBearerToken } = require("./utils");

async function attachUser(req, _res, next) {
  const token = getBearerToken(req);
  req.accessToken = token;
  if (!token) {
    req.user = null;
    req.profile = null;
    return next();
  }
  try {
    const user = await getUser(token);
    req.user = user;
    if (user?.id) {
      req.profile = await getProfileById(user.id, token);
    }
  } catch {
    req.user = null;
    req.profile = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.accessToken || !req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.profile || req.profile.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function requireTeacher(req, res, next) {
  if (!req.profile || req.profile.role !== "teacher") {
    return res.status(403).json({ error: "Teacher access required" });
  }
  next();
}

module.exports = {
  attachUser,
  requireAuth,
  requireAdmin,
  requireTeacher,
};
