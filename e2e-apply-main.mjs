/*
 * ══════════════════════════════════════════════════════════════════════
 *  成果交付／結論草稿：「套用主工具列目前的條件」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 對這兩頁的裁示是**維持獨立**（不自動跟著主工具列跑），
 * 另加一顆「套用主工具列目前的條件」。理由很實際：報告常常要輸出一份
 * 和畫面上不同的範圍（畫面在看最新一季、報告要出全年）。
 *
 * ⚠️ 「獨立」和「按了會套用」要**一起驗**。
 *   只驗後者的話，一個「其實一直自動跟著主工具列」的實作也會全綠，
 *   而那正是使用者明確否決的行為。
 *
 * ⚠️ 按下去要**看得出真的變了**，不可以只看有沒有 toast。
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
await page.waitForTimeout(800);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "APPLYMAIN");
await page.fill("#projectName", "套用主工具列守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(500);
async function importQuarter(index) {
  await page.evaluate(() =>
    document.querySelector('[data-view="import"]').click(),
  );
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
await importQuarter(2);

/* 先在主工具列拉一個明顯不同的區間 ＋ 一個日別，這樣「有沒有套用」才看得出來。 */
const periods = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-period-from"] option')].map(
    (o) => o.value,
  ),
);
ok("前置：主工具列列得出多季", periods.length >= 3, String(periods.length));
const wantedFrom = periods[periods.length - 2];
await page.selectOption('[data-testid="mt-period-from"]', wantedFrom);
await page.waitForTimeout(900);
await page.selectOption('[data-testid="mt-day"]', "weekday");
await page.waitForTimeout(900);
const mainTo = await page.inputValue('[data-testid="mt-period-to"]');

const goView = async (view) => {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view);
  await page.waitForTimeout(900);
};

/* ══ ① 成果交付 ══ */
await goView("delivery");
const deliveryState = () =>
  page.evaluate(() => ({
    start: document.getElementById("deliveryPeriodStart")?.value || "",
    end: document.getElementById("deliveryPeriodEnd")?.value || "",
    day: document.getElementById("deliveryDay")?.value || "",
  }));
const beforeDelivery = await deliveryState();
ok(
  "① 這一頁**不自動**跟著主工具列（使用者明確要它獨立）",
  beforeDelivery.start !== wantedFrom || beforeDelivery.day !== "平日",
  `交付現在是 ${beforeDelivery.start}～${beforeDelivery.end}／${beforeDelivery.day || "平日與假日"}；主工具列是 ${wantedFrom}～${mainTo}／平日`,
);
const applyDelivery = page.locator('[data-testid="delivery-apply-main"]');
ok("① 有「套用主工具列目前的條件」這一顆", (await applyDelivery.count()) === 1);
await applyDelivery.click();
await page.waitForTimeout(1200);
const afterDelivery = await deliveryState();
ok(
  "① 按下去之後，起訖季度與日別真的變成主工具列那一組",
  afterDelivery.start === wantedFrom &&
    afterDelivery.end === mainTo &&
    afterDelivery.day === "平日",
  `交付變成 ${afterDelivery.start}～${afterDelivery.end}／${afterDelivery.day}`,
);
const deliveryToast = await page.evaluate(
  () => document.getElementById("toast")?.textContent || "",
);
ok(
  "① 要**說出套用了什麼**（默默改掉整組條件，使用者會以為是自己點錯）",
  deliveryToast.includes("已套用主工具列"),
  deliveryToast.slice(0, 120),
);

/* ══ ② 結論草稿 ══ */
await goView("conclusion");
const matched = () =>
  page.evaluate(() => {
    const node = document.getElementById("conclusionCount");
    const match = (node?.textContent || "").match(/(\d+)/);
    return match ? Number(match[1]) : -1;
  });
const scopeKind = () =>
  page.evaluate(() => {
    const label = [
      ...document.querySelectorAll("#conclusionScopeKinds label"),
    ].find((item) => item.querySelector("input")?.checked);
    return (label?.textContent || "").trim();
  });
