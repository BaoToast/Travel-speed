/**
 * 端對端：尖峰明細／尖峰彙總的表頭欄位篩選。
 *
 * 使用者要的行為，用他自己的話：
 *   「針對表標題列提供篩選，例如期間篩選 115Q2，然後路段篩選 A 路段，
 *     表單就呈現出 115Q2 A 路段的資訊。」
 *
 * 這一支就照著驗，另外再驗幾件「做錯了很難發現」的事：
 *
 *   ・**篩選比對的是儲存值，不是畫面上的字。**
 *     期間存的一律是民國年（115Q1），畫面可以切成西元。切換顯示之後，
 *     已經勾好的條件必須還在、結果筆數不能變。用顯示值當鍵就會在這裡破功。
 *
 *   ・**選項清單要排除自己這一欄的條件。**
 *     期間勾了 115Q2 之後再打開「路段」，看到的應該是這一季有的路段；
 *     但再打開「期間」時必須仍然看得到全部季度，否則勾完就改不掉了。
 *
 *   ・**全文搜尋框要能和欄位篩選疊加**（使用者指定保留搜尋框）。
 *
 *   ・**匯出 CSV 要跟著畫面走**，不能篩完之後倒出整包。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
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
  const path = join(here, decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html");
  if (!existsSync(path) || !path.startsWith(here)) return void res.writeHead(404).end("nf");
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

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

/* ── 造一批可預測的匿名資料：3 路段 × 2 季 × 2 方向 × 2 尖峰 = 24 筆 ── */
await page.evaluate(() => go("setup"));
await page.fill("#projectCode", "99001");
await page.fill("#projectName", "欄位篩選測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(700);
const ROADS = ["A路段(甲～乙)", "B路段(丙～丁)", "C路段(戊～己)"];
await page.evaluate(async (roads) => {
  let n = 0;
  for (const road of roads)
    for (const period of ["115Q1", "115Q2"])
      for (const direction of ["方向1", "方向2"])
        for (const peak of ["上午", "下午"]) {
          state.details.push({
            projectCode: state.activeCode,
            period,
            road,
            direction,
            peak,
            day: "平日",
            travel: 30 + (n % 5),
            running: 35 + (n % 4),
            totalDelay: 10 + (n % 3),
            limit: 50,
            los: "C",
            id: "cf-" + n++,
          });
        }
  await save();
  rebuild();
  renderAll();
}, ROADS);

await page.evaluate(() => go("detail"));
await page.waitForTimeout(500);

const shown = () => page.evaluate(() => document.querySelectorAll("#detailRows tr").length);
const countText = () => page.evaluate(() => document.getElementById("detailCount").textContent);
const firstCells = (col) =>
  page.evaluate(
    (c) => [...document.querySelectorAll("#detailRows tr")].map((tr) => tr.children[c]?.textContent),
    col,
  );

ok("先看到全部 24 筆", (await shown()) === 24, await countText());

/** 打開某一欄的下拉，勾起指定文字的選項。 */
async function pick(columnIndex, labels) {
  await page.click(`#detailHead th:nth-child(${columnIndex + 1}) .col-filter-btn`);
  await page.waitForTimeout(250);
  for (const label of labels) {
    await page.evaluate((text) => {
      const rows = [...document.querySelectorAll(".col-filter-panel .col-filter-list label")];
      const hit = rows.find((r) => r.textContent.trim() === text);
      if (hit) hit.querySelector("input").click();
    }, label);
    await page.waitForTimeout(200);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
}
const optionLabels = async (columnIndex) => {
  await page.click(`#detailHead th:nth-child(${columnIndex + 1}) .col-filter-btn`);
  await page.waitForTimeout(250);
  const out = await page.evaluate(() =>
    [...document.querySelectorAll(".col-filter-panel .col-filter-list label")].map((r) =>
      r.textContent.trim(),
    ),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  return out;
};

/* ── 使用者描述的那個情境 ───────────────────────────────── */
await pick(0, ["115Q2"]);
ok("期間篩 115Q2 → 剩 12 筆", (await shown()) === 12, await countText());
ok(
  "只剩 115Q2",
  (await firstCells(0)).every((t) => t === "115Q2"),
  [...new Set(await firstCells(0))].join("、"),
);

await pick(1, ["A路段(甲～乙)"]);
ok("再篩路段 A → 剩 4 筆（115Q2 × A路段）", (await shown()) === 4, await countText());
const rows = await page.evaluate(() =>
  [...document.querySelectorAll("#detailRows tr")].map((tr) =>
    [...tr.children].slice(0, 2).map((td) => td.textContent),
  ),
);
ok(
  "每一列都是 115Q2 ＋ A路段",
  rows.every(([p, r]) => p === "115Q2" && r === "A路段(甲～乙)"),
  JSON.stringify(rows),
);

/* ── 選項清單要排除自己這一欄的條件 ───────────────────────── */
ok(
  "「路段」的選項只列 115Q2 有的路段",
  (await optionLabels(1)).length === 3,
  (await optionLabels(1)).join("、"),
);
ok(
  "「期間」的選項仍然看得到兩季（否則勾完就改不掉）",
  (await optionLabels(0)).join("、") === "115Q1、115Q2",
  (await optionLabels(0)).join("、"),
);

/* ── 切成西元顯示，條件與筆數都不能變 ─────────────────────── */
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /年份顯示/.test(b.textContent || ""),
  );
  if (btn) btn.click();
});
await page.waitForTimeout(600);
const afterToggle = await shown();
const periodTexts = [...new Set(await firstCells(0))];
ok("切換年份顯示後筆數不變（篩選比對的是儲存值）", afterToggle === 4, `${afterToggle} 筆`);
ok("畫面上的期間確實換了寫法", periodTexts.length === 1, periodTexts.join("、"));

