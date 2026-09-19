/**
 * ══════════════════════════════════════════════════════════════════════
 *  一圖一說明：配對正確、圖在自己那一塊裡釘住、放不下就自動改上下排
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一支涵蓋**兩種版面**，不要拆開：
 *
 *   甲、`.figure-rows` ＞ `.figure-row`（歷季趨勢、三段分法）
 *       使用者 2026-09-10／13：
 *         「LOS圖表 我在看右邊文字說明時，往下滑動，圖直接滑離開畫面」
 *         「當我把所有圖表都打勾的話，同時有好多個圖片要看，說明文字也暴增，
 *           根本做不到圖片保持可見＋配合文字說明。」
 *       舊版是「左邊一整排圖、右邊一整排說明」，兩排各自排列、只靠**順序**對應：
 *       勾 8 張時第 5 段說明旁邊是第 2 張圖。再怎麼調 sticky 都救不回來，
 *       因為要釘住的目標本來就不只一個。現在一張圖＋它自己的說明＝一個 .figure-row。
 *
 *   乙、`.chart-grid` ＞ `.chart-card`（各路段 LOS 圖、各路段歷季旅行速率）
 *       使用者 2026-09-15：
 *         「有些圖和說明文字本來就是左右並排了……那應該一開始就要做成左右並排，
 *           然後圖固定在左邊？這項一定要用肉眼確認，且同步到三份程式」
 *       這兩塊原本是「一排兩張卡、說明在圖下面」，2026-09-15 改成
 *       「一列一張、圖在左 sticky、說明在右」。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**只驗 CSS 字串不算數。** container query 可能沒生效、可能被更具體的
 *     規則蓋過。這裡量的是 getBoundingClientRect 的實際座標。
 * 二、**只驗一種寬度不算數。** 一個「永遠並排」的實作在寬視窗會過，
 *     窄的時候說明卻被壓成一條；一個「永遠上下排」的在窄的時候會過。
 *     所以寬窄都驗，甲的部分還逐一走過五種縮放比例
 *     （使用者踩過的雷就是 110% 時右側說明蓋住圖）。
 * 三、**只驗「圖還看得到」會漏掉配對。** 要逐列比對圖與說明是不是同一列的兩半。
 * 四、**前置要先確認圖真的畫得出來**，否則整支恆真。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(here, "test-fixtures");
const files = readdirSync(SAMPLE_DIR).filter((name) => name.endsWith(".xlsx"));
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
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1500, height: 950 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "FIGNOTE");
await page.fill("#projectName", "圖說版面守門");
await page.click("#saveProject");
await page.waitForTimeout(500);

async function importQuarter(index) {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index });
  await page.setInputFiles(
    "#files",
    files.map((name) => ({
      name,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLE_DIR, name)),
    })),
  );
  await page.click("#preview");
  await page.waitForTimeout(3000);
  await page.click("#commit");
  await page.waitForTimeout(1500);
}
/* 兩季才有趨勢線可畫；只有一季的話甲的部分整段變成恆真。 */
await importQuarter(0);
await importQuarter(1);

await page.evaluate(() => document.querySelector('[data-view="trendChart"]').click());
await page.waitForTimeout(1500);

/* ══════════════════════════════════════════════════════════════════
   甲、歷季趨勢：一圖一說明配成一列
   ══════════════════════════════════════════════════════════════════ */
console.log("\n══ 甲、歷季趨勢：一圖一說明配成一列 ══");

ok(
  "前置：趨勢圖這一頁**有資料**（沒資料的話下面每一條都變成恆真）",
  await page.evaluate(
    () => document.querySelectorAll("#trendCharts .figure-row").length > 0,
  ),
);

/*
 * 全部勾起來——使用者回報的情境正是「把所有圖表都打勾」。
 * ⚠️ 要一顆一顆點（onchange 才會跑），不可以直接改 checked。
 */
const boxes = await page.locator("#trendMetricBoxes input[type=checkbox]").count();
for (let i = 0; i < boxes; i += 1) {
  const box = page.locator("#trendMetricBoxes input[type=checkbox]").nth(i);
  if (!(await box.isChecked())) {
    await box.check();
    await page.waitForTimeout(250);
  }
}
await page.waitForTimeout(800);

