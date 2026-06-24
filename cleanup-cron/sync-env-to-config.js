// ============================================================
// Sync .env values to js/config.js
// ============================================================
// This script generates js/config.js from .env for static hosting.
// The generated config.js should NOT be committed to version control.
//
// Usage:
//   node cleanup-cron/sync-env-to-config.js
//
// For deployment:
//   1. Ensure .env has correct values
//   2. Run this script
//   3. Deploy the generated js/config.js along with the rest of the site
// ============================================================

const fs = require("fs");
const path = require("path");

// Load .env
const envPath = path.join(__dirname, "..", ".env");
if (!fs.existsSync(envPath)) {
  console.error("[ERROR] .env not found at", envPath);
  console.error("[INFO] Copy .env.example to .env and fill in your values.");
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, "utf-8");
let supabaseUrl = "";
let supabaseAnonKey = "";

for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) continue;
  const eqIndex = trimmed.indexOf("=");
  if (eqIndex === -1) continue;
  const key = trimmed.substring(0, eqIndex).trim();
  const value = trimmed.substring(eqIndex + 1).trim();
  if (key === "SUPABASE_URL") supabaseUrl = value;
  if (key === "SUPABASE_ANON_KEY") supabaseAnonKey = value;
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[ERROR] SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env");
  process.exit(1);
}

// Validate URL format
try {
  new URL(supabaseUrl);
} catch {
  console.error("[ERROR] SUPABASE_URL is not a valid URL:", supabaseUrl);
  process.exit(1);
}

// Warn if using placeholder values
if (supabaseUrl.includes("your-project-id") || supabaseAnonKey.includes("your-supabase-anon-key")) {
  console.warn("[WARN] .env appears to contain placeholder values.");
  console.warn("[WARN] Please update .env with your actual Supabase credentials.");
}

// Read config.js
const configPath = path.join(__dirname, "..", "js", "config.js");
let configContent = fs.readFileSync(configPath, "utf-8");

// Replace values
configContent = configContent.replace(
  /let SUPABASE_URL = ".*?";/,
  `let SUPABASE_URL = "${supabaseUrl}";`
);

configContent = configContent.replace(
  /let SUPABASE_ANON_KEY =[\s\S]*?";/,
  `let SUPABASE_ANON_KEY =\n  "${supabaseAnonKey}";`
);

fs.writeFileSync(configPath, configContent, "utf-8");
console.log("[SUCCESS] js/config.js updated with values from .env");
console.log("[INFO] Remember: js/config.js is gitignored and should not be committed.");
console.log("[INFO] For deployment, run this script before uploading files.");
