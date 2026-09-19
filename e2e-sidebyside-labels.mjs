/**
 * ══════════════════════════════════════════════════════════════════════
 *  K-5：**並列**（平日＋假日、上午＋下午）時，圖上的字不可以疊在一起
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「只要確保 XY 軸名稱和 XY 軸刻度不重疊、顯示的文字不要被縮減成
 *     『XXX路...』這類沒完全顯示出來基本上就沒問題，請記得圖類型檔案，
 *     不論 excel 還是匯出的圖檔或是程式上顯示的圖，
 *     都要以肉眼觀察過，以完整呈現數據及美觀整齊為首要」
 *   「⚠️ **8 筆以內也要確保不重疊**」
 *
 * ── 為什麼要另外一支 ────────────────────────────────────────────
 *
 * 既有的 e2e-chart-layout 驗的是「季度很多時會不會擠」（一路壓到 40 季），
 * 那是**單數列、資料多**的情形。而使用者指名的是**另一種**：
 * **並列時資料少也會疊**——兩條數列的同一季在同一個 x 上，
 * 兩個數值標籤本來就靠在一起，季度少的時候點距大、標籤反而更大，
 * 疊起來的機會比 40 季那種還高。全日交通量已經改成矩形碰撞避讓，
 * 這一支是把**同一套檢查**推到另外兩支。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**前置一定要確認「真的並列了」**（畫出兩條數列）。只設下拉不檢查的話，
 *     萬一那個選項沒接上，整支會在單數列上驗，永遠不會疊——恆真。
 * 二、**不可以只驗 X 軸標籤。** 使用者點名的是「顯示的文字」，
 *     包含資料點上的數值標籤——那正是並列時會疊的東西。
 * 三、**要量畫面上的實際外框**（getBoundingClientRect），不是 SVG 的
 *     viewBox 座標：縮放與字型代換都只在畫面上看得見。
 * 四、**多種寬度都要量。** 疊不疊和可用寬度直接相關，只量一種寬度
 *     等於只驗了一台電腦。
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
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "SIDEBY");
await page.fill("#projectName", "並列標籤守門");
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
/*
 * ⚠️ 季度**刻意只匯三季**：使用者指名的情形就是「8 筆以內」。
 *   季度多的那一種由 e2e-chart-layout 顧，兩支各守一邊。
 */
await importQuarter(0);
await importQuarter(1);
await importQuarter(2);

/*
 * ⚠️ X-62（2026-09-17）：四張圖各自一個大分頁，而這一支整支量的是
 *   **畫面上的外框**。停在別頁量的話每一個框都是 0×0，
 *   「兩兩不重疊」會全部恆真——整支假綠。所以每一節各自先切過去。
 */
const gotoChart = async (view) => {
  await page.evaluate(
    (id) => document.querySelector(`[data-view="${id}"]`)?.click(),
    view,
  );
  await page.waitForTimeout(1500);
};
await gotoChart("trendChart");

/**
 * 量某一個容器裡所有 <text> 的畫面外框，回報兩兩重疊的組合。
 *
 * ⚠️ 判準加 1px 容差：反鋸齒與次像素定位會讓兩個「剛好貼著」的字
 *   量出 0.3px 的重疊，那不是使用者看得到的問題。真正的重疊都在數 px 以上。
 */
const overlapsIn = (selector) =>
  page.evaluate((sel) => {
    const out = [];
    for (const svg of document.querySelectorAll(sel)) {
      const texts = [...svg.querySelectorAll("text")]
        .filter((node) => (node.textContent || "").trim())
        .map((node) => {
          const box = node.getBoundingClientRect();
          return {
            text: (node.textContent || "").trim(),
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: box.width,
          };
        })
        .filter((item) => item.width > 0);
      for (let i = 0; i < texts.length; i += 1)
        for (let j = i + 1; j < texts.length; j += 1) {
          const a = texts[i];
          const b = texts[j];
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 1 && overlapY > 1)
            out.push(
              `「${a.text}」×「${b.text}」（重疊 ${Math.round(overlapX)}×${Math.round(overlapY)}px）`,
            );
        }
    }
    return out;
  }, selector);

/** 目前畫出幾條數列（並列＝2 條）。 */
const seriesCount = () =>
  page.evaluate(
    () =>
      document.querySelectorAll("#trendCharts svg .trend-line, #trendCharts svg polyline")
        .length,
  );

