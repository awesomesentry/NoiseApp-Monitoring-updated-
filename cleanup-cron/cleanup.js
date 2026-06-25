// ============================================================
// Smart Classroom Noise Monitor - Cleanup Cron Script
// ============================================================
// Schedules daily cleanup of expired noise events via Supabase RPC.
// 
// Usage:
//   node cleanup.js           -- Runs as a persistent cron job (daily at 3 AM)
//   node cleanup.js --once    -- Runs the cleanup once and exits
//
// Environment:
//   Reads SUPABASE_URL and SUPABASE_ANON_KEY from ../.env
// ============================================================

const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const fetch = require("node-fetch");

// --- Load environment variables from parent .env ---
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    console.error("[ERROR] .env file not found at", envPath);
    console.error("Copy .env.example to .env and fill in your credentials.");
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.substring(0, eqIndex).trim();
    const value = trimmed.substring(eqIndex + 1).trim();
    if (key === "SUPABASE_URL" || key === "SUPABASE_ANON_KEY" || key === "SUPABASE_SERVICE_ROLE_KEY") {
      process.env[key] = value;
    }
  }
}

// --- Check if a key is valid (not a placeholder) ---
function isValidKey(key) {
  if (!key) return false;
  const invalidValues = ["your-service-role-key-here", "your-supabase-anon-key-here", "your-supabase-service-role-key-here"];
  return !invalidValues.includes(key.toLowerCase());
}

// --- Call the Supabase RPC function ---
async function cleanupExpiredEvents() {
  const supabaseUrl = process.env.SUPABASE_URL;
  // Use service_role key first (has full access), fall back to anon key
  // Use service_role key if valid, otherwise fall back to anon key
  const supabaseKey = isValidKey(process.env.SUPABASE_SERVICE_ROLE_KEY)
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("[ERROR] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be set in .env");
    return;
  }

  const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? "service_role" : "anon";
  const rpcUrl = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/delete_expired_noise_events`;

  console.log(`[${new Date().toISOString()}] Running cleanup (using ${keyType} key)...`);

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ERROR] Cleanup failed (${response.status}): ${errorText}`);
      return;
    }

    const deletedCount = await response.json();
    console.log(`[SUCCESS] Deleted ${deletedCount} expired noise event(s)`);
  } catch (err) {
    console.error("[ERROR] Cleanup request failed:", err.message);
  }
}

// --- Main ---
loadEnv();

const isOnce = process.argv.includes("--once");

if (isOnce) {
  // Run once and exit
  cleanupExpiredEvents().then(() => {
    console.log("Done. Exiting.");
    process.exit(0);
  });
} else {
  // Schedule daily at 3:00 AM
  const cronExpression = "0 3 * * *";
  console.log(`[CRON] Scheduling cleanup: "${cronExpression}" (daily at 3:00 AM)`);
  console.log(`[CRON] Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

  cron.schedule(cronExpression, () => {
    cleanupExpiredEvents();
  });

  // Run once on startup as well
  console.log("[CRON] Running initial cleanup on startup...");
  cleanupExpiredEvents();
}