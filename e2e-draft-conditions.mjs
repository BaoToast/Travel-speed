/*
 * ══════════════════════════════════════════════════════════════════════
 *  兩個草稿產生器：條件要齊、數字要對、小數位數要跟著走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「請確認結論草稿產生器及報表草稿產生器，目前可供出題的篩選條件，
 *     因為有新增圖表及主工具列，請確認三份程式的主工具列的篩選條件
 *     及各圖表各自的篩選條件，都有在結論草稿產生器及報表草稿產生器的
 *     篩選條件中，這樣使用者才能自定義出題。
 *     針對不適用某些篩選條件的結果，在產生草稿時，可以直接說
 *     **該數值不適用 XXX 條件**。
 *     草稿的數值正確性、小數點位設定（曾踩過的雷）都要確保正確。」
 *
 * ── 這一支守什麼 ────────────────────────────────────────────────
 *
 * ① **數值正確性**：結論草稿的「三段分法佔比」與「三段分法」那張圖
 *    **逐格相同**（條數與百分比都比）。草稿自己另算一套口徑是最難查的錯——
 *    兩邊的數字各自看都很合理，只有並排才看得出來。
 * ② **條件真的生效**：換了條件，數字要跟著換。只驗「下拉列得出選項」是假綠。
 * ③ **不適用要寫出來**：設了對某個數值不適用的條件時，草稿要**明講**，
 *    不可以安靜忽略。
 * ④ **小數位數**：0／1／2 都要真的變，而且**百分比也要跟著變**——
 *    三支系統都踩過同一個雷：位數改了，只有前面的數值變，百分比仍寫死 1 位。
 * ⑤ **報告文字草稿**：新增的方向／尖峰條件真的篩到資料，而且條件本身
 *    要寫進草稿（那段文字會被複製進正式報告，報告上看不到畫面）。
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
    acceptDownloads: true,
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "DRAFTCOND");
await page.fill("#projectName", "草稿條件守門");
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

const goto = async (view) => {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view);
  await page.waitForTimeout(900);
};

/* ══ 一、三段分法佔比：草稿與圖逐格相同 ═══════════════════════ */
console.log("\n══ 一、結論草稿的「三段分法佔比」要與圖上逐格相同 ══");
/* X-62：三段分法佔比在「三段分法」那一個大分頁。 */
await goto("bandChart");
await page.waitForTimeout(1200);
/*
 * 圖上的權威數字＝柱子自己的 <title>：「115Q1　壅塞：3 條（60.0%）」。
 * ⚠️ 不可以改掃 <text>：那會掃到縱軸的固定刻度（100%／75%／50%／25%），
 *   換哪一把尺都一樣，於是「對不對得上」永遠是「對得上」——整段假綠。
 */
const chartCells = await page.evaluate(() =>
  [...document.querySelectorAll("#bandCharts svg rect title")]
    .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
    .map((text) => {
      const match = text.match(/^(\S+)\s*(順暢|尚可|壅塞)：(\d+)\s*條（([\d.]+)%）$/);
      return match
        ? {
            period: match[1],
            band: match[2],
            count: Number(match[3]),
            share: match[4],
          }
        : null;
    })
    .filter(Boolean),
);
ok(
  "前置：三段分法圖上量得到柱子的數字（0 個的話下面全部恆真）",
  chartCells.length > 0,
  `${chartCells.length} 格`,
);

await goto("conclusion");
/* 只勾「三段分法佔比」，其餘指標取消——草稿才好比對。 */
const bandMetricIndex = await page.evaluate(() => {
  const labels = [...document.querySelectorAll("#conclusionMetrics label")];
  return labels.findIndex((label) => (label.textContent || "").includes("三段分法佔比"));
});
ok(
  "⚠️ 結論草稿的「要寫哪些數字」裡有「三段分法佔比」這一項（圖上算得出來的數字，草稿也要寫得出來）",
  bandMetricIndex >= 0,
  `index=${bandMetricIndex}`,
);
/*
 * ⚠️ 一次只點一顆，點完等重畫。
 *   每點一下 renderConclusion() 就會把整個 #conclusionMetrics 的 innerHTML
 *   重建一次，先抓好的那一串 input 參考在第一次點擊之後就全部作廢了——
 *   用同一串跑迴圈的話，後面那幾下等於沒點。
 *  （和「一次刪多筆覆寫卻只刪掉一條」是同一個坑。）
 */
