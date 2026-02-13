import fs from "fs";
import path from "path";

const cwd = process.cwd();
const mode = process.env.MODE || process.env.NODE_ENV || "production";
const skip = process.env.SKIP_ENV_CHECK === "true";

if (skip) {
  process.exit(0);
}

const files = [
  ".env",
  ".env.local",
  `.env.${mode}`,
  `.env.${mode}.local`,
];

function parseEnvFile(filePath) {
  const env = {};
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cleaned = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const eq = cleaned.indexOf("=");
    if (eq === -1) continue;
    const key = cleaned.slice(0, eq).trim();
    let value = cleaned.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

let merged = {};
for (const file of files) {
  const fullPath = path.join(cwd, file);
  if (fs.existsSync(fullPath)) {
    merged = { ...merged, ...parseEnvFile(fullPath) };
  }
}

merged = { ...merged, ...process.env };

const required = ["VITE_API_URL"];
const missing = required.filter((key) => !merged[key] || String(merged[key]).trim() === "");

const paypalEnabled = String(merged.VITE_PAYPAL_ENABLED || "").toLowerCase() === "true";
if (paypalEnabled) {
  if (!merged.VITE_PAYPAL_CLIENT_ID || String(merged.VITE_PAYPAL_CLIENT_ID).trim() === "") {
    missing.push("VITE_PAYPAL_CLIENT_ID");
  }
}

if (missing.length > 0) {
  console.error(`[env-check] Missing required env vars for build (${mode}): ${missing.join(", ")}`);
  process.exit(1);
}
