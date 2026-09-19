/*
 * ══════════════════════════════════════════════════════════════════════
 *  LOS 圖表頁的四件事 ＋ 來源追溯不在畫面上
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14（附四張圖）：
 *   1.「來源追溯右側表單可以**預設收合**……如果使用者要看，
 *      **點小分頁『來源追溯』時，就自動展開**」
 *      → 2026-09-16 使用者改為「使用者用不到這資訊……把這畫面放在程式碼
 *        給你看就好」，所以第一節改成守「畫面上沒有、但來源欄位還在」。
 *   2.「歷季趨勢（可勾選指標）**離上一個方框太近了**，請拉開間距，
 *      如同下方 三段分法 的間距」
 *   3.「主標題應該為 **LOS圖表** 而不是 LOS歷季趨勢，右側的『匯出可編輯LOS Excel圖表』
 *      ……該匯出按鍵應該做在**與各路段LOS同一區塊**的位置，而不是放在主標題旁邊，
 *      **放主標題旁邊會以為可以下載所有檔案**。」
 *   4.「三段分法的圖可以增加自己的工具列……篩選季度、日別……
 *      我在想應該**不需要路段篩選**」
 *
 * ⚠️ 第 4 點使用者的判斷是對的，而且這一支要**反過來守住它**：
 *   這張圖的分母是「該季判定得出等級的路段數」，篩成單一路段之後分母是 1，
 *   比例只可能是 0% 或 100%。所以「不可以有路段篩選」是一條正式的守門，
 *   哪天有人「順手補齊」就會紅。
 *
 * ⚠️ 篩選之後**右側那段講稿也要跟著變**——只驗圖變了不夠，
 *   被抄進報告的是文字。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

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
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "CHARTPAGE");
await page.fill("#projectName", "圖表頁守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(500);

async function importQuarter(quarterIndex) {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
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
/* ⚠️ 三季：少於三季的話「篩掉一季圖會變」驗不到。 */
await importQuarter(0);
await importQuarter(1);
await importQuarter(2);

/* ══ 一、來源追溯**不可以**出現在畫面上（2026-09-16 改） ══
 *
 * 使用者 2026-09-16：「來源追朔功能，使用者用不到這資訊……請你把這畫面
 *   放在程式碼給你看就好……讓程式看起來簡潔些」。
 *
 * ⚠️ 這一節原本守的是「預設收合／點小分頁自動展開」。整塊移出畫面之後
 *   那些條件不成立了，但**不可以整節刪掉**：要反過來守住
 *   「畫面上沒有、但資料還在」——只驗前者的話，哪天有人把來源欄位
 *   一起砍掉（`*_來源追溯.json` 變空）也照樣全綠。
 */
await page.evaluate(() => document.querySelector('[data-view="summary"]').click());
await page.waitForTimeout(900);
ok(
  "① 畫面上沒有「來源追溯」那一塊",
  (await page.locator("#summary-trace").count()) === 0 &&
    (await page.locator("#traceRows").count()) === 0,
);
ok(
  "① 側欄也不再列出「來源追溯」小分頁",
  (await page.locator('.nav-section[data-anchor="summary-trace"]').count()) === 0 &&
    (await page.locator('.nav-section:has-text("來源追溯")').count()) === 0,
);
/* ⚠️ 關鍵：畫面拿掉了，**來源欄位本身必須還在每一筆資料上**。 */
const traceFields = await page.evaluate(() => {
  const rows = (typeof state !== "undefined" && state.details) || [];
  const withSource = rows.filter((x) => x && (x.sourceFile || x.source));
  return { total: rows.length, withSource: withSource.length };
});
ok(
  "⚠️ ① 來源欄位仍然寫在每一筆資料上（拿掉的只有畫面，不是追溯能力）",
  traceFields.total > 0 && traceFields.withSource === traceFields.total,
  `${traceFields.withSource}／${traceFields.total} 筆有來源檔名`,
);