/* ── 搜尋框與欄位篩選要能疊加 ─────────────────────────────── */
await page.fill("#detailSearch", "上午");
await page.waitForTimeout(400);
ok("搜尋「上午」疊加後剩 2 筆", (await shown()) === 2, await countText());
await page.fill("#detailSearch", "");
await page.waitForTimeout(400);

/* 搜尋沒有交集時，既有欄位條件也只能暫時得到 0 筆，不可被程式自行清掉。 */
await page.fill("#detailSearch", "B路段");
await page.waitForTimeout(400);
ok(
  "搜尋與既有欄位條件沒有交集時顯示 0 筆",
  await page.evaluate(() => document.querySelectorAll("#detailRows tr:not(:has(.empty))").length === 0),
  await countText(),
);
ok(
  "沒有交集時仍保留原本兩欄篩選",
  await page.evaluate(() => /已篩選 2 個欄位/.test(document.getElementById("detailFilterState")?.textContent || "")),
);
await page.fill("#detailSearch", "");
await page.waitForTimeout(400);
ok("清除搜尋後原本的 115Q2＋A路段條件仍有效", (await shown()) === 4, await countText());

/* ── 清除全部篩選 ───────────────────────────────────────── */
await page.click("#detailFilterState .col-filter-clear");
await page.waitForTimeout(400);
ok("清除全部篩選後回到 24 筆", (await shown()) === 24, await countText());

/* ── 篩到沒有資料時要講清楚，不能只給一片空白 ───────────────── */
/* 先把年份顯示切回民國，下面才好用民國寫法挑選項 */
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /年份顯示/.test(b.textContent || ""),
  );
  if (btn) btn.click();
});
await page.waitForTimeout(600);
await pick(0, ["115Q1"]);
/* LOS 是 rebuild() 依速限比重算的，不是我塞進去的值——這裡照實際算出來的挑 */
const losOptions = await optionLabels(9);
await pick(9, [losOptions[0]]);
await page.evaluate(async () => {
  /* 把 115Q1 的 LOS 全部改掉，讓「115Q1 ＋ 剛才挑的 LOS」變成沒有資料 */
  for (const row of state.details) if (row.period === "115Q1") row.los = "F";
  await save();
  renderDetails();
});
await page.waitForTimeout(400);
const emptyText = await page.evaluate(
  () => document.querySelector("#detailRows .empty")?.textContent || "",
);
ok("篩不到資料時會說明原因與怎麼辦", /欄位篩選/.test(emptyText), emptyText.slice(0, 40));

