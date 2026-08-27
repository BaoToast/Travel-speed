/*
 * 結論草稿產生器的單元測試（交通服務水準）。
 *
 * conclusion.js 同時要能在瀏覽器（掛在 globalThis）與 node（module.exports）
 * 底下用，所以這裡用 createRequire 直接載入同一支檔案——測到的就是網站上
 * 實際跑的那一份，不是另外抄一份。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  SPEED_CONCLUSION_METRICS,
  SPEED_DEFAULT_CONDITION,
  buildSpeedConclusion,
  selectSpeedConclusionRows,
  speedPeriodKey,
  speedPeriodYear,
} = require("./conclusion.js");

const META = {
  projectName: "測試計畫",
  systemVersion: "v2.16",
  generatedAt: "2026-08-23 10:00",
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

test("季度鍵可以正確排序民國年", () => {
  assert.ok(speedPeriodKey("99Q4") < speedPeriodKey("100Q1"));
  assert.ok(speedPeriodKey("114Q4") < speedPeriodKey("115Q1"));
  assert.equal(speedPeriodYear("115Q2"), "115");
  assert.equal(speedPeriodKey("亂碼"), Number.NEGATIVE_INFINITY);
});

test("單季／年度／區間條件都會生效，起訖顛倒也能用", () => {
  const rows = ["114Q3", "114Q4", "115Q1", "115Q2"].map((period) => row({ period }));
  assert.deepEqual(
    selectSpeedConclusionRows(rows, cond({ scope: { kind: "quarter", quarter: "115Q1" } })).map(
      (r) => r.period,
    ),
    ["115Q1"],
  );
  assert.deepEqual(
    selectSpeedConclusionRows(rows, cond({ scope: { kind: "year", year: "114" } })).map(
      (r) => r.period,
    ),
    ["114Q3", "114Q4"],
  );
  assert.deepEqual(
    selectSpeedConclusionRows(
      rows,
      cond({ scope: { kind: "range", from: "115Q1", to: "114Q4" } }),
    ).map((r) => r.period),
    ["114Q4", "115Q1"],
  );
});

test("尖峰、方向、日別與路段條件都會生效", () => {
  const rows = [
    row({ peak: "上午尖峰", direction: "方向1", day: "平日", road: "中山路" }),
    row({ peak: "下午尖峰", direction: "方向2", day: "假日", road: "中正路" }),
  ];
  assert.equal(selectSpeedConclusionRows(rows, cond({ peaks: ["上午尖峰"] })).length, 1);
  assert.equal(selectSpeedConclusionRows(rows, cond({ directions: ["方向2"] })).length, 1);
  assert.equal(selectSpeedConclusionRows(rows, cond({ days: ["假日"] })).length, 1);
  assert.equal(selectSpeedConclusionRows(rows, cond({ roads: ["中山路"] })).length, 1);
});

test("只勾服務水準與旅行速率時，不會寫出延滯", () => {
  const text = buildSpeedConclusion([row()], cond({ metrics: ["los", "travel"] }), META);
  assert.match(text, /服務水準 C/);
  assert.match(text, /旅行速率 32\.5 km\/h/);
  // 標頭那段規則說明本來就會提到各種指標，所以只看數值那一行。
  const valueLine = text.split("\n").find((line) => /服務水準 C/.test(line)) || "";
  assert.doesNotMatch(valueLine, /總延滯/, valueLine);
  assert.doesNotMatch(valueLine, /行駛速率/, valueLine);
});

test("勾了延滯組成才會寫路段與交叉口延滯", () => {
  const text = buildSpeedConclusion([row()], cond({ metrics: ["delayParts"] }), META);
  assert.match(text, /路段延滯 40\.0 秒、交叉口延滯 20\.0 秒/);
});

test("速限比以百分比寫出，缺值寫成「—」不會變成 0", () => {
  const text = buildSpeedConclusion(
    [row({ ratio: null, limit: 50 })],
    cond({ metrics: ["limit"] }),
    META,
  );
  assert.match(text, /速限 50 km\/h、速限比 —/);
  assert.doesNotMatch(text, /速限比 0/);
});

test("讀不到數值時寫「—」，並在文末說明有幾筆", () => {
  const text = buildSpeedConclusion(
    [row({ travel: null, totalDelay: null })],
    cond({ metrics: ["travel", "totalDelay"] }),
    META,
  );
  assert.match(text, /旅行速率 — km\/h/);
  assert.match(text, /1 筆紀錄的旅行速率或總延滯讀不到數值/);
  assert.doesNotMatch(text, /NaN/);
});

test("季度變動只在同一路段、同一日別、同一尖峰、同一方向之間計算", () => {
  const rows = [
    row({ period: "114Q1", travel: 30, totalDelay: 100, los: "D" }),
    row({ period: "114Q4", travel: 36, totalDelay: 80, los: "C" }),
    row({ period: "114Q4", road: "中正路", travel: 99, totalDelay: 10, los: "A" }),
  ];
  const text = buildSpeedConclusion(
    rows,
    cond({ scope: { kind: "year", year: "114" }, metrics: ["growth"] }),
    META,
  );
  assert.match(text, /旅行速率由 30\.0 變為 36\.0 km\/h，增加 20\.0%/);
  assert.match(text, /總延滯由 100\.0 變為 80\.0 秒，下降 20\.0%/);
  assert.match(text, /服務水準 D → C/);
});

test("基期為 0 時寫出實際數值，不會寫成「增加 0.0%」或無限大", () => {
  const rows = [
    row({ period: "114Q1", totalDelay: 0 }),
    row({ period: "114Q2", totalDelay: 480 }),
  ];
  const text = buildSpeedConclusion(rows, cond({ metrics: ["growth"] }), META);
  assert.match(text, /總延滯由 0 秒 增為 480\.0 秒/);
  // 旅行速率兩季相同、寫「增加 0.0%」是正確的；這裡要擋的是「延滯」那一段。
  assert.doesNotMatch(text, /總延滯[^；\n]*增加 0\.0%/);
  assert.doesNotMatch(text, /Infinity|NaN/);
});

test("服務水準最差的路段挑的是 F 而不是 A", () => {
  const rows = [
    row({ road: "中山路", los: "B", ratio: 0.8 }),
    row({ road: "中正路", los: "F", ratio: 0.2 }),
    row({ road: "民生路", los: "D", ratio: 0.5 }),
  ];
  const text = buildSpeedConclusion(rows, cond({ metrics: ["worst"] }), META);
  assert.match(text, /服務水準最差為 F：.*中正路/);
});

test("服務水準等級統計會列出各級筆數與百分比", () => {
  const rows = [
    row({ los: "A" }),
    row({ los: "C" }),
    row({ los: "C" }),
    row({ los: "?" }),
  ];
  const text = buildSpeedConclusion(rows, cond({ metrics: ["losCount"] }), META);
  assert.match(text, /A 級 1 筆（25\.0%）/);
  assert.match(text, /C 級 2 筆（50\.0%）/);
  assert.match(text, /無法判定 1 筆/);
});

test("服務水準不會被平均", () => {
  const text = buildSpeedConclusion(
    [row({ los: "A" }), row({ los: "F" })],
    cond({ metrics: ["los", "losCount"] }),
    META,
  );
  assert.match(text, /服務水準 A～F 是等級不是數值，不做平均/);
  assert.doesNotMatch(text, /平均服務水準/);
});

test("最快最慢會寫明各路段長度與速限不同", () => {
  const rows = [row({ road: "中山路", travel: 20 }), row({ road: "中正路", travel: 50 })];
  const text = buildSpeedConclusion(rows, cond({ metrics: ["extremes"] }), META);
  assert.match(text, /最快為 .*中正路.* 50\.0 km\/h/);
  assert.match(text, /最慢為 .*中山路.* 20\.0 km\/h/);
  assert.match(text, /2 筆平均 35\.0 km\/h/);
  assert.match(text, /各路段長度與速限不同/);
});

test("方向文字只有勾了才會出現", () => {
  const without = buildSpeedConclusion([row()], cond({ metrics: ["los"] }), META);
  assert.doesNotMatch(without, /大同路口/);
  const with_ = buildSpeedConclusion([row()], cond({ metrics: ["los", "directionText"] }), META);
  assert.match(with_, /大同路口--->中正路口/);
});

test("條件挑不到資料時給的是可行動的說明", () => {
  const text = buildSpeedConclusion(
    [row({ period: "115Q2" })],
    cond({ scope: { kind: "quarter", quarter: "113Q1" } }),
    META,
  );
  assert.match(text, /所選條件沒有對應的資料/);
  assert.match(text, /請放寬季度範圍/);
});

test("三種分段方式都寫得出東西", () => {
  const rows = [row({ period: "115Q1" }), row({ period: "115Q2" })];
  for (const grouping of ["byRoad", "byPeriod", "overall"]) {
    const text = buildSpeedConclusion(rows, cond({ metrics: ["los", "travel"], grouping }), META);
    assert.match(text, /^1\. /m, `${grouping} 應該有第 1 段`);
    assert.ok(text.length > 200, `${grouping} 不應該幾乎空白`);
  }
});

test("每一個可勾選指標都真的會改變輸出（沒有死選項）", () => {
  const rows = [
    row({ period: "114Q1", los: "D", travel: 30 }),
    row({ period: "114Q2", los: "C", travel: 36 }),
    row({ period: "114Q2", road: "中正路", los: "F", travel: 12 }),
    row({ period: "114Q2", peak: "下午尖峰", direction: "方向2" }),
  ];
  const base = cond({ metrics: [], grouping: "byRoad" });
  const empty = buildSpeedConclusion(rows, base, META);
  for (const metric of SPEED_CONCLUSION_METRICS) {
    const text = buildSpeedConclusion(rows, { ...base, metrics: [metric.key] }, META);
    assert.notEqual(
      text,
      empty,
      `勾選「${metric.label}」之後輸出必須有變化，否則就是死選項`,
    );
  }
});

test("標頭一定寫明不可加總與不可平均的規則", () => {
  const text = buildSpeedConclusion([row()], cond(), META);
  assert.match(text, /跨路段、跨季度只做比較，不做加總/);
  assert.match(text, /服務水準 A～F 是等級不是數值，不做平均/);
});

/*
 * 「只寫整體結論」＋勾「各服務水準等級的筆數統計」時，原本會把代表紀錄那一段
 * 整個吃掉，導致 los / travel / running / totalDelay / delayParts / limit /
 * directionText 七個指標全部變成死選項——多勾一個選項反而少寫六行。
 */
