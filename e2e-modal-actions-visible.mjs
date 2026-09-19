/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一個「取消／確認／關閉」都要在它自己那一塊裡看得見
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（三支同步）：
 *   「畫面右下角的**取消／關閉功能，請保持始終可見**，不要像這張圖片視窗一樣，
 *     我必須把內容滑到最底部，才能看到取消／關閉的功能鍵。」
 *   「請**確實檢視每個有「取消、確認、關閉」的功能鍵**，這類功能鍵都能始終可見，
 *     而不用在視窗中要滑到最底才能選擇。」
 *
 * ── ⚠️ 這一支系統沒有任何彈出視窗，要先講清楚 ──────────────────
 *
 * 交通服務水準是**單頁分頁式**的：整份程式裡沒有一個 modal／dialog／overlay
 *（原始碼掃過，沒有任何彈出層；只有瀏覽器原生的 confirm，那不歸我們管）。
 * 所以使用者那句話在這一支的對應物是：
 *   **動作列所在的那一塊（panel），不可以高到讓人得先把整塊捲完才看得到按鈕。**
 *
 * ⚠️ 不可以因為「沒有 modal」就跳過這一支——那等於用定義閃掉要求。
 *   這裡驗的是同一件事的頁面版本。
 *
 * 量法：把該按鈕所在那一塊的**頂端對齊畫面頂端**（＝使用者剛捲到這一塊的狀態），
 * 然後量按鈕的 bottom 是否還在畫面內。要捲才看得到的就是不合格。
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
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * ⚠️ 明講出來的前提：這一支系統沒有彈出視窗。
 *   哪天有人加了一個，這條就會紅——那時這支守門要改成量那個視窗，
 *   不可以讓「沒有 modal」這個前提默默過期。
 */
const html = readFileSync(join(here, "index.html"), "utf8");
const js = readFileSync(join(here, "app.js"), "utf8");
const hasModal = /class="[^"]*\b(modal|dialog|overlay)\b/.test(html + js);
ok(
  "前提：這一支系統沒有彈出視窗（有的話這支守門要改寫成量那個視窗）",
  !hasModal,
);

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  /* ⚠️ 視窗刻意矮，才量得出「一塊比一畫面還高」。 */
  viewport: { width: 1440, height: 720 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

/* 建一個計畫，讓需要計畫才長出來的按鈕也出現。 */
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "MODALVIS");
await page.fill("#projectName", "動作列守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(700);

const views = await page.evaluate(() =>
  [...document.querySelectorAll("nav button[data-view]")].map((button) => ({
    view: button.dataset.view,
    label: (button.textContent || "").trim(),
  })),
);
ok("前置：側欄列得出分頁", views.length >= 10, `${views.length} 頁`);

const WORDS = ["取消", "確認", "關閉"];
let checked = 0;
const bad = [];
for (const { view, label } of views) {
  await page.locator(`nav button[data-view="${view}"]`).click();
  await page.waitForTimeout(400);
  const found = await page.evaluate((words) => {
    const active = document.querySelector(".view.active");
    if (!active) return [];
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 2 &&
        rect.height > 2 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        !element.closest("[hidden]")
      );
    };
    const buttons = [...active.querySelectorAll("button, a.primary, a.outline")]
      .filter(visible)
      .filter((element) =>
        words.some((word) => (element.textContent || "").includes(word)),
      );
    const out = [];
    for (const button of buttons) {
      /* 這顆按鈕屬於哪一塊：最近的 panel／article／section。 */
      const block =
        button.closest(".panel") ??
        button.closest("article") ??
        button.closest("section") ??
        active;
      /* 把這一塊的頂端對齊畫面頂端＝使用者剛捲到這一塊的狀態。 */
      const blockTop = block.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, blockTop - 8));
      const rect = button.getBoundingClientRect();
      const blockRect = block.getBoundingClientRect();
      out.push({
        text: (button.textContent || "").replace(/\s+/g, " ").trim().slice(0, 28),
        bottom: Math.round(rect.bottom),
        blockHeight: Math.round(blockRect.height),
        viewport: window.innerHeight,
        visible: rect.bottom <= window.innerHeight && rect.top >= 0,
      });
    }
    window.scrollTo(0, 0);
    return out;
  }, WORDS);
  for (const item of found) {
    checked += 1;
    if (!item.visible)
      bad.push(
        `${label}：「${item.text}」底=${item.bottom} > 畫面 ${item.viewport}（這一塊高 ${item.blockHeight}px）`,
      );
  }
}

ok(
  "前置：真的量到取消／確認／關閉類的按鈕（否則整支恆真）",
  checked > 0,
  `${checked} 顆`,
);
ok(
  `捲到該區塊頂端時，每一顆取消／確認／關閉都在畫面內（共 ${checked} 顆）`,
  bad.length === 0,
  bad.join("　｜　"),
);

/*
 * ══════════════════════════════════════════════════════════════════
 *  黏住的動作列**不可以吃掉太多畫面**
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14（附圖）：
 *   「這裡的確認鍵佔的比例太大了，**會遮擋到資料匯入後使用者確認每筆資料的空間**」
 *
 * ⚠️ 這是「動作列常駐」這個修正自己帶來的副作用：黏住的東西每多一像素，
 *   就少一像素給真正要看的表。實測那一條原本三列、約 250px（畫面的 28%）。
 *   所以「常駐」與「不可以太厚」必須一起驗，只驗前者會愈修愈糟。
 */
{
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.waitForTimeout(500);
  const bar = await page.evaluate(() => {
    const el = document.querySelector(".preview-actions");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      height: Math.round(rect.height),
      viewport: window.innerHeight,
      share: rect.height / window.innerHeight,
      sticky: getComputedStyle(el).position === "sticky",
    };
  });
  ok("前置：找得到匯入預覽的動作列", !!bar);
  if (bar) {
    ok("匯入預覽的動作列仍然是黏住的", bar.sticky);
    ok(
      "黏住的動作列高度不可以超過畫面的 20%（會蓋掉預覽表）",
      bar.share <= 0.2,
      `${bar.height}px／${bar.viewport}px ＝ ${Math.round(bar.share * 100)}%`,
    );
  }
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 每一顆取消／確認／關閉在它自己那一塊裡都看得見");
