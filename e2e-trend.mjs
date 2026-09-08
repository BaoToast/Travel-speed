/*
 * 端對端：歷季趨勢圖（可勾選指標）＋ 說明欄位 ＋ 點圖下鑽。
 *
 * ── 為什麼這一支要做成端對端而不是只寫單元測試 ────────────────
 *
 * 使用者的原話：單一計畫的趨勢圖「使用頻率很高，因為是要給業主的」，
 * 而下鑽那一段「要確實能自動跳轉及篩選功能正確」。
 *
 * 純函式（buildTrendSeries／describeTrendChart）已經有 trend.test.mjs 守著，
 * 但那守不到「畫面上真的畫出來了嗎」「點下去真的跳過去了嗎」
 * 「篩選真的套上去了嗎」。中間隔著 DOM 事件、檢視切換與搜尋框——
 * 那幾段全部都可能接錯，而接錯的時候單元測試一項都不會紅。
 *
 * ── ⚠️ 假通過陷阱（這一支刻意迴避的）────────────────────────
 *
 * 一、只驗「有 svg」不夠——畫一張空的也有 svg。
 *     要驗**資料點的數量等於季度數**，而且點上帶得出季度。
 * 二、只驗「說明欄位有字」不夠——印任何字都會過。
 *     要驗說明裡出現的數字**等於圖上那一份 series 算出來的值**。
 *     這正是這個功能存在的理由（圖與文字不可以分岔）。
 * 三、只驗「點了會換頁」不夠——換頁但沒套篩選就是半套。
 *     要驗搜尋框真的被填上、而且表格真的只剩那一季。
 * 四、只驗「勾一個」不夠——多勾要變成小倍數圖。
 *     版面切換是靠 class，要驗那個 class 真的換了、圖真的變成多張。
 * 五、三段分界改了，指標名稱與圖上的值都要跟著變。
 *     只驗名稱會被「只改文字沒改計算」騙過去，所以要**同時**驗值。
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
const files = readdirSync(SAMPLE_DIR).filter((name) => /報告測試路段/.test(name));
if (files.length !== 2) {
  console.log(`❌ 匿名測資應有平日、假日各一份，目前為 ${files.length} 份`);
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
await page.fill("#projectCode", "TREND");
await page.fill("#projectName", "趨勢圖測試計畫");
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
/* 三季才看得出趨勢；兩季只會被說「還看不出趨勢」。 */
await importQuarter(115, 0);
await importQuarter(115, 1);
await importQuarter(115, 2);

await page.evaluate(() => document.querySelector('[data-view="charts"]').click());
await page.waitForTimeout(1200);

/* ── 一、面板出得來，而且畫的是真的資料 ── */
const panelVisible = await page.evaluate(
  () => !document.getElementById("trendPanel").hidden,
);
ok("有資料時趨勢面板要出現", panelVisible);

const chartInfo = await page.evaluate(() => {
  const figures = [...document.querySelectorAll("#trendCharts .trend-figure")];
  return {
    figures: figures.length,
    dots: document.querySelectorAll("#trendCharts .trend-dot").length,
    periods: [
      ...new Set(
        [...document.querySelectorAll("#trendCharts .trend-dot")].map(
          (dot) => dot.dataset.period,
        ),
      ),
    ],
    isSmall: document
      .getElementById("trendCharts")
      .classList.contains("trend-small"),
  };
});
ok("預設勾一個指標，只有一張圖", chartInfo.figures === 1, `${chartInfo.figures} 張`);
ok(
  "一張圖時不可以套用小倍數圖的版面",
  chartInfo.isSmall === false,
);
ok(
  "資料點數要等於季度數（3 季）",
  chartInfo.periods.length === 3,
  `實際 ${chartInfo.periods.length} 季：${chartInfo.periods.join("、")}`,
);

