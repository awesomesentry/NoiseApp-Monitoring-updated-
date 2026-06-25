const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const env = require("./config/env");
const { attachUser } = require("./middleware/auth");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth.routes");
const profilesRoutes = require("./routes/profiles.routes");
const dataRoutes = require("./routes/data.routes");
const teachersRoutes = require("./routes/teachers.routes");
const cleanupRoutes = require("./routes/cleanup.routes");

const app = express();
const clientDir = path.join(__dirname, "..");
const isVercel = Boolean(process.env.VERCEL);

app.set("trust proxy", 1);

// Validate env on first request (allows Vercel to bundle the function at build time)
app.use((req, res, next) => {
  try {
    env.ensureEnv();
    next();
  } catch (err) {
    res.status(err.status || 503).json({ error: err.message });
  }
});

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(",").map((s) => s.trim()),
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

app.use(
  "/api",
  rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "noise-monitor-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/profiles", profilesRoutes);
app.use("/api", dataRoutes);
app.use("/api/teachers", teachersRoutes);
app.use("/api/cleanup", cleanupRoutes);

app.use(express.static(clientDir));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const filePath = path.join(clientDir, req.path);
  if (req.path.endsWith(".html") || !path.extname(req.path)) {
    const htmlFile = req.path.endsWith(".html")
      ? filePath
      : path.join(clientDir, "index.html");
    return res.sendFile(htmlFile, (err) => {
      if (err) next();
    });
  }
  next();
});

// JSON 404 for unknown API routes (avoid HTML fallback on /api/*)
app.use("/api", notFound);

app.use(notFound);
app.use(errorHandler);

if (require.main === module && !isVercel) {
  app.listen(env.port, () => {
    console.log(`Noise Monitor server running on http://localhost:${env.port}`);
  });
}

module.exports = app;
