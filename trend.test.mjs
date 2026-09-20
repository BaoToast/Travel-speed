/*
 * 歷季趨勢圖的資料與說明文字。
 *
 * ── 這一支要守的是什麼 ────────────────────────────────────────
 *
 * 使用者的話：單一計畫的趨勢圖「使用頻率很高，因為是要給業主的，
 * 所以資料正確性、圖表代表的意義很重要」。
 *
 * 所以這裡守的第一件事是**圖與說明文字不可以分岔**——
 * describeTrendChart() 只讀 buildTrendSeries() 的輸出，不碰原始資料。
 * 下面用「同一份 series 產生的文字裡，出現的數字必須來自那份 series」
 * 來釘住這件事。
 *
 * ⚠️ 假通過陷阱（這一支刻意迴避的）：
 *  一、只驗「文字裡有數字」沒有意義——隨便印一個數字都會過。
 *      所以要驗**具體的值**，而且是從 series.points 反推出來的期望值。
 *  二、只驗一個指標不夠：佔比、最差等級、平均值三類的寫法不同
 *      （百分點 vs 等級 vs 單位），三類都要有案例。
 *  三、百分比**不寫差值**。「從 14.3% 提升到 42.9%，增加 28.6%」是錯的寫法，
 *      「增加 28.6%」會被讀成「原本的 14.3% 再增加 28.6%」。
 *      改成講頭尾兩個值、倍數與實際條數（使用者要求講白話，
 *      所以也不用「個百分點」這種書面語）。這一項要有反面斷言。
 *  四、缺值（LOS 判不出來）不可以被當成「不壅塞」而稀釋佔比——
 *      分母要用「判定得出等級的筆數」。這一項用一個含缺值的案例釘住。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const {
  buildTrendSeries,
  buildBandSeries,
  describeTrendChart,
  trendScript,
  trendMetricLabel,
  alignTrendSeriesForExcel,
} = require("./trend.js");

test("三段組成保留實際最差等級，不可用分界或 F 級反猜", () => {
  const series = buildBandSeries(
    [
      { period: "115Q1", road: "甲", los: "C" },
      { period: "115Q1", road: "乙", los: "D" },
      { period: "115Q2", road: "甲", los: "E" },
      { period: "115Q2", road: "乙", los: "C" },
    ],
    { bands: { smoothEnd: "B", congestedStart: "E" } },
  );
  assert.equal(series.points[0].worstLos, "D", "沒有壅塞筆數時，最差仍應是實際的 D 級");
  assert.equal(series.points[1].worstLos, "E", "有壅塞筆數時，不可一律猜成 F 級");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const at = app.indexOf("var bandLevels =");
  assert.notEqual(at, -1, "找不到三段組成的第 3、4 級說明");
  const block = app.slice(at, at + 500);
  assert.ok(block.includes("last.worstLos"), "畫面說明沒有使用資料層保存的實際最差等級");
  assert.ok(!block.includes("LOS_GRADES[LOS_GRADES.length - 1]"), "畫面仍把有壅塞時一律猜成 F 級");
});

test("Excel 匯出以所有數列的季度聯集精確對位，缺季保留空白", () => {
  const aligned = alignTrendSeriesForExcel(
    [
      {
        label: "平日",
        unit: "km/h",
        points: [
          { period: "113Q1", value: 10 },
          { period: "113Q3", value: 30 },
        ],
      },
      {
        label: "假日",
        unit: "km/h",
        points: [
          { period: "113Q2", value: 20 },
          { period: "113Q3", value: 33 },
          { period: "113Q4", value: 40 },
        ],
      },
    ],
    (a, b) => Number(a.slice(0, 3)) * 4 + Number(a.at(-1)) - (Number(b.slice(0, 3)) * 4 + Number(b.at(-1))),
  );
  assert.deepEqual(aligned.periods, ["113Q1", "113Q2", "113Q3", "113Q4"]);
  assert.deepEqual(aligned.series[0].values, [10, null, 30, null]);
  assert.deepEqual(aligned.series[1].values, [null, 20, 33, 40]);
});

/** 每一季給一組等級，組出彙總紀錄。 */
function rowsFrom(byPeriod, extra = []) {
  const rows = [];
  for (const [period, grades] of Object.entries(byPeriod))
    grades.forEach((los, index) =>
      rows.push({
        period,
        road: `路段${index}`,
        day: "平日",
        los,
        travel: 40 - index * 2,
        running: 45 - index * 2,
        totalDelay: 30 + index * 5,
        ratio: (40 - index * 2) / 50,
      }),
    );
  return rows.concat(extra);
}

