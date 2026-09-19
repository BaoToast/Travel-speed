/*
 * ══════════════════════════════════════════════════════════════════════
 *  小分頁可以收合，而且不影響大分頁原本的跳轉
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（三支同步）：
 *   「使用者點選了大分頁後，會展開下面的小分頁，那能否做個**可以讓使用者
 *     把小分頁收合**的功能? ……因為**目前點選大分頁是會有跳轉功能的**，
 *     所以如果要做可以收合小分頁的功能的話，可能要想一下怎麼做」
 *
 * ⚠️ 衝突點是使用者自己先指出來的，所以這一支**兩邊都要驗**：
 *   ① 收合鈕：按了小分頁收起來
 *   ② 大分頁的文字區：按了**只跳轉、不收合**
 *   只驗①的話，把整列改成「按哪裡都收合」也會過——而那會把跳轉弄丟。
 *
 * ⚠️ 另外兩條容易被忽略的：
 *   ③ 收合之後大分頁**自己還在**（不是連它一起藏起來）
 *   ④ **點大分頁就要展開回來**——收合狀態不可以黏住（2026-09-14 改，原因見下面 ④）
 *   ⑤ 沒有小分頁的大分頁**不顯示**收合鈕（按下去毫無反應的鈕＝壞掉的鈕）
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
const server = createServer((request, response) => {
  const path = join(
    here,
    decodeURIComponent(request.url.split("?")[0]).replace(/^\//, "") ||
      "index.html",
  );
  if (!existsSync(path) || !path.startsWith(here)) {
    response.writeHead(404).end("nf");
    return;
  }
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1500, height: 950 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

/*
 * ══════════════════════════════════════════════════════════════════
 *  ⓪ 一載入就不可以有「看不見的空按鈕」
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 回報（附圖）：「左側分頁這個隱形按鈕是什麼，
 *   按了之後也沒任何反應，且直接消失」——側欄右側整排空框。
 *
 * ⚠️ 這一條刻意放在**做任何事之前**：那個毛病只在「首頁沒有小分頁」
 *   這個初始狀態下看得到。先切到有小分頁的分頁再量的話，
 *   applyNavCollapse() 已經跑過一次、把它們都藏好了——**量不到**。
 *   （第一版守門就是這樣全綠交出去的。）
 */
{
  const ghosts = await page.evaluate(() =>
    [...document.querySelectorAll(".nav-collapse")]
      .filter((el) => {
        if (el.hidden) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        const row = el.closest(".nav-row");
        const box = row?.nextElementSibling?.classList?.contains("nav-sections")
          ? row.nextElementSibling
          : null;
        /* 沒有小分頁可收，或按鈕上一個字都沒有 → 都是「幽靈按鈕」。 */
        return !box || !(el.textContent || "").trim();
      })
      .map((el) => {
        const row = el.closest(".nav-row");
        return (row?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 10);
      }),
  );
  ok(
    "⓪ 剛載入時（首頁沒有小分頁）側欄不可以有看不見的空按鈕",
    ghosts.length === 0,
    ghosts.join("、"),
  );
  /* 前置：確認真的量到按鈕，否則上面那條是恆真。 */
  const total = await page.locator(".nav-collapse").count();
  ok("⓪ 前置：側欄真的產出了收合鈕（否則上一條恆真）", total > 0, `${total} 顆`);
}

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "NAVCOL");
await page.fill("#projectName", "收合守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(700);

/* 用一個**確定有小分頁**的大分頁來驗（空資料環境下 LOS 圖表沒有）。 */
const VIEW = "speed";
await page.locator(`nav button[data-view="${VIEW}"]`).click();
await page.waitForTimeout(600);

const count = () => page.locator(".nav-section:visible").count();
const before = await count();
ok("前置：這個大分頁真的有小分頁（否則整支恆真）", before >= 2, `${before} 個`);
if (before < 2) {
  await browser.close();
  server.close();
  console.error("\n❌ 沒有小分頁可驗，不當成通過");
  process.exit(1);
}

const toggle = page.locator(`.nav-row:has(button[data-view="${VIEW}"]) .nav-collapse`);
ok("有小分頁的大分頁，右側看得到收合鈕", (await toggle.count()) === 1 && (await toggle.isVisible()));

/*
 * ⚠️ 標籤要寫**按下去會發生什麼**，不是目前狀態。
 *   使用者 2026-09-14：「小標籤寫著『展開』……展開後文字就變成『收合』」。
 *   只驗「有字」不夠——寫成永遠是「收合」也會過，所以兩種狀態都要量。
 */
/*
 * ⚠️ 2026-09-15 改法：箭頭**永遠是 ▼**，收合狀態靠 **CSS 轉 -90 度**。
 *
 *   原本是展開印 ▾、收合印 ▸。那兩個字（U+25BE／U+25B8）**不在 Big5**，
 *   微軟正黑體畫不出來，在某些電腦上是一片空白——使用者 2026-09-15：
 *   「這個圖示比較重要，是讓人可以展開／收合的按鈕，
 *     所以請以**任何電腦都能看到**為前題去設計」。
 *   ▼（U+25BC，Big5 A1B9）一定畫得出來。
 *
 * ⚠️ 所以這裡要量的是**實際轉了幾度**，不是字元。
 *   量字元的話，一個「兩種狀態都不轉」的實作照樣全綠——
 *   而使用者看到的就是箭頭永遠朝下、按了沒反應。
 */
const caretAngle = async () =>
  toggle.evaluate((el) => {
    const t = getComputedStyle(el).transform;
    if (!t || t === "none") return 0;
    const m = t.match(/matrix\(([^)]+)\)/);
    if (!m) return 0;
    const [a, b] = m[1].split(",").map(Number);
    return Math.round((Math.atan2(b, a) * 180) / Math.PI);
  });