const beforeMatched = await matched();
const beforeScope = await scopeKind();
ok("前置：量得到「符合條件 N 筆」", beforeMatched >= 0, String(beforeMatched));
const applyConclusion = page.locator('[data-testid="conclusion-apply-main"]');
ok(
  "② 有「套用主工具列目前的條件」這一顆",
  (await applyConclusion.count()) === 1,
);
await applyConclusion.click();
await page.waitForTimeout(1200);
ok(
  "② 按下去之後統計範圍換成「季度區間」（主工具列的起≠迄）",
  (await scopeKind()) === "季度區間",
  `現在是 ${await scopeKind()}（按之前是 ${beforeScope}）`,
);
const afterMatched = await matched();
/*
 * ⚠️ 套用之後**不可以變成 0 筆**：那代表條件被塞了一個不存在的值
 *  （例如把「並列」當成一個方向塞進去）。條件看起來設好了、卻篩不到東西，
 *   是這一顆最容易出的錯。
 */
ok(
  "② 套用之後不可以變成 0 筆（條件塞了不存在的值就會變 0）",
  afterMatched > 0,
  `${beforeMatched} 筆 → ${afterMatched} 筆`,
);
ok(
  "② 而且真的縮小了（主工具列篩了季度區間與平日）",
  afterMatched < beforeMatched,
  `${beforeMatched} 筆 → ${afterMatched} 筆`,
);
const conclusionToast = await page.evaluate(
  () => document.getElementById("toast")?.textContent || "",
);
/*
 * ⚠️ 這一條的期望值在 2026-09-15 **反過來了**，不是守門壞掉：
 *
 *   舊版：結論草稿沒有「代表尖峰」這個概念，所以按下去時它會在 toast 裡
 *         說「這一項沒有套進去」——那一句本身是對的（誠實回報漏掉的東西），
 *         但真正該做的是**把那個概念補上**。
 *   新版：「代表尖峰（系統取最差）」對應的是草稿的**資料層級**
 *        （先篩再挑最差，與尖峰彙總同一個口徑），所以它現在**真的會被套用**，
 *         toast 改成寫出套用後的資料層級。
 *
 * ⚠️ 所以這裡要驗的是「資料層級真的變成代表紀錄」，而且**條件真的生效**
 *  （下一條），不是只看 toast 的字——只驗字的話，寫死一句話就會綠。
 */
ok(
  "② 要說出套用了什麼，包含資料層級（代表尖峰＝先篩再挑最差）",
  conclusionToast.includes("已套用主工具列") &&
    conclusionToast.includes("資料層級：代表紀錄"),
  conclusionToast.slice(0, 200),
);
const rowLevelPicked = await page.evaluate(
  () =>
    document.querySelector('#conclusionRowLevel input[value="representative"]')
      ?.checked === true,
);
ok(
  "② 畫面上的「資料層級」也真的切到代表紀錄（不是只有 toast 說說）",
  rowLevelPicked,
  `representative 被選取：${rowLevelPicked}`,
);
/*
 * ⚠️ 最重要的一條：換成代表紀錄之後，**筆數要真的變少**。
 *   代表紀錄是「同一組（季度・路段・日別）四筆取一筆」，
 *   所以它一定比逐筆明細少。數字沒變就代表這個選項根本沒接上——
 *   而畫面上兩顆圓鈕看起來都很正常。
 */
await page.evaluate(() => {
  const input = document.querySelector('#conclusionRowLevel input[value="detail"]');
  if (input) {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await page.waitForTimeout(500);
const detailMatched = await matched();
await page.evaluate(() => {
  const input = document.querySelector(
    '#conclusionRowLevel input[value="representative"]',
  );
  if (input) {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await page.waitForTimeout(500);
const repMatched = await matched();
ok(
  "② 資料層級真的改變筆數（代表紀錄一定比逐筆明細少）",
  detailMatched > 0 && repMatched > 0 && repMatched < detailMatched,
  `逐筆明細 ${detailMatched} 筆 → 代表紀錄 ${repMatched} 筆`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 兩頁都維持獨立，而且一鍵套得上主工具列的條件");
