/*
 * ══════════════════════════════════════════════════════════════════════
 *  同一份檔案讀到兩個調查日期：要進異常檢查、要能指定哪一個才對
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20：
 *   「同一張表若你判讀到 2 個日期，在資料匯入時就應該做為異常顯示提醒
 *     使用者，在異常資料檢查結果也要檢查出來，我在想的是你要如何讓使用者
 *     告訴你哪個才是正確的日期（因為有可能另一個不同的日期在該資料中有其
 *     意義存在，所以使用者不會修正資料）」
 *
 * ⚠️ 最後那一句是重心：**不可以叫使用者去改原始檔**，所以解法是「覆寫」
 *   而不是「改資料」，而且覆寫要跟著備份走、跟著顯示走。
 *
 * 這一支是**原始碼掃描**（本專案的 app.js 是瀏覽器腳本，不是模組），
 * 與 project-code-rename.test.mjs、issue-ack-stability.test.mjs 同一套做法。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("app.js", import.meta.url), "utf8");
const page = await readFile(new URL("index.html", import.meta.url), "utf8");
const periodDate = await readFile(new URL("period-date.js", import.meta.url), "utf8");

/* ── 前置：要掃的東西真的在 ────────────────────────────────────── */
test("前置：app.js、index.html、period-date.js 都讀得到而且有內容", () => {
  for (const [name, text] of [
    ["app.js", app],
    ["index.html", page],
    ["period-date.js", periodDate],
  ])
    assert.ok(text.length > 2000, `${name} 讀起來太短，掃描沒有意義`);
});

