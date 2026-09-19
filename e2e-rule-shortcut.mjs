/*
 * ══════════════════════════════════════════════════════════════════════
 *  尖峰彙總「目前套用的判定標準」：只講這張表真的用到的規則
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「尖峰彙總，套用的標準只有服務水準，沒有順暢 A、B／尚可 C、D／壅塞 E、F。
 *     上方『目前套用的判定標準』後面多了這句順暢A、B... 會以為表格裡面哪邊有
 *     套用到，所以後面那句說明請拿掉，只保留服務水準門檻……如果使用者有調整
 *     門檻，記得這裡欄位的文字說明數字也要跟著變成使用者設定的數值。」
 *
 * 他是對的：尖峰彙總這張表只有一欄 LOS（A～F），**沒有任何一欄**用到三段分法
 * ——那是 LOS 圖表頁（bandPanel）才用的。
 * ⚠️ 說明**多講**一件畫面上沒有的事，和漏講一樣會誤導。
 *
 * 這一支驗三件事：
 *   ① 橫幅文字不含「順暢／尚可／壅塞」
 *   ② 門檻數字與目前計畫的設定一致（不是寫死的預設值）
 *   ③ 改了門檻之後，橫幅文字**真的跟著變**
 *      ⚠️ ③ 是使用者特別叮嚀的那一半。只驗 ① 的話，把數字寫死照樣全綠。
 *   ④ 三段分法的說明仍留在用得到它的地方（判定標準頁），不是整個刪掉
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
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

/*
 * ⚠️ 一定要先建一個計畫。
 *   沒有計畫時「套用並重新計算」會直接 return（toast「請先建立或選擇計畫」），
 *   門檻根本沒改到——那會讓下面的 ③ 紅得莫名其妙，也可能被誤判成程式壞掉。
 */
await page.locator('nav button[data-view="setup"]').click();
await page.waitForTimeout(400);
await page.locator("#projectCode").fill("A00T00-01");
await page.locator("#projectName").fill("門檻文字守門用計畫");
await page.locator("#saveProject").click();
await page.waitForTimeout(900);

const bannerText = async () => {
  await page.locator('nav button[data-view="summary"]').click();
  await page.waitForTimeout(400);
  return (
    (await page.locator("#ruleShortcutText").textContent()) ?? ""
  ).replace(/\s+/g, " ").trim();
};

const before = await bannerText();
console.log(`橫幅文字（預設）：${before}\n`);

ok("前置：橫幅真的有內容（空字串會讓下面每一條變成恆真）", before.length > 8, before);
for (const word of ["順暢", "尚可", "壅塞"]) {
  ok(`① 橫幅不再提「${word}」（這張表沒有那一欄）`, !before.includes(word));
}
/*
 * ⚠️ 畫面上用的是**全形**的 ≧（Big5 A1D3）。
 *   半形的 ≥（U+2265）不在 Big5，微軟正黑體不一定畫得出來——
 *   2026-09-15 起三支統一改用全形，`glyph-guard` 在守這件事。
 *   這裡順便把半形擋掉，免得哪天又混回半形而沒有人發現。
 */
ok(
  "② 橫幅有列出 A～E 的門檻（而且用的是全形 ≧，不是 Big5 裡沒有的 ≥）",
  /A≧/.test(before) && /E≧/.test(before) && !/[≥≤]/.test(before),
  before,
);

/*
 * ③ 改門檻 → 橫幅要跟著變。
 * ⚠️ 用一個絕對不會和預設撞號的值（0.77），否則「沒有跟著變」也會剛好相符。
 */
await page.locator('nav button[data-view="standards"]').click();
await page.waitForTimeout(500);
await page.locator("#losA").fill("0.77");
await page.locator("#applyLosRules").click();
await page.waitForTimeout(700);
const after = await bannerText();
console.log(`\n橫幅文字（把 A 門檻改成 0.77 之後）：${after}`);
ok(
  "③ 改了門檻之後橫幅數字跟著變（不是寫死的預設值）",
  after.includes("0.77") && after !== before,
  after,
);
for (const word of ["順暢", "尚可", "壅塞"]) {
  ok(`③ 改完之後仍然不提「${word}」`, !after.includes(word));
}

/* ④ 三段分法的說明要留在它真的用得到的地方。 */
await page.locator('nav button[data-view="standards"]').click();
await page.waitForTimeout(400);
const bandStillThere = await page
  .locator("#standards-band")
  .textContent()
  .then((t) => (t ?? "").includes("順暢"))
  .catch(() => false);
ok("④ 三段分法的說明仍留在「判定標準」頁（不是整個刪掉）", bandStillThere);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 尖峰彙總的判定標準橫幅：只講門檻、而且跟著使用者的設定走");
