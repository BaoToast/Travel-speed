/*
 * ══════════════════════════════════════════════════════════════════════
 *  結論草稿產生器：全條件覆蓋盤點（使用者 2026-09-23 指定）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者的話（這一支存在的理由）：
 *   「因為圖表很多，使用者更多是依賴結論草稿產生器，所以針對結論草稿產生器
 *     以及報表草稿產生器，**功能正常運作等同於數值正確性一樣重要**」
 *   「只要程式查的到的數值，結論草稿產生器應該都能讓使用者勾選對應條件後，
 *     產出正確的數值，不要再出現如同我上次在路口轉向系統，找不到我要的結果」
 *
 * ── 這一支在防哪幾種缺陷（都在姊妹專案上真的發生過）──────────────
 *
 *   ① **勾了卻什麼都沒寫**（指標接在空的地方，勾了永遠沒數字）
 *   ② **抬頭說有篩、內容沒篩**（篩選條件對某一個指標無效）
 *   ③ **選項之間互相吃掉**（一起勾的時候少了幾項）
 *
 * ── 為什麼要用「矩陣」而不是逐項寫測試 ──────────────────────────
 *
 *   這幾種缺陷都是**單獨勾都對、組合起來才出事**，而它們能活下來，
 *   正是因為測試是一項一項手寫的——沒有人會想到去寫那個組合。
 *   這裡改成把每一個指標跑一遍，由程式回報哪一格是空的；
 *   新增指標時矩陣會自動把它算進去。
 *
 * ⚠️ 判定一律用**該指標特有的字樣**，不是「草稿不是空的」——
 *   出事的草稿本來就不是空的。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  SPEED_CONCLUSION_METRICS,
  SPEED_DEFAULT_CONDITION,
  buildSpeedConclusion,
} = require("./conclusion.js");

const META = {
  projectName: "測試計畫",
  systemVersion: "v2.20.71",
  generatedAt: "2026-09-23 10:00",
  /*
   * ⚠️ 三段分法的分界一定要給。
   *   不給的話 `describeBandShare()` 會退回
   *     「讀不到三段分界設定，這一項沒有寫出來（請回報這個情形）」
   *   ——那是**誠實的**，但拿它當「bandShare 有寫出內容」就是假的綠
   *   （2026-09-23 之前的字樣 `/(順暢|尚可|壅塞)/` 正好吃得下那句話）。
   *   畫面上一定有分界（有預設值），所以這裡也要給。
   */
  bandsOf: () => ({ smoothEnd: "B", congestedStart: "E" }),
  worstOf: (rows) =>
    rows.reduce((worst, row) =>
      "ABCDEF".indexOf(row.los) > "ABCDEF".indexOf(worst.los) ? row : worst,
    ),
};

function row(over = {}) {
  return {
    projectCode: "P1",
    projectName: "測試計畫",
    period: "115Q2",
    road: "中山路",
    day: "平日",
    peak: "上午尖峰",
    direction: "方向1",
    directionText: "大同路口--->中正路口",
    travel: 32.5,
    running: 41.2,
    roadDelay: 40,
    junctionDelay: 20,
    totalDelay: 60,
    limit: 50,
    ratio: 0.65,
    los: "C",
    ...over,
  };
}

const cond = (over = {}) => ({ ...SPEED_DEFAULT_CONDITION, ...over });
const KEYS = SPEED_CONCLUSION_METRICS.map((metric) => metric.key);

/*
 * 每一個指標**特有**的字樣。
 *
 * ⚠️ 2026-09-23 全部重寫。原本那一份有 **5/12 是恆真的**：
 *   草稿的固定抬頭本來就寫著
 *     「說明：旅行速率與行駛速率為 km/h、延滯為秒……服務水準 A～F 是等級不是數值」
 *     「統計範圍：…共 32 筆尖峰方向紀錄」
 *   於是 `los: /服務水準/`、`travel: /旅行速率/`、`running: /行駛速率/`、
 *   `limit: /速限/`、`losCount: /筆/` 這五格**一個指標都不勾也會通過**——
 *   那正是這一支整篇註解在防的「假的綠」。
 *
 *   `bandShare: /(順暢|尚可|壅塞)/` 更糟：它連
 *     「讀不到三段分界設定，這一項沒有寫出來（請回報這個情形）」
 *   這句**明講自己寫不出來**的話都吃得下去。
 *
 * 所以現在的字樣一律帶著**那個指標才會印出來的格式**（數值、單位、標點），
 * 而且下面有一支測試拿「一個指標都不勾」當對照組，
 * **任何一個字樣在對照組上命中就是紅的**——恆真的字樣再也混不進來。
 */
