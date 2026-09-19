/**
 * ══════════════════════════════════════════════════════════════════════
 *  窄視窗把側欄叫出來之後，每一顆按鈕都要**真的點得到**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-15 在路口轉向實測到的缺陷（三支同一個坑）：
 *
 *   窄視窗時側欄是**滑出來蓋在內容上的浮層**，而主工具列在內容區裡、
 *   z-index 30。側欄的 z-index 若比它低，滑出來之後右半邊會被工具列蓋住：
 *   **看得到側欄，按鈕卻點不到**。瀏覽器回報的是
 *   「`<select data-testid="mt-quarter-to">` 攔截了這次點擊」。
 *   使用者看到的是「選單打開了，但按鈕沒反應」。
 *
 * ⚠️ 為什麼既有的守門全綠：它們一律用 `element.click()`（在 evaluate 裡
 *   直接呼叫 DOM 方法）。那**完全繞過命中測試**——元素被誰蓋住都照樣觸發。
 *   要抓到這種錯，只能用**真的滑鼠點**（Playwright 的 locator.click 會先
 *   做命中測試，被蓋住就會報「XXX intercepts pointer events」）。
 *   這是「量到的不是使用者做得到的」那一類假綠。
 *
 * ⚠️ 寬視窗驗不出來：那時內容區讓開了 248px，側欄與工具列根本不重疊。
 *   所以這一支**只在窄視窗**跑，而且一定要先把側欄叫出來。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
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
  await browser.newContext({ viewport: { width: 900, height: 900 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

/* 建一個計畫，主工具列才會畫出來（沒有它的話這一支變成恆真）。 */
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "NARROW");
await page.fill("#projectName", "窄視窗點擊守門");
await page.click("#saveProject");
await page.waitForTimeout(600);

for (const width of [900, 1024]) {
  console.log(`\n══ 視窗 ${width}px ══`);
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    const bar = document.querySelector(".main-toolbar");
    const menu = document.querySelector("#menu");
    const z = (node) => (node ? getComputedStyle(node).zIndex : "(沒有)");
    return {
      asideOffscreen: aside ? aside.getBoundingClientRect().right <= 1 : null,
      menuVisible: menu ? getComputedStyle(menu).display !== "none" : false,
      asideZ: z(aside),
      barZ: z(bar),
      barExists: Boolean(bar),
    };
  });
  ok(
    `前置：這個寬度下側欄真的收起來了（沒收的話這一段驗不到浮層）`,
    state.asideOffscreen === true && state.menuVisible,
    `側欄在畫面外：${state.asideOffscreen}、選單鈕看得到：${state.menuVisible}`,
  );
  ok(
    `前置：主工具列真的畫出來了（沒有的話下面全部恆真）`,
    state.barExists,
    `工具列 z-index ${state.barZ}、側欄 z-index ${state.asideZ}`,
  );
  if (!state.asideOffscreen || !state.barExists) continue;

  /* 用真的滑鼠點選單鈕把側欄叫出來。 */
  await page.locator("#menu").click({ timeout: 5000 });
  await page.waitForTimeout(450);
  ok(
    "① 按選單鈕之後側欄真的滑出來了",
    await page.evaluate(
      () => (document.querySelector("aside")?.getBoundingClientRect().right ?? 0) > 100,
    ),
  );

  /*
   * ② 逐顆按鈕用**真的滑鼠**點。
   * ⚠️ 不可以用 element.click()——那會繞過命中測試，被蓋住也照樣過。
   * ⚠️ timeout 給短一點（3 秒）：被蓋住時 Playwright 會一直重試到逾時，
   *   十幾顆按鈕 × 8 秒會把整支拖到跑不完。
   */
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("nav button[data-view]")].map((node) =>
      node.textContent.trim(),
    ),
  );
  ok(
    "前置：側欄真的列得出按鈕（0 顆的話下一條恆真）",
    labels.length > 3,
    `${labels.length} 顆`,
  );
  const blocked = [];
  for (const label of labels) {
    /* 每一顆都要重新把側欄叫出來——換頁之後它會收回去。 */
    const offscreen = await page.evaluate(
      () => (document.querySelector("aside")?.getBoundingClientRect().right ?? 0) <= 1,
    );
    if (offscreen) {
      await page.locator("#menu").click({ timeout: 5000 });
      await page.waitForTimeout(400);
    }
    try {
      await page
        .locator(`nav button[data-view]:has-text("${label}")`)
        .first()
        .click({ timeout: 3000 });
      await page.waitForTimeout(250);
    } catch (error) {
      const reason = String(error.message)
        .split("\n")
        .find((line) => line.includes("intercepts pointer events"));
      blocked.push(`${label}${reason ? "（被 " + reason.trim() + "）" : ""}`);
    }
  }
  ok(
    `② 側欄滑出來之後，每一顆按鈕都點得到（不可以被主工具列蓋住）`,
    blocked.length === 0,
    blocked.length ? blocked.slice(0, 3).join("｜") : `${labels.length} 顆全部點得到`,
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 窄視窗把側欄叫出來之後，每一顆按鈕都真的點得到");