const rows = await page.evaluate(() => {
  const list = [...document.querySelectorAll("#trendCharts .figure-row")];
  return {
    count: list.length,
    /* 落單＝圖不在任何一列裡，或說明不在任何一列裡（舊版「兩排各自排列」的長相）。 */
    strayFigures: [...document.querySelectorAll("#trendCharts .trend-figure")].filter(
      (node) => !node.closest(".figure-row"),
    ).length,
    strayNotes: [...document.querySelectorAll("#trendCharts .figure-note")].filter(
      (node) => !node.closest(".figure-row"),
    ).length,
    paired: list.filter(
      (row) =>
        row.querySelector(":scope > .trend-figure") &&
        row.querySelector(":scope > .figure-note"),
    ).length,
    positions: list.map((row) => {
      const figure = row.querySelector(":scope > .trend-figure");
      return figure ? getComputedStyle(figure).position : "(沒有圖)";
    }),
  };
});
ok(
  "前置：全部勾選後畫出多列（一列＝一圖一說明）",
  rows.count > 1,
  `${rows.count} 列`,
);
ok(
  "① 每一列都同時有圖和它自己的說明",
  rows.paired === rows.count,
  `${rows.paired}/${rows.count} 列完整`,
);
ok(
  "① 沒有落單的圖或說明（不可以再有「一排圖、一排說明」）",
  rows.strayFigures === 0 && rows.strayNotes === 0,
  `落單圖 ${rows.strayFigures}、落單說明 ${rows.strayNotes}`,
);
ok(
  "② 每一張圖都是 sticky",
  rows.positions.every((position) => position === "sticky"),
  rows.positions.join("、"),
);

/*
 * ③ 捲到每一列的中段，那一列的圖都還要看得到。
 * ⚠️ 捲的位置要**逐列**算，不可以捲到頁尾就一次判斷：
 *   捲出那一列之後圖本來就該放開，拿它當紅字是假紅。
 */
const visibleWhileScrolled = await page.evaluate(async () => {
  const list = [...document.querySelectorAll("#trendCharts .figure-row")];
  let seen = 0;
  for (const row of list) {
    row.scrollIntoView({ block: "start" });
    const figure = row.querySelector(":scope > .trend-figure");
    const room =
      row.getBoundingClientRect().height -
      (figure?.getBoundingClientRect().height ?? 0);
    const offset = Number.parseFloat(getComputedStyle(figure).top) || 0;
    globalThis.scrollBy(0, Math.max(0, Math.round((room - offset) / 2)));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const box = figure.getBoundingClientRect();
    if (box.bottom > 0 && box.top < globalThis.innerHeight) seen += 1;
  }
  return { seen, total: list.length };
});
ok(
  "③ 捲到每一列的中段時，那一列的圖都還看得到",
  visibleWhileScrolled.seen === visibleWhileScrolled.total,
  `${visibleWhileScrolled.seen} / ${visibleWhileScrolled.total} 列看得到`,
);

/*
 * ④ 縮放檢查。
 * ⚠️ 使用者踩過的雷就在這裡：110% 之類的比例下右側說明欄蓋住趨勢圖。
 *   成因是斷點看的是**視窗寬度**，和這一區真正剩多少寬度是兩件事，
 *   所以現在用 container query。這一段就是那件事的守門。
 * ⚠️ 「說明在圖的下方」也算過關——那是容器不夠寬時的**正確**行為。
 *   不可以要求每一種比例都並排，那會逼出「永遠並排」的錯解。
 */
console.log("\n── 縮放檢查（右側說明欄不可以蓋住圖）");
for (const zoom of [100, 110, 125, 150, 175]) {
  const width = Math.round(1500 / (zoom / 100));
  await page.setViewportSize({ width, height: 950 });
  await page.waitForTimeout(600);
  const overlap = await page.evaluate(() => {
    const row = document.querySelector("#trendCharts .figure-row");
    const figure = row?.querySelector(":scope > .trend-figure");
    const note = row?.querySelector(":scope > .figure-note");
    if (!figure || !note) return null;
    const f = figure.getBoundingClientRect();
    const n = note.getBoundingClientRect();
    const horizontal = n.left >= f.right - 1;
    const below = n.top >= f.bottom - 1;
    return { horizontal, below, overlapPx: Math.round(f.right - n.left) };
  });
  ok(
    `④ 縮放 ${zoom}%（等效寬 ${width}px）：說明沒有蓋住圖`,
    Boolean(overlap) && (overlap.horizontal || overlap.below),
    overlap
      ? overlap.horizontal
        ? "說明在圖的右側"
        : overlap.below
          ? "說明在圖的下方"
          : `重疊 ${overlap.overlapPx}px`
      : "找不到圖或說明",
  );
}
await page.setViewportSize({ width: 1500, height: 950 });
await page.waitForTimeout(600);