/* ── 二、說明文字裡的數字必須等於圖上那一份 series 的值 ── */
const consistency = await page.evaluate(() => {
  const list = window.trendSeriesList();
  const series = list[0];
  const text = document.getElementById("trendScriptBox").innerText;
  const show = (value) =>
    value == null ? null : String(Math.round(value * 10) / 10);
  const first = series.points.find((point) => point.value != null);
  const last = [...series.points].reverse().find((point) => point.value != null);
  return {
    label: series.label,
    hasLabel: text.includes(series.label),
    firstValue: show(first?.value),
    lastValue: show(last?.value),
    hasFirst: first ? text.includes(show(first.value) + "%") : false,
    hasLast: last ? text.includes(show(last.value) + "%") : false,
    textLength: text.length,
  };
});
ok("說明欄位要有內容", consistency.textLength > 40, `${consistency.textLength} 個字`);
ok("說明欄位的標題要等於圖上的指標名稱", consistency.hasLabel, consistency.label);
ok(
  "說明裡的第一季數值必須等於圖上那一份 series 的值",
  consistency.hasFirst,
  `series 算出 ${consistency.firstValue}%`,
);
ok(
  "說明裡的最後一季數值必須等於圖上那一份 series 的值",
  consistency.hasLast,
  `series 算出 ${consistency.lastValue}%`,
);

/* ── 三、多勾指標要變成小倍數圖 ── */
await page.evaluate(() => {
  document
    .querySelector('[data-trend-metric="travel"]')
    .click();
});
await page.waitForTimeout(700);
const multi = await page.evaluate(() => ({
  figures: document.querySelectorAll("#trendCharts .trend-figure").length,
  isSmall: document
    .getElementById("trendCharts")
    .classList.contains("trend-small"),
  captions: [...document.querySelectorAll("#trendCharts figcaption")].map(
    (node) => node.textContent,
  ),
}));
ok("勾第二個指標之後要變成兩張圖", multi.figures === 2, `${multi.figures} 張`);
ok("多張圖時要套用小倍數圖的版面", multi.isSmall === true);
ok(
  "兩張圖的標題不可以一樣（否則是同一個指標畫兩次）",
  new Set(multi.captions).size === 2,
  multi.captions.join(" ／ "),
);

/* 取消到剩一個，版面要變回大圖——只驗一個方向會被「永遠小圖」騙過去 */
await page.evaluate(() => {
  document.querySelector('[data-trend-metric="travel"]').click();
});
await page.waitForTimeout(600);
const backToOne = await page.evaluate(() => ({
  figures: document.querySelectorAll("#trendCharts .trend-figure").length,
  isSmall: document
    .getElementById("trendCharts")
    .classList.contains("trend-small"),
}));
ok(
  "取消到剩一個指標時要變回大圖",
  backToOne.figures === 1 && backToOne.isSmall === false,
);

/* 全部取消時要擋下來，不可以變成空白畫面 */
await page.evaluate(() => {
  document.querySelector('[data-trend-metric="congestedShare"]').click();
});
await page.waitForTimeout(500);
const afterUncheckAll = await page.evaluate(() => ({
  figures: document.querySelectorAll("#trendCharts .trend-figure").length,
  checked: document.querySelectorAll("[data-trend-metric]:checked").length,
}));
ok(
  "不可以把指標全部取消而讓畫面空掉",
  afterUncheckAll.figures >= 1 && afterUncheckAll.checked >= 1,
  `圖 ${afterUncheckAll.figures} 張、勾選 ${afterUncheckAll.checked} 個`,
);

/* ── 四、三段分界改了，指標名稱與值都要跟著變 ── */
const beforeBand = await page.evaluate(() => {
  const series = window.trendSeriesList()[0];
  return {
    label: series.label,
    congestedStart: series.congestedStart,
    values: series.points.map((point) => point.value),
  };
});
await page.evaluate(() => document.querySelector('[data-view="summary"]').click());
await page.waitForTimeout(500);
/*
 * 三段分法的設定區預設是收合的（它是少用的設定，展開會把下面的彙總表
 * 推出畫面外——e2e-reveal 抓到過）。所以這裡要先展開才能操作。
 */
