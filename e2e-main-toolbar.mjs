/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列的三態：鏡子／脫離／回歸，以及「不適用」的說明
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 裁示（三支程式共用同一套機制）：
 *   ①「圖可以自己改，但只影響那一張」
 *   ②「針對共同的篩選條件……圖表自身的工具列仍舊要與主工具列同步」
 *   ③「主工具列也多一個全部回歸鈕……避免有部分圖表忘記點選回歸」
 *   ④「有圖表不適用的條件，該圖表就單獨顯示不適用」
 *
 * ── 這一支為什麼要這樣驗 ─────────────────────────────────────
 *
 * ⚠️ ①和②要**一起驗**。只驗①的話，一個「區塊上永遠顯示自己的預設值、
 *   根本不看主工具列」的實作也會全綠——而那正是升級前這一支程式的狀態
 *  （所有條件散在各區塊，主工具列根本不存在）。
 *
 * ⚠️ 驗「鏡子」不可以只比對下拉的 value。value 對了但畫面沒重算的話
 *   （表還是舊的），使用者照樣會把錯的數字抄走。所以每一步都**連數字一起量**。
 *
 * ⚠️ 這一支程式最重要的一條在最後：**主工具列全部預設時，
 *   尖峰彙總必須與升級前逐格相同**。彙總的代表值是「同一組 4 筆裡最差的那一筆」，
 *   升級把它改成「先依主工具列篩、再挑最差」；預設（代表尖峰、全部方向）
 *   下那兩者必須是同一件事。這裡直接和 rebuild() 建的 state.summaries 對帳。
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
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2400);

/* ══ ⓪-2c 一開機時主工具列要是**收合**的（X-78）════════════════
 *
 * 使用者 2026-09-17：「重新載入或第一次開網頁時，主工具列是否能預設為
 *   收合狀態。下方版面比較清楚」——三支同步。
 *
 * ⚠️ 兩件事一起驗，缺一條都守不住：
 *   ① 那一排條件真的收起來了（量**實際高度**，不是只看 hidden 屬性——
 *      `display:flex` 的權重比瀏覽器內建的 `[hidden]{display:none}` 高，
 *      只驗屬性的話畫面明明還看得見也會全綠，這是 2026-09-15 實測過的坑）
 *   ② 收起來之後**仍然看得到目前的條件**。收合不可以把「現在依什麼在算」
 *      一起藏掉，那比佔版面更糟。只驗①的話，一個「收合＝什麼都不顯示」
 *      的實作也會全綠。
 */
{
  const state = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="main-toolbar"]');
    const row = bar?.querySelector(".main-toolbar-row");
    const summary = bar?.querySelector('[data-testid="mt-summary"]');
    const toggle = bar?.querySelector('[data-testid="mt-toggle"]');
    return {
      found: Boolean(bar),
      expanded: toggle?.getAttribute("aria-expanded"),
      rowHeight: row ? Math.round(row.getBoundingClientRect().height) : -1,
      summary: (summary?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });
  ok(
    "前置：主工具列在畫面上（不在的話下面兩條恆真）",
    state.found,
  );
  ok(
    "⚠️ ⓪-2c 一開機時主工具列是收合的（條件那一排高度為 0）",
    state.expanded === "false" && state.rowHeight <= 0,
    `aria-expanded=${state.expanded}／條件列高 ${state.rowHeight}px`,
  );
  ok(
    "⚠️ ⓪-2c 收合狀態下仍然看得到目前的條件（收合不可以把口徑一起藏掉）",
    state.summary.length >= 4,
    state.summary || "（收合列上什麼都沒寫）",
  );
}
/*
 * ⚠️ ⓪-2c 量完之後才可以展開——下面每一節都要動主工具列的欄位，
 *   收合狀態下 selectOption 會等到逾時（X-78 之後的新前提）。
 */
