/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列的條件模型與「先篩再挑最差」
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一支要守的第一件事是**升級當天一個數字都不可以變**：
 *   預設條件（代表尖峰・全部方向・全部日別・全部路段・起＝迄）下，
 *   summariesFor() 算出來的必須和「把全部明細分組、每組挑最差」
 *  （＝升級前 rebuild() 的做法）**逐筆相同**。
 *
 * ⚠️ 第二件事是**篩了之後要從剩下的那幾筆裡挑**，不是去篩已經挑好的代表值。
 *   拿已經挑好的代表值去篩，只會剩下「剛好代表值就是方向1」的那幾列，
 *   其餘整組消失——使用者會以為那些路段那一季沒有資料。
 *   下面那條測試用的期望值是**手算**的，不是把程式跑一次貼回來。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
/*
 * ⚠️ los-rule-scope.js 一定要**先**載入：main-toolbar.js 的 indexOfPeriod
 *   轉呼叫它（季別索引全站只有一份）。順序反過來的話，
 *   這裡每一條牽涉到季別排序的斷言都會紅——而紅的原因不是程式，
 *   是測試沒有照網頁的載入順序把相依載進來。
 *   網頁上的順序見 index.html：los-rule-scope → main-filters → main-toolbar。
 */
import "./los-rule-scope.js";
import "./main-filters.js";
import "./main-toolbar.js";

const MF = globalThis.LosMainFilters;
const MT = globalThis.LosMainToolbar;

