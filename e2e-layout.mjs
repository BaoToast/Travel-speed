/*
 * 排版量測：走過每一個分頁，用瀏覽器實際量出來的座標判斷有沒有沾黏或溢出。
 *
 * 量三件事：
 *  A. 整頁有沒有橫向捲動（overflow）
 *  B. 卡片標題有沒有貼著卡片邊框（整張卡忘了寫內距時就會這樣）
 *  C. 卡片內的表格第一欄與段落有沒有比標題更靠左
 *
 * 只印數字與判定，不靠截圖目視。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
  const path = join(here, decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html");
  if (!existsSync(path) || !path.startsWith(here)) return void res.writeHead(404).end("not found");
  res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const WIDTHS = [640, 760, 900, 1024, 1180, 1280, 1440, 1680, 1920];

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

/* 先灌一點資料進去，空畫面量不到東西。 */
const SAMPLE_DIR = join(here, "test-fixtures");
if (existsSync(SAMPLE_DIR)) {
  const files = readdirSync(SAMPLE_DIR).filter((n) => /報告測試路段/.test(n));
  await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
  await page.fill("#projectCode", "LAY");
  await page.fill("#projectName", "排版量測計畫");
  await page.click("#saveProject");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: 0 });
  await page.setInputFiles("#files", files.map((name) => ({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLE_DIR, name)),
  })));
  await page.click("#preview");
  await page.waitForTimeout(3000);
  await page.click("#commit");
  await page.waitForTimeout(1500);
}

const views = await page.$$eval("nav button", (els) =>
  els.map((el) => el.dataset.view).filter(Boolean),
);
console.log("分頁：", views.join("、"));

async function measure() {
  return page.evaluate(() => {
    const view = document.documentElement.clientWidth;
    const active = document.querySelector(".view.active") || document.body;
    const overflow = document.documentElement.scrollWidth - view;
    const wide = [];
    if (overflow > 1)
      for (const el of active.querySelectorAll("*")) {
        const box = el.getBoundingClientRect();
        if (box.right > view + 1 && getComputedStyle(el).overflowX !== "auto")
          wide.push(el.tagName + "." + (el.className || "") + "@" + Math.round(box.right));
      }
    /*
     * ── 按鈕文字被裁掉 ────────────────────────────────────────
     *
     * 使用者 2026-09-16（附圖）：「新增/更新這一…按鍵，文字超出按鈕大小」。
     *
     * ⚠️ 既有的「橫向溢出」抓不到這一種：按鈕本身乖乖待在版面裡，
     *   溢出的是**按鈕裡面的字**。判準是 scrollWidth > clientWidth。
     * ⚠️ 沒畫出來的按鈕（收起來的分頁裡）一律跳過，否則整支恆紅。
     */
    const clippedButtons = [];
    for (const el of active.querySelectorAll("button")) {
      if (!el.getClientRects().length) continue;
      const text = (el.textContent || "").trim();
      if (!text) continue;
      const over = el.scrollWidth - el.clientWidth;
      if (over > 1)
        clippedButtons.push(`「${text.slice(0, 16)}」多 ${Math.round(over)}px`);
    }
    const flushHeads = [];
    const misaligned = [];
    for (const card of active.querySelectorAll(".panel")) {
      const cardBox = card.getBoundingClientRect();
      if (cardBox.height < 8) continue;
      const heads = [...card.querySelectorAll("h3, .eyebrow, legend")].filter(
        (el) => el.closest(".panel") === card,
      );
      if (!heads.length) continue;
      for (const head of heads) {
        const gap = head.getBoundingClientRect().left - cardBox.left;
        if (gap < 6 && head.getBoundingClientRect().width > 0)
          flushHeads.push(
            (card.className || "panel") + "「" + (head.textContent || "").trim().slice(0, 18) + "」" + Math.round(gap) + "px",
          );
      }
      const headLeft = Math.min(...heads.map((el) => el.getBoundingClientRect().left));
      for (const el of card.querySelectorAll("table th:first-child, table td:first-child")) {
        if (el.closest(".panel") !== card) continue;
        if (!(el.textContent || "").trim()) continue;
        /*
         * ⚠️ 沒有畫出來的東西不可以拿來量對齊。
         *
         *   hidden 的區塊（例如「有覆寫指到已經不存在的路段」那一塊，
         *   平常完全不出現）其 getBoundingClientRect() 全是 0，
         *   於是 textLeft 是 0、headLeft 是實際的左緣，一減就變成
         *   「少了 299px」——**一個看不到的東西被判定成沒對齊**。
         *   2026-09-15 加上那一塊之後，這一支在九種寬度上全部紅字，
         *   而畫面上一切正常。
         *
         *   getClientRects().length === 0 就是「這個元素沒有被畫出來」
         *  （display:none、hidden 屬性、祖先被收起來都算）。
         *   ⚠️ 不可以改用 width===0：真的被壓成 0 寬的欄位是**要抓**的問題。
         */
        if (!el.getClientRects().length) continue;
        const style = getComputedStyle(el);
        const textLeft = el.getBoundingClientRect().left + (parseFloat(style.paddingLeft) || 0);
        if (textLeft - headLeft < -3) {
          misaligned.push(
            (card.className || "panel") + "「" + (el.textContent || "").trim().slice(0, 14) + "」少 " +
              Math.round(headLeft - textLeft) + "px",
          );
          break;
        }
      }
    }
    return {
      overflow,
      wide: wide.slice(0, 4),
      flushHeads: flushHeads.slice(0, 4),
      misaligned: misaligned.slice(0, 4),
      clippedButtons: clippedButtons.slice(0, 6),
    };
  });
}

