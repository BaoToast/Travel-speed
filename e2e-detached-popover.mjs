/**
 * ══════════════════════════════════════════════════════════════════════
 *  L-2：「回歸全部」旁邊的浮動小卡——看得到是哪幾塊，點了會跳過去並關掉
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「主工具列跳出全部回歸鈕時，上面會寫目前共 N 項要回歸，你覺得要提供
 *     使用者選擇哪幾個回歸嗎？還是為了主工具列簡化目的，一次性全部回歸
 *     才是最實用的方式？」
 *   → 定案：維持一次性全部回歸，但 N 要**看得到是哪幾塊**。
 *
 *   「做成浮動小卡，不占版面很棒，但你提供了點一下清單裡的名稱，畫面會
 *     跳轉過去，那就要記得**浮動小卡也要跟著關掉**」
 *   「我怕展開時候，整個主工具列會被擠的超大」
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**「不佔版面」要真的量。** 只驗「有 position:absolute」不夠——
 *     可能被別的規則蓋過。這裡量**工具列在開小卡前後的高度**，必須一樣。
 * 二、**「點了會關掉」要真的點。** 而且要驗跳轉**也真的發生了**：
 *     只驗「小卡關掉了」的話，一顆什麼都不做的按鈕也會過。
 * 三、**名稱要是使用者看得懂的區塊名**，不是內部代號。
 *     這一項是使用者自己提過的原則（「篩選摘要印內部代號」被他抓過）。
 * 四、**前置要先真的讓某幾塊脫離**，否則整支恆真。
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
    viewport: { width: 1600, height: 950 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "POPOVER");
await page.fill("#projectName", "浮動小卡守門");
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
await importQuarter(0);
await importQuarter(1);

/* ══ 前置：真的讓兩塊脫離 ══════════════════════════════════════ */
console.log("\n══ 前置：讓幾塊脫離主工具列 ══");
/*
 * ⚠️ 2026-09-16：這裡原本只讓 trend 與 band 兩塊脫離，而那兩塊剛好都有
 *   `.panel-head h3`，所以下面「不是內部代號」那一條**永遠是綠的**——
 *   使用者實機一開小卡就看到「detail-table」。
 *   **每一塊都要脫離**：CHART_IDS 有幾塊就驗幾塊，少驗一塊就是少一個假綠。
 */
const detachInfo = await page.evaluate(() => {
  const MT = globalThis.LosMainToolbar;
  const MF = globalThis.LosMainFilters;
  if (!MT || !MF) return { count: -1, all: [] };
  const all = Object.keys(MT.CHART_IDS).map((key) => MT.CHART_IDS[key]);
  all.forEach((id) => MT.setChart(id, "day", "weekday"));
  return { count: MF.detachedIds(MT.state.overrides).length, all: all };
});
const detachedCount = detachInfo.count;
await page.waitForTimeout(1200);
ok(
  "前置：**每一塊**都真的脫離了（少驗一塊就是少一個假綠）",
  detachedCount === detachInfo.all.length && detachedCount > 2,
  `脫離 ${detachedCount} 塊／共 ${detachInfo.all.length} 塊`,
);
ok(
  "前置：「回歸全部」那一顆出現了",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 1,
);

/* ══ 一、小卡不佔版面 ══════════════════════════════════════════ */
console.log("\n══ 一、開小卡不可以把工具列撐大 ══");
const barHeightBefore = await page.evaluate(() =>
  Math.round(document.querySelector(".main-toolbar").getBoundingClientRect().height),
);
await page.locator('[data-testid="mt-detached-toggle"]').click();
await page.waitForTimeout(400);
const afterOpen = await page.evaluate(() => {
  const bar = document.querySelector(".main-toolbar");
  const pop = document.querySelector('[data-testid="mt-detached-pop"]');
  return {
    barHeight: Math.round(bar.getBoundingClientRect().height),
    popVisible: Boolean(pop) && !pop.hidden,
    popPosition: pop ? getComputedStyle(pop).position : "",
    popHeight: pop ? Math.round(pop.getBoundingClientRect().height) : -1,
    items: pop ? pop.querySelectorAll("[data-detached-goto]").length : -1,
    labels: pop
      ? [...pop.querySelectorAll("[data-detached-goto]")].map((node) =>
          node.textContent.trim(),
        )
      : [],
  };
});
ok("① 小卡打得開", afterOpen.popVisible && afterOpen.popHeight > 40, `高 ${afterOpen.popHeight}px`);
await page.screenshot({ path: ".probe-shots/l2-popover.png" });
ok(
  "① 小卡是**浮起來**的（position: absolute）",
  afterOpen.popPosition === "absolute",
  afterOpen.popPosition,
);
ok(
  "⚠️ ① 開了小卡之後，主工具列的高度**完全不變**（使用者怕的就是被擠大）",
  afterOpen.barHeight === barHeightBefore,
  `開之前 ${barHeightBefore}px → 開之後 ${afterOpen.barHeight}px`,
);
ok(
  "② 清單列出的塊數＝脫離的塊數",
  afterOpen.items === detachedCount,
  `列了 ${afterOpen.items} 項／脫離 ${detachedCount} 塊`,
);
/*
 * ⚠️ 名稱必須是**使用者看得懂的區塊名**，不是 trend-panel 這種內部代號。
 *   判準：不可以長得像代號（全是小寫英數與連字號），而且要含中文。
 */
