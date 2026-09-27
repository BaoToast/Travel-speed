/*
 * ══════════════════════════════════════════════════════════════════════
 *  三件 2026-09-25 修正的行為反證
 * ══════════════════════════════════════════════════════════════════════
 *
 * ① effectiveSurveyDate()：候選只有一個日期時，「覆寫必須是候選之一」
 *    這道守衛原本整段被跳過（surveyDateCandidates 是 undefined →
 *    Array.isArray(undefined) 為 false），於是畫面會顯示一個
 *    **原始檔上已經不存在的日期**，而異常檢查也不會列出來。
 *
 * ② 結論草稿的 sameSlot / uniqueDirections：原本用「使用者取的顯示名稱」
 *    判斷兩季是不是同一個方向。兩個方向撞名時，
 *    「兩季最差的時段／方向不同」這句警語會被整句吞掉。
 *
 * ③ speedRatio()：速限是 0／undefined／空白時要回 null（算不出來），
 *    不可以算出 NaN——losOf(NaN) 回「?」，整條路段的服務水準
 *    會安靜變成「?」而 toast 只說「已修正並合併」。
 *
 * ⚠️ 三條都是**行為測試**。反證做法寫在各段裡，都已實驗過（2026-09-25）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFunction } from "./parse-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "app.js"), "utf8");

/* ────────────────────────────────────────────────────────────────────
 *  ① effectiveSurveyDate()
 * ──────────────────────────────────────────────────────────────────── */
function surveyDateSandbox(overrides) {
  return new Function(
    "state",
    [
      extractFunction("surveyDateScopeKey", appSource),
      extractFunction("effectiveSurveyDate", appSource),
      "return { effectiveSurveyDate };",
    ].join("\n"),
  )({ activeCode: "P1", surveyDateOverrides: { P1: overrides } });
}

const ROW_KEY = "115Q1|甲路.xlsx";

test("① 有多個候選時，覆寫值是候選之一 → 採用", () => {
  const { effectiveSurveyDate } = surveyDateSandbox({
    [ROW_KEY]: "2026-05-08",
  });
  assert.equal(
    effectiveSurveyDate({
      period: "115Q1",
      source: "甲路.xlsx",
      surveyDate: "2026-05-01",
      surveyDateCandidates: ["2026-05-01", "2026-05-08"],
    }),
    "2026-05-08",
    "使用者指定的日期在候選裡，應該採用",
  );
});

test("① 有多個候選、但覆寫值不在候選裡 → 退回系統判讀值", () => {
  const { effectiveSurveyDate } = surveyDateSandbox({
    [ROW_KEY]: "2026-12-31",
  });
  assert.equal(
    effectiveSurveyDate({
      period: "115Q1",
      source: "甲路.xlsx",
      surveyDate: "2026-05-01",
      surveyDateCandidates: ["2026-05-01", "2026-05-08"],
    }),
    "2026-05-01",
    "覆寫值不在候選裡卻被採用了——那會顯示原始檔上沒有的日期",
  );
});

test("① 候選是 undefined（只讀到一個日期）且覆寫值與它不同 → 必須退回系統判讀值", () => {
  /*
   * ⚠️ 這就是 2026-09-25 修好的那一個。
   *   舊寫法 `Array.isArray(candidates) && …` 在 candidates 為 undefined 時
   *   整段跳過，於是回傳 2026-05-08——那個日期在目前的原始檔裡已經不存在。
   *
   *   真實動線：第一次匯入讀到兩個日期、使用者挑了 05-08；
   *   之後把原始檔上多餘的日期刪掉、用同檔名同季別重新匯入
   *  （覆寫鍵是 `季別|檔名`，重匯不清覆寫）→ 新明細只有 05-01、
   *   candidates 變 undefined → 畫面卻還寫 05-08，而異常檢查因為
   *   候選少於 2 個也不再列出，使用者沒有任何線索。
   *
   * 反證：把 app.js 的守衛改回
   *   `if (Array.isArray(candidates) && candidates.length && !candidates.includes(picked)) return row.surveyDate || "";`
   * 這一條就會紅。
   */
  const { effectiveSurveyDate } = surveyDateSandbox({
    [ROW_KEY]: "2026-05-08",
  });
  assert.equal(
    effectiveSurveyDate({
      period: "115Q1",
      source: "甲路.xlsx",
      surveyDate: "2026-05-01",
      /* 只有一個日期時這一欄不會被寫出來 */
    }),
    "2026-05-01",
    "候選是 undefined 時守衛被跳過了——畫面會顯示原始檔上不存在的日期",
  );
});

test("① 候選是 undefined、但覆寫值剛好等於系統判讀值 → 採用（不可以修過頭）", () => {
  const { effectiveSurveyDate } = surveyDateSandbox({
    [ROW_KEY]: "2026-05-01",
  });
  assert.equal(
    effectiveSurveyDate({
      period: "115Q1",
      source: "甲路.xlsx",
      surveyDate: "2026-05-01",
    }),
    "2026-05-01",
    "覆寫值與判讀值相同時不該被當成不合法",
  );
});

test("① 沒有覆寫時一律用系統判讀值", () => {
  const { effectiveSurveyDate } = surveyDateSandbox({});
  assert.equal(
    effectiveSurveyDate({
      period: "115Q1",
      source: "甲路.xlsx",
      surveyDate: "2026-05-01",
    }),
    "2026-05-01",
  );
});

/* ────────────────────────────────────────────────────────────────────
 *  ② 結論草稿：方向的同一性要比鍵值，不是顯示名稱
 * ──────────────────────────────────────────────────────────────────── */