const LOS_RANK = { A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
/** 與 app.js 的 worstOfGroup 完全相同的規則：LOS 最差 → 速限比最低 → 旅行速率最低。 */
function worstOfGroup(rows) {
  return [...rows].sort(
    (a, b) =>
      (LOS_RANK[a.los] || 9) - (LOS_RANK[b.los] || 9) ||
      (a.ratio ?? 9) - (b.ratio ?? 9) ||
      (a.travel ?? 999) - (b.travel ?? 999),
  )[0];
}

/*
 * 一個路段、一季、平日，四筆：
 *   方向1 上午  LOS B  ratio 0.65  travel 33
 *   方向1 下午  LOS D  ratio 0.45  travel 23   ← 全部 4 筆裡最差
 *   方向2 上午  LOS C  ratio 0.55  travel 28
 *   方向2 下午  LOS C  ratio 0.52  travel 26
 *
 * 手算：
 *   ・全部 4 筆挑最差 → 方向1 下午（D）
 *   ・只看方向2       → 方向2 下午（C，ratio 0.52 比 0.55 低）
 *   ・只看上午        → 方向2 上午（C）
 */
const base = {
  projectCode: "P1",
  year: 115,
  quarter: 1,
  period: "115Q1",
  road: "示範一路",
  day: "平日",
};
const rows = [
  { ...base, direction: "方向1", peak: "上午尖峰", los: "B", ratio: 0.65, travel: 33 },
  { ...base, direction: "方向1", peak: "下午尖峰", los: "D", ratio: 0.45, travel: 23 },
  { ...base, direction: "方向2", peak: "上午尖峰", los: "C", ratio: 0.55, travel: 28 },
  { ...base, direction: "方向2", peak: "下午尖峰", los: "C", ratio: 0.52, travel: 26 },
];

function withMain(overrides) {
  MT.state.main = Object.assign({}, MF.DEFAULT_MAIN_FILTERS, overrides);
  MT.state.overrides = {};
}

test("預設條件下，summariesFor 與「全部明細分組挑最差」逐筆相同（升級當天不可以有任何數字變動）", () => {
  withMain({ periodFrom: "115Q1", periodTo: "115Q1" });
  const got = MT.summariesFor(rows, "any", worstOfGroup, "range");
  assert.equal(got.length, 1);
  /* 升級前的做法：不篩，直接分組挑最差。 */
  const expected = worstOfGroup(rows);
  assert.equal(got[0].direction, expected.direction);
  assert.equal(got[0].peak, expected.peak);
  assert.equal(got[0].los, expected.los);
  assert.equal(got[0].travel, expected.travel);
  /* 手算：方向1 下午（D 是四筆裡最差的等級）。 */
  assert.equal(got[0].direction, "方向1");
  assert.equal(got[0].peak, "下午尖峰");
  assert.equal(got[0].los, "D");
});

test("只看方向2：**先篩再挑最差**——手算是方向2 下午（C，ratio 0.52）", () => {
  withMain({ periodFrom: "115Q1", periodTo: "115Q1", direction: "方向2" });
  const got = MT.summariesFor(rows, "any", worstOfGroup, "range");
  assert.equal(got.length, 1, "整組不可以消失——那會被讀成『這一季沒有資料』");
  assert.equal(got[0].direction, "方向2");
  assert.equal(got[0].peak, "下午尖峰");
  assert.equal(got[0].los, "C");
  assert.equal(got[0].ratio, 0.52);
});

test("只看上午：手算是方向2 上午（C）", () => {
  withMain({ periodFrom: "115Q1", periodTo: "115Q1", peak: "上午尖峰" });
  const got = MT.summariesFor(rows, "any", worstOfGroup, "range");
  assert.equal(got.length, 1);
  assert.equal(got[0].peak, "上午尖峰");
  assert.equal(got[0].direction, "方向2");
  assert.equal(got[0].los, "C");
});

test("篩過之後要寫得出**候選是哪幾筆**（否則使用者判斷不出代表值的來源）", () => {
  withMain({ periodFrom: "115Q1", periodTo: "115Q1", direction: "方向2" });
  const got = MT.summariesFor(rows, "any", worstOfGroup, "range");
  assert.match(got[0].pickedFrom, /方向2・上午尖峰/);
  assert.match(got[0].pickedFrom, /方向2・下午尖峰/);
  assert.doesNotMatch(got[0].pickedFrom, /方向1/);
});

test("「並列」在資料層不篩掉任何東西（它是呈現方式，不是篩選）", () => {
  withMain({
    periodFrom: "115Q1",
    periodTo: "115Q1",
    direction: "side-by-side",
    day: "side-by-side",
    peak: "side-by-side",
  });
  const kept = MT.detailsFor(rows, "any", "range");
  assert.equal(kept.length, 4, "並列被當成篩選的話，「全部」與「並列」就沒有差別了");
});

test("⚠️ 季度區間：起＝迄**就是只有那一季**（使用者 2026-09-15 定義）", () => {
  /*
   * 使用者原話：「起＝迄，是指單一季度……如果起 114Q1、迄 114Q1，
   *   **代表只有 114Q1 這一季的測值**」「你一開始說的**起＝迄代表不限季
   *   是錯誤的**」。
   *
   * ⚠️ 這一條**推翻了舊版的行為**（舊版在「歷季類」區塊上把起＝迄
   *   解釋成「不限季」，好讓趨勢圖預設畫得出全部季度）。
   *   真正該改的是**預設值**（起＝最早一季、迄＝最新一季），不是語意。
   *   使用者也直接回掉了當初的顧慮：「如果歷季圖出現起＝迄，導致趨勢圖
   *   只有單筆資料，那就只顯示單筆資料，是沒問題的」。
   *
   * ⚠️ rangeMode 參數因此**不再影響結果**（兩種模式一樣），下面兩條一起驗——
   *   漏驗其中一種的話，將來有人把 single 分支加回去不會被發現。
   */
  const twoQuarters = [
    ...rows,
    ...rows.map((row) => ({ ...row, period: "115Q2", quarter: 2 })),
  ];
  withMain({ periodFrom: "115Q2", periodTo: "115Q2" });
  assert.equal(
    MT.detailsFor(twoQuarters, "any", "range").length,
    4,
    "起＝迄就是只有那一季（歷季類的區塊也一樣）",
  );
  assert.equal(
    MT.detailsFor(twoQuarters, "any", "single").length,
    4,
    "rangeMode 不再影響結果：兩種模式都是那一季",
  );
  withMain({ periodFrom: "115Q1", periodTo: "115Q1" });
  assert.equal(
    MT.detailsFor(twoQuarters, "any", "range").length,
    4,
    "換成另一季也一樣，只有那一季",
  );
  /* 涵蓋全部季度要靠**真的把區間拉開**（那也是主工具列的預設值）。 */
  withMain({ periodFrom: "115Q1", periodTo: "115Q2" });
  assert.equal(
    MT.detailsFor(twoQuarters, "any", "range").length,
    8,
    "起≠迄才是區間，涵蓋兩季",
  );
});

test("拉開區間之後只留區間內的季", () => {
  const three = ["115Q1", "115Q2", "115Q3"].flatMap((period, index) =>
    rows.map((row) => ({ ...row, period, quarter: index + 1 })),
  );
  withMain({ periodFrom: "115Q2", periodTo: "115Q3" });
  const kept = MT.detailsFor(three, "any", "range");
  assert.deepEqual([...new Set(kept.map((row) => row.period))].sort(), [
    "115Q2",
    "115Q3",
  ]);
});

test("三態：改一塊只影響那一塊，回歸之後回到主工具列的值", () => {
  /*
   * ⚠️ 2026-09-17 起日別的預設值是 "side-by-side"（平日＋假日並列）。
   *   舊的 "all" 與它**行為完全相同**（matchesDetail 兩個都不擋列），
   *   使用者裁示留一個就好，留下來的是「並列」——三支一致。
   *   這一條守的仍然是同一件事：改一塊不可以帶著別塊跑。
   */
  withMain({ periodFrom: "115Q1", periodTo: "115Q1" });
  MT.setChart("A", "day", "weekday");
  assert.equal(MT.filtersOf("A").day, "weekday");
  assert.equal(MT.filtersOf("B").day, "side-by-side", "別塊不可以被帶著跑");
  assert.equal(
    MT.state.main.day,
    "side-by-side",
    "主工具列自己也不可以被帶著跑",
  );
  assert.deepEqual(MF.detachedIds(MT.state.overrides), ["A"]);
  MT.resetChart("A");
  assert.equal(MT.filtersOf("A").day, "side-by-side");
  assert.deepEqual(MF.detachedIds(MT.state.overrides), []);
});

test("日別與方向沒有「全部」那一個選項（它與「並列」完全同義）", () => {
  /*
   * 使用者 2026-09-17 問「平日＋假日並列 和 全部日別 有什麼差異」，
   * 查證結果是**完全沒有差異**：matchesDetail 只在選「平日」「假日」
   *（方向則是「方向1」「方向2」）時才擋列，另外兩個值一個都不進分支。
   * 兩個名字不同、行為相同的選項比少一個選項更糟。
   */
  assert.deepEqual(MF.DAY_CHOICES, ["weekday", "holiday", "side-by-side"]);
  assert.deepEqual(MF.DIRECTION_CHOICES, ["方向1", "方向2", "side-by-side"]);
  assert.equal(MF.DEFAULT_MAIN_FILTERS.day, "side-by-side");
  assert.equal(MF.DEFAULT_MAIN_FILTERS.direction, "side-by-side");
  /* 舊存檔裡的 "all" 一律換成並列，否則下拉會選不到任何一項。 */
  const legacy = MF.normalizeLegacyAll({ day: "all", direction: "all" });
  assert.equal(legacy.day, "side-by-side");
  assert.equal(legacy.direction, "side-by-side");
  /* ⚠️ 換過去**不可以改變任何數字**：兩個值本來就都不擋列。 */
  const row = { day: "平日", direction: "方向2" };
  const keep = (filters) =>
    (filters.day !== "weekday" || row.day === "平日") &&
    (filters.day !== "holiday" || row.day === "假日") &&
    (filters.direction !== "方向1" || row.direction === "方向1") &&
    (filters.direction !== "方向2" || row.direction === "方向2");
  assert.equal(keep({ day: "all", direction: "all" }), keep(legacy));
});

test("isFiltered：起＝迄不算「篩了」（不然每次開機都會跳出不適用的說明）", () => {
  const filters = Object.assign({}, MF.DEFAULT_MAIN_FILTERS, {
    periodFrom: "115Q2",
    periodTo: "115Q2",
  });
  assert.equal(MF.isFiltered(filters, "periodFrom"), false);
  assert.equal(
    MF.isFiltered(Object.assign({}, filters, { periodFrom: "115Q1" }), "periodFrom"),
    true,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  R-8：季度不可以用 isFiltered 問（M-1 之後語意剛好相反）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-15 使用者定案：**起＝迄＝只有那一季**（不是「不限季」）。
 * 所以「選了單季」也是在篩——但 isFiltered 看不到季度清單，
 * 答不出「有沒有比全部季度窄」。要問那件事只能用 isPeriodNarrowed。
 *
 * 這一條掃的是**呼叫端**：任何地方把季度欄位丟進 isFiltered 就紅。
 * ⚠️ 為什麼要用掃描而不是靠註解：那個函式**不會爆炸**，它會安靜地回一個
 *   「區間有沒有拉開」的答案。呼叫端拿它當「有沒有篩」用時，
 *   畫面上看起來完全正常，只是該出現的說明沒出現——沒有人會發現。
 */
test("R-8：程式裡不可以把季度欄位丟進 isFiltered", () => {
  const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const hits = [
    ...stripped.matchAll(
      /isFiltered\([^)]*["'](periodFrom|periodTo|quarterFrom|quarterTo)["']/g,
    ),
  ].map((match) => match[0]);
  assert.deepEqual(
    hits,
    [],
    "季度要用 isPeriodNarrowed（有沒有比全部季度窄）或 isRangeWidened（是不是拉開了）：\n" +
      hits.join("\n"),
  );
});

test("前置：這條掃描真的抓得到（抓不到的話上一條恆綠）", () => {
  const fake = 'const a = MF.isFiltered(f, "periodFrom");';
  const hits = [
    ...fake.matchAll(
      /isFiltered\([^)]*["'](periodFrom|periodTo|quarterFrom|quarterTo)["']/g,
    ),
  ];
  assert.equal(hits.length, 1);
});

test("isRangeWidened：起＝迄＝false（那是單季，不是拉開）", () => {
  assert.equal(
    MF.isRangeWidened({ periodFrom: "115Q2", periodTo: "115Q2" }),
    false,
  );
});

test("isRangeWidened：起≠迄＝true（一張卡放不下兩季，要說一聲）", () => {
  assert.equal(
    MF.isRangeWidened({ periodFrom: "115Q1", periodTo: "115Q2" }),
    true,
  );
});
