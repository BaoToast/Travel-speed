/*
 * ══════════════════════════════════════════════════════════════════════
 *  「先擋型別再轉數字」——五個副本的行為反證（2026-09-25 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼要有這一支：
 *
 * 2026-09-24 的獨立複查發現，`conclusion.js` 的 `isNum()`、`trend.js` 的
 * `isNum()`、`trend-excel.js` 的 `numCell()`、`app.js` 的 `losOf()` 與
 * 平假日柱狀圖，五處都只排掉 `null`／`undefined`／`""` 就去 `Number()`。
 * 而 JavaScript 的 Number() 對下面這些都給得出「看起來正常」的數字：
 *
 *     Number(" ")  === 0      Number("\t")  === 0
 *     Number([])   === 0      Number(false) === 0
 *     Number(true) === 1
 *
 * 於是「讀不到」被寫成「確實量到 0」：旅行速率 0 km/h 的意思是完全動不了，
 * 那是最嚴重的壅塞；服務水準會從「?」變成「F」；Excel 會出現一個實心的 0。
 *
 * ⚠️ 這一支**故意寫成行為測試，不是掃原始碼字串**。
 *   舊的守門（draft-key-and-missing.test.mjs）就是掃字串，
 *   而它掃到的是另一處無關的 `c.digits` 型別守衛，於是
 *   `isNum()` 破著也照樣全綠——那顆假的綠正是這個缺陷活下來的原因。
 *
 * ⚠️ 反證怎麼做：把任何一處的判斷改回
 *   `value != null && value !== "" && isFinite(Number(value))`，
 *   這一支就會紅。已驗過（2026-09-25）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFunction } from "./parse-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8");

/** 五處都必須判成「沒有數值」的輸入。 */
const NOT_A_VALUE = [
  [" ", "半形空白"],
  ["\t", "tab"],
  ["   ", "多個空白"],
  [[], "空陣列"],
  [false, "布林 false"],
  [true, "布林 true（Number(true) 是 1，會變成一個憑空的 1）"],
  [null, "null"],
  [undefined, "undefined"],
  ["", "空字串"],
  ["abc", "不是數字的字串"],
];

/** 五處都必須判成「有數值」的輸入（不可以修過頭）。 */
const IS_A_VALUE = [
  [0, "數字 0（真的量到 0 是合法的）"],
  [32.5, "一般數值"],
  ["32.5", "數字字串（舊範本常存成字串）"],
  [" 32.5 ", "前後有空白的數字字串"],
  [-1, "負數（合法與否由呼叫端判斷，不是這裡）"],
];

function loadModule(name, globalKey) {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  new Function("globalThis", "window", "module", read(name))(
    sandbox,
    sandbox,
    undefined,
  );
  const api = sandbox[globalKey];
  assert.ok(api, `${name} 沒有掛上 globalThis.${globalKey}`);
  return { sandbox, api };
}

/* ────────────────────────────────────────────────────────────────────
 *  ① app.js 的 hasNumericValue（losOf 與平假日柱狀圖共用的那一支）
 * ──────────────────────────────────────────────────────────────────── */
const appSource = read("app.js");
const hasNumericValue = new Function(
  extractFunction("hasNumericValue", appSource) + "\nreturn hasNumericValue;",
)();

test("app.js hasNumericValue()：空白字串、陣列、布林都不算有數值", () => {
  for (const [value, why] of NOT_A_VALUE)
    assert.equal(
      hasNumericValue(value),
      false,
      `${why}（${JSON.stringify(value)}）被當成有數值了；Number() 會給出 ${Number(value)}`,
    );
});

test("app.js hasNumericValue()：真正的數值仍然算有數值（不可以修過頭）", () => {
  for (const [value, why] of IS_A_VALUE)
    assert.equal(
      hasNumericValue(value),
      true,
      `${why}（${JSON.stringify(value)}）被誤判成沒有數值`,
    );
});