/* ══ 二、X-62：四張圖各自一頁，每一頁只有自己那一塊 ══ */
/*
 * ⚠️ 這一節原本量的是「#charts 底下四塊之間的間距一致」。
 *   X-62（使用者 2026-09-17）把四張圖拆成四個大分頁之後，
 *   一頁只剩一塊，**沒有「塊與塊之間」可以量了**——
 *   使用者當初抱怨的「歷季趨勢離上一個方框太近」在結構上已經不存在。
 *
 *   所以這一節改成守拆開之後真正要守的事：
 *     ① 每一頁上**只有自己那一塊**（別頁的區塊不可以出現）
 *     ② 每一頁都**不可以**再長出頁面標題那一層（標題疊標題，見下一節）
 *   ⚠️ ① 一定要驗，否則「四個分頁其實共用同一個畫面」也會全綠——
 *     而那正是這次要修掉的狀態。
 */
const CHART_PAGES = [
  ["losChart", "losChartSection"],
  ["speedTrend", "speedTrendSection"],
  ["trendChart", "trendPanel"],
  ["bandChart", "bandPanel"],
];
const gotoChart = async (view) => {
  await page.evaluate(
    (id) => document.querySelector(`[data-view="${id}"]`)?.click(),
    view,
  );
  await page.waitForTimeout(1200);
};
for (const [view, mine] of CHART_PAGES) {
  await gotoChart(view);
  const others = CHART_PAGES.filter((entry) => entry[0] !== view).map((e) => e[1]);
  const strays = await page.evaluate(
    ({ view, ids }) =>
      ids.filter((id) => document.getElementById(id)?.closest(".view")?.id === view),
    { view, ids: others },
  );
  ok(
    `② 「${view}」這一頁上沒有別張圖的區塊`,
    strays.length === 0,
    strays.join("、"),
  );
  ok(
    `② 而且自己那一塊（#${mine}）真的在這一頁上`,
    (await page.evaluate(
      (id) => document.getElementById(id)?.closest(".view")?.id || "",
      mine,
    )) === view,
  );
  ok(
    `② 「${view}」不可以再有頁面標題那一層（會和區塊標題疊成兩層）`,
    (await page.locator(`#${view} > .title`).count()) === 0,
  );
}
await gotoChart("losChart");

/* ══ 三、區塊標題與匯出鈕的位置 ══ */
/*
 * ⚠️ 這一頁**不可以**再有頁面標題那一塊。
 *
 *   2026-09-13 補上「各路段 LOS 圖」的區塊標題之後，這一頁就變成
 *   全站唯一「標題疊標題」的頁：
 *     ① VISUAL CENTER／LOS 圖表／各路段 LOS、歷季旅行速率…
 *     ② LEVEL OF SERVICE／各路段 LOS 圖／每路段一張圖…
 *   ①講的內容②③④又各自再講一次。使用者 2026-09-14（附圖）：
 *   「紅框的標題和說明看起來很突兀，拿掉好了……但其他分頁沒有這個問題」。
 *
 * ⚠️ 這一條和下一條要**成對**：只驗「①不見了」的話，把②也一起刪掉照樣全綠，
 *   而那才是使用者 2026-09-13 抱怨過的「各路段LOS圖標題文字消失了」。
 */
ok(
  "③ 圖表頁**不可以**有頁面標題那一塊（會和「各路段 LOS 圖」疊成兩層標題）",
  (await page.locator("#charts > .title").count()) === 0,
  `目前 ${await page.locator("#charts > .title").count()} 塊`,
);
const heading = await page
  .locator("#losChartTitle h2")
  .first()
  .innerText()
  .then((t) => t.trim());
ok("③ 區塊標題還在，而且是「各路段 LOS 圖」", heading === "各路段 LOS 圖", heading);
ok(
  "③ 匯出鈕在「各路段 LOS 圖」那一塊的標頭裡",
  (await page.locator("#losChartTitle #exportProjectLos").count()) === 1,
);
/* ⚠️ X-62：旅行速率那一塊在自己的大分頁上，要先切過去才量得到。 */
await gotoChart("speedTrend");
ok(
  "③ 而且擺法與「各路段歷季旅行速率」那一塊一致（同樣在 .title 裡）",
  (await page.locator(".speed-chart-title #exportProjectCharts").count()) === 1,
);

