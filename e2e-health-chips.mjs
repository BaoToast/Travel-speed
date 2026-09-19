/*
 * ══════════════════════════════════════════════════════════════════════
 *  「檢查結果」也要有類型標籤篩選（與品質總覽同一套）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「我可以很直觀知道異常有幾個種類，可以**選擇最重大的異常先挑出來看**哪幾筆，
 *     也不會因為筆數太多而沒注意到細節……針對**需要使用者確認的表**，
 *     都可以套用這種列表＋篩選的模式。」
 *
 * ⚠️ 這張表本來就有「類型」欄，卻沒有任何篩選；隔壁的「計畫資料品質總覽」
 *   早就有標籤篩選——同一頁兩張表兩種待遇。
 *
 * 驗四件事：
 *   ① 標籤筆數加總 ＝ 全列時的列數
 *   ② 點一個標籤 → 只剩該類型，而且每一列真的是那個類型
 *   ③ 可多選
 *   ④ 清除篩選 → 全部回來
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
await page.fill("#projectCode", "HEALTHCHIP");
await page.fill("#projectName", "檢查結果標籤守門用計畫");
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

const read = () =>
  page.evaluate(() => ({
    chips: [...document.querySelectorAll("#healthTypeChips .anomaly-chip")]
      .filter((el) => el.id !== "healthClear")
      .map((el) => {
        const text = (el.textContent || "").trim();
        const m = text.match(/^(.*)（(\d+)）$/);
        return { type: m ? m[1] : text, count: m ? Number(m[2]) : 0, on: el.classList.contains("on") };
      }),
    rows: [...document.querySelectorAll("#healthRows tr")].filter(
      (tr) => !tr.querySelector(".empty"),
    ).length,
    firstCol: [...document.querySelectorAll("#healthRows tr")]
      .filter((tr) => !tr.querySelector(".empty"))
      .map((tr) => (tr.children[0]?.textContent || "").trim()),
    count: (document.getElementById("healthCount")?.textContent || "").trim(),
  }));

const all = await read();
console.log(`\n類型：${all.chips.map((c) => `${c.type}×${c.count}`).join("、") || "(沒有標籤)"}`);
ok("前置：真的檢查出異常（沒有的話這一支變成恆真）", all.rows > 0, `${all.rows} 列・${all.count}`);
ok("前置：標籤列得出來", all.chips.length > 0, `${all.chips.length} 種`);
if (!all.rows || !all.chips.length) {
  await browser.close();
  server.close();
  console.error("\n❌ 沒有可驗的資料（不當成通過）");
  process.exit(1);
}
const sum = all.chips.reduce((n, c) => n + c.count, 0);
ok("① 標籤筆數加總 ＝ 全列時的列數", sum === all.rows, `加總 ${sum}、列數 ${all.rows}`);

const first = all.chips[0];
await page.locator("#healthTypeChips .anomaly-chip").first().click();
await page.waitForTimeout(300);
const one = await read();
ok(`② 點「${first.type}」之後只剩該類型`, one.rows === first.count, `${one.rows} 列（該類型 ${first.count} 筆）`);
ok("② 列出來的每一列都真的是那個類型", one.firstCol.every((t) => t === first.type), one.firstCol.slice(0, 3).join("、"));
ok("② 筆數文字要跟著篩選走", /顯示/.test(one.count), one.count);

if (all.chips.length >= 2) {
  const second = all.chips[1];
  await page.locator("#healthTypeChips .anomaly-chip").nth(1).click();
  await page.waitForTimeout(300);
  const two = await read();
  ok(`③ 再點「${second.type}」之後兩類都在（可多選）`, two.rows === first.count + second.count, `${two.rows} 列`);
}

await page.locator("#healthClear").click();
await page.waitForTimeout(300);
const back = await read();
ok("④ 清除篩選之後全部回來", back.rows === all.rows, `${back.rows} / ${all.rows}`);
ok("④ 沒有任何標籤還是按下的狀態", back.chips.every((c) => !c.on));

/* ══ 五、X-49：解決方式那一欄 ══════════════════════════════════
 *
 * 使用者 2026-09-16：「我建議在檢查結果表中，新增一欄"解決方式"
 *   (例如重新匯入檔案、指引前往某分頁進行人工確認等)」
 *
 * ⚠️ 刻意迴避的假通過：
 *   一、不可以只驗「有這一欄」。空字串、或每一類都同一句通用句照樣會過，
 *       而那等於沒寫。
 *   二、「前往…」那顆要驗**真的換頁**，不是一顆裝飾。
 *   三、兩張表（檢查結果與計畫資料品質總覽）**都要有**——它們是同一批
 *       項目的兩個視圖，只做一邊就會變成同一件事兩種待遇。
 */