/* ────────────────────────────────────────────────────────────────────
 *  ② losOf()：缺值要回「?」，不可以落到最差等級 F
 * ──────────────────────────────────────────────────────────────────── */
const losSandbox = new Function(
  "state",
  [
    "const DEFAULT_LOS_RULE = { A: 0.8, B: 0.6, C: 0.5, D: 0.4, E: 0.2 };",
    extractFunction("hasNumericValue", appSource),
    extractFunction("rulesFor", appSource),
    extractFunction("losOf", appSource),
    "return { losOf };",
  ].join("\n"),
)({ losRules: {}, activeCode: "P1" });

test("losOf()：讀不到速限比時回「?」，不是 F", () => {
  for (const [value, why] of NOT_A_VALUE) {
    const got = losSandbox.losOf(value);
    assert.equal(
      got,
      "?",
      `${why}（${JSON.stringify(value)}）被判成「${got}」。` +
        `Number() 是 ${Number(value)}，通不過任何一道門檻就會落到最差等級——` +
        `而 losOf 上面那段註解的存在理由正是「缺值不可以被判成 F」。`,
    );
  }
});

test("losOf()：真的量到的速限比仍然判得出等級", () => {
  assert.equal(losSandbox.losOf(0.9), "A", "0.9 應該是 A");
  assert.equal(losSandbox.losOf("0.9"), "A", "字串 \"0.9\" 也要判成 A");
  assert.equal(losSandbox.losOf(0.1), "F", "0.1 真的就是 F");
  assert.equal(losSandbox.losOf(0), "F", "真的量到 0 就是 F（這與缺值不同）");
});

/* ────────────────────────────────────────────────────────────────────
 *  ③ conclusion.js 的 isNum()：草稿要印「—」，不是 0.0
 * ──────────────────────────────────────────────────────────────────── */
const { sandbox: conclusionBox } = loadModule(
  "conclusion.js",
  "buildSpeedConclusion",
);
const isNumFromConclusion = new Function(
  extractFunction("isNum", read("conclusion.js")) + "\nreturn isNum;",
)();

test("conclusion.js isNum()：與 hasNumericValue 判得完全一樣（判準不可以漂移）", () => {
  for (const [value, why] of [...NOT_A_VALUE, ...IS_A_VALUE])
    assert.equal(
      isNumFromConclusion(value),
      hasNumericValue(value),
      `${why}（${JSON.stringify(value)}）在 conclusion.js 與 app.js 判得不一樣——` +
        `同一個判準的兩個副本漂移了`,
    );
});

const SPEED_META = {
  projectName: "測試計畫",
  systemVersion: "v0",
  generatedAt: "2026-09-25",
  bandsOf: () => ({ smoothEnd: "B", congestedStart: "E" }),
  worstOf: (rows) => rows[0],
};

function speedRow(extra) {
  return {
    projectCode: "P1",
    road: "測試路段",
    day: "平日",
    period: "115Q1",
    year: 115,
    quarter: 1,
    peak: "上午尖峰",
    direction: "方向1",
    travel: 30,
    running: 32,
    totalDelay: 100,
    limit: 50,
    ratio: 0.6,
    los: "C",
    ...extra,
  };
}

test("結論草稿：旅行速率是空白字串時要寫「—」，不可以寫 0.0", () => {
  const condition = {
    ...conclusionBox.SPEED_DEFAULT_CONDITION,
    scope: { kind: "project" },
    metrics: ["travel"],
    grouping: "overall",
    digits: 1,
  };
  for (const blank of [" ", "\t", [], false]) {
    const text = String(
      conclusionBox.buildSpeedConclusion(
        [speedRow({ travel: blank })],
        condition,
        SPEED_META,
      ),
    );
    assert.ok(
      /旅行速率 —/.test(text),
      `travel=${JSON.stringify(blank)} 時草稿應該寫「旅行速率 —」，實際是：\n${text}`,
    );
    assert.ok(
      !/旅行速率 0\.0/.test(text),
      `travel=${JSON.stringify(blank)} 時草稿寫出了「旅行速率 0.0」——` +
        `0 km/h 的意思是完全動不了，會被讀報告的人當成最嚴重的壅塞。\n${text}`,
    );
  }
});

