/*
 * ══════════════════════════════════════════════════════════════════════
 *  「期別顯示」與「年份顯示」兩顆鈕，**每一個顯示期間的欄位**都要跟著走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（附圖，匯入紀錄）：
 *   「期別顯示調查月份 和西元年，但這裡的資料**只有成功變成西元年，
 *     沒有變成調查月份**。請確認月份和年的切換功能都有正常運作。」
 *   「三份程式都有，確認都有正常運作 調查月份 和 年 切換。」
 *
 * ⚠️ 既有的 e2e-period-date 驗的是「切換鈕會動、標題會變」，
 *   **沒有逐頁去看每一個期間欄位**。而這兩顆鈕是兩層獨立的轉換：
 *   年份那一層到處都套上了，期別那一層只套在少數地方，
 *   於是二十幾個欄位長年顯示「年份有換、期別沒換」。
 *
 * 這一支的作法：切到「調查月份」之後，**掃過每一頁的整個畫面**，
 * 找還有沒有殘留的季別寫法（115Q1／2026Q1）。有就是那一處沒接上。
 *
 * ⚠️ 四種組合都要驗（季別×民國／季別×西元／月份×民國／月份×西元）——
 *   只驗一種正是這次漏掉的原因。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
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

/* ⚠️ 一定要匯入**帶有調查日期**的真實測資，否則期別鈕會被停用，整支變成恆真。 */
const SAMPLE_DIR = join(here, "test-fixtures");
const files = readdirSync(SAMPLE_DIR).filter((n) => /報告測試路段/.test(n));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "PERIODSW");
await page.fill("#projectName", "期別切換守門用計畫");
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

/*
 * ⚠️ 目前的匿名測資裡**沒有調查日期**（原始檔就沒有那一格），
 *   而沒有日期時期別鈕會被停用——那樣這一支會整個跑不動、或變成恆真。
 *   這裡在匯入完成之後補上調查日期，走的是程式自己的存檔與重繪，
 *   不是繞過任何邏輯；補的日期也刻意落在該季度內。
 *   ⚠️ 這是**測試前置**，不是把結果做出來：下面驗的仍然是畫面自己算出來的字。
 */
await page.evaluate(async () => {
  const monthOfQuarter = { Q1: "02", Q2: "05", Q3: "08", Q4: "11" };
  for (const row of state.details) {
    if (row.projectCode !== "PERIODSW") continue;
    const q = String(row.period).slice(-2);
    const year = Number(String(row.period).slice(0, 3)) + 1911;
    row.surveyDate = `${year}-${monthOfQuarter[q] || "02"}-15`;
  }
  await save();
});
await page.waitForTimeout(900);

const monthOn = () => page.evaluate(() =>
  /調查月份/.test(document.querySelector('[data-testid="period-display-toggle"]').textContent));
const adOn = () => page.evaluate(() =>
  /西元/.test(document.querySelector('[data-testid="year-style-toggle"]').textContent));
const setMonth = async (want) => {
  if ((await monthOn()) !== want) {
    await page.locator('[data-testid="period-display-toggle"]').click();
    await page.waitForTimeout(500);
  }
};
const setAd = async (want) => {
  if ((await adOn()) !== want) {
    await page.locator('[data-testid="year-style-toggle"]').click();
    await page.waitForTimeout(500);
  }
};

const enabled = await page.locator('[data-testid="period-display-toggle"]').isEnabled();
ok("前置：這批資料有調查日期，期別鈕可以按（不能按的話整支變成恆真）", enabled);

const views = await page.evaluate(() =>
  [...document.querySelectorAll("nav button[data-view]")].map((b) => ({ v: b.dataset.view, t: (b.textContent||"").trim() })));

/** 掃畫面上還有沒有季別寫法（115Q1／2026Q1）。 */
const scanQuarterish = async () => {
  const out = [];
  for (const { v, t } of views) {
    await page.locator(`nav button[data-view="${v}"]`).click();
    await page.waitForTimeout(350);
    const hits = await page.evaluate(() => {
      const view = document.querySelector(".view.active");
      if (!view) return [];
      const found = [];
      const walk = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walk.nextNode())) {
        /* ⚠️ <option> 的文字也算——下拉選單也是使用者看得到的期間欄位。 */
        const text = (node.nodeValue || "").trim();
        /*
         * ⚠️ 「例如：114Q1」這種**輸入格式的範例**不算漏網。
         *   路段有效期間的輸入框收的就是季別代碼（114Q1），
         *   把範例改成月份寫法反而會讓使用者打錯字。
         *   只排除明確標著「例如」的那一段，不要放寬到整段說明文字——
         *   放太寬的話真正漏掉的欄位也會被一起濾掉。
         */
        if (/例如/.test(text)) continue;
        /*
         * ⚠️ 說明文字裡拿季別當例子（「選 114Q1～114Q4 時…」）也不算漏網。
         *   資料欄位一定很短（一格季度、一段區間）；長句子是散文。
         *   用長度分辨是**權宜**，所以門檻訂得保守（40 字），
         *   寧可多驗幾個假警報，也不要把真正漏掉的欄位濾掉。
         */
        if (text.length > 40) continue;
        const m = text.match(/\b\d{3,4}Q[1-4]\b/);
        if (m) {
          const owner = node.parentElement;
          found.push(`${m[0]}（在 ${owner.tagName.toLowerCase()}${owner.id ? "#" + owner.id : ""}）`);
        }
      }
      return [...new Set(found)].slice(0, 6);
    });
    if (hits.length) out.push(`${t}：${hits.join("、")}`);
  }
  return out;
};

console.log("\n── 四種組合逐一驗");
for (const [month, ad, name] of [
  [false, false, "季別 × 民國年"],
  [false, true, "季別 × 西元年"],
  [true, false, "調查月份 × 民國年"],
  [true, true, "調查月份 × 西元年"],
]) {
  await setMonth(month);
  await setAd(ad);
  const leftovers = await scanQuarterish();
  if (month)
    ok(`${name}：畫面上不應再有任何季別寫法`, leftovers.length === 0,
      leftovers.length ? leftovers.slice(0, 4).join(" ｜ ") : "全部都是月份寫法");
  else
    ok(`${name}：畫面上應該**還有**季別寫法（前置檢查，證明掃描真的掃得到）`,
      leftovers.length > 0, `${leftovers.length} 頁有`);
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 期別與年份兩顆鈕，每一個期間欄位都跟著走");
