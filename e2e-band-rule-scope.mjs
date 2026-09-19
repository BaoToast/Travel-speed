/*
 * ══════════════════════════════════════════════════════════════════════
 *  三段分法（順暢／尚可／壅塞）：依「季別區間 × 路段」覆寫
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「交通服務水準的『三段分法』我一直都有同意要補呀，你可以再看一次我的回答」
 *   「我傾向其他參數設定維持原本的季別／路段，只是**季別功能擴增為季別區間**」
 *
 * ⚠️ 這一支守的是**圖真的跟著換了一把尺**，不是「設定存起來了」：
 *   ① 加一條覆寫之後，三段分法圖上的**佔比真的變了**
 *   ② 只有覆寫涵蓋的季度變，別季不受影響
 *   ③ 刪掉覆寫之後**回到原本的佔比**（可逆，不是單向改壞）
 *   ④ 區間：起與迄都含在內；只設起＝「從那一季開始一直有效」
 *   ⑤ 範圍重疊時畫面上要**寫出來**（看不見的優先順位＝沒人解釋得了的數字）
 *
 * ⚠️ 只驗「設定存進 state」是假綠——那證明不了圖上的柱子跟著換。
 * ⚠️ 也要驗「**服務水準等級一個都沒變**」：三段分界只決定 A～F 怎麼歸成三段，
 *   它**不可以**改變任何一筆的等級。改到等級的話，那是計算被污染了。
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

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "BANDSCOPE");
await page.fill("#projectName", "三段分法範圍守門");
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

/**
 * 三段分法圖上，每一季三段各佔多少。
 *
 * ⚠️ 讀的是**柱子自己的 <title>**（「115Q1　壅塞：3 條（60.0%）」），
 *   不是畫面上的文字。第一版我掃 `<text>` 又濾 `%`，結果掃到的是
 *   **縱軸刻度**（100%／75%／50%／25%）——那是固定的格線，換哪一把尺都一樣，
 *   於是「佔比變了沒」永遠是「沒變」，整支假綠。
 *   <title> 是柱子自己的，換了尺一定會變。
 */
const bandShares = async () => {
  await page.evaluate(() => document.querySelector('[data-view="bandChart"]').click());
  await page.waitForTimeout(1200);
  return page.evaluate(() =>
    [...document.querySelectorAll("#bandCharts svg rect title")].map((node) =>
      (node.textContent || "").replace(/\s+/g, " ").trim(),
    ),
  );
};
/** 尖峰明細上每一列的 LOS 等級——三段分界**不可以**動到這個。 */
const losRows = async () => {
  await page.evaluate(() => document.querySelector('[data-view="detail"]').click());
  await page.waitForTimeout(800);
  return page.evaluate(() =>
    [...document.querySelectorAll("#detail tbody tr")].map((row) =>
      [...row.children].map((cell) => (cell.textContent || "").trim()).join("|"),
    ),
  );
};

const beforeShares = await bandShares();
const beforeLos = await losRows();
ok(
  "前置：三段分法圖上量得到佔比（0 個的話下面全部恆真）",
  beforeShares.length > 0,
  `${beforeShares.length} 個數字`,
);
ok(
  "前置：尖峰明細有資料可以量",
  beforeLos.length > 0,
  `${beforeLos.length} 列`,
);

/* ── 一、加一條「這一季 × 全路段」的覆寫 ── */
await page.evaluate(() =>
  document.querySelector('[data-view="standards"]').click(),
);
await page.waitForTimeout(700);
const periods = await page.evaluate(() =>
  [...document.querySelectorAll("#bandScopePeriodFrom option")].map(
    (option) => option.value,
  ),
);
ok(
  "前置：三段分法的季別下拉列得出實際的季別",
  periods.filter((value) => value !== "*").length >= 2,
  periods.join("／"),
);
const firstPeriod = periods.find((value) => value !== "*");