ok(
  "② 列出來的是區塊名稱，不是內部代號",
  afterOpen.labels.length > 0 &&
    afterOpen.labels.every(
      (label) => /[一-鿿]/.test(label) && !/^[a-z0-9-]+$/.test(label),
    ),
  afterOpen.labels.join("、"),
);
/*
 * ⚠️ 使用者 2026-09-16 實機看到的就是這一條：小卡上寫「detail-table」。
 *   上面那一條（含中文／不像代號）擋不住「未命名區塊」這種退路，
 *   所以這裡**逐塊**比對：名稱不可以等於 id，也不可以是那個退路字串。
 */
ok(
  "⚠️ ② 每一塊的名稱都不是 id、也不是「未命名區塊」（逐塊比對）",
  afterOpen.labels.length === detachInfo.all.length &&
    afterOpen.labels.every(
      (label) => label !== "未命名區塊" && !detachInfo.all.includes(label),
    ),
  `${afterOpen.labels.length}／${detachInfo.all.length}：${afterOpen.labels.join("、")}`,
);

/* ══ 二、點名稱：跳過去，而且小卡要關掉 ══════════════════════ */
console.log("\n══ 二、點名稱之後小卡要跟著關掉（使用者指名的那一條）══");
const firstLabel = afterOpen.labels[0];
const beforeJump = await page.evaluate(() => ({
  view: document.querySelector(".view.active")?.id || "",
  scrollY: Math.round(globalThis.scrollY),
}));
await page.locator("[data-detached-goto]").first().click();
await page.waitForTimeout(900);
const afterJump = await page.evaluate(() => {
  const pop = document.querySelector('[data-testid="mt-detached-pop"]');
  const toggle = document.querySelector('[data-testid="mt-detached-toggle"]');
  const focused = document.querySelector(".is-focused");
  return {
    popVisible: Boolean(pop) && !pop.hidden,
    ariaExpanded: toggle ? toggle.getAttribute("aria-expanded") : "(沒有鈕)",
    view: document.querySelector(".view.active")?.id || "",
    focusedId: focused ? focused.id : "",
    focusedTop: focused ? Math.round(focused.getBoundingClientRect().top) : null,
    scrollY: Math.round(globalThis.scrollY),
    floating: (() => {
      const height = (selector) => {
        const node = document.querySelector(selector);
        return node && getComputedStyle(node).position === "sticky"
          ? node.getBoundingClientRect().height
          : 0;
      };
      return Math.round(height("header") + height(".main-toolbar"));
    })(),
  };
});
ok(
  "⚠️ ③ 點了名稱之後，浮動小卡要**跟著關掉**（使用者指名要做的）",
  !afterJump.popVisible && afterJump.ariaExpanded === "false",
  `小卡還開著：${afterJump.popVisible}、aria-expanded=${afterJump.ariaExpanded}`,
);
/*
 * ⚠️ 只驗「關掉了」不夠——一顆什麼都不做、只負責關小卡的按鈕也會過。
 *   所以一起驗「真的跳過去了」：那一塊被點名（is-focused）而且在畫面上。
 */
ok(
  "③ 而且**真的跳過去了**（那一塊被點名）",
  Boolean(afterJump.focusedId),
  `點名的是 #${afterJump.focusedId}（點的是「${firstLabel}」）`,
);
ok(
  "③ 跳過去之後那一塊的上緣沒有被浮在上面的工具列蓋住",
  afterJump.focusedTop !== null &&
    afterJump.focusedTop >= afterJump.floating - 8,
  `上緣 ${afterJump.focusedTop}px、浮在上面的共 ${afterJump.floating}px`,
);

/* ══ 三、其他關閉方式 ══════════════════════════════════════════ */
console.log("\n══ 三、按 Esc、點外面、按回歸全部，都要關掉 ══");
const reopen = async () => {
  await page.locator('[data-testid="mt-detached-toggle"]').click();
  await page.waitForTimeout(350);
  return page.evaluate(
    () => !document.querySelector('[data-testid="mt-detached-pop"]').hidden,
  );
};
const isOpen = () =>
  page.evaluate(() => {
    const pop = document.querySelector('[data-testid="mt-detached-pop"]');
    return Boolean(pop) && !pop.hidden;
  });

ok("前置：小卡再打得開（打不開的話下面三條恆真）", await reopen());
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok("④ 按 Esc 要關掉", !(await isOpen()));

ok("前置：小卡再打得開", await reopen());
await page.mouse.click(20, 400);
await page.waitForTimeout(300);
ok("④ 點小卡以外的地方要關掉", !(await isOpen()));

ok("前置：小卡再打得開", await reopen());
await page.locator('[data-testid="mt-reset-all"]').click();
await page.waitForTimeout(700);
ok(
  "④ 按「回歸全部」之後要關掉（清單本身已經沒有意義了）",
  !(await isOpen()),
);
ok(
  "④ 而且真的全部回歸了（「回歸全部」那一顆要消失）",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 0,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 浮動小卡：不佔版面、列得出區塊名稱、點了跳過去並關掉");
