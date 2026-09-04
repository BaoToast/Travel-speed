/**
 * 端對端：民國年 ⇄ 西元年顯示切換（v2.20.24）。
 *
 * 使用者要的是「畫面與匯出都跟著變」，但**只能變顯示的字**。
 * 這一支要跑到的是三件會真的出事、而單元測試看不到的事：
 *
 *   1. 切換之後表格與圖表的季度換了寫法，但同一列的每一格數字逐字相同。
 *   2. 切換之後各種季度篩選（品質總覽、成果交付、結論草稿）仍然挑得到資料。
 *      這是最容易壞的一處：舊寫法的 <option> 沒有 value，文字就是值，
 *      一換成西元年，篩選立刻對不到任何一筆，畫面會變成「這個範圍沒有資料」。
 *   3. 匯出的 Excel 儲存格與圖表類別軸兩邊寫的是同一個季度，
 *      而且列的順序沒有跟著顯示改變（排序必須仍走儲存值）。
 *
 * 另外反面確認：Project 專案包（會被 Manager 再匯入的資料檔）
 * 一律維持民國年儲存值，不可以跟著顯示切換走。
 *
 * 測資是交付包裡自產的匿名版型，不含任何正式調查資料。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import JSZip from "jszip";
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
  res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const FIXTURE_DIR = join(here, "test-fixtures");
const FILES = [
  "99999TS1-01-測試路段(甲路～乙路)-平日.xlsx",
  "99999TS1-02-第二測試路段(丙路～丁路)-平日.xlsx",
  "99999TS1-02-第二測試路段(丙路～丁路)-假日.xlsx",
].filter((name) => existsSync(join(FIXTURE_DIR, name)));
if (!FILES.length) {
  console.log("⚠️ 找不到測試版型，請先執行 npm run fixtures");
  server.close();
  process.exit(0);
}

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

/* ── 建計畫，分兩季匯入，才有「跨年度」可看 ───────────────── */
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "E2E-YS");
await page.fill("#projectName", "年份顯示測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(400);

async function importAs(year, quarterIndex, names) {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.waitForTimeout(300);
  await page.fill("#rocYear", String(year));
  await page.selectOption("#quarter", { index: quarterIndex });
  await page.setInputFiles(
    "#files",
    names.map((name) => ({
      name,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(FIXTURE_DIR, name)),
    })),
  );
  await page.click("#preview");
  await page.waitForTimeout(3000);
  /*
   * 沒見過的路段要先確認，否則寫不進去。
   * #pickAll 一直存在於 DOM，只是整條批次確認列平常是隱藏的——
   * 要看「看不看得見」，不能只看「在不在」。
   */
  const needsPick = await page.evaluate(() => {
    const bar = document.getElementById("roadBatchBar");
    return Boolean(bar) && getComputedStyle(bar).display !== "none";
  });
  if (needsPick) {
    await page.check("#pickAll");
    await page.waitForTimeout(300);
    await page.click("#pickAsNew");
    await page.waitForTimeout(500);
  }
  await page.click("#commit");
  await page.waitForTimeout(2000);
}
await importAs(114, 3, FILES); /* 114Q4 */
await importAs(115, 0, FILES); /* 115Q1 */

const detailCells = async () =>
  page.evaluate(() => {
    document.querySelector('[data-view="detail"]').click();
    return [...document.querySelectorAll("#detailRows tr")].map((tr) =>
      [...tr.children].map((td) => td.textContent.trim()),
    );
  });
const toggleText = async () =>
  page.evaluate(() => document.getElementById("yearStyleToggle")?.textContent.trim() ?? "（沒有按鈕）");

ok("有年份顯示切換鈕", await page.evaluate(() => Boolean(document.getElementById("yearStyleToggle"))));
ok("預設顯示民國年", /年份顯示：民國年/.test(await toggleText()), await toggleText());

const before = await detailCells();
ok("明細表確實有兩季資料可比（不是拿空表當通過）", before.length >= 4, `${before.length} 列`);
const beforePeriods = [...new Set(before.map((r) => r[0]).filter(Boolean))].sort();
ok(
  "民國年模式下期別欄是 114Q4／115Q1",
  beforePeriods.join("、") === "114Q4、115Q1",
  beforePeriods.join("、"),
);