/* ══ 四、三段分法自己的工具列 ══ */
/* ⚠️ X-62：三段分法是自己一個大分頁，量位置與 innerText 前要先切過去。 */
await gotoChart("bandChart");
ok("④ 三段分法有起始季度選單", (await page.locator("#bandStart").count()) === 1);
ok("④ 三段分法有結束季度選單", (await page.locator("#bandEnd").count()) === 1);
ok("④ 三段分法有日別選單", (await page.locator("#bandDay").count()) === 1);
/*
 * ⚠️ 反面：**不可以**有路段篩選。使用者的理由是對的（分母會變成 1），
 *   所以這一條要正式守住，哪天有人「順手補齊」就會紅。
 */
ok(
  "④ 三段分法**不可以**有路段篩選（分母會變成 1，圖就沒有意義了）",
  (await page.locator("#bandPanel select").evaluateAll((nodes) =>
    nodes.every((node) => !/road|路段/i.test(node.id)),
  )) === true,
);

const bandSnapshot = () =>
  page.evaluate(() => ({
    bars: document.querySelectorAll("#bandCharts .trend-figure svg rect").length,
    text: (document.querySelector("#bandCharts .figure-note")?.innerText || "")
      .replace(/\s+/g, " ")
      .trim(),
    note: (document.getElementById("bandScopeNote")?.textContent || "").trim(),
  }));
const before = await bandSnapshot();
ok("前置：三段分法真的畫出圖與說明", before.bars > 0 && before.text.length > 0, `${before.bars} 個圖元`);

/* 把起始季度改成最後一季 → 只剩一季，圖與文字都要跟著變。 */
const lastPeriod = await page.evaluate(() => {
  const select = document.getElementById("bandStart");
  return select.options[select.options.length - 1].value;
});
await page.selectOption("#bandStart", lastPeriod);
await page.waitForTimeout(800);
const after = await bandSnapshot();
ok(
  "④ 改季度區間之後圖跟著變",
  after.bars !== before.bars,
  `${before.bars} → ${after.bars}`,
);
ok(
  "④ **右側說明文字也跟著變**（圖與文字不可以分岔）",
  after.text !== before.text && after.text.length > 0,
  after.text.slice(0, 80),
);
ok(
  "④ 工具列底下寫得出目前的範圍",
  /目前範圍|沒有資料/.test(after.note),
  after.note.slice(0, 80),
);

/* 日別：切到單一日別，圖的張數要變少。 */
const dayValues = await page.evaluate(() =>
  [...document.getElementById("bandDay").options].map((o) => o.value),
);
if (dayValues.length > 1) {
  await page.selectOption("#bandStart", "ALL");
  await page.waitForTimeout(500);
  const allDays = await page.locator("#bandCharts .trend-figure").count();
  await page.selectOption("#bandDay", dayValues[1]);
  await page.waitForTimeout(700);
  const oneDay = await page.locator("#bandCharts .trend-figure").count();
  ok(
    "④ 切到單一日別之後只剩那一天的圖",
    oneDay < allDays && oneDay > 0,
    `平日＋假日 ${allDays} 張 → ${dayValues[1]} ${oneDay} 張`,
  );
  /*
   * ── ⚠️ 選了一個日別之後，**選項不可以變少** ────────────────────
   *
   * 使用者 2026-09-15：「當我選擇了日別選了平日後，日別的選項變成只剩
   *   『平日＋假日』『平日』共 2 個，我必須先點選一次『平日＋假日』後，
   *   才會還原成 3 個日別選項……這是異常嗎」——**是異常**。
   *
   * 成因：選項是從「已經套過日別篩選」的資料產生的，選了平日之後
   * 資料裡就只剩平日，「假日」這個選項自己消失、再也選不回去。
   *
   * ⚠️ 這一條要量的是**選項數量**，不是圖的張數。只驗圖變少的話，
   *   這個毛病一輩子測不到——圖確實變少了，選項卻回不去。
   */
  const afterPick = await page.evaluate(() =>
    [...document.getElementById("bandDay").options].map((o) => o.value),
  );
  ok(
    "⚠️ ④ 選了單一日別之後，日別選項**不會變少**（選項母體要排除自己這一欄）",
    afterPick.length === dayValues.length,
    `選之前 ${dayValues.length} 個（${dayValues.join("／")}）→ 選之後 ${afterPick.length} 個（${afterPick.join("／")}）`,
  );
  ok(
    "⚠️ ④ 而且另一個日別仍然選得回去（不必先切回「平日＋假日」）",
    afterPick.includes(dayValues[dayValues.length - 1]),
    afterPick.join("／"),
  );
  await page.selectOption("#bandDay", "ALL");
  await page.waitForTimeout(500);
} else {
  ok("④ 前置：測資要有兩種日別才驗得到日別篩選", false, "只有一種日別");
}

