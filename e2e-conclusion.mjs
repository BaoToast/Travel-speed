/*
 * 結論草稿產生器的端對端檢查（交通服務水準）。
 *
 * 單元測試已經驗過組字規則，這一支要驗的是「畫面接得對不對」：
 *  ・勾選條件之後草稿有沒有真的跟著變
 *  ・草稿寫的數字，和「尖峰明細」表格上同一列的數字是不是一樣
 *    （最重要的一項——報告寫錯數字比程式當掉嚴重）
 *  ・手改之後不會被無聲覆蓋；條件範本存得起來、重新整理後還在
 *
 * 使用交付包自行建立的匿名調查版型，不含任何正式計畫或使用者資料。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
const server = createServer((req, res) => {
  const path = join(
    here,
    decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html",
  );
  if (!existsSync(path) || !path.startsWith(here)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const SAMPLE_DIR = join(here, "test-fixtures");
if (!existsSync(SAMPLE_DIR)) {
  console.log("❌ 找不到匿名回歸測資，請先執行 npm run fixtures");
  server.close();
  process.exit(1);
}
/* 挑同一路段的平日與假日各一份，才驗得到日別條件。 */
const files = readdirSync(SAMPLE_DIR).filter((name) => /報告測試路段/.test(name));
if (files.length !== 2) {
  console.log(`❌ 匿名結論測資應有平日、假日各一份，目前為 ${files.length} 份`);
  server.close();
  process.exit(1);
}

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "CONC");
await page.fill("#projectName", "結論草稿測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(400);

async function importQuarter(year, quarterIndex) {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", String(year));
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
await importQuarter(115, 0);
await importQuarter(115, 1);

/* ── 抄下「尖峰明細」表格的數字當標準答案 ── */
await page.evaluate(() => document.querySelector('[data-view="detail"]').click());
await page.waitForTimeout(800);
const detailText = await page.evaluate(() => {
  const rows = [];
  for (const tr of document.querySelectorAll("#detail table tbody tr"))
    rows.push(
      [...tr.querySelectorAll("th,td")].map((td) =>
        td.innerText.replace(/\s+/g, " ").trim(),
      ),
    );
  return JSON.stringify(rows);
});
const detailRows = JSON.parse(detailText);
console.log("── 尖峰明細列數 ──", detailRows.length);
detailRows.slice(0, 4).forEach((r) => console.log("   ", r.join(" | ")));

/* ── 進入結論草稿產生器 ── */
await page.evaluate(() => document.querySelector('[data-view="conclusion"]').click());
await page.waitForTimeout(700);
ok("結論草稿分頁打得開", await page.isVisible("#conclusion"));
ok("有資料時條件面板會出現", await page.isVisible("#conclusionMain"));
ok("草稿一開始是空的", (await page.inputValue("#conclusionDraft")) === "");

const count0 = await page.textContent("#conclusionCount");
ok("符合條件筆數有算出來", /符合條件 [1-9]\d* 筆/.test(count0), count0);

/* 條件：單季、只寫上午尖峰、只寫服務水準＋旅行速率 */
await page.check('#conclusionScopeKinds input[value="quarter"]');
await page.waitForTimeout(400);
await page.selectOption("#conclusionQuarter", { index: 0 });
await page.waitForTimeout(400);

const peakLabels = await page.$$eval("#conclusionPeaks label", (els) =>
  els.map((el) => el.innerText.trim()),
);
for (let i = 0; i < peakLabels.length; i += 1) {
  const box = page.locator("#conclusionPeaks input").nth(i);
  const wanted = /上午/.test(peakLabels[i]);
  if ((await box.isChecked()) !== wanted) {
    await box.click();
    await page.waitForTimeout(200);
  }
}

const metricLabels = await page.$$eval("#conclusionMetrics label", (els) =>
  els.map((el) => el.innerText.trim()),
);
for (let i = 0; i < metricLabels.length; i += 1) {
  const box = page.locator("#conclusionMetrics input").nth(i);
  const wanted = /服務水準（A～F）|旅行速率/.test(metricLabels[i]);
  if ((await box.isChecked()) !== wanted) {
    await box.click();
    await page.waitForTimeout(200);
  }
}

await page.click("#conclusionGenerate");
await page.waitForTimeout(800);
const text1 = await page.inputValue("#conclusionDraft");
console.log("\n── 草稿前 900 字 ──\n" + text1.slice(0, 900) + "\n──────────────");

ok("草稿產生出來了", text1.length > 200, `${text1.length} 字`);
ok("只寫上午尖峰", /上午尖峰/.test(text1) && !/下午尖峰・/.test(text1));
ok("有寫服務水準", /服務水準 [A-F?]/.test(text1));
ok("有寫旅行速率 km/h", /旅行速率 [\d.]+ km\/h/.test(text1));
ok("沒勾的總延滯不會出現在數值行", !/：[^\n]*總延滯 [\d.]+ 秒/.test(text1));
ok("沒有 NaN／undefined／Infinity", !/NaN|undefined|Infinity/.test(text1),
  text1.match(/NaN|undefined|Infinity/)?.[0] || "");
ok("標頭寫明不可加總、不可平均", /不做加總/.test(text1) && /不做平均/.test(text1));

/* ── 對數字 ── */
const drafted = [...text1.matchAll(/旅行速率 ([\d.]+) km\/h/g)].map((m) => m[1]);
ok("草稿有逐筆寫出旅行速率", drafted.length >= 2, `${drafted.length} 筆`);
/*
 * 明細表印到小數第三位（27.853），草稿依「小數位數」設定印一位（27.9）。
 * 所以不能用字串比對，要把明細的值四捨五入到同樣位數再比——
 * 這樣才驗得到「是同一個數字」，而不是「剛好長得像」。
 */
const detailTravels = new Set();
for (const row of detailRows)
  for (const cell of row) {
    const value = Number(String(cell).replace(/,/g, ""));
    if (String(cell).trim() && Number.isFinite(value))
      detailTravels.add(value.toFixed(1));
  }
const missing = drafted.filter((value) => !detailTravels.has(value));
ok(
  "草稿的每一個旅行速率都能在尖峰明細表格上找到同一個值（四捨五入到同位數）",
  missing.length === 0,
  "找不到：" + missing.join("、") + "｜明細有 " + detailTravels.size + " 個相異數值",
);

/* ── 加勾總延滯，草稿要變 ── */
for (let i = 0; i < metricLabels.length; i += 1)
  if (/總延滯（秒）/.test(metricLabels[i])) {
    await page.locator("#conclusionMetrics input").nth(i).click();
    await page.waitForTimeout(250);
  }
await page.click("#conclusionRegenerate");
await page.waitForTimeout(800);
const text2 = await page.inputValue("#conclusionDraft");
ok("加勾總延滯之後草稿有變", text2 !== text1);
ok("總延滯有寫出秒", /總延滯 [\d.]+ 秒/.test(text2));

/* ── 只選假日 ── */
const dayLabels = await page.$$eval("#conclusionDays label", (els) =>
  els.map((el) => el.innerText.trim()),
);
const holidayIndex = dayLabels.findIndex((label) => /假日/.test(label));
if (holidayIndex >= 0) {
  await page.locator("#conclusionDays input").nth(holidayIndex).click();
  await page.waitForTimeout(300);
  await page.click("#conclusionRegenerate");
  await page.waitForTimeout(800);
  const text3 = await page.inputValue("#conclusionDraft");
  ok("只勾假日時不會寫到平日", /假日/.test(text3) && !/〔[^〕]*・平日〕/.test(text3));
  // 還原
  await page.locator("#conclusionDays input").nth(holidayIndex).click();
  await page.waitForTimeout(300);
}

/* ── 統計範圍：只會顯示當前選項對應的那一組欄位 ── */
for (const [kind, expect] of [
  ["quarter", { q: true, y: false, r: false }],
  ["year", { q: false, y: true, r: false }],
  ["range", { q: false, y: false, r: true }],
  ["project", { q: false, y: false, r: false }],
]) {
  await page.check(`#conclusionScopeKinds input[value="${kind}"]`);
  await page.waitForTimeout(300);
  const shown = await page.evaluate(() => ({
    q: !document.getElementById("conclusionQuarterBox").hidden &&
      getComputedStyle(document.getElementById("conclusionQuarterBox")).display !== "none",
    y: !document.getElementById("conclusionYearBox").hidden &&
      getComputedStyle(document.getElementById("conclusionYearBox")).display !== "none",
    r: !document.getElementById("conclusionRangeBox").hidden &&
      getComputedStyle(document.getElementById("conclusionRangeBox")).display !== "none",
  }));
  ok(
    `統計範圍選「${kind}」時只顯示對應欄位`,
    shown.q === expect.q && shown.y === expect.y && shown.r === expect.r,
    `季度=${shown.q} 年度=${shown.y} 起訖=${shown.r}`,
  );
}

/* ── 年度條件 ── */
await page.check('#conclusionScopeKinds input[value="year"]');
await page.waitForTimeout(400);
await page.click("#conclusionRegenerate");
await page.waitForTimeout(800);
const text4 = await page.inputValue("#conclusionDraft");
ok("年度條件寫得出「N 年度」標頭", /【結論草稿】\d+ 年度/.test(text4), text4.split("\n")[0]);

/* ── 手改保護 ── */
await page.fill("#conclusionDraft", "我自己改的內容");
await page.waitForTimeout(300);
ok(
  "手改之後有提示會先詢問再覆蓋",
  /手動修改/.test(await page.textContent("#conclusionEditHint")),
);

/* ── 條件範本 ── */
await page.fill("#conclusionTemplateName", "年報用");
await page.click("#conclusionSaveTemplate");
await page.waitForTimeout(500);
ok(
  "範本存得起來",
  (await page.locator("#conclusionTemplateList .conclusion-template", { hasText: "年報用" }).count()) === 1,
);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('[data-view="conclusion"]').click());
await page.waitForTimeout(600);
ok(
  "重新整理之後範本還在",
  (await page.locator("#conclusionTemplateList .conclusion-template", { hasText: "年報用" }).count()) === 1,
);
await page.locator('#conclusionTemplateList button:has-text("年報用")').click();
await page.waitForTimeout(500);
ok(
  "套用範本會還原當時的條件（年度）",
  await page.isChecked('#conclusionScopeKinds input[value="year"]'),
);

/* ── 挑不到資料 ── */
await page.check('#conclusionScopeKinds input[value="quarter"]');
await page.waitForTimeout(400);
const roadBoxes = await page.locator("#conclusionRoads input").count();
if (roadBoxes) {
  await page.locator("#conclusionRoads input").first().click();
  await page.waitForTimeout(300);
}
await page.click("#conclusionRegenerate");
await page.waitForTimeout(800);
const text5 = await page.inputValue("#conclusionDraft");
ok("挑不到資料時給的是說明而不是空白", text5.length > 60, text5.slice(0, 80));

console.log("\n══ 主控台錯誤 ══");
ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 4).join(" / "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
