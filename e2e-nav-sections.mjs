/*
 * ══════════════════════════════════════════════════════════════════════
 *  大分頁底下的小分頁：列得出來的，點下去都要找得到、看得見
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「大分頁下面有小分頁（例如各種圖的名稱作為小分頁名稱），都可以比照
 *     流量核對工作台的格式，小分頁文字比較小這樣。點小分頁一樣有醒目提示
 *     視窗和展開（如果有）跳轉正確位置。這類格式可套用到三個程式中。
 *     利用大小分頁讓人知道各種圖、功能分別在哪。」
 *
 * ⚠️ 要驗的**不是**「有沒有這個按鈕」，而是點下去之後：
 *   ① 那一塊真的存在（列了卻點不到＝使用者以為按鈕壞了，而且沒有訊息）
 *   ② 那一塊真的被框起來（outline 量得到）
 *   ③ 收合的（<details>）要自動展開——只捲過去不展開，看到的還是一行標題
 *   ④ 小分頁的字要比大分頁小（使用者指定的格式）
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
  const path = join(
    here,
    decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html",
  );
  if (!existsSync(path) || !path.startsWith(here)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

/*
 * 這幾個大分頁底下應該要有小分頁。
 *
 * ⚠️ **每一個有小分頁的分頁都要列進來**，不可以只挑兩個。
 *   2026-09-12 實測踩過：`charts` 那一組的兩個錨點指向的 id 根本不存在
 *  （index.html 上同一個元素寫了第二個 id=，HTML 只認第一個），於是
 *   「找不到就不列」的保險把它們默默濾掉，LOS 圖表頁只列得出一項——
 *   而這支測試因為 EXPECTED 沒有 charts，照樣全綠。
 *   漏列一個分頁，等於那個分頁的小分頁從此沒有人守。
 */
const EXPECTED = {
  standards: ["服務水準判定方式", "圖表的三段分法"],
  /*
   * ⚠️ X-62（2026-09-17）：原本這裡是 `charts: []`（那一頁在空資料時
   *   三塊圖都畫不出高度，依規則不該列）。四張圖已經各自升格成大分頁，
   *   `charts` 這個分頁**不存在了**，所以這一條整個改成下面四頁。
   *
   *   這四頁的 EXPECTED 都是空的，但**理由和以前不一樣**：
   *   現在是「一頁只有一塊，而且那一塊就叫這個大分頁的名字」，
   *   再列一次會變成側欄同名兩層。下面另有一段反向驗證，
   *   確認那四頁**真的存在、而且各自畫得出自己那一塊**——
   *   少了它，「乾脆四頁都不做」也會全綠。
   */
  losChart: [],
  speedTrend: [],
  trendChart: [],
  bandChart: [],
  /*
   * ⚠️ X-59（使用者 2026-09-17）補上 maintenance。
   *
   *   這一頁一直有四～五塊面板，卻從來沒有列進 EXPECTED——正是上面那段
   *   註解警告的情況（「漏列一個分頁，等於那個分頁的小分頁從此沒有人守」）。
   *   「執行資料異常檢查」原本在抬頭那一列、根本長不出小分頁，
   *   就是因為沒有人守才拖到使用者自己看出來。
   *
   * ⚠️ 順序＝畫面上由上而下，側欄順序與捲動順序必須一致。
   * ⚠️ 這一頁的面板是靜態 HTML，沒有資料時照樣在，所以不分有無資料都該列。
   */
  maintenance: [
    "執行資料異常檢查",
    "刪除單一季度",
    "資料異常檢查摘要",
    "計畫資料品質總覽",
    "檢查結果",
  ],
  backup: [
    "下載目前計畫的專案包",
    "載入既有備份",
    "建立全新空白模板",
  ],
};

for (const [view, labels] of Object.entries(EXPECTED)) {
  console.log(`\n══ ${view} ══`);
  await page.locator(`nav button[data-view="${view}"]`).click();
  await page.waitForTimeout(600);
  const listed = await page.evaluate(() =>
    [...document.querySelectorAll(".nav-section")].map((el) =>
      (el.textContent || "").trim(),
    ),
  );
  /*
   * ⚠️ 「列出來的都點得到」還不夠，還要驗「**該列的都列出來了**」。
   *   少了這一條，一個指向不存在 id 的錨點會被保險默默濾掉而全綠。
   */
  const missing = labels.filter((label) => !listed.includes(label));
  ok(
    `⚠️ ${view}：EXPECTED 裡的每一項都真的列出來了`,
    missing.length === 0,
    missing.length ? `少了：${missing.join("、")}` : "",
  );
  if (labels.length)
    ok(
      `${view}：小分頁列出來了`,
      listed.length > 0,
      listed.join("、") || "一項都沒有",
    );
  else
    ok(
      `${view}：沒有內容時不列任何小分頁（列了卻點不到＝按鈕壞掉）`,
      listed.length === 0,
      listed.join("、"),
    );
  for (const label of labels)
    ok(`${view}：列出「${label}」`, listed.includes(label), listed.join("、"));

  for (const label of listed) {
    await page.locator(`.nav-section:has-text("${label}")`).first().click();
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const el = document.querySelector(".is-focused");
      if (!el) return null;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        id: el.id,
        outline: style.outlineWidth,
        open: el.tagName === "DETAILS" ? el.open : null,
        hidden: el.hidden,
        top: Math.round(box.top),
        visible: box.height > 0 && box.width > 0,
      };
    });
    ok(
      `⚠️ 點「${label}」會把對應的那一塊框起來`,
      !!state && parseFloat(state.outline) >= 1,
      state ? `#${state.id} 外框 ${state.outline}` : "畫面上完全沒有任何區塊被點名",
    );
    if (state)
      ok(
        `「${label}」那一塊看得見（不是收著的、也不是 hidden）`,
        state.visible && !state.hidden && state.open !== false,
        `open=${state.open} hidden=${state.hidden} 高度>0=${state.visible}`,
      );
  }
}