const FOUR_SEASONS = {
  "113Q3": ["A", "A", "B", "C", "C", "D", "E"],
  "113Q4": ["A", "B", "B", "C", "D", "E", "E"],
  "114Q1": ["A", "B", "C", "C", "D", "E", "F"],
  "114Q2": ["B", "B", "C", "D", "E", "E", "F"],
};

test("佔比的分母是「判定得出等級」的筆數，缺值不可以稀釋佔比", () => {
  /* 多加一筆讀不到速率的紀錄：它不可以被當成「不壅塞」而讓佔比下降。 */
  const withUnknown = rowsFrom(FOUR_SEASONS, [
    {
      period: "114Q2",
      road: "路段X",
      day: "平日",
      los: "?",
      travel: null,
      running: null,
      totalDelay: null,
      ratio: null,
    },
  ]);
  const series = buildTrendSeries(withUnknown, {
    metric: "congestedShare",
    congestedStart: "E",
  });
  const last = series.points[series.points.length - 1];
  assert.equal(last.sampleSize, 8, "該季總共 8 筆");
  assert.equal(last.gradedSize, 7, "其中 7 筆判定得出等級");
  assert.equal(last.unknownSize, 1);
  assert.equal(last.congestedCount, 3, "E、E、F 共 3 筆");
  /* 3/7 而不是 3/8——用 8 當分母就是把缺值算成好消息 */
  assert.equal(
    Math.round(last.value * 10) / 10,
    42.9,
    "分母必須是 7（判定得出等級的筆數），不是 8",
  );
});

test("三段分界改了，指標名稱要跟著改（不可以寫死）", () => {
  assert.equal(trendMetricLabel("congestedShare", { congestedStart: "E" }), "E 級以下路段佔比");
  assert.equal(trendMetricLabel("congestedShare", { congestedStart: "D" }), "D 級以下路段佔比");
  const d = buildTrendSeries(rowsFrom(FOUR_SEASONS), {
    metric: "congestedShare",
    congestedStart: "D",
  });
  assert.equal(d.label, "D 級以下路段佔比");
  /* 分界放寬到 D，壅塞筆數一定不會變少 */
  const e = buildTrendSeries(rowsFrom(FOUR_SEASONS), {
    metric: "congestedShare",
    congestedStart: "E",
  });
  d.points.forEach((point, index) =>
    assert.ok(
      point.congestedCount >= e.points[index].congestedCount,
      `${point.period}：分界放寬到 D 之後壅塞筆數不可以變少`,
    ),
  );
});

test("說明文字裡的數字必須來自同一份 series，不可以自己算一遍", () => {
  const series = buildTrendSeries(rowsFrom(FOUR_SEASONS), {
    metric: "congestedShare",
    congestedStart: "E",
  });
  const text = trendScript(
    describeTrendChart(series, { scopeText: "全部路段（平日）" }),
  );
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  const show = (value) => String(Math.round(value * 10) / 10);
  assert.ok(
    text.includes(show(first.value) + "%"),
    `說明裡應該出現第一季的值 ${show(first.value)}%`,
  );
  assert.ok(
    text.includes(show(last.value) + "%"),
    `說明裡應該出現最後一季的值 ${show(last.value)}%`,
  );
  assert.ok(
    text.includes(`${last.gradedSize} 條裡有 ${last.congestedCount} 條`),
    "說明裡應該出現最新一季的實際條數",
  );
});

