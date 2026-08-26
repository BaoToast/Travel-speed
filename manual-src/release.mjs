/*
 * 手冊的版號與發布日期，只有一個來源：manual.html 封面那一行版本戳記。
 *
 * 起因（v2.20.4）：v2.20.3 的手冊封面寫「更新日期：2026-08-25」，
 * 每一頁頁尾卻印「2026-08-24」。因為兩支產生程式各自把版號與日期**寫死**，
 * 升版時是用字串取代去改的——比對不到就靜靜失敗，而且沒有任何檢查在看日期。
 *
 * 同一種錯誤在這一組系統已經犯過四次：姊妹專案（全日交通量）連續三版的
 * 手冊更新說明因為同樣的原因完全沒有進到手冊裡，版號檢查卻照樣通過。
 *
 * 根治的作法不是「這次記得改」，是**讓它沒有第二個地方可以漏改**：
 * 頁尾與檔名都從封面戳記推導出來，兩者在結構上不可能不一致。
 * 剩下「封面戳記與 app.js 的版號是否一致」那一項，交給 check-version.mjs。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** 封面戳記長這樣：`系統版本：v2.20.4　更新日期：2026-08-26` */
const STAMP = /系統版本：\s*v([\d.]+)\s*[\s　]*更新日期：\s*(\d{4}-\d{2}-\d{2})/;

/**
 * 讀出手冊的版號與發布日期。
 * 讀不到就直接丟例外——寧可讓產生手冊這一步失敗，也不要默默產出
 * 一本頁尾寫著錯誤日期的手冊（那正是這支檔案要防的事）。
 */
export function manualRelease() {
  const html = readFileSync(join(here, "manual.html"), "utf8");
  const match = html.match(STAMP);
  if (!match)
    throw new Error(
      "manual.html 裡找不到版本戳記（應為「系統版本：vX.Y.Z　更新日期：YYYY-MM-DD」）。" +
        "頁尾與檔名都由它推導，缺了就不能產生手冊。",
    );
  return { version: match[1], date: match[2] };
}

/** 頁尾那一行（PDF 與 Word 共用同一份字樣，不可以各寫各的）。 */
export function footerPrefix({ version, date }) {
  return `v${version} ｜ ${date} ｜ 使用前請先下載專案包備份　　第 `;
}

/** 手冊檔名（副檔名自己接）。 */
export function manualBaseName({ version }) {
  return `交通服務水準分析系統_新手使用手冊_v${version}`;
}
