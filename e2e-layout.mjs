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
    return { overflow, wide: wide.slice(0, 4), flushHeads: flushHeads.slice(0, 4), misaligned: misaligned.slice(0, 4) };
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
  const items = [...nav.children].map((node) => ({
    tag: node.tagName,
    zone: node.classList.contains("nav-zone"),
    text: node.textContent.trim(),
    view: node.dataset?.view || "",
  }));
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

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