/* ⑤ 說明預設收合、收合那一行要有資訊量、點得開。 */
const noteState = await page.evaluate(() => {
  const notes = [...document.querySelectorAll("#trendCharts .figure-note")];
  const first = notes[0];
  return {
    openCount: notes.filter((node) => node.open).length,
    leadLength: (
      first?.querySelector("summary .figure-note-lead")?.textContent || ""
    ).trim().length,
  };
});
ok(
  "⑤ 說明預設全部收合（只露重點一行）",
  noteState.openCount === 0,
  `${noteState.openCount} 則是展開的`,
);
ok(
  "⑤ 收合時露出的那一行有實際內容（不是只有標題）",
  noteState.leadLength > 10,
  `${noteState.leadLength} 字`,
);
await page.evaluate(() => {
  document.querySelector("#trendCharts .figure-note > summary")?.click();
});
await page.waitForTimeout(400);
ok(
  "⑤ 點開之後詳細說明出得來",
  await page.evaluate(() => {
    const body = document.querySelector("#trendCharts .figure-note .figure-note-body");
    return Boolean(body) && body.getBoundingClientRect().height > 10;
  }),
);

/* ══════════════════════════════════════════════════════════════════
   乙、各路段 LOS 圖／各路段歷季旅行速率：圖在左、說明在右、圖固定
   ══════════════════════════════════════════════════════════════════ */

/** 量某一格線裡每一張圖卡的版面。 */
const survey = (gridId) =>
  page.evaluate((id) => {
    const grid = document.getElementById(id);
    if (!grid) return null;
    const cards = [...grid.querySelectorAll(".chart-card")];
    const root = getComputedStyle(document.documentElement);
    const px = (value) => Number.parseFloat(value) || 0;
    const stickyOf = (selector) => {
      const node = document.querySelector(selector);
      return node && getComputedStyle(node).position === "sticky"
        ? node.getBoundingClientRect().height
        : 0;
    };
    return {
      gridWidth: Math.round(grid.getBoundingClientRect().width),
      expectedTop: Math.round(
        stickyOf("header") + stickyOf(".main-toolbar") + 12,
      ),
      rootStickyTop: root.getPropertyValue("--sticky-top").trim(),
      cards: cards.map((card) => {
        const figure = card.querySelector(":scope > .chart-figure");
        const note = card.querySelector(":scope > .card-note");
        const f = figure?.getBoundingClientRect();
        const n = note?.getBoundingClientRect();
        const summary = note?.querySelector(":scope > summary");
        return {
          title: card.querySelector("h3")?.textContent?.trim() || "(無標題)",
          children: [...card.children].map((child) => child.className),
          hasFigure: Boolean(figure),
          hasNote: Boolean(note),
          /* 說明若被包進圖裡，它會跟著圖一起釘住，等於整張卡黏在畫面上。 */
          noteInsideFigure: Boolean(figure && figure.querySelector(".card-note")),
          sideBySide: Boolean(f && n && n.left >= f.right - 1),
          figurePosition: figure ? getComputedStyle(figure).position : "",
          figureTop: figure ? px(getComputedStyle(figure).top) : null,
          figureWidth: Math.round(f?.width ?? -1),
          noteWidth: Math.round(n?.width ?? -1),
          /* 內建的 details 三角形要關掉，畫面上只能有自己那一顆 ▼。 */
          summaryMarker: summary
            ? getComputedStyle(summary).listStyleType
            : "(沒有 summary)",
          caretCount: note ? note.querySelectorAll(".figure-note-caret").length : -1,
        };
      }),
    };
  }, gridId);