ok(
  "箭頭用的是 Big5 一定有的 ▼（不是畫不出來的 ▾／▸）",
  (await toggle.innerText()).trim() === "▼",
  (await toggle.innerText()).trim(),
);
ok(
  "展開狀態下箭頭朝下（沒有轉角度）",
  Math.abs(await caretAngle()) <= 1,
  `轉了 ${await caretAngle()} 度`,
);

/* ① 收合 */
await toggle.click();
await page.waitForTimeout(400);

ok("① 按收合鈕之後小分頁收起來", (await count()) === 0, `剩 ${await count()} 個`);
ok(
  "③ 大分頁本身還在，而且仍然是選取狀態",
  (await page.locator(`nav button[data-view="${VIEW}"].active`).count()) === 1,
);
ok(
  "收合後 aria-expanded 要是 false（給螢幕報讀器看的狀態要跟著走）",
  (await toggle.getAttribute("aria-expanded")) === "false",
);
ok(
  "收合狀態下箭頭改成朝右（轉 -90 度；字仍然是 ▼）",
  Math.abs((await caretAngle()) + 90) <= 1 &&
    (await toggle.innerText()).trim() === "▼",
  `轉了 ${await caretAngle()} 度、字是「${(await toggle.innerText()).trim()}」`,
);

/*
 * ④ **點大分頁就要展開回來**（收合狀態不可以黏住）
 *
 * ⚠️ 這一條取代了舊版的「重新整理之後收合狀態還記得」。
 *
 *   舊版把收合狀態寫進 localStorage，於是使用者 2026-09-14（附圖）回報：
 *     「當我點選 交通服務水準的 大分頁標題(路段管理)時，它並沒有展開
 *       而是保持收合，請修正成自動展開下面的各項小分頁」
 *   ——按過一次收合鈕之後，那一頁就**永遠**是收的，只有再去按一次
 *   收合鈕才展得開。使用者當然會以為分頁壞了。
 *
 *   而「記住收合」在這支程式裡根本不會被用到：重新整理一律回操作首頁，
 *   要回到那一頁就一定得點它一下。所以那份記錄唯一做得到的事，
 *   就是製造上面那個毛病。現在改成：點大分頁＝我要看這一頁＝展開。
 *
 * ⚠️ 這裡**目前是收合狀態**（上面剛按過收合鈕），所以先切到別頁再點回來，
 *   模擬使用者真正的動線；直接在原地點也要能展開，下面另外驗。
 */
await page.locator('nav button[data-view="summary"]').click();
await page.waitForTimeout(500);
await page.locator(`nav button[data-view="${VIEW}"]`).click();
await page.waitForTimeout(600);
ok(
  "④ 收合之後離開再點回這個大分頁，小分頁要自動展開",
  (await count()) === before,
  `${await count()} / ${before}`,
);

/* ④-2 停在原地再點一次同一顆大分頁，也要展開（使用者就是這樣點的）。 */
await page
  .locator(`.nav-row:has(button[data-view="${VIEW}"]) .nav-collapse`)
  .click();