const MARKS = {
  /*
   * ⚠️ 結尾要同時吃「。」與「；」：單獨勾時那一句用句號結束，
   *   與別的指標一起勾時會變成分號串在同一行。只認句號的話，
   *   「全部一起勾」那一支會誤判成「los 被別的指標吃掉了」。
   */
  los: /：服務水準 [A-F][；。]/,
  travel: /旅行速率 [\d.]+ km\/h/,
  running: /行駛速率 [\d.]+ km\/h/,
  totalDelay: /總延滯 [\d.]+ 秒/,
  delayParts: /交叉口延滯 [\d.]+ 秒/,
  /*
   * ⚠️ 2026-09-23 跟著程式改：速限現在會寫小數（表格本來就會寫 47.5），
   *   速限比改成「比值（百分比）」——比值那一個才對得上彙總表與判定門檻。
   */
  limit: /速限 [\d.]+ km\/h、速限比 [\d.]+（[\d.]+%）/,
  directionText: /--->/,
  growth: /，(增加|減少) [\d.]+%/,
  worst: /服務水準最差為 [A-F]/,
  extremes: /最快為 .+ km\/h，最慢為/,
  losCount: /[A-F] 級 \d+ 筆（[\d.]+%）/,
  bandShare: /壅塞 \d+ 筆（[\d.]+%）/,
};

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 每一個判定字樣都必須**分辨得出來**（對照組：一個指標都不勾）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這一支是 2026-09-23 補的，補的理由就是它自己抓到的東西：
 * 下面那個矩陣原本有 5/12 格恆真——草稿的固定抬頭本來就含
 * 「旅行速率」「行駛速率」「服務水準」「速限」「筆」這幾個詞，
 * 所以那幾個指標**壞成什麼樣都會是綠的**。
 *
 * 判準很簡單：把 metrics 設成空陣列（一個指標都不勾），
 * 這時候草稿裡**不可以**出現任何一個指標的判定字樣。
 * 出現了就代表那個字樣認的是固定文字，不是那個指標的輸出。
 *
 * ⚠️ 這一支要放在矩陣**前面**：矩陣全綠但字樣是恆真的，比矩陣紅還糟。
 */
test("⚠️ 判定字樣必須分辨得出來：一個指標都不勾時，一個字樣都不可以命中", () => {
  const rows = corpus();
  const bogus = [];
  for (const grouping of ["byRoad", "overall"]) {
    const blank = buildSpeedConclusion(
      rows,
      cond({ scope: { kind: "project" }, metrics: [], grouping }),
      META,
    );
    for (const key of KEYS)
      if (MARKS[key].test(blank))
        bogus.push(`${key}（分組 ${grouping}）：${MARKS[key]}`);
  }
  assert.deepEqual(
    bogus,
    [],
    "這些判定字樣在「一個指標都不勾」時就已經命中——" +
      "它們認的是草稿的固定文字，不是那個指標的輸出，\n" +
      "所以矩陣裡對應的那幾格是**恆真**的，指標壞掉也不會紅：\n  " +
      bogus.join("\n  "),
  );
});

test("MARKS 與 SPEED_CONCLUSION_METRICS 一一對應（新增指標不可以漏登記）", () => {
  assert.deepEqual(
    [...KEYS].sort(),
    Object.keys(MARKS).sort(),
    "有指標沒有登記判定字樣——下面的矩陣會少驗一格而且不會有人發現",
  );
});

