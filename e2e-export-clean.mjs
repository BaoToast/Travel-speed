/*
 * ══════════════════════════════════════════════════════════════════════
 *  匯出的圖要「乾淨版」：沒有逐點標籤，但圖例與軸名都要留著
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11（三支一致的規則）：
 *   「網頁畫面是在筆數不多時，數據直接標記在圖上，不與圖形或標籤重疊……
 *     **匯出的圖則統一為乾淨版。**」
 *
 * 2026-09-13 使用者用下載下來的 PNG 證實這一支從來沒做到：
 *   「三段分法下載下來的 PNG 圖檔，**圖上面還有數字 3**，不是說會淨空嗎?
 *     **圖例保持在上面是正確的**。」
 *   「最差服務水準的圖檔也是，上面有英文字母 D（服務水準）。」
 *
 * ⚠️ 這一支要驗**兩個方向**，缺一不可：
 *   ① 逐點標籤（.trend-point-label／.band-seg-label*）在匯出版本裡**沒有**
 *   ② 圖例、軸名、刻度在匯出版本裡**還在**
 *   只驗 ① 的話，一個「把所有 <text> 都刪掉」的實作照樣全綠，
 *   而那會把使用者明講要留的圖例一起清掉。
 * ⚠️ 還要驗 ③：畫面上那一張**不可以被改到**（只能動複製出來的那一份）。
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
  const p = join(
    here,
    decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html",
  );
  if (!existsSync(p) || !p.startsWith(here)) {
    res.writeHead(404).end("nf");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(p)] || "application/octet-stream",
  });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 950 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

/*
 * ⚠️ 一定要**真的匯入資料**。沒有資料時圖表面板是 hidden、頁面捲不動，
 *   下面每一條都會變成恆真——那正是這個功能當初被標成「已修」卻沒修好的原因。
 *   走的是和 e2e-trend 同一份匿名測資、同一條匯入路徑。
 */