test("百分比的差要接在頭尾兩個值後面，而且同時給倍數讓使用者自己挑", () => {
  const series = buildTrendSeries(rowsFrom(FOUR_SEASONS), {
    metric: "congestedShare",
    congestedStart: "E",
  });
  const text = trendScript(describeTrendChart(series, { scopeText: "全部路段" }));
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  const show = (value) => String(Math.round(value * 10) / 10);
  const delta = show(Math.abs(last.value - first.value));

  /*
   * 關鍵是**順序**：差值必須出現在頭尾兩個值之後。
   * 有前文的時候「增加 28.6%」看得出是怎麼算的；沒有前文才有歧義。
   * 所以這裡直接驗整句話的形狀，而不是只驗「有沒有出現 28.6%」。
   */
  const sentence = new RegExp(
    `${show(first.value)}%[^。]*${show(last.value)}%[^。]*${delta}%`,
  );
  assert.ok(
    sentence.test(text),
    `差值要接在頭尾兩個值後面：預期 …${show(first.value)}% …${show(last.value)}% …${delta}%`,
  );

  /* 倍數也要給，讓使用者自己決定要講哪一種 */
  assert.ok(/大約是原來的 [\d.]+ 倍/.test(text), "百分比要同時給倍數");

  /* 使用者要求講白話，不用「個百分點」這種書面語 */
  assert.ok(!text.includes("個百分點"), "不用「個百分點」");

  /*
   * 反面斷言：單季變化那一句沒有前文，所以**不可以**只寫一個差值，
   * 要寫「從多少到多少」。
   */
  assert.ok(
    /單季變化最大的是[^。]*→[^。]*（[^）]*→[^）]*）/.test(text),
    "單季變化要寫成「從多少 → 到多少」，不可以只寫差值",
  );
});

test("百分比要用實際條數再講一次，這是最不會被誤讀的說法", () => {
  const series = buildTrendSeries(rowsFrom(FOUR_SEASONS), {
    metric: "congestedShare",
    congestedStart: "E",
  });
  const text = trendScript(describeTrendChart(series, { scopeText: "全部路段" }));
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  assert.ok(
    text.includes(`${first.gradedSize} 條裡有 ${first.congestedCount} 條壅塞`),
    "要寫出第一季的實際條數",
  );
  assert.ok(
    text.includes(`${last.gradedSize} 條裡有 ${last.congestedCount} 條`),
    "要寫出最後一季的實際條數",
  );
});

test("有實體單位的指標照寫差值（不會被誤讀），而且用白話動詞", () => {
  /* 延滯要真的不一樣，否則會被判成「大致持平」而不寫差值。 */
  const series = buildTrendSeries(
    [
      { period: "115Q1", road: "甲", day: "平日", los: "B", totalDelay: 40 },
      { period: "115Q1", road: "乙", day: "平日", los: "B", totalDelay: 44 },
      { period: "115Q2", road: "甲", day: "平日", los: "D", totalDelay: 68 },
      { period: "115Q2", road: "乙", day: "平日", los: "D", totalDelay: 72 },
    ],
    { metric: "totalDelay" },
  );
  const text = trendScript(describeTrendChart(series, { scopeText: "全部路段" }));
  /* 有實體單位的差值不會被誤讀，照樣接在頭尾兩個值後面寫出來 */
  assert.ok(
    /42 秒[^。]*70 秒[^。]*28 秒/.test(text),
    "延滯要寫成「從 42 秒，到 70 秒，…28 秒」",
  );
  assert.ok(!text.includes("個百分點"), "不可以出現「個百分點」");
  /* 非百分比不寫倍數——「延滯是原來的 1.7 倍」不是一般報告的講法 */
  assert.ok(!/大約是原來的/.test(text), "非百分比的指標不寫倍數");
});

