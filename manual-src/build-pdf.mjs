import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromePath } from "../chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "manual.html");
const out = join(here, "..", "manuals", "交通服務水準分析系統_新手使用手冊_v2.20.1.pdf");

const chrome = chromePath();
const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(pathToFileURL(src).href, { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });

const style =
  "font-family:'Noto Sans CJK TC',sans-serif;font-size:7pt;color:#6f7e8d;width:100%;padding:0 16mm;";

await page.pdf({
  path: out,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  margin: { top: "20mm", bottom: "18mm", left: "16mm", right: "16mm" },
  headerTemplate: `<div style="${style}text-align:right;">交通服務水準分析系統 ｜ 新手使用手冊</div>`,
  footerTemplate:
    `<div style="${style}text-align:center;">v2.20.1 ｜ 2026-08-24 ｜ 使用前請先下載專案包備份　　第 ` +
    `<span class="pageNumber"></span> / <span class="totalPages"></span> 頁</div>`,
});

await browser.close();
console.log("PDF 已產生：", out);
