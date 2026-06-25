const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function validateEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

module.exports = {
  validateEnv,
  port: Number(getEnv("PORT", "3000")),
  nodeEnv: getEnv("NODE_ENV", "development"),
  supabaseUrl: getEnv("SUPABASE_URL"),
  supabaseAnonKey: getEnv("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  corsOrigin: getEnv("CORS_ORIGIN", "*"),
  cleanupApiKey: getEnv("CLEANUP_API_KEY"),
  rateLimitWindowMs: Number(getEnv("RATE_LIMIT_WINDOW_MS", "900000")),
  rateLimitMax: Number(getEnv("RATE_LIMIT_MAX", "200")),
};
