/*
 * ══════════════════════════════════════════════════════════════════
 *  X-41：「已人工確認」那一顆鈕（使用者 2026-09-17 指名名稱）
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者原話：
 *   「(b) 另給一顆『已人工確認，不再提醒』的按鈕，但按鈕名稱不要這麼長，
 *     改為『已人工確認』，系統就主動不再提醒……記得不要發生：
 *     按鈕的文字超過按鈕邊界或是被背景色遮蔽，或是按鈕太大顆，
 *     這類我們曾踩過的雷」
 *
 * 所以這一支**量畫面**，不是讀原始碼（名字那一條由 issue-ack.test.mjs 守）：
 *   ① 那顆鈕真的在畫面上，名字就是「已人工確認」
 *   ② 文字不可以超出按鈕邊界（scrollWidth <= clientWidth）
 *   ③ 文字對比 ≥ 4.5:1（不可以被背景色吃掉）
 *   ④ 不可以做成一大塊——高度要和同一格裡的另一顆鈕同一個級距
 *   ⑤ 按下去之後那一筆真的不再提醒，而且可以取消
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**前置要先確認真的有那一類異常**。沒有異常時整支恆真——
 *     「找不到按鈕」和「按鈕沒問題」在只驗上界的寫法裡分不出來。
 * 二、②不可以用 `offsetWidth > 0` 之類的存在檢查代替。
 *     溢出的按鈕寬度也是正的。要比 scrollWidth 與 clientWidth。
 * 三、④不可以寫死像素。寫死的話改個字級就紅，而紅的是門檻不是按鈕。
 *     比的是**和隔壁那顆鈕的關係**。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
const server = createServer((req, res) => {
  const p = join(here, decodeURIComponent(req.url.split("?")[0]).replace(/^\//,"") || "index.html");
  if (!existsSync(p) || !p.startsWith(here)) { res.writeHead(404).end("nf"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
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
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: "zh-TW" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

/* ⚠️ 一定要有資料而且要有異常，否則這一支整個變成恆真。 */
const SAMPLE_DIR = join(here, "test-fixtures");
const files = readdirSync(SAMPLE_DIR).filter((n) => /測試路段|報告測試路段/.test(n) && /\.xlsx$/.test(n));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "ACKBUTTON");
await page.fill("#projectName", "已人工確認鈕守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(500);
for (const qi of [0, 1]) {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: qi });
  await page.setInputFiles("#files", files.map((n) => ({
    name: n,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLE_DIR, n)),
  })));
  await page.click("#preview");
  await page.waitForTimeout(3000);
  await page.click("#commit");
  await page.waitForTimeout(1500);
}

await page.evaluate(() => document.querySelector('[data-view="maintenance"]').click());
await page.waitForTimeout(600);
await page.click("#runHealth");
await page.waitForTimeout(900);


