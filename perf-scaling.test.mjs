/*
 * ══════════════════════════════════════════════════════════════════════
 *  效能：資料變多的時候，時間要跟著「線性」變多，不可以變成平方
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-23：
 *   「請確保程式性能上不要有 Lag 情況發生，隨著程式越來越完善，
 *     性能方面也很重要，要能順暢跑每一筆資料」
 *   「如果效能上不會有延遲問題，沒做改變也是合理的」
 *
 * ── 這一支守什麼、不守什麼 ──────────────────────────────────
 *
 * ⚠️ **不守絕對毫秒數。** 測試跑在什麼機器上完全不受控（CI、容器、
 *   使用者的筆電、有沒有別的工作在搶 CPU），釘一個絕對秒數只會造成
 *   「有時候紅、重跑就綠」——而那種測試最後一定會被關掉或加 retry，
 *   等於這一支從此不存在。
 *
 * ✅ **守的是成長的形狀。** 資料量乘以 R 倍時，時間也應該大約乘以 R 倍
 *   （線性）。如果某個地方寫成「每一筆都重掃一次全表」，時間會乘以 R²——
 *   10 倍資料變成 100 倍時間。這種缺陷在小資料上**完全看不出來**，
 *   要等使用者累積了好幾季、好幾十個路段才會突然變慢，
 *   而那時候已經很難回頭找是哪一次改動造成的。
 *
 * ── 為什麼門檻訂得鬆 ────────────────────────────────────────
 *
 * 小資料那一次的耗時很短，量測雜訊佔比高；再加上 JIT 暖機、GC 時機，
 * 比值本來就會抖。所以：
 *   ・先暖機再量，取**中位數**（不是平均，平均會被單一次 GC 拉走）
 *   ・門檻訂在 R 的 3 倍（R=10 → 允許到 30 倍）
 *     線性大約是 10、平方是 100，30 落在中間且離兩邊都夠遠
 *   ・小資料那一次太快（量不準）時**自動放大樣本重量**，不是直接視為通過
 *     （第一版就是「直接通過」，結果三項裡有兩項根本沒驗到而測試全綠）
 *
 * ⚠️ 最後那一支是**反證**：拿一個刻意寫成平方的函式餵給同一套量測，
 *   它必須變紅。沒有這一段的話，門檻訂錯（例如訂成 1000）也沒人知道。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  SPEED_DEFAULT_CONDITION,
  SPEED_CONCLUSION_METRICS,
  buildSpeedConclusion,
} = require("./conclusion.js");
const { buildTrendSeries, buildBandSeries, describeTrendChart } =
  require("./trend.js");
await import("./chart-levels.js");

const META = {
  projectName: "效能測試計畫",
  systemVersion: "v0",
  generatedAt: "2026-09-23 10:00",
  bandsOf: () => ({ smoothEnd: "B", congestedStart: "E" }),
  worstOf: (rows) =>
    rows.reduce((worst, row) =>
      "ABCDEF".indexOf(row.los) > "ABCDEF".indexOf(worst.los) ? row : worst,
    ),
};

/** 產生 n 筆「長得像真的」的尖峰方向紀錄。 */
function corpus(n) {
  const rows = [];
  const grades = ["A", "B", "C", "D", "E", "F"];
  for (let i = 0; i < n; i += 1) {
    const quarter = 114 + Math.floor(i / 400);
    rows.push({
      projectCode: "P1",
      projectName: "效能測試計畫",
      period: `${quarter}Q${(i % 4) + 1}`,
      road: `路段${i % 40}`,
      day: i % 2 ? "平日" : "假日",
      peak: i % 3 ? "上午尖峰" : "下午尖峰",
      direction: i % 2 ? "方向1" : "方向2",
      directionText: i % 2 ? "甲路口--->乙路口" : "乙路口--->甲路口",
      travel: 20 + (i % 37),
      running: 30 + (i % 29),
      roadDelay: 10 + (i % 50),
      junctionDelay: 5 + (i % 30),
      totalDelay: 15 + (i % 80),
      limit: 50,
      ratio: 0.4 + ((i % 50) / 100),
      los: grades[i % 6],
    });
  }
  return rows;
}