console.log("\n══ 逐分頁量測（1440px）══");
for (const id of views) {
  await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), id);
  await page.waitForTimeout(450);
  const m = await measure();
  console.log(
    `【${id}】溢出 ${m.overflow}｜標題貼邊 ${m.flushHeads.length}｜表格未對齊 ${m.misaligned.length}`,
  );
  ok(`${id}：沒有橫向溢出`, m.overflow <= 1, `${m.overflow}px ${m.wide.join(", ")}`);
  ok(`${id}：卡片標題都有內距`, m.flushHeads.length === 0, m.flushHeads.join("；"));
  ok(`${id}：表格第一欄與標題對齊`, m.misaligned.length === 0, m.misaligned.join("；"));
  ok(
    `${id}：按鈕文字沒有被裁掉`,
    m.clippedButtons.length === 0,
    m.clippedButtons.join("；"),
  );
}

console.log("\n══ 多寬度掃描 ══");
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 1000 });
  await page.waitForTimeout(250);
  const bad = [];
  for (const id of views) {
    await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), id);
    await page.waitForTimeout(220);
    const m = await measure();
    if (m.overflow > 1) bad.push(`${id} 溢出 ${m.overflow}px（${m.wide[0] || ""}）`);
    if (m.flushHeads.length) bad.push(`${id} 標題貼邊 ${m.flushHeads.length} 處`);
    if (m.misaligned.length) bad.push(`${id} 表格未對齊 ${m.misaligned.length} 處`);
    if (m.clippedButtons.length)
      bad.push(`${id} 按鈕文字被裁 ${m.clippedButtons.length} 處（${m.clippedButtons[0]}）`);
  }
  ok(`寬度 ${width}px 全分頁乾淨`, bad.length === 0, bad.join("；"));
}

/* ── 側欄分區與「判定標準」獨立頁 ── */
/*
 * 使用者的要求：「讓使用者一目了然知道資料匯入區、參數設定區、圖表區、
 * 多計劃比較區等等各大功能區。」
 *
 * ⚠️ 假通過陷阱：
 *  一、只驗「側欄有小標」擋不住——加了小標但按鈕沒歸類一樣會過。
 *      要驗**每一顆按鈕都落在某一個小標底下**，一顆都不能落單。
 *  二、只驗「有判定標準這一頁」不夠——頁面在但設定沒搬過去、
 *      或搬過去卻沒接上程式，照樣會過。要驗那兩組設定的元素真的在
 *      那一頁裡，而且尖峰彙總留下了摘要與去設定的入口。
 */