/* ── 切到西元年 ───────────────────────────────────────── */
await page.evaluate(() => document.getElementById("yearStyleToggle").click());
await page.waitForTimeout(900);
ok("切到「西元年」", /年份顯示：西元年/.test(await toggleText()), await toggleText());

const after = await detailCells();
const afterPeriods = [...new Set(after.map((r) => r[0]).filter(Boolean))].sort();
ok(
  "西元年模式下期別欄是 2025Q4／2026Q1",
  afterPeriods.join("、") === "2025Q4、2026Q1",
  afterPeriods.join("、"),
);
/* 期別那一欄本來就會變，其餘每一格切換前後必須逐字相同。 */
const strip = (rows) => rows.map((row) => row.slice(1));
ok(
  "切換前後明細表每一格數字逐字相同（只有期別那一欄變了）",
  JSON.stringify(strip(before)) === JSON.stringify(strip(after)),
  (() => {
    const a = strip(before);
    const b = strip(after);
    for (let r = 0; r < Math.max(a.length, b.length); r += 1)
      if (JSON.stringify(a[r]) !== JSON.stringify(b[r]))
        return `第 ${r + 1} 列 ${JSON.stringify(a[r])} → ${JSON.stringify(b[r])}`;
    return `${a.length} 列全部相同`;
  })(),
);
/* 列的順序也不可以變：排序仍必須走儲存值 */
ok(
  "切換後列的順序沒有改變",
  JSON.stringify(before.map((r) => r.slice(1, 5))) ===
    JSON.stringify(after.map((r) => r.slice(1, 5))),
);

/* ── 篩選仍然挑得到資料（最容易被顯示切換弄壞的一處）─────── */
const rangeNote = async () =>
  page.evaluate(() => {
    document.querySelector('[data-view="conclusion"]')?.click();
    document.querySelector('[data-view="delivery"]')?.click();
    return document.getElementById("deliveryRangeNote")?.textContent.trim() || "";
  });
const deliverySelects = await page.evaluate(() => {
  const s = document.getElementById("deliveryPeriodStart");
  const e = document.getElementById("deliveryPeriodEnd");
  return {
    startValues: [...(s?.options || [])].map((o) => o.value),
    startTexts: [...(s?.options || [])].map((o) => o.textContent),
    selectedStart: s?.value,
    selectedEnd: e?.value,
  };
});
ok(
  "成果交付的季度選單：值是民國年儲存值，文字是西元年",
  deliverySelects.startValues.join("、") === "114Q4、115Q1" &&
    deliverySelects.startTexts.join("、") === "2025Q4、2026Q1",
  JSON.stringify(deliverySelects),
);
const note = await rangeNote();
ok(
  "成果範圍仍然涵蓋兩個季度（篩選沒有因為換寫法而落空）",
  /共 2 個季度/.test(note),
  note.slice(0, 80),
);
ok("成果範圍提示用的是西元年", /2025Q4/.test(note) && /2026Q1/.test(note), note.slice(0, 80));

const qualityFilters = await page.evaluate(() => {
  document.querySelector('[data-view="speed"]')?.click();
  const el = document.getElementById("qualityFrom");
  return {
    values: [...(el?.options || [])].map((o) => o.value),
    texts: [...(el?.options || [])].map((o) => o.textContent),
  };
});
ok(
  "品質總覽的季度選單：值是民國年儲存值，文字是西元年",
  qualityFilters.values.filter(Boolean).join("、") === "114Q4、115Q1" &&
    qualityFilters.texts.filter((t) => t !== "不限").join("、") === "2025Q4、2026Q1",
  JSON.stringify(qualityFilters),
);

/*
 * 結論草稿的「單季」條件是拿 row.period === scope.quarter 直接比字串的，
 * 沒有經過任何正規化。下拉選單一旦把西元年當成值送進去，這裡立刻變成
 * 「符合條件 0 筆」——這是整個顯示切換最容易悄悄壞掉的一處。
 */
