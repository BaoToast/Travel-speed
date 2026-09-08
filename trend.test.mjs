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

const require = createRequire(import.meta.url);
const {
  buildTrendSeries,
  describeTrendChart,
  trendScript,
  trendMetricLabel,
} = require("./trend.js");

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

/* ══════════════════════════════════════════════════════════════════
 * 跨計畫比較
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者特別提醒過：各計畫的路段數不一定相同。這是跨計畫比較最容易
 * 被質疑、也最容易做錯的地方——比條數會得到相反的結論。
 *
 * ⚠️ 假通過陷阱：
 *  一、只驗「有回傳幾條線」不夠。要驗**條數多的計畫不會因為條數多
 *      就顯得比較糟**——用一個「條數多但比例低」對上「條數少但比例高」
 *      的案例，驗系統指出的是後者。
 *  二、說明文字一定要把路段數不同講出來，否則使用者拿去簡報會被問倒。
 */
const { buildCrossProjectTrend, describeCrossProjectTrend } = require("./trend.js");

function project(code, name, byPeriod) {
  return { code, name, rows: rowsFrom(byPeriod), congestedStart: "E" };
}

test("跨計畫比的是比例，不是條數——條數多的不會因此顯得比較糟", () => {
  /* 甲：20 條裡 8 條壅塞（40%）／乙：5 條裡 3 條壅塞（60%） */
  const big = Array(12).fill("A").concat(Array(8).fill("F"));
  const small = ["A", "A", "F", "F", "F"];
  const list = buildCrossProjectTrend(
    [
      project("BIG", "甲計畫", { "115Q1": big, "115Q2": big }),
      project("SMALL", "乙計畫", { "115Q1": small, "115Q2": small }),
    ],
    { metric: "congestedShare", congestedStart: "E" },
  );
  const [bigSeries, smallSeries] = list;
  assert.equal(bigSeries.points[0].congestedCount, 8, "甲有 8 條壅塞");
  assert.equal(smallSeries.points[0].congestedCount, 3, "乙有 3 條壅塞");
  /* 條數是甲多，但比例是乙高——圖上畫的必須是比例 */
  assert.ok(
    smallSeries.points[0].value > bigSeries.points[0].value,
    `乙的比例（${smallSeries.points[0].value}%）必須高於甲（${bigSeries.points[0].value}%），` +
      "否則就是用條數在比",
  );
  assert.equal(Math.round(bigSeries.points[0].value), 40);
  assert.equal(Math.round(smallSeries.points[0].value), 60);
});

test("跨計畫的說明一定要講出「各計畫路段數不一樣」", () => {
  const list = buildCrossProjectTrend(
    [
      project("BIG", "甲計畫", {
        "115Q1": Array(12).fill("A").concat(Array(8).fill("F")),
        "115Q2": Array(10).fill("A").concat(Array(10).fill("F")),
      }),
      project("SMALL", "乙計畫", {
        "115Q1": ["A", "A", "F", "F", "F"],
        "115Q2": ["A", "A", "A", "F", "F"],
      }),
    ],
    { metric: "congestedShare", congestedStart: "E" },
  );
  const description = describeCrossProjectTrend(list, {});
  assert.ok(
    description.meaning.includes("不用總數"),
    "說明要講清楚比的是比例不是總數",
  );
  assert.ok(
    description.caveats.some((item) => item.includes("路段數不一樣")),
    "一定要把路段數不同講出來",
  );
  assert.ok(
    description.caveats.some((item) => item.includes("甲計畫 20 條")),
    "要標出各計畫實際的路段數",
  );
  assert.ok(
    description.caveats.some((item) => item.includes("5 條以下")),
    "路段數 5 條以下的計畫要另外提醒",
  );
});

test("跨計畫的說明要分開指出惡化與改善幅度，不可把較小的惡化誤稱變化最大", () => {
  const list = buildCrossProjectTrend(
    [
      /* 甲：40% → 60%，變差 */
      project("BAD", "惡化計畫", {
        "115Q1": ["A", "A", "A", "F", "F"],
        "115Q2": ["A", "A", "F", "F", "F"],
      }),
      /* 乙：60% → 20%，改善 */
      project("GOOD", "改善計畫", {
        "115Q1": ["A", "A", "F", "F", "F"],
        "115Q2": ["A", "A", "A", "A", "F"],
      }),
    ],
    { metric: "congestedShare", congestedStart: "E" },
  );
  const description = describeCrossProjectTrend(list, {});
  /* 惡化 +20、改善 -40；若寫「變化最大」應是改善計畫，不能拿方向排序冒充絕對變化。 */
  assert.ok(
    description.observed.startsWith("惡化幅度最大的是「惡化計畫」"),
    `應明確寫成惡化幅度，實際：${description.observed.slice(0, 50)}`,
  );
  assert.ok(
    description.observed.includes("改善幅度最大的是「改善計畫」"),
    "改善幅度要獨立說明",
  );
});

test("跨計畫壅塞佔比必須套同一個共同門檻，不能各用各的定義", () => {
  const rows = rowsFrom({ "115Q1": ["D", "E"] });
  const list = buildCrossProjectTrend(
    [
      { code: "D", name: "原本D門檻", rows, congestedStart: "D" },
      { code: "E", name: "原本E門檻", rows, congestedStart: "E" },
    ],
    { metric: "congestedShare", congestedStart: "E" },
  );
  assert.deepEqual(list.map((series) => series.congestedStart), ["E", "E"]);
  assert.deepEqual(list.map((series) => series.points[0].value), [50, 50]);
});