/** 兩季 × 兩路段 × 平假日 × 兩方向 × 兩尖峰，各種指標都有得算。 */
function corpus() {
  const out = [];
  for (const period of ["115Q1", "115Q2"])
    for (const road of ["中山路", "示範南路"])
      for (const day of ["平日", "假日"])
        for (const direction of ["方向1", "方向2"])
          for (const peak of ["上午尖峰", "下午尖峰"])
            out.push(
              row({
                period,
                road,
                day,
                direction,
                peak,
                travel: 20 + out.length,
                los: ["A", "B", "C", "D", "E", "F"][out.length % 6],
                directionText:
                  direction === "方向1"
                    ? "大同路口--->中正路口"
                    : "中正路口--->大同路口",
              }),
            );
  return out;
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ① 矩陣：每一個指標單獨勾，都要真的寫得出東西
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 矩陣：每一個指標單獨勾都寫得出內容", () => {
  const rows = corpus();
  const holes = [];
  for (const key of KEYS) {
    const text = buildSpeedConclusion(
      rows,
      cond({
        scope: { kind: "project" },
        metrics: [key],
        grouping: ["worst", "extremes", "losCount", "bandShare"].includes(key)
          ? "overall"
          : "byRoad",
      }),
      META,
    );
    if (!MARKS[key].test(text))
      holes.push(`指標「${key}」：勾了卻寫不出內容\n--- 草稿 ---\n${text}\n---`);
  }
  assert.deepEqual(
    holes,
    [],
    `有 ${holes.length} 個指標產不出內容：\n\n${holes.join("\n\n")}`,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ② 篩選：每一個維度都要真的生效
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 每一個篩選維度都要真的改變輸出", () => {
  const rows = corpus();
  const base = cond({
    scope: { kind: "project" },
    metrics: ["los", "travel"],
    grouping: "byRoad",
  });
  const all = buildSpeedConclusion(rows, base, META);
  for (const [label, over] of [
    ["路段", { roads: ["中山路"] }],
    ["日別", { days: ["平日"] }],
    ["方向", { directions: ["方向1"] }],
    ["尖峰", { peaks: ["上午尖峰"] }],
    ["資料層級", { rowLevel: "representative" }],
    ["統計範圍", { scope: { kind: "quarter", quarter: "115Q1" } }],
  ]) {
    const filtered = buildSpeedConclusion(rows, { ...base, ...over }, META);
    assert.notEqual(
      filtered,
      all,
      `「${label}」這個條件設了之後輸出完全沒變——等於沒有生效`,
    );
  }
});

test("⚠️ 路段篩選：勾一個路段不可以寫出另一個路段", () => {
  const text = buildSpeedConclusion(
    corpus(),
    cond({
      scope: { kind: "project" },
      metrics: ["los"],
      roads: ["中山路"],
      grouping: "byRoad",
    }),
    META,
  );
  assert.match(text, /中山路/);
  assert.doesNotMatch(text, /示範南路/, "路段篩選沒有生效");
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ③ 分組與範圍
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 每一種分組方式都產得出內容，而且輸出彼此不同", () => {
  const rows = corpus();
  const groupings = ["byRoad", "byPeriod", "overall"];
  const texts = groupings.map((grouping) =>
    buildSpeedConclusion(
      rows,
      cond({ scope: { kind: "project" }, metrics: ["los", "travel"], grouping }),
      META,
    ),
  );
  for (const [index, text] of texts.entries())
    assert.match(
      text,
      /服務水準/,
      `分組「${groupings[index]}」沒有寫出數字`,
    );
  assert.equal(
    new Set(texts).size,
    groupings.length,
    "不同的分組方式寫出一模一樣的字——選項等於沒有作用",
  );
});

test("⚠️ 四種統計範圍（單季／年度／區間／全計畫）都挑得到資料", () => {
  const rows = [
    row({ period: "114Q4" }),
    row({ period: "115Q1" }),
    row({ period: "115Q2" }),
  ];
  for (const scope of [
    { kind: "quarter", quarter: "115Q1" },
    { kind: "year", year: "115" },
    { kind: "range", from: "114Q4", to: "115Q1" },
    { kind: "project" },
  ]) {
    const text = buildSpeedConclusion(
      rows,
      cond({ scope, metrics: ["los"] }),
      META,
    );
    assert.match(
      text,
      /服務水準/,
      `範圍 ${JSON.stringify(scope)} 挑不到任何資料`,
    );
  }
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ④ 全部一起勾：不可以互相吃掉
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 全部指標一起勾：每一個都還在", () => {
  const text = buildSpeedConclusion(
    corpus(),
    cond({ scope: { kind: "project" }, metrics: [...KEYS], grouping: "overall" }),
    META,
  );
  const missing = KEYS.filter((key) => !MARKS[key].test(text));
  assert.deepEqual(
    missing,
    [],
    `全部勾起來時，這些指標被其他指標吃掉了：${missing.join("、")}`,
  );
});