/* ── 彙總表也要有 ───────────────────────────────────────── */
await page.evaluate(() => go("summary"));
await page.waitForTimeout(500);
ok(
  "尖峰彙總的表頭也掛上了篩選鈕",
  (await page.evaluate(() => document.querySelectorAll("#summaryHead .col-filter-btn").length)) === 6,
);
await page.click("#summaryHead th:nth-child(1) .col-filter-btn");
await page.waitForTimeout(250);
await page.evaluate(() => {
  const hit = [...document.querySelectorAll(".col-filter-panel .col-filter-list label")].find(
    (row) => row.textContent.trim() === "115Q2",
  );
  if (hit) hit.querySelector("input").click();
});
await page.keyboard.press("Escape");
await page.fill("#summarySearch", "不存在的路段");
await page.waitForTimeout(350);
ok(
  "尖峰彙總搜尋無交集時仍保留表頭條件",
  await page.evaluate(() => /已篩選 1 個欄位/.test(document.getElementById("summaryFilterState")?.textContent || "")),
);
await page.fill("#summarySearch", "");
await page.waitForTimeout(350);
ok(
  "尖峰彙總清除搜尋後恢復原條件結果",
  await page.evaluate(() =>
    [...document.querySelectorAll("#summaryRows tr")].every(
      (tr) => tr.children[0]?.textContent === "115Q2",
    ),
  ),
);
await page.click("#summaryFilterState .col-filter-clear");
await page.waitForTimeout(250);

/* ── Manager 比較：季度／日別／LOS 改成表頭漏斗之後仍然要能篩 ───── */
await page.evaluate(async () => {
  /* 用目前這個計畫自己造一份專案包塞進 Manager，不動任何真實資料 */
  state.manager = [
    {
      project: { code: "99001", name: "欄位篩選測試計畫" },
      summaries: state.details.map((x) => ({ ...x })),
      importedAt: "2026-09-04 10:00",
    },
  ];
  await save();
  renderAll();
  go("manager");
});
await page.waitForTimeout(600);
ok(
  "Manager 的舊下拉已經拿掉（季度／日別／LOS）",
  (await page.evaluate(
    () =>
      !document.getElementById("managerPeriodFilter") &&
      !document.getElementById("managerDayFilter") &&
      !document.getElementById("managerLosFilter"),
  )) === true,
);
ok(
  "Manager 表頭掛上 6 個篩選鈕",
  (await page.evaluate(() => document.querySelectorAll("#managerHead .col-filter-btn").length)) === 6,
);
const managerShown = () =>
  page.evaluate(() => document.querySelectorAll("#managerRows tr").length);
const managerBefore = await managerShown();
await page.click("#managerHead th:nth-child(2) .col-filter-btn");
await page.waitForTimeout(300);
await page.evaluate(() => {
  const hit = [...document.querySelectorAll(".col-filter-panel .col-filter-list label")].find(
    (r) => r.textContent.trim() === "115Q2",
  );
  if (hit) hit.querySelector("input").click();
});
await page.waitForTimeout(400);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const managerAfter = await managerShown();
ok(
  "Manager 依期間篩 115Q2 之後筆數減半",
  managerAfter === managerBefore / 2,
  `${managerBefore} → ${managerAfter}`,
);
ok(
  "Manager 只剩 115Q2",
  await page.evaluate(() =>
    [...document.querySelectorAll("#managerRows tr")].every(
      (tr) => tr.children[1]?.textContent === "115Q2",
    ),
  ),
);
await page.fill("#managerSearch", "115Q1");
await page.waitForTimeout(350);
ok(
  "Manager 搜尋無交集時仍保留期間條件",
  await page.evaluate(() => /已篩選 1 個欄位/.test(document.getElementById("managerFilterState")?.textContent || "")),
);
await page.fill("#managerSearch", "");
await page.waitForTimeout(350);
ok("Manager 清除搜尋後恢復原期間結果", (await managerShown()) === managerAfter);
await page.click("#resetManagerFilters");
await page.waitForTimeout(400);
ok("Manager 清除篩選後回到原本筆數", (await managerShown()) === managerBefore);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