test("整體模式下勾了等級統計，其他指標仍然要寫出來（不可變成死選項）", () => {
  const rows = [row({ los: "D", travel: 23.4, totalDelay: 120 }), row({ los: "E" })];
  const text = buildSpeedConclusion(
    rows,
    cond({
      grouping: "overall",
      metrics: ["losCount", "los", "travel", "totalDelay", "limit"],
    }),
    META,
  );
  assert.match(text, /D 級 1 筆/);
  assert.match(text, /代表紀錄/);
  assert.match(text, /服務水準 D/);
  assert.match(text, /旅行速率 23\.4 km\/h/);
  assert.match(text, /總延滯 120\.0 秒/);
});

test("整體模式下每一個指標單獨勾選也都要有輸出（逐一檢查沒有死選項）", () => {
  const rows = [
    row({ period: "114Q1", los: "D", travel: 30, totalDelay: 100 }),
    row({ period: "114Q2", los: "C", travel: 36, totalDelay: 80 }),
    row({ period: "114Q2", road: "中正路", los: "F", travel: 12 }),
  ];
  const base = cond({ metrics: [], grouping: "overall" });
  const empty = buildSpeedConclusion(rows, base, META);
  for (const metric of SPEED_CONCLUSION_METRICS) {
    const text = buildSpeedConclusion(rows, { ...base, metrics: [metric.key] }, META);
    assert.notEqual(
      text,
      empty,
      `「只寫整體結論」下勾「${metric.label}」必須有變化，否則就是死選項`,
    );
    /* 和等級統計一起勾時也不可以互相吃掉 */
    const withCount = buildSpeedConclusion(
      rows,
      { ...base, metrics: ["losCount", metric.key] },
      META,
    );
    const countOnly = buildSpeedConclusion(rows, { ...base, metrics: ["losCount"] }, META);
    if (metric.key !== "losCount")
      assert.notEqual(
        withCount,
        countOnly,
        `「等級統計 ＋ ${metric.label}」必須比只勾等級統計多寫東西`,
      );
  }
});