const navZones = await page.evaluate(() => {
  const nav = document.querySelector("nav");
  /*
   * ⚠️ 2026-09-13 起大分頁按鈕被包進 .nav-row（右側要放收合鈕，
   *   而按鈕不可以巢狀在按鈕裡）。這裡要**看穿那一層**，
   *   否則 nav.children 全是 DIV，下面每一條都會變成恆真——
   *   實測就是這樣：按鈕數變成 0、分區檢查空跑全綠，
   *   只有「前置：要有十顆以上」那一條把它擋下來。
   */
  const items = [...nav.children].map((node) => {
    const button = node.classList?.contains("nav-row")
      ? node.querySelector("button[data-view]")
      : null;
    const target = button || node;
    return {
      tag: target.tagName,
      zone: node.classList.contains("nav-zone"),
      /* 收合鈕的符號不可以混進按鈕文字裡。 */
      text: (button || node).textContent.trim(),
      view: target.dataset?.view || "",
    };
  });
  /* 每一顆按鈕前面最近的那個小標，就是它所屬的區。 */
  let current = null;
  const orphan = [];
  const grouped = [];
  for (const item of items) {
    if (item.zone) { current = item.text; continue; }
    if (item.tag !== "BUTTON") continue;
    if (!current) orphan.push(item.text);
    else grouped.push([current, item.text, item.view]);
  }
  const standards = document.getElementById("standards");
  return {
    zoneTitles: items.filter((item) => item.zone).map((item) => item.text),
    buttons: items.filter((item) => item.tag === "BUTTON").length,
    grouped,
    orphan,
    /* 「開始」那一區（操作首頁、新手說明）刻意沒有小標，不算落單。 */
    orphanAllowed: ["操作首頁", "新手說明"],
    standardsExists: Boolean(standards),
    standardsHasLos: Boolean(standards?.querySelector("#losA")),
    standardsHasBand: Boolean(standards?.querySelector("#bandSmoothEnd")),
    summaryHasShortcut: Boolean(document.querySelector('#summary [data-goto="standards"]')),
    summaryStillHasRules: Boolean(document.querySelector("#summary #losA")),
  };
});
ok(
  "側欄要分成五個功能區",
  navZones.zoneTitles.length >= 5,
  navZones.zoneTitles.join("｜"),
);
{
  const stray = navZones.orphan.filter(
    (text) => !navZones.orphanAllowed.includes(text),
  );
  ok(
    "每一顆側欄按鈕都要歸在某一區底下，不可以有落單的",
    stray.length === 0,
    stray.join("、"),
  );
}
ok(
  "前置：側欄要真的有十顆以上的按鈕（擴充頁沒掛上的話上面會變成恆真）",
  navZones.buttons >= 12,
  `${navZones.buttons} 顆`,
);
ok(
  "「判定標準」要是獨立的一頁",
  navZones.standardsExists,
);
ok(
  "服務水準門檻要搬到「判定標準」頁",
  navZones.standardsHasLos && !navZones.summaryStillHasRules,
  `判定標準頁有門檻 ${navZones.standardsHasLos}／尖峰彙總還留著 ${navZones.summaryStillHasRules}`,
);
ok(
  "三段分法也要在「判定標準」頁",
  navZones.standardsHasBand,
);
ok(
  "尖峰彙總要留下「目前是怎麼判的」摘要與前往設定的入口",
  navZones.summaryHasShortcut,
);

/* ── 側欄要捲得到最後一個項目 ── */
/*
 * ⚠️ 分區之後側欄多了 5 個小標、項目 16 個，在較矮的螢幕上最後一區會被
 * 底部那行狀態文字蓋住而且捲不到——功能還在，但按不到，等於不見了。
 * 實測 820px 高的視窗就會發生。
 *
 * 假通過陷阱：只驗「側欄有 overflow:auto」擋不住——設了 auto 但外層沒有
 * 給高度一樣捲不動。要**真的把它捲到底，再量最後一顆按鈕在不在視窗內**。
 */
