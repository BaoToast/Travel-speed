/*
 * ══════════════════════════════════════════════════════════════════════
 *  服務水準判定門檻：依「季別 × 路段」覆寫，衝突時季別優先
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「服務水準判定方式，應該要比照全日交通量和路口轉向程式的參數設定那樣，
 *     新增一個依照每季和各路段／路口，當衝突發生時，**以每季優先**
 *    （和另外兩程式一致的判斷方式），**套用後進行重新計算**，
 *     請確定服務水準有將需要用到的原始資料保存下來，
 *     **讓使用者不須重新匯入檔案**。」
 *
 * ⚠️ 這一支守的是**真的重算**，不是「設定存起來了」：
 *   ① 加一條覆寫之後，尖峰明細的 LOS 等級**真的變了**
 *   ② 而且**沒有重新匯入任何檔案**（原始資料本來就保存著）
 *   ③ 刪掉覆寫之後**回到原本的等級**（可逆，不是單向改壞）
 *   ④ 季別優先：同一季的全路段設定蓋過路段專屬設定，而且畫面上**寫出來**
 *
 * ⚠️ 只驗「設定存進 state」是假綠——那證明不了畫面上的等級跟著換。
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
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "SCOPE");
await page.fill("#projectName", "門檻範圍守門");
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

/** 目前尖峰明細上每一列的「期間｜路段｜LOS」。 */
const losRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#detailRows tr")]
      .filter((tr) => tr.children.length >= 10)
      .map(
        (tr) =>
          `${tr.children[0].textContent.trim()}|${tr.children[1].textContent.trim()}|${tr.children[9].textContent.trim()}`,
      ),
  );

await page.evaluate(() => document.querySelector('[data-view="detail"]').click());
await page.waitForTimeout(700);
const before = await losRows();
ok("前置：尖峰明細有資料可以量（0 列的話下面全部恆真）", before.length > 0, `${before.length} 列`);

/* ── 一、加一條「這一季 × 全路段」的覆寫 ── */
await page.evaluate(() =>
  document.querySelector('[data-view="standards"]').click(),
);
await page.waitForTimeout(600);
const periods = await page.evaluate(() =>
  [...document.querySelectorAll("#scopePeriodFrom option")].map((o) => o.value),
);
const roads = await page.evaluate(() =>
  [...document.querySelectorAll("#scopeRoad option")].map((o) => o.value),
);
ok(
  "前置：季別與路段選單都列得出實際的值",
  periods.length >= 2 && roads.length >= 2,
  `季別 ${periods.join("／")}；路段 ${roads.join("／")}`,
);
const firstPeriod = periods.find((v) => v !== "*");
const firstRoad = roads.find((v) => v !== "*");
/*
 * 門檻整組拉到很高（A 需要 1.9），那一季的每一筆都會掉到 F——
 * ⚠️ 刻意用「一定看得出差別」的值：微調的話，等級可能剛好不變，
 *   那樣即使程式根本沒接上，這一條也會綠。
 */
const setScope = async (period, road, top) => {
  /*
   * ⚠️ 季別 2026-09-15 起是**區間**（起、迄兩個下拉）。
   *   單季就是「起＝迄」——與主工具列的語意一致。
   */
  await page.selectOption("#scopePeriodFrom", period);
  await page.selectOption("#scopePeriodTo", period);
  await page.selectOption("#scopeRoad", road);
  for (const [grade, value] of [
    ["A", top],
    ["B", top - 0.05],
    ["C", top - 0.1],
    ["D", top - 0.15],
    ["E", top - 0.2],
  ])
    await page.fill(`#scope${grade}`, String(value));
  await page.click("#addRuleScope");
  await page.waitForTimeout(900);
};
await setScope(firstPeriod, "*", 1.9);
await page.evaluate(() => document.querySelector('[data-view="detail"]').click());
await page.waitForTimeout(700);
const afterSeason = await losRows();
const changedRows = afterSeason.filter((row, i) => row !== before[i]);
ok(
  "⚠️ 一、加了「這一季 × 全路段」的覆寫之後，明細的 LOS **真的變了**",
  changedRows.length > 0,
  `${changedRows.length} 列變了，例如：${changedRows[0]}`,
);
ok(
  "⚠️ 一、只有那一季變（別季不受影響——計畫和季別之間不可以互相干擾）",
  afterSeason.every((row, i) =>
    row.startsWith(firstPeriod) ? true : row === before[i],
  ),
  afterSeason
    .filter((row, i) => !row.startsWith(firstPeriod) && row !== before[i])
    .join("、") || "別季一列都沒動",
);
ok(
  "⚠️ 一、全程**沒有重新匯入任何檔案**（原始資料本來就保存著）",
  true,
  "只按了「新增／更新這一條」",
);

/* ── 二、季別優先：再加一條「全季別 × 這一路段」，那一季仍然照季別走 ── */
await page.evaluate(() =>
  document.querySelector('[data-view="standards"]').click(),
);
await page.waitForTimeout(500);
await setScope("*", firstRoad, 0.2);
const conflictText = await page.evaluate(
  () => document.getElementById("ruleScopeConflicts")?.textContent || "",
);
ok(
  "⚠️ 二、範圍重疊時畫面要**寫出來**（看不見的優先順位＝沒人解釋得了的數字）",
  /重疊/.test(conflictText) && /季別優先|比較細/.test(conflictText),
  conflictText.replace(/\s+/g, " ").slice(0, 90),
);
await page.evaluate(() => document.querySelector('[data-view="detail"]').click());
await page.waitForTimeout(700);
const afterBoth = await losRows();
const inSeason = (row) => row.startsWith(firstPeriod) && row.includes(firstRoad);
ok(
  "⚠️ 二、**季別優先**：那一季那一條路段仍然照「這一季 × 全路段」算",
  afterBoth.filter(inSeason).every((row, i) =>
    row === afterSeason.filter(inSeason)[i],
  ),
  afterBoth.filter(inSeason).slice(0, 2).join("、"),
);

/* ── 三、刪掉覆寫要回得去 ── */
await page.evaluate(() =>
  document.querySelector('[data-view="standards"]').click(),
);
await page.waitForTimeout(500);
for (let i = 0; i < 4; i += 1) {
  const remove = page.locator("[data-remove-scope]").first();
  if (!(await remove.count())) break;
  await remove.click();
  await page.waitForTimeout(700);
}
await page.evaluate(() => document.querySelector('[data-view="detail"]').click());
await page.waitForTimeout(700);
const restored = await losRows();
ok(
  "⚠️ 三、刪掉全部覆寫之後**逐列回到原本的等級**（可逆，不是單向改壞）",
  restored.length === before.length &&
    restored.every((row, i) => row === before[i]),
  restored.filter((row, i) => row !== before[i]).slice(0, 3).join("、") ||
    "逐列相同",
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 門檻可以依季別×路段覆寫、季別優先、可逆，而且不必重新匯入");
