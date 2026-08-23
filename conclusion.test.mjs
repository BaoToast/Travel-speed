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
