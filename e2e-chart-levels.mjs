/**
 * ══════════════════════════════════════════════════════════════════════
 *  圖說第 3 級「代表什麼狀況」與第 4 級「要怎麼處理」：真的長在畫面上
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20 指定（三支同步）：
 *   「三支共通：圖旁說明文字升到第 3 級（代表什麼狀況）、第 4 級（要怎麼處理）」
 *   「第 4 級只在寫得出具體的時候才寫……不要盲猜」
 *   「請記得滑動看文字時，圖可以保持隨時可見，還有文字不要超出標框或重疊等，
 *     以前踩過的雷不要再次發生」
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**單元測試只驗得到「函式回得出句子」。** 句子有沒有真的畫到畫面上、
 *     有沒有被 CSS 藏起來、有沒有撐破框，只有真的開瀏覽器量得出來。
 *     chart-levels.test.mjs 與這一支是兩件事，兩支都要有。
 * 二、**前置要先確認圖真的畫得出來**，否則「找不到超出框的文字」會因為
 *     根本沒有文字而恆真。
 * 三、**「沒有第 4 級」不是缺陷。** 使用者明講寫不出具體的就整段不寫，
 *     所以這一支驗的是「有第 3 級」＋「有第 4 級時它不可以是空的」，
 *     不是「每一張圖都要有第 4 級」。
 * 四、**量的是實際座標**，不是 CSS 字串：撐破框最常見的成因是
 *     overflow-wrap 沒生效，而那在 CSS 字串上看起來完全正常。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(here, "test-fixtures");
const files = readdirSync(SAMPLE_DIR).filter((name) => name.endsWith(".xlsx"));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const server = createServer((request, response) => {
  const path = join(
    here,
    decodeURIComponent(request.url.split("?")[0]).replace(/^\//, "") ||
      "index.html",
  );
  if (!existsSync(path) || !path.startsWith(here)) {
    response.writeHead(404).end("nf");
    return;
  }
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1500, height: 950 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "LEVELS");
await page.fill("#projectName", "圖說第三四級守門");
await page.click("#saveProject");
await page.waitForTimeout(500);

async function importQuarter(index) {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index });
  await page.setInputFiles(
    "#files",
    files.map((name) => ({
      name,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLE_DIR, name)),
    })),
  );
  await page.click("#preview");
  await page.waitForTimeout(3000);
  await page.click("#commit");
  await page.waitForTimeout(1500);
}
/* ⚠️ 兩季才有變化可以判讀；只有一季的話第 3 級整段不會出現，這一支就恆真。 */
await importQuarter(0);
await importQuarter(1);

/**
 * 量一個分頁上所有的圖說。
 *
 * ⚠️ `<details>` 預設收合，收合狀態下裡面的元素高度是 0——
 *   直接量會得到「每一段都沒有超出框」的假綠。所以先全部展開。
 */