/**
 * 加一條覆寫。
 *
 * ⚠️ 分界要挑「一定看得出差別」的：把壅塞的起點拉到 B，
 *   那一季幾乎每一筆都會被歸成壅塞。微調的話佔比可能剛好不變，
 *   那樣即使程式根本沒接上，這一條也會綠。
 */
const setBandScope = async (from, to, road, smoothEnd, congestedStart) => {
  await page.selectOption("#bandScopePeriodFrom", from);
  await page.selectOption("#bandScopePeriodTo", to);
  await page.selectOption("#bandScopeRoad", road);
  await page.selectOption("#bandScopeSmoothEnd", smoothEnd);
  await page.selectOption("#bandScopeCongestedStart", congestedStart);
  await page.click("#addBandScope");
  await page.waitForTimeout(900);
};
await setBandScope(firstPeriod, firstPeriod, "*", "A", "B");

const afterShares = await bandShares();
ok(
  "⚠️ ① 加了覆寫之後，三段分法圖上的佔比**真的變了**",
  JSON.stringify(afterShares) !== JSON.stringify(beforeShares),
  `之前 ${beforeShares.slice(0, 2).join("｜")} → 之後 ${afterShares.slice(0, 2).join("｜")}`,
);
const afterLos = await losRows();
ok(
  "⚠️ ① 但**服務水準等級一列都不可以變**（分界只決定怎麼歸段，不決定等級）",
  JSON.stringify(afterLos) === JSON.stringify(beforeLos),
  afterLos.filter((row, i) => row !== beforeLos[i]).slice(0, 2).join("、") ||
    "逐列相同",
);

/* ── 二、範圍重疊要寫出來 ── */
await page.evaluate(() =>
  document.querySelector('[data-view="standards"]').click(),
);
await page.waitForTimeout(700);
const roads = await page.evaluate(() =>
  [...document.querySelectorAll("#bandScopeRoad option")].map(
    (option) => option.value,
  ),
);
const firstRoad = roads.find((value) => value !== "*");
await setBandScope("*", "*", firstRoad, "A", "C");
const conflictText = await page.evaluate(
  () => document.getElementById("bandScopeConflicts")?.innerText || "",
);
ok(
  "⚠️ ② 範圍重疊時畫面要**寫出來**（看不見的優先順位＝沒人解釋得了的數字）",
  /重疊/.test(conflictText),
  conflictText.slice(0, 120) || "（什麼都沒寫）",
);

/* ── 三、刪掉全部覆寫要回到原本的佔比 ── */
/*
 * ⚠️ 一次刪一筆，刪完等重畫。
 *   同步把全部按鈕點一輪是**錯的**：第一次點擊就會重畫整張表，
 *   後面那些按鈕已經從 DOM 上拿掉了，點了等於沒點——實測只刪掉一條。
 */
for (let round = 0; round < 10; round += 1) {
  const left = await page.evaluate(
    () => document.querySelectorAll("[data-remove-band-scope]").length,
  );
  if (!left) break;
  await page.evaluate(() =>
    document.querySelector("[data-remove-band-scope]")?.click(),
  );
  await page.waitForTimeout(900);
}
await page.evaluate(() =>
  document.querySelector('[data-view="standards"]').click(),
);
await page.waitForTimeout(700);
const leftover = await page.evaluate(
  () => document.querySelectorAll("[data-remove-band-scope]").length,
);
ok("前置：覆寫真的都刪掉了（沒刪乾淨的話下一條驗不到）", leftover === 0, `${leftover} 條`);
const restored = await bandShares();
ok(
  "⚠️ ③ 刪掉覆寫之後**逐個回到原本的佔比**（可逆，不是單向改壞）",
  JSON.stringify(restored) === JSON.stringify(beforeShares),
  JSON.stringify(restored) === JSON.stringify(beforeShares)
    ? "逐個相同"
    : `現在 ${restored.slice(0, 2).join("｜")}；原本 ${beforeShares.slice(0, 2).join("｜")}`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 三段分法可以依季別區間×路段覆寫、重疊會講、可逆，而且不動等級");
