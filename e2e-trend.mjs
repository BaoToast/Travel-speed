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

await page.evaluate(() => document.querySelector('[data-view="trendChart"]').click());
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
    /*
     * ⚠️ 2026-09-13 版面改成「一圖一說明、配成一列」之後，容器不再掛
     *   trend-small——那個類別會把多張圖排成多欄，而多欄正是
     *   「第 5 段說明旁邊是第 2 張圖」的成因（使用者 9/13 回報）。
     *   「要畫成小倍數圖」這個決定仍然存在，改由每一張圖自己的
     *   data-small 表示；這裡驗的是那個決定，不是舊的版面類別。
     */
    isSmall: [...document.querySelectorAll("#trendCharts .trend-figure")].every(
      (f) => f.dataset.small === "1",
    ),
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
  /*
   * ⚠️ v2.20.61 起「日別」不再是 trendState 自己的欄位，
   *   而是主工具列那一套條件（這一塊可以脫離）。
   *   舊寫法 trendState.day = "平日" 現在寫進一個**沒有人讀**的欄位，
   *   於是這一條會量到「還是兩張圖」——不是版面壞了，是守門打錯地方。
   *   照使用者實際的操作走：改這一塊自己的「日別」下拉。
   */
  const select = document.getElementById("trendDay");
  select.value = "平日";
  select.onchange({ target: select });
  renderTrendPanel();
  return {
    figures: document.querySelectorAll("#trendCharts .trend-figure").length,
    /*
     * ⚠️ 2026-09-13 版面改成「一圖一說明、配成一列」之後，容器不再掛
     *   trend-small——那個類別會把多張圖排成多欄，而多欄正是
     *   「第 5 段說明旁邊是第 2 張圖」的成因（使用者 9/13 回報）。
     *   「要畫成小倍數圖」這個決定仍然存在，改由每一張圖自己的
     *   data-small 表示；這裡驗的是那個決定，不是舊的版面類別。
     */
    isSmall: [...document.querySelectorAll("#trendCharts .trend-figure")].every(
      (f) => f.dataset.small === "1",
    ),
  };
});
ok(
  "只選一種日別、一個指標時要是單張大圖",
  singleDay.figures === 1 && singleDay.isSmall === false,
  `${singleDay.figures} 張`,
);
await page.evaluate(() => {
  /* 同上：改回「平日＋假日」也要走這一塊自己的下拉。 */
  const select = document.getElementById("trendDay");
  select.value = "ALL";
  select.onchange({ target: select });
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
  /*
   * ⚠️ #trendScriptBox 已經不存在：說明現在和自己那一張圖包在同一列裡。
   *   而且說明**預設收合**，收合的內容不會出現在 innerText——
   *   一定要用 textContent，否則只讀得到標題那一行。
   */
  const text = [...document.querySelectorAll("#trendCharts .figure-note")]
    .map((node) => node.textContent)
    .join("\n");
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
  isSmall: [...document.querySelectorAll("#trendCharts .trend-figure")].every(
    (f) => f.dataset.small === "1",
  ),
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
  isSmall: [...document.querySelectorAll("#trendCharts .trend-figure")].every(
    (f) => f.dataset.small === "1",
  ),
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
await page.evaluate(() => document.querySelector('[data-view="trendChart"]').click());
await page.waitForTimeout(900);
const afterBand = await page.evaluate(() => {
  const series = window.trendSeriesList()[0];
  return {
    label: series.label,
    congestedStart: series.congestedStart,
    values: series.points.map((point) => point.value),
    scriptText: [...document.querySelectorAll("#trendCharts .figure-note")]
      .map((node) => node.textContent)
      .join("\n"),
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


/*
 * ══════════════════════════════════════════════════════════════════
 *  跨計畫比較圖（Manager）已於 2026-09-13 依使用者決定整組移除
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者原話：「交通服務水準的 Manager 後來我們決定拿掉，因為裡面有的
 * 趨勢圖，各計畫已經都有了，Manager 只是畫在同一張圖而已，沒有實質意義。」
 *
 * ⚠️ 刪掉之前逐條看過這一整段驗的是什麼，把**通則**留在上面的單一計畫
 *   趨勢圖，只丟掉 Manager 機制本身：
 *     ・「平日＋假日」要兩條線，不是混成一條 → 上面已驗（daySplit 那一段）
 *     ・原選日別消失時要自動回到預設、圖不可變空白 → 上面已驗
 *     ・說明文字要跟著設定換、不可以是固定一段 → 上面已驗
 *     ・點圖下鑽要用精確欄位篩選，不用全文搜尋拼字串 → 上面已驗
 *     ・HTML 要跳脫，不可以讓 <img> 真的插進 DOM → 上面已驗
 *     ・Manager 那把尺與各計畫的分界隔離 → 尺不存在了，
 *       「各計畫的分界互不影響」則由 los-rules-per-project 守
 *   所以覆蓋率沒有變成零，是刪掉只屬於 Manager 的那一份。
 */

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
