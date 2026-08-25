/*
 * 備份／專案包必須帶走使用者自己設定的每一樣東西。
 *
 * 起因：使用者問「結論草稿的條件範本存好之後，換一台電腦還在嗎？」
 * 查證結果是**不在**——範本存在 state.conclusionTemplates[計畫代碼]，
 * 本機有存，但匯出的專案包與個人全部計畫包**都沒有收**。
 * 使用者在 A 電腦存了好幾組常用條件，帶到 B 電腦匯入之後一組都沒有，
 * 而畫面只會說匯入成功。那些條件是一項一項勾出來的，重建很花時間。
 *
 * 這一支的作法是「清單比對」：把 state 裡屬於使用者設定的鍵列出來，
 * 逐一確認匯出時有收、匯入時有還原。日後新增設定卻忘了收進備份，
 * 這裡就會失敗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("app.js", import.meta.url), "utf8");

/**
 * 使用者會自己調整、換電腦時應該一起帶走的東西。
 * 純衍生資料（summaries 之類可由 details 重算的）不列在這裡。
 */
const MUST_TRAVEL = [
  "details",
  "summaries",
  "imports",
  "limits",
  "limitConfirmed",
  "aliases",
  "roadMeta",
  "speedVersions",
  "reportDrafts",
  "conclusionTemplates",
];

function block(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `app.js 裡找不到 ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${startMarker} 之後找不到 ${endMarker}`);
  return source.slice(start, end);
}

test("單一計畫的專案包收齊了使用者的設定", () => {
  const pack = block("function projectPackage()", "function downloadProjectPackage");
  for (const key of MUST_TRAVEL)
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(pack),
      `projectPackage() 沒有收 ${key}——換一台電腦匯入之後這一項會消失`,
    );
});

test("個人全部計畫包收齊了使用者的設定", () => {
  const pack = block('kind: "TLM_PORTFOLIO_PACKAGE"', "交通服務水準_個人全部計畫包.json");
  for (const key of MUST_TRAVEL)
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(pack),
      `個人全部計畫包沒有收 ${key}`,
    );
});

test("匯入專案包時會把條件範本還原回來", () => {
  assert.match(
    source,
    /state\.conclusionTemplates\[x\.project\.code\]\s*=\s*x\.conclusionTemplates/,
    "匯入專案包時沒有把 conclusionTemplates 寫回 state",
  );
});

test("舊版專案包沒有條件範本時，不可以把這台電腦既有的範本清掉", () => {
  /*
   * 只有在備份裡「確實有」那個欄位時才覆蓋。
   * 無條件指派的話，匯入一個舊版專案包就會把使用者已經存好的範本抹成
   * undefined——那比不還原更糟。
   */
  assert.match(
    source,
    /if \(Array\.isArray\(x\.conclusionTemplates\)\)\s*\n?\s*state\.conclusionTemplates\[x\.project\.code\]/,
    "還原條件範本前必須先確認備份裡真的有這個欄位",
  );
});
