#!/usr/bin/env node

// ============================================================
// Build Script for Static Site
// ============================================================
// This script prepares the static site for deployment by:
// 1. Syncing .env values to js/config.js
// 2. Validating configuration
// 3. Reporting deployment readiness
//
// Usage:
//   node build.js
// ============================================================

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("============================================================");
console.log("Building Smart Classroom Noise Monitor");
console.log("============================================================");
console.log("");

// Step 1: Run the sync script
console.log("[1/3] Syncing environment variables to config...");
try {
  execSync("node cleanup-cron/sync-env-to-config.js", { stdio: "inherit" });
  console.log("");
} catch (error) {
  console.error("");
  console.error("[FATAL] Failed to sync environment variables.");
  console.error("[FATAL] Ensure .env file exists and contains valid values.");
  process.exit(1);
}

// Step 2: Verify config.js was generated
console.log("[2/3] Verifying generated configuration...");
const configPath = path.join(__dirname, "js", "config.js");
if (!fs.existsSync(configPath)) {
  console.error("[FATAL] js/config.js not found after sync.");
  process.exit(1);
}

const configContent = fs.readFileSync(configPath, "utf-8");
const hasPlaceholder = configContent.includes("your-project-id") || 
                       configContent.includes("your-supabase-anon-key");

if (hasPlaceholder) {
  console.error("[FATAL] js/config.js still contains placeholder values.");
  console.error("[FATAL] Please update .env with your actual Supabase credentials.");
  process.exit(1);
}

console.log("[SUCCESS] Configuration verified.");
console.log("");

// Step 3: Summary
console.log("[3/3] Build summary:");
console.log("------------------------------------------------------------");
console.log("  Source files:  Ready for deployment");
console.log("  Config:       js/config.js (generated, gitignored)");
console.log("  .env:         Local only (gitignored)");
console.log("------------------------------------------------------------");
console.log("");
console.log("Next steps:");
console.log("  1. Upload all files to your static host (Netlify, Vercel, etc.)");
console.log("  2. Ensure js/config.js is included in the upload");
console.log("  3. Test the deployed site");
console.log("");
console.log("============================================================");
console.log("Build complete!");
console.log("============================================================");