/*
 * ⚠️ X-62（2026-09-17）：這兩張圖分屬兩個大分頁，而下面整段量的是
 *   **畫面上的外框**。停在別頁量的話每一個框都是 0×0——
 *   「並排」「sticky」那幾條會全部紅，而「不重疊」那幾條會恆真，
 *   一半紅一半假綠。所以每一張圖各自先切過去。
 */
const GRIDS = [
  ["chartGrid", "各路段 LOS 圖", "losChart"],
  ["speedTrendGrid", "各路段歷季旅行速率", "speedTrend"],
];
const gotoChart = async (view) => {
  await page.evaluate(
    (id) => document.querySelector(`[data-view="${id}"]`)?.click(),
    view,
  );
  await page.waitForTimeout(1000);
};

console.log("\n══ 乙-一、寬視窗（1920px）：左右並排 ＋ 圖固定 ══");
await page.setViewportSize({ width: 1920, height: 1000 });
await page.waitForTimeout(700);
for (const [gridId, label, view] of GRIDS) {
  await gotoChart(view);
  const data = await survey(gridId);
  ok(`前置：${label} 找得到格線`, Boolean(data), gridId);
  if (!data) continue;
  ok(
    `前置：${label} 真的畫得出圖卡（0 張的話下面全部恆真）`,
    data.cards.length > 0,
    `${data.cards.length} 張、格線寬 ${data.gridWidth}px`,
  );
  ok(
    `前置：${label} 的格線寬到足以並排（不到門檻的話下面幾條驗不了）`,
    data.gridWidth >= 1040,
    `${data.gridWidth}px（門檻 1040px）`,
  );
  for (const card of data.cards) {
    ok(
      `① ${label}｜${card.title}：卡片底下是「圖」與「說明」兩塊`,
      card.hasFigure && card.hasNote && !card.noteInsideFigure,
      `子元素：${card.children.join(" / ")}`,
    );
    ok(
      `② ${label}｜${card.title}：說明真的在圖的右邊`,
      card.sideBySide,
      `圖 ${card.figureWidth}px、說明 ${card.noteWidth}px`,
    );
    ok(
      `② ${label}｜${card.title}：圖是 sticky`,
      card.figurePosition === "sticky",
      card.figurePosition,
    );
    ok(
      `③ ${label}｜${card.title}：sticky 的 top ＝ 表頭＋主工具列＋留白（不是寫死的數字）`,
      card.figureTop != null && Math.abs(card.figureTop - data.expectedTop) <= 2,
      `實際 ${card.figureTop}px vs 應該 ${data.expectedTop}px（--sticky-top: ${data.rootStickyTop}）`,
    );
    ok(
      `⑤ ${label}｜${card.title}：摘要列上只有一個三角形`,
      card.summaryMarker === "none" && card.caretCount === 1,
      `內建標記 ${card.summaryMarker}、自己畫的 ${card.caretCount} 個`,
    );
  }
}

console.log("\n══ 乙-二、窄視窗（900px）：上下排，而且**不可以**釘住 ══");
/*
 * ⚠️ 這一段不是可有可無的對稱檢查。
 *   上下排時圖若還釘著，往下捲圖會滑到說明上面——而圖有不透明底色，
 *   說明的字會被整片蓋掉。那比不釘住更糟。
 */
await page.setViewportSize({ width: 900, height: 1000 });
await page.waitForTimeout(800);
for (const [gridId, label, view] of GRIDS) {
  await gotoChart(view);
  const data = await survey(gridId);
  if (!data || !data.cards.length) continue;
  ok(
    `前置：${label} 在窄視窗真的窄了（沒窄的話下面兩條恆真）`,
    data.gridWidth < 1040,
    `${data.gridWidth}px`,
  );
  for (const card of data.cards) {
    ok(
      `④ ${label}｜${card.title}：窄的時候不並排（說明在圖的下面）`,
      !card.sideBySide,
      `圖 ${card.figureWidth}px、說明 ${card.noteWidth}px`,
    );
    ok(
      `④ ${label}｜${card.title}：窄的時候圖**不可以**釘住（會蓋住說明）`,
      card.figurePosition === "static",
      card.figurePosition,
    );
  }
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log(
  "\n✅ 一圖一說明配對正確、圖在自己那一塊裡釘住、各縮放比例都不遮擋；窄的時候自動改上下排",
);
