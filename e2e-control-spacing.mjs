/*
 * ══════════════════════════════════════════════════════════════════════
 *  按鈕不可以黏在一起、被裁掉、或貼著畫面邊緣
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（附圖）：
 *   「刪除計畫的『刪除單一計畫』和『本機所有計畫』按鍵**黏在一起**了，
 *     請記得**用肉眼確認畫面、按鍵是否被裁切或黏住或很接近畫面邊緣**等問題。」
 *
 * ⚠️ 為什麼既有的守門抓不到：
 *   版面相關的守門驗的是「有沒有溢出容器」「有沒有被裁掉」。
 *   兩顆按鈕貼在一起**不算溢出、也不算裁切**，所以一路全綠。
 *   真正的成因是「補了一個軸、忘了另一個軸」：
 *   舊版寫 style.marginTop = "8px"，但那兩顆是並排的，橫向間距是 0。
 *
 * 這一支量三件事，逐一逐對：
 *   ① 相鄰兩個可互動元素之間的間距 ≥ 4px（黏在一起）
 *   ② 元素不可以超出它自己的容器（被裁）
 *   ③ 元素不可以離視窗左右邊緣 < 8px（貼邊）
 *
 * ⚠️ 一定要跑**多個視窗寬度**：黏住通常是在某個寬度下版面換行才發生的。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
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
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 950 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

/* 建一個計畫，讓需要計畫才長出來的按鈕也出現。 */
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "SPACING");
await page.fill("#projectName", "按鈕間距守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(600);

const views = await page.evaluate(() =>
  [...document.querySelectorAll("nav button[data-view]")].map((b) => ({
    v: b.dataset.view,
    t: (b.textContent || "").trim(),
  })),
);

let measured = 0;
for (const width of [1920, 1500, 1366, 1280]) {
  await page.setViewportSize({ width, height: 950 });
  await page.waitForTimeout(300);
  for (const { v, t } of views) {
    await page.locator(`nav button[data-view="${v}"]`).click();
    await page.waitForTimeout(350);
    const found = await page.evaluate(() => {
      const view = document.querySelector(".view.active");
      if (!view) return { pairs: 0, issues: [] };
      const controls = [
        ...view.querySelectorAll("button, select, input, a.primary, a.outline"),
      ].filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return (
          r.width > 2 &&
          r.height > 2 &&
          s.visibility !== "hidden" &&
          s.display !== "none" &&
          !el.closest("[hidden]")
        );
      });
      const issues = [];
      const name = (el) =>
        (el.textContent || el.getAttribute("placeholder") || el.id || el.tagName)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 20) || el.tagName;
      /* ③ 貼邊 */
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        if (r.left < 8 || r.right > window.innerWidth - 8)
          issues.push({
            kind: "貼邊",
            text: `「${name(el)}」left=${Math.round(r.left)} right=${Math.round(r.right)}（視窗 ${window.innerWidth}）`,
          });
        /* ② 被容器裁掉 */
        const box = el.parentElement;
        if (box) {
          const b = box.getBoundingClientRect();
          const clipped =
            getComputedStyle(box).overflow !== "visible" &&
            (r.right > b.right + 1 || r.left < b.left - 1);
          if (clipped)
            issues.push({
              kind: "被裁",
              text: `「${name(el)}」超出容器 ${Math.round(Math.max(r.right - b.right, b.left - r.left))}px`,
            });
        }
      }
      /* ① 黏在一起：只比同一個父層下、彼此有重疊投影的相鄰兩個 */
      let pairs = 0;
      for (let i = 0; i < controls.length; i += 1) {
        for (let j = i + 1; j < controls.length; j += 1) {
          const a = controls[i];
          const b = controls[j];
          if (a.parentElement !== b.parentElement) continue;
          if (a.contains(b) || b.contains(a)) continue;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const overlapY =
            Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          const overlapX =
            Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          if (overlapY > 4) {
            /* 同一列並排 → 量水平縫 */
            const gap =
              ra.left < rb.left ? rb.left - ra.right : ra.left - rb.right;
            pairs += 1;
            if (gap >= 0 && gap < 4)
              issues.push({
                kind: "黏住",
                text: `「${name(a)}」與「${name(b)}」左右只差 ${Math.round(gap)}px`,
              });
          } else if (overlapX > 4) {
            /* 上下疊放 → 量垂直縫 */
            const gap =
              ra.top < rb.top ? rb.top - ra.bottom : ra.top - rb.bottom;
            pairs += 1;
            if (gap >= 0 && gap < 4)
              issues.push({
                kind: "黏住",
                text: `「${name(a)}」與「${name(b)}」上下只差 ${Math.round(gap)}px`,
              });
          }
        }
      }
      return { pairs, issues };
    });
    measured += found.pairs;
    for (const issue of found.issues)
      problems.push(`寬 ${width} ／ ${t} ／ ${issue.kind}：${issue.text}`);
  }
}

/* ⚠️ 前置：真的量到成對的控制項了嗎。0 對的話上面全部變成恆真。 */
if (measured < 20)
  problems.push(
    `只量到 ${measured} 對相鄰控制項（預期 ≥ 20）。量不到的話這一支變成恆真。`,
  );
if (errors.length) problems.push("有 JS 例外：" + errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(`共比對 ${measured} 對相鄰控制項（4 種視窗寬度 × 每一個分頁）`);
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of [...new Set(problems)]) console.error("  ・" + p);
  process.exit(1);
}
console.log("✅ 沒有按鈕黏在一起、被裁掉或貼著畫面邊緣");