const SAMPLE_DIR = join(here, "test-fixtures");
if (!existsSync(SAMPLE_DIR)) {
  console.error("❌ 找不到匿名回歸測資，請先執行 npm run fixtures");
  await browser.close();
  server.close();
  process.exit(1);
}
const files = readdirSync(SAMPLE_DIR).filter((name) => /報告測試路段/.test(name));
if (files.length !== 2) {
  console.error(`❌ 匿名測資應有平日、假日各一份，目前為 ${files.length} 份`);
  await browser.close();
  server.close();
  process.exit(1);
}
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "FIGNOTE");
await page.fill("#projectName", "圖文版面守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(500);
for (const quarterIndex of [0, 1, 2]) {
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
/*
 * X-62：四張圖各自一頁，但進任何一頁都會把四塊一起重畫
 * （見 gotoView 的 CHART_VIEWS 分支），而這一段只**數元素**、不量位置，
 * 所以停在歷季趨勢那一頁就夠。
 */
await page.locator('nav button[data-view="trendChart"]').click();
await page.waitForTimeout(800);

const result = await page.evaluate(() => {
  const out = { panels: [] };
  for (const [id, name] of [
    ["trendCharts", "歷季趨勢"],
    ["bandCharts", "三段分法"],
  ]) {
    const svgs = [...document.querySelectorAll("#" + id + " svg")];
    for (const svg of svgs) {
      const strip = [
        ".trend-point-label",
        ".band-seg-label",
        ".band-seg-label-dark",
      ];
      const onScreenLabels = strip.reduce(
        (n, sel) => n + svg.querySelectorAll(sel).length,
        0,
      );
      const clean =
        typeof exportCleanSvg === "function" ? exportCleanSvg(svg) : null;
      if (!clean) return { missing: true };
      out.panels.push({
        panel: name,
        onScreenLabels,
        exportLabels: strip.reduce(
          (n, sel) => n + clean.querySelectorAll(sel).length,
          0,
        ),
        exportLegend: clean.querySelectorAll(
          ".band-legend-text, .trend-legend-text",
        ).length,
        exportAxisTitles: clean.querySelectorAll(".axis-title").length,
        exportTicks: clean.querySelectorAll(".trend-tick").length,
        /* ③ 複製之後畫面上那一張還在不在。 */
        stillOnScreen: strip.reduce(
          (n, sel) => n + svg.querySelectorAll(sel).length,
          0,
        ),
      });
    }
  }
  return out;
});

if (result.missing) {
  console.error("❌ 找不到 exportCleanSvg()——匯出淨空這一段根本不存在");
  await browser.close();
  server.close();
  process.exit(1);
}

/* ⚠️ 前置：畫面上真的有標籤可以被清掉，否則下面全部變成恆真。 */
const totalOnScreen = result.panels.reduce((n, p) => n + p.onScreenLabels, 0);
ok(
  "前置：畫面上真的有逐點標籤可以清（沒有的話這一支變成恆真）",
  totalOnScreen > 0,
  `${totalOnScreen} 個`,
);

for (const p of result.panels) {
  console.log(
    `\n── ${p.panel}：畫面標籤 ${p.onScreenLabels}、匯出標籤 ${p.exportLabels}、` +
      `匯出圖例 ${p.exportLegend}、軸名 ${p.exportAxisTitles}、刻度 ${p.exportTicks}`,
  );
  ok(`① ${p.panel}：匯出版本裡沒有逐點標籤`, p.exportLabels === 0, `${p.exportLabels} 個`);
  ok(
    `② ${p.panel}：匯出版本裡軸名與刻度都還在（不可以把 <text> 全清掉）`,
    p.exportAxisTitles > 0 && p.exportTicks > 0,
    `軸名 ${p.exportAxisTitles}、刻度 ${p.exportTicks}`,
  );
  if (p.panel === "三段分法")
    ok(
      "② 三段分法：匯出版本裡**圖例還在**（使用者明講圖例保持在上面是正確的）",
      p.exportLegend > 0,
      `${p.exportLegend} 個`,
    );
  ok(
    `③ ${p.panel}：畫面上那一張沒有被改到（只能動複製出來的那一份）`,
    p.stillOnScreen === p.onScreenLabels,
    `清之前 ${p.onScreenLabels}、清之後 ${p.stillOnScreen}`,
  );
}

/*
 * ⚠️ 上面驗的是 exportCleanSvg() 這支**工具**做得對不對，
 *   驗不到「輸出 PNG 的時候真的有呼叫它」。
 *   2026-09-13 反向測試證實了這個洞：把 svgFigureToPngBlob 裡的
 *   exportCleanSvg() 拿掉之後，上面每一條照樣全綠。
 *
 * 這一段改成**真的跑一次輸出路徑**：把 XMLSerializer 換成會留下紀錄的版本，
 * 呼叫程式自己的 svgFigureToPngBlob()，再看真正被序列化出去的那一份
 * 裡面還有沒有逐點標籤。
 */
console.log("\n── 真的跑一次 PNG 輸出路徑（不是只驗工具函式）");
const serialized = await page.evaluate(async () => {
  const captured = [];
  const original = XMLSerializer.prototype.serializeToString;
  XMLSerializer.prototype.serializeToString = function (node) {
    const text = original.call(this, node);
    captured.push(text);
    return text;
  };
  try {
    for (const svg of document.querySelectorAll(
      "#trendCharts svg, #bandCharts svg",
    ))
      await svgFigureToPngBlob(svg, 1);
  } finally {
    XMLSerializer.prototype.serializeToString = original;
  }
  /*
   * ⚠️ 要數的是**元素**，不是字串出現幾次。
   *   SVG 裡有一段內嵌 <style>，裡面就寫著 .trend-point-label{...}——
   *   直接數字串的話，即使元素全部刪乾淨了也永遠 > 0，
   *   會報一個不存在的錯（我 2026-09-13 就先被自己這個寫法騙過一次）。
   *   所以先把 <style> 整段拿掉，再只數 class="..." 裡面的。
   */
  const countClass = (text, name) =>
    (
      text
        .replace(/<style[\s\S]*?<\/style>/g, "")
        .match(new RegExp('class="[^"]*\\b' + name + '\\b', "g")) || []
    ).length;
  return captured.map((text) => ({
    labels:
      countClass(text, "trend-point-label") +
      countClass(text, "band-seg-label") +
      countClass(text, "band-seg-label-dark"),
    legend:
      countClass(text, "band-legend-text") +
      countClass(text, "trend-legend-text"),
    axis: countClass(text, "axis-title"),
  }));
});
ok(
  "前置：真的序列化了幾張圖（0 張的話這一段變成恆真）",
  serialized.length > 0,
  `${serialized.length} 張`,
);
const dirty = serialized.filter((x) => x.labels > 0);
ok(
  "④ **實際輸出**的那一份裡沒有逐點標籤（證明輸出時真的有呼叫淨空）",
  dirty.length === 0,
  dirty.length ? `${dirty.length} 張仍帶標籤` : `${serialized.length} 張都乾淨`,
);
ok(
  "④ 實際輸出的那一份裡軸名還在（沒有把 <text> 全清掉）",
  serialized.every((x) => x.axis > 0),
  serialized.map((x) => x.axis).join("、"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 匯出的圖是乾淨版：沒有逐點標籤，圖例與軸名都留著");
