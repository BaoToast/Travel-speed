/*
 * 排版量測：走過每一個分頁，用瀏覽器實際量出來的座標判斷有沒有沾黏或溢出。
 *
 * 量三件事：
 *  A. 整頁有沒有橫向捲動（overflow）
 *  B. 卡片標題有沒有貼著卡片邊框（整張卡忘了寫內距時就會這樣）
 *  C. 卡片內的表格第一欄與段落有沒有比標題更靠左
 *
 * 只印數字與判定，不靠截圖目視。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const server = createServer((req, res) => {
  const path = join(here, decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html");
  if (!existsSync(path) || !path.startsWith(here)) return void res.writeHead(404).end("not found");
  res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const WIDTHS = [640, 760, 900, 1024, 1180, 1280, 1440, 1680, 1920];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

/* 先灌一點資料進去，空畫面量不到東西。 */
const SAMPLE_DIR = join(here, "..", "speed-samples");
if (existsSync(SAMPLE_DIR)) {
  const files = readdirSync(SAMPLE_DIR).filter((n) => /台1中山路國昌路民強街路口/.test(n));
  await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
  await page.fill("#projectCode", "LAY");
  await page.fill("#projectName", "排版量測計畫");
  await page.click("#saveProject");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: 0 });
  await page.setInputFiles("#files", files.map((name) => ({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLE_DIR, name)),
  })));
  await page.click("#preview");
  await page.waitForTimeout(3000);
  await page.click("#commit");
  await page.waitForTimeout(1500);
}

const views = await page.$$eval("nav button", (els) =>
  els.map((el) => el.dataset.view).filter(Boolean),
);
console.log("分頁：", views.join("、"));

async function measure() {
  return page.evaluate(() => {
    const view = document.documentElement.clientWidth;
    const active = document.querySelector(".view.active") || document.body;
    const overflow = document.documentElement.scrollWidth - view;
    const wide = [];
    if (overflow > 1)
      for (const el of active.querySelectorAll("*")) {
        const box = el.getBoundingClientRect();
        if (box.right > view + 1 && getComputedStyle(el).overflowX !== "auto")
          wide.push(el.tagName + "." + (el.className || "") + "@" + Math.round(box.right));
      }
    const flushHeads = [];
    const misaligned = [];
    for (const card of active.querySelectorAll(".panel")) {
      const cardBox = card.getBoundingClientRect();
      if (cardBox.height < 8) continue;
      const heads = [...card.querySelectorAll("h3, .eyebrow, legend")].filter(
        (el) => el.closest(".panel") === card,
      );
      if (!heads.length) continue;
      for (const head of heads) {
        const gap = head.getBoundingClientRect().left - cardBox.left;
        if (gap < 6 && head.getBoundingClientRect().width > 0)
          flushHeads.push(
            (card.className || "panel") + "「" + (head.textContent || "").trim().slice(0, 18) + "」" + Math.round(gap) + "px",
          );
      }
      const headLeft = Math.min(...heads.map((el) => el.getBoundingClientRect().left));
      for (const el of card.querySelectorAll("table th:first-child, table td:first-child")) {
        if (el.closest(".panel") !== card) continue;
        if (!(el.textContent || "").trim()) continue;
        const style = getComputedStyle(el);
        const textLeft = el.getBoundingClientRect().left + (parseFloat(style.paddingLeft) || 0);
        if (textLeft - headLeft < -3) {
          misaligned.push(
            (card.className || "panel") + "「" + (el.textContent || "").trim().slice(0, 14) + "」少 " +
              Math.round(headLeft - textLeft) + "px",
          );
          break;
        }
      }
    }
    return { overflow, wide: wide.slice(0, 4), flushHeads: flushHeads.slice(0, 4), misaligned: misaligned.slice(0, 4) };
  });
}

console.log("\n══ 逐分頁量測（1440px）══");
for (const id of views) {
  await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), id);
  await page.waitForTimeout(450);
  const m = await measure();
  console.log(
    `【${id}】溢出 ${m.overflow}｜標題貼邊 ${m.flushHeads.length}｜表格未對齊 ${m.misaligned.length}`,
  );
  ok(`${id}：沒有橫向溢出`, m.overflow <= 1, `${m.overflow}px ${m.wide.join(", ")}`);
  ok(`${id}：卡片標題都有內距`, m.flushHeads.length === 0, m.flushHeads.join("；"));
  ok(`${id}：表格第一欄與標題對齊`, m.misaligned.length === 0, m.misaligned.join("；"));
}

console.log("\n══ 多寬度掃描 ══");
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 1000 });
  await page.waitForTimeout(250);
  const bad = [];
  for (const id of views) {
    await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), id);
    await page.waitForTimeout(220);
    const m = await measure();
    if (m.overflow > 1) bad.push(`${id} 溢出 ${m.overflow}px（${m.wide[0] || ""}）`);
    if (m.flushHeads.length) bad.push(`${id} 標題貼邊 ${m.flushHeads.length} 處`);
    if (m.misaligned.length) bad.push(`${id} 表格未對齊 ${m.misaligned.length} 處`);
  }
  ok(`寬度 ${width}px 全分頁乾淨`, bad.length === 0, bad.join("；"));
}

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
