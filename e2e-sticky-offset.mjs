/**
 * ══════════════════════════════════════════════════════════════════════
 *  吸頂的東西不可以互相蓋住——而且要跟著主工具列的實際高度走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這一支守的是 2026-09-15 查到的**既有缺陷**：
 *
 *   ・`.figure-row>.trend-figure` 的 `top` 原本寫死 **84px**（＝標題列 72 ＋ 12）。
 *     那是**主工具列還沒加進來之前**算的。主工具列 2026-09-15 起常駐在上方，
 *     所以歷季趨勢圖與三段分法圖捲動時，上緣會被工具列切掉——
 *     與使用者先前回報的「各路段 LOS 圖 標題文字消失了!!」是同一個症狀。
 *
 *   ・`header` 與 `.main-toolbar` **兩層都寫 `top: 0`**。工具列（z-30）疊在
 *     標題列（z-10）上面；目前看起來沒事只是因為工具列不透明，那是巧合。
 *
 * ── 為什麼不能寫死一個新數字 ────────────────────────────────────
 *
 * 主工具列的高度**會變**：
 *   ・可以收合（實測展開 67px、收合 42px）
 *   ・視窗窄的時候欄位換行，會再長高（實測 900px 寬時 71px）
 *   ・「回歸全部（N 塊）」那一顆有時候在、有時候不在
 * 寫死的話：收合時留一大段空白、展開時又被切掉——兩種都錯。
 * 所以改成由 app.js 量實際高度寫進 `--main-toolbar-h`，
 * 所有吸頂的東西用 `--sticky-top`。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**只驗 CSS 字串是 `var(--sticky-top)` 不算數。** 變數可能沒被寫、
 *     可能寫錯值、可能被更具體的規則蓋過。這裡**真的捲動**，再量座標。
 * 二、**只驗「圖的 top ≥ 0」不算數。** 被工具列蓋住時 top 仍然是正的
 *    （它只是躲在工具列後面）。要比的是**工具列的下緣**。
 * 三、**前置要先確認圖真的黏住了。** 沒有 sticky 的元素捲走之後 top 會變成
 *     負的，那時「top ≥ 工具列下緣」自然不成立——但紅的原因不是被蓋住。
 *     所以先驗「捲動後圖還在畫面上」。
 * 四、**要驗收合與展開兩種狀態。** 只驗一種的話，一個寫死數字的實作
 *     在那一種狀態下剛好會過。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

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
    viewport: { width: 1600, height: 900 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
/*
 * ⚠️ X-78 之後主工具列**一開機是收合的**。這一支整段是「展開 → 收合」
 *   的對照，不先展開的話 opened 量到的其實是收合高度，
 *   第②條會變成「收合之後高度**變高**」而紅——紅的是測試的前提，
 *   不是收合鈕壞了。
 */
await ensureToolbarOpen(page);
await page.waitForTimeout(400);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "STICKY");
await page.fill("#projectName", "吸頂守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(500);

async function importQuarter(quarterIndex) {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: quarterIndex });
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
/* 三季：歷季趨勢圖至少要畫得出線，不然「圖在不在畫面上」量不到東西。 */
await importQuarter(0);
await importQuarter(1);
await importQuarter(2);

/*
 * ⚠️ 先切到圖表頁再開始量。
 *   匯入頁短到**捲不動**（scrollY 永遠是 0），而 sticky 的 top 要等到
 *   「捲到它要黏住」的時候才看得出來——在捲不動的頁面上量，
 *   等於量了一條恆真的假檢查。
 */
await page.evaluate(() => document.querySelector('[data-view="trendChart"]').click());
await page.waitForTimeout(1200);

/* ══ 一、--main-toolbar-h 要等於主工具列的實際高度 ══════════════ */
console.log("\n══ 一、CSS 變數要跟著實際高度走 ══");

const measure = () =>
  page.evaluate(() => {
    const bar = document.querySelector(".main-toolbar");
    const header = document.querySelector("main header");
    const root = getComputedStyle(document.documentElement);
    const box = bar?.getBoundingClientRect();
    return {
      varPx: Number.parseFloat(root.getPropertyValue("--main-toolbar-h")) || 0,
      height: Math.round(box?.height ?? -1),
      top: Math.round(box?.top ?? -1),
      bottom: Math.round(box?.bottom ?? -1),
      open: bar?.dataset.open,
      headerBottom: Math.round(
        header?.getBoundingClientRect().bottom ?? -1,
      ),
    };
  });

const opened = await measure();
ok(
  "前置：主工具列真的畫得出來（高度 > 0，量不到的話下面全部恆真）",
  opened.height > 20,
  `高度 ${opened.height}px`,
);
ok(
  "① 展開時 --main-toolbar-h ＝ 實際高度",
  Math.abs(opened.varPx - opened.height) <= 1,
  `變數 ${opened.varPx}px vs 實際 ${opened.height}px`,
);
/*
 * ⚠️ 這一條**一定要先捲動再量**，不可以在頁首量。
 *   在頁首時主工具列還在它的自然位置（就在標題列底下），無論 top 寫 0
 *   還是寫 var(--topbar-h) 量起來都一樣——那是一條恆真的假檢查。
 *   sticky 的 top 要等到「捲到它要黏住」的時候才看得出來。
 *   （2026-09-15：路口轉向那一支我原本就是寫在頁首量的，把 CSS 還原成
 *     舊版去試，它照樣綠——三支一起改掉。）
 */