/** 跑幾次取中位數；先暖機，避免把 JIT 的第一次算進去。 */
function medianMs(run, times = 5) {
  run();
  run();
  const samples = [];
  for (let i = 0; i < times; i += 1) {
    const started = process.hrtime.bigint();
    run();
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/**
 * 量「資料乘以 RATIO 倍時，時間乘以幾倍」。
 *
 * @returns {{ small:number, big:number, factor:number, ok:boolean, why:string }}
 */
const RATIO = 10;
const ALLOWED = RATIO * 3; // 線性≈10、平方≈100；30 離兩邊都夠遠

function scaling(label, sizeSmall, make) {
  /*
   * ⚠️ 小的那一次如果快到 1ms 以內，量測雜訊會讓比值毫無意義
   *   （0.2ms → 3ms 也會算成 15 倍）。
   *
   *   第一版遇到這種情形是「直接視為通過」——結果三項裡有兩項落進這個
   *   分支，等於**那兩項根本沒驗到**，而測試是綠的。那正是這個專案反覆
   *   出現的「假的綠」。
   *
   *   現在改成**把樣本放大再量一次**（最多放大兩輪）。放大之後還是
   *   量不出來，代表那段程式快到在任何實務資料量下都不可能造成延遲，
   *   那時候才視為通過，而且訊息會寫明是「放大到 N 筆仍然量不出來」。
   */
  let base = sizeSmall;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const small = medianMs(make(base));
    const big = medianMs(make(base * RATIO));
    if (small >= 1) {
      const factor = big / small;
      return {
        small,
        big,
        factor,
        ok: factor <= ALLOWED,
        why:
          `${label}：${base} 筆 ${small.toFixed(1)}ms → ` +
          `${base * RATIO} 筆 ${big.toFixed(1)}ms（${factor.toFixed(1)} 倍）`,
      };
    }
    if (attempt === 2)
      return {
        small,
        big,
        factor: big / small,
        ok: true,
        why:
          `${label}：放大到 ${base} 筆仍只花 ${small.toFixed(2)}ms` +
          `（${base * RATIO} 筆 ${big.toFixed(2)}ms）——` +
          "在任何實務資料量下都不可能造成延遲",
      };
    base *= 10;
  }
  throw new Error("unreachable");
}

test("⚠️ 結論草稿：資料 ×10 時間不可以 ×100（線性，不是平方）", () => {
  const condition = {
    ...SPEED_DEFAULT_CONDITION,
    scope: { kind: "project" },
    metrics: SPEED_CONCLUSION_METRICS.map((metric) => metric.key),
    grouping: "byRoad",
  };
  const result = scaling("結論草稿（全部指標）", 300, (size) => {
    const rows = corpus(size);
    return () => buildSpeedConclusion(rows, condition, META);
  });
  console.log("  " + result.why);
  assert.ok(
    result.ok,
    `${result.why}\n` +
      `成長倍數超過 ${ALLOWED}——資料量一大就會卡。\n` +
      "常見成因是「對每一筆再掃一次全表」（巢狀迴圈、在迴圈裡 filter／find／indexOf）。",
  );
});

test("⚠️ 歷季趨勢：資料 ×10 時間不可以 ×100", () => {
  const result = scaling("歷季趨勢（含圖說）", 300, (size) => {
    const rows = corpus(size);
    return () => {
      const series = buildTrendSeries(rows, {
        metric: "worstLos",
        congestedStart: "E",
      });
      describeTrendChart(series, { scopeText: "全部路段" });
    };
  });
  console.log("  " + result.why);
  assert.ok(result.ok, `${result.why}\n成長倍數超過 ${ALLOWED}。`);
});

test("⚠️ 三段分法：資料 ×10 時間不可以 ×100", () => {
  const result = scaling("三段分法", 300, (size) => {
    const rows = corpus(size);
    return () =>
      buildBandSeries(rows, {
        bands: { smoothEnd: "B", congestedStart: "E" },
        bandsOf: () => ({ smoothEnd: "B", congestedStart: "E" }),
        comparePeriod: (a, b) => String(a).localeCompare(String(b)),
      });
  });
  console.log("  " + result.why);
  assert.ok(result.ok, `${result.why}\n成長倍數超過 ${ALLOWED}。`);
});

test("⚠️ 這一支真的抓得到平方成長（反證，不然門檻訂錯也沒人知道）", () => {
  /*
   * 刻意寫成「每一筆都掃一次全表」——這正是要防的那一種寫法。
   * 它必須被判成不合格；判成合格就代表門檻訂得太鬆，整支形同虛設。
   */
  const quadratic = (size) => {
    const rows = corpus(size);
    return () => {
      let hits = 0;
      for (const row of rows)
        for (const other of rows) if (other.road === row.road) hits += 1;
      return hits;
    };
  };
  /*
   * ⚠️ 起始樣本直接給 3000，不從 300 開始。
   *   從 300 開始的話會自動放大到 30000，而平方寫法在 30000 筆要跑 10 秒（量測要跑 7 次＝70 秒）——
   *   一支要跑 10 秒的反證，下一個人就會把它砍掉。
   */
  const result = scaling("刻意寫壞的平方寫法", 1000, quadratic);
  console.log("  （反證）" + result.why);
  assert.ok(
    !result.ok,
    `平方寫法竟然通過了（${result.factor.toFixed(1)} 倍 ≤ ${ALLOWED}）——` +
      "門檻太鬆，這一支守不到任何東西",
  );

  /* 反面的反面：真正的線性寫法要通過，否則這一支會誤殺正常程式。 */
  const linear = (size) => {
    const rows = corpus(size);
    return () => {
      const byRoad = new Map();
      for (const row of rows)
        byRoad.set(row.road, (byRoad.get(row.road) || 0) + 1);
      return byRoad.size;
    };
  };
  const good = scaling("正常的線性寫法", 30000, linear);
  console.log("  （反證）" + good.why);
  assert.ok(good.ok, `線性寫法被誤判成不合格：${good.why}`);
});
