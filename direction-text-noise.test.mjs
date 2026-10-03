/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-46：「方向對應不一致」不可以被排版雜訊觸發
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-29 查到的缺陷：`inspectHealth()` 的方向文字比對拿**原始的**字去
 * 數種類，於是「北上」「北 上」「北－上」被算成三種寫法，報成
 * 「方向對應不一致」。三種指的是同一個方向，差別純粹是排版雜訊。
 *
 * 而那一項的出路寫著「如果確認出來兩季真的是相反方向，那就要回去修正原始檔
 * 並重新匯入」——一個排版雜訊造成的假異常會把人導向去改廠商交來的原始檔。
 *
 * ⚠️ 這一支是**行為測試**：直接把 app.js 裡真的在跑的 inspectHealth() 抽出來，
 *   餵三種寫法進去，看它報幾項。不是比對原始碼字串。
 *
 * ⚠️ 兩邊都要驗（少任何一邊都只是半個守門）：
 *   ① 只差排版雜訊 → **不可以**報（這一條是本輪修的）。
 *   ② 真的是相反方位（北上／南下）→ **一定要**報（放寬過頭的反證）。
 *
 * 反證（2026-09-29 實際跑過）：把 `hit.keys.add(normalize(...))` 改回
 * `if (set.size > 1)`，第 ① 條立刻紅（報了 1 項）；把 keys 改成
 * 「整批都塞同一個常數」，第 ② 條立刻紅（一項都沒報）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFunction } from "./parse-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "app.js"), "utf8");
const periodDateSource = readFileSync(join(here, "period-date.js"), "utf8");
const directionPairSource = readFileSync(join(here, "direction-pair.js"), "utf8");

/**
 * app.js 裡每一個**最上層**的 `function 名稱(…) {…}`。
 *
 * ⚠️ 刻意不維護一份手寫的相依清單。
 *   `inspectHealth()` 的相依樹有十幾支，而手寫清單會在日後有人多加一個
 *   呼叫時變成「測試炸在 xxx is not defined」——那個紅看起來像程式壞了，
 *   其實是清單過期。整份抽進來就沒有這個問題。
 */
function topLevelFunctions(text) {
  const out = [];
  const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0;
    let started = false;
    let j = m.index;
    for (; j < text.length; j += 1) {
      if (text[j] === "{") {
        depth += 1;
        started = true;
      } else if (text[j] === "}") {
        depth -= 1;
        if (started && depth === 0) {
          j += 1;
          break;
        }
      }
    }
    out.push(text.slice(m.index, j));
  }
  return out;
}

const APP_FUNCTIONS = topLevelFunctions(appSource);

/**
 * 把 inspectHealth() 與它的相依抽進一個沙箱。
 *
 * ⚠️ 只 stub 三件與本測試無關的副作用（存檔、重繪、清孤兒確認），
 *   其餘一律用 app.js 裡真正那一份——否則測到的是測試自己寫的邏輯。
 *
 * ⚠️ `inspectHealth` 自己要在最後面覆蓋一次。
 *   它也在 APP_FUNCTIONS 裡，但重複宣告 function 在同一個 scope 裡
 *   是後者覆蓋前者，兩份都是同一段原始碼，所以不會有歧義。
 */
