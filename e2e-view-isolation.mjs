/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一頁只可以顯示自己那一個分頁
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14（附兩張截圖，隔了兩則訊息才看出全貌）：
 *   「紅框處似乎不用留 因為沒資訊」
 *   「資料匯入區 怎會跑出LOS圖表，我查看了LOS圖表區正常顯示」
 *   「**你把每個分頁 都植入了LOS圖表區!**」
 *
 * ── 成因：CSS 具體度壓過了分頁的隱藏規則 ──────────────────────
 *
 * 分頁的顯示／隱藏靠這兩條：
 *     .view        { display: none  }   ← 具體度 0,1,0
 *     .view.active { display: block }   ← 具體度 0,2,0
 * 而我為了拉開圖表區塊的間距，寫了
 *     #charts      { display: flex  }   ← 具體度 1,0,0
 * ID 選擇器壓過 `.view{display:none}`，於是「LOS 圖表」這一頁
 * **永遠是顯示的**，黏在其他每一頁的最下面。實測 15 頁裡 14 頁中招。
 *
 * ⚠️ 這個坑最可怕的地方：**圖表頁自己看起來完全正常**。
 *   使用者的原話就是「我查看了LOS圖表區正常顯示」——
 *   只驗那一頁是永遠驗不出來的，一定要**逐頁走過去看有沒有多出別人**。
 *   既有的守門（跳轉落點、小分頁清單、區塊間距）全都是「在對的那一頁上
 *   量對的東西」，沒有一支會去問「這一頁上有沒有不該出現的東西」，
 *   所以整輪大檢查 0 紅，卻是使用者一眼就看到。
 *
 * ⚠️ 這一支不綁 #charts，也不綁 display 這個屬性——綁了就只擋得住
 *   同一個寫法再來一次。它問的是結果：這一頁上，除了自己以外，
 *   還有沒有別的 .view 畫得出高度。任何原因造成的洩漏都會被抓到。
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
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

/* 建一個計畫，讓需要計畫才長得出來的區塊也會渲染（空畫面驗不出洩漏）。 */
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "VIEWISO");
await page.fill("#projectName", "分頁隔離守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(700);

const views = await page.evaluate(() =>
  [...document.querySelectorAll("nav button[data-view]")].map((button) => ({
    view: button.dataset.view,
    label: (button.textContent || "").trim(),
  })),
);

/*
 * ⚠️ 前置①：側欄真的列得出分頁。列到 0 個的話下面那個迴圈一次都不會跑，
 *   整支會「檢查了 0 頁」然後全綠。
 */
ok("前置①：側欄列得出分頁", views.length >= 10, `${views.length} 頁`);

/*
 * ⚠️ 前置②：畫面上真的有多個 .view 存在。
 *   如果哪天分頁改成「只把當前那一頁放進 DOM」，本支的比對就恆真了
 *   ——那時這支要改寫成驗別的東西，不可以讓它安靜地變成裝飾。
 */
const viewCount = await page.evaluate(
  () => document.querySelectorAll(".view").length,
);
ok(
  "前置②：DOM 裡同時存在多個 .view（否則本支的比對恆真，要改寫）",
  viewCount >= 10,
  `${viewCount} 個`,
);

let checked = 0;
const leaks = [];
for (const { view, label } of views) {
  await page.locator(`nav button[data-view="${view}"]`).click();
  await page.waitForTimeout(250);
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll(".view")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.height > 2 && getComputedStyle(element).display !== "none"
        );
      })
      .map((element) => element.id),
  );
  checked += 1;
  const extra = shown.filter((id) => id !== view);
  if (extra.length)
    leaks.push(`「${label}」(#${view}) 上還看得到：${extra.join("、")}`);
  /*
   * ⚠️ 反面也要驗：自己一定要看得見。
   *   只驗「沒有別人」的話，一個全部隱藏的畫面會全綠。
   */
  if (!shown.includes(view))
    leaks.push(`「${label}」(#${view}) 連自己都看不見（分頁切換壞了）`);
}

ok("前置③：真的逐頁走過（走了 0 頁就是恆真）", checked >= 10, `${checked} 頁`);
ok(
  `每一頁都只顯示自己那一個分頁（共 ${checked} 頁）`,
  leaks.length === 0,
  leaks.join("　｜　"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 每一頁都只顯示自己那一個分頁，沒有別頁的內容洩漏進來");