/* ══ 一、歷季趨勢：平日＋假日並列 ══════════════════════════════ */
console.log("\n══ 一、歷季趨勢：平日＋假日並列 ══");
const setTrendDay = async (value) => {
  await page.evaluate((wanted) => {
    const select = document.getElementById("trendDay");
    if (!select) return;
    const option = [...select.options].find(
      (item) => item.value === wanted || item.textContent.includes("並列"),
    );
    if (!option) return;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(1200);
};
await setTrendDay("side-by-side");
const lines = await seriesCount();
ok(
  "前置：真的並列了（畫出兩條數列；只有一條的話整支恆真）",
  lines >= 2,
  `${lines} 條數列`,
);

for (const width of [1600, 1440, 1280, 1024]) {
  await page.setViewportSize({ width, height: 950 });
  await page.waitForTimeout(700);
  const hits = await overlapsIn("#trendCharts svg");
  ok(
    `⚠️ 視窗 ${width}px：並列時圖上的字兩兩不重疊`,
    hits.length === 0,
    hits.slice(0, 3).join("；") || "0 處重疊",
  );
}
await page.setViewportSize({ width: 1600, height: 950 });
await page.waitForTimeout(600);

/* ══ 二、三段分法也要驗（另一個大分頁的另一組並列的圖）══════ */
console.log("\n══ 二、三段分法 ══");
await gotoChart("bandChart");
const bandExists = await page.evaluate(
  () => document.querySelectorAll("#bandCharts svg").length,
);
ok(
  "前置：三段分法畫得出來（0 張的話下面恆真）",
  bandExists > 0,
  `${bandExists} 張`,
);
if (bandExists > 0) {
  for (const width of [1600, 1280]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForTimeout(700);
    const hits = await overlapsIn("#bandCharts svg");
    ok(
      `⚠️ 視窗 ${width}px：三段分法圖上的字兩兩不重疊`,
      hits.length === 0,
      hits.slice(0, 3).join("；") || "0 處重疊",
    );
  }
}
await page.setViewportSize({ width: 1600, height: 950 });
await page.waitForTimeout(600);

/* ══ 三、LOS 圖與旅行速率（HTML 柱狀圖，平日／假日本來就並排）══ */
console.log("\n══ 三、各路段 LOS 圖／旅行速率：柱子上的字 ══");
/*
 * ⚠️ 這兩張是 HTML div 畫的柱狀圖，不是 SVG——上面那個 <text> 掃描看不到。
 *   使用者指名的「文字重疊」不分實作方式，所以這裡改掃柱子上的標籤。
 */
/*
 * ⚠️ 這兩張圖現在分屬兩個大分頁，所以**逐頁量**——
 *   兩張一起量的話，不在畫面上的那一張所有框都是 0，
 *   它那一半就等於沒驗。
 */
const barOverlaps = [];
for (const [view, grid] of [
  ["losChart", "chartGrid"],
  ["speedTrend", "speedTrendGrid"],
]) {
  await gotoChart(view);
  barOverlaps.push(...(await page.evaluate((grid) => {
    const out = [];
    const host = document.getElementById(grid);
    if (!host) return out;
    const labels = [...host.querySelectorAll(".bar-group small")]
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          text: (node.textContent || "").trim(),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
        };
      })
      .filter((item) => item.width > 0);
    for (let i = 1; i < labels.length; i += 1) {
      const a = labels[i - 1];
      const b = labels[i];
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > 1 && overlapY > 1)
        out.push(`${grid}：「${a.text}」×「${b.text}」（重疊 ${Math.round(overlapX)}px）`);
    }
    return out;
  }, grid)));
}
await gotoChart("losChart");
const barCount = await page.evaluate(
  () => document.querySelectorAll("#chartGrid .bar-group small").length,
);
ok(
  "前置：柱狀圖真的有季別標籤（0 個的話下一條恆真）",
  barCount > 0,
  `${barCount} 個`,
);
ok(
  "⚠️ 柱狀圖的季別標籤兩兩不重疊（平日與假日兩根柱子並排時最容易疊）",
  barOverlaps.length === 0,
  barOverlaps.slice(0, 3).join("；") || "0 處重疊",
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 並列時（資料少也一樣）圖上的字兩兩不重疊");
