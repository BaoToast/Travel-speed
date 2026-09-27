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
  /*
   * ⚠️ 稽核表 L：分母是**可判定筆數**（3），不是全部筆數（4）。
   *   舊版是 25.0%／50.0%（分母 4），與同一份草稿下方「三段分法」的分母不一致。
   */
  assert.match(text, /A 級 1 筆（33\.3%）/);
  assert.match(text, /C 級 2 筆（66\.7%）/);
  assert.match(text, /無法判定 1 筆（不計入分母）/);
  assert.match(text, /共 4 筆（可判定 3 筆/);
  /* 而且要把口徑寫出來——只改數字不改字的話，前後兩版長得一模一樣。 */
  assert.match(text, /佔比的分母是可判定筆數/);
});

test("⚠️ 稽核表 L：等級統計與三段分法在同一份草稿裡用同一個分母", () => {
  /*
   * 這一條是這次補的重點，不可以只驗上面那條的字面值。
   *
   * 兩段並排印在同一份草稿裡：上面是「A 級 n 筆（x%）」，
   * 下面是「順暢／尚可／壅塞 n 筆（x%）」。分母不同的話，
   * **兩組百分比各自加起來會是不同的總和**，而讀的人看不出為什麼。
   *
   * 所以這裡不比字串，直接把兩段的百分比各自加起來——
   * 都必須是 100%（容許浮點與四捨五入的 0.2 個百分點）。
   * 資料刻意放一筆讀不到等級的（"?"），否則兩種分母剛好相同，整條恆真。
   */
  const rows = [
    row({ los: "A" }),
    row({ los: "C" }),
    row({ los: "C" }),
    row({ los: "?" }),
  ];
  const text = buildSpeedConclusion(
    rows,
    cond({ metrics: ["losCount", "bandShare"] }),
    /* 三段分法要有分界才寫得出來；沒有的話這一條會恆真（下面有前置擋住）。 */
    { ...META, bandsOf: () => ({ smoothEnd: "B", congestedStart: "E" }) },
  );
  const sumOf = (line) =>
    [...line.matchAll(/（(\d+(?:\.\d+)?)%）/g)].reduce(
      (total, hit) => total + Number(hit[1]),
      0,
    );
  const losLine = text.split("\n").find((l) => /級 \d+ 筆（/.test(l));
  const bandLine = text.split("\n").find((l) => /順暢 \d+ 筆（/.test(l));
  assert.ok(losLine, "找不到等級統計那一行（找不到的話這條恆真）");
  assert.ok(bandLine, "找不到三段分法那一行（找不到的話這條恆真）");
  assert.ok(
    Math.abs(sumOf(losLine) - 100) <= 0.2,
    `等級統計的百分比加起來是 ${sumOf(losLine)}%，不是 100%：${losLine}`,
  );
  assert.ok(
    Math.abs(sumOf(bandLine) - 100) <= 0.2,
    `三段分法的百分比加起來是 ${sumOf(bandLine)}%，不是 100%：${bandLine}`,
  );
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

test("最快最慢會寫明各路段長度與速限不同，而且**不取平均**、逐筆列出", () => {
  const rows = [row({ road: "中山路", travel: 20 }), row({ road: "中正路", travel: 50 })];
  const text = buildSpeedConclusion(rows, cond({ metrics: ["extremes"] }), META);
  assert.match(text, /最快為 .*中正路.* 50\.0 km\/h/);
  assert.match(text, /最慢為 .*中山路.* 20\.0 km\/h/);
  assert.match(text, /各路段長度與速限不同/);
  /*
   * ⚠️ 2026-09-16 起**不可以**再出現「N 筆平均」（使用者裁示：
   *   「每一行展示一筆季別+日別的結果……而不是要你平均起來」）。
   *   原本的括號裡自己就寫著「各路段長度與速限不同」——既然如此
   *   就更不該把它們平均起來。這一條是反面守門。
   */
  assert.doesNotMatch(text, /筆平均/);
  assert.match(text, /不取平均/);
  /* 而且要逐筆列出（一行一筆：季別 × 路段 × 日別 × 尖峰 × 方向）。 */
  assert.match(text, /・.*中正路.*：50\.0 km\/h/);
  assert.match(text, /・.*中山路.*：20\.0 km\/h/);
});

test("筆數太多時不逐筆列，但也**不可以**改回給平均", () => {
  const rows = Array.from({ length: 15 }, (_, index) =>
    row({ road: `示範路${index}`, travel: 20 + index }),
  );
  const text = buildSpeedConclusion(rows, cond({ metrics: ["extremes"] }), META);
  assert.match(text, /共 15 筆，逐筆列出過長/);
  assert.doesNotMatch(text, /筆平均/);
  /* 最快最慢仍然要寫得出來——那是比大小，不是把數字混在一起。 */
  assert.match(text, /最快為 .*示範路14/);
  assert.match(text, /最慢為 .*示範路0（/);
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

/*
 * ══════════════════════════════════════════════════════════════════════
 *  A18：混合勾選的組合測試（測試盲區）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-21 的盤點結果：三支的結論草稿都有測試，但「一次勾 3 項以上」
 * 的組合極少（本支 2 項、路口轉向 1 項、全日交通量 0 項）。
 * 姊妹專案路口轉向的三個真實缺陷全部躲在這個盲區裡：
 * 每一項單獨勾都對，混在一起才出事。
 *
 * ⚠️ **只斷言「草稿不是空的」不算數**——出事的草稿本來就不是空的。
 *   這裡逐一斷言每一個勾起來的項目都真的寫出來了。
 */
test("⚠️ 一次勾滿所有指標：每一個都要真的寫出來", () => {
  const rows = [
    row({ period: "114Q4", los: "C", travel: 28.4 }),
    row({ period: "115Q1", los: "D", travel: 24.1 }),
    row({ period: "115Q2", road: "中正路", los: "B", travel: 36.8 }),
  ];
  const keys = SPEED_CONCLUSION_METRICS.map((metric) => metric.key);
  const text = buildSpeedConclusion(
    rows,
    cond({ scope: { kind: "project" }, metrics: keys, grouping: "overall" }),
    META,
  );
  /* 前置：真的勾滿了，而且指標清單不是空的。 */
  assert.ok(keys.length >= 10, `指標只有 ${keys.length} 項，清單可能被改壞`);
  assert.ok(text.length > 200, "草稿短到不像勾了十幾項");
  /*
   * 逐項確認：每一個指標至少要在草稿裡留下自己的痕跡。
   * 這裡比對的是該指標**特有**的字樣，不是「草稿有東西」。
   */
  for (const [key, mark] of [
    ["los", /服務水準/],
    ["travel", /旅行速率/],
    ["running", /行駛速率/],
    ["totalDelay", /總延滯/],
    ["delayParts", /交叉口延滯/],
    ["limit", /速限/],
    ["directionText", /--->|→/],
    ["growth", /變|增|減/],
    ["worst", /最差/],
    ["extremes", /最快|最慢/],
    ["losCount", /筆/],
    ["bandShare", /順暢|尚可|壅塞/],
  ]) {
    if (!keys.includes(key)) continue;
    assert.match(text, mark, `勾了「${key}」，草稿裡卻找不到它的內容`);
  }
});

test("⚠️ 混合勾選：跟尖峰有關的與跟尖峰無關的一起勾，兩邊都要在", () => {
  /*
   * 「速限」與「方向文字」是**不隨尖峰改變**的（見 conclusion.js 的
   * INAPPLICABLE 說明），其餘是逐筆尖峰的數字。
   * 兩類混在一起勾時，不可以因為其中一類就把另一類整個吃掉。
   */
  const text = buildSpeedConclusion(
    [row()],
    cond({
      peaks: ["上午尖峰"],
      metrics: ["limit", "directionText", "los", "travel", "totalDelay"],
    }),
    META,
  );
  assert.match(text, /速限/, "不隨尖峰改變的「速限」被吃掉了");
  assert.match(text, /--->|→/, "不隨尖峰改變的「方向文字」被吃掉了");
  assert.match(text, /服務水準/);
  assert.match(text, /旅行速率/);
  assert.match(text, /總延滯/);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  「代表紀錄」＋「季度之間的變動」：不可以整段消失，更不可以說謊
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-23 的反向對帳（從表格／圖那一端回推草稿）抓到的，而且**踩在
 * 預設動線上**：主工具列的尖峰預設是「代表尖峰」，套用到結論草稿時
 * `rowLevel` 會變成 `"representative"`。
 *
 * `describeGrowth` 舊的分組鍵是 `[road, day, peak, direction]`，
 * 而代表紀錄「最差的那一筆是哪個尖峰哪個方向」**逐季會不同**，
 * 於是兩季被分進兩個群組、每組只剩 1 筆：
 *   ・byRoad 分組 → **一行都不印，也沒有任何說明**
 *   ・其他分組 → 印出「範圍內沒有任何一筆具備兩季以上的資料」
 *     ——而範圍內就是兩季，同一份資料在歷季速率圖上畫得出下降線。
 *
 * ⚠️ 使用者原話：「不要讓使用者出了題卻無法抓出答案來，但明明表格中
 *   卻能查到答案」。這一件比查不到更糟：它**給了一個錯的答案**。
 *
 * ⚠️ 這一支也守反方向：逐筆明細時分組鍵**不可以**跟著放寬——
 *   那時候同一條路同一天真的有好幾筆，不分尖峰與方向會把不同的東西比在一起。
 */
function growthRow(over) {
  return {
    projectCode: "P1",
    projectName: "測試計畫",
    road: "A路",
    day: "平日",
    direction: "方向1",
    directionText: "甲路口--->乙路口",
    travel: 30,
    running: 40,
    roadDelay: 20,
    junctionDelay: 10,
    totalDelay: 30,
    limit: 50,
    ratio: 0.6,
    los: "E",
    ...over,
  };
}

/** 114Q1 最差是上午·方向1（E），114Q2 最差是下午·方向2（F）。 */
const GROWTH_ROWS = [
  growthRow({ year: 114, quarter: 1, period: "114Q1", peak: "上午尖峰", direction: "方向1", los: "E", travel: 30 }),
  growthRow({ year: 114, quarter: 1, period: "114Q1", peak: "下午尖峰", direction: "方向2", los: "C", travel: 45 }),
  growthRow({ year: 114, quarter: 2, period: "114Q2", peak: "上午尖峰", direction: "方向1", los: "D", travel: 38 }),
  growthRow({ year: 114, quarter: 2, period: "114Q2", peak: "下午尖峰", direction: "方向2", los: "F", travel: 25 }),
];

const GROWTH_META = {
  projectName: "測試計畫",
  systemVersion: "v0",
  generatedAt: "2026-09-23 10:00",
  bandsOf: () => ({ smoothEnd: "B", congestedStart: "E" }),
  worstOf: (list) =>
    list.reduce((worst, row) =>
      "ABCDEF".indexOf(row.los) > "ABCDEF".indexOf(worst.los) ? row : worst,
    ),
};

for (const grouping of ["byRoad", "byPeriod", "overall"])
  test(`⚠️ 代表紀錄＋季度變動（分組 ${grouping}）：兩季有資料就要寫得出來`, () => {
    const text = buildSpeedConclusion(
      GROWTH_ROWS,
      {
        ...SPEED_DEFAULT_CONDITION,
        scope: { kind: "project" },
        metrics: ["growth"],
        grouping,
        rowLevel: "representative",
      },
      GROWTH_META,
    );
    assert.match(
      text,
      /由 114Q1 至 114Q2/,
      `勾了「季度之間的變動幅度」卻寫不出那一句：\n${text}`,
    );
    /* 真的把兩季的值比出來，不是只印一個標題。 */
    assert.match(text, /旅行速率由 30\.0 變為 25\.0 km\/h/, text);
    assert.match(text, /服務水準 E → F/, text);
    assert.ok(
      !/沒有任何一筆具備兩季以上的資料/.test(text),
      `資料有兩季，草稿卻說沒有——這比寫不出來更糟：\n${text}`,
    );
  });

test("⚠️ 代表紀錄時，兩季的時段／方向不同要照實寫出來", () => {
  const text = buildSpeedConclusion(
    GROWTH_ROWS,
    {
      ...SPEED_DEFAULT_CONDITION,
      scope: { kind: "project" },
      metrics: ["growth"],
      grouping: "overall",
      rowLevel: "representative",
    },
    GROWTH_META,
  );
  /*
   * ⚠️ 只寫第一季那一個的話，讀的人會以為兩季比的是同一個尖峰同一個方向。
   *   代表紀錄本來就是「這條路這一天最差的那一筆」，換了時段是正常的，
   *   但要講出來。
   */
  assert.match(text, /上午尖峰・方向1 → 下午尖峰・方向2/, text);
  assert.match(text, /代表紀錄，兩季最差的時段／方向不同/, text);
});

test("⚠️ 兩季剛好是同一個時段方向時，不要畫蛇添足寫成「→」", () => {
  const rows = [
    growthRow({ year: 114, quarter: 1, period: "114Q1", peak: "上午尖峰", direction: "方向1", los: "E", travel: 30 }),
    growthRow({ year: 114, quarter: 2, period: "114Q2", peak: "上午尖峰", direction: "方向1", los: "F", travel: 25 }),
  ];
  const text = buildSpeedConclusion(
    rows,
    {
      ...SPEED_DEFAULT_CONDITION,
      scope: { kind: "project" },
      metrics: ["growth"],
      grouping: "overall",
      rowLevel: "representative",
    },
    GROWTH_META,
  );
  assert.match(text, /A路（平日）・上午尖峰・方向1：由 114Q1 至 114Q2/, text);
  assert.ok(!/→ 上午尖峰/.test(text), `同一個時段方向不該寫成「→」：\n${text}`);
});

test("⚠️ 逐筆明細的分組鍵不可以跟著放寬（不同尖峰／方向不可以比在一起）", () => {
  const text = buildSpeedConclusion(
    GROWTH_ROWS,
    {
      ...SPEED_DEFAULT_CONDITION,
      scope: { kind: "project" },
      metrics: ["growth"],
      grouping: "overall",
      rowLevel: "detail",
    },
    GROWTH_META,
  );
  /* 逐筆時「上午·方向1」與「下午·方向2」各自成一組，各自兩季，寫出兩行。 */
  assert.match(text, /上午尖峰・方向1：由 114Q1 至 114Q2/, text);
  assert.match(text, /下午尖峰・方向2：由 114Q1 至 114Q2/, text);
  assert.ok(
    !/→ 下午尖峰/.test(text),
    `逐筆明細不該把不同尖峰方向混成一組：\n${text}`,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  「C → D」要講出好壞方向與級數（使用者 2026-09-23 核准新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 舊版只寫「服務水準 C → D」。讀報告的人要自己記得 A 最好、F 最差才知道
 * 那是變差了；而畫面上的歷季服務水準圖早就寫著「等級變差了」。
 *
 * ⚠️ 這一支特別要釘住**方向不可以寫反**：
 *   app.js 用 losRank（A=6…F=1，越大越好），conclusion.js 用 LOS_ORDER
 *   的索引（A=0…F=5，越小越好），兩者方向相反。只驗一個方向的話，
 *   把大於小於寫反一樣會綠。所以 A→F 與 F→A 兩邊都驗。
 */
function losPair(before, after) {
  return buildSpeedConclusion(
    [
      growthRow({ year: 114, quarter: 1, period: "114Q1", peak: "上午尖峰", los: before }),
      growthRow({ year: 114, quarter: 2, period: "114Q2", peak: "上午尖峰", los: after }),
    ],
    {
      ...SPEED_DEFAULT_CONDITION,
      scope: { kind: "project" },
      metrics: ["growth"],
      grouping: "overall",
      rowLevel: "detail",
    },
    GROWTH_META,
  );
}

test("⚠️ 服務水準往 F 走要寫「變差」，往 A 走要寫「變好」（方向不可以寫反）", () => {
  assert.match(losPair("C", "D"), /服務水準 C → D（等級變差 1 級）/);
  assert.match(losPair("D", "C"), /服務水準 D → C（等級變好 1 級）/);
  /* 反證：把大於小於寫反的話，上面兩條之中必有一條會紅。 */
  assert.match(losPair("A", "F"), /服務水準 A → F（等級變差 5 級）/);
  assert.match(losPair("F", "A"), /服務水準 F → A（等級變好 5 級）/);
});

test("⚠️ 等級相同時寫「沒有變化」，不寫「變好 0 級」", () => {
  const text = losPair("D", "D");
  assert.match(text, /服務水準 D → D（等級沒有變化）/);
  assert.doesNotMatch(text, /變好 0 級|變差 0 級/);
});

test("⚠️ 任一季讀不出等級時不多寫一句（前面已經印了「?」）", () => {
  for (const pair of [["?", "D"], ["C", "?"], ["?", "?"]]) {
    const text = losPair(pair[0], pair[1]);
    assert.doesNotMatch(
      text,
      /等級變好|等級變差|等級沒有變化/,
      `${pair[0]} → ${pair[1]} 不該判定好壞方向：\n${text}`,
    );
  }
});
