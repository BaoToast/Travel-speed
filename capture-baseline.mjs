/*
 * ══════════════════════════════════════════════════════════════════════
 *  升級前後逐格比對用的「數字基準」（交通服務水準）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 與 g2164/scripts/capture-baseline.mjs 同一套做法，說明見那一支。
 * 重點：存的是**每個數字在哪個元素裡**，位置換了也抓得到；
 *       主工具列／篩選列本身要排除。
 *
 * 用法：node capture-baseline.mjs 升級前
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(here, "test-fixtures");
const files = readdirSync(SAMPLE_DIR).filter((name) => name.endsWith(".xlsx"));
const outDir = join(here, "..", "baseline");
mkdirSync(outDir, { recursive: true });
const tag = process.argv[2] || "未命名";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
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

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1700, height: 1100 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

/*
 * ⚠️ 計畫編號與名稱要**固定**，季度也要固定。
 *   任何一項隨機（例如帶時間戳）都會讓兩次基準對不起來，
 *   而那會讓整套比對變成永遠紅、失去意義。
 */
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "BASE");
await page.fill("#projectName", "基準比對用計畫");
await page.click("#saveProject");
await page.waitForTimeout(600);
for (const index of [0, 1, 2]) {
  await page.evaluate(() =>
    document.querySelector('[data-view="import"]').click(),
  );
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
  await page.waitForTimeout(1600);
}

const views = await page.evaluate(() =>
  [...document.querySelectorAll("nav button[data-view]")].map((button) => ({
    view: button.dataset.view,
    label: (button.textContent || "").trim(),
  })),
);

const snapshot = { tag, capturedAt: new Date().toISOString(), pages: {} };
for (const item of views) {
  await page.evaluate(
    (id) => document.querySelector(`nav button[data-view="${id}"]`).click(),
    item.view,
  );
  await page.waitForTimeout(900);
  snapshot.pages[item.label] = await page.evaluate((id) => {
    const host = document.getElementById(id);
    if (!host) return [];
    const skip = [...host.querySelectorAll(".main-toolbar, .filters")];
    const inSkip = (element) => skip.some((node) => node.contains(element));
    const pathOf = (element) => {
      const parts = [];
      for (let node = element; node && node !== host; node = node.parentElement) {
        const parent = node.parentElement;
        const index = parent ? [...parent.children].indexOf(node) : 0;
        parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
      }
      return parts.join(">");
    };
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const out = [];
    let node;
    while ((node = walker.nextNode())) {
      const element = node.parentElement;
      if (!element || inSkip(element)) continue;
      const text = (node.nodeValue || "").trim();
      if (!text) continue;
      /*
       * ⚠️ 時間戳要遮掉，不然基準永遠對不起來。
       *   實測：匯入紀錄與備份清單有「2026/9/14 上午9:31:44」與
       *   「B1789378294426」（毫秒時間戳當編號），兩次擷取一定不同——
       *   67 格因此紅掉，而那不是數字被改，是我量錯東西。
       * ⚠️ 遮罩刻意寫窄：只遮「日期時間格式」與「13 位毫秒時間戳」，
       *   不可以寫成「長數字一律遮掉」——那會把真的流量數字一起遮掉。
       */
      /*
       * ⚠️ **不可以**把「時:分」也當成時間戳遮掉。
       *   第一版寫成「含 \d{1,2}:\d{2} 就遮」，結果把
       *   「07:00~08:00」這種**尖峰時段起訖**也遮掉了——路口轉向一口氣
       *   少掉 261 個數字（1434 → 1173）。那是真正的分析數值，
       *   尖峰視窗挑錯了正是我們最要抓的錯，遮掉等於把守門的眼睛蒙上。
       *   只有**帶日期**的（匯入時間、備份時間）才是每次都不一樣的時間戳。
       */
      const looksLikeTime = /\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(text);
      const numbers = looksLikeTime
        ? ["<時間戳>"]
        : (text.match(/-?\d[\d,]*\.?\d*/g) || [])
            .map((value) => value.replace(/,/g, ""))
            .map((value) => (/^1[6-9]\d{11}$/.test(value) ? "<時間戳>" : value));
      if (!numbers.length) continue;
      out.push({ at: pathOf(element), text, numbers });
    }
    return out;
  }, item.view);
}
snapshot.errors = errors;

const file = join(outDir, `ts2028-${tag}.json`);
writeFileSync(file, JSON.stringify(snapshot, null, 1), "utf8");
const total = Object.values(snapshot.pages).reduce(
  (sum, list) => sum + list.reduce((n, cell) => n + cell.numbers.length, 0),
  0,
);
console.log(`已存下 ${Object.keys(snapshot.pages).length} 頁、${total} 個數字`);
for (const [label, list] of Object.entries(snapshot.pages))
  console.log(`  ${label}：${list.reduce((n, c) => n + c.numbers.length, 0)} 個`);
if (errors.length) console.log("⚠️ 期間有 JS 例外：", errors.slice(0, 3));
console.log("→", file);
await browser.close();
server.close();
