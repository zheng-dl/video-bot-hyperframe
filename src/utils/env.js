import fs from "fs";
import path from "path";

export function loadEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sepIndex = trimmed.indexOf("=");
    if (sepIndex === -1) continue;

    const key = trimmed.substring(0, sepIndex).trim();
    const value = trimmed.substring(sepIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/**
 * Override API keys in LLM_PROVIDERS config with environment variables.
 */
export function applyEnvOverrides(systemConfig) {
  const providers = systemConfig.LLM_PROVIDERS || {};

  if (providers.gemini && process.env.GEMINI_API_KEY) {
    providers.gemini.api_key = process.env.GEMINI_API_KEY;
  }
  if (providers.deepseek && process.env.DEEPSEEK_API_KEY) {
    providers.deepseek.api_key = process.env.DEEPSEEK_API_KEY;
  }
  if (providers.gpt && (process.env.GPT_API_KEY || process.env.OPENAI_API_KEY)) {
    providers.gpt.api_key = process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
  }

  return systemConfig;
}