if (bandMetricIndex >= 0) {
  const metricCount = await page.evaluate(
    () => document.querySelectorAll("#conclusionMetrics input").length,
  );
  for (let index = 0; index < metricCount; index += 1) {
    const changed = await page.evaluate(
      ([at, wanted]) => {
        const inputs = [...document.querySelectorAll("#conclusionMetrics input")];
        const input = inputs[at];
        if (!input) return false;
        const shouldCheck = at === wanted;
        if (input.checked === shouldCheck) return false;
        input.click();
        return true;
      },
      [index, bandMetricIndex],
    );
    if (changed) await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
  const onlyBand = await page.evaluate(
    () =>
      [...document.querySelectorAll("#conclusionMetrics input")]
        .map((input, index) => (input.checked ? index : -1))
        .filter((index) => index >= 0),
  );
  ok(
    "前置：只勾了「三段分法佔比」這一項（勾錯的話下面比對的是別的東西）",
    onlyBand.length === 1 && onlyBand[0] === bandMetricIndex,
    `勾選的 index：${onlyBand.join("、")}；目標 ${bandMetricIndex}`,
  );
}
await page.click("#conclusionRegenerate");
await page.waitForTimeout(1200);
const draftText = await page.evaluate(
  () => document.getElementById("conclusionDraft")?.value || "",
);
const draftCells = [...draftText.matchAll(/(順暢|尚可|壅塞)\s(\d+)\s筆（([\d.]+)%）/g)].map(
  (match) => ({ band: match[1], count: Number(match[2]), share: match[3] }),
);
ok(
  "前置：草稿裡量得到三段分法的數字（0 個的話下面恆真）",
  draftCells.length > 0,
  `${draftCells.length} 格`,
);
/*
 * ⚠️ 比的是**多重集合**（每一格的「段別＋條數＋百分比」），不是逐字比字串。
 *   圖上寫「條」、草稿寫「筆」，措辭本來就不同；要對的是**數字**。
 *   草稿會把 0% 的那一段也寫出來（圖上 0 高度的柱子不畫），
 *   所以比對前先把 0 的那幾格拿掉——只比兩邊都會出現的格子。
 */
const keyOf = (cell) => `${cell.band}|${cell.count}|${cell.share}`;
const sortJoin = (list) => list.map(keyOf).sort().join("　");
const chartKeys = sortJoin(chartCells.filter((cell) => cell.count > 0));
const draftKeys = sortJoin(draftCells.filter((cell) => cell.count > 0));
ok(
  "⚠️ ① 草稿的三段分法佔比與圖上**逐格相同**（條數與百分比都要對）",
  chartKeys === draftKeys && chartKeys.length > 0,
  `圖：${chartKeys.slice(0, 120)}｜草稿：${draftKeys.slice(0, 120)}`,
);

/* ══ 二、小數位數：百分比也要跟著變 ═══════════════════════════ */
console.log("\n══ 二、小數位數（含百分比）══");
const draftWithDigits = async (value) => {
  await page.selectOption("#conclusionDigits", value);
  await page.waitForTimeout(400);
  await page.click("#conclusionRegenerate");
  await page.waitForTimeout(900);
  return page.evaluate(() => document.getElementById("conclusionDraft")?.value || "");
};
const d0 = await draftWithDigits("0");
const d2 = await draftWithDigits("2");
const pctDigitsIn = (text) => {
  const hits = [...text.matchAll(/（(\d+)(?:\.(\d+))?%）/g)];
  return [...new Set(hits.map((m) => (m[2] || "").length))].sort();
};
ok(
  "⚠️ ④ 小數位數選 0 位時，**百分比**也是 0 位（三支都踩過：只有數值變、百分比寫死 1 位）",
  pctDigitsIn(d0).length > 0 && pctDigitsIn(d0).every((n) => n === 0),
  `百分比的小數位：${pctDigitsIn(d0).join("／") || "（量不到百分比）"}`,
);
ok(
  "⚠️ ④ 小數位數選 2 位時，百分比也是 2 位",
  pctDigitsIn(d2).length > 0 && pctDigitsIn(d2).every((n) => n === 2),
  `百分比的小數位：${pctDigitsIn(d2).join("／") || "（量不到百分比）"}`,
);
await page.selectOption("#conclusionDigits", "1");
await page.waitForTimeout(300);

/* ══ 三、不適用要寫出來 ═══════════════════════════════════════ */
console.log("\n══ 三、不適用的條件要寫出來 ══");
/* 勾「速限與速限比」，並且把尖峰篩成一種——速限不隨尖峰改變，草稿要講。 */
await page.evaluate(() => {
  const labels = [...document.querySelectorAll("#conclusionMetrics label")];
  const index = labels.findIndex((label) => (label.textContent || "").includes("速限"));
  const inputs = [...document.querySelectorAll("#conclusionMetrics input")];
  if (index >= 0 && !inputs[index].checked) inputs[index].click();
});
await page.waitForTimeout(500);
const peakChecked = await page.evaluate(() => {
  const input = document.querySelector("#conclusionPeaks input");
  if (!input) return "";
  if (!input.checked) input.click();
  return (input.closest("label")?.textContent || "").trim();
});
await page.waitForTimeout(700);
await page.click("#conclusionRegenerate");
await page.waitForTimeout(1000);
const notedDraft = await page.evaluate(
  () => document.getElementById("conclusionDraft")?.value || "",
);
ok(
  "前置：真的篩了一種尖峰（沒篩的話下一條恆真）",
  Boolean(peakChecked),
  peakChecked || "（沒有尖峰可勾）",
);
ok(
  "⚠️ ③ 草稿裡要**明講**「本數值不適用〈尖峰〉條件」（速限不隨尖峰改變）",
  /不適用「尖峰」/.test(notedDraft),
  (notedDraft.match(/.{0,20}不適用.{0,60}/) || ["（一句都沒寫）"])[0],
);
/* 反面：把尖峰取消之後，那一句**不可以**還留著（沒設的條件寫一堆只是噪音）。 */
await page.evaluate(() => {
  const input = document.querySelector("#conclusionPeaks input");
  if (input && input.checked) input.click();
});
await page.waitForTimeout(700);
await page.click("#conclusionRegenerate");
await page.waitForTimeout(1000);
const quietDraft = await page.evaluate(
  () => document.getElementById("conclusionDraft")?.value || "",
);
ok(
  "⚠️ ③ 沒有設那個條件時，那一句**不可以**出現（只寫真的有設的）",
  !/不適用「尖峰」/.test(quietDraft),
  (quietDraft.match(/.{0,20}不適用.{0,60}/) || ["沒有多餘的句子"])[0],
);

/* ══ 四、報告文字草稿：方向與尖峰條件 ═════════════════════════ */
console.log("\n══ 四、報告文字草稿的方向／尖峰／小數位數 ══");
await goto("delivery");
const hasControls = await page.evaluate(() => ({
  direction: Boolean(document.getElementById("deliveryDirection")),
  peak: Boolean(document.getElementById("deliveryPeak")),
  digits: Boolean(document.getElementById("deliveryDigits")),
}));
ok(
  "⚠️ ⑤ 報告文字草稿有「方向」「尖峰」「小數位數」三個條件（主工具列有的，這裡也要有）",
  hasControls.direction && hasControls.peak && hasControls.digits,
  JSON.stringify(hasControls),
);
const reportText = () =>
  page.evaluate(() => document.getElementById("reportDraft")?.value || "");
await page.click("#generateDraft");
await page.waitForTimeout(900);
const allDirections = await reportText();
await page.selectOption("#deliveryDirection", "方向1");
await page.waitForTimeout(600);
await page.click("#generateDraft");
await page.waitForTimeout(900);
const oneDirection = await reportText();
ok(
  "⚠️ ② 換了方向之後，草稿的內容**真的變了**（只加下拉不接資料是假功能）",
  allDirections.length > 0 && oneDirection.length > 0 && oneDirection !== allDirections,
  oneDirection === allDirections ? "兩份一模一樣" : "內容有變",
);
ok(
  "⚠️ ⑤ 草稿裡要寫出**目前的統計條件**（這段文字會被貼進報告，報告上看不到畫面）",
  /統計條件：/.test(oneDirection) && /方向1/.test(oneDirection),
  (oneDirection.match(/統計條件：.{0,80}/) || ["（沒有寫）"])[0],
);
/*
 * ⚠️ 最重要的一條：篩了方向之後，草稿引用的旅行速率必須**來自方向1 的資料**。
 *   舊版拿的是「從全部四筆挑最差」的既有代表紀錄，於是畫面上寫著方向1、
 *   數字卻可能是方向2 的——而那份文字會被複製進正式報告。
 */
const direction1Travels = await page.evaluate(() => {
  const rows = state.details.filter(
    (row) => row.projectCode === state.activeCode && row.direction === "方向1",
  );
  return [...new Set(rows.map((row) => Number(row.travel).toFixed(1)))];
});
const quotedTravels = [...oneDirection.matchAll(/旅行速率\s([\d,.]+)\sk?m?\/?h?/g)]
  .map((match) => match[1].replace(/,/g, ""))
  .filter((value) => /\d/.test(value));
const strayTravels = quotedTravels.filter(
  (value) => !direction1Travels.includes(Number(value).toFixed(1)),
);
/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 草稿宣告「引用了速限與速限比」，就必須真的寫出來
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-23 的反向對帳抓到：設了尖峰或日別時，草稿會加上那句
 * 「…因此下列各行引用的速限與速限比不受這兩項影響」，
 * 但下面每一行從頭到尾**沒有速限、也沒有速限比**。
 * 看報告的人讀到那句話就去下面找，找不到——或更糟，直接相信「有引用」。
 *
 * 同一輪也補齊了同包 CSV 有、而這一份缺的欄位：行駛速率、延滯分項、方向起訖。
 * 那份 CSV 與這份文字草稿**裝在同一個 ZIP 裡**交出去，兩邊說不同的話最難發現。
 *
 * ⚠️ 判定要用「數字＋單位」的形狀，不可以只找「速限」兩個字——
 *   上面那句宣告本身就含「速限」，只找字的話這一條會恆真。
 */
ok(
  "⚠️ 草稿每一行都要寫出速限（數字＋km/h），不是只在宣告裡提到",
  /速限 [\d.]+ km\/h/.test(oneDirection),
  (oneDirection.match(/速限 [^；。]{0,24}/) || ["（沒有寫）"])[0],
);
ok(
  "⚠️ 速限比要寫成「比值（百分比）」——彙總表是 0.782、判定門檻是 ≧0.90，只寫百分比對不起來",
  /速限比 [\d.]+（[\d.]+%）/.test(oneDirection),
  (oneDirection.match(/速限比 [^；。]{0,24}/) || ["（沒有寫）"])[0],
);
ok(
  "⚠️ 行駛速率要寫出來（同包 CSV 有這一欄，交付方會拿它算停等損失）",
  /行駛速率 [\d.]+ km\/h/.test(oneDirection),
  (oneDirection.match(/行駛速率 [^；。]{0,20}/) || ["（沒有寫）"])[0],
);
ok(
  "⚠️ 延滯分項（路段／交叉口）要寫出來",
  /路段延滯 [^；。]*交叉口延滯 [\d.]+ 秒/.test(oneDirection),
  (oneDirection.match(/路段延滯 [^；。]{0,40}/) || ["（沒有寫）"])[0],
);

ok(
  "前置：草稿裡引用得到旅行速率（0 個的話下一條恆真）",
  quotedTravels.length > 0,
  `${quotedTravels.length} 個`,
);
ok(
  "⚠️ ① 篩了方向1 之後，草稿引用的旅行速率**全部來自方向1 的資料**",
  quotedTravels.length > 0 && strayTravels.length === 0,
  strayTravels.slice(0, 4).join("、") || "全部對得上",
);
/* 小數位數 */
await page.selectOption("#deliveryDigits", "2");
await page.waitForTimeout(500);
await page.click("#generateDraft");
await page.waitForTimeout(900);
const twoDigits = await reportText();
const travelDigits = (text) =>
  [
    ...new Set(
      [...text.matchAll(/旅行速率\s[\d,]+\.(\d+)\skm\/h/g)].map((m) => m[1].length),
    ),
  ].sort();
const pctDigits = (text) =>
  [
    ...new Set(
      [...text.matchAll(/(?:增加|下降)\s\d+(?:\.(\d+))?%/g)].map((m) => (m[1] || "").length),
    ),
  ].sort();
ok(
  "⚠️ ④ 報告文字草稿的小數位數真的生效（數值）",
  travelDigits(twoDigits).length > 0 && travelDigits(twoDigits).every((n) => n === 2),
  `旅行速率的小數位：${travelDigits(twoDigits).join("／") || "（量不到）"}`,
);
ok(
  "⚠️ ④ 報告文字草稿的**百分比**也跟著小數位數走（踩過的雷：百分比寫死 1 位）",
  pctDigits(twoDigits).length === 0 ||
    pctDigits(twoDigits).every((n) => n === 2),
  `變動幅度的小數位：${pctDigits(twoDigits).join("／") || "（這批資料沒有可比較的前期）"}`,
);

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ ⑥ 存過草稿之後只改小數位數、**不按「重新產生」**（2026-09-25 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 上面 ④ 在改位數之後按了 #generateDraft，所以走的是「明確要求重新產生」那條路，
 * 永遠踩不到真正的缺陷：
 *
 *   loadDraft() 是 `value = saved || narrative()`，而 digits **不在 draftKey() 裡**。
 *   只要使用者按過一次「儲存修改」，saved 就存在，之後改位數一律貼回
 *   **舊位數算出來的那一份**——而「下載季度成果包 ZIP」裡的
 *   *_報告文字草稿.txt 寫的正是文字框內容。
 *   方向與尖峰之所以正常，是因為它們會改變 draftKey()。
 *
 * 所以這一段刻意**不按重新產生**，只動位數，看文字框自己會不會跟著變。
 */
await page.selectOption("#deliveryDigits", "1");
await page.waitForTimeout(500);
await page.click("#generateDraft");
await page.waitForTimeout(900);
await page.click("#saveDraft");            /* ← 關鍵：先存起來，讓 saved 存在 */
await page.waitForTimeout(700);
const savedOneDigit = await reportText();
ok(
  "前置：1 位的草稿存得起來，而且真的是 1 位（0 個的話下一條恆真）",
  travelDigits(savedOneDigit).length > 0 &&
    travelDigits(savedOneDigit).every((n) => n === 1),
  `旅行速率的小數位：${travelDigits(savedOneDigit).join("／") || "（量不到）"}`,
);
await page.selectOption("#deliveryDigits", "2");
await page.waitForTimeout(900);            /* 不按「重新產生」 */
const afterDigitsOnly = await reportText();
ok(
  "⚠️ ⑥ 存過草稿之後只改小數位數（沒按重新產生），文字框要跟著變成 2 位",
  travelDigits(afterDigitsOnly).length > 0 &&
    travelDigits(afterDigitsOnly).every((n) => n === 2),
  `旅行速率的小數位：${travelDigits(afterDigitsOnly).join("／") || "（量不到）"}` +
    `｜與 1 位那一份是否相同：${afterDigitsOnly === savedOneDigit ? "相同（＝沒重算）" : "不同"}`,
);
ok(
  "⚠️ ⑥ 而且內容真的換過了，不是同一份文字",
  afterDigitsOnly !== savedOneDigit,
  afterDigitsOnly === savedOneDigit ? "兩份完全相同＝位數沒有作用" : "已重算",
);

/* ══ 五、報告文字草稿：每一個交付條件都要真的生效 ═══════════════ */
/*
 * 使用者 2026-09-23：
 *   「只要程式查的到的數值，結論草稿產生器應該都能讓使用者勾選對應條件後，
 *     產出正確的數值」「報表草稿產生器，功能正常運作等同於數值正確性一樣重要」
 *
 * ⚠️ 為什麼這一段走 E2E 而不是抽成純函式做覆蓋盤點：
 *   `narrative()` 直接讀 DOM（`q("deliveryRoad").value` 這一類），
 *   把它抽成純函式是一次會動到報告文字產生邏輯的重構——**風險大於收益**，
 *   而且 bug 最可能出現的地方正是「DOM 值有沒有被讀進來」，
 *   抽出來反而測不到那一段。所以改成**從真正的畫面**掃每一個條件。
 *
 * ⚠️ 每一個維度都驗三件事，缺一不可：
 *   ① 設了之後草稿**真的變了**（只加下拉不接資料是假功能）
 *   ② 條件本身**寫進草稿**（那段文字會被貼進報告，報告上看不到畫面）
 *   ③ 草稿引用的數字**只來自符合條件的那幾筆**（最重要的一條）
 */
console.log("\n══ 五、報告文字草稿：逐一掃過每一個交付條件 ══");
await goto("delivery");

/** 把所有交付條件清成「全部」，取得基準草稿。 */
async function resetDelivery() {
  for (const [id, value] of [
    ["deliveryRoad", ""],
    ["deliveryDay", ""],
    ["deliveryDirection", ""],
    ["deliveryPeak", ""],
  ])
    await page.selectOption(`#${id}`, value).catch(() => {});
  await page.waitForTimeout(400);
  await page.click("#generateDraft");
  await page.waitForTimeout(800);
  return reportText();
}

const baseDraft = await resetDelivery();
ok(
  "前置：基準草稿產得出來（產不出來的話下面全部恆真）",
  baseDraft.length > 80,
  `${baseDraft.length} 字`,
);

/** 這個下拉的第一個「不是全部」的選項值。 */
const firstRealOption = (id) =>
  page.evaluate((elementId) => {
    const select = document.getElementById(elementId);
    if (!select) return null;
    for (const option of select.options)
      if (option.value) return option.value;
    return null;
  }, id);

for (const [id, label, rowField] of [
  ["deliveryRoad", "路段", "road"],
  ["deliveryDay", "日別", "day"],
  ["deliveryDirection", "方向", "direction"],
  ["deliveryPeak", "尖峰", "peak"],
]) {
  const value = await firstRealOption(id);
  ok(`前置：「${label}」下拉有可以選的值`, Boolean(value), String(value));
  if (!value) continue;
  await resetDelivery();
  await page.selectOption(`#${id}`, value);
  await page.waitForTimeout(400);
  await page.click("#generateDraft");
  await page.waitForTimeout(800);
  const filtered = await reportText();
  ok(
    `⚠️ 設了「${label}＝${value}」之後，草稿內容真的變了`,
    filtered.length > 0 && filtered !== baseDraft,
    filtered === baseDraft ? "兩份一模一樣——條件沒有接上資料" : "內容有變",
  );
  ok(
    `⚠️ 草稿的「統計條件：」那一行寫出了「${value}」`,
    /統計條件：/.test(filtered) && filtered.includes(value),
    (filtered.match(/統計條件：.{0,100}/) || ["（沒有寫）"])[0],
  );
  /*
   * ③ 最重要的一條：草稿引用的旅行速率必須**只來自符合這個條件的那幾筆**。
   *   舊版曾經「畫面上寫著方向1、數字卻可能是方向2 的」——
   *   那份文字會被複製進正式報告。
   */
  const allowed = await page.evaluate(
    ({ field, wanted }) => {
      const rows = state.details.filter(
        (row) => row.projectCode === state.activeCode && row[field] === wanted,
      );
      return [...new Set(rows.map((row) => Number(row.travel).toFixed(1)))];
    },
    { field: rowField, wanted: value },
  );
  const quoted = [...filtered.matchAll(/旅行速率\s([\d,.]+)\s?k?m?\/?h?/g)]
    .map((match) => match[1].replace(/,/g, ""))
    .filter((text) => /\d/.test(text));
  const stray = quoted.filter(
    (text) => !allowed.includes(Number(text).toFixed(1)),
  );
  ok(
    `前置：「${label}」的草稿裡引用得到旅行速率（0 個的話下一條恆真）`,
    quoted.length > 0,
    `${quoted.length} 個`,
  );
  ok(
    `⚠️ 設了「${label}＝${value}」之後，草稿引用的旅行速率全部來自符合條件的資料`,
    quoted.length > 0 && stray.length === 0,
    stray.slice(0, 4).join("、") || "全部對得上",
  );
}

/* 季度區間：起訖各設一次，內容要跟著變。 */
const periods = await page.evaluate(() =>
  [...(document.getElementById("deliveryPeriodStart")?.options || [])].map(
    (option) => option.value,
  ),
);
if (periods.length > 1) {
  await resetDelivery();
  await page.selectOption("#deliveryPeriodStart", periods[0]);
  await page.selectOption("#deliveryPeriodEnd", periods[0]);
  await page.waitForTimeout(400);
  await page.click("#generateDraft");
  await page.waitForTimeout(800);
  const single = await reportText();
  await page.selectOption("#deliveryPeriodStart", periods[0]);
  await page.selectOption("#deliveryPeriodEnd", periods.at(-1));
  await page.waitForTimeout(400);
  await page.click("#generateDraft");
  await page.waitForTimeout(800);
  const ranged = await reportText();
  ok(
    "⚠️ 季度區間真的生效（單季與整段寫出來的字不一樣）",
    single !== ranged,
    single === ranged ? "兩份一模一樣" : "內容有變",
  );
} else {
  ok(
    "季度區間：這批測資只有一個季度，無法驗（不是通過，是沒得驗）",
    true,
    `季度數 ${periods.length}`,
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log(
  "\n✅ 兩個草稿產生器：條件齊備、數字與圖逐格相同、不適用有寫出來、小數位數（含百分比）都生效",
);