test("最差等級是序數，不寫差值，而且要附上「這是最差值不是平均」的提醒", () => {
  const series = buildTrendSeries(rowsFrom(FOUR_SEASONS), {
    metric: "worstLos",
    congestedStart: "E",
  });
  const description = describeTrendChart(series, { scopeText: "全部路段" });
  const text = trendScript(description);
  assert.ok(text.includes("E 級"), "第一季最差是 E 級");
  assert.ok(text.includes("F 級"), "最後一季最差是 F 級");
  assert.ok(!/變化幅度/.test(text), "等級不做減法，不可以寫變化幅度");
  assert.ok(
    description.caveats.some((item) => item.includes("最差值")),
    "要提醒這是最差值不是平均",
  );
});

test("平均類的指標要帶單位，而且單位與數字之間要有空白", () => {
  const series = buildTrendSeries(rowsFrom(FOUR_SEASONS), { metric: "travel" });
  const text = trendScript(describeTrendChart(series, { scopeText: "全部路段" }));
  assert.ok(/\d+(?:\.\d+)? km\/h/.test(text), "旅行速率要寫成「34 km/h」");
  assert.ok(!/\d+km\/h/.test(text), "數字與單位不可以黏在一起");
});

test("缺值的警語要跟著指標換說法，不可以對平均類的指標講「分母」", () => {
  const withUnknown = rowsFrom(FOUR_SEASONS, [
    { period: "114Q2", road: "路段X", day: "平日", los: "?", travel: null, running: null, totalDelay: null, ratio: null },
  ]);
  const share = describeTrendChart(
    buildTrendSeries(withUnknown, { metric: "congestedShare", congestedStart: "E" }),
    { scopeText: "全部路段" },
  );
  assert.ok(
    share.caveats.some((item) => item.includes("不列入分母")),
    "佔比類要講分母",
  );
  const travel = describeTrendChart(
    buildTrendSeries(withUnknown, { metric: "travel" }),
    { scopeText: "全部路段" },
  );
  assert.ok(
    travel.caveats.some((item) => item.includes("沒有數值可以納入平均")),
    "平均類要講平均，不可以講分母",
  );
  assert.ok(
    !travel.caveats.some((item) => item.includes("分母")),
    "平均類的警語不可以出現「分母」",
  );
});

test("平均類指標要用該欄位的有效數值當分母，不可以拿 LOS 筆數代替", () => {
  const rows = rowsFrom({ "115Q1": ["A", "B", "C"] });
  rows[1].travel = null; // LOS 有值，但旅行速率缺值
  const series = buildTrendSeries(rows, { metric: "travel" });
  const point = series.points[0];
  assert.equal(point.gradedSize, 3, "三筆都判定得出 LOS");
  assert.equal(point.valueSize, 2, "旅行速率只有兩筆有效數值");
  assert.equal(point.missingValueSize, 1);
  assert.equal(point.value, (40 + 36) / 2, "平均只能除以兩筆有效旅行速率");
  const description = describeTrendChart(series, { scopeText: "全部路段" });
  assert.ok(
    description.caveats.some(
      (item) => item.includes("1 筆") && item.includes("沒有數值可以納入平均"),
    ),
    "圖說要依旅行速率本身的缺值數提醒",
  );
});

test("頭尾季度之間完全缺少一季時要補空點，折線不可以直接跨過去", () => {
  const series = buildTrendSeries(
    rowsFrom({ "115Q1": ["A"], "115Q3": ["B"] }),
    { metric: "travel" },
  );
  assert.deepEqual(
    series.points.map((point) => point.period),
    ["115Q1", "115Q2", "115Q3"],
  );
  assert.equal(series.points[1].value, null, "115Q2 必須是空值而不是 0");
  const description = describeTrendChart(series, { scopeText: "全部路段" });
  assert.ok(description.caveats.some((item) => item.includes("115Q2")));
});

test("平日加假日一起看時要誠實標示為路段日別紀錄，不可誤稱唯一道路數", () => {
  const series = buildTrendSeries(rowsFrom({ "115Q1": ["A", "F"] }), {
    metric: "congestedShare",
    congestedStart: "E",
    populationLabel: "路段日別紀錄",
    sampleLabel: "筆路段日別紀錄",
  });
  assert.equal(series.label, "E 級以下路段日別紀錄佔比");
  assert.equal(series.sampleLabel, "筆路段日別紀錄");
});

