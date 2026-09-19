/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-42：速限**與預設值相同**時，也要能按「套用並重算 LOS」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16（附圖）：
 *   「該計畫全部的路段速限，如果和預設值一致，我直接按套用，
 *     它會說我數值沒調整，不給我做套用並重算。這三條路段公告速限就是50，
 *     怎會阻止我套用50這個數值，只是因為和預設數值一樣，
 *     就變成我沒有做過人工確認?」
 *
 * 他是對的：**「有沒有改動數值」與「有沒有人工確認過」是兩件事**。
 * 公告速限本來就可能剛好等於預設值 50，那也是確認。
 *
 * 後果不只是按鈕按不動——品質檢查的「速限未確認」因此**永遠消不掉**
 *（用使用者的真實檔實測：怎麼按都是 6 筆，修好之後是 0）。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**一個數值都不可以改**。改了就走的是舊路徑，這一支完全測不到東西。
 * 二、不可以只驗「按下去有反應」。要驗**狀態真的變成「已人工確認」**，
 *     而且**品質檢查的「速限未確認」歸零**——那才是使用者真正卡住的地方。
 * 三、原本那道守衛要擋的事**不可以被順手拆掉**：什麼都沒改、而且每一筆
 *     都已經確認過時，仍然要擋下來。所以這一支按**兩次**，驗第二次被擋。
 * 四、數值沒變時**不可以**下載備份、不可以留還原點——那會讓使用者
 *     以為剛才改了什麼。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

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
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
const downloads = [];
const dialogs = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("download", (download) => downloads.push(download.suggestedFilename()));
page.on("dialog", (event) => {
  dialogs.push(event.message().replace(/\s+/g, " ").slice(0, 120));
  event.accept();
});
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "SPEEDOK");
await page.fill("#projectName", "速限確認守門");
await page.click("#saveProject");
await page.waitForTimeout(500);
await page.evaluate(() =>
  document.querySelector('[data-view="import"]').click(),
);
await page.fill("#rocYear", "115");
await page.selectOption("#quarter", { index: 1 });
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
await page.waitForTimeout(4000);
await page.click("#commit");
await page.waitForTimeout(2000);

const gotoView = async (view) => {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view);
  await page.waitForTimeout(900);
};
/** 速限表每一列的「資料來源」欄。 */
const statuses = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#speedRows tr")].map((tr) =>
      (tr.querySelectorAll("td")[3]?.textContent || "").trim(),
    ),
  );
/** 目前畫面上的速限值（拿來證明「一個都沒改」）。 */
const limits = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-limit]")].map((input) => input.value),
  );
/** 品質總覽的「速限未確認」。 */
const unconfirmedCount = async () => {
  await gotoView("maintenance");
  const run = page.locator("#runHealth");
  if (await run.count()) {
    await run.click();
    await page.waitForTimeout(1800);
  }
  return page.evaluate(
    () => document.getElementById("qualitySpeed")?.textContent?.trim() ?? "",
  );
};

console.log("\n══ 前置 ══");
await gotoView("speed");
const before = await statuses();
const limitsBefore = await limits();
ok(
  "前置：速限表列得出資料，而且一開始全部是「預設值，未確認」",
  before.length > 0 && before.every((text) => text.includes("未確認")),
  `${before.length} 列：${[...new Set(before)].join("／")}`,
);
ok(
  "前置：預設值就是 50（這一支要驗的正是「值沒變也要能確認」）",
  limitsBefore.length > 0 && limitsBefore.every((value) => value === "50"),
  limitsBefore.join("、"),
);
ok(
  "前置：品質檢查一開始有「速限未確認」",
  Number(await unconfirmedCount()) > 0,
  await unconfirmedCount(),
);

/* ══ 一、一個數值都不改，直接按套用 ══════════════════════════ */
console.log("\n══ 一、值沒變也要能確認 ══");
await gotoView("speed");
const downloadsBefore = downloads.length;
await page.click("#applySpeed");
await page.waitForTimeout(2500);
const limitsAfter = await limits();
ok(
  "⚠️ ① 真的一個數值都沒改（改了的話這一支就測不到東西了）",
  JSON.stringify(limitsAfter) === JSON.stringify(limitsBefore),
  limitsAfter.join("、"),
);
const after = await statuses();
ok(
  "⚠️ ① 按下去之後每一列都變成「已人工確認」",
  after.length > 0 && after.every((text) => text.includes("已人工確認")),
  [...new Set(after)].join("／"),
);
ok(
  "⚠️ ① 品質檢查的「速限未確認」歸零（使用者真正卡住的地方）",
  (await unconfirmedCount()) === "0",
  await unconfirmedCount(),
);
ok(
  "⚠️ ① 數值沒變時**不下載備份**（下載了會讓人以為剛才改了什麼）",
  downloads.length === downloadsBefore,
  `這一次多下載了 ${downloads.length - downloadsBefore} 個檔`,
);
ok(
  "① 確認視窗要說明這一次不會改動數值",
  dialogs.some((text) => text.includes("不會改動任何數值")),
  dialogs.slice(-1)[0] ?? "(沒有跳確認視窗)",
);

/* ══ 二、原本那道守衛不可以被拆掉 ══════════════════════════ */
console.log("\n══ 二、真正的空操作仍然要擋 ══");
await gotoView("speed");
const dialogsBefore = dialogs.length;
await page.click("#applySpeed");
await page.waitForTimeout(1800);
ok(
  "⚠️ ② 全部已確認、值又沒變時，第二次按下去要被擋（不可以順手把守衛拆掉）",
  dialogs.length === dialogsBefore,
  `又跳了 ${dialogs.length - dialogsBefore} 次確認視窗`,
);
ok(
  "② 而且狀態維持「已人工確認」",
  (await statuses()).every((text) => text.includes("已人工確認")),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 速限：值與預設相同時照樣確認得了，而且真正的空操作仍然擋得住");
