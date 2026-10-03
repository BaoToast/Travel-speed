/*
 * ══════════════════════════════════════════════════════════════════
 *  畫面上每一個 class，樣式表裡都要真的寫過
 * ══════════════════════════════════════════════════════════════════
 *
 * 為什麼這一支到今天才有：
 *
 *   另外兩支（全日交通量、路口轉向）2026-09-11 就有了，那天一天之內
 *   踩到三次**同一種**錯誤：
 *     ・.ghost（路口轉向）→ 按鈕變成沒有邊框的純文字
 *     ・.ghost（全日交通量）→ 同上
 *     ・.factor-scope-picker／-state／-summary（全日交通量）
 *       → 使用者原話：「參數設定 套用季別 全季別 和套用路段 也全面是白色的，
 *          與背景色相融，完全沒發現這裡可以設定 季別/路段」
 *
 *   ⚠️ **這一支當時漏做了**，而且已經證明它會漏掉真東西：
 *   2026-09-30 複驗時查到 `.road-choice` 在 app.js 用了兩處、
 *   `styles.css` 裡**一條規則都沒有**——那正是這支守門該抓的東西，
 *   因為沒有這支守門，它一直沒被抓到。
 *
 * ⚠️ 這種錯誤不會有任何錯誤訊息。ESLint 不看 class 名稱，
 *   瀏覽器主控台也不會吭聲——畫面照樣畫得出來，只是畫成一行沒有樣式的字。
 *   使用者要自己「看出來這裡本來應該有個東西」才會回報。
 *
 * ── 為什麼用 E2E 而不是掃原始碼 ────────────────────────────────
 *
 *   掃 app.js 找 className 要自己剖析樣板字串、三元運算式，
 *   還分不出「這是 class」和「這是傳給函式的 id」，假警報會多到沒人理它——
 *   沒人理的測試等於沒有測試。改成在**真的畫出來的畫面**上做：
 *   讀每個元素的 classList，再問 document.styleSheets 有沒有規則提到它。
 *   兩邊都是事實，不需要猜。
 *
 * ── ⚠️ 刻意迴避的假通過陷阱 ────────────────────────────────────
 *
 *   一、**只看一頁不算。** 這一支的 14 個分頁雖然都在 index.html 裡，
 *       但表格、徽章、彈出層全都是換頁之後才由 app.js 畫出來的，
 *       只驗首頁等於只驗一小塊。這裡逐頁走過再聯集，小分頁也點過
 *       （點了才會有 .current）。
 *   二、**沒有資料也不算。** 空畫面上大半的 class 根本不會出現。
 *       這裡沿用 e2e-layout 的做法，先用 test-fixtures 匯入一批資料。
 *   三、**「有規則」不等於「規則有效」**——這一支只擋「完全沒寫」。
 *       顏色對比由 text-contrast.test.mjs 與 e2e-layout 管。
 *   四、前置檢查：先塞一個**故意不存在**的 class 進 DOM，確認抓得到。
 *       抓不到的話，下面那條是恆綠的。
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

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
/*
 * detail 分兩種用途：有些是**佐證**（成功時也該印出來看），
 * 有些是**失敗原因**（成功時印出來會讓人以為出事了）。
 * 後者用 failOnly() 包起來，只在紅字時才顯示。
 */
const failOnly = (text) => ({ failOnly: text });
const ok = (label, condition, detail = "") => {
  const text =
    detail && typeof detail === "object" ? (condition ? "" : detail.failOnly) : detail;
  console.log(`${condition ? "✅" : "❌"} ${label}${text ? ` — ${text}` : ""}`);
  if (!condition) problems.push(label + (text ? ` — ${text}` : ""));
};

/*
 * 這些 class 是**刻意**沒有自己的樣式的，不是漏寫。
 *
 * ⚠️ 要往這裡加東西之前，規矩是：**把那一塊實際算繪出來拍下來看過**，
 *   不可以用「應該沒關係吧」放行——2026-09-11 那三次事故，
 *   每一次都是在這一步自我說服而過關的。
 *   下面每一條都附了當時量到的尺寸或佐證。
 */
const INTENTIONAL = new Set([]);

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

/* 先灌一點資料進去，空畫面上大半的 class 根本不會出現。 */
const SAMPLE_DIR = join(here, "test-fixtures");
let seeded = false;
if (existsSync(SAMPLE_DIR)) {
  const files = readdirSync(SAMPLE_DIR).filter((n) => /報告測試路段/.test(n));
  if (files.length) {
    await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
    await page.fill("#projectCode", "CLS");
    await page.fill("#projectName", "class 覆蓋掃描計畫");
    await page.click("#saveProject");
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('[data-view="import"]').click());
    await page.fill("#rocYear", "115");
    await page.selectOption("#quarter", { index: 0 });
    await page.setInputFiles(
      "#files",
      files.map((name) => ({
        name,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: readFileSync(join(SAMPLE_DIR, name)),
      })),
    );
    await page.click("#preview");
    await page.waitForTimeout(3000);
    await page.click("#commit");
    await page.waitForTimeout(1500);
    seeded = await page.evaluate(
      () => document.querySelectorAll("#detailTable tbody tr, table tbody tr").length > 0,
    );
  }
}
/*
 * ⚠️ 灌不進去就要紅，不可以安靜地跑完。
 *   空畫面上「每個 class 都有規則」幾乎一定是綠的——那是假的綠。
 */