await page.waitForTimeout(400);
ok("④-2 前置：先把它收起來（沒收起來的話下一條恆真）", (await count()) === 0, `剩 ${await count()} 個`);
await page.locator(`nav button[data-view="${VIEW}"]`).click();
await page.waitForTimeout(600);
ok(
  "④-2 已經在這一頁了，再點一次大分頁也要展開",
  (await count()) === before,
  `${await count()} / ${before}`,
);

/* 收合鈕本身還是要能用（不可以為了自動展開就把收合做死）。 */
await page
  .locator(`.nav-row:has(button[data-view="${VIEW}"]) .nav-collapse`)
  .click();
await page.waitForTimeout(400);
ok("收合鈕仍然收得起來", (await count()) === 0, `剩 ${await count()} 個`);
await page
  .locator(`.nav-row:has(button[data-view="${VIEW}"]) .nav-collapse`)
  .click();
await page.waitForTimeout(400);
ok("再按一次展開回來", (await count()) === before, `${await count()} / ${before}`);

/*
 * ② 大分頁的文字區只跳轉、不收合。
 *
 * ⚠️ 這一條是這支守門的重點：使用者明確說跳轉功能不能因此弄丟。
 *   先切到別頁，再點回來——小分頁必須還在。
 */
await page.locator('nav button[data-view="summary"]').click();
await page.waitForTimeout(500);
await page.locator(`nav button[data-view="${VIEW}"]`).click();
await page.waitForTimeout(600);
ok(
  "② 點大分頁的文字區只跳轉、不收合",
  (await count()) === before,
  `${await count()} / ${before}`,
);
ok(
  "② 而且真的跳過去了（那一頁是顯示中的）",
  await page.locator(`#${VIEW}.view.active`).isVisible(),
);

/* ⑤ 沒有小分頁的大分頁不顯示收合鈕 */
const noSub = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".nav-row")];
  const out = [];
  for (const row of rows) {
    const box = row.nextElementSibling?.classList?.contains("nav-sections")
      ? row.nextElementSibling
      : null;
    const toggleEl = row.querySelector(".nav-collapse");
    if (!box && toggleEl && !toggleEl.hidden)
      out.push((row.textContent || "").trim().slice(0, 12));
  }
  return out;
});
ok(
  "⑤ 沒有小分頁的大分頁不可以出現收合鈕",
  noSub.length === 0,
  noSub.join("、"),
);

/* ══ ⑥ 箭頭要真的置中（使用者 2026-09-17 附圖回報）══════════════
 *
 * 使用者三支各附一張圖：路口轉向偏左、全日交通量偏右、交通服務水準偏左。
 *
 * ⚠️ 量的是**關係不是像素**：箭頭字形的水平中心與按鈕的水平中心要對齊。
 *   寫死「距離左邊界幾 px」的話，改個字級或按鈕寬度就會誤紅，
 *   而紅的是門檻不是按鈕。
 *
 * ⚠️ 用 Range 量**字形本身**的框，不是量按鈕的框。
 *   量按鈕等於拿它自己跟自己比，永遠置中——那是一條恆真的守門，
 *   正是我們反覆踩過的那一類。
 */
const carets = await page.evaluate(() => {
  const out = [];
  for (const button of document.querySelectorAll("nav .nav-collapse")) {
    if (button.hidden) continue;
    const node = button.firstChild;
    if (!node || node.nodeType !== 3) continue;
    const range = document.createRange();
    range.selectNodeContents(button);
    const glyph = range.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    if (glyph.width < 1 || box.width < 1) continue;
    out.push({
      text: (button.textContent || "").trim(),
      dx: +(glyph.left + glyph.width / 2 - (box.left + box.width / 2)).toFixed(2),
      dy: +(glyph.top + glyph.height / 2 - (box.top + box.height / 2)).toFixed(2),
    });
  }
  return out;
});
ok(
  "前置：量得到收合鈕裡的箭頭（0 顆的話下一條恆真）",
  carets.length > 0,
  `${carets.length} 顆`,
);
const offCenter = carets.filter((c) => Math.abs(c.dx) > 1 || Math.abs(c.dy) > 1.5);
ok(
  "⚠️ ⑥ 箭頭在收合鈕裡要置中（使用者回報偏一邊）",
  carets.length > 0 && offCenter.length === 0,
  offCenter.length
    ? offCenter.map((c) => `「${c.text}」橫 ${c.dx}px／縱 ${c.dy}px`).join("、")
    : `最大偏移 橫 ${Math.max(...carets.map((c) => Math.abs(c.dx)))}px／縱 ${Math.max(...carets.map((c) => Math.abs(c.dy)))}px`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 小分頁可收合、可記住；大分頁的跳轉一個字都沒改");