/* ── 全文搜索找日期 ──────────────────────────────────────────── */
test("候選日期一律全表掃描，不是只看表頭前 13 列", () => {
  /*
   * 使用者：「日期的欄位檔案可能不一致，所以應該使用全文搜索找出日期來判讀，
   *   不要依靠讀取固定欄位，導致經常找不到」
   */
  assert.match(
    app,
    /function surveyDateCellsOf\(wb, deep\)/,
    "沒有可切換深度的儲存格掃描函式",
  );
  assert.match(
    app,
    /const last = deep \? range\.e\.r : Math\.min\(range\.e\.r, 12\)/,
    "deep 參數沒有真的改變掃描範圍",
  );
  /* 候選清單那一邊一定要用 deep=true。 */
  assert.match(
    app,
    /findAllSurveyDates\(\s*surveyDateCellsOf\(wb, true\)/,
    "候選清單沒有走全表掃描",
  );
});

test("⚠️ 系統實際採用的那一個仍以表頭優先（正常檔案的行為不可以變）", () => {
  /*
   * 先掃全表再挑的話，表頭那一個明確標示「調查日期」的，可能被表身
   * 某一格更前面的日期蓋過去——那是行為改變，不是修 bug。
   */
  assert.match(
    app,
    /const deepCells = globalThis\.PeriodDate\.findSurveyDate\(cells\)\s*\n?\s*\? cells\s*\n?\s*: surveyDateCellsOf\(wb, true\)/,
    "沒有「表頭找得到就用表頭」的兩段式挑選",
  );
});

test("⚠️ 候選清單的第一個必須就是系統實際採用的那一個", () => {
  /*
   * 兩邊排序不同的話，畫面上請使用者確認的第一個候選，與計算實際用的
   * 那一個會是不同的日期——那比不問更糟。
   */
  assert.match(
    app,
    /candidates: \[found\.iso, \.\.\.others\.map\(\(o\) => o\.iso\)\]/,
    "候選清單的第一個不是系統採用的那一個",
  );
});

/* ── 候選要存下來 ────────────────────────────────────────────── */
test("候選要跟著明細一起存下來（原始檔匯完就不在手上了）", () => {
  assert.match(
    app,
    /surveyDateCandidates:\s*\n?\s*surveyDateFound && surveyDateFound\.candidates/,
    "匯入時沒有把候選存進明細，事後執行異常檢查就掃不到",
  );
});

/* ── 異常檢查 ────────────────────────────────────────────────── */
test("異常檢查會列出「調查日期不只一個」，而且是人工確認", () => {
  assert.ok(
    app.includes('code: "survey-date-multi"'),
    "異常檢查沒有這一類",
  );
  assert.ok(app.includes('type: "調查日期不只一個"'), "類型名稱不對");
  const at = app.indexOf('code: "survey-date-multi"');
  const block = app.slice(at, at + 2600);
  assert.ok(block.includes('kind: "人工確認"'), "不是人工確認類，使用者沒有出路");
  assert.ok(
    block.includes("系統不會自己挑"),
    "解決方式沒有講明系統不自行挑選——那是本系統的基本原則",
  );
  assert.ok(
    block.includes("不影響速率、延滯或服務水準的任何計算"),
    "解決方式沒有講明這一項不影響計算",
  );
});

test("⚠️ 分組鍵是「季別｜來源檔名」，不是路段", () => {
  /*
   * 一份檔案會產出四筆明細（上午／下午 × 方向1／方向2）。
   * 用路段分組的話，同一件事會被報好幾次，使用者要按好幾次確認。
   */
  assert.match(
    app,
    /function surveyDateScopeKey\(row\) \{\s*\n\s*return `\$\{row\.period \|\| ""\}\|\$\{row\.source \|\| ""\}`;/,
    "分組鍵不是「季別｜來源檔名」",
  );
  const at = app.indexOf("const dateGroups = new Map();");
  assert.notEqual(at, -1, "找不到分組的那一段");
  const block = app.slice(at, at + 400);
  assert.ok(
    block.includes("const key = surveyDateScopeKey(d);"),
    "分組沒有走 surveyDateScopeKey，兩邊遲早會對不起來",
  );
});

/* ── 指紋穩定性 ──────────────────────────────────────────────── */
test("⚠️ choices 有值才進指紋，舊類型的指紋長相不可以變", () => {
  /*
   * 無條件在指紋尾巴多加一格的話，使用者先前按過的「已人工確認」
   * 會全部失效、當場重新冒出來——正是本版剛修掉的那個 bug，
   * 不要在同一版裡用另一種方式重演一次。
   */
  assert.match(
    app,
    /if \(issue\.choices && issue\.choices\.length\)\s*\n?\s*parts\.push\(issue\.choices\.join\("\|"\)\);/,
    "指紋沒有「有候選才加一格」的條件",
  );
  const at = app.indexOf("function issueFingerprint(issue)");
  const block = app.slice(at, app.indexOf("\n}", at));
  assert.ok(
    !/parts\.push\(\(issue\.choices \|\| \[\]\)/.test(block),
    "指紋無條件多加了一格，舊的人工確認會全部失效",
  );
});

test("這一類走 ackScope: identity（detail 裡有會變的字）", () => {
  const at = app.indexOf('code: "survey-date-multi"');
  const block = app.slice(at, at + 2600);
  assert.ok(
    block.includes('ackScope: "identity"'),
    "detail 裡有「你指定的／尚未指定」這種會變的字，不走 identity 的話確認會一直失效",
  );
});

/* ── 指定＝覆寫＋確認 ────────────────────────────────────────── */
test("指定日期要同時寫覆寫與記為已確認，取消指定兩邊都要拿掉", () => {
  const at = app.indexOf("async function setSurveyDatePick(");
  assert.notEqual(at, -1, "找不到指定調查日期的處理函式");
  const block = app.slice(at, app.indexOf("\n}", at));
  assert.ok(block.includes("state.surveyDateOverrides"), "沒有寫覆寫");
  assert.ok(block.includes("setIssueAck("), "沒有記為已確認");
  assert.ok(
    block.includes("if (iso) own[scope] = iso;") && block.includes("else delete own[scope];"),
    "取消指定時沒有把覆寫拿掉",
  );
  /* ⚠️ 改完要重畫，否則明細上的日期會停在舊的。 */
  assert.ok(block.includes("renderAll()"), "指定完沒有重畫，明細會停在舊的日期");
});

test("⚠️ 覆寫值不在候選裡就不採用", () => {
  const at = app.indexOf("function effectiveSurveyDate(row, projectCode");
  assert.notEqual(at, -1, "找不到 effectiveSurveyDate");
  const block = app.slice(at, app.indexOf("\n}", at));
  assert.match(
    block,
    /!candidates\.includes\(picked\)\)\s*\n?\s*return row\.surveyDate \|\| "";/,
    "採用了一個原始檔上根本沒有的日期——使用者無從發現",
  );
});

/* ── 顯示 ────────────────────────────────────────────────────── */
test("明細與彙總都要寫出逐筆調查日期，而且走 effectiveSurveyDate", () => {
  const detail = app.indexOf('$("detailRows").innerHTML');
  const summary = app.indexOf('$("summaryRows").innerHTML');
  assert.notEqual(detail, -1);
  assert.notEqual(summary, -1);
  for (const [name, at] of [["明細", detail], ["彙總", summary]])
    assert.ok(
      app.slice(at, at + 1200).includes("surveyDateLine(x, code)"),
      `${name}表沒有寫出逐筆調查日期`,
    );
  const at = app.indexOf("function surveyDateLine(row, code)");
  const block = app.slice(at, app.indexOf("\n}", at));
  assert.ok(
    block.includes("effectiveSurveyDate(row, code)"),
    "顯示沒有走 effectiveSurveyDate，使用者指定的日期不會反映到畫面",
  );
});

test("讀不到日期時要寫出原因，不可以留白", () => {
  /*
   * 使用者：「如果讀不到應該是我們這邊先確認不是程式問題所造成，
   *   而是原始資料檔沒有寫日期，只有寫季，這樣你才能說原始檔讀不到日期，
   *   而不留白」
   */
  assert.ok(
    app.includes("原始檔讀不到日期"),
    "讀不到日期時留白，使用者分不出「程式沒做」與「原始檔真的沒寫」",
  );
});

test("開關在明細與彙總各有一顆，而且寫同一個 state；預設是開", () => {
  for (const id of ["detailShowSurveyDate", "summaryShowSurveyDate"]) {
    assert.ok(page.includes(`id="${id}"`), `index.html 少了 ${id}`);
    assert.ok(
      app.includes(`$("${id}").onchange`),
      `${id} 沒有綁事件`,
    );
  }
  const at = app.indexOf("async function setShowSurveyDate(on)");
  assert.notEqual(at, -1, "找不到開關的處理函式");
  const block = app.slice(at, app.indexOf("\n}", at));
  assert.ok(
    block.includes('$("detailShowSurveyDate")') &&
      block.includes('$("summaryShowSurveyDate")'),
    "兩顆開關沒有互相同步，同一份資料在兩張表上會一張有日期一張沒有",
  );
  /* 預設開：舊存檔沒有這個欄位時要顯示。 */
  assert.ok(
    app.includes("if (state.showSurveyDate === false) return \"\";"),
    "用 !state.showSurveyDate 判斷的話，舊存檔會不顯示但勾選框卻勾著",
  );
  assert.ok(app.includes("showSurveyDate: true"), "預設值不是開");
});

test("⚠️ 這一顆與「期別顯示季別／調查月份」是兩件事，不可以互相取代", () => {
  const at = app.indexOf("showSurveyDate: true");
  const block = app.slice(Math.max(0, at - 900), at);
  assert.ok(
    block.includes("期別顯示"),
    "沒有寫明它與期別顯示是兩件事，日後很容易被合併掉",
  );
});

/* ── 備份 ────────────────────────────────────────────────────── */
test("指定的調查日期要跟著兩種備份走，還原時舊備份不可以被清空", () => {
  const single = app.slice(
    app.indexOf("function projectPackage()"),
    app.indexOf("function downloadProjectPackage"),
  );
  assert.ok(
    single.includes("surveyDateOverrides"),
    "專案包沒有收 surveyDateOverrides——換電腦之後日期會變成另一天",
  );
  const portfolio = app.slice(
    app.indexOf('kind: "TLM_PORTFOLIO_PACKAGE"'),
    app.indexOf("交通服務水準_個人全部計畫包.json"),
  );
  assert.ok(portfolio.includes("surveyDateOverrides"), "個人全部計畫包沒有收");
  assert.match(
    app,
    /if \(x\.surveyDateOverrides && typeof x\.surveyDateOverrides === "object"\)/,
    "還原時沒有先確認備份裡真的有這一欄，舊版專案包會把既有的指定清空",
  );
});

/* ── 共用模組 ────────────────────────────────────────────────── */
test("period-date.js 要有 surveyDateInYearStyle（與全日交通量同名同行為）", () => {
  assert.ok(
    periodDate.includes("function surveyDateInYearStyle(iso, style)"),
    "沒有這一支，明細上的調查日期就寫不出民國年",
  );
  assert.ok(
    periodDate.includes("surveyDateInYearStyle: surveyDateInYearStyle"),
    "有函式但沒有匯出",
  );
  /* 認不得的輸入要回空字串，呼叫端靠它判斷「這一筆沒有日期」。 */
  const at = periodDate.indexOf("function surveyDateInYearStyle(iso, style)");
  const block = periodDate.slice(at, periodDate.indexOf("\n  }", at));
  assert.ok(block.includes('if (!m) return "";'), "認不得的輸入沒有回空字串");
});
