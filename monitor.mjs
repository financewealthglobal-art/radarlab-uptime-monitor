import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const readinessUrl = "https://web-production-bc2c91.up.railway.app/api/ready";
const appUrl = "https://web-production-bc2c91.up.railway.app";

export async function checkMonitor({ previous, save, fetchImpl, webhook, now = new Date() }) {
  const target = new URL(webhook);
  if (target.protocol !== "https:" || target.hostname !== "discord.com" ||
      !/^\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]+$/.test(target.pathname) ||
      target.username || target.password || target.search || target.hash)
    throw new Error("A dedicated Discord webhook must be configured privately.");
  let healthy = false;
  try {
    const response = await fetchImpl(readinessUrl, {
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    healthy = response.ok && (await response.json()).ready === true;
  } catch { /* A timeout, malformed response or refusal is an unavailable check. */ }

  const health = healthy ? "healthy" : "unavailable";
  if (previous?.health === health)
    return { health, delivery: previous.delivery, changed: false };
  const state = {
    health, checkedAt: now.toISOString(),
    transitionKey: `${health}:${now.toISOString()}`,
    delivery: !previous && healthy ? "not_needed" : "intent",
  };
  // Push the intent before contacting Discord. A later run never repeats an
  // uncertain send, including a runner crash after Discord accepted the message.
  await save(state);
  if (state.delivery === "not_needed") return { ...state, changed: true };

  const content = healthy
    ? `Radarlab is back. Its public readiness checks pass. ${appUrl}`
    : `Radarlab was unavailable in the latest external check. HQ pages and automation may be affected. Check the Railway web/worker deployment and database. ${appUrl}`;
  target.searchParams.set("wait", "true");
  let receipt = null;
  try {
    const response = await fetchImpl(target.href, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const message = await response.json();
      if (typeof message.id === "string" && /^\d{17,20}$/.test(message.id))
        receipt = createHash("sha256").update(message.id).digest("hex");
    }
  } catch { /* Do not retry an ambiguous external write. */ }
  const result = { ...state, delivery: receipt ? "confirmed" : "unknown", ...(receipt ? { receiptHash: receipt } : {}) };
  await save(result);
  return { ...result, changed: true };
}

async function main() {
  let previous = null;
  try { previous = JSON.parse(await readFile("state.json", "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const git = (...args) => execFileSync("git", args, { stdio: ["ignore", "ignore", "ignore"] });
  const save = async (state) => {
    await writeFile("state.json", JSON.stringify(state, null, 2) + "\n");
    git("add", "state.json");
    git("-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-m", `Record monitor ${state.health} ${state.delivery}`);
    git("push", "origin", "HEAD:main");
  };
  const result = await checkMonitor({ previous, save, fetchImpl: fetch, webhook: process.env.DISCORD_WEBHOOK_URL });
  console.log(JSON.stringify(result));
  if (result.delivery === "unknown" || result.delivery === "intent") process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error("Monitor paused. Review its last recorded intent before any manual retry. No secret or provider error is displayed."); process.exitCode = 1; });
