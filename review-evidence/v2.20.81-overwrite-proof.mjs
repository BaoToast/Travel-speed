// GPT independent proof: real commit handler up to its first write.
// Run: node review-evidence/v2.20.81-overwrite-proof.mjs
// Side effects and date display are stubbed; this is not a browser-import test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("app.js", root), "utf8");
await import(new URL("period-date.js", root));
const marker = '$("commit").onclick = async () => {';
const start = source.indexOf(marker);
const end = source.indexOf("  upsert(write);", start);
assert.ok(start >= 0 && end > start, "actual handler markers must exist");
const body = source.slice(start + marker.length, end) + "upsert(write);";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function run({ accept = false, policy = "overwrite", oldDate = "2026-01-14",
  newDate = "2026-01-20", mixed = false, bypass = false, prefix = 0 } = {}) {
  const old = { id: "P|115|Q1|A|平日|上午尖峰|方向1", surveyDate: oldDate,
    travel: 20, period: "115Q1", road: "A" };
  const row = { ...old, surveyDate: newDate, travel: 30 };
  const unchanged = Array.from({ length: prefix }, (_, i) => ({ ...old, id: "same" + i }));
  const state = { activeCode: "P", details: [...unchanged, old] };
  const baseline = JSON.stringify(state);
  let writes = 0;
  const dialogs = [];
  const notices = [];
  const fn = new AsyncFunction("pendingContext", "state", "pending", "remapPending",
    "sourceConflictPrompt", "pendingPeriodChecks", "pendingMixedPeriodBlock", "$",
    "effectiveSurveyDate", "confirm", "toast", "upsert",
    bypass ? body.replace("if (unique.length) {", "if (false) {") : body);
  await fn({ projectCode: "P", year: 115, quarter: 1 }, state,
    [{ ok: true, file: "anonymous.xlsx", rows: [...unchanged, row] }],
    () => {}, () => "", [], () => mixed ? "blocked" : "", () => ({ value: policy }),
    r => r.surveyDate, m => { dialogs.push(m); return accept; }, m => notices.push(m),
    rows => { writes++; state.details = rows; });
  return { writes, dialogs, notices, unchanged: baseline === JSON.stringify(state) };
}
const cancelled = await run();
assert.equal(cancelled.writes, 0);
assert.equal(cancelled.unchanged, true);
assert.equal(cancelled.dialogs.length, 1);
assert.equal((await run({ accept: true })).writes, 1);
assert.equal((await run({ newDate: "2026-01-14" })).dialogs.length, 0);
assert.equal((await run({ oldDate: "" })).dialogs.length, 0);
assert.equal((await run({ policy: "skip" })).dialogs.length, 0);
const late = await run({ prefix: 12 });
assert.equal(late.writes, 0);
assert.match(late.dialogs[0], /2026-01-20/);
const mixed = await run({ mixed: true });
assert.equal(mixed.writes, 0);
assert.equal(mixed.dialogs.length, 0);
const broken = await run({ bypass: true });
assert.equal(broken.writes, 1);
assert.equal(broken.unchanged, false);
console.log("PASS: cancellation, acceptance, same/unknown dates, skip policy, late conflict, mixed batch; bypass negative proof overwrites.");
