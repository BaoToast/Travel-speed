/*
 * ══════════════════════════════════════════════════════════════════════
 *  換分頁的捲動位置：第一次從最上面，回頭接著上次看
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「在我第一次點入 A 分頁時，該分頁的資訊都是從最上面開始展示；……
 *     然後我又跳回 A 分頁時，這不是我第一次來 A 分頁了，所以畫面要停在
 *     我上一次中斷的地方。**這項功能請三個程式都要統一。**」
 *
 * ⚠️ 這一支以前是每次換頁一律捲到最上面。「第一次從最上面」成立，
 *   但「回頭接著上次看」完全沒有——另外兩支都有，三支不一致。
 *   2026-09-13 補上，這支測試與那兩支（scripts/e2e-view-scroll.mjs）
 *   釘的是同樣三件事：
 *     ① 第一次進 B → scrollY 必須是 0
 *     ② 回到 A     → 必須回到離開 A 時的位置（不是 0）
 *     ③ 再進 B     → 停在 B 上次的位置（第二次就不是第一次了）
 *
 * ⚠️ 不可以只看「有沒有換頁」，要**直接量 window.scrollY**。
 *   新的一頁從中間開始顯示時畫面照樣有標題、有表格，看起來很正常——
 *   使用者只是不知道上面還有一整段沒看到。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const server = createServer((req, res) => {
  const path = join(
    here,
    decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html",
  );
  if (!existsSync(path) || !path.startsWith(here)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
/* 視窗刻意矮一點，比較容易讓每一頁都捲得動。 */
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 700 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(700);

const go = async (view) => {
  await page.locator(`nav button[data-view="${view}"]`).click();
  await page.waitForTimeout(500);
};
const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
const scrollable = () =>
  page.evaluate(
    () =>
      document.documentElement.scrollHeight -
      document.documentElement.clientHeight,
  );

/*
 * 挑兩頁**空資料時也捲得動**的：新手說明（整本手冊）與路段管理（7 塊面板）。
 * ⚠️ 前置一定要驗「真的捲得動」——捲不動的話下面每一條都會變成恆真。
 */
await go("guide");
const guideRoom = await scrollable();
ok("前置：新手說明這一頁捲得動（捲不動的話下面全部變成恆真）", guideRoom > 300,
  `可捲 ${guideRoom}px`);

await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(400);
const guideLeft = await scrollY();
ok("前置：真的捲到了 900 附近", guideLeft > 600, `${guideLeft}px`);

await go("roadadmin");
const firstVisit = await scrollY();
ok(
  "⚠️ ① 第一次進「路段管理」要從最上面開始（不可以沿用上一頁的位置）",
  firstVisit === 0,
  `${firstVisit}px`,
);

const roadRoom = await scrollable();
ok("前置：路段管理這一頁也捲得動", roadRoom > 200, `可捲 ${roadRoom}px`);
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(400);
const roadLeft = await scrollY();

await go("guide");
const backToGuide = await scrollY();
ok(
  "⚠️ ② 回到「新手說明」要停在離開時的位置，不是回到最上面",
  Math.abs(backToGuide - guideLeft) <= 40,
  `離開時 ${guideLeft}px、回來 ${backToGuide}px`,
);

await go("roadadmin");
const backToRoad = await scrollY();
ok(
  "⚠️ ③ 第二次進「路段管理」也要接著上次看（第二次就不是第一次了）",
  Math.abs(backToRoad - roadLeft) <= 40,
  `離開時 ${roadLeft}px、回來 ${backToRoad}px`,
);

/*
 * ⚠️ 反面檢查：0 是**合法的記錄**。
 *   在一頁捲到最上面之後離開再回來，必須仍然是 0——
 *   若實作寫成 `saved || 0`，行為剛好一樣所以看不出差別；
 *   這裡改驗「捲到非 0 再捲回 0」，確認記錄真的被更新過。
 */
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await go("guide");
await go("roadadmin");
const backToTop = await scrollY();
ok(
  "⚠️ 停在最上面也是一種記錄：回來仍然是 0（不是回到更早的 400）",
  backToTop === 0,
  `${backToTop}px`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 換分頁的捲動位置：第一次從最上面、回頭接著上次看");