await ensureToolbarOpen(page);
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "MAINBAR");
await page.fill("#projectName", "主工具列守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(500);

async function importQuarter(quarterIndex) {
  await page.evaluate(() =>
    document.querySelector('[data-view="import"]').click(),
  );
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
/* ⚠️ 三季：少於三季的話「季度區間拉開之後畫面要變」驗不到。 */
await importQuarter(0);
await importQuarter(1);
await importQuarter(2);

const goView = async (view) => {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view);
  await page.waitForTimeout(900);
};

/**
 * 內容區的數字指紋。
 *
 * ⚠️ 主工具列、脫離提示與不適用說明都要排除——那幾塊裡面也有數字
 *  （「115Q2」「2 塊」），一併算進去的話，「數字變了」會因為旁白變了而假通過。
 */
const numbers = () =>
  page.evaluate(() => {
    const host = document.querySelector(".view.active") || document.body;
    const skip = [
      ...document.querySelectorAll(
        ".main-toolbar, .chart-detach-note, .chart-inapplicable",
      ),
    ];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let text = "";
    let node;
    while ((node = walker.nextNode()))
      if (!skip.some((element) => element.contains(node.parentElement)))
        text += " " + node.nodeValue;
    return (text.match(/-?\d[\d,]*\.?\d*/g) || [])
      .map((value) => value.replace(/,/g, ""))
      .join("|");
  });

/* ══ ⓪ 主工具列在每一頁都看得到 ══ */
const views = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav button")].map(
    (button) => button.dataset.view,
  ),
);
ok("前置⓪：列得出分頁", views.length >= 8, `${views.length} 頁`);
const missing = [];
for (const view of views) {
  await goView(view);
  const shown = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="main-toolbar"]');
    if (!bar) return false;
    const box = bar.getBoundingClientRect();
    return box.height > 0;
  });
  if (!shown) missing.push(view);
}
ok(
  "⓪ 主工具列在每一頁都看得到（升級前這支程式完全沒有跨頁條件）",
  missing.length === 0,
  missing.join("、"),
);

/* ⓪-2 使用者指定的五個條件都在 */
const CONTROLS = [
  ["mt-period-from", "季度（起）"],
  ["mt-period-to", "季度（迄）"],
  ["mt-roads", "路段"],
  ["mt-day", "日別"],
  ["mt-direction", "方向"],
  ["mt-peak", "尖峰"],
];
const absent = [];
for (const [id, label] of CONTROLS)
  if ((await page.locator(`[data-testid="${id}"]`).count()) === 0)
    absent.push(label);
ok(
  "⓪-2 使用者指定的每一個條件都在主工具列上（少一個就是掉功能）",
  absent.length === 0,
  absent.join("、"),
);
const peakOptions = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-peak"] option')].map((o) =>
    o.textContent.trim(),
  ),
);
ok(
  "⓪-3 尖峰四個選項，而且**預設是「代表尖峰」**（＝升級前的既有行為）",
  peakOptions.length === 4 &&
    (await page.inputValue('[data-testid="mt-peak"]')) === "representative",
  peakOptions.join("／") +
    "；目前 " +
    (await page.inputValue('[data-testid="mt-peak"]')),
);

/* ══ ⓪-4 預設狀態下，彙總必須與 rebuild() 建的那一份逐格相同 ══ */
const summaryMatch = await page.evaluate(() => {
  const MTx = globalThis.LosMainToolbar;
  const code = globalThis.__losState?.activeCode;
  return { ok: Boolean(MTx), code: code || "" };
});
ok("前置：主工具列模組載入了", summaryMatch.ok);
await goView("summary");
const summaryDefault = await numbers();
ok("前置：尖峰彙總量得到數字", summaryDefault.length > 50);