/*
 * ══ ④-A、圖上要標出**目前畫的是什麼** ═══════════════════════════
 *
 * 使用者 2026-09-15：「上方工具列的尖峰有調整後，歷季旅行速率趨勢圖
 *   並沒有任何說明出現（例如不受尖峰影響），**還是其實有受尖峰影響，
 *   只是我沒看出來?**」
 *
 * 答案是**有受影響**。所以這裡守的不是「掛一句不適用」——那會讓畫面說謊——
 * 而是「**現在畫的是什麼**要寫出來」，而且**要跟著主工具列變**。
 *
 * ⚠️ 只驗「有沒有這一句」不夠：一句寫死的話照樣全綠。
 *   要驗它**切了尖峰之後真的跟著換字**。
 */
console.log("\n══ ④-A 圖上的口徑標示 ══");
{
  const scopeText = () =>
    page.evaluate(
      () =>
        document.querySelector('[data-testid="chart-scope-note"]')
          ?.textContent || "",
    );
  const before = await scopeText();
  /*
   * ⚠️ 2026-09-16：這一句原本寫「目前這兩張圖畫的是」，使用者篩成一條路段時
   *   畫面上只有一張圖，字面對不上；改成寫出區塊名稱。
   *   守門也一併改成「不可以用數量詞代稱區塊」——只比新字串的話，
   *   哪天有人改回「這兩張圖」照樣綠。
   */
  ok(
    "④-A 兩塊上方有「目前畫的是什麼」",
    before.includes("畫的是"),
    before.replace(/\s+/g, " ").slice(0, 70),
  );
  ok(
    "⚠️ ④-A 這一句**不可以**用「這兩張圖」代稱區塊（張數會隨篩選變）",
    !/[一二三四兩]張圖/.test(before),
    before.replace(/\s+/g, " ").slice(0, 70),
  );
  await page.selectOption('[data-testid="mt-peak"]', "上午尖峰");
  await page.waitForTimeout(800);
  const after = await scopeText();
  ok(
    "⚠️ ④-A 切了主工具列的尖峰之後，這一句**跟著換**（寫死的話這條會紅）",
    after !== before && after.includes("上午尖峰"),
    after.replace(/\s+/g, " ").slice(0, 70),
  );
  ok(
    "④-A 兩張圖**各有一份**（捲到下面那一塊時也看得到）",
    (await page.evaluate(
      () => document.querySelectorAll('[data-testid="chart-scope-note"]').length,
    )) >= 2,
    String(
      await page.evaluate(
        () =>
          document.querySelectorAll('[data-testid="chart-scope-note"]').length,
      ),
    ),
  );
  await page.selectOption('[data-testid="mt-peak"]', "representative");
  await page.waitForTimeout(600);
}

/*
 * ══ ④-B、X 軸的標籤與軸名稱：**看得見、不重疊** ══════════════════
 *
 * 使用者 2026-09-15（附圖）：「路段 LOS 圖，X 軸數字標籤及名稱消失
 *   （原本應該是寫 季別 114Q4 115Q1 115Q2），請注意標籤和名稱不要重疊」
 *   「圖的 X 和 Y 軸名稱和數值記得要有，且數字和名稱不能重疊」
 *
 * 成因是一行 CSS：`.bars{overflow-x:auto}` 讓另一軸自動變成 hidden，
 * 而標籤是 `bottom:-24px` 畫在框線外面的——**整排被裁掉**。
 *
 * ⚠️ 這一段要量**實際的外框**：
 *   ① 標籤的高度 > 0 且**完全落在卡片裡面**（被裁掉的話底邊會超出卡片）
 *   ② 有 X 軸名稱，而且它與標籤**不重疊**
 *   ③ 相鄰標籤之間不重疊
 *   只驗「DOM 裡有沒有這個元素」是沒有用的——被裁掉的元素照樣在 DOM 裡。
 */
