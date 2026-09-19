/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-85：季度改名（交通服務水準）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-18：「請幫我將另外兩支也同步季度改名功能，
 *   擺放位置可以參考全日交通量程式擺放的地方。」
 *
 * ── ⚠️ 刻意迴避的假通過 ──────────────────────────────────────────
 * 一、**不可以只驗「改完之後新名字出現」**。只改 details 也會出現新名字，
 *     但匯入紀錄與季別覆寫仍指著舊季度、默默失效。
 *     所以要驗：**舊季度整個消失**（清單、匯入紀錄都不可以留）。
 * 二、**要驗撞名會被擋下來**，而且擋下來之後**資料一格都不可以動**。
 *     不驗這一條的話，「直接合併兩季」也會全綠——而那是把兩季混成一季，
 *     事後分不回來。
 * 三、**要驗數字沒有變**。改名只換一個標籤，任何一個統計值變了都是 bug。
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = here;
const SAMPLE_DIR = join(here, "test-fixtures");
const files = readdirSync(SAMPLE_DIR).filter((name) => name.endsWith(".xlsx"));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
const server = createServer((request, response) => {
  let path = decodeURIComponent(request.url.split("?")[0]);
  if (path === "/") path = "/index.html";
  const file = join(ROOT, path.replace(/^\//, ""));
  if (!existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": MIME[extname(file)] || "application/octet-stream",
  });
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};
const stop = (why) => {
  console.error(`\n❌ ${why}——後面的條件會變成恆真，直接停。`);
  problems.push(why);
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
const dialogs = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => {
  dialogs.push(event.message());
  void event.accept();
});
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await ensureToolbarOpen(page);

/* ── 前置：建計畫 → 匯入兩季（走真正的匯入流程）──────────────── */
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "RENAME");
await page.fill("#projectName", "季度改名守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(600);

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
  await page.waitForTimeout(1800);
}
await importQuarter(0);
await importQuarter(1);

await page.evaluate(() =>
  document.querySelector('[data-view="maintenance"]')?.click(),
);
await page.waitForTimeout(900);

/*
 * ⚠️ state 是模組內的變數，頁面外讀不到，所以這一支一律**從畫面上量**：
 *   季度清單（改名與刪除兩個下拉）＋匯入紀錄表＋可追溯明細裡的數字。
 *   從畫面量反而更貼近使用者看到的東西——改到一半時畫面一定會露餡。
 */
const snapshot = async () => {
  await page.evaluate(() =>
    document.querySelector('[data-view="maintenance"]')?.click(),
  );
  await page.waitForTimeout(700);
  const maintenance = await page.evaluate(() => ({
    rename: [...document.querySelectorAll("#renamePeriod option")].map(
      (o) => o.value,
    ),
    del: [...document.querySelectorAll("#deletePeriod option")].map(
      (o) => o.value,
    ),
  }));
  await page.evaluate(() =>
    document.querySelector('[data-view="importlog"]')?.click(),
  );
  await page.waitForTimeout(600);
  const importLog = await page.evaluate(() =>
    (document.getElementById("importLogRows")?.innerText || "").replace(
      /\s+/g,
      " ",
    ),
  );
  /*
   * 數字指紋：可追溯明細整張表的每一個數字。
   * ⚠️ 改名只換一個標籤，**這一串一格都不可以變**。
   *   不量數字的話，「改名時順手重算了一遍」這種 bug 會全綠。
   */
  await page.evaluate(() =>
    document.querySelector('[data-view="detail"]')?.click(),
  );
  await page.waitForTimeout(800);
  const values = await page.evaluate(() => {
    const text = document.getElementById("detailRows")?.innerText || "";
    /* 季別欄本身會變（那正是要改的），所以把 115Q? 這種字樣先拿掉再取數字。 */
    return (
      text.replace(/1\d{2}Q\d/g, " ").match(/-?\d[\d,]*\.?\d*/g) || []
    ).map((v) => v.replace(/,/g, ""));
  });
  return {
    periods: [...new Set(maintenance.rename)].sort(),
    deletePeriods: [...new Set(maintenance.del)].sort(),
    importLog,
    values,
  };
};

/* ⚠️ snapshot() 會走過好幾個分頁，回來時不一定停在資料維護。
   要動改名那一格之前一律先切回去，否則 selectOption 會等到逾時。 */
const goMaintenance = async () => {
  await page.evaluate(() =>
    document.querySelector('[data-view="maintenance"]')?.click(),
  );
  await page.waitForTimeout(700);
};

const before = await snapshot();
ok(
  "前置：改名之前有 115Q1 與 115Q2 兩季",
  before.periods.join("、") === "115Q1、115Q2",
  before.periods.join("、"),
);

/* ══ ① 撞名要被擋下來，而且一格都不可以動 ═══════════════════ */
console.log("\n══ ① 撞名：不合併，擋下來 ══");
await goMaintenance();
await page.selectOption("#renamePeriod", "115Q1");
await page.fill("#renamePeriodInput", "115Q2");
dialogs.length = 0;
await page.click("#renameQuarter");
await page.waitForTimeout(900);
const afterClash = await snapshot();
ok(
  "⚠️ ① 撞名時資料**一格都沒有動**（合併是不可逆的，不可以替使用者決定）",
  JSON.stringify(afterClash) === JSON.stringify(before),
  afterClash.periods.join("、"),
);
const toastText = await page
  .locator("#toast, .toast")
  .first()
  .innerText()
  .catch(() => "");
ok(
  "⚠️ ① 而且要講明為什麼被擋（不能只是靜靜沒反應）",
  /已經存在/.test(toastText) && /不會把兩季合併/.test(toastText),
  toastText.slice(0, 60),
);

/* ══ ② 正常改名：舊季度整個消失、數字不變 ═══════════════════ */
console.log("\n══ ② 改成一個新名字 ══");
await goMaintenance();
await page.selectOption("#renamePeriod", "115Q1");
await page.fill("#renamePeriodInput", "115Q3");
dialogs.length = 0;
await page.click("#renameQuarter");
await page.waitForTimeout(1200);
const after = await snapshot();
ok(
  "⚠️ ② 新季度出現了",
  after.periods.includes("115Q3"),
  after.periods.join("、"),
);
ok(
  "⚠️ ② **舊季度整個消失**（只驗新名字出現的話，只改一半也會過）",
  !after.periods.includes("115Q1"),
  after.periods.join("、"),
);
ok(
  "⚠️ ② 匯入紀錄裡的季度也跟著改（不改的話那筆紀錄會指向一個不存在的季）",
  after.importLog.includes("115Q3") && !after.importLog.includes("115Q1"),
  after.importLog.slice(0, 80),
);
ok(
  "⚠️ ② 刪除那一格的季度清單也跟著換（兩個下拉讀的是同一份資料）",
  after.deletePeriods.includes("115Q3") &&
    !after.deletePeriods.includes("115Q1"),
  after.deletePeriods.join("、"),
);
ok(
  "⚠️ ② 數字逐格相同（改名只換標籤，任何一個值變了都是 bug）",
  before.values.length > 0 &&
    after.values.join("\n") === before.values.join("\n"),
  `${after.values.length} 個數字`,
);
ok(
  "② 另一季完全沒有被波及",
  after.periods.includes("115Q2"),
  after.periods.join("、"),
);

ok("沒有任何 JavaScript 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 季度改名：撞名會擋、改完舊季度整個消失、數字一格都沒變");