await page.evaluate(() => globalThis.scrollBy(0, 400));
await page.waitForTimeout(400);
const stuck = await measure();
const stuckScrollY = await page.evaluate(() => Math.round(globalThis.scrollY));
ok(
  "前置：真的捲到主工具列黏住了（沒捲的話下一條恆真）",
  stuckScrollY > 200,
  `scrollY=${stuckScrollY}`,
);
ok(
  "① 黏住之後，主工具列停在標題列**底下**，不是疊在它上面",
  Math.abs(stuck.top - stuck.headerBottom) <= 1,
  `工具列上緣 ${stuck.top}px、標題列下緣 ${stuck.headerBottom}px`,
);
await page.evaluate(() => globalThis.scrollTo(0, 0));
await page.waitForTimeout(400);

await page.evaluate(() => document.querySelector("#mtToggle")?.click());
await page.waitForTimeout(500);
const collapsed = await measure();
ok(
  "② 收合之後高度真的變矮了（沒變的話收合鈕是壞的，下一條會假綠）",
  collapsed.height > 0 && collapsed.height < opened.height - 10,
  `展開 ${opened.height}px → 收合 ${collapsed.height}px`,
);
ok(
  "② 收合時 --main-toolbar-h 也跟著變",
  Math.abs(collapsed.varPx - collapsed.height) <= 1,
  `變數 ${collapsed.varPx}px vs 實際 ${collapsed.height}px`,
);
await page.evaluate(() => document.querySelector("#mtToggle")?.click());
await page.waitForTimeout(500);

/* 視窗變窄 → 欄位換行 → 高度變高，變數也要跟著。 */
await page.setViewportSize({ width: 900, height: 900 });
await page.waitForTimeout(700);
const narrow = await measure();
ok(
  "③ 視窗變窄（欄位換行）之後，變數仍等於實際高度",
  Math.abs(narrow.varPx - narrow.height) <= 1,
  `變數 ${narrow.varPx}px vs 實際 ${narrow.height}px（寬 900px）`,
);
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(700);

/* ══ 二、真的捲動，圖不可以被工具列蓋住 ══════════════════════ */
console.log("\n══ 二、捲動之後圖仍然完整看得到（不被工具列蓋住）══");

await page.evaluate(() => document.querySelector('[data-view="trendChart"]').click());
await page.waitForTimeout(1200);

/*
 * ⚠️ 量之前要做兩件事，少一件這一段就量不到東西：
 *
 *  ① **把說明展開**。說明是收合的 <details>，收合時右欄只有一行。
 *     而且使用者回報的情境正是「**在看下方說明文字時**圖被滑走」，
 *     那本來就是展開狀態。
 *
 *  ② **把說明加長**。sticky 要黏得住，前提是**容器比它高**；
 *     守門用的測資只有三季，說明算出來很短（實測整列只比圖高 30px），
 *     於是圖根本沒有可以黏的範圍，量到的永遠是它的自然位置——
 *     那會讓這一段**看起來紅、但紅的原因不是缺陷**。
 *     真實資料的說明會長很多（十幾季、每季一段），所以這裡補一段長文字
 *     把情境造出來。⚠️ 只加高度、不改任何數字。
 */
await page.evaluate(() => {
  for (const item of document.querySelectorAll(
    "#trendCharts details.figure-note",
  )) {
    item.open = true;
    const body = item.querySelector(".figure-note-body");
    if (!body) continue;
    for (let i = 0; i < 12; i += 1) {
      const filler = document.createElement("p");
      filler.dataset.stickyFiller = "1";
      filler.textContent =
        "（守門用的填充文字，只為了把說明撐長到足以測試吸頂，不影響任何數字。）";
      body.append(filler);
    }
  }
});
await page.waitForTimeout(500);