await page.evaluate(() => {
  const details = document.querySelector("details.band-rule");
  if (details) details.open = true;
});
await page.waitForTimeout(300);
const bandSummaryBefore = await page.evaluate(
  () => document.getElementById("bandRuleSummary").textContent,
);
ok(
  "收合狀態下也要看得到目前的分法",
  /順暢 A、B／尚可 C、D／壅塞 E、F/.test(bandSummaryBefore),
  bandSummaryBefore,
);
await page.selectOption("#bandCongestedStart", "D");
await page.click("#applyBandRule");
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector('[data-view="charts"]').click());
await page.waitForTimeout(900);
const afterBand = await page.evaluate(() => {
  const series = window.trendSeriesList()[0];
  return {
    label: series.label,
    congestedStart: series.congestedStart,
    values: series.points.map((point) => point.value),
    scriptText: document.getElementById("trendScriptBox").innerText,
  };
});
ok(
  "分界改成 D 之後，指標名稱要跟著變",
  afterBand.label === "D 級以下路段日別紀錄佔比",
  `${beforeBand.label} → ${afterBand.label}`,
);
ok(
  "說明欄位也要跟著用新的指標名稱",
  afterBand.scriptText.includes("D 級以下路段日別紀錄佔比"),
);
/*
 * 只驗名稱會被「只改文字、沒改計算」騙過去，所以要驗**計算真的吃到新分界**。
 *
 * 這裡不比佔比的數值：匿名測資的速率固定，可能每一季都是 100%，
 * 那樣「不可以下降」會變成永遠成立的空斷言（實測就是這個情形）。
 * 改成直接驗 series 帶的 congestedStart——那是計算真正用到的那個值。
 * 佔比會不會跟著分界變，由 trend.test.mjs 用會變動的資料釘住。
 */
ok(
  "分界放寬之後，計算真的吃到新的分界（不是只改了文字）",
  afterBand.congestedStart === "D" && beforeBand.congestedStart === "E",
  `${beforeBand.congestedStart} → ${afterBand.congestedStart}`,
);
ok(
  "分界放寬之後，每一季的佔比都不可以下降",
  afterBand.values.every(
    (value, index) =>
      value == null ||
      beforeBand.values[index] == null ||
      value >= beforeBand.values[index],
  ),
  `${JSON.stringify(beforeBand.values)} → ${JSON.stringify(afterBand.values)}`,
);

/* ── 五、點圖下鑽：要真的跳頁，而且真的套上篩選 ── */
const targetPeriod = await page.evaluate(() => {
  const dot = document.querySelector("#trendCharts .trend-dot");
  return dot ? dot.dataset.period : "";
});
await page.evaluate(() => {
  document.querySelector("#trendCharts .trend-dot").dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
});
await page.waitForTimeout(1200);
const drill = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#summaryRows tr")];
  return {
    activeView: document.querySelector(".view.active")?.id || "",
    search: document.getElementById("summarySearch").value,
    rowCount: rows.length,
    periods: [
      ...new Set(
        rows
          .map((tr) => tr.querySelector("td,th")?.innerText.trim())
          .filter(Boolean),
      ),
    ],
  };
});
ok("點圖上的點要跳到尖峰彙總", drill.activeView === "summary", drill.activeView);
ok(
  "搜尋框要被自動填上那一季",
  drill.search === targetPeriod,
  `填了「${drill.search}」，點的是「${targetPeriod}」`,
);
/*
 * 這一項才是重點：跳過去但沒篩選就是半套。
 * 表格裡出現的期間只能有那一季（畫面顯示的字可能是季別或月份，
 * 所以用「只有一種」來驗，不比對字面）。
 */
ok(
  "表格要真的只剩那一季（篩選確實生效）",
  drill.rowCount > 0 && drill.periods.length === 1,
  `${drill.rowCount} 列、期間種類 ${drill.periods.length}：${drill.periods.join("、")}`,
);


/* ══════════════════════════════════════════════════════════════════
 * 跨計畫比較圖（Manager）
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ 假通過陷阱：
 *  一、只驗「Manager 有一張 svg」不夠——舊版那張（每路段一張、與 Project
 *      頁完全相同）也是 svg。要驗**線的數量等於計畫數**，而且線尾
 *      直接標著計畫名稱與 N。
 *  二、只驗「明細表存在」不夠——它現在預設收合。要驗**預設是收合的**，
 *      而且點圖之後**真的展開**（只套篩選而表還收著＝使用者覺得沒反應）。
 *  三、舊版那兩顆「先選一個計畫才能用」的匯出鈕必須真的不見了，
 *      不然使用者還是會點到那條死路。
 */
await page.evaluate(() => document.querySelector('[data-view="manager"]').click());
await page.waitForTimeout(600);