/*
 * ── 方向顯示名稱（v2.20.6）──
 *
 * 使用者在「路段管理 → 方向顯示名稱」替路段的方向命名之後，草稿寫的必須是
 * 那個名稱。v2.20.5 這裡全部直接印 row.direction，於是明細、彙總、速限表
 * 顯示新名稱，草稿卻還是「方向1／方向2」——同一份資料兩種寫法。
 *
 * 鍵值（row.direction）不能被換掉：條件範本存的是鍵值，換掉會讓使用者
 * 已經存好的範本全部篩不到資料。
 */
test("代表紀錄那一行寫的是方向顯示名稱，不是鍵值", () => {
  const text = buildSpeedConclusion(
    [row({ directionLabel: "東-西(西行)" })],
    cond({ metrics: ["los"] }),
    META,
  );
  assert.match(text, /上午尖峰・東-西\(西行\)/);
  assert.doesNotMatch(text, /上午尖峰・方向1/);
});

test("沒有 directionLabel 時維持鍵值（舊資料照舊，行為不變）", () => {
  const text = buildSpeedConclusion([row()], cond({ metrics: ["los"] }), META);
  assert.match(text, /上午尖峰・方向1/);
});

test("統計範圍那一行的方向也寫名稱", () => {
  const text = buildSpeedConclusion(
    [
      row({ direction: "方向1", directionLabel: "東-西(西行)" }),
      row({ direction: "方向2", directionLabel: "西-東(東行)" }),
    ],
    cond({ metrics: ["los"] }),
    META,
  );
  assert.match(text, /方向：東-西\(西行\)、西-東\(東行\)。/);
  assert.doesNotMatch(text, /方向：方向1/);
});