/** 捲到「這一列還沒結束」的位置，再回報 sticky 圖與工具列的實際座標。 */
const probe = async (label) => {
  await page.evaluate(() => {
    const row = document.querySelector("#trendCharts .figure-row");
    const figure = row?.querySelector(".trend-figure");
    if (!row || !figure) return;
    row.scrollIntoView({ block: "start" });
    /*
     * ⚠️ 捲的距離要**依這一列還剩多少可以黏**來算，不可以寫死。
     *   捲過頭的話整列都出去了，圖當然不在畫面上——那不是缺陷。
     *   這裡捲到「剩餘黏著範圍」的一半，確保還在黏著區間內。
     */
    /*
     * ⚠️ 不可以直接用「這一列比圖長多少」的一半：sticky 能黏的範圍還要
     *   **扣掉 top 這個位移**，捲過頭的話圖會被這一列的下緣推上去，
     *   量到的上緣比 top 小，會被誤判成「被工具列切掉」。
     */
    const room =
      row.getBoundingClientRect().height -
      figure.getBoundingClientRect().height;
    const offset = Number.parseFloat(getComputedStyle(figure).top) || 0;
    /*
     * ⚠️ scrollIntoView 之後這一塊的上緣已經在視窗 0，元素早就進入
     *   sticky 的區間了，所以**不要再把 offset 加回去**——加回去就會
     *   捲過頭，被下緣推上來。可捲的上限就是 usable 本身，取一半最穩。
     */
    const usable = room - offset;
    globalThis.scrollBy(0, Math.max(0, Math.round(usable / 2)));
  });
  await page.waitForTimeout(600);
  const result = await page.evaluate(() => {
    const figure = document.querySelector(
      "#trendCharts .figure-row .trend-figure",
    );
    const bar = document.querySelector(".main-toolbar");
    if (!figure || !bar) return null;
    const f = figure.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const row = figure.closest(".figure-row");
    return {
      stickyRoom: Math.round(
        (row?.getBoundingClientRect().height ?? 0) - f.height,
      ),
      /* 真正能黏的範圍＝這一列比圖長的部分再扣掉 top 位移。 */
      usable: Math.round(
        (row?.getBoundingClientRect().height ?? 0) -
          f.height -
          (Number.parseFloat(getComputedStyle(figure).top) || 0),
      ),
      figureTop: Math.round(f.top),
      figureBottom: Math.round(f.bottom),
      barBottom: Math.round(b.bottom),
      viewport: globalThis.innerHeight,
      sticky: getComputedStyle(figure).position,
      scrollY: Math.round(globalThis.scrollY),
    };
  });
  if (result) console.log(`   ${label}：`, JSON.stringify(result));
  return result;
};

const scrolled = await probe("展開狀態");
ok(
  "前置：歷季趨勢圖找得到，而且真的設成 sticky",
  Boolean(scrolled) && scrolled.sticky === "sticky",
  scrolled ? `position: ${scrolled.sticky}` : "找不到圖",
);
ok(
  "前置：真的捲動了（沒捲的話下面幾條驗不到吸頂行為）",
  Boolean(scrolled) && scrolled.scrollY > 100,
  scrolled ? `scrollY=${scrolled.scrollY}` : "",
);
ok(
  "前置：扣掉 top 位移之後仍然有「可以黏」的範圍——沒有的話 sticky 本來就不會生效",
  Boolean(scrolled) && scrolled.usable > 150,
  scrolled
    ? `說明比圖長 ${scrolled.stickyRoom}px、扣掉位移後可黏 ${scrolled.usable}px`
    : "",
);
ok(
  "前置：捲動之後圖還在畫面上（沒黏住的話會被捲出去，那時下一條紅的原因是別的事）",
  Boolean(scrolled) &&
    scrolled.figureBottom > 0 &&
    scrolled.figureTop < scrolled.viewport,
  scrolled ? `top=${scrolled.figureTop}、bottom=${scrolled.figureBottom}` : "",
);
ok(
  "⚠️ 捲動時圖的上緣在主工具列**下面**（不可以被它切掉）",
  Boolean(scrolled) && scrolled.figureTop >= scrolled.barBottom - 1,
  scrolled
    ? `圖上緣 ${scrolled.figureTop}px、工具列下緣 ${scrolled.barBottom}px（差 ${
        scrolled.figureTop - scrolled.barBottom
      }px）`
    : "",
);

/* 收合狀態也要對：寫死數字的實作在這一種狀態會留一大段空白或被切掉。 */
await page.evaluate(() => document.querySelector("#mtToggle")?.click());
await page.waitForTimeout(500);
const scrolledCollapsed = await probe("收合狀態");
ok(
  "⚠️ 收合之後圖的上緣同樣在工具列下面，而且不會留一大段空白",
  Boolean(scrolledCollapsed) &&
    scrolledCollapsed.figureTop >= scrolledCollapsed.barBottom - 1 &&
    scrolledCollapsed.figureTop - scrolledCollapsed.barBottom <= 24,
  scrolledCollapsed
    ? `圖上緣 ${scrolledCollapsed.figureTop}px、工具列下緣 ${scrolledCollapsed.barBottom}px（差 ${
        scrolledCollapsed.figureTop - scrolledCollapsed.barBottom
      }px，要在 0～24 之間）`
    : "",
);
ok(
  "⚠️ 收合與展開兩種狀態下的間距差不多（寫死數字的話會差一整條工具列的高度）",
  Boolean(scrolled) &&
    Boolean(scrolledCollapsed) &&
    Math.abs(
      scrolled.figureTop -
        scrolled.barBottom -
        (scrolledCollapsed.figureTop - scrolledCollapsed.barBottom),
    ) <= 4,
  scrolled && scrolledCollapsed
    ? `展開差 ${scrolled.figureTop - scrolled.barBottom}px、收合差 ${
        scrolledCollapsed.figureTop - scrolledCollapsed.barBottom
      }px`
    : "",
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 吸頂高度跟著主工具列走，捲動時圖不會被切掉");
