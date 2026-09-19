/*
 * ══════════════════════════════════════════════════════════════════════
 *  肉眼檢查用：把每一頁、每一張圖拍下來
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：「要用肉眼觀看為準的各項功能和圖表」。
 *
 * ⚠️ 這一支**不判斷對錯**，只把畫面拍清楚。
 *   自動守門看得到數字與 DOM，看不到「字被切掉」「標籤疊在一起」
 *   「長條與刻度對不上」——那些只有真的看一眼才會發現。
 * ⚠️ fullPage 不可以省：捲動之後才出現的區塊正是最容易壞的地方。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, ".shots");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
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

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "EYECHECK");
await page.fill("#projectName", "肉眼檢查用計畫");
await page.click("#saveProject");
await page.waitForTimeout(500);
async function importQuarter(index) {
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
  await page.waitForTimeout(1500);
}
await importQuarter(0);
await importQuarter(1);
await importQuarter(2);
/* 品質總覽要按過檢查才有內容 */
await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((item) =>
    (item.textContent || "").includes("執行資料異常檢查"),
  );
  if (button) button.click();
});
await page.waitForTimeout(1500);

const safe = (text) => text.replace(/[^一-龥A-Za-z0-9]+/g, "_");
const views = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav button")].map((button) => ({
    id: button.dataset.view,
    label: (button.textContent || "").replace(/\s+/g, "").trim(),
  })),
);
console.log(`分頁：${views.map((v) => v.label).join("、")}`);

let index = 0;
for (const view of views) {
  index += 1;
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view.id);
  await page.waitForTimeout(1000);
  const name = `${String(index).padStart(2, "0")}_${safe(view.label)}`;
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  const panels = await page.locator(".view.active .panel").all();
  let panelIndex = 0;
  for (const panel of panels) {
    panelIndex += 1;
    if (panelIndex > 12) break;
    const box = await panel.boundingBox();
    if (!box || box.height < 80) continue;
    const title = (
      await panel.evaluate(
        (node) => node.querySelector("h2, h3, .panel-head h3")?.textContent || "",
      )
    )
      .replace(/\s+/g, "")
      .slice(0, 14);
    await panel
      .screenshot({
        path: join(
          OUT,
          `${name}--${String(panelIndex).padStart(2, "0")}_${safe(title) || "區塊"}.png`,
        ),
      })
      .catch(() => {});
  }
  console.log(`  ✔ ${name}（${panels.length} 個區塊）`);
}

console.log(
  errors.length ? `⚠️ JS 例外：${errors.slice(0, 5).join(" | ")}` : "（無 JS 例外）",
);
await browser.close();
server.close();
console.log(`\n拍完了：${OUT}`);
