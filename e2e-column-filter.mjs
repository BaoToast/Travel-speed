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
import { ensureToolbarOpen } from "./_toolbar.mjs";

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
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

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
            /*
             * ⚠️ year／quarter 不可以省。
             *   彙總的分組鍵是（計畫・年・季・路段・日別），真正匯入進來的
             *   每一筆都帶著這兩欄（parsePeakSheet 寫的是 +year／+q）。
             *   假資料只給 period 的話，兩季會被併成同一組（鍵裡是
             *   undefined|undefined），彙總從 6 列縮成 3 列——
             *   而且縮的那一半看起來只是「這一季沒有資料」，很難發現。
             */
            year: Number(period.slice(0, 3)),
            quarter: Number(period.slice(-1)),
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

/*
 * ⚠️ v2.20.67 起「期間」那一格底下多了一行「調查日 …」
 *   （使用者 2026-09-20 要的逐筆調查日期）。
 *   直接讀 td.textContent 會把那一行也讀進來，
 *   於是「這一格等於 115Q2」永遠不成立。
 *   這裡把它拆掉再比——拆掉的是**另一件事**的文字，
 *   不是放寬標準：那一格仍然必須逐字相等。
 */
const CELL_TEXT = `(td) => {
  if (!td) return undefined;
  const own = td.cloneNode(true);
  for (const line of own.querySelectorAll(".survey-date")) line.remove();
  return own.textContent;
}`;

const shown = () => page.evaluate(() => document.querySelectorAll("#detailRows tr").length);
const countText = () => page.evaluate(() => document.getElementById("detailCount").textContent);
const firstCells = (col) =>
  page.evaluate(
    ([c, src]) => {
      const cellText = eval(src);
      return [...document.querySelectorAll("#detailRows tr")].map((tr) =>
        cellText(tr.children[c]),
      );
    },
    [col, CELL_TEXT],
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
const rows = await page.evaluate((src) => {
  const cellText = eval(src);
  return [...document.querySelectorAll("#detailRows tr")].map((tr) =>
    [...tr.children].slice(0, 2).map(cellText),
  );
}, CELL_TEXT);
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
  await page.evaluate((src) => {
    const cellText = eval(src);
    return [...document.querySelectorAll("#summaryRows tr")].every(
      (tr) => cellText(tr.children[0]) === "115Q2",
    );
  }, CELL_TEXT),
);
await page.click("#summaryFilterState .col-filter-clear");
await page.waitForTimeout(250);

/*
 * ⚠️ 這裡原本有一整段「Manager 比較的表頭漏斗」測試。
 *   Manager 於 2026-09-13 依使用者決定整組移除，那一頁不存在了。
 *
 *   ⚠️ 它驗的規則（舊下拉要拿掉、表頭掛得上漏斗、篩選後筆數對、
 *   搜尋與欄位條件會疊加、清除後復原）**上面對尖峰明細與尖峰彙總
 *   已經逐項驗過同一套**——那兩張表用的是同一支 ColumnFilter。
 *   所以是刪掉重複的那一份，不是放棄覆蓋。
 */

/*
 * ── 路段速限表也要有（使用者 2026-09-15）─────────────────────
 *
 * 使用者原話：「路段速限的表，請建立篩選功能……（每欄位都能篩，
 *   路段／方向／速限），所以篩選很重要」。
 *
 * ⚠️ 這一段要驗的是**真的篩掉列**，不是「掛得上按鈕」。
 *   只驗按鈕數量的話，一個什麼都不做的漏斗也會全綠。
 * ⚠️ 還要驗**篩掉幾列有講出來**：只把列拿掉、什麼都不寫，
 *   使用者會以為那些路段的速限不見了。
 */
await page.evaluate(() => go("speed"));
await page.waitForTimeout(500);
const speedRowCount = () =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("#speedRows tr")].filter(
        (tr) => !tr.querySelector(".empty"),
      ).length,
  );