/*
 * 視窗高度刻意取 640px（筆電開了瀏覽器工具列之後很常見的高度）。
 * 取太高的話側欄本來就塞得下，這一段會變成恆真——實測 780px 就已經
 * 剛好塞得下，量不出差別。
 */
await page.setViewportSize({ width: 1280, height: 640 });
await page.waitForTimeout(200);
const navReach = await page.evaluate(() => {
  const nav = document.querySelector("aside nav");
  const local = document.querySelector("aside .local");
  if (!nav) return { error: "找不到側欄選單" };
  const buttons = [...nav.querySelectorAll("button[data-view]")];
  const last = buttons[buttons.length - 1];
  nav.scrollTop = nav.scrollHeight;
  const box = last.getBoundingClientRect();
  const localBox = local?.getBoundingClientRect();
  return {
    count: buttons.length,
    lastText: last.textContent.trim(),
    inViewport: box.bottom <= window.innerHeight + 1 && box.top >= -1,
    aboveStatus: !localBox || box.bottom <= localBox.top + 1,
    bottom: Math.round(box.bottom),
    statusTop: localBox ? Math.round(localBox.top) : null,
  };
});
ok(
  "前置：側欄要有夠多按鈕（太少的話捲不捲得動驗不出來）",
  !navReach.error && navReach.count >= 12,
  navReach.error || `${navReach.count} 顆`,
);
ok(
  "捲到底時，側欄最後一個項目要完整看得到",
  navReach.inViewport,
  `「${navReach.lastText}」底端 ${navReach.bottom}px、視窗高 640px`,
);
ok(
  /*
   * ⚠️ 這一項一定要「同時」看在不在視窗內——只比對「按鈕底端 ≤ 狀態列頂端」
   * 的話，兩者一起被推到視窗外時（1048px vs 1072px）依然成立，
   * 就變成一個永遠不會紅的守門。
   */
  "側欄最後一個項目不可以被底部的狀態列蓋住",
  navReach.aboveStatus && navReach.inViewport,
  `按鈕底端 ${navReach.bottom}px、狀態列頂端 ${navReach.statusTop}px`,
);
await page.setViewportSize({ width: 1440, height: 1000 });
await page.waitForTimeout(200);

/* ── 按鈕上的字要看得見 ── */
/*
 * 使用者實際回報：「下載可編輯趨勢圖按鍵的說明文字被按鈕本身的深藍色
 * 遮蓋住了，看不清楚寫了什麼。」
 *
 * 成因是一條沒寫 color 的規則：按鈕裡的 <small> 被 `.panel-head small
 * {color:var(--muted)}` 塗成灰色，白底的按鈕看得到，深藍底的那顆
 * 對比只有 1.6:1——等於看不見。**只有其中一顆壞掉**，所以肉眼掃過去
 * 很容易漏掉，必須用量的。
 *
 * ⚠️ 假通過陷阱：只驗「字有沒有設 color」擋不住——設了灰色也是有設。
 * 只驗「按鈕上有文字」更擋不住。要**真的算對比度**：取元素的實際
 * 文字色與它背後那一層的實際背景色，照 WCAG 的相對亮度公式算。
 * 門檻取 4.5:1（WCAG AA 的一般文字標準）。
 */
