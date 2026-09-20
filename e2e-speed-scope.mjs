/*
 * ══════════════════════════════════════════════════════════════════════
 *  路段速限：依「季別區間 × 路段 × 方向」套用
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「我建議把『速限有效期間與查證紀錄』統一變成目前的 季別／路段，
 *     這樣方便維護，不會有另一套功能出現」
 *   「只有速限這張表是季別／路段／方向這樣，且一樣季別優先，
 *     季別也是擴增為季別區間」
 *   「查證來源／日期／人員這些欄位可以拿掉，使用者不會做這些紀錄」
 *
 * ⚠️ 這一支守的是**速限真的換了、LOS 真的跟著重算**，不是「設定存起來了」：
 *   ① 設一條「某一季起」的速限之後，那幾季的 LOS **真的變了**
 *   ② 區間外的季度**一筆都不可以動**
 *   ③ 只對**那一個方向**生效（另一個方向不受影響）
 *   ④ 刪掉之後**回到原本的等級**（可逆，不是單向改壞）
 *   ⑤ 畫面上**不可以**再出現查證來源／日期／人員
 *
 * ⚠️ 只驗「表格多了一列」是假綠——那證明不了 LOS 跟著換。
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
await page.fill("#projectCode", "SPEEDSCOPE");
await page.fill("#projectName", "速限範圍守門");
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
await importQuarter(2);

/** 尖峰明細：季別｜路段｜方向｜速限｜LOS（讀畫面，不是讀 state）。 */
const detailRows = async () => {
  await page.evaluate(() => document.querySelector('[data-view="detail"]').click());
  await page.waitForTimeout(900);
  return page.evaluate(() =>
    [...document.querySelectorAll("#detail tbody tr")].map((row) =>
      [...row.children]
        .map((cell) => {
          /*
           * ⚠️ v2.20.67 起「期間」那一格底下多了一行「調查日 …」
           *   （使用者 2026-09-20 要的逐筆調查日期）。
           *   下面會把第一格當成季別字串拿去填「季別（起）」，
           *   不拆掉的話填進去的是「115Q1原始檔讀不到日期」，
           *   速限設定根本套不上，於是整條驗「LOS 真的變了」會紅——
           *   而那不是產品壞了，是測試讀錯了東西。
           */
          const own = cell.cloneNode(true);
          for (const line of own.querySelectorAll(".survey-date")) line.remove();
          return (own.textContent || "").trim();
        })
        .join("|"),
    ),
  );
};
const before = await detailRows();
ok(
  "前置：尖峰明細有資料可以量（0 列的話下面全部恆真）",
  before.length > 0,
  `${before.length} 列`,
);

/* ── 一、查證欄位要真的不見了 ── */
await page.evaluate(() => document.querySelector('[data-view="speed"]').click());
await page.waitForTimeout(800);
const panel = await page.evaluate(() => {
  const host = document.getElementById("speedVersionPanel");
  return {
    found: Boolean(host),
    text: (host?.innerText || "").replace(/\s+/g, " "),
    hasSource: Boolean(document.getElementById("versionSource")),
    hasChecked: Boolean(document.getElementById("versionChecked")),
    hasBy: Boolean(document.getElementById("versionBy")),
    keys: [...document.querySelectorAll("#versionLimitKey option")].map(
      (option) => ({ value: option.value, label: option.textContent.trim() }),
    ),
  };
});
ok("前置：速限設定那一塊找得到", panel.found);
ok(
  "⚠️ ⑤ 查證來源／日期／人員三個欄位要**不存在**（使用者指名拿掉）",
  !panel.hasSource && !panel.hasChecked && !panel.hasBy,
  `來源 ${panel.hasSource}、日期 ${panel.hasChecked}、人員 ${panel.hasBy}`,
);
ok(
  "⚠️ ⑤ 畫面上也不可以再寫著「查證」",
  !/查證/.test(panel.text),
  panel.text.slice(0, 100),
);
ok(
  "前置：路段／方向下拉列得出實際的值（0 個的話下面全部恆真）",
  panel.keys.length > 0,
  `${panel.keys.length} 個：${panel.keys.slice(0, 2).map((item) => item.label).join("／")}`,
);

/* ── 二、設一條「某一季起」的速限 ── */
const periods = [...new Set(before.map((row) => row.split("|")[0]))].sort();
ok(
  "前置：至少有三季資料（少於三季驗不出「區間外不受影響」）",
  periods.length >= 3,
  periods.join("／"),
);
const target = panel.keys[0];
const midPeriod = periods[1];
/*
 * ⚠️ 速限要挑「一定看得出差別」的：拉到 200 之後速限比會掉到很低，
 *   那幾季一定變成 F。微調的話等級可能剛好不變，那樣即使程式沒接上也會綠。
 */