/* 先把目前計畫匯出成專案包，再當成「同事交來的包」匯進 Manager。 */
const packJson = await page.evaluate(() => JSON.stringify(window.projectPackage()));
await page.evaluate((text) => {
  const file = new File([text], "同事的專案包.json", { type: "application/json" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.getElementById("managerFiles");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, packJson);
await page.waitForTimeout(2500);

const managerView = await page.evaluate(() => ({
  packs: Number(document.getElementById("managerProjects").textContent),
  lines: document.querySelectorAll("#managerTrendChart polyline").length,
  /*
   * 只取「畫面上真的印出來的那一段」。
   * 線尾標籤裡另外掛了一個 <title>（名稱太長被截斷時，滑鼠移上去仍看得到
   * 完整名稱），而 textContent 會把 <title> 的字一起串進來，變成同一個
   * 名稱印兩次——那不是畫面上的樣子，拿它來斷言等於在驗一個不存在的字串。
   */
  labels: [...document.querySelectorAll("#managerTrendChart .trend-series-label")].map(
    (node) =>
      [...node.childNodes]
        .filter((child) => child.nodeType === 3)
        .map((child) => child.textContent)
        .join(""),
  ),
  scriptText: document.getElementById("managerTrendScript").innerText,
  detailsOpen: document.querySelector(".manager-data")?.open,
  rowsCount: document.getElementById("managerRowsCount")?.textContent,
  /* 舊版那兩顆死路按鈕必須不存在 */
  legacyButtons:
    Number(Boolean(document.getElementById("exportManagerCharts"))) +
    Number(Boolean(document.getElementById("exportManagerLos"))),
  legacyGrid: Boolean(document.getElementById("managerChartGrid")),
}));

ok("專案包要能匯進 Manager", managerView.packs === 1, `${managerView.packs} 份`);
ok(
  "跨計畫圖要畫出線（一個計畫一條）",
  managerView.lines >= 1,
  `${managerView.lines} 條`,
);
ok(
  "線尾要直接標出計畫名稱與路段數 N",
  managerView.labels.length >= 1 && /N=\d+/.test(managerView.labels[0] || ""),
  managerView.labels.join(" ／ "),
);
ok(
  "跨計畫的說明一定要講出「各計畫路段數不一樣」",
  /路段數不一樣/.test(managerView.scriptText),
  managerView.scriptText.slice(0, 60),
);
ok(
  "跨計畫的說明要講清楚比的是比例不是總數",
  /不用總數/.test(managerView.scriptText),
);
ok("明細表預設要收合", managerView.detailsOpen === false);
ok(
  "收合時也要看得到有幾筆",
  /\d+ 筆/.test(managerView.rowsCount || ""),
  managerView.rowsCount,
);
ok(
  "舊版「先選一個計畫才能用」的兩顆匯出鈕要移除",
  managerView.legacyButtons === 0,
  `還剩 ${managerView.legacyButtons} 顆`,
);
ok(
  "舊版與 Project 頁重複的每路段圖容器要移除",
  managerView.legacyGrid === false,
);

/* 點跨計畫圖 → 明細表要展開，而且篩選要套上去 */
const managerPeriod = await page.evaluate(() => {
  const dot = document.querySelector("#managerTrendChart .trend-dot");
  return dot ? dot.dataset.period : "";
});
await page.evaluate(() => {
  document
    .querySelector("#managerTrendChart .trend-dot")
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(1000);
const afterManagerClick = await page.evaluate(() => ({
  detailsOpen: document.querySelector(".manager-data")?.open,
  search: document.getElementById("managerSearch").value,
  periods: [
    ...new Set(
      [...document.querySelectorAll("#managerRows tr")]
        .map((tr) => tr.querySelectorAll("td")[1]?.innerText.trim())
        .filter(Boolean),
    ),
  ],
}));
ok(
  "點圖之後明細表要自動展開（只套篩選而表還收著等於沒反應）",
  afterManagerClick.detailsOpen === true,
);
ok(
  "點圖之後搜尋框要被填上那一季",
  afterManagerClick.search === managerPeriod,
  `填了「${afterManagerClick.search}」，點的是「${managerPeriod}」`,
);
ok(
  "點圖之後明細表要真的只剩那一季",
  afterManagerClick.periods.length === 1,
  `期間種類 ${afterManagerClick.periods.length}：${afterManagerClick.periods.join("、")}`,
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
