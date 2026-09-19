/*
 * ══════════════════════════════════════════════════════════════════════
 *  「建立與管理計畫」排第一步；「健康檢查」改名「資料異常檢查」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「交通服務水準**開始建立計畫是所有步驟第一個要做的**，它大分頁位置怎會
 *     放在匯入資料步驟之後，竟然放在參數設定裡? 應該放在匯入資料步驟之前吧?
 *     名稱要寫『建立與管理計畫』這樣才讓人看得懂吧? 其實**三個程式建立計畫的
 *     分頁名稱 應該都要統一為 建立與管理計畫**。」
 *   「**健康檢查應該要更名為「資料異常檢查」**才好懂。」
 *
 * ⚠️ 這一支要驗的不只是「側欄改了字」：
 *   ① 側欄的名字
 *   ② **它排在所有匯入項目之前**（使用者要的是順序，不是只換字）
 *   ③ 點進去之後**頁內標題也是同一個名字**（側欄叫 A、點進去叫 B 更糟）
 *   ④ 頁內的 STEP 編號要和側欄的區號一致
 *   ⑤ 全站不再出現「健康檢查」四個字
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
const page = await (
  await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const nav = await page.evaluate(() =>
  [...document.querySelectorAll("nav button[data-view]")].map((b) => ({
    view: b.dataset.view,
    label: (b.textContent || "").replace(/\s+/g, " ").trim(),
  })),
);
ok("前置：側欄真的列得出項目", nav.length >= 10, `${nav.length} 項`);

const setup = nav.find((x) => x.view === "setup");
ok("① 側欄的名字是「建立與管理計畫」", setup?.label === "建立與管理計畫", setup?.label);

/*
 * ② 順序：它必須排在**每一個**匯入相關的分頁之前。
 *   只驗「在 import 之前」不夠——匯入紀錄也是匯入流程的一部分。
 */
const setupIndex = nav.findIndex((x) => x.view === "setup");
for (const view of ["import", "importlog"]) {
  const i = nav.findIndex((x) => x.view === view);
  ok(
    `② 「建立與管理計畫」排在「${nav[i]?.label}」之前`,
    setupIndex >= 0 && i >= 0 && setupIndex < i,
    `建立=${setupIndex}、${view}=${i}`,
  );
}

/* ③ 點進去，頁內標題要同名。 */
await page.locator('nav button[data-view="setup"]').click();
await page.waitForTimeout(500);
const pageTitle = await page
  .locator("#setup .title h2")
  .first()
  .textContent()
  .then((t) => (t ?? "").trim());
ok("③ 頁內標題也是「建立與管理計畫」", pageTitle === "建立與管理計畫", pageTitle);
const headTitle = await page
  .locator("#headTitle")
  .textContent()
  .then((t) => (t ?? "").trim());
ok("③ 頁首也是同一個名字", headTitle === "建立與管理計畫", headTitle);

/* ④ STEP 編號要和側欄區號一致（都是第一步）。 */
const step = await page
  .locator("#setup .title .eyebrow")
  .first()
  .textContent()
  .then((t) => (t ?? "").trim());
ok("④ 頁內的 STEP 編號是 1（和它排第一步一致）", /1/.test(step), step);
const zoneTitle = await page.evaluate(() => {
  const btn = document.querySelector('nav button[data-view="setup"]');
  /*
   * ⚠️ 2026-09-13 起大分頁按鈕被包進 .nav-row（右側要放收合鈕），
   *   所以要從**那一列**往回找分區標題，不是從按鈕本身——
   *   從按鈕找的話 previousElementSibling 是 null，
   *   這一條會回報「找不到分區標題」而紅。
   */
  let node = (btn?.closest(".nav-row") || btn)?.previousElementSibling;
  while (node && !node.classList?.contains("nav-zone"))
    node = node.previousElementSibling;
  return node ? (node.textContent || "").trim() : "(找不到分區標題)";
});
ok(
  "④ 它所在的側欄分區是第一區（區名不可以還叫「資料匯入」）",
  /一/.test(zoneTitle) && !/^二|^三|^四|^五/.test(zoneTitle),
  zoneTitle,
);

/* ⑤ 全站不可以再出現「健康檢查」。 */
const leftovers = [];
for (const { view, label } of nav) {
  await page.locator(`nav button[data-view="${view}"]`).click();
  await page.waitForTimeout(300);
  const found = await page.evaluate(
    () => (document.body.innerText || "").includes("健康檢查"),
  );
  if (found) leftovers.push(label);
}
ok(
  "⑤ 畫面上不再出現「健康檢查」（已改名為「資料異常檢查」）",
  leftovers.length === 0,
  leftovers.join("、"),
);
const renamedSomewhere = await page.evaluate(() => {
  const btn = document.querySelector('nav button[data-view="maintenance"]');
  btn?.click();
  return true;
});
await page.waitForTimeout(500);
const hasNewName = await page.evaluate(() =>
  (document.body.innerText || "").includes("資料異常檢查"),
);
ok(
  "⑤ 反面：新名字真的出現在畫面上（不是把整段刪掉就變綠）",
  renamedSomewhere && hasNewName,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 「建立與管理計畫」排第一步、名字一致；「健康檢查」已全面改名");
