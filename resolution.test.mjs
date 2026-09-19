/*
 * ══════════════════════════════════════════════════════════════════
 *  X-49：每一種異常都要有「解決方式」，而且要是一句能照做的話
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16：
 *   「我建議在檢查結果表中，新增一欄"解決方式"(例如重新匯入檔案、
 *     指引前往某分頁進行人工確認等)」
 *   「如果這個異常狀況真的只能靠重新匯入解決，那就請在檢查結果表中，
 *     標註說明請重新匯入該筆檔案」
 *
 * ⚠️ 只驗「有這個欄位」會假綠：空字串、或每一種都寫同一句通用句
 *   （「請檢查資料」）照樣會過，而那等於沒寫。所以這一支驗四件事：
 *     ① 每一個 issues.push 都帶 resolution（漏一個，畫面上就是空格子）
 *     ② 每一句都夠長、講得出使用者實際要做什麼
 *     ③ 不同種類不可以共用同一句
 *     ④ 純文字欄位不可以有 Markdown 記號（瀏覽器會原樣印出星號）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");

function inspectHealthBody() {
  const start = source.indexOf("function inspectHealth()");
  const end = source.indexOf("function renderHealth()");
  if (start < 0 || end < 0 || end <= start)
    throw new Error("找不到 inspectHealth() 的範圍——這支測試要跟著改，不是刪掉");
  return source.slice(start, end);
}

test("前置：inspectHealth() 的範圍切得出來，而且真的含 resolution", () => {
  const body = inspectHealthBody();
  assert.ok(body.length > 3000, `切出來只有 ${body.length} 字，範圍抓錯了`);
  assert.ok(body.includes("resolution: {"), "切出來的範圍裡沒有 resolution");
});

test("X-49：每一筆異常都要有「解決方式」，一個都不可以漏", () => {
  const body = inspectHealthBody();
  const pushes = body.match(/issues\.push\(\{/g) || [];
  const resolutions = body.match(/\n\s+resolution: \{/g) || [];
  assert.ok(pushes.length >= 9, `只找到 ${pushes.length} 種異常，掃描寫壞了`);
  assert.equal(
    resolutions.length,
    pushes.length,
    `有 ${pushes.length} 種異常，卻只有 ${resolutions.length} 個解決方式——` +
      "漏掉的那一種在畫面上會顯示「尚未對應」，使用者就不知道那一筆該怎麼辦",
  );
});

/** 取出 resolution 裡的 text 值（單行字串或樣板字串都算）。 */
function resolutionTexts() {
  const body = inspectHealthBody();
  return [
    ...body.matchAll(/\n\s+text:\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*")/g),
  ].map((m) => m[1]);
}

test("X-49：每一句解決方式都要講得出使用者實際要做什麼", () => {
  const texts = resolutionTexts();
  assert.ok(texts.length >= 9, `只抓到 ${texts.length} 句`);
  for (const text of texts)
    assert.ok(text.length > 50, `這一句太短、照不了做：${text}`);
});

test("X-49：不同種類的異常不可以共用同一句（那等於沒寫）", () => {
  const texts = resolutionTexts();
  assert.equal(
    new Set(texts).size,
    texts.length,
    "有兩種以上的異常共用同一句解決方式",
  );
});

test("X-49：解決方式是純文字，不可以留下 Markdown 粗體記號", () => {
  const bad = resolutionTexts().filter((text) => text.includes("**"));
  assert.deepEqual(
    bad,
    [],
    "這些字會原樣把星號印在檢查結果表裡，請改用「」",
  );
});

test("X-49：標成「重新匯入」的，句子裡要真的寫出「重新匯入」", () => {
  const body = inspectHealthBody();
  const blocks = [
    ...body.matchAll(
      /resolution: \{\s*\n\s*kind:\s*"([^"]+)",\s*\n\s*text:\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*")/g,
    ),
  ];
  assert.ok(blocks.length >= 9, `只解析到 ${blocks.length} 組 kind/text`);
  for (const [, kind, text] of blocks) {
    assert.ok(
      ["重新匯入", "人工確認", "畫面修正"].includes(kind),
      `不認得的處理類別：${kind}`,
    );
    if (kind === "重新匯入")
      assert.ok(
        text.includes("重新匯入") || text.includes("補匯"),
        `標成重新匯入卻沒講出要重匯：${text}`,
      );
  }
});

test("X-49：「解決方式」欄要真的畫在兩張表上（漏掉的話欄位數也會對不上）", () => {
  for (const id of ["healthRows", "qualityRows"]) {
    const head = source.slice(
      Math.max(0, source.indexOf(`id="${id}"`) - 400),
      source.indexOf(`id="${id}"`),
    );
    assert.ok(
      head.includes("<th>解決方式</th>"),
      `${id} 那張表的表頭沒有「解決方式」欄`,
    );
  }
  assert.ok(
    !source.includes('colspan="4" class="empty">按「執行資料異常檢查」'),
    "空狀態還寫著 colspan=4，加了一欄之後會少一格",
  );
});