ok("測試資料真的匯入進去了", seeded, failOnly("空畫面掃不到動態產生的 class，下面整支是假的綠"));

const scanPage = () =>
  page.evaluate(() => {
    const styled = new Set();
    const collect = (rules) => {
      for (const rule of rules) {
        if (rule.selectorText)
          /*
           * ⚠️ 這一條正規式在另外兩支上第一版寫錯過，而且**錯得會全綠或全紅**：
           *   字元類別裡放了「空白到 ￿」的範圍，等於連小數點和空白
           *   都算進名稱，於是 `.severity.warning` 被當成一個叫
           *   「severity.warning」的類別，`.warning` 就永遠找不到規則。
           *   實測一次噴出 40 幾個假警報。名稱只能是 CSS 識別字：
           *   字母／數字／底線／連字號（外加非 ASCII）。
           */
          for (const m of rule.selectorText.matchAll(
            /\.(-?[_a-zA-Z -￿][\w -￿-]*)/g,
          ))
            styled.add(m[1]);
        if (rule.cssRules) collect(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        collect(sheet.cssRules);
      } catch {
        /* 跨來源樣式表讀不到；本專案的 styles.css 是同源的，不會走到這裡 */
      }
    }
    const missing = {};
    for (const el of document.querySelectorAll("[class]")) {
      if (typeof el.className !== "string") continue; /* SVG 元素跳過 */
      for (const klass of el.classList)
        if (!styled.has(klass) && !(klass in missing))
          missing[klass] =
            `<${el.tagName.toLowerCase()} class="${el.className}">` +
            (el.textContent || "").trim().slice(0, 24);
    }
    return missing;
  });

console.log("\n══ 前置：這支掃描器真的抓得到沒有規則的 class ══");
await page.evaluate(() => {
  const probe = document.createElement("div");
  probe.className = "zz-probe-class-with-no-rule";
  document.body.appendChild(probe);
});
ok(
  "塞一個不存在的 class 進去，掃描器抓得到",
  "zz-probe-class-with-no-rule" in (await scanPage()),
  failOnly("抓不到的話，下面「每個 class 都有規則」那一條是恆綠的"),
);
await page.evaluate(() => {
  document.querySelector(".zz-probe-class-with-no-rule")?.remove();
});

/*
 * 側欄上實際存在的分頁，全部走一遍（不寫死清單，側欄改了就自動跟著改）。
 * ⚠️ 收合鈕（.nav-collapse）也是 nav button，它沒有 data-view——
 *   混進分頁清單的話會被當成一頁去點，而點下去只是把小分頁收起來。
 *   這裡一律以 data-view 認人。
 */
const views = await page.$$eval("nav button[data-view]", (els) =>
  els.map((el) => el.dataset.view),
);
ok(
  "側欄找得到分頁按鈕",
  views.length >= 10,
  failOnly(`只找到 ${views.length} 個——定位方式是不是又變了？`),
);

console.log("\n══ 逐頁掃描 ══");
const missing = {};
let visited = 0;
for (const view of views) {
  /*
   * ⚠️ 用 JS 直接 click()，不用 Playwright 的點擊：
   *   收合狀態下大分頁按鈕本身還在，但 Playwright 會等它可見而逾時。
   */
  const clicked = await page.evaluate((v) => {
    const el = document.querySelector(`nav button[data-view="${v}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, view);
  if (!clicked) continue;
  await page.waitForTimeout(500);
  /* 小分頁也點過——點了才會有 .current。 */
  const anchors = await page.$$eval(".nav-section", (els) =>
    els.map((el) => el.dataset.anchor).filter(Boolean),
  );
  for (const anchor of anchors) {
    await page.evaluate((a) => {
      document.querySelector(`.nav-section[data-anchor="${a}"]`)?.click();
    }, anchor);
    await page.waitForTimeout(120);
  }
  visited += 1;
  const found = await scanPage();
  let count = 0;
  for (const [klass, where] of Object.entries(found)) {
    if (INTENTIONAL.has(klass)) continue;
    count += 1;
    if (!(klass in missing)) missing[klass] = `${view}｜${where}`;
  }
  console.log(
    `   ${view}（小分頁 ${anchors.length}）：${count ? `${count} 個沒有規則` : "全部都有規則"}`,
  );
}

console.log("\n══ 結果 ══");
ok("真的走過每一個分頁", visited === views.length, `走了 ${visited}/${views.length} 頁`);
ok(
  "畫面上每一個 class 在樣式表裡都找得到規則",
  Object.keys(missing).length === 0,
  Object.keys(missing).length
    ? "\n" +
      Object.entries(missing)
        .map(([k, v]) => `   .${k}　←　${v}`)
        .join("\n")
    : "",
);
ok("過程中沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" / ")));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過`);
  process.exit(1);
}
console.log("\n✅ 全部通過");