await page.selectOption("#versionLimitKey", target.value);
await page.fill("#versionSpeed", "200");
await page.fill("#versionStart", midPeriod);
await page.fill("#versionEnd", "");
await page.click("#saveSpeedVersion");
await page.waitForTimeout(1500);

const after = await detailRows();
/* 這一條速限設定涵蓋的是「哪一個路段的哪一個方向」。 */
const [, targetRoad] = target.value.split("|");
/*
 * ⚠️ 下拉的標籤是「路段／方向名稱」，而明細表上印的是**方向名稱**
 *  （使用者取的名字），不是內部的方向1／方向2。要比的是畫面上那個字。
 */
const targetDirectionName = target.label.split("／").pop().trim();
const changed = after.filter((row, index) => row !== before[index]);
ok(
  "⚠️ ① 設了速限之後，明細的 LOS **真的變了**",
  changed.length > 0,
  `${changed.length} 列變了，例如：${changed[0] || ""}`,
);
/*
 * ⚠️ ② 與 ③ 一起驗：變的必須**剛好**是「這一段 × 這一個方向 × 這一季之後」。
 *   只驗「有變」的話，一個「整批都換速限」的錯誤實作也會過。
 */
const outOfScope = after.filter((row, index) => {
  if (row === before[index]) return false;
  const period = row.split("|")[0];
  const inRange = period >= midPeriod;
  const sameRoad = row.includes(targetRoad);
  /*
   * ⚠️ 方向也要比。只比路段的話，一個「整條路段兩個方向一起換」的錯誤實作
   *   也會過——而速限是**逐方向公告**的，兩個方向常常不一樣。
   *   方向名稱在畫面上是使用者取的名字（例如「甲路口--->乙路口」），
   *   所以拿下拉那一項的標籤來比，不是拿內部的方向1／方向2。
   */
  const sameDirection = row.includes(targetDirectionName);
  return !(inRange && sameRoad && sameDirection);
});
ok(
  "⚠️ ②③ 只有「區間內 × 這一段 × 這一個方向」變（別季、別段、別方向一列都不可以動）",
  outOfScope.length === 0,
  outOfScope.slice(0, 3).join("、") || "沒有越界",
);
/*
 * ⚠️ 反面也要驗：**另一個方向**確實有資料、而且確實沒變。
 *   沒有這一條的話，「那一段只有一個方向有資料」時上一條會恆真。
 */
const otherDirectionRows = after.filter(
  (row, index) =>
    row.includes(targetRoad) &&
    !row.includes(targetDirectionName) &&
    row.split("|")[0] >= midPeriod &&
    row === before[index],
);
const otherDirectionExists = after.some(
  (row) =>
    row.includes(targetRoad) &&
    !row.includes(targetDirectionName) &&
    row.split("|")[0] >= midPeriod,
);
ok(
  "前置：那一段在區間內確實還有**另一個方向**的資料（沒有的話上一條恆真）",
  otherDirectionExists,
  otherDirectionExists ? "有" : "只有一個方向，驗不到方向隔離",
);
ok(
  "⚠️ ③ 另一個方向在區間內完全沒動",
  !otherDirectionExists || otherDirectionRows.length > 0,
  `${otherDirectionRows.length} 列沒動`,
);
const beforeMid = after.filter((row, index) => {
  const period = row.split("|")[0];
  return period < midPeriod && row !== before[index];
});
ok(
  "⚠️ ② 區間**之前**的季度完全沒動",
  beforeMid.length === 0,
  beforeMid.slice(0, 3).join("、") || "一列都沒動",
);

/* ── 三、刪掉之後要回得去 ── */
await page.evaluate(() => document.querySelector('[data-view="speed"]').click());
await page.waitForTimeout(800);
for (let round = 0; round < 10; round += 1) {
  const left = await page.evaluate(
    () => document.querySelectorAll("[data-remove-version]").length,
  );
  if (!left) break;
  await page.evaluate(() =>
    document.querySelector("[data-remove-version]")?.click(),
  );
  await page.waitForTimeout(1200);
}
const leftover = await page.evaluate(
  () => document.querySelectorAll("[data-remove-version]").length,
);
ok("前置：速限設定真的都刪掉了（沒刪乾淨的話下一條驗不到）", leftover === 0, `${leftover} 條`);
const restored = await detailRows();
ok(
  "⚠️ ④ 刪掉之後**逐列回到原本的等級**（可逆，不是單向改壞）",
  JSON.stringify(restored) === JSON.stringify(before),
  restored.filter((row, index) => row !== before[index]).slice(0, 2).join("、") ||
    "逐列相同",
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 速限依季別區間×路段×方向套用、範圍外不受影響、可逆，查證欄位已移除");