const speedAll = await speedRowCount();
ok(
  "路段速限表的四個欄位標題都掛上了篩選鈕（路段／方向／速限／資料來源）",
  (await page.evaluate(
    () => document.querySelectorAll("#speedHead .col-filter-btn").length,
  )) === 4,
);
ok("前置：速限表本來有列可以篩（0 列的話下面全部恆真）", speedAll > 1, `${speedAll} 列`);
const speedPick = async (columnIndex, label) => {
  await page.click(`#speedHead th:nth-child(${columnIndex + 1}) .col-filter-btn`);
  await page.waitForTimeout(250);
  const picked = await page.evaluate((text) => {
    const rows = [
      ...document.querySelectorAll(".col-filter-panel .col-filter-list label"),
    ];
    const hit = text
      ? rows.find((r) => r.textContent.trim() === text)
      : rows[0];
    if (!hit) return null;
    hit.querySelector("input").click();
    return hit.textContent.trim();
  }, label);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return picked;
};
const pickedRoad = await speedPick(0, "");
const afterRoad = await speedRowCount();
ok(
  "⚠️ 依「路段」篩之後列數真的變少（不是掛了按鈕卻不篩）",
  pickedRoad !== null && afterRoad > 0 && afterRoad < speedAll,
  `選「${pickedRoad}」：${speedAll} → ${afterRoad} 列`,
);
ok(
  "⚠️ 篩掉幾列要說出來（不然看起來像資料不見了）",
  await page.evaluate(() => {
    const el = document.getElementById("speedFilterNotes");
    return Boolean(el) && !el.hidden && /隱藏/.test(el.textContent || "");
  }),
  (await page.evaluate(
    () => document.getElementById("speedFilterNotes")?.textContent || "",
  )).slice(0, 60),
);
const pickedSpeed = await speedPick(2, "");
ok(
  "⚠️ 再依「公告速限」疊加之後仍然篩得到（跨欄是 AND）",
  (await speedRowCount()) <= afterRoad,
  `再選「${pickedSpeed}」：${afterRoad} → ${await speedRowCount()} 列`,
);
await page.click("#speedFilterState .col-filter-clear");
await page.waitForTimeout(300);
ok(
  "清除全部篩選後回到全部列，提示也收起來",
  (await speedRowCount()) === speedAll &&
    (await page.evaluate(
      () => document.getElementById("speedFilterNotes")?.hidden !== false,
    )),
  `${await speedRowCount()} 列`,
);

/*
 * ── C-4／J-3／**L-1**：主工具列縮小範圍時，漏斗仍然列得出全部的值 ──────
 *
 * 使用者 2026-09-15（問題）：「當我主工具列選擇 115Q1-115Q2 區間的資料時……
 *   匯總表本身的篩選條件範圍也變成只有 115Q1～115Q2，我無法篩選表格上有的
 *   其他資料（例如 114Q1～114Q4），但因為沒有任何提示……**會誤以為自己
 *   表格裡 114Q1～114Q4 資料遺失了**。請補充提示說明。」
 *
 * 使用者 2026-09-15（裁示，L-1）：「主工具列做了篩選的話，表格也跟著做篩選……
 *   但這種篩選是表單自己全部資料下跟著主工具列做的篩選，**使用者點開路段
 *   篩選鈕時，仍舊看得到全部路段的資料**，如果勾了一個與主工具列目前篩選
 *   條件不同的路段，**這個表單就脫離，只影響這個表單**，並出現回歸主工具列
 *   的按鈕，主工具列也跳出全部回歸按鈕。」
 *
 * ⚠️ 這一段在 L-1 之後**整個反過來了**。舊版驗的是
 *   「主工具列縮小之後，表頭漏斗的選項跟著變少」——那正是使用者要求拿掉的行為。
 *   現在要驗的是：
 *     ① 表格的**列**真的跟著主工具列變少（跟隨主工具列這件事不可以丟掉）
 *     ② 漏斗的**選項數量完全不變**，範圍外的被標成灰字（data-outside）
 *     ③ 勾一個範圍外的值 → **只有這一張表**脫離，出現回歸鈕，主工具列也跳全部回歸
 *     ④ 反面：勾範圍**內**的值不可以脫離（否則③會恆真）
 *     ⑤ 按回歸之後真的回到跟隨主工具列的狀態
 */

/*
 * 主工具列的路段是**下拉多選**（使用者 2026-09-15 指定改成與全日交通量同格式），
 * 不是 <select>，所以要操作面板裡的核取方塊。
 * ⚠️ 與 e2e-filter-coverage / e2e-main-toolbar 是同一份寫法，三處要一致。
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

console.log("\n══ C-4／J-3 主工具列縮小範圍時的提示 ══");
await page.evaluate(() => go("detail"));
await page.waitForTimeout(600);
/*
 * ⚠️ 前置：把主工具列與表頭篩選都清乾淨再量。
 *   前面幾段測試留下的條件會讓「縮小前」本來就只剩一季，
 *   於是「縮小後變少」永遠不成立——那是測試自己造成的假紅。
 */