console.log("\n══ ④-B X 軸標籤與軸名稱 ══");
/*
 * ⚠️ X-62：這兩張圖已經分屬兩個大分頁，而這一整節量的是**畫面上的外框**。
 *   停在別頁量的話每一個框都是 0×0，於是「看得見」恆假、「不重疊」恆真——
 *   一半紅一半假綠，比整段不跑更難查。所以每一張圖各自先切過去。
 */
for (const [selector, name, view] of [
  ["#chartGrid .chart-card", "各路段 LOS 圖", "losChart"],
  ["#speedTrendGrid .chart-card", "各路段歷季旅行速率", "speedTrend"],
]) {
  await gotoChart(view);
  const axis = await page.evaluate((sel) => {
    const card = document.querySelector(sel);
    if (!card) return null;
    const cardBox = card.getBoundingClientRect();
    const labels = [...card.querySelectorAll(".bar-group small")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent || "").trim(),
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        height: r.height,
      };
    });
    const titleEl = card.querySelector(".bars-x-title");
    const title = titleEl
      ? (() => {
          const r = titleEl.getBoundingClientRect();
          return {
            text: (titleEl.textContent || "").trim(),
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            height: r.height,
          };
        })()
      : null;
    return { cardBottom: cardBox.bottom, labels, title };
  }, selector);
  if (!axis) {
    ok(`④-B ${name}：找得到卡片`, false, "找不到");
    continue;
  }
  ok(
    `④-B 前置：${name}有 X 軸標籤可以量（0 個的話下面全部恆真）`,
    axis.labels.length > 0,
    `${axis.labels.length} 個：${axis.labels.map((l) => l.text).join("／")}`,
  );
  ok(
    `⚠️ ④-B ${name}：X 軸標籤**看得見**（高度 > 0 且沒有被裁到卡片外）`,
    axis.labels.length > 0 &&
      axis.labels.every((l) => l.height > 0 && l.bottom <= axis.cardBottom + 1),
    axis.labels
      .map((l) => `${l.text}(h=${Math.round(l.height)})`)
      .join("、"),
  );
  ok(
    `⚠️ ④-B ${name}：有 X 軸名稱`,
    Boolean(axis.title && axis.title.height > 0),
    axis.title ? axis.title.text : "沒有 .bars-x-title",
  );
  ok(
    `⚠️ ④-B ${name}：軸名稱與標籤**不重疊**`,
    Boolean(
      axis.title &&
        axis.labels.every(
          (l) =>
            !(
              l.left < axis.title.right &&
              axis.title.left < l.right &&
              l.top < axis.title.bottom &&
              axis.title.top < l.bottom
            ),
        ),
    ),
    axis.title
      ? `名稱 ${Math.round(axis.title.top)}～${Math.round(axis.title.bottom)}、標籤底 ${Math.round(Math.max(...axis.labels.map((l) => l.bottom)))}`
      : "沒有軸名稱",
  );
  const hit = [];
  for (let i = 0; i < axis.labels.length; i += 1)
    for (let j = i + 1; j < axis.labels.length; j += 1) {
      const a = axis.labels[i];
      const b = axis.labels[j];
      if (
        a.left < b.right &&
        b.left < a.right &&
        a.top < b.bottom &&
        b.top < a.bottom
      )
        hit.push(`${a.text}↔${b.text}`);
    }
  ok(
    `⚠️ ④-B ${name}：相鄰的 X 軸標籤彼此不重疊`,
    hit.length === 0,
    hit.join("、"),
  );
}