test("結論草稿：基期是空白字串時不可以寫「由 0 增為」", () => {
  const condition = {
    ...conclusionBox.SPEED_DEFAULT_CONDITION,
    scope: { kind: "project" },
    metrics: ["growth"],
    grouping: "byRoad",
    digits: 1,
  };
  const text = String(
    conclusionBox.buildSpeedConclusion(
      [
        speedRow({ period: "115Q1", year: 115, quarter: 1, travel: " " }),
        speedRow({ period: "115Q2", year: 115, quarter: 2, travel: 36 }),
      ],
      condition,
      SPEED_META,
    ),
  );
  assert.ok(
    !/由 0 /.test(text),
    `基期讀不到時寫出了「由 0 …」，那是憑空造出來的結論：\n${text}`,
  );
});

/* ────────────────────────────────────────────────────────────────────
 *  ④ trend.js 的 isNum()
 * ──────────────────────────────────────────────────────────────────── */
const isNumFromTrend = new Function(
  extractFunction("isNum", read("trend.js")) + "\nreturn isNum;",
)();

test("trend.js isNum()：與 hasNumericValue 判得完全一樣", () => {
  for (const [value, why] of [...NOT_A_VALUE, ...IS_A_VALUE])
    assert.equal(
      isNumFromTrend(value),
      hasNumericValue(value),
      `${why}（${JSON.stringify(value)}）在 trend.js 與 app.js 判得不一樣`,
    );
});

/* ────────────────────────────────────────────────────────────────────
 *  ⑤ trend-excel.js 的 numCell()：缺值要留空白格，不是 0
 * ──────────────────────────────────────────────────────────────────── */
test("trend-excel.js numCell()：缺值輸出空字串（Excel 上留白），不是 <v>0</v>", () => {
  const numCell = new Function(
    "const xml = (s) => String(s);\n" +
      read("trend-excel.js").match(
        /const numCell = \(ref, value, style = 3\) => \{[\s\S]*?\n  \};/,
      )[0] +
      "\nreturn numCell;",
  )();
  for (const [value, why] of NOT_A_VALUE)
    assert.equal(
      numCell("A1", value),
      "",
      `${why}（${JSON.stringify(value)}）在 Excel 裡寫成了一格實心的數字——` +
        `交出去的報表看不出那一格其實讀不到`,
    );
  assert.match(numCell("A1", 0), /<v>0<\/v>/, "真的量到 0 要寫出來");
  assert.match(numCell("A1", "32.5"), /<v>32\.5<\/v>/, "數字字串要寫出來");
});

/* ────────────────────────────────────────────────────────────────────
 *  ⑥ 跨檔：五個副本都必須是「先擋型別再轉數字」
 * ──────────────────────────────────────────────────────────────────── */
test("⚠️ 五處判準必須同時存在：任何一處改回舊寫法，這一條會紅", () => {
  /*
   * ⚠️ 這一條**不是**用來取代上面的行為測試，而是補上「行為測試抓不到的
   *   第五處」（trend-excel 的 numCell 已有行為測試；平假日柱狀圖埋在
   *   樣板字串裡，只能從原始碼確認它走的是 hasNumericValue）。
   *   單獨這一條沒有保護力——上面 ①～⑤ 才是。
   */
  const barChart = appSource.match(
    /hasW = w != null && hasNumericValue\(w\.travel\)/,
  );
  assert.ok(
    barChart,
    "平假日柱狀圖的 hasW 沒有走 hasNumericValue()——" +
      "空白字串會讓柱高變 0 並標「0.0」，而那一段註解說缺值要留白",
  );
  assert.match(
    appSource,
    /hasH = h != null && hasNumericValue\(h\.travel\)/,
    "假日那一根柱子也要走 hasNumericValue()",
  );
});
