/*
 * ══════════════════════════════════════════════════════════════════════
 *  點小分頁之後，**停下來的位置**要對
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「我點了『目前套用的判定標準』小分頁後，右邊跳轉的畫面卻不是小分頁
 *     所在位置，反而還得往上滑。」
 *   「我點選 交通服務水準所有的小分頁，右側跳轉的畫面都是看不到小分頁
 *     正確的位置，定位應該有偏。」
 *
 * ⚠️ 既有的 e2e-nav-sections／e2e-nav-coverage 驗的是
 *   「有列出來」「點得到」「框得起來」——**沒有一支在驗停在哪裡**。
 *   停錯位置比不會動更糟：畫面上照樣有標題、有表格，看起來很正常，
 *   使用者只是不知道自己站在目標的下方。
 *
 * 判準：點完之後，那一塊的**頂端**必須看得到——
 *   不可以被吸頂的表頭蓋住（top ≥ 表頭高度 － 容差），
 *   也不可以整塊掉到視窗外（top < 視窗高度）。
 *
 * ⚠️ 一定要驗「表頭高度」這一半。`scrollIntoView({block:"start"})` 會把
 *   元素頂端對到 y=0，而這一支的 <header> 是 position:sticky、height:72px，
 *   於是那一塊最上面 72px **永遠被蓋住**——標題正好在那 72px 裡。
 *   只驗「top ≥ 0」會全綠，抓不到使用者看到的毛病。
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
  const p = join(
    here,
    decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html",
  );
  if (!existsSync(p) || !p.startsWith(here)) {
    res.writeHead(404).end("nf");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(p)] || "application/octet-stream",
  });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 900 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

/*
 * ⚠️ 2026-09-15：浮在上面的**不只表頭**，還有主工具列。
 *   主工具列是這一天才加的，也是 sticky、黏在表頭底下。
 *   這一支原本只量 <header>，所以工具列擋住的那一段它看不到——
 *   守門會全綠，而使用者看到的仍然是「標題被蓋住」。
 *   ⚠️ 兩個都要**當場量**：主工具列可以收合、窄視窗會換行，高度一直在變。
 */
const stickyHeight = (selector) =>
  page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return 0;
    return getComputedStyle(node).position === "sticky"
      ? Math.round(node.getBoundingClientRect().height)
      : 0;
  }, selector);
const topbarH = await stickyHeight("header");
const toolbarH = await stickyHeight(".main-toolbar");
const headerH = topbarH + toolbarH;
console.log(
  `浮在上面的總高度：${headerH}px（表頭 ${topbarH} ＋ 主工具列 ${toolbarH}）——這一段永遠蓋在內容上面\n`,
);

const views = await page.evaluate(() =>
  [...document.querySelectorAll("nav button[data-view]")].map((b) => ({
    v: b.dataset.view,
    t: (b.textContent || "").trim(),
  })),
);

let checked = 0;
for (const { v, t } of views) {
  await page.locator(`nav button[data-view="${v}"]`).click();
  await page.waitForTimeout(500);
  const count = await page.locator(".nav-section").count();
  for (let i = 0; i < count; i += 1) {
    const item = page.locator(".nav-section").nth(i);
    const label = (await item.textContent())?.replace(/\s+/g, " ").trim() ?? "";
    /* 每一項都從畫面最上面開始點，否則「剛好本來就看得到」會變成假通過。 */
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await item.click();
    /* 平滑捲動要等它停下來再量。 */
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const el = document.querySelector(".is-focused");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        height: Math.round(r.height),
        vh: window.innerHeight,
        scrollY: Math.round(window.scrollY),
        max: Math.round(
          document.documentElement.scrollHeight -
            document.documentElement.clientHeight,
        ),
      };
    });
    checked += 1;
    if (!m) {
      problems.push(`${t} ／「${label}」：點了之後找不到被點名的區塊`);
      continue;
    }
    const where = `${t} ／「${label}」`;
    /*
     * ⚠️ 已經捲到文件最底、再也捲不動時，最後那一塊本來就到不了頂端。
     *   那不是定位錯，是沒有更多空間——這種情況只要求它「看得到」。
     */
    const atBottom = m.scrollY >= m.max - 2;
    const ok = atBottom
      ? m.top < m.vh && m.top + m.height > headerH
      : m.top >= headerH - 4 && m.top < m.vh;
    console.log(
      `${ok ? "✅" : "❌"} ${where}  頂端 top=${m.top}（表頭 ${headerH}）scrollY=${m.scrollY}${atBottom ? " ・已到底" : ""}`,
    );
    if (!ok)
      problems.push(
        m.top < headerH
          ? `${where}：區塊頂端在 ${m.top}px，被 ${headerH}px 的吸頂表頭蓋住 ${headerH - m.top}px，使用者要往上滑才看得到標題`
          : `${where}：區塊頂端在 ${m.top}px，掉到視窗（${m.vh}px）外面`,
      );
  }
}

/* ⚠️ 前置：真的有點到東西嗎。一項都沒點到的話上面全部變成恆真。 */
if (checked < 10)
  problems.push(
    `只點到 ${checked} 個小分頁（預期 ≥ 10）。量不到的話這一支變成恆真。`,
  );
if (errors.length) problems.push("有 JS 例外：" + errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log(`\n✅ 共 ${checked} 個小分頁，點完之後那一塊的頂端都看得到`);