/* ══ ① 鏡子：主工具列一改，圖表頁的數字跟著變 ══ */
/*
 * ⚠️ X-62（2026-09-17）：四張圖各自一頁之後，這一節改站在
 *   **各路段歷季旅行速率**那一頁量，理由寫在這裡以免下一個人又搬回去：
 *
 *   「各路段 LOS 圖」畫面上看得到的只有季別標籤與**等級字母**（A～F），
 *   量不到「數字變了」——它其實有重算（與旅行速率走的是同一份
 *   `renderCharts()` 的 `own`，同一支 MT.summariesFor），
 *   只是換成平日之後代表值仍然落在同一個等級，**畫面逐字相同**。
 *   在那一頁量「數字有沒有變」等於量一條與實作無關的東西。
 *
 * ⚠️ 所以改成兩條一起驗，比原本那一條強：
 *   ① 旅行速率那一頁：換日別 → 數字真的變（值本身會變）
 *   ①-2 LOS 那一頁：篩路段 → 卡片張數真的變（等級字母量不到，但張數量得到）
 *   只留其中一條的話，「其中一張圖沒接上主工具列」還是會全綠。
 */
await goView("speedTrend");
const chartsBefore = await numbers();
ok("前置①：各路段歷季旅行速率頁量得到數字", chartsBefore.length > 20);
await page.selectOption('[data-testid="mt-day"]', "weekday");
await page.waitForTimeout(1200);
const chartsAfterDay = await numbers();
ok(
  "① 主工具列改成「平日」→ **各路段歷季旅行速率的數字跟著變**（升級前這兩張圖一個條件都沒有）",
  chartsAfterDay !== chartsBefore,
  chartsAfterDay === chartsBefore ? "數字一模一樣＝沒有重算" : "已重算",
);
ok(
  "① 而且這時候**不該**出現「本區塊使用自己的條件」（它還跟著主工具列）",
  (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);
/* 區塊自己的下拉要是主工具列的鏡子 */
ok(
  "① 歷季趨勢的「日別」跟著主工具列變成平日（鏡子）",
  (await page.inputValue("#trendDay")) === "平日",
  await page.inputValue("#trendDay"),
);
ok(
  "① 三段分法的「日別」也跟著變成平日（鏡子）",
  (await page.inputValue("#bandDay")) === "平日",
  await page.inputValue("#bandDay"),
);
/*
 * ⚠️ 2026-09-17（甲案）：日別已經沒有「全部日別」這個選項了
 *   （使用者裁示：它與「平日＋假日並列」做的是同一件事，留兩個只會讓人猜）。
 *   這裡原本選 "all"，選項不存在 → Playwright 等 30 秒後整支炸掉。
 *   改選 "side-by-side"，也就是這一支現在的預設值＝回到「不縮小日別」的狀態，
 *   下面那幾節要驗的「脫離」語意一個字都沒變。
 */
await page.selectOption('[data-testid="mt-day"]', "side-by-side");
await page.waitForTimeout(1200);

/* ══ ② 脫離：在歷季趨勢改它自己的日別，只有那一塊變 ══ */
/*
 * ⚠️ X-62（2026-09-17）：歷季趨勢已經是自己一個大分頁了。
 *   停在「各路段 LOS 圖」那一頁的話，#trendDay 是隱藏的，
 *   selectOption 會等到逾時——而且 numbers() 讀的是 .view.active，
 *   量到的會是別張圖的數字。所以先切過去再動它。
 */
await goView("trendChart");
const beforeDetach = await numbers();
await page.selectOption("#trendDay", "假日");
await page.waitForTimeout(1200);
ok(
  "② 在歷季趨勢改日別 → 這一頁的數字變了",
  (await numbers()) !== beforeDetach,
);
ok(
  "② 出現「目前用本區塊自己的條件」與回歸鈕",
  (await page.locator('[data-testid="chart-detach-note"]').count()) >= 1 &&
    (await page.locator('[data-testid="chart-detach-reset"]').count()) >= 1,
);
ok(
  "② 那一行要寫出**主工具列現在是什麼**（只寫「自訂」使用者得自己捲回去對照）",
  /主工具列：/.test(
    await page
      .locator('[data-testid="chart-detach-note"]')
      .first()
      .innerText(),
  ),
);
ok(
  "② **主工具列自己不可以被帶著跑**（被帶走的話下次主工具列一動全部區塊都跳）",
  /* ⚠️ 甲案之後日別的「不縮小」值是 side-by-side，不再是 all。 */
  (await page.inputValue('[data-testid="mt-day"]')) === "side-by-side",
  await page.inputValue('[data-testid="mt-day"]'),
);
ok(
  "② **三段分法不受影響**（它是另一塊，有自己的條件）",
  (await page.inputValue("#bandDay")) === "ALL",
  await page.inputValue("#bandDay"),
);

/* ══ ③ 單塊回歸 ══ */
await page.locator('[data-testid="chart-detach-reset"]').first().click();
await page.waitForTimeout(1200);
ok(
  "③ 按「回到主工具列條件」之後，數字回到跟著主工具列的那一份",
  (await numbers()) === beforeDetach,
  (await numbers()) === beforeDetach ? "" : "回歸之後和「沒脫離時」不一樣",
);
ok(
  "③ 回歸之後那一條提示要消失（留著的話使用者以為還在脫離）",
  (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);

/* ══ ④ 不適用：篩了路段，三段分法要寫明不適用 ══ */
/*
 * ⚠️ X-62：三段分法的不適用說明在它自己那一頁；④ 這一整節都要站在那裡量。
 *   停在歷季趨勢頁的話，#bandNotes 是隱藏的，innerText 會是空字串，
 *   「有沒有寫明不適用」那兩條會變成恆假（或更糟，恆真）。
 */
await goView("bandChart");
ok(
  "④ 前置：沒有篩路段時，**不可以**出現條件式的不適用說明（那是噪音）",
  /*
   * ⚠️ 常駐的那幾句（data-inapplicable-always）不算——它們本來就一直在
   *   （例如「這一塊是設定，不受任何條件影響」）。
   *   這一條要抓的是「**沒篩卻跳出條件式的說明**」。
   */
  (await page
    .locator(
      '[data-testid="chart-inapplicable"]:not([data-inapplicable-always])',
    )
    .count()) === 0,
  await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="chart-inapplicable"]:not([data-inapplicable-always])',
      ),
    ]
      .map(
        (el) =>
          `${el.closest("[id]")?.id || "?"}：${(el.textContent || "").replace(/\s+/g, " ").slice(0, 40)}`,
      )
      .join(" ｜ "),
  ),
);
const firstRoad = (await roadOptionValues(page))[0] || "";
await pickRoads(page, [firstRoad]);
await page.waitForTimeout(1300);
const bandNote = await page.evaluate(
  () => document.getElementById("bandNotes")?.innerText || "",
);
ok(
  "④ 篩了路段之後，三段分法要寫明不適用，而且要說**為什麼**（分母變成 1）",
  bandNote.includes("不適用路段篩選") && bandNote.includes("分母"),
  bandNote.slice(0, 80),
);
ok(
  "④ 而且要說目前實際上是拿什麼在算（不可以只說不適用）",
  bandNote.includes("目前仍以"),
  bandNote.slice(0, 120),
);
await pickRoads(page, []);
await page.waitForTimeout(1200);
ok(
  "④ 取消路段篩選之後那一句要收掉",
  (await page.evaluate(
    () => document.getElementById("bandNotes")?.innerText || "",
  )) === "",
);

