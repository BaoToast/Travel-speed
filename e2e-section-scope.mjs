/*
 * ══════════════════════════════════════════════════════════════════════
 *  小分頁的醒目方框只框住它自己那一塊；LOS 圖表的區塊順序
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（附圖）：
 *   「服務水準判定方式的**醒目方框標示錯誤，把三段分法也框進來了**，請修正」
 *   「LOS圖表的順序請幫我調整一下顯示順序：
 *     **各路段LOS圖、各路段歷季旅行速率、歷季趨勢(可勾選指標)、三段分法(順暢/尚可/壅塞)**」
 *
 * ⚠️ 第一件的成因不是「框畫太大」：三段分法本來就**巢狀在**服務水準那個面板裡面，
 *   框住面板當然會把它一起框進去。所以驗的是**結構**——兩塊不可以互相包含。
 *   只驗「框變小了」會被「把 CSS 框改小」騙過去，而那時點三段分法還是會框到別人。
 *
 * ⚠️ 第二件真正決定側欄順序的是**畫面上區塊由上而下的順序**，
 *   所以要同時驗 DOM 順序與側欄順序**一致**——只改側欄清單的話，
 *   點下去的跳轉順序會和側欄對不起來。
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

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "SCOPE");
await page.fill("#projectName", "區塊範圍守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(700);

/* ── 一、判定標準：兩塊不可以互相包含 ───────────────────────── */
await page.locator('nav button[data-view="standards"]').click();
await page.waitForTimeout(600);

const nesting = await page.evaluate(() => {
  const los = document.getElementById("standards-los");
  const band = document.getElementById("standards-band");
  if (!los || !band) return { missing: true };
  return {
    missing: false,
    losContainsBand: los.contains(band),
    bandContainsLos: band.contains(los),
    losHeight: Math.round(los.getBoundingClientRect().height),
    bandHeight: Math.round(band.getBoundingClientRect().height),
  };
});
ok("前置：兩個區塊都在畫面上（否則整段恆真）", !nesting.missing);
ok(
  "「服務水準判定方式」不可以包住「圖表的三段分法」",
  nesting.losContainsBand === false,
  `los ${nesting.losHeight}px、band ${nesting.bandHeight}px`,
);
ok("反過來也不可以", nesting.bandContainsLos === false);

/* 實際點一次，量兩個醒目框的高度必須不同（而且都 > 0）。 */
const boxOf = async (label) => {
  await page.locator(`.nav-section:has-text("${label}")`).first().click();
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const el = document.querySelector(".is-focused");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      id: el.id,
      height: Math.round(rect.height),
      containsBand: el.contains(document.getElementById("standards-band")),
    };
  });
};
const losBox = await boxOf("服務水準判定方式");
ok("點「服務水準判定方式」有醒目框", !!losBox && losBox.height > 0, JSON.stringify(losBox));
ok(
  "而且那個框**沒有**把三段分法框進去",
  losBox && losBox.containsBand === false,
);
const bandBox = await boxOf("圖表的三段分法");
ok("點「圖表的三段分法」有醒目框", !!bandBox && bandBox.height > 0, JSON.stringify(bandBox));
ok(
  "兩個框是不同的元素",
  losBox && bandBox && losBox.id !== bandBox.id,
  `${losBox?.id} / ${bandBox?.id}`,
);

/* ── 二、X-62：四張圖的大分頁順序 ───────────────────────────── */
/*
 * ⚠️ 這一節原本驗的是「#charts 這一頁裡四塊由上而下的順序」。
 *   X-62（使用者 2026-09-17）把四張圖拆成四個大分頁之後，
 *   要驗的東西**平移到側欄**：使用者指定的順序是
 *     各路段 LOS 圖 → 各路段歷季旅行速率 → 歷季趨勢 → 三段分法
 *  （2026-09-13 他親自指定過，拆成大分頁不改順序）。
 *
 * ⚠️ 兩邊都要驗，缺一不可：
 *   ① 側欄上那四顆鈕的**顯示順序**（使用者看到的）
 *   ② 每一顆點下去，右邊真的是那一塊（順序對、內容錯一樣沒用）
 */
const WANTED = [
  ["losChart", "各路段 LOS 圖", "losChartSection"],
  ["speedTrend", "各路段歷季旅行速率", "speedTrendSection"],
  ["trendChart", "歷季趨勢（可勾選指標）", "trendPanel"],
  ["bandChart", "三段分法（順暢／尚可／壅塞）", "bandPanel"],
];
const navOrder = await page.evaluate(
  (ids) => {
    const all = [...document.querySelectorAll("nav button[data-view]")].map(
      (b) => b.dataset.view,
    );
    return ids.filter((id) => all.includes(id)).sort((a, b) => all.indexOf(a) - all.indexOf(b));
  },
  WANTED.map((entry) => entry[0]),
);
ok(
  "側欄上四個大分頁的順序＝各路段 LOS 圖、各路段歷季旅行速率、歷季趨勢、三段分法",
  JSON.stringify(navOrder) === JSON.stringify(WANTED.map((e) => e[0])),
  navOrder.join(" → "),
);
for (const [view, label, anchor] of WANTED) {
  await page.locator(`nav button[data-view="${view}"]`).click();
  await page.waitForTimeout(700);
  const landed = await page.evaluate(
    (id) => document.getElementById(id)?.closest(".view")?.id || "",
    anchor,
  );
  ok(
    `點「${label}」右邊顯示的就是 #${anchor}`,
    landed === view,
    landed ? `落在 #${landed}` : "找不到那一塊",
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 醒目框只框自己那一塊；四張圖的大分頁順序與內容都對");
