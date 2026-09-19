/*
 * ══════════════════════════════════════════════════════════════════
 *  純文字介面裡不可以出現 Markdown 記號（2026-09-18 大檢查 F-09 新增）
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一支在守什麼：
 *
 *   textContent／innerHTML 經 esc()／結論草稿 textarea／剪貼簿／Excel 儲存格
 *   都是純文字，`**重點**` 會原封不動把星號印給使用者。大檢查在試用版上
 *   實際看到三處：路段速限表頭篩選提示「**畫面上這 N 列**」、各路段歷季
 *   旅行速率圖說「**該路段的速限**」、三段分法不適用說明「**主工具列條件範圍內**」，
 *   加上結論草稿的「**符合上列條件**」。既有的 resolution.test.mjs 只掃
 *   異常處理那幾句，這裡改掃全部原始檔。
 *
 * ⚠️ 例外只有一種：真的有一個把 `**` 轉成 <b> 的算繪器時。
 *   本支唯一的算繪器在 app.js 三段分法圖說（把「兩個星號包起來的字」換成 <b>），
 *   餵給它的字串列在 RENDERED_OK（逐句白名單，不是整檔放行）；
 *   下面有一則前置測試確認那個算繪器還在，不在的話白名單自動失效。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** 與 check-version.mjs 的 scripts 清單同一組：全站使用者看得到字串的原始檔。 */
const SOURCE_FILES = [
  "app.js",
  "quality-extension.js",
  "excel-export.js",
  "conclusion.js",
  "trend.js",
  "trend-excel.js",
  "column-filter.js",
  "period-date.js",
  "main-filters.js",
  "main-toolbar.js",
  "los-rule-scope.js",
];

/** app.js 裡確認過會經過 `**`→<b> 算繪器的字串（子字串比對）。 */
const RENDERED_OK = ["分母是**判定得出等級**的路段數"];

function read(name) {
  return readFileSync(new URL("./" + name, import.meta.url), "utf8");
}

/**
 * 把註解拿掉之後，找出字串字面值裡的 `**`。
 * 做到「JS 註解不算、樣板字串裡的 HTML 註解不算、其餘字串算」就夠。
 */
function markupInStrings(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const hits = [];
  const patterns = [/"([^"\\\n]|\\.)*"/g, /'([^'\\\n]|\\.)*'/g, /`([^`\\]|\\.)*`/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(stripped))) if (m[0].includes("**")) hits.push(m[0]);
  }
  return hits;
}

test("前置：掃描器真的抓得到違規字串，而且註解不會誤判", () => {
  const fake = [
    'notify("⚠️ 這裡會**變粗體**吧？");',
    "const t = `數字會**變**`;",
    "const u = '請按**確認**';",
  ].join("\n");
  assert.equal(markupInStrings(fake).length, 3, "三種引號都要抓到");
  const comment = [
    "/* 這是註解，裡面寫 **重點** 是刻意的 */",
    "// 這行也是註解，**不算**",
    "const h = `<div><!-- HTML 註解 **也不算** --></div>`;",
  ].join("\n");
  assert.deepEqual(markupInStrings(comment), []);
});

test("前置：白名單的前提——app.js 的 **→<b> 算繪器還在", () => {
  const app = read("app.js");
  assert.match(
    app,
    /replace\(\/\\\*\\\*\(\.\+\?\)\\\*\\\*\/g, "<b>\$1<\/b>"\)/,
    "三段分法圖說的粗體算繪器不見了，RENDERED_OK 那一句會變成星號",
  );
  assert.ok(
    RENDERED_OK.every((ok) => app.includes(ok)),
    "白名單裡的句子在 app.js 找不到了，請一併更新白名單",
  );
});

test("全部原始檔的字串都不可以留下 Markdown 粗體記號", () => {
  const bad = [];
  for (const file of SOURCE_FILES)
    for (const hit of markupInStrings(read(file))) {
      if (file === "app.js" && RENDERED_OK.some((ok) => hit.includes(ok))) continue;
      bad.push(`${file}｜${hit.slice(0, 120)}`);
    }
  assert.deepEqual(
    bad,
    [],
    "這些字串是純文字去處，星號會原樣印出來，請改用「」：\n" +
      bad.map((b) => "  " + b).join("\n"),
  );
});