test("季度變動幅度、最差路段、最快最慢三段都寫名稱", () => {
  const rows = [
    row({ period: "115Q1", directionLabel: "東-西(西行)", travel: 20, los: "E" }),
    row({ period: "115Q2", directionLabel: "東-西(西行)", travel: 30, los: "C" }),
  ];
  const text = buildSpeedConclusion(
    rows,
    cond({ metrics: ["los", "growth", "worst", "extremes"] }),
    META,
  );
  // 變動幅度（跨季度那一行）、最差路段、最快最慢三段都要在
  assert.match(text, /由 115Q1 至 115Q2/);
  assert.match(text, /服務水準最差的路段/);
  assert.match(text, /旅行速率的最快與最慢/);
  // 三段各自寫的方向都必須是名稱
  assert.match(text, /・上午尖峰・東-西\(西行\)：由 115Q1 至 115Q2/);
  assert.match(text, /服務水準最差為 E：[^\n]*・東-西\(西行\)）/);
  assert.match(text, /旅行速率最快為[^\n]*・東-西\(西行\)）/);
  assert.doesNotMatch(text, /・方向1/);
});

test("方向文字與顯示名稱相同時不會括號重複一次", () => {
  const same = "大同路口--->中正路口";
  const text = buildSpeedConclusion(
    [row({ directionLabel: same, directionText: same })],
    cond({ metrics: ["directionText"] }),
    META,
  );
  assert.doesNotMatch(text, /大同路口--->中正路口（大同路口--->中正路口）/);
  assert.match(text, /上午尖峰・大同路口--->中正路口。/);
});

test("方向文字與顯示名稱不同時，兩個都要寫出來", () => {
  const text = buildSpeedConclusion(
    [row({ directionLabel: "東-西(西行)" })],
    cond({ metrics: ["directionText"] }),
    META,
  );
  assert.match(text, /東-西\(西行\)（大同路口--->中正路口）/);
});

test("方向篩選用的是鍵值，取了顯示名稱也不受影響", () => {
  const rows = [
    row({ direction: "方向1", directionLabel: "東-西(西行)" }),
    row({ direction: "方向2", directionLabel: "西-東(東行)" }),
  ];
  assert.equal(selectSpeedConclusionRows(rows, cond({ directions: ["方向1"] })).length, 1);
  // 用顯示名稱當條件應該篩不到——證明鍵值沒有被顯示名稱取代。
  assert.equal(
    selectSpeedConclusionRows(rows, cond({ directions: ["東-西(西行)"] })).length,
    0,
  );
});
