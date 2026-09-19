/*
 * ══════════════════════════════════════════════════════════════════════
 *  「每一個下載下來的圖檔都是淨空版」——用程式碼結構保證，不是逐一下載
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「也請確認**每個下載下來的圖檔都是淨空版**，我無法逐一下載確認太多了。」
 *
 * 他說得對——逐一下載確認不是辦法，按鈕會增加，人不會每次都記得。
 * 所以這一支從**結構**上保證：
 *   ① 全系統只有一支把 SVG 轉成點陣圖的函式（svgFigureToPngBlob）
 *   ② 那一支一定會先過 exportCleanSvg()
 *   ③ 沒有任何別的地方自己 new XMLSerializer()／canvas.toDataURL()／toBlob()
 *      去產生圖檔——有的話就是繞過了淨空這一關
 *   ④ 每一顆下載圖片的按鈕都是呼叫 downloadChartImages（唯一的出口）
 *
 * ⚠️ 為什麼要驗 ③：淨空這件事只要有**第二條路**就會失守，
 *   而繞過去的那一條不會有任何錯誤訊息，只會在使用者打開檔案時才發現。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "app.js"), "utf8");

/** 把註解拿掉再比對，否則註解裡提到函式名就會被算成一次呼叫。 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("① 只有一支 SVG→PNG 的轉換函式", () => {
  const defs = code.match(/function svgFigureToPngBlob\s*\(/g) || [];
  assert.equal(defs.length, 1, "svgFigureToPngBlob 應該只定義一次");
});

test("② 那一支一定先過 exportCleanSvg", () => {
  const body = code.slice(
    code.indexOf("function svgFigureToPngBlob"),
    code.indexOf("const safeFileName"),
  );
  assert.ok(body.length > 100, "找不到 svgFigureToPngBlob 的函式本體");
  assert.match(
    body,
    /new XMLSerializer\(\)\.serializeToString\(\s*exportCleanSvg\(/,
    "序列化之前沒有呼叫 exportCleanSvg()——匯出的圖不會是淨空版",
  );
});

test("② exportCleanSvg 是複製之後才刪（不可以動到畫面上那一張）", () => {
  const body = code.slice(
    code.indexOf("function exportCleanSvg"),
    code.indexOf("async function svgFigureToPngBlob"),
  );
  assert.ok(body.length > 50, "找不到 exportCleanSvg 的函式本體");
  assert.match(body, /cloneNode\(true\)/, "沒有先複製一份就動手刪");
});

test("② 要刪的類別涵蓋兩張圖的逐點標籤", () => {
  for (const name of [
    "trend-point-label",
    "band-seg-label",
    "band-seg-label-dark",
  ])
    assert.ok(
      new RegExp(`"${name}"`).test(code),
      `EXPORT_STRIP_CLASSES 少了 ${name}`,
    );
});

test("② 不可以連圖例、軸名、刻度一起刪（使用者明講圖例要留著）", () => {
  const list = code.slice(
    code.indexOf("const EXPORT_STRIP_CLASSES"),
    code.indexOf("function exportCleanSvg"),
  );
  for (const keep of [
    "band-legend-text",
    "axis-title",
    "trend-tick",
    "trend-legend-text",
  ])
    assert.ok(
      !list.includes(keep),
      `${keep} 被列進要刪的清單——圖例／軸名／刻度必須保留`,
    );
});

test("③ 沒有第二條產生圖檔的路徑（繞過淨空的後門）", () => {
  /*
   * 允許的只有 svgFigureToPngBlob 那一段自己用的 canvas.toBlob。
   * 其他任何 toDataURL／toBlob／XMLSerializer 都要指名道姓解釋，
   * 否則就是繞過了淨空。
   */
  const rasteriser = code.slice(
    code.indexOf("async function svgFigureToPngBlob"),
    code.indexOf("const safeFileName"),
  );
  const outside = code.replace(rasteriser, "");
  for (const [pattern, what] of [
    [/\.toDataURL\(/g, "canvas.toDataURL()"],
    [/\.toBlob\(/g, "canvas.toBlob()"],
    [/new XMLSerializer\(/g, "new XMLSerializer()"],
  ]) {
    const hits = outside.match(pattern) || [];
    assert.equal(
      hits.length,
      0,
      `${what} 出現在 svgFigureToPngBlob 之外 ${hits.length} 次——` +
        "那是一條繞過「匯出淨空」的路，使用者打開檔案才會發現",
    );
  }
});

test("④ 每一顆下載圖片的按鈕都走同一個出口", () => {
  /* 目前的下載圖片按鈕：趨勢圖、三段圖。新增按鈕時這裡的數字要跟著對。 */
  const buttons = (code.match(/\$\("(\w*DownloadPng)"\)\.onclick/g) || []).map(
    (m) => m.match(/"(\w+)"/)[1],
  );
  assert.ok(buttons.length >= 2, `找到的下載按鈕只有 ${buttons.length} 顆`);
  for (const id of buttons) {
    const start = code.indexOf(`$("${id}").onclick`);
    const body = code.slice(start, start + 1200);
    assert.match(
      body,
      /downloadChartImages\(/,
      `${id} 沒有走 downloadChartImages()——它可能自己另外產圖，繞過淨空`,
    );
  }
});