/* ── 小分頁的字要比大分頁小（使用者指定的格式） ── */
console.log("\n══ 版式 ══");
await page.locator('nav button[data-view="standards"]').click();
await page.waitForTimeout(500);
const sizes = await page.evaluate(() => {
  const zone = document.querySelector(".nav-zone");
  const main = document.querySelector('nav button[data-view="standards"]');
  const sub = document.querySelector(".nav-section");
  return {
    zone: zone ? parseFloat(getComputedStyle(zone).fontSize) : null,
    main: parseFloat(getComputedStyle(main).fontSize),
    sub: sub ? parseFloat(getComputedStyle(sub).fontSize) : null,
  };
});
ok(
  "⚠️ 小分頁的字比大分頁小",
  sizes.sub !== null && sizes.sub < sizes.main,
  `大分頁 ${sizes.main}px、小分頁 ${sizes.sub}px`,
);
/*
 * 使用者 2026-09-15：「分類標題與它下方的大分頁文字大小不要相同……
 *   文字大小請依此順序遞減，分類標題（最大）＞大分頁＞小分頁」。
 *
 * ⚠️ 這一條要量的是**三層都嚴格遞減**，不是「分類標題 >= 大分頁」。
 *   2026-09-14 那一版兩層都是 16px、只差字重——那正是使用者說
 *   「文字大小不要相同」要擋掉的狀態，`>=` 會讓它照樣綠。
 */
ok(
  "⚠️ 側欄三層字級嚴格遞減：分類標題 > 大分頁 > 小分頁",
  sizes.zone !== null &&
    sizes.sub !== null &&
    sizes.zone > sizes.main &&
    sizes.main > sizes.sub,
  `分類標題 ${sizes.zone}px、大分頁 ${sizes.main}px、小分頁 ${sizes.sub}px`,
);

/* ── 換頁時點名要清掉 ── */
await page.locator('nav button[data-view="summary"]').click();
await page.waitForTimeout(500);
ok(
  "換到別頁時，上一頁的外框要清掉（不然切回來還留著）",
  (await page.locator(".is-focused").count()) === 0,
);

/*
 * ── 反向驗證：X-62 的四個大分頁真的各自存在、各自畫得出自己那一塊 ──
 *
 * ⚠️ 上面那四條 EXPECTED 都是空陣列，所以**只有它們的話，
 *   「這四頁根本不存在」也會全綠**。這一段就是那個反面。
 *
 * ⚠️ 驗的是三件事，缺一不可：
 *   ① 側欄上點得到這四個大分頁（名字＝那張圖自己的區塊標題）
 *   ② 點下去之後，那一頁**自己那一塊**在畫面上而且有高度
 *   ③ 側欄底下**不列**同名的小分頁（同一個字在側欄出現兩層是噪音）
 */
console.log("\n══ X-62：四張圖各自一個大分頁 ══");
const CHART_PAGES = [
  ["losChart", "各路段 LOS 圖", "losChartSection"],
  ["speedTrend", "各路段歷季旅行速率", "speedTrendSection"],
  ["trendChart", "歷季趨勢（可勾選指標）", "trendPanel"],
  ["bandChart", "三段分法（順暢／尚可／壅塞）", "bandPanel"],
];
for (const [view, label, anchor] of CHART_PAGES) {
  const button = page.locator(`nav button[data-view="${view}"]`);
  ok(`① 側欄上有「${label}」這個大分頁`, (await button.count()) === 1);
  if (!(await button.count())) continue;
  ok(
    `① 大分頁的名字就是那張圖自己的標題`,
    (await button.innerText()).replace(/\s+/g, "") === label.replace(/\s+/g, ""),
    await button.innerText(),
  );
  await button.click();
  await page.waitForTimeout(700);
  /*
   * ⚠️ 空資料時 trendPanel／bandPanel 會被正確地藏起來（那是對的行為），
   *   所以這裡撐高度的方式與舊版一致：先確認元素在，再看它是不是
   *   「藏起來而且有一句話說明為什麼」——空白頁才是缺陷。
   */
  const state = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const view = el.closest(".view");
    return {
      hidden: el.hidden,
      height: Math.round(el.getBoundingClientRect().height),
      /* 這一頁上看得見的字（空白頁＝使用者不知道發生什麼事）。 */
      text: (view?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
      viewId: view?.id || "",
    };
  }, anchor);
  ok(
    `② 「${label}」那一塊就在這一頁上（#${anchor}）`,
    !!state && state.viewId === view,
    state ? `落在 #${state.viewId}` : "找不到那一塊",
  );
  ok(
    `⚠️ ② 這一頁不可以是一片空白（沒有資料時也要說得出為什麼）`,
    !!state && state.text.length >= 6,
    state ? state.text : "",
  );
  const listed = await page.evaluate(() =>
    [...document.querySelectorAll(".nav-section")].map((el) =>
      (el.textContent || "").trim(),
    ),
  );
  ok(
    `③ 側欄不列與大分頁同名的小分頁（同一個字兩層是噪音）`,
    !listed.includes(label),
    listed.join("、") || "（沒有小分頁）",
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 小分頁：列得出來、點得到、框得起來、字比大分頁小");