/* ══ ⑤ 全部回歸 ══ */
ok(
  "⑤ 前置：沒有人脫離時，主工具列**不可以**出現「回歸全部」（按下去沒反應的鈕＝壞掉的鈕）",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 0,
);
/*
 * ⚠️ X-62：兩塊在**不同的大分頁**上，各自切過去再改。
 *   停在同一頁的話，另一顆下拉是隱藏的，selectOption 會等到逾時。
 *   這一節要的是「兩塊同時脫離」，跨頁不影響那個語意——
 *   脫離狀態存在 MT.state.overrides 裡，不隨換頁重置。
 */
await goView("trendChart");
await page.selectOption("#trendDay", "假日");
await page.waitForTimeout(900);
await goView("bandChart");
await page.selectOption("#bandDay", "平日");
await page.waitForTimeout(900);
const resetAll = page.locator('[data-testid="mt-reset-all"]');
ok("⑤ 有區塊脫離之後，「回歸全部」才出現", (await resetAll.count()) === 1);
ok(
  "⑤ 而且要寫出**有幾塊**（使用者才知道按下去影響多少）",
  /\d+\s*塊/.test(await resetAll.innerText()),
  await resetAll.innerText(),
);
await resetAll.click();
await page.waitForTimeout(1300);
ok(
  "⑤ 按下去之後全部回到主工具列，那一顆鈕自己也收掉",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 0 &&
    (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);
ok(
  "⑤ 而且兩塊的下拉都真的回到主工具列的值",
  (await page.inputValue("#trendDay")) === "ALL" &&
    (await page.inputValue("#bandDay")) === "ALL",
  `趨勢=${await page.inputValue("#trendDay")}／三段=${await page.inputValue("#bandDay")}`,
);

/* ══ ⑥ 最重要的一條：預設狀態的彙總＝升級前的彙總 ══ */
await goView("summary");
await page.waitForTimeout(900);
ok(
  "⑥ 回到全部預設之後，尖峰彙總與一開始（升級前的算法）**逐字相同**",
  (await numbers()) === summaryDefault,
  (await numbers()) === summaryDefault
    ? ""
    : "代表值被「先篩再挑最差」改掉了——這是這一支程式最不可以出的錯",
);

/* ══ ⑦ 主工具列：固定在上方 ＋ 可收合（使用者 2026-09-15 指名） ══ */
{
  /*
   * 使用者的原話：「你當初是說會將主工具列固定在上方隨時可見，
   * 只是會做著展開的按鈕，避免版面佔用過大」。三件事都要驗：
   *   ① 固定在上方（position: sticky）
   *   ② 收得起來，而且**條件那一列真的不見了**
   *     ⚠️ 這一條最容易假通過：`display:flex` 的權重比瀏覽器內建的
   *       `[hidden]{display:none}` 高，所以只驗 hidden 屬性有沒有掛上的話，
   *       畫面明明還看得見也會全綠（2026-09-15 實測到的真實情況）。
   *       所以要量**實際高度**。
   *   ③ 收起來之後仍然看得到目前的條件（不然要確認「現在依什麼在算」就得先展開）
   */
  const sticky = await page.evaluate(() => {
    const node = document.querySelector('[data-testid="main-toolbar"]');
    return node ? getComputedStyle(node).position : "";
  });
  ok("⑦ 主工具列固定在上方（sticky）", sticky === "sticky", sticky);
  /*
   * ⚠️⚠️ 只驗 `position: sticky` 是**假綠**。
   *
   * 使用者 2026-09-15：「因為主工具列**不能常駐在畫面上方**，
   *   要改變條件很不方便」——而這一支守門當時是綠的。
   *   CSS 寫了 sticky 不代表它真的黏得住：祖先只要有 overflow
   *   就會讓 sticky 失效，而且**沒有任何錯誤訊息**；
   *   吸頂的表頭也可能把它蓋掉——那同樣是「看不到」。
   *
   * 所以改成**真的捲下去再量**：捲到頁面很下面之後，
   * 主工具列必須仍然看得見、貼在視窗上緣，而且**沒有被別的吸頂元素蓋住**
   *（用 elementFromPoint 量它自己那一條上緣的中點）。
   */
  /*
   * ⚠️ 要先確定**這一頁真的捲得動**，否則量到的「黏住」是假的
   *   （根本沒捲，當然還在原地）。內容不夠長時把視窗壓矮再量。
   */
  const viewportBefore = page.viewportSize();
  const canScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  if (canScroll < 400)
    await page.setViewportSize({
      width: viewportBefore.width,
      height: 420,
    });
  await page.waitForTimeout(300);
  const stickTop = await page.evaluate(async () => {
    window.scrollTo(0, 2000);
    await new Promise((r) => setTimeout(r, 400));
    const node = document.querySelector('[data-testid="main-toolbar"]');
    if (!node) return { scrolled: window.scrollY, top: null };
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(rect.top + 4),
    );
    return {
      scrolled: Math.round(window.scrollY),
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      viewport: window.innerHeight,
      covered: !(hit && (node === hit || node.contains(hit))),
      coveredBy: hit ? hit.className || hit.tagName : "",
    };
  });
  ok(
    "⑦ 前置：頁面真的捲得動（捲不動的話下面兩條恆真）",
    stickTop.scrolled > 300,
    `scrollY=${stickTop.scrolled}`,
  );
  ok(
    "⚠️ ⑦ 捲到下面之後，主工具列**仍然黏在視窗上緣**（只驗 CSS 是 sticky 會假綠）",
    stickTop.top !== null &&
      stickTop.top >= 0 &&
      stickTop.top <= 120 &&
      stickTop.top + stickTop.height <= stickTop.viewport,
    `捲到 ${stickTop.scrolled}px 時，工具列上緣在 ${stickTop.top}px（高 ${stickTop.height}px、視窗 ${stickTop.viewport}px）`,
  );
  ok(
    "⚠️ ⑦ 而且沒有被別的吸頂元素蓋住（蓋住等於看不到，和沒有 sticky 一樣）",
    stickTop.top !== null && !stickTop.covered,
    stickTop.covered ? `被「${stickTop.coveredBy}」蓋住` : "沒有被蓋住",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize(viewportBefore);
  await page.waitForTimeout(300);

  const rowHeight = () =>
    page.evaluate(() => {
      const row = document.querySelector(".main-toolbar-row");
      return row ? Math.round(row.getBoundingClientRect().height) : -1;
    });
  const openHeight = await rowHeight();
  ok("⑦ 前置：展開時條件列有高度", openHeight > 20, `${openHeight}px`);

  await page.locator('[data-testid="mt-toggle"]').click();
  await page.waitForTimeout(500);
  const closedHeight = await rowHeight();
  ok(
    "⑦ 收起來之後條件列**實際上看不見了**（只驗 hidden 屬性會假通過）",
    closedHeight === 0,
    `${openHeight}px → ${closedHeight}px`,
  );
  const summary = await page
    .locator('[data-testid="mt-summary"]')
    .innerText()
    .catch(() => "");
  ok(
    "⑦ 收起來之後仍然看得到目前的條件",
    summary.trim().length > 0,
    summary.slice(0, 60),
  );
  await page.locator('[data-testid="mt-toggle"]').click();
  await page.waitForTimeout(500);
  ok(
    "⑦ 再按一次展開回來",
    (await rowHeight()) > 20,
    `${await rowHeight()}px`,
  );
}

/* ══ ⑧ 「恢復預設條件」（X-10，使用者 2026-09-16）══════════════ */
console.log("\n══ ⑧ 一鍵把主工具列的條件回到預設 ══");
/*
 * ⚠️ 這一節要同時守正反兩面：
 *   ・條件動過 → 那一顆要出現、按了之後**每一格都回到預設**
 *   ・條件是預設 → 那一顆**不可以出現**（主工具列要簡潔）
 *   ・按了它**不可以**動到脫離中的區塊（那是「回歸全部」的事，兩顆不同事）
 *   只驗第一面的話，做成「永遠顯示」也會全綠。
 */
await page.evaluate(() => document.querySelector('[data-view="detail"]').click());
await page.waitForTimeout(400);
const defaultsNow = await page.evaluate(() => ({
  main: { ...globalThis.LosMainToolbar.state.main },
  periods: [...globalThis.LosMainToolbar.state.periods],
}));
ok(
  "⑧ 預設狀態下**不可以**出現「恢復預設條件」",
  (await page.locator('[data-testid="mt-reset-main"]').count()) === 0,
);
/* 動四個條件，外加讓一塊脫離。 */
await page.selectOption('[data-testid="mt-day"]', "weekday");
await page.waitForTimeout(300);
await page.selectOption('[data-testid="mt-direction"]', "方向1");
await page.waitForTimeout(300);
await page.selectOption('[data-testid="mt-period-from"]', defaultsNow.periods[1]);
await page.waitForTimeout(300);
await page.evaluate(() => {
  const MT = globalThis.LosMainToolbar;
  MT.setChart(MT.CHART_IDS.trend, "day", "holiday");
});
await page.waitForTimeout(600);
ok(
  "⑧ 條件動過之後那一顆才出現",
  (await page.locator('[data-testid="mt-reset-main"]').count()) === 1,
);
const detachedBefore = await page.evaluate(
  () =>
    globalThis.LosMainFilters.detachedIds(globalThis.LosMainToolbar.state.overrides)
      .length,
);
await page.locator('[data-testid="mt-reset-main"]').click();
await page.waitForTimeout(800);
const afterReset = await page.evaluate(() => ({
  main: { ...globalThis.LosMainToolbar.state.main },
  periods: [...globalThis.LosMainToolbar.state.periods],
  detached: globalThis.LosMainFilters.detachedIds(
    globalThis.LosMainToolbar.state.overrides,
  ).length,
}));
ok(
  "⚠️ ⑧ 按下去之後**每一格**都回到預設（季度起迄、路段、日別、方向、尖峰）",
  afterReset.main.periodFrom === afterReset.periods[0] &&
    afterReset.main.periodTo ===
      afterReset.periods[afterReset.periods.length - 1] &&
    (afterReset.main.roads || []).length === 0 &&
    /*
     * ⚠️ 甲案（使用者 2026-09-17）之後，日別與方向的預設值都是
     *   "side-by-side"（並列）——「全部日別／全部方向」那兩個選項已經移除，
     *   因為它們與並列做的是同一件事。
     *   驗的東西沒有變：**按下去要回到 DEFAULT_MAIN_FILTERS**。
     */
    afterReset.main.day === "side-by-side" &&
    afterReset.main.direction === "side-by-side" &&
    afterReset.main.peak === "representative",
  JSON.stringify(afterReset.main),
);
ok(
  "⚠️ ⑧ 而且**不可以**動到脫離中的區塊（那是「回歸全部」的事，兩顆不同事）",
  detachedBefore > 0 && afterReset.detached === detachedBefore,
  `按之前 ${detachedBefore} 塊 → 按之後 ${afterReset.detached} 塊`,
);
ok(
  "⑧ 回到預設之後那一顆又收起來",
  (await page.locator('[data-testid="mt-reset-main"]').count()) === 0,
);
await page.evaluate(() => globalThis.LosMainToolbar.resetAll());
await page.waitForTimeout(400);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 鏡子／脫離／回歸／全部回歸／不適用說明，加上彙總不變，六件事都對");

/*
 * 路段是**下拉式多選**（使用者 2026-09-15 指名改成與全日交通量同一種格式），
 * 不再是 <select multiple>，所以 selectOption() 不能用了。
 * 這兩支小函式就是「打開面板 → 勾／取消 → 收起來」。
 */
async function pickRoads(page, names) {
  await page.evaluate((wanted) => {
    const button = document.querySelector('[data-testid="mt-roads"]');
    const panel = document.getElementById("mtRoadsPanel");
    if (!button || !panel) throw new Error("找不到路段下拉");
    if (panel.hidden) button.click();
    if (!wanted.length) {
      panel.querySelector("[data-roads-all]").click();
      return;
    }
    for (const box of panel.querySelectorAll("input[data-road]")) {
      const want = wanted.includes(box.dataset.road);
      if (box.checked !== want) box.click();
    }
  }, names);
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}
async function roadOptionValues(page) {
  return page.evaluate(() => {
    const button = document.querySelector('[data-testid="mt-roads"]');
    const panel = document.getElementById("mtRoadsPanel");
    if (panel && panel.hidden) button.click();
    const values = [
      ...(panel?.querySelectorAll("input[data-road]") || []),
    ].map((box) => box.dataset.road);
    if (panel && !panel.hidden) button.click();
    return values;
  });
}