console.log("\n══ 五、X-49：解決方式 ══");
const resolutions = await page.evaluate(() =>
  [...document.querySelectorAll("#healthRows tr")]
    .map((tr) => ({
      type: tr.querySelector("td")?.textContent?.trim() ?? "",
      kind: tr.querySelector(".resolution-kind")?.textContent?.trim() ?? "",
      text: tr.querySelector(".resolution-cell span")?.textContent?.trim() ?? "",
      goto: tr.querySelector(".resolution-goto")?.dataset?.gotoView ?? "",
    }))
    .filter((row) => row.type),
);
ok("前置：檢查結果真的列得出項目", resolutions.length > 0, `${resolutions.length} 列`);
ok(
  "⚠️ ⑤ 每一列都有解決方式，而且每一句都有實際內容",
  resolutions.length > 0 && resolutions.every((r) => r.text.length >= 30),
  resolutions.map((r) => `${r.type}:${r.text.length}字`).join("、"),
);
ok(
  "⚠️ ⑤ 每一列都標出處理類別（重新匯入／人工確認／畫面修正）",
  resolutions.every((r) => ["重新匯入", "人工確認", "畫面修正"].includes(r.kind)),
  [...new Set(resolutions.map((r) => r.kind))].join("／"),
);
ok(
  "⚠️ ⑤ 標成「重新匯入」的，句子裡要真的寫出「重新匯入」或「補匯」",
  resolutions
    .filter((r) => r.kind === "重新匯入")
    .every((r) => r.text.includes("重新匯入") || r.text.includes("補匯")),
);
{
  const byText = new Map();
  for (const r of resolutions) {
    const seen = byText.get(r.text);
    if (seen && seen !== r.type) byText.set(r.text, seen + "／" + r.type);
    else if (!seen) byText.set(r.text, r.type);
  }
  const shared = [...byText.values()].filter((who) => who.includes("／"));
  ok(
    "⚠️ ⑤ 不同種類的異常不可以共用同一句解決方式（那等於沒寫）",
    shared.length === 0,
    shared.join("、") ||
      `${new Set(resolutions.map((r) => r.type)).size} 種異常各寫各的`,
  );
}
ok(
  "⚠️ ⑤ 「計畫資料品質總覽」那一張表也要有這一欄（同一批項目的兩個視圖）",
  (await page.evaluate(
    () => document.querySelectorAll("#qualityRows .resolution-cell").length,
  )) > 0,
);
{
  const target = resolutions.find((r) => r.goto);
  ok("⑤ 至少有一列給了「前往某分頁」的按鈕", Boolean(target), target?.goto ?? "");
  if (target) {
    await page.locator("#healthRows .resolution-goto").first().click();
    await page.waitForTimeout(900);
    const activeView = await page.evaluate(
      () =>
        document.querySelector("nav button.active")?.dataset?.view ?? "",
    );
    ok(
      "⚠️ ⑤ 按「前往…」真的換到那一頁（不是一顆裝飾用的按鈕）",
      activeView === target.goto,
      `按了要去 ${target.goto}，實際到 ${activeView}`,
    );
  }
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 「檢查結果」：類型標籤篩選可用，而且每一列都寫得出解決方式");