async function inspect(viewId, rootSelector) {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`).click();
  }, viewId);
  await page.waitForTimeout(1500);
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return null;
    for (const item of root.querySelectorAll("details")) item.open = true;
    const notes = [...root.querySelectorAll(".figure-note, .card-note")];
    return notes.map((note) => {
      const box = note.getBoundingClientRect();
      const levels = [...note.querySelectorAll(".figure-note-level")].map(
        (section) => ({
          title: (section.querySelector("h5")?.textContent || "").trim(),
          text: [...section.querySelectorAll("p")]
            .map((p) => (p.textContent || "").trim())
            .join(""),
        }),
      );
      /* 每一段文字的實際座標，用來抓「撐出框外」。 */
      const overflow = [...note.querySelectorAll("p, h5")]
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            text: (el.textContent || "").slice(0, 24),
            over: Math.max(
              0,
              Math.round(rect.right - box.right),
              Math.round(box.left - rect.left),
            ),
          };
        })
        .filter((item) => item.over > 1);
      return {
        box: {
          left: Math.round(box.left),
          right: Math.round(box.right),
          width: Math.round(box.width),
        },
        levels,
        overflow,
        /* 水平捲軸＝內容比框寬，使用者會看到字被切掉。 */
        scrollOverflow: note.scrollWidth - note.clientWidth,
      };
    });
  }, rootSelector);
}

for (const [label, viewId, selector] of [
  ["歷季趨勢", "trendChart", "#trendCharts"],
  ["三段分法", "bandChart", "#bandCharts"],
  ["各路段 LOS 圖", "losChart", "#chartGrid"],
  ["各路段歷季旅行速率", "speedTrend", "#speedTrendGrid"],
]) {
  const notes = await inspect(viewId, selector);
  if (!notes) {
    ok(`${label}：找得到圖說容器`, false, `選擇器 ${selector} 找不到`);
    continue;
  }
  ok(
    `前置：${label}**畫得出圖說**（沒有的話下面每一條都變成恆真）`,
    notes.length > 0,
    `${notes.length} 份圖說`,
  );
  if (!notes.length) continue;

  /* ① 每一張圖都要寫得出第 3 級。 */
  const missing = notes.filter(
    (note) => !note.levels.some((level) => level.title === "代表什麼狀況"),
  );
  ok(
    `⚠️ ${label}：每一份圖說都有第 3 級「代表什麼狀況」`,
    missing.length === 0,
    missing.length
      ? `${missing.length} / ${notes.length} 份沒有`
      : `${notes.length} 份都有`,
  );

  /* ② 第 3 級不可以是空話：要有內容，而且要帶得出數字。 */
  const thin = notes
    .flatMap((note) => note.levels)
    .filter(
      (level) =>
        level.title === "代表什麼狀況" &&
        (level.text.length < 20 || !/\d/.test(level.text)),
    );
  ok(
    `⚠️ ${label}：第 3 級帶得出數字，不是「本圖顯示各項數值之分布」這種空話`,
    thin.length === 0,
    thin.length ? `${thin.length} 段太短或沒有數字：${thin[0]?.text}` : "",
  );

  /* ③ 有第 4 級的話不可以是空的（沒有第 4 級是允許的）。 */
  const emptyAction = notes
    .flatMap((note) => note.levels)
    .filter((level) => level.title === "要怎麼處理" && level.text.length < 20);
  ok(
    `${label}：有第 4 級時它不是空標題（沒有第 4 級本來就允許）`,
    emptyAction.length === 0,
    emptyAction.length ? `${emptyAction.length} 段只有標題` : "",
  );

  /* ④ 文字不可以撐出框外。 */
  const spilled = notes.filter((note) => note.overflow.length);
  ok(
    `⚠️ ${label}：沒有任何一段文字撐出說明框外`,
    spilled.length === 0,
    spilled.length
      ? spilled
          .slice(0, 3)
          .map(
            (note) =>
              `框寬 ${note.box.width}px，「${note.overflow[0].text}」超出 ${note.overflow[0].over}px`,
          )
          .join("；")
      : `${notes.length} 份都在框內`,
  );

  /* ⑤ 不可以產生水平捲軸（＝內容比框寬，字會被切掉）。 */
  const scrolled = notes.filter((note) => note.scrollOverflow > 1);
  ok(
    `${label}：說明框沒有水平捲軸（有的話字會被切掉）`,
    scrolled.length === 0,
    scrolled.length ? `${scrolled.length} 份，最多超出 ${Math.max(...scrolled.map((n) => n.scrollOverflow))}px` : "",
  );
}

/*
 * ⑥ 讀說明的時候圖要一直看得見。
 *
 * ⚠️ 這一件在 e2e-figure-note-layout.mjs 已經守著（而且守得比這裡細：
 *   寬窄各驗、五種縮放比例都走過）。這裡只再確認一次「字變多之後
 *   那條規則還在」——sticky 一旦被新加的 CSS 蓋掉，那一支不會紅，
 *   因為它量的是版面不是字數。
 */
await page.evaluate(() => document.querySelector('[data-view="trendChart"]').click());
await page.waitForTimeout(1200);
const stuck = await page.evaluate(() => {
  const figure = document.querySelector("#trendCharts .figure-row > .trend-figure");
  if (!figure) return null;
  return getComputedStyle(figure).position;
});
ok(
  "⚠️ 寬視窗下，圖仍然釘在畫面上（讀說明時看得見圖）",
  stuck === "sticky",
  `實際 position=${stuck}`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join("；"));

await browser.close();
server.close();

if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過：`);
  for (const line of problems) console.error("   ・" + line);
  process.exit(1);
}
console.log("\n✅ 圖說第 3、4 級：畫得出來、不是空話、沒有撐破框，圖仍然釘著");
