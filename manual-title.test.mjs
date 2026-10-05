/*
 * ══════════════════════════════════════════════════════════════════════
 *  手冊的 <title> 與 PDF 內部 metadata Title 要跟著版號走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-10-05 實測抓到：v2.20.81 這一包的手冊檔名、封面戳記、畫面版號都是
 * v2.20.81，而 manual-src/manual.html 的 <title> 與產出 PDF 的內部 Title
 * **都還停在 v2.20.79**（落後兩版）。
 *
 * ── 為什麼漏得掉 ──────────────────────────────────────────────
 *
 * check-version.mjs 守的是**封面戳記**（`<p class="stamp">系統版本：…`），
 * 而 <title> 是另一個地方。升版時改了戳記、沒改 <title>，所有既有守門照樣全綠。
 * 姊妹系統全日交通量 v20.97 犯過一模一樣的錯（由 GPT 抓到），本支是回頭掃
 * 同一類缺陷時發現的。
 *
 * ⚠️ 使用者看得到：瀏覽器分頁標題、PDF 閱讀器的視窗標題與「文件內容」欄位。
 *
 * ⚠️ HTML 與 PDF 分成兩項，**各自獨立會紅**：
 *   只驗 HTML 的話，「改了原始檔卻沒重新產生 PDF」抓不到。
 *
 * ⚠️ PDF 那一項在**沒有 pdfinfo 的環境裡要跳過並說明**，不可以變紅：
 *   複查者的機器不一定有 poppler-utils，而「在正確的包上變紅」比沒有守門更糟
 *   （這一組系統已經踩過三次）。**跳過不等於通過**，所以會印出為什麼跳過。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8");

/* 版號的唯一來源就是 app.js 那一行（check-version.mjs 守著「只有一個地方寫」）。 */
const version = read("app.js").match(/正式版\s*v([\d.]+)/)?.[1];

test("前置：找得到程式版號與手冊原始檔，不然下面兩條是恆真的", () => {
  assert.ok(version, "app.js 裡找不到「正式版 vX.Y.Z」——版號的寫法改了嗎？");
  assert.ok(
    existsSync(join(here, "manual-src", "manual.html")),
    "找不到 manual-src/manual.html",
  );
});

test("手冊原始檔的 <title> 版號要等於程式版號", () => {
  const html = read("manual-src/manual.html");
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  assert.ok(title, "manual-src/manual.html 裡找不到 <title>");
  const shown = title.match(/v([\d.]+)/)?.[1];
  assert.ok(shown, `<title> 裡沒有版號：「${title}」`);
  assert.equal(
    shown,
    version,
    `手冊 <title> 寫 v${shown}，程式版號是 v${version}——` +
      "升版時只改了封面戳記、沒改 <title>（2026-10-05 實際發生過，落後兩版）",
  );
});

test("產出 PDF 的內部 metadata Title 版號也要等於程式版號（缺 pdfinfo 時跳過並說明）", (t) => {
  const dir = join(here, "manuals");
  const pdf = existsSync(dir) ? readdirSync(dir).find((n) => n.endsWith(".pdf")) : null;
  assert.ok(pdf, "manuals/ 底下找不到 PDF");
  let title;
  try {
    title = execFileSync("pdfinfo", [join(dir, pdf)], { encoding: "utf8" }).match(
      /^Title:\s+(.*)$/m,
    )?.[1];
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    t.skip(
      "這台機器沒有 pdfinfo（poppler-utils），跳過 PDF 內部 Title 的比對——" +
        "這不是通過，是這個環境驗不了。HTML 那一項仍然有驗。",
    );
    return;
  }
  assert.ok(title, `pdfinfo 讀不到 ${pdf} 的 Title`);
  const shown = title.trim().match(/v([\d.]+)/)?.[1];
  assert.ok(shown, `PDF 內部 Title 裡沒有版號：「${title.trim()}」`);
  assert.equal(
    shown,
    version,
    `PDF 內部 Title 寫 v${shown}，程式版號是 v${version}——` +
      "改了 manual.html 卻沒有重新產生 PDF，也會落到這一條",
  );
});