await page.evaluate(() => {
  document.querySelector("#detailFilterState .col-filter-clear")?.click();
});
const mtPeriods = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-period-from"] option')].map(
    (o) => o.value,
  ),
);
ok(
  "前置：季度有兩季以上，才拉得開區間",
  mtPeriods.length >= 2,
  mtPeriods.join("／"),
);
await page.selectOption('[data-testid="mt-period-from"]', mtPeriods[0]);
await page.selectOption(
  '[data-testid="mt-period-to"]',
  mtPeriods[mtPeriods.length - 1],
);
await page.waitForTimeout(900);
/*
 * ⚠️ 用**路段**縮小，不用季度。這一支的測資只有兩季，
 *   而使用者要的情境（「點開**路段**篩選鈕時仍舊看得到全部路段」）本來就是路段。
 */

/** 漏斗裡每一個選項的文字，以及它是不是被標成「不在主工具列條件內」。 */
const optionRows = async (columnIndex, headSelector = "#detailHead") => {
  await page.click(`${headSelector} th:nth-child(${columnIndex + 1}) .col-filter-btn`);
  await page.waitForTimeout(250);
  const out = await page.evaluate(() =>
    [...document.querySelectorAll(".col-filter-panel .col-filter-list label")].map((r) => ({
      label: (r.querySelector("span")?.textContent || "").trim(),
      outside: r.dataset.outside === "1",
    })),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  return out;
};
/** 勾漏斗裡某一個標籤（面板保持開著，因為勾完可能要看它自己怎麼變）。 */
const tickOption = async (columnIndex, label, headSelector = "#detailHead") => {
  await page.click(`${headSelector} th:nth-child(${columnIndex + 1}) .col-filter-btn`);
  await page.waitForTimeout(250);
  await page.evaluate((wanted) => {
    const row = [
      ...document.querySelectorAll(".col-filter-panel .col-filter-list label"),
    ].find((r) => (r.querySelector("span")?.textContent || "").trim() === wanted);
    if (!row) throw new Error(`漏斗裡找不到「${wanted}」`);
    row.querySelector("input[type=checkbox]").click();
  }, label);
  await page.waitForTimeout(900);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
};
const detachState = () =>
  page.evaluate(() => ({
    detail: Boolean(
      document.querySelector('#detailFilterNotes [data-detached-chart="detail-table"]'),
    ),
    detailReset: Boolean(
      document.querySelector('#detailFilterNotes [data-testid="chart-detach-reset"]'),
    ),
    summary: Boolean(
      document.querySelector('#summaryFilterNotes [data-detached-chart="summary-table"]'),
    ),
    resetAll: Boolean(document.querySelector('[data-testid="mt-reset-all"]')),
  }));

const roadsBefore = await optionRows(1);
ok(
  "前置：條件放寬時，表頭漏斗列得出兩條以上路段（1 條的話下面幾條恆真）",
  roadsBefore.length >= 2 && roadsBefore.every((r) => !r.outside),
  roadsBefore.map((r) => r.label).join("／"),
);
const detailRowsBefore = await shown();
await pickRoads(page, [roadsBefore[0].label]);
await page.waitForTimeout(900);
ok(
  "① 尖峰明細**真的跟著主工具列走**（列數變少）",
  (await shown()) < detailRowsBefore,
  `主工具列縮小前 ${detailRowsBefore} 筆 → 縮小後 ${await shown()} 筆`,
);
const roadsAfter = await optionRows(1);
ok(
  "② ⚠️ L-1：漏斗的路段選項**一個都沒有少**（仍舊看得到全部路段）",
  roadsAfter.length === roadsBefore.length,
  `縮小前 ${roadsBefore.length} 條 → 縮小後 ${roadsAfter.length} 條（${roadsAfter.map((r) => r.label).join("／")}）`,
);
ok(
  "② ⚠️ 範圍外的那幾條被標成「不在主工具列條件內」，而選到的那一條沒有",
  roadsAfter.filter((r) => r.outside).length === roadsAfter.length - 1 &&
    roadsAfter.find((r) => r.label === roadsBefore[0].label)?.outside === false,
  roadsAfter.map((r) => `${r.label}${r.outside ? "（外）" : "（內）"}`).join("／"),
);
const detailNote = await page.evaluate(
  () => document.getElementById("detailFilterNotes")?.textContent || "",
);
ok(
  "② 說明文字改成「漏斗仍然列得出全部的值、勾了會脫離」（不可以還寫著舊的「選項只會列出這個範圍內的值」）",
  /仍然列得出全部的值/.test(detailNote) &&
    /不是資料缺漏/.test(detailNote) &&
    !/只會列出這個範圍內的值/.test(detailNote),
  detailNote.replace(/\s+/g, " ").slice(0, 110),
);
await page.evaluate(() => go("summary"));
await page.waitForTimeout(700);
const summaryNote = await page.evaluate(
  () => document.getElementById("summaryFilterNotes")?.textContent || "",
);
ok(
  "② 尖峰彙總也有同一句（使用者就是在這一張表上發現的）",
  /仍然列得出全部的值/.test(summaryNote) &&
    /不是資料缺漏/.test(summaryNote) &&
    !/只會列出這個範圍內的值/.test(summaryNote),
  summaryNote.replace(/\s+/g, " ").slice(0, 110),
);

/*
 * ④ 反面先做：勾**範圍內**的值不可以脫離。
 *   少了這一條，一個「只要動漏斗就脫離」的實作也會讓③全綠。
 */
await page.evaluate(() => go("detail"));
await page.waitForTimeout(600);
await tickOption(1, roadsBefore[0].label);
const afterInScope = await detachState();
ok(
  "④ 反面：勾**範圍內**的路段不可以脫離",
  !afterInScope.detail && !afterInScope.resetAll,
  `脫離=${afterInScope.detail}／主工具列全部回歸鈕=${afterInScope.resetAll}`,
);
await tickOption(1, roadsBefore[0].label); /* 勾回來 */

/* ③ 勾範圍外的值 → 只有這一張表脫離 */
const outsideRoad = roadsAfter.find((r) => r.outside);
ok("前置：真的有一條路段在主工具列範圍外", Boolean(outsideRoad), outsideRoad?.label || "（沒有）");
/*
 * ⚠️ 前置不成立時要**乾淨地紅**，不可以讓它拋例外中斷。
 *   中斷的話後面幾條根本不會印出來，看 log 的人會以為那幾條通過了。
 */
if (outsideRoad) await tickOption(1, outsideRoad.label);
const afterOutside = outsideRoad
  ? await detachState()
  : { detail: false, detailReset: false, summary: false, resetAll: false };
ok(
  "③ ⚠️ 勾了範圍外的路段 → 這一張表脫離，並出現「回到主工具列條件」",
  afterOutside.detail && afterOutside.detailReset,
  `脫離說明=${afterOutside.detail}／回歸鈕=${afterOutside.detailReset}`,
);
ok(
  "③ 主工具列同時跳出「全部回歸」",
  afterOutside.resetAll,
  String(afterOutside.resetAll),
);
ok(
  "③ ⚠️ **只影響這一張表**：尖峰彙總沒有跟著脫離",
  !afterOutside.summary,
  `尖峰彙總脫離=${afterOutside.summary}`,
);
const outsideVisible = outsideRoad
  ? await page.evaluate((wanted) => {
      const cells = [...document.querySelectorAll("#detailRows tr td:nth-child(2)")].map((td) =>
        td.textContent.trim(),
      );
      return { total: cells.length, hit: cells.filter((t) => t === wanted).length };
    }, outsideRoad.label)
  : { total: 0, hit: 0 };
ok(
  "③ ⚠️ 脫離之後那條範圍外的路段**真的看得到資料**（不是只換了說明文字）",
  outsideVisible.hit > 0,
  `${outsideVisible.hit} / ${outsideVisible.total} 列是「${outsideRoad.label}」`,
);

/* ⑤ 按回歸 → 回到跟隨主工具列 */
if (afterOutside.detailReset) {
  await page.click('#detailFilterNotes [data-testid="chart-detach-reset"]');
  await page.waitForTimeout(900);
}
const afterReset = await detachState();
ok(
  "⑤ 按「回到主工具列條件」之後脫離狀態收掉，主工具列的全部回歸鈕也收掉",
  /* ⚠️ 要先**真的脫離過**才算數，否則「從來沒脫離」也會讓這一條全綠。 */
  afterOutside.detail && !afterReset.detail && !afterReset.resetAll,
  `脫離前=${afterOutside.detail}／按完之後脫離=${afterReset.detail}／全部回歸鈕=${afterReset.resetAll}`,
);

await page.evaluate(() => {
  document.querySelector("#detailFilterState .col-filter-clear")?.click();
});
await page.waitForTimeout(400);
await pickRoads(page, []);
await page.waitForTimeout(700);
await page.evaluate(() => go("summary"));
await page.waitForTimeout(600);
const backNote = await page.evaluate(
  () => document.getElementById("summaryFilterNotes")?.textContent || "",
);
ok(
  "⚠️ 主工具列放寬之後這一句要收掉（沒篩掉東西卻講一句是噪音）",
  !/不是資料缺漏/.test(backNote),
  backNote.replace(/\s+/g, " ").slice(0, 60) || "（沒有提示，正確）",
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
