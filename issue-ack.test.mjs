/**
 * ══════════════════════════════════════════════════════════════════════
 *  「已人工確認」（使用者 2026-09-17 指名這個名稱）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 「如果已經回報了，要怎麼按確認，來讓這項問題，在下次異常檢查時，
 *   不會再次回報異常呢?」
 *
 * 這一支守的是這個功能**最容易做錯的三件事**：
 *
 *   ① 指紋不含數值 → 確認過「總延滯增加 30.7%」之後，下一季變成 200%
 *      也被同一把鑰匙消音。那是把一個更嚴重的問題藏起來，
 *      **比沒有這個功能糟得多**。
 *   ② 「重新匯入」類也給按 → 等於提供一個把資料錯誤藏起來的開關。
 *   ③ 確認之後把數字直接變小 → 使用者看不出來還有幾筆、已處理幾筆。
 *
 * 另外守一條 2026-09-17 實測抓到的真錯：
 *   ④ quality-extension.js 覆寫「異常變化」時**漏帶 resolution**，
 *      於是每一筆都顯示「尚未對應／請回報給開發者」——
 *      而指引其實早就寫在 app.js 裡了。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const app = read("app.js");
const quality = read("quality-extension.js");

test("① 指紋一定要包含那一筆的說明文字（裡面有數值）", () => {
  const block = app.slice(
    app.indexOf("function issueFingerprint"),
    app.indexOf("function ackMap"),
  );
  assert.ok(block.length > 60, "找不到 issueFingerprint");
  assert.match(block, /issue\.detail \|\| ""/, "指紋沒有帶說明文字");
  assert.match(block, /issue\.type/);
  assert.match(block, /issue\.period \|\| ""/);
  /*
   * ⚠️ 反面：不可以退回成「只用類型＋季別＋路段」那種鍵。
   *   那樣的鍵一旦確認就永遠消音，而數值早就變了。
   */
  assert.doesNotMatch(
    block,
    /return \[\s*issue\.type,\s*issue\.road[\s\S]{0,80}\]\.join/,
    "指紋退回成不含數值的鍵了",
  );
});

test("② 只有「人工確認」類可以按確認", () => {
  const block = app.slice(
    app.indexOf("function issueCanAck"),
    app.indexOf("function issueAcked"),
  );
  assert.match(block, /resolution\?\.kind === "人工確認"/);
  /* 按鈕本身也要問過 issueCanAck，不可以無條件畫出來。 */
  const cell = app.slice(
    app.indexOf("function issueResolutionCell"),
    app.indexOf("function bindIssueButtons"),
  );
  assert.match(cell, /issueCanAck\(issue\)\s*\n?\s*\?/);
  assert.match(cell, /data-ack-key=/);
});

test("③ 確認之後兩個數字都要寫出來，不是把總數變小", () => {
  const block = app.slice(
    app.indexOf('$("healthCount").textContent'),
    app.indexOf('$("healthCount").classList'),
  );
  assert.match(block, /項需確認、\$\{ackedCount\} 項已確認/);
  /* 上方四個統計數字**刻意不扣**：那是體檢結果，不是待辦數量。 */
  const quality4 = app.slice(
    app.indexOf('$("qualityDay").textContent'),
    app.indexOf('$("qualityChange").textContent') + 120,
  );
  assert.doesNotMatch(
    quality4,
    /issueAcked/,
    "上方四個統計數字被已確認扣掉了——那是體檢結果，不是待辦數量",
  );
});

test("④ 異常變化的覆寫版一定要帶 resolution", () => {
  const block = quality.slice(
    quality.indexOf('type: "異常變化"'),
    quality.indexOf('type: "異常變化"') + 1800,
  );
  assert.match(
    block,
    /resolution: \{\s*\n?\s*kind: "人工確認"/,
    "覆寫掉 app.js 的判定時漏帶 resolution，畫面會說「尚未對應」",
  );
  assert.match(block, /viewLabel: "尖峰彙總"/);
});

test("預設的「尚未對應」那一句要寫「計畫主辦」，不是「開發者」", () => {
  assert.match(app, /請回報給計畫主辦。/);
  assert.doesNotMatch(app, /請回報給開發者。/);
});

test("確認只影響畫面：交付與匯出仍然輸出全部項目", () => {
  /*
   * 這張面板上白紙黑字寫著這一條，所以它不可以被改掉；
   * 而且「已確認」的過濾只能出現在 render 這一層。
   */
  const raw = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(raw, /匯出與交付檔案一律輸出全部項目，不受這裡的篩選影響。/);
  const filterUses = (raw.match(/issueAcked/g) || []).length;
  assert.ok(filterUses > 0, "根本沒有用到 issueAcked");
});

test("⚠️ 那顆鈕的名字就是「已人工確認」（使用者 2026-09-17 指名）", () => {
  /*
   * 使用者原話：「按鈕名稱不要這麼長，改為『已人工確認』，系統就主動不再提醒」。
   *
   * ⚠️ 這一條不是在守「有沒有這顆鈕」（上面幾條已經守了），
   *   而是守**名字**。名字改回長版本的話，按鈕文字很可能又超出邊界——
   *   那正是使用者點名要避免的三個雷之一。
   */
  const block = app.slice(
    app.indexOf("function issueResolutionCell"),
    app.indexOf("function bindIssueButtons"),
  );
  assert.ok(block.length > 60, "找不到 issueResolutionCell");
  assert.match(block, /"已人工確認"/, "那顆鈕的名字要是「已人工確認」");
  assert.ok(
    !/已確認，不再提醒/.test(block),
    "舊的長名字還留著——那一串在窄欄位會撐破按鈕",
  );
  /* 取消的那一顆維持「取消確認」，兩顆不可以同名（同名就分不出現在是哪一種狀態）。 */
  assert.match(block, /"取消確認"/);
});