function loadConclusion() {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  new Function(
    "globalThis",
    "window",
    "module",
    readFileSync(join(here, "conclusion.js"), "utf8"),
  )(sandbox, sandbox, undefined);
  return sandbox;
}
const box = loadConclusion();

const META = {
  projectName: "測試計畫",
  systemVersion: "v0",
  generatedAt: "2026-09-25",
  bandsOf: () => ({ smoothEnd: "B", congestedStart: "E" }),
  worstOf: (rows) => rows[0],
};

function row(extra) {
  return {
    projectCode: "P1",
    road: "甲路",
    day: "平日",
    peak: "上午尖峰",
    travel: 30,
    running: 32,
    totalDelay: 100,
    limit: 50,
    ratio: 0.6,
    los: "D",
    ...extra,
  };
}

test("② 兩季最差的方向不同、但兩個方向撞名時，警語仍然要寫出來", () => {
  /*
   * ⚠️ 舊寫法用 dirLabel()（顯示名稱）比，撞名時 sameSlot 誤判為 true，
   *   「（代表紀錄，兩季最差的時段／方向不同）」整句被吞掉。
   *   程式不擋兩個方向取同名，所以這是使用者做得到的事。
   *
   * 反證：把 conclusion.js 的 sameSlot 改回
   *   `first.peak === last.peak && dirLabel(first) === dirLabel(last)`
   * 這一條就會紅。
   */
  const condition = {
    ...box.SPEED_DEFAULT_CONDITION,
    scope: { kind: "project" },
    metrics: ["growth"],
    grouping: "byRoad",
    digits: 1,
    rowLevel: "representative",
  };
  const text = String(
    box.buildSpeedConclusion(
      [
        row({
          period: "115Q1",
          year: 115,
          quarter: 1,
          direction: "方向1",
          directionLabel: "往台北",
        }),
        row({
          period: "115Q2",
          year: 115,
          quarter: 2,
          direction: "方向2",
          directionLabel: "往台北",
          travel: 20,
          los: "E",
        }),
      ],
      condition,
      META,
    ),
  );
  assert.match(
    text,
    /兩季最差的時段／方向不同/,
    "兩個方向的顯示名稱相同時，警語被吞掉了——" +
      `方向的同一性要比鍵值（方向1／方向2），不是使用者取的名稱。\n${text}`,
  );
});

test("② 真的是同一個方向時不可以多寫那句警語（不可以修過頭）", () => {
  const condition = {
    ...box.SPEED_DEFAULT_CONDITION,
    scope: { kind: "project" },
    metrics: ["growth"],
    grouping: "byRoad",
    digits: 1,
    rowLevel: "representative",
  };
  const text = String(
    box.buildSpeedConclusion(
      [
        row({
          period: "115Q1",
          year: 115,
          quarter: 1,
          direction: "方向1",
          directionLabel: "往台北",
        }),
        row({
          period: "115Q2",
          year: 115,
          quarter: 2,
          direction: "方向1",
          directionLabel: "往台北",
          travel: 36,
        }),
      ],
      condition,
      META,
    ),
  );
  assert.ok(
    !/兩季最差的時段／方向不同/.test(text),
    `兩季本來就是同一個方向，不該寫那句警語：\n${text}`,
  );
});

/* ────────────────────────────────────────────────────────────────────
 *  ③ speedRatio()：速限算不出來時回 null，不可以產生 NaN
 * ──────────────────────────────────────────────────────────────────── */
const speedRatio = new Function(
  [
    extractFunction("hasNumericValue", appSource),
    extractFunction("speedRatio", appSource),
    "return speedRatio;",
  ].join("\n"),
)();

test("③ 速限讀不到或是 0 時，速限比要回 null（不是 NaN）", () => {
  for (const limit of [undefined, null, 0, "", " ", [], false, "abc"])
    assert.equal(
      speedRatio(30, limit),
      null,
      `速限是 ${JSON.stringify(limit)} 時算出了值——` +
        `NaN 會讓 losOf() 回「?」，整條路段的服務水準安靜變成「?」`,
    );
});

test("③ 旅行速率讀不到時也回 null（不可以折成 0）", () => {
  for (const travel of [undefined, null, "", " ", [], false, "abc"])
    assert.equal(
      speedRatio(travel, 50),
      null,
      `旅行速率是 ${JSON.stringify(travel)} 時算出了值——` +
        `0 km/h 的意思是完全動不了，會被讀報告的人當成最嚴重的壅塞`,
    );
});

test("③ 兩邊都讀得到時要算得出正確的速限比", () => {
  assert.equal(speedRatio(30, 50), 0.6);
  assert.equal(speedRatio("30", "50"), 0.6, "數字字串也要算");
  assert.equal(speedRatio(0, 50), 0, "真的量到 0 要算出 0（這與缺值不同）");
});

test("③ 兩處 ratio 計算都必須走 speedRatio()", () => {
  /*
   * ⚠️ 這一條在防「只改一處」。原本有三個地方各自寫
   *   `d.travel == null ? null : d.travel / d.limit`，
   *   其中「備份後修正明顯日期尾碼」那一處的 d.limit 來源少了 `|| 50`。
   */
  const uses = [...appSource.matchAll(/speedRatio\(d\.travel, d\.limit\)/g)];
  assert.ok(
    uses.length >= 2,
    `只有 ${uses.length} 處走 speedRatio()——應該至少兩處（速限確認與日期尾碼修正）`,
  );
  assert.ok(
    !/d\.ratio = d\.travel == null \? null : d\.travel \/ d\.limit/.test(
      appSource,
    ),
    "還有地方在用舊的 ratio 算法（沒擋速限為 falsy）",
  );
});