const contrastProbe = () => {
  const lum = (rgb) => {
    const parts = rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
    const chan = parts.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  };
  /* 往上找到第一個不透明的背景色——按鈕的字是畫在按鈕自己的底色上。 */
  const backdrop = (node) => {
    let cursor = node;
    while (cursor && cursor !== document.documentElement) {
      const bg = getComputedStyle(cursor).backgroundColor;
      const alpha = bg.match(/[\d.]+/g);
      if (bg && alpha && (alpha.length < 4 || Number(alpha[3]) > 0.9)) return bg;
      cursor = cursor.parentElement;
    }
    return "rgb(255,255,255)";
  };
  const out = [];
  for (const node of document.querySelectorAll(
    "button small, button b, button span",
  )) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = getComputedStyle(node);
    const fg = lum(style.color);
    const bg = lum(backdrop(node));
    const ratio =
      (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    out.push({
      text: (node.textContent || "").trim().slice(0, 24),
      color: style.color,
      background: backdrop(node),
      ratio: Number(ratio.toFixed(2)),
    });
  }
  return out;
};
/*
 * 每一個分頁都要走一遍——沒有 active 的分頁是 display:none，
 * getBoundingClientRect 全部是 0，量不到任何東西（第一次寫就踩到了：
 * 「量到 0 段」，而對比那一項因此變成恆真的綠字）。
 */
const contrast = [];
for (const id of views) {
  await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), id);
  await page.waitForTimeout(220);
  contrast.push(...(await page.evaluate(contrastProbe)));
}
ok(
  "前置：要真的量到按鈕裡的補充文字（量不到的話下一項會變成恆真）",
  contrast.length > 0,
  `量到 ${contrast.length} 段`,
);
{
  const bad = contrast.filter((item) => item.ratio < 4.5);
  ok(
    "按鈕上的補充說明文字要看得清楚（與按鈕底色的對比 ≥ 4.5:1）",
    bad.length === 0,
    bad
      .map((item) => `「${item.text}」${item.ratio}:1（字 ${item.color}／底 ${item.background}）`)
      .join("；"),
  );
}

/* ══════════════════════════════════════════════════════════════════════
 *  #3：執行期**全頁**對比掃描（2026-09-29 補，使用者裁示的第一類）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 原本只有兩種對比檢查，兩種都不夠：
 *   ・`text-contrast.test.mjs`：**靜態**掃樣式表的字面色，一律假設白底。
 *     `color: var(--x)` 與「同一條規則自己也改了底色」那兩類是 2026-09-29
 *     才補上的，但它終究看不到「實際疊在什麼底色上」。
 *   ・上面那一段：只掃 `button small, button b, button span`。
 *
 * 這一段改成**逐頁走過、量每一個真的畫出來的文字節點**，底色是**往上找到
 * 第一個不透明背景**——也就是使用者眼睛實際看到的那一組。
 *
 * ⚠️ 側欄（`aside`）也要掃，它是深底白字，一起量才抓得到「深底上用了深字」。
 * ⚠️ 只量**真的有文字**而且**真的畫出來**的節點；沒畫出來的（收起來的分頁）
 *   一律跳過，否則整支恆紅。
 * ⚠️ 只量**葉節點**的文字：容器的 `textContent` 會把子孫的字一起算進來，
 *   於是同一段字被量好幾次，而底色取的是容器的——那會產生一堆假的紅。
 * ⚠️ 停用中的控制項一律豁免（WCAG 1.4.3 明文排除，改亮反而讓人以為按得下去）。
 * ⚠️ 大字（≥ 24px 或 ≥ 19px 且粗體）的門檻是 AA 的 3:1，不是 4.5:1。
 */