/* ══ 前置：要真的有「人工確認」類的異常 ══════════════════════ */
const ackButtons = () =>
  page.evaluate(() => {
    const out = [];
    for (const button of document.querySelectorAll("#healthRows .resolution-ack, #qualityRows .resolution-ack")) {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      /* 同一格裡的「前往…」鈕，拿來當「一顆鈕該有多大」的基準。 */
      const sibling = button
        .closest("td")
        ?.querySelector(".resolution-goto");
      out.push({
        text: (button.textContent || "").trim(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scrollWidth: button.scrollWidth,
        clientWidth: button.clientWidth,
        color: style.color,
        background: style.backgroundColor,
        siblingHeight: sibling
          ? Math.round(sibling.getBoundingClientRect().height)
          : null,
      });
    }
    return out;
  });

const buttons = await ackButtons();
ok(
  "前置：畫面上真的有「已人工確認」鈕（0 顆的話下面全部恆真）",
  buttons.length > 0,
  `${buttons.length} 顆`,
);
if (!buttons.length) {
  console.error("\n❌ 沒有可按的異常，這一支驗不到任何東西，直接停。");
  await browser.close();
  server.close();
  process.exit(1);
}

ok(
  "① 那顆鈕的名字就是「已人工確認」",
  buttons.every((b) => b.text === "已人工確認" || b.text === "取消確認"),
  [...new Set(buttons.map((b) => b.text))].join("／"),
);

const overflow = buttons.filter((b) => b.scrollWidth > b.clientWidth + 1);
ok(
  "⚠️ ② 按鈕文字不可以超出邊界（踩過的雷）",
  overflow.length === 0,
  overflow.length
    ? overflow
        .map((b) => `「${b.text}」內容 ${b.scrollWidth}px > 可視 ${b.clientWidth}px`)
        .join("、")
    : `${buttons.length} 顆都沒有溢出`,
);

/* ── ③ 對比 ─────────────────────────────────────────────── */
const parse = (value) => {
  const hit = String(value).match(/rgba?\(([^)]+)\)/);
  if (!hit) return null;
  const parts = hit[1].split(",").map((v) => Number(v.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
};
const luminance = (c) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const contrastOf = (fg, bg) => {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return (Math.max(a, b) / Math.min(a, b)).toFixed(2);
};
const contrasts = buttons.map((b) => {
  const fg = parse(b.color);
  let bg = parse(b.background);
  /* 透明背景＝沿用底下的白底（表格列的底色）。 */
  if (!bg || bg.a === 0) bg = { r: 255, g: 255, b: 255, a: 1 };
  return { text: b.text, ratio: Number(contrastOf(fg, bg)) };
});
const lowContrast = contrasts.filter((c) => c.ratio < 4.5);
ok(
  "⚠️ ③ 按鈕文字不可以被背景色吃掉（對比 ≥ 4.5:1，踩過的雷）",
  lowContrast.length === 0,
  lowContrast.length
    ? lowContrast.map((c) => `「${c.text}」${c.ratio}:1`).join("、")
    : `最低 ${Math.min(...contrasts.map((c) => c.ratio))}:1`,
);

/* ── ④ 不可以做成一大塊 ─────────────────────────────────── */
const withSibling = buttons.filter((b) => b.siblingHeight);
ok(
  "前置：同一格裡有另一顆鈕可以當基準（沒有的話 ④ 恆真）",
  withSibling.length > 0,
  `${withSibling.length} 顆有鄰居`,
);
const oversized = withSibling.filter((b) => b.height > b.siblingHeight + 4);
ok(
  "⚠️ ④ 不可以做成一大顆（高度要和同一格的另一顆鈕同一個級距，踩過的雷）",
  oversized.length === 0,
  oversized.length
    ? oversized.map((b) => `「${b.text}」${b.height}px vs 鄰居 ${b.siblingHeight}px`).join("、")
    : withSibling.map((b) => `${b.height}px／鄰居 ${b.siblingHeight}px`).join("、"),
);

/* ── ⑤ 按下去真的不再提醒，而且可以取消 ──────────────────── */
const countOpen = () =>
  page.evaluate(
    () =>
      document.querySelectorAll("#healthRows tr:not(.issue-acked)").length,
  );
const beforeAck = await countOpen();
await page.locator("#healthRows .resolution-ack").first().click();
await page.waitForTimeout(900);
const afterAck = await countOpen();
ok(
  "⚠️ ⑤ 按下去之後那一筆真的不再列在待處理裡",
  afterAck < beforeAck,
  `${beforeAck} → ${afterAck}`,
);
/*
 * ⚠️ 確認過的那一列預設會被收起來（那正是「不再提醒」的意思），
 *   所以要先按「顯示已確認」才看得到那一顆。
 *   不先按就找「取消確認」的話，紅的是量法不是功能。
 */
ok(
  "⑤ 有已確認的項目時，標籤列上要出現「顯示已確認」開關",
  (await page.locator("#healthAckToggle").count()) === 1,
);
await page.locator("#healthAckToggle").click();
await page.waitForTimeout(700);
const toggled = await page.evaluate(
  () =>
    [...document.querySelectorAll("#healthRows .resolution-ack")]
      .map((b) => (b.textContent || "").trim())
      .includes("取消確認"),
);
ok("⑤ 確認之後那一顆變成「取消確認」（按得回去）", toggled);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 「已人工確認」鈕：名字、不溢出、對比、大小、按了真的生效");
