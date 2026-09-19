/*
 * ══════════════════════════════════════════════════════════════════
 *  稽核表 M：Excel 匯出不准無聲蓋掉重複的紀錄
 * ══════════════════════════════════════════════════════════════════
 *
 * 《加總與並列稽核_三支程式_20260916》第三節 M：
 *   「同一路段、同一季、同一日別若出現兩筆，後者會無聲蓋掉前者，
 *     Excel 上看不出來」（中；目前不會產生，但沒有防護）
 *
 * 「不會發生」和「發生了會被擋下來」是兩件事。這一份 Excel 是要交出去的，
 * 少一列而且沒有任何標示，收件的人不可能查得出來。
 *
 * 規則與整支程式一致：**系統不替調查資料做決定**——不挑一個、不平均，
 * 直接擋下整份匯出並說出是哪幾筆。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**要驗「數值相同時照樣匯得出來」**。只驗「重複就擋」的話，
 *     一個「只要 key 重複就擋」的粗暴實作也會全綠，而那會把「同一筆被讀進來兩次」
 *     這種無害情況也擋掉，使用者匯不出東西卻找不到原因。
 * 二、**要驗錯誤訊息講得出是哪一筆**。只驗「有丟錯」的話，
 *     一句「匯出失敗」也會過，那等於把工作丟回給使用者。
 * 三、這支測的是 excel-export.js 裡實際在跑的那個 prepare()，用文字抽出來 eval，
 *     不是另外抄一份——抄一份會出現「測試過了但網站沒改到」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFunction } from "./parse-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "excel-export.js"), "utf8");

const prepare = new Function(
  `${extractFunction("periodOrder", source)}\n${extractFunction("prepare", source)}\nreturn prepare;`,
)();

const row = (over = {}) => ({
  projectCode: "P1",
  projectName: "測試計畫",
  road: "中山路",
  period: "115Q1",
  day: "平日",
  travel: 32.5,
  ...over,
});

test("正常資料匯得出來（前置：這個不過的話下面全部恆真）", () => {
  const groups = prepare([
    row({ period: "115Q1", day: "平日", travel: 32.5 }),
    row({ period: "115Q1", day: "假日", travel: 30.1 }),
    row({ period: "115Q2", day: "平日", travel: 33.0 }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].periods.length, 2);
  assert.equal(groups[0].periods[0].weekday, 32.5);
  assert.equal(groups[0].periods[0].holiday, 30.1);
});

test("⚠️ 稽核表 M：同一路段×季度×日別數值不同時，整份擋下來", () => {
  assert.throws(
    () =>
      prepare([
        row({ travel: 32.5 }),
        row({ travel: 28.9 }) /* 同路段、同季、同日別，數字不同 */,
      ]),
    (error) => {
      /* 要講得出是哪一筆，也要講明系統不自行挑選——只丟「匯出失敗」不算。 */
      assert.match(error.message, /不會自行挑選或平均/);
      assert.match(error.message, /中山路/);
      assert.match(error.message, /115Q1/);
      assert.match(error.message, /平日/);
      assert.match(error.message, /32\.5/);
      assert.match(error.message, /28\.9/);
      return true;
    },
  );
});

test("⚠️ 數值相同的重複不算衝突，照樣匯得出來（不可以粗暴地看 key 就擋）", () => {
  const groups = prepare([row({ travel: 32.5 }), row({ travel: 32.5 })]);
  assert.equal(groups[0].periods[0].weekday, 32.5);
});

test("假日那一欄同樣守得住（只守平日的話等於守了一半）", () => {
  assert.throws(
    () =>
      prepare([
        row({ day: "假日", travel: 30.1 }),
        row({ day: "假日", travel: 27.4 }),
      ]),
    /假日/,
  );
});

test("不同路段、不同季別本來就該各自成立，不可以被誤擋", () => {
  const groups = prepare([
    row({ road: "中山路", travel: 32.5 }),
    row({ road: "中正路", travel: 28.9 }),
    row({ period: "115Q2", travel: 28.9 }),
  ]);
  assert.equal(groups.length, 2);
});

/*
 * ── 反證（2026-09-17 實跑）────────────────────────────────────
 * 把 prepare() 裡的衝突判斷改回舊寫法（`if (r.day === "平日") p.weekday = r.travel;`）：
 *   ✔ 正常資料匯得出來
 *   ✖ ⚠️ 稽核表 M：同一路段×季度×日別數值不同時，整份擋下來
 *       （Missing expected exception）
 *   ✔ ⚠️ 數值相同的重複不算衝突
 *   ✖ 假日那一欄同樣守得住（Missing expected exception）
 *   ✔ 不同路段、不同季別本來就該各自成立
 * 該紅的兩條紅、不該動的三條綠，確定不是恆真。
 */