const fullPageProbe = () => {
  const lum = (rgb) => {
    const parts = (rgb.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    const chan = parts.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  };
  /*
   * ⚠️ 往上找底色時，**漸層底要當成「量不了」而不是「透明」**。
   *
   *   `.hero` 之類的深色漸層是用 `background: linear-gradient(...)` 畫的，
   *   它的 `backgroundColor` 是 `rgba(0,0,0,0)`。第一版只看 backgroundColor，
   *   於是一路往上撿到 `--bg`（淺灰），把「深漸層上的白字」量成
   *   「淺灰底上的白字 1.08:1」——**31 處假的紅**，而那一區其實是對的。
   *
   *   回 `null` 表示「這個節點的底色量不了」，呼叫端要**跳過並計數**，
   *   不可以安靜忽略（豁免必須看得見，這是這一組系統的既有規則）。
   */
  const backdrop = (node) => {
    let cursor = node;
    while (cursor && cursor !== document.documentElement) {
      const style = getComputedStyle(cursor);
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      const bg = style.backgroundColor;
      const alpha = bg.match(/[\d.]+/g);
      if (bg && alpha && (alpha.length < 4 || Number(alpha[3]) > 0.9)) return bg;
      cursor = cursor.parentElement;
    }
    return "rgb(255, 255, 255)";
  };
  const out = [];
  let gradientSkipped = 0;
  const roots = [document.querySelector(".view.active"), document.querySelector("aside")];
  for (const root of roots) {
    if (!root) continue;
    for (const node of root.querySelectorAll("*")) {
      /* 葉節點才量：容器會把子孫的字一起算進來，底色卻取容器的。 */
      if (node.children.length) continue;
      if (node.disabled) continue;
      const text = (node.textContent || "").trim();
      if (!text) continue;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || Number(style.opacity) < 0.1) continue;
      const size = parseFloat(style.fontSize) || 16;
      const bold = Number(style.fontWeight) >= 700;
      const large = size >= 24 || (size >= 19 && bold);
      const ground = backdrop(node);
      if (ground === null) {
        gradientSkipped += 1;
        continue;
      }
      const fg = lum(style.color);
      const bg = lum(ground);
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      out.push({
        where: root.tagName === "ASIDE" ? "側欄" : "內容",
        text: text.slice(0, 24),
        color: style.color,
        background: ground,
        ratio: Number(ratio.toFixed(2)),
        need: large ? 3 : 4.5,
      });
    }
  }
  return { rows: out, gradientSkipped };
};
const fullPage = [];
let gradientSkipped = 0;
for (const id of views) {
  await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), id);
  await page.waitForTimeout(220);
  const probe = await page.evaluate(fullPageProbe);
  fullPage.push(...probe.rows);
  gradientSkipped += probe.gradientSkipped;
}
{
  const bad = fullPage.filter((item) => item.ratio < item.need);
  /*
   * ⚠️ 前置檢查：量不到東西時不可以算通過。
   *   第一次寫這一段時判斷式寫錯，量到 0 個節點而整支綠——
   *   那正是「假的綠」最典型的長相。
   */
  ok(
    `#3 前置：全頁對比掃描真的量到文字節點（實測 ${fullPage.length} 個）`,
    fullPage.length >= 200,
    `只量到 ${fullPage.length} 個，判斷式或走頁邏輯壞了嗎？`,
  );
  /*
   * ⚠️ 漸層底上的文字量不了，所以被跳過——這件事一定要印出來。
   *   安靜跳過就等於一個看不見的豁免清單；而豁免最容易出事
   *  （這一組系統踩過：新車種徽章 2.45:1 就是靠豁免活下來的）。
   *   那幾處由 `text-contrast.test.mjs` 的 `ON_COLOR` 逐組釘住前景／背景。
   */
  ok(
    `#3 漸層底上的文字跳過並計數（實測 ${gradientSkipped} 處，由 text-contrast 的 ON_COLOR 釘住）`,
    gradientSkipped > 0,
    "一處都沒跳過——漸層底的判斷是不是壞了？那會讓深漸層上的白字被量成淺底 1.08:1",
  );
  ok(
    "#3 側欄也真的掃到了（深底白字那一區）",
    fullPage.some((item) => item.where === "側欄"),
    "一個側欄節點都沒量到——深底上用了深字這一類就抓不到",
  );
  ok(
    "#3 全頁每一段文字在它實際的底色上都要過 AA（大字 3:1、其餘 4.5:1）",
    bad.length === 0,
    bad
      .slice(0, 8)
      .map(
        (item) =>
          `${item.where}「${item.text}」${item.ratio}:1（需 ${item.need}；字 ${item.color}／底 ${item.background}）`,
      )
      .join("；") + (bad.length > 8 ? `…共 ${bad.length} 處` : ""),
  );
}