/*
 * ══ 五、LOS 圖的柱頂必須落在自己那一級的刻度上 ══
 *
 * ⚠️ 這一條守的是**圖有沒有說謊**，不是版面。
 *
 *   柱高是 `losRank / 6`（A=6/6 最高、F=1/6 最矮），而刻度一度是把
 *   六個字母**平均分**在軸上（第 i 個放在 i/5）。兩把尺不一樣，
 *   於是 D 的柱頂（離頂 50%）落在 D 這個刻度（離頂 60%）上面一截——
 *   照著軸看，D 會被讀成 B 跟 C 之間。使用者沒有回報，是補上 Y 軸之後
 *   用肉眼看畫面才抓到的：沒有刻度以前，這個錯誤根本無從對照。
 *
 * ⚠️ 要量**畫面上的像素**，不是讀原始碼的比例——兩邊各自算一次的話，
 *   守門會跟著同一個錯誤一起錯。
 */
await gotoChart("losChart");
const losAlign = await page.evaluate(() => {
  const out = [];
  for (const bars of document.querySelectorAll(".los-bars")) {
    const ticks = new Map();
    for (const span of bars.querySelectorAll(".y-axis span")) {
      const rect = span.getBoundingClientRect();
      ticks.set(span.textContent.trim(), rect.top + rect.height / 2);
    }
    for (const bar of bars.querySelectorAll(".bar")) {
      const grade = bar.dataset.los;
      if (!grade || !ticks.has(grade)) continue;
      out.push({
        grade,
        barTop: bar.getBoundingClientRect().top,
        tickMid: ticks.get(grade),
      });
    }
  }
  return out;
});
ok(
  "⑤ 前置：量得到柱子與刻度（量到 0 根就是恆真）",
  losAlign.length >= 3,
  `${losAlign.length} 根`,
);
const drifted = losAlign
  .map((item) => ({ ...item, gap: Math.abs(item.barTop - item.tickMid) }))
  .filter((item) => item.gap > 2);
ok(
  "⑤ 每一根柱子的頂端都落在自己那一級的刻度上",
  drifted.length === 0,
  drifted
    .slice(0, 4)
    .map((item) => `${item.grade} 差 ${item.gap.toFixed(1)}px`)
    .join("、"),
);

/* ⑤-2 匯出的圖檔要和畫面同一張圖（刻度與柱子用同一把尺）。 */
const svgAlign = await page.evaluate(() => {
  const card = document.querySelector("#chartGrid .chart-card[data-chart-model]");
  if (!card) return null;
  const model = JSON.parse(card.dataset.chartModel);
  const holder = document.createElement("div");
  holder.innerHTML = window.chartModelToSvg
    ? window.chartModelToSvg(model)
    : "";
  const svg = holder.querySelector("svg");
  if (!svg) return { unsupported: true };
  const tickY = new Map();
  for (const text of svg.querySelectorAll("text.cc-tick"))
    tickY.set(text.textContent.trim(), Number(text.getAttribute("y")) - 4);
  const out = [];
  const labels = [...svg.querySelectorAll("text.cc-val")];
  const rects = [...svg.querySelectorAll("rect")].filter(
    (r) => r.getAttribute("fill") === "#247db4" || r.getAttribute("fill") === "#e88943",
  );
  rects.forEach((rect, index) => {
    const grade = labels[index] ? labels[index].textContent.trim() : "";
    if (!tickY.has(grade)) return;
    out.push({ grade, top: Number(rect.getAttribute("y")), tick: tickY.get(grade) });
  });
  return out;
});
if (Array.isArray(svgAlign)) {
  ok("⑤-2 前置：畫得出匯出用的 SVG 並量到柱子", svgAlign.length >= 1, `${svgAlign.length} 根`);
  const svgDrift = svgAlign.filter((item) => Math.abs(item.top - item.tick) > 1.5);
  ok(
    "⑤-2 匯出圖檔的柱頂也落在自己那一級的刻度上",
    svgDrift.length === 0,
    svgDrift.map((i) => `${i.grade} 差 ${Math.abs(i.top - i.tick).toFixed(1)}`).join("、"),
  );
} else {
  ok("⑤-2 取得匯出用的 SVG", false, "拿不到 chartModelToSvg 或圖卡");
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 來源追溯預設收合；圖表頁標題、匯出鈕位置、間距與三段分法工具列都對");
