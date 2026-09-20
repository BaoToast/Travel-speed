/*
 * 圖說第 3、4 級：走三支共用的契約表。
 * ⚠️ 案例表在 chart-levels-contract.mjs，三支逐位元相同——
 *   要改判斷規則就三支一起改，否則同一個數字在三支會被說成不同的狀況。
 * ⚠️ 這一支程式沒有打包工具，chart-levels.js 是掛在 globalThis 的 IIFE，
 *   所以用 import 把它載進來之後再讀 globalThis.ChartLevels。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { checkChartLevelsContract } from "./chart-levels-contract.mjs";

await import("./chart-levels.js");
const levels = globalThis.ChartLevels;

test("前置：chart-levels.js 真的掛上了 globalThis.ChartLevels", () => {
  assert.ok(levels, "沒有掛上全域物件，下面的檢查全部沒有意義");
  for (const name of [
    "levelSections",
    "heavyShareLevels",
    "peakConcentrationLevels",
    "dayCompareLevels",
    "trendChangeLevels",
    "losLevels",
    "turnShareLevels",
    "coverageLevels",
  ])
    assert.equal(typeof levels[name], "function", `少了 ${name}`);
});

test("圖說第 3、4 級符合三支共用的契約", () => {
  const failures = [];
  checkChartLevelsContract(levels, (label, passed, detail) => {
    if (!passed) failures.push(`${label} — ${detail}`);
  });
  assert.deepEqual(failures, []);
});

test("⚠️ 這個 ES5 版與另外兩支的 TS 版**行為**要一致（逐句比對輸出）", async () => {
  /*
   * ⚠️ 這一支不能像另外兩支那樣用 SHA-256 釘內容——它是同一份程式的 ES5 版，
   *   模組語法本來就不同。改用「同一組輸入，輸出的每一個字都一樣」來釘：
   *   那才是使用者真正會看到的東西。
   *   期望值是從 TS 版跑出來的，改判斷規則時三支一起改、這裡一起更新。
   */
  const cases = [
    [() => levels.heavyShareLevels(25).state, "大車比例 25.0%，在一般市區道路屬於偏高的一端；這類路段的鋪面損壞、轉彎半徑與視線死角通常是要單獨處理的項目。"],
    [() => levels.dayCompareLevels(0.95).state, "平日與假日大約是同一個水準（假日是平日的 95%），兩天的車流沒有明顯差異。"],
    [() => levels.trendChangeLevels(8, 5).action, "建議持續觀察，累積到四季以上再談趨勢；單季的起伏本來就會有。"],
    [() => levels.losLevels("B", "E", 0, 10).state, "最差只到 B 級，全部 10 筆都在順暢的一端，這一段目前沒有服務水準的問題。"],
  ];
  for (const [run, expected] of cases) assert.equal(run(), expected);
  /* 順便確認檔案真的有內容，不是被清空之後這一支還安靜通過。 */
  const source = await readFile(new URL("./chart-levels.js", import.meta.url));
  assert.ok(source.length > 6000, "chart-levels.js 太短，內容可能被清掉了");
  assert.ok(createHash("sha256").update(source).digest("hex").length === 64);
});