function healthSandbox(details) {
  const box = { console };
  box.window = box;
  box.self = box;
  box.globalThis = box;
  new Function("window", "self", "globalThis", periodDateSource).call(box, box, box, box);
  new Function("window", "self", "globalThis", directionPairSource).call(box, box, box, box);
  const state = {
    activeCode: "P1",
    projects: [{ code: "P1", name: "測試計畫" }],
    details,
    summaries: [],
    limits: {},
    limitConfirmed: {},
    aliases: {},
    roadMeta: {},
    speedVersions: {},
    surveyDateOverrides: {},
    issueAcks: {},
    imports: [],
    losRules: {},
    bands: {},
    directionNames: {},
  };
  const fn = new Function(
    "globalThis",
    "state",
    "LosRuleScope",
    "document",
    "localStorage",
    [
      "const judgeDirectionPair = globalThis.DirectionPair.judgeDirectionPair;",
      "const directionPairMessage = globalThis.DirectionPair.directionPairMessage;",
      "const roadMetaKey = (road, code = state.activeCode) => `${code}|${road}`;",
      "const readableDate = globalThis.PeriodDate.readableDate;",
      'const num = (v) => { if (v == null || String(v).trim() === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };',
      'const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d).replace(/\\.00$/, ""));',
      'const esc = (v) => String(v ?? "");',
      "const $ = () => null;",
      ...APP_FUNCTIONS,
      "function pruneOrphanAcks() {}",
      "function save() { return Promise.resolve(true); }",
      "function renderHealth() {}",
      extractFunction("inspectHealth", appSource),
      "return inspectHealth;",
    ].join("\n"),
  )(box, state, { periodIndex: (q) => String(q) }, null, null);
  return { run: fn, state };
}

/** 一筆最小可用的尖峰明細列。 */
function row(quarter, directionText, extra = {}) {
  return {
    id: `${quarter}|${directionText}|${extra.day ?? "平日"}|${extra.peak ?? "上午"}`,
    projectCode: "P1",
    road: "示範一路(甲街～乙街)",
    quarter,
    day: extra.day ?? "平日",
    peak: extra.peak ?? "上午",
    direction: extra.direction ?? 1,
    directionText,
    travelSpeed: 40,
    runSpeed: 45,
    delay: 10,
    los: "C",
  };
}

function directionIssues(details) {
  const { run } = healthSandbox(details);
  const issues = run() || [];
  return issues.filter((item) => item.code === "direction-mismatch");
}

test("前置：沙箱真的跑得起來，而且方向文字一致時一項都不報", () => {
  const issues = directionIssues([
    row("115Q1", "北上"),
    row("115Q2", "北上"),
  ]);
  assert.deepEqual(
    issues.map((x) => x.item),
    [],
    "同一種寫法就報異常，那是沙箱或判定本身壞了，不是本輪要驗的事",
  );
});

test("① 只差空白、全半形或破折號 → 不可以報「方向對應不一致」", () => {
  for (const variants of [
    ["北上", "北 上"],
    ["北上", "北－上"],
    ["北上", "北上"],
    ["往台北", "往　台北"],
    ["北上", "北 上", "北－上"],
  ]) {
    const issues = directionIssues(
      variants.map((text, index) => row(`115Q${index + 1}`, text)),
    );
    assert.deepEqual(
      issues.map((x) => x.detail),
      [],
      `「${variants.join("」「")}」只差排版雜訊，不該報成方向對應不一致`,
    );
  }
});

test("② 真的是相反方位或不同目的地 → 一定要報（放寬過頭的反證）", () => {
  for (const variants of [
    ["北上", "南下"],
    ["往台北", "往竹科"],
    ["北上", "北下"],
  ]) {
    const issues = directionIssues(
      variants.map((text, index) => row(`115Q${index + 1}`, text)),
    );
    assert.equal(
      issues.length,
      1,
      `「${variants.join("」「")}」是真的不一致，一定要報出來`,
    );
  }
});

test("③ 說明文字要列出**原始**的每一種寫法，不是正規化後的字", () => {
  const issues = directionIssues([
    row("115Q1", "北 上"),
    row("115Q2", "南下"),
  ]);
  assert.equal(issues.length, 1, "前置：這一組應該要報 1 項");
  const detail = issues[0].detail;
  assert.ok(
    detail.includes("北 上"),
    `說明裡要看得到原始寫法「北 上」（含那個空白），實際是：${detail}`,
  );
  assert.ok(
    detail.includes("南下"),
    `說明裡要看得到「南下」，實際是：${detail}`,
  );
});

test("④ 大小寫刻意不吸收：「A線」與「a線」視為不同", () => {
  const issues = directionIssues([
    row("115Q1", "A線"),
    row("115Q2", "a線"),
  ]);
  assert.equal(
    issues.length,
    1,
    "大小寫是內容不是排版雜訊（使用者 2026-09-11 對姊妹系統的裁示），要照樣報出來",
  );
});
