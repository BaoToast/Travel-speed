/**
 * ══════════════════════════════════════════════════════════════════════
 *  說明文字與數字必須講同一件事（2026-09-16 自我稽核，共 5 處）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這一支守三類錯：
 *   ① 畫面上寫著「本圖不適用某條件」，程式其實照篩
 *      ——寫著不適用卻其實會變，比沒有那一句更糟
 *   ② 標題／檔名寫「全部路段」，圖上只畫了選到的那幾條
 *   ③ 交出去的檔案與畫面上那一段說明講的不是同一個範圍
 *
 * ⚠️ 第 ③ 類照使用者 2026-09-14 的規則處理：
 *   「圖可以為了看而脫離，**交出去的文件一律吃主工具列**」。
 *   所以匯出要走 "__main__"（不看任何區塊的脫離），
 *   而不是走那一塊的 chart id。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ⚠️ 讀進來就把註解剝掉。
 *   這幾條有好幾個是「某一句話不可以還在」的反面斷言，
 *   而修掉之後**註解裡照樣會提到那句舊話**（那是刻意留的說明）。
 *   不剝的話，一個已經修好的程式會被自己的說明判成沒修。
 */
const read = (name) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const app = read("app.js");
const toolbar = read("main-toolbar.js");
const quality = read("quality-extension.js");

/* ── ① 寫著不適用，就要真的不適用 ─────────────────────────── */

test("三段分法真的不吃路段篩選（畫面上那一句才不是假的）", () => {
  /*
   * 這張圖的分母是「該季判定得出等級的路段數」，篩成單一路段之後分母是 1，
   * 比例只會是 0% 或 100%。畫面上因此寫著「本圖不適用路段篩選……
   * 目前仍以全部路段計算」——但程式其實照篩（2026-09-16 實測抓到）。
   */
  assert.match(
    toolbar,
    /function detailsFor\(rows, chartId, rangeMode, ignore\)/,
    "缺少「這一塊刻意不吃哪幾個條件」的機制",
  );
  assert.match(
    toolbar,
    /function summariesFor\(rows, chartId, worstOf, rangeMode, ignore\)/,
  );
  const band = app.slice(
    app.indexOf("function renderBandPanel"),
    app.indexOf("function renderBandPanel") + 2600,
  );
  assert.match(
    band,
    /MT\.CHART_IDS\.band,\s*\n\s*worstOfGroup,\s*\n\s*"range",[\s\S]{0,900}?\["roads"\],/,
    "三段分法還在吃路段篩選，而畫面上寫著它不吃",
  );
});

/* ── ② 標題與檔名不可以宣告一個沒有畫的範圍 ────────────────── */

test("歷季趨勢選了多條路段時，標題與檔名不可以寫「全部路段」", () => {
  const block = app.slice(
    app.indexOf("function trendScopeText"),
    app.indexOf("function trendChartSvg"),
  );
  assert.match(
    block,
    /roads\.length\s*\n?\s*\?\s*roads\.length \+ " 條路段"\s*\n?\s*:\s*"全部路段"/,
    "選了 2 條以上時仍然寫「全部路段」——圖上只畫了那幾條",
  );
});

test("歷季趨勢那一句說明要講它實際怎麼畫，不是「接不住多選」", () => {
  const notes = app.slice(
    app.indexOf("function renderTrendNotes"),
    app.indexOf("function renderTrendNotes") + 4000,
  );
  assert.match(notes, /只畫這幾條/);
  assert.match(notes, /一條路段一條線/);
  /*
   * ⚠️ 反面：舊的那兩句都不可以還在。
   *   X-34② 之後它**真的**吃了多選（速率類一路段一條線、
   *   佔比類分母就是選到的那幾條），舊句子會讓使用者把只含 2 條路段的圖
   *   當成整個計畫的結果。
   */
  assert.doesNotMatch(notes, /接不住主工具列的多選/);
  assert.doesNotMatch(notes, /仍以全部路段合計計算/);
});

/* ── ③ 交出去的檔案一律吃主工具列 ──────────────────────────── */

test("兩顆「可編輯 Excel 圖表」匯出的是主工具列範圍，不是整個計畫", () => {
  /*
   * 這兩顆鈕就掛在「各路段 LOS 圖」與「各路段歷季旅行速率」的標題列上，
   * 那兩塊上面寫著「目前畫的是：<主工具列條件>」。
   * 升級前它們直接拿 state.summaries——完全沒有篩過的代表值，
   * 於是畫面只剩 1 條路段 1 季，檔案卻是整個計畫的每一季每一條路段，
   * 而且連代表值都可能不同（方向／尖峰縮小時，「先篩再挑最差」會換人）。
   */
  assert.match(
    toolbar,
    /if \(chartId === "__main__"\) return M\.normalizeLegacyAll\(state\.main\);/,
  );
  assert.match(app, /function exportScopeRows\(\)/);
  assert.match(app, /MT\.summariesFor\(\s*\n?\s*state\.details\.filter[\s\S]{0,200}?"__main__"/);
  const buttons = app.slice(
    app.indexOf('$("exportProjectCharts").onclick'),
    app.indexOf("const logButton"),
  );
  assert.match(buttons, /rows = exportScopeRows\(\)/);
  assert.doesNotMatch(
    buttons,
    /state\.summaries\.filter/,
    "還在匯出完全沒篩過的代表值",
  );
  /* 檔名要寫得出範圍，否則兩種條件下載出來是同名檔、後者蓋掉前者。 */
  assert.match(app, /function exportScopeSuffix\(\)/);
  assert.match(buttons, /exportScopeSuffix\(\)/);
});

test("成果交付：套用主工具列的提示不可以說「路段維持原設定」", () => {
  /*
   * 它其實把 deliveryRoad 設成 ""（全部路段），使用者原本挑的那一條
   * 被無聲換掉；而同一則訊息的前半段已經寫著「全部路段」，自己打自己。
   */
  const block = quality.slice(
    quality.indexOf("const skipped ="),
    quality.indexOf("const skipped =") + 900,
  );
  assert.doesNotMatch(block, /路段維持原設定/);
  assert.match(block, /改成「全部路段」/);
});

test("成果交付的篩選後 Excel 檔名，年份系統要與同一塊的其他下載一致", () => {
  /*
   * label 是**儲存用**的季別字串（一律民國年），displayLabel 才跟著
   * 畫面上的「年份顯示」走。用 label 的話，同一個面板的兩個下載
   * 會在檔名上寫出兩種年份系統。
   */
  const block = quality.slice(
    quality.indexOf('q("downloadFilteredCharts").onclick'),
    quality.indexOf('q("downloadFilteredCharts").onclick') + 900,
  );
  assert.match(block, /deliveryRange\(\)\.displayLabel/);
});