/* ══════════════════════════════════════════════════════════════════════
 *  #54：側欄的文字也不可以被裁掉（2026-09-29 補）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 既有的裁字掃描只掃 `.view.active` 裡的 `<button>`，**不含 `aside`**。
 * 側欄的分頁名稱是這一支最長的那幾串字（例如「各路段歷季旅行速率」），
 * 它被裁掉的話使用者根本不知道那一頁叫什麼。
 */
{
  const clipped = await page.evaluate(() => {
    const out = [];
    const aside = document.querySelector("aside");
    if (!aside) return out;
    for (const node of aside.querySelectorAll("button, small, span, b")) {
      if (!node.getClientRects().length) continue;
      const text = (node.textContent || "").trim();
      if (!text) continue;
      const over = node.scrollWidth - node.clientWidth;
      if (over > 1) out.push(`「${text.slice(0, 20)}」多 ${Math.round(over)}px`);
    }
    return out;
  });
  ok(
    "#54 側欄的文字不可以被裁掉",
    clipped.length === 0,
    clipped.slice(0, 6).join("；"),
  );
}

/* ══════════════════════════════════════════════════════════════════════
 *  #11／#36：同一頁的卡片兩兩不可以互相重疊（2026-09-29 補）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 既有的版面檢查量的是「有沒有被裁」「有沒有橫向溢出」「說明有沒有蓋住圖」，
 * **沒有任何一支在做兩兩比對**。兩張卡片互相疊上去時，底下那一張的內容
 * 看不到，而上面每一項檢查都會通過。
 *
 * ⚠️ 要在**幾個縮放倍率**下都掃：重疊幾乎都是在 110%／125% 這種
 *   「寬度不夠但還沒觸發斷點」的區間才出現。
 * ⚠️ 判準留 2px 容差：相鄰邊框、負邊距這種設計上的貼合不算重疊。
 * ⚠️ 只比**同一層**的卡片（`parentElement` 相同）。父子本來就包含關係，
 *   拿它們去比會得到一堆假的紅。
 */
{
  const overlapProbe = () =>
    page.evaluate(() => {
      const out = [];
      const active = document.querySelector(".view.active");
      if (!active) return out;
      const cards = [...active.querySelectorAll(".panel")].filter(
        (el) => el.getClientRects().length,
      );
      const label = (el) =>
        (el.querySelector("h2, h3")?.textContent || el.className || el.id || "（無標題）")
          .trim()
          .slice(0, 22);
      for (let i = 0; i < cards.length; i += 1)
        for (let j = i + 1; j < cards.length; j += 1) {
          const a = cards[i];
          const b = cards[j];
          if (a.parentElement !== b.parentElement) continue;
          if (a.contains(b) || b.contains(a)) continue;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (overlapX > 2 && overlapY > 2)
            out.push(
              `「${label(a)}」與「${label(b)}」重疊 ${Math.round(overlapX)}×${Math.round(overlapY)}px`,
            );
        }
      return out;
    });
  const overlaps = [];
  let probed = 0;
  for (const zoom of [1, 1.1, 1.25, 1.5]) {
    await page.evaluate((z) => {
      document.documentElement.style.zoom = String(z);
    }, zoom);
    for (const id of views) {
      await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), id);
      await page.waitForTimeout(160);
      probed += 1;
      for (const hit of await overlapProbe())
        overlaps.push(`縮放 ${Math.round(zoom * 100)}%｜${hit}`);
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  ok(
    `#11／#36 前置：真的走過每一頁 × 每一個縮放（實測 ${probed} 次）`,
    probed >= views.length * 4,
    `只走了 ${probed} 次，走頁或縮放邏輯壞了嗎？`,
  );
  ok(
    "#11／#36 同一頁的卡片兩兩不可以互相重疊（1／1.1／1.25／1.5 倍）",
    overlaps.length === 0,
    overlaps.slice(0, 6).join("；") +
      (overlaps.length > 6 ? `…共 ${overlaps.length} 處` : ""),
  );
}

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