test("樣本數太少時要主動提醒跳動會被放大", () => {
  const tiny = buildTrendSeries(
    rowsFrom({ "115Q1": ["A", "E", "F"], "115Q2": ["A", "A", "F"] }),
    { metric: "congestedShare", congestedStart: "E" },
  );
  const description = describeTrendChart(tiny, { scopeText: "小計畫" });
  assert.ok(
    description.caveats.some((item) => item.includes("只有 3 條")),
    "只有 3 條路段時要提醒",
  );
  assert.ok(
    description.caveats.some((item) => item.includes("0%、33%、67%、100%")),
    "要把「這個佔比只可能是哪幾個值」列出來，比講幾個百分點更白話",
  );
  assert.ok(
    description.caveats.every((item) => !item.includes("個百分點")),
    "不可以出現「個百分點」",
  );
});

test("中間缺季不可以讓 0 筆遮掉其他季度的樣本過少提醒", () => {
  const tinyWithGap = buildTrendSeries(
    rowsFrom({ "115Q1": ["A", "E", "F"], "115Q3": ["A", "A", "F"] }),
    { metric: "congestedShare", congestedStart: "E" },
  );
  const description = describeTrendChart(tinyWithGap, { scopeText: "小計畫" });
  assert.equal(tinyWithGap.points[1].gradedSize, 0, "115Q2 是補出的空季");
  assert.ok(
    description.caveats.some((item) => item.includes("只有 3 條")),
    "空季之外，有資料季度仍只有 3 條，警告不可消失",
  );
});

test("平均類指標缺值時要說缺少該指標數值，不可一律誤稱讀不到速率", () => {
  const rows = rowsFrom({ "115Q1": ["A", "B"] });
  rows[1].totalDelay = null;
  const series = buildTrendSeries(rows, { metric: "totalDelay" });
  const description = describeTrendChart(series, { scopeText: "全部路段" });
  assert.ok(description.caveats.some((item) => item.includes("缺少這個指標的有效數值")));
  assert.ok(description.caveats.every((item) => !item.includes("讀不到速率")));
});

test("只有一季或沒有資料時要說得出來，不可以硬掰趨勢", () => {
  const one = buildTrendSeries(rowsFrom({ "115Q2": ["A", "B", "E"] }), {
    metric: "congestedShare",
    congestedStart: "E",
  });
  const oneText = trendScript(describeTrendChart(one, { scopeText: "單季" }));
  assert.ok(oneText.includes("還看不出趨勢"), "只有一季要明說看不出趨勢");
  assert.ok(!/整體上升|整體下降/.test(oneText), "只有一季不可以說走勢");

  const none = buildTrendSeries([], { metric: "congestedShare" });
  const noneText = trendScript(describeTrendChart(none, { scopeText: "空的" }));
  assert.ok(noneText.includes("沒有可以繪製的資料"), "沒有資料要說出來");
});

test("斷季（某一季沒有資料）要講出來，不可以讓人以為是 0", () => {
  const series = buildTrendSeries(
    rowsFrom({ "115Q1": ["A", "B"], "115Q2": ["?", "?"] }),
    { metric: "congestedShare", congestedStart: "E" },
  );
  const description = describeTrendChart(series, { scopeText: "全部路段" });
  assert.ok(
    description.caveats.some((item) => item.includes("線在那裡是斷開的")),
    "沒有數值的季度要說明線是斷的，不是 0",
  );
});

/*
 * ⚠️ 2026-09-17：跨計畫比較的測試整段移除。
 *
 * 那兩支函式（buildCrossProjectTrend／describeCrossProjectTrend）是死程式——
 * 「跨計畫比較」在畫面上早就拿掉了，**只剩這一段測試在呼叫它們**。
 * 測一個沒有任何畫面會用到的函式，唯一的作用是讓測試數字變好看；
 * 更糟的是它會讓人以為那條路徑還受保護，於是改 buildTrendSeries 時
 * 連帶改壞了也沒人發現。函式與測試一起移除。
 * 《加總與並列稽核_三支程式_20260916》第六節。
 */