const conclusionSingleQuarter = await page.evaluate(async () => {
  document.querySelector('[data-view="conclusion"]').click();
  await new Promise((r) => setTimeout(r, 300));
  const kind = document.querySelector('#conclusionScopeKinds input[value="quarter"]');
  kind.checked = true;
  kind.onchange();
  await new Promise((r) => setTimeout(r, 300));
  const select = document.getElementById("conclusionQuarter");
  select.value = select.options[select.options.length - 1].value;
  select.onchange();
  await new Promise((r) => setTimeout(r, 300));
  document.getElementById("conclusionRegenerate").click();
  await new Promise((r) => setTimeout(r, 500));
  return {
    optionValue: select.value,
    optionText: select.options[select.selectedIndex]?.textContent,
    count: document.getElementById("conclusionCount")?.textContent || "",
    draft: (document.getElementById("conclusionDraft")?.value || "").slice(0, 200),
  };
});
ok(
  "結論草稿選單的值是民國年儲存值、文字是西元年",
  conclusionSingleQuarter.optionValue === "115Q1" &&
    conclusionSingleQuarter.optionText === "2026Q1",
  JSON.stringify(conclusionSingleQuarter).slice(0, 160),
);
ok(
  "結論草稿選了單一季度之後仍挑得到資料（不是 0 筆）",
  /符合條件 [1-9]/.test(conclusionSingleQuarter.count),
  conclusionSingleQuarter.count,
);
ok(
  "結論草稿的內文寫的是西元年",
  /2026Q1/.test(conclusionSingleQuarter.draft) && !/115Q1/.test(conclusionSingleQuarter.draft),
  conclusionSingleQuarter.draft.split("\n")[0] || "（草稿是空的）",
);

/* ── 匯出：Excel 的儲存格與圖表類別軸要一致 ─────────────── */
const workbook = await page.evaluate(async () => {
  const rows = state.summaries.filter((x) => x.projectCode === "E2E-YS");
  const blob = await globalThis.buildTravelWorkbookBlob(rows);
  const buffer = await blob.arrayBuffer();
  return [...new Uint8Array(buffer)];
});
const zip = await JSZip.loadAsync(Uint8Array.from(workbook));
const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
const chart = await zip.file("xl/charts/chart1.xml").async("string");
ok(
  "Excel 季度欄寫的是西元年",
  sheet.includes("<t>2026Q1</t>") && sheet.includes("<t>2025Q4</t>") && !sheet.includes("<t>115Q1</t>"),
  sheet.match(/<t>\d{2,4}Q[1-4]<\/t>/g)?.join("、") || "（找不到季度儲存格）",
);
ok(
  "Excel 圖表的類別軸與儲存格寫的是同一個季度",
  chart.includes("<c:v>2026Q1</c:v>") && !chart.includes("<c:v>115Q1</c:v>"),
  chart.match(/<c:v>\d{2,4}Q[1-4]<\/c:v>/g)?.slice(0, 4).join("、") || "（找不到類別軸）",
);
/* 排序仍走儲存值：114Q4 一定要排在 115Q1 之前 */
ok(
  "Excel 的季度順序沒有被顯示切換打亂",
  sheet.indexOf("<t>2025Q4</t>") < sheet.indexOf("<t>2026Q1</t>"),
);

/* ── 反面：專案包（會被再匯入的資料檔）一律維持民國年 ────── */
const pack = await page.evaluate(() => {
  const p = state.projects.find((x) => x.code === "E2E-YS");
  return JSON.stringify({
    details: state.details.filter((x) => x.projectCode === p.code).map((x) => x.period),
    summaries: state.summaries.filter((x) => x.projectCode === p.code).map((x) => x.period),
  });
});
ok(
  "切成西元年之後，state 裡存的仍然是民國年（專案包／備份不受顯示影響）",
  !/20\d\dQ/.test(pack) && /11[45]Q/.test(pack),
  pack.slice(0, 120),
);

/* ── 切回民國年要完全回到原樣 ──────────────────────────── */
await page.evaluate(() => document.getElementById("yearStyleToggle").click());
await page.waitForTimeout(900);
const backAgain = await detailCells();
ok(
  "切回民國年後畫面與一開始逐字相同",
  JSON.stringify(before) === JSON.stringify(backAgain),
  (() => {
    for (let r = 0; r < Math.max(before.length, backAgain.length); r += 1)
      if (JSON.stringify(before[r]) !== JSON.stringify(backAgain[r]))
        return `第 ${r + 1} 列 ${JSON.stringify(before[r])} → ${JSON.stringify(backAgain[r])}`;
    return `${before.length} 列全部相同`;
  })(),
);

/* ── 重新整理之後要記得使用者的選擇 ────────────────────── */
await page.evaluate(() => document.getElementById("yearStyleToggle").click());
await page.waitForTimeout(900);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);
ok("重新整理後仍記得選的是西元年", /年份顯示：西元年/.test(await toggleText()), await toggleText());

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
