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
/*
 * v2.20.53 起「平日＋假日」是**兩種日別各畫一張、同時顯示**，
 * 不是混成一條線——混出來的數字不對應任何一種日別。
 * 所以預設（日別＝平日＋假日、勾一個指標）是 2 張圖，不是 1 張。
 */
ok(
  "預設勾一個指標＋平日假日兩種日別，要有兩張圖",
  chartInfo.figures === 2,
  `${chartInfo.figures} 張`,
);
ok(
  "兩張圖時要套用小倍數圖的版面（橫軸對齊才能上下對照）",
  chartInfo.isSmall === true,
);
/* 只選一種日別時才是單張大圖——不驗這個方向會被「永遠小圖」騙過去。 */
const singleDay = await page.evaluate(() => {
  trendState.day = "平日";
  renderTrendPanel();
  return {
    figures: document.querySelectorAll("#trendCharts .trend-figure").length,
    isSmall: document
      .getElementById("trendCharts")
      .classList.contains("trend-small"),
  };
});
ok(
  "只選一種日別、一個指標時要是單張大圖",
  singleDay.figures === 1 && singleDay.isSmall === false,
  `${singleDay.figures} 張`,
);
await page.evaluate(() => {
  trendState.day = "ALL";
  renderTrendPanel();
});
await page.waitForTimeout(400);
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
/* 兩個指標 × 兩種日別 ＝ 4 張。 */
ok("勾第二個指標之後要變成四張圖（2 指標 × 2 日別）", multi.figures === 4, `${multi.figures} 張`);
ok("多張圖時要套用小倍數圖的版面", multi.isSmall === true);
ok(
  "四張圖的標題都不可以一樣（否則是同一份資料畫了好幾次）",
  new Set(multi.captions).size === 4,
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
  "取消到剩一個指標時要回到兩張（該指標的平日與假日）",
  backToOne.figures === 2,
  `${backToOne.figures} 張`,
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
/*
 * 服務水準門檻與三段分法在 v2.20.53 搬到獨立的「判定標準」頁——
 * 原本夾在尖峰彙總那張大表格中間，使用者找不到。
 * 三段分法在那一頁預設是展開的（它不再是「少用的設定」，
 * 而是那一頁的主角之一），但保險起見還是確保它開著。
 */
await page.evaluate(() => document.querySelector('[data-view="standards"]').click());
await page.waitForTimeout(500);
await page.evaluate(() => {
  const details = document.querySelector("#standards details.band-rule");
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
/*
 * 標題現在會帶日別（「D 級以下路段佔比（平日）」），所以比對的是**開頭**，
 * 不是整串相等。用 includes 會太鬆——「XD 級以下路段佔比」也會過。
 *
 * 母體名稱在 v2.20.53 改回「路段」：v2.20.48 因為兩種日別混在一起，
 * 才把母體叫成「路段日別紀錄」；拆開之後一張圖裡只有一種日別，
 * 母體本來就是路段。
 */
ok(
  "分界改成 D 之後，指標名稱要跟著變",
  afterBand.label.startsWith("D 級以下路段佔比"),
  `${beforeBand.label} → ${afterBand.label}`,
);
ok(
  "說明欄位也要跟著用新的指標名稱",
  afterBand.scriptText.includes("D 級以下路段佔比"),
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
const targetPoint = await page.evaluate(() => {
  const dot = document.querySelector("#trendCharts .trend-dot");
  return dot ? { period: dot.dataset.period, day: dot.dataset.day } : { period: "", day: "" };
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
    days: [
      ...new Set(
        rows
          .map((tr) => tr.querySelectorAll("td")[2]?.innerText.trim())
          .filter(Boolean),
      ),
    ],
  };
});
ok("點圖上的點要跳到尖峰彙總", drill.activeView === "summary", drill.activeView);
ok(
  "點圖下鑽使用欄位篩選，不以不精確的全文搜尋拼接條件",
  drill.search === "",
  `搜尋框內容：「${drill.search}」`,
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
ok(
  "平假日拆圖後，點圖只可下鑽到該日別，不可又把兩種日別混回來",
  drill.days.length === 1 && drill.days[0] === targetPoint.day,
  `日別：${drill.days.join("、")}`,
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
const packJson = await page.evaluate(() => {
  const pack = window.projectPackage();
  /* 匯入包屬於外部輸入：計畫名稱即使含 HTML，也只能當普通文字顯示。 */
  pack.project.name = "X<img>";
  return JSON.stringify(pack);
});
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
const managerEscaping = await page.evaluate(() => ({
  injectedNode: Boolean(document.querySelector("#managerBandScript img")),
  textVisible: document.getElementById("managerBandScript")?.innerText.includes("<img>") || false,
}));
ok(
  "匯入包的計畫名稱只能顯示成文字，不可被當成 HTML 執行",
  !managerEscaping.injectedNode && managerEscaping.textVisible,
  JSON.stringify(managerEscaping),
);
/*
 * Manager 的「平日＋假日」同樣是**兩條線同時顯示**，不是混成一條。
 * 一份專案包同時含平日與假日時，線的數量要是「計畫數 × 日別數」。
 */
const managerDaysCheck = await page.evaluate(() => {
  const pick = (day) => {
    managerTrendState.day = day;
    renderManager();
    return [
      ...document.querySelectorAll("#managerTrendChart .trend-series-label"),
    ].map((node) =>
      [...node.childNodes]
        .filter((child) => child.nodeType === 3)
        .map((child) => child.textContent)
        .join(""),
    );
  };
  const both = pick("ALL");
  const weekday = pick("平日");
  managerTrendState.day = "ALL";
  renderManager();
  return { both, weekday };
});
ok(
  "Manager 選「平日＋假日」時要一種日別一條線，不是混成一條",
  managerDaysCheck.both.length > managerDaysCheck.weekday.length,
  `合併 ${managerDaysCheck.both.length} 條、只選平日 ${managerDaysCheck.weekday.length} 條`,
);
const staleManagerDay = await page.evaluate(() => {
  managerTrendState.day = "已不存在的日別";
  renderManager();
  return {
    stateDay: managerTrendState.day,
    selectDay: document.getElementById("managerTrendDay").value,
    figures: document.querySelectorAll("#managerTrendChart svg").length,
  };
});
ok(
  "Manager 原選日別已不存在時要自動回到平日＋假日，圖表不可變空白",
  staleManagerDay.stateDay === "ALL" && staleManagerDay.selectDay === "ALL" && staleManagerDay.figures > 0,
  JSON.stringify(staleManagerDay),
);


/* ══ Manager 專屬三段分界：不可以回寫到任何一個計畫 ══ */
/*
 * 使用者明確要求的隔離：
 *   「Manager 比較區也能設定多少分級是順暢，多少是尚可，多少是壅塞，
 *     不能跟單一計畫的分級混在一起使用。」
 *
 * ⚠️ 三個假通過陷阱，這一段刻意迴避：
 *
 *  一、只驗「Manager 有兩個下拉」擋不住——下拉存在但寫回 state.bandRules
 *      一樣會過，而那正是要擋的事。
 *
 *  二、只驗「state.bandRules 沒變」也不夠——如果 Manager 那把尺根本沒有
 *      作用（圖還是照各計畫的尺畫），bandRules 當然也不會變，這一項會
 *      恆真。所以要同時驗**圖真的跟著換了**。
 *
 *  三、驗「圖跟著換」時，兩把尺要挑成**任何資料都一定會有差**的兩把：
 *      壅塞從 B 起（幾乎全部都算壅塞）對上壅塞只有 F（幾乎都不算）。
 *      隨手挑兩把尺的話，剛好測資的等級都落在同一側時就沒有差異，
 *      這一項會變成「有時綠有時紅」的爛守門。
 */
const applyManagerBand = async (smoothEnd, congestedStart) =>
  page.evaluate(
    async ([smooth, congested]) => {
      /*
       * 兩欄互相限制，所以要**先設順暢、觸發重排、再設壅塞**——
       * 直接設壅塞的話，那個值可能還不在選項裡，select 會靜靜不變，
       * 於是套用到的是舊的尺，而這一段守門就會驗到錯的東西。
       */
      const smoothSelect = document.getElementById("managerBandSmoothEnd");
      const congestedSelect = document.getElementById("managerBandCongestedStart");
      smoothSelect.value = smooth;
      smoothSelect.dispatchEvent(new Event("change"));
      congestedSelect.value = congested;
      congestedSelect.dispatchEvent(new Event("change"));
      if (congestedSelect.value !== congested)
        return { error: `壅塞下拉設不到 ${congested}，實際是 ${congestedSelect.value}` };
      document.getElementById("managerBandApply").click();
      await new Promise((done) => setTimeout(done, 350));
      const shares = [
        ...document.querySelectorAll("#managerBandChart rect.band-congested"),
      ].map((node) => Number(node.getAttribute("height")).toFixed(1));
      return {
        rule: JSON.parse(JSON.stringify(state.managerBandRule || {})),
        projectRules: JSON.parse(JSON.stringify(state.bandRules || {})),
        packRules: (state.manager || []).map((pack) =>
          JSON.stringify(pack.bandRule || {}),
        ),
        legend: [
          ...document.querySelectorAll("#managerBandChart .band-legend-text"),
        ].map((node) => node.textContent),
        congestedHeights: shares,
        bars: document.querySelectorAll("#managerBandChart rect[class^=band-]")
          .length,
        script: document.getElementById("managerBandScript").innerText,
      };
    },
    [smoothEnd, congestedStart],
  );

const projectRulesBefore = await page.evaluate(() =>
  JSON.stringify(state.bandRules || {}),
);
/* 壅塞從 B 起：除了 A 以外全部算壅塞。 */
const bandWide = await applyManagerBand("A", "B");
/* 壅塞只有 F：其餘都不算壅塞。 */
const bandNarrow = await applyManagerBand("A", "F");

ok(
  "前置：兩把尺都要真的設定成功（設不到的話下面幾項驗的是舊的尺）",
  !bandWide.error && !bandNarrow.error,
  [bandWide.error, bandNarrow.error].filter(Boolean).join("／"),
);
ok(
  "前置：Manager 三段圖要真的畫得出柱子（畫不出來的話下面幾項會變成恆真）",
  bandWide.bars > 0,
  `${bandWide.bars} 段`,
);
ok(
  "Manager 的分界要存在自己的地方（state.managerBandRule）",
  bandNarrow.rule.congestedStart === "F" && bandNarrow.rule.smoothEnd === "A",
  JSON.stringify(bandNarrow.rule),
);
ok(
  "改 Manager 的分界**不可以**動到任何一個計畫的 state.bandRules",
  JSON.stringify(bandNarrow.projectRules) === projectRulesBefore,
  `改之前 ${projectRulesBefore}／改之後 ${JSON.stringify(bandNarrow.projectRules)}`,
);
ok(
  "改 Manager 的分界也不可以動到專案包裡存的 bandRule",
  bandNarrow.packRules.every(
    (rule) => !/"smoothEnd":"A"/.test(rule) && !/"congestedStart":"F"/.test(rule),
  ),
  bandNarrow.packRules.join(" ／ "),
);
ok(
  "Manager 那把尺要**真的有作用**：壅塞從 B 起與只有 F，柱子高度必須不同",
  bandWide.congestedHeights.join("|") !== bandNarrow.congestedHeights.join("|"),
  `壅塞從 B 起 [${bandWide.congestedHeights.join(", ")}]／只有 F [${bandNarrow.congestedHeights.join(", ")}]`,
);
ok(
  "Manager 三段圖的圖例要寫出哪幾級算哪一段，而且跟著尺變",
  bandWide.legend.some((text) => /壅塞（B、C、D、E、F）/.test(text)) &&
    bandNarrow.legend.some((text) => /壅塞（F）/.test(text)),
  `${bandWide.legend.join(" ／ ")}｜${bandNarrow.legend.join(" ／ ")}`,
);
ok(
  "Manager 三段圖的說明要跟著尺換（不是印一段固定的話）",
  bandWide.script !== bandNarrow.script,
  `${(bandWide.script || "").slice(0, 50)}｜${(bandNarrow.script || "").slice(0, 50)}`,
);

ok(
  "Manager 兩條線的名稱要標出日別",
  managerDaysCheck.both.every((text) => /（平日）|（假日）/.test(text)),
  managerDaysCheck.both.join(" ／ "),
);
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
const managerPoint = await page.evaluate(() => {
  const dot = document.querySelector("#managerTrendChart .trend-dot");
  return dot
    ? { project: dot.dataset.project, period: dot.dataset.period, day: dot.dataset.day }
    : { project: "", period: "", day: "" };
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
  projects: [
    ...new Set(
      [...document.querySelectorAll("#managerRows tr")]
        .map((tr) => tr.querySelectorAll("td")[0]?.innerText.trim())
        .filter(Boolean),
    ),
  ],
  days: [
    ...new Set(
      [...document.querySelectorAll("#managerRows tr")]
        .map((tr) => tr.querySelectorAll("td")[3]?.innerText.trim())
        .filter(Boolean),
    ),
  ],
}));
ok(
  "點圖之後明細表要自動展開（只套篩選而表還收著等於沒反應）",
  afterManagerClick.detailsOpen === true,
);
ok(
  "Manager 點圖下鑽使用精確欄位篩選，不以全文搜尋拼接條件",
  afterManagerClick.search === "",
  `搜尋框內容：「${afterManagerClick.search}」`,
);
ok(
  "點圖之後明細表要真的只剩那一季",
  afterManagerClick.periods.length === 1,
  `期間種類 ${afterManagerClick.periods.length}：${afterManagerClick.periods.join("、")}`,
);
ok(
  "Manager 點圖只可下鑽到該計畫與該日別",
  afterManagerClick.projects.length === 1 &&
    afterManagerClick.projects[0].startsWith(managerPoint.project + " ") &&
    afterManagerClick.days.length === 1 &&
    afterManagerClick.days[0] === managerPoint.day,
  `計畫：${afterManagerClick.projects.join("、")}｜日別：${afterManagerClick.days.join("、")}`,
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));



/* ── 「平日＋假日」是同時顯示兩張圖，不是混成一條線 ── */
/*
 * 使用者明確指出過的坑：「平日+假日 這類條件，指的是同時顯示，因為這類
 * 計算，加總起來沒有應用的意義」。
 *
 * 在這個系統裡「混」不是相加而是**混在一起算平均／算比例**——結果同樣是
 * 一個不對應平日也不對應假日的數字，業主問「所以平日到底多少」時答不出來。
 *
 * ⚠️ 只驗「圖的張數變成兩張」不夠：兩張都畫同一份混合資料也會過。
 * 所以要驗**兩張圖的值不一樣**，而且各自等於單獨選那一種日別時的值。
 */
const daySplit = await page.evaluate(() => {
  const pick = (day) => {
    trendState.day = day;
    return trendSeriesList().map((series) => ({
      label: series.label,
      day: series.day,
      values: series.points.map((point) => point.value),
    }));
  };
  const both = pick("ALL");
  const weekday = pick("平日");
  const holiday = pick("假日");
  trendState.day = "ALL";
  renderTrendPanel();
  return { both, weekday, holiday };
});
ok(
  "選「平日＋假日」時要產生兩張圖（一種日別一張），不是一張混合的",
  daySplit.both.length === 2,
  daySplit.both.map((s) => s.label).join("、"),
);
ok(
  "兩張圖的標題要標出各自的日別",
  daySplit.both.every((s) => /（平日）|（假日）/.test(s.label)),
  daySplit.both.map((s) => s.label).join("、"),
);
ok(
  "「平日」那張的值要與單獨選平日時完全相同（沒有被假日汙染）",
  JSON.stringify(daySplit.both.find((s) => s.day === "平日")?.values) ===
    JSON.stringify(daySplit.weekday[0]?.values),
  `合併時 ${JSON.stringify(daySplit.both.find((s) => s.day === "平日")?.values)}｜單獨 ${JSON.stringify(daySplit.weekday[0]?.values)}`,
);
ok(
  "「假日」那張的值要與單獨選假日時完全相同",
  JSON.stringify(daySplit.both.find((s) => s.day === "假日")?.values) ===
    JSON.stringify(daySplit.holiday[0]?.values),
  `合併時 ${JSON.stringify(daySplit.both.find((s) => s.day === "假日")?.values)}｜單獨 ${JSON.stringify(daySplit.holiday[0]?.values)}`,
);
/*
 * 母體名稱：拆開之後一張圖裡只有一種日別，所以是「路段」。
 * v2.20.48 的「路段日別紀錄」是為了描述混合後的資料，拆開後不再適用。
 */
ok(
  "拆開之後母體要叫「路段」，不可以再叫「路段日別紀錄」",
  daySplit.both.every((s) => !s.label.includes("路段日別紀錄")),
  daySplit.both.map((s) => s.label).join("、"),
);

/* ══ 下載幾張圖，就真的要收到幾個檔 ══ */
/*
 * 使用者實測回報：「LOS 圖表選擇下載高解析圖片，右下角提示成功 6 張圖，
 * 但實際上我只收到一張。」
 *
 * 成因：舊版對每一張圖各觸發一次下載，而瀏覽器對「同一個手勢連續自動
 * 下載多個檔案」有節流——沒允許就只有第一個會過，**而且不會拋任何錯誤**。
 * 提示又是照迴圈次數數的，所以它數了 6 次、說了 6 張，實際只有 1 張。
 *
 * ⚠️ 假通過陷阱：
 *  一、只驗「按了之後有下載事件」擋不住——舊版也有（第一張）。
 *      要驗**實際攔到的下載次數**與提示說的一致。
 *  二、只驗「提示有出現」更擋不住——提示本來就會出現，只是在說謊。
 *  三、Playwright 在無頭 Chromium 底下對 blob 下載的檔名一律回報
 *      "download"，所以檔名不能用 suggestedFilename 驗，改成攔截
 *      <a> 的 click 直接讀當下的 download 屬性。
 */
const multiDownload = await page.evaluate(async () => {
  /* 攔下所有 <a download> 的點擊，記下檔名，並且**不要真的下載**。 */
  const grabbed = [];
  const original = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute("download")) {
      grabbed.push(this.getAttribute("download"));
      return;
    }
    return original.apply(this, arguments);
  };
  /* 勾多個指標 → 畫面上會有多張圖。 */
  const boxes = [...document.querySelectorAll("#trendMetricBoxes input")];
  const before = boxes.map((box) => box.checked);
  boxes.slice(0, 3).forEach((box) => {
    if (!box.checked) box.click();
  });
  await new Promise((done) => setTimeout(done, 500));
  const figures = document.querySelectorAll("#trendCharts .trend-figure svg").length;
  let toastText = "";
  const toastNode = document.getElementById("toast");
  const observer = new MutationObserver(() => {
    if (toastNode.textContent) toastText = toastNode.textContent;
  });
  observer.observe(toastNode, { childList: true, characterData: true, subtree: true });
  await document.getElementById("trendDownloadPng").onclick();
  await new Promise((done) => setTimeout(done, 900));
  observer.disconnect();
  HTMLAnchorElement.prototype.click = original;
  /*
   * ⚠️ 把勾選還原成進來時的樣子。
   * 不還原的話後面那幾項（「選平日＋假日要產生兩張圖」）會看到 4 張，
   * 紅字指向的卻是這一段留下的殘留狀態——那種紅字最浪費時間。
   */
  boxes.forEach((box, index) => {
    if (box.checked !== before[index]) box.click();
  });
  await new Promise((done) => setTimeout(done, 400));
  return { figures, grabbed, toastText };
});
ok(
  "前置：要真的畫出多張圖（只有一張的話下面幾項會變成恆真）",
  multiDownload.figures >= 2,
  `${multiDownload.figures} 張`,
);
ok(
  "前置：要真的攔到下載動作（攔不到的話下面幾項會變成恆真）",
  multiDownload.grabbed.length > 0,
  `攔到 ${multiDownload.grabbed.length} 次：${multiDownload.grabbed.join("、")}`,
);
ok(
  "多張圖時只可以觸發**一次**下載（連續多次會被瀏覽器擋掉，使用者只收到第一張）",
  multiDownload.grabbed.length === 1,
  `觸發了 ${multiDownload.grabbed.length} 次：${multiDownload.grabbed.join("、")}`,
);
ok(
  "多張圖要打包成 ZIP，副檔名必須是 .zip",
  /\.zip$/.test(multiDownload.grabbed[0] || ""),
  multiDownload.grabbed[0] || "（沒有檔名）",
);
ok(
  "提示不可以斷言「已下載」——網頁無法知道檔案有沒有真的落地",
  !/已下載/.test(multiDownload.toastText),
  multiDownload.toastText,
);
ok(
  "提示說的張數要與實際打包的張數一致，不可以照迴圈次數數",
  new RegExp(`裡面有 ${multiDownload.figures} 張圖`).test(multiDownload.toastText),
  `圖 ${multiDownload.figures} 張，提示是「${multiDownload.toastText}」`,
);


await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
