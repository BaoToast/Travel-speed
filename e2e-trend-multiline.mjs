/*
 * ══════════════════════════════════════════════════════════════════════
 *  歷季趨勢：「全部路段」時一路段一條線，**不再取跨路段平均**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16 的兩段裁示合起來就是這件事：
 *   「我可以單選一個路段，就能看到一路段一張圖了，目前反而缺少一張圖多條線
 *     ……(這點三項程式都適用)」
 *   「改成一路段一條線，不再平均」
 *
 * 為什麼原本那個平均不成立：旅行速率、行駛速率、總延滯、速限比這四個指標，
 * 各路段的**長度與速限都不同**（圖上原本的括號自己就寫著這句話），
 * 平均出來的值不對應任何一條路的實際狀況。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**測資一定要有兩條以上的路段**，否則「多條線」與「一條平均線」
 *     長得一模一樣，整支恆真。前置會先確認路段數 ≥ 2。
 * 二、**不可以只數 polyline 的數量**。畫面上多幾條線、但值還是平均值的話
 *     照樣會過。所以要驗**每一條線的值等於那一條路段單獨選時的值**。
 * 三、**佔比與最差等級那兩個指標不可以跟著拆**。它們是「整個計畫」這個
 *     母體的計數與取最差，不是平均；拆成一路段一條線只會得到一堆
 *     0% / 100%。這一支要反過來守住它們仍然是單線。
 * 四、**說明文字與 Excel 也要跟著拆**。畫面上有四條線、說明卻寫
 *     「目前沒有可以繪製的資料」，或 Excel 一格數字都沒有，
 *     那是最難發現的一種壞掉——使用者拿走的是檔案，不是畫面。
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

/** 這一支固定看的那一種日別（在前置決定，之後每次換路段都要重新套回去）。 */
let chosenDay = "";
/** 每一條路段在這一天的值（單獨選它時量到的）；第五節也要用。 */
const single = {};
let expectedRoads = [];

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const SAMPLE_DIR = join(here, "test-fixtures");
const files = readdirSync(SAMPLE_DIR).filter((name) => name.endsWith(".xlsx"));
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1700, height: 1100 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "MULTILINE");
await page.fill("#projectName", "一張圖多條線守門");
await page.click("#saveProject");
await page.waitForTimeout(500);
for (const quarterIndex of [1, 2, 3]) {
  await page.evaluate(() =>
    document.querySelector('[data-view="import"]').click(),
  );
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: quarterIndex });
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
  await page.waitForTimeout(3500);
  await page.click("#commit");
  await page.waitForTimeout(2200);
}

const gotoView = async (view) => {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view);
  await page.waitForTimeout(1000);
};
await gotoView("trendChart");
await page.waitForTimeout(800);
/*
 * ⚠️ 日別先固定成**單一種**。
 *   「平日＋假日」會畫成上下兩張圖（那是刻意的，不是缺陷），
 *   而這一支每次只讀第一張——兩張圖時讀到的是哪一天要看資料，
 *   量出來的東西會隨測資漂移。固定成一種，這一支量的對象才唯一。
 */
chosenDay = await page.evaluate(() => {
  const select = document.getElementById("trendDay");
  const option = [...(select?.options ?? [])].find(
    (item) => item.value !== "ALL",
  );
  if (!select || !option) return "";
  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return option.value;
});
await page.waitForTimeout(1000);

/** 只勾一個指標，回傳那一張圖目前的線與線尾名稱。 */
const pickMetric = async (metricKey) => {
  /*
   * ⚠️ 先全部取消、再勾想要的那一個，而且**一次點一顆、每點一顆就等一下**。
   *   一口氣在同一個 evaluate 裡點好幾顆，畫面只重畫最後一次的結果，
   *   而中間那幾次的 state 更新會互相蓋掉——實測會留下沒取消乾淨的指標，
   *   於是第一張圖是別的指標的圖，整支量錯對象。
   */
  const keys = await page.evaluate(() =>
    [...document.querySelectorAll("#trendMetricBoxes input[data-trend-metric]")].map(
      (box) => box.dataset.trendMetric,
    ),
  );
  /*
   * ⚠️ 順序是「**先勾想要的、再取消其他的**」。
   *   反過來做的話中間會出現「一個指標都沒勾」的瞬間，那時整個趨勢面板
   *   會收起來，接下來的 selectOption 就會等到逾時——而逾時訊息只說
   *   「element is not visible」，看不出真正的原因（實測踩到）。
   */
  for (const key of [metricKey].concat(
    keys.filter((item) => item !== metricKey),
  )) {
    const want = key === metricKey;
    const changed = await page.evaluate(
      ({ key, want }) => {
        const box = document.querySelector(
          `#trendMetricBoxes input[data-trend-metric="${key}"]`,
        );
        if (!box || box.checked === want) return false;
        box.click();
        return true;
      },
      { key, want },
    );
    if (changed) await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000);
};
const readChart = () =>
  page.evaluate(() => {
    const figures = [...document.querySelectorAll("#trendCharts .trend-figure")];
    /*
     * ⚠️ 只取**第一張**，但要把它的標題一起回傳。
     *   日別沒有套回去時會變成上下兩張圖，讀到的是哪一天要看標題才知道；
     *   不回傳標題的話，量錯對象時完全看不出來。
     */
    const figure = figures[0];
    if (!figure) return null;
    return {
      figureCount: figures.length,
      caption: figure.querySelector("figcaption")?.textContent?.trim() ?? "",
      polylines: figure.querySelectorAll("polyline.trend-line").length,
      endLabels: [...figure.querySelectorAll(".trend-end-label")].map((node) =>
        (node.textContent || "").trim(),
      ),
      /*
       * 一條線一組值。
       *
       * ⚠️ **不可以用 cy（畫面座標）比對**。多線圖的縱軸範圍是所有路段
       *   一起算出來的，單獨選一條路段時範圍只涵蓋那一條——同一個值在
       *   兩張圖上的 cy 本來就不一樣。用 cy 比會永遠紅，而紅的原因
       *   與要驗的事情無關（實測踩到）。
       *   要比的是**值**，所以從資料點的 tooltip 把數字解出來。
       */
      byLine: [...figure.querySelectorAll("circle.trend-dot")].reduce(
        (out, dot) => {
          const key = dot.getAttribute("data-line") || "";
          const title = dot.querySelector("title")?.textContent ?? "";
          const match = title.match(/：\s*(-?[\d,]+(?:\.\d+)?)/);
          (out[key] ??= []).push(
            match ? Number(match[1].replace(/,/g, "")) : null,
          );
          return out;
        },
        {},
      ),
      tooltips: [...figure.querySelectorAll("circle.trend-dot title")]
        .slice(0, 3)
        .map((node) => (node.textContent || "").replace(/\s+/g, " ")),
    };
  });

/**
 * 換路段。
 *
 * ⚠️ 用 evaluate 直接設值＋發 change，**不用 page.selectOption**。
 *   實測：這個 <select> 明明有版面（190×35、visibility 正常、選項也在），
 *   Playwright 仍然一直回「element is not visible and enabled」而逾時——
 *   而逾時訊息看不出真正的原因，只會讓人以為功能壞了。
 *   本專案其他 e2e 換下拉一律走這一條路，這裡跟著一致。
 */
const currentDay = () =>
  page.evaluate(() => document.getElementById("trendDay")?.value ?? "");
const applyDay = async () => {
  /*
   * ⚠️ 換路段會**把這一塊的脫離狀態重設**，日別跟著回到「平日＋假日」。
   *   所以每次換完路段都要把日別套回去，而且要**確認真的套上了**——
   *   套不上就重試。實測踩過：某一條路段只有平日資料，日別被重設之後
   *   那一張圖畫的是平日，於是「多線圖（假日）裡沒有它」看起來像漏了一條，
   *   其實多線圖是對的、量錯的是這一支。
   */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if ((await currentDay()) === chosenDay) return true;
    await page.evaluate((wanted) => {
      const select = document.getElementById("trendDay");
      if (!select || !wanted) return;
      select.value = wanted;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, chosenDay);
    await page.waitForTimeout(700);
  }
  return (await currentDay()) === chosenDay;
};
const pickRoad = async (value) => {
  await page.evaluate((wanted) => {
    const select = document.getElementById("trendRoad");
    if (!select) return;
    select.value = wanted;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(900);
  /*
   * ⚠️ 換完路段一定要**把日別套回去**。
   *   換路段會重設這一塊的脫離狀態，日別跟著回到「平日＋假日」，
   *   於是同一個指標畫成上下兩張圖，而這一支只讀第一張——
   *   量到的就變成另一天的數字。
   *   實測就是這樣：某一條路段在假日沒有資料、平日有，
   *   多線圖（假日）裡沒有它是**對的**，但單獨選它時讀到的卻是平日，
   *   於是看起來像「多線圖漏了一條」。
   */
  await applyDay();
};

console.log("\n══ 前置 ══");
const roadOptions = await page.evaluate(() =>
  [...(document.getElementById("trendRoad")?.options ?? [])].map((option) => ({
    value: option.value,
    text: (option.textContent || "").trim(),
  })),
);
const realRoads = roadOptions.filter((option) => option.value !== "ALL");
ok(
  "前置：測資要有兩條以上的路段（只有一條的話多線與平均線長得一樣，整支恆真）",
  realRoads.length >= 2,
  realRoads.map((option) => option.text).join("、"),
);

if (realRoads.length >= 2) {
  console.log("\n══ 一、先量出「這一天真的有資料」的路段 ══");
  /*
   * ⚠️ 下拉裡列的是**全部日別**都算進去的路段清單（那是刻意的，X-39／X-40：
   *   選項不可以自我消失）。但這一支固定看某一天，那一天沒有調查的路段
   *   本來就不會有線——拿下拉的筆數當「應該有幾條線」會誤判成缺線。
   *   所以先逐條單獨選一次，記下它在這一天的值；有值的才算數。
   */
  await pickMetric("travel");
  for (const option of realRoads) {
    await pickRoad(option.value);
    ok(
      `前置：選到「${option.text}」之後日別仍然是「${chosenDay}」（換路段會把日別重設，套不回去就會量到別天的數字）`,
      (await currentDay()) === chosenDay,
      `目前日別＝${await currentDay()}`,
    );
    const one = await readChart();
    const values = (Object.values(one?.byLine ?? {})[0] ?? []).filter(
      (value) => value != null,
    );
    if (values.length) single[option.text] = values;
  }
  expectedRoads = Object.keys(single);
  ok(
    "前置：這一天至少有兩條路段有資料（只有一條的話多線與平均線長得一樣）",
    expectedRoads.length >= 2,
    expectedRoads.join("、"),
  );
  ok(
    "前置：日別確實固定成一種（兩張圖的話這一支會讀到另一天的數字）",
    (await readChart())?.figureCount === 1,
    `目前 ${(await readChart())?.figureCount} 張圖・${(await readChart())?.caption}`,
  );

  console.log("\n══ 二、全部路段時一路段一條線，而且值對得上 ══");
  await pickRoad("ALL");
  await pickMetric("travel");
  const all = await readChart();
  const drawn = Object.keys(all?.byLine ?? {}).filter(Boolean);
  ok(
    "⚠️ ② 「全部路段」時線數 ＝ 這一天有資料的路段數（不是一條平均線）",
    drawn.length === expectedRoads.length,
    `線 ${drawn.length} 條（${drawn.join("、")}）／有資料的路段 ${expectedRoads.length} 條`,
  );
  ok(
    "⚠️ ② 每一條線的**右端直接寫上路段名稱**（識別不可以只靠顏色）",
    all && expectedRoads.every((road) => all.endLabels.includes(road)),
    all?.endLabels.join("、") ?? "",
  );
  /*
   * ⚠️ 這一段才是真正的證明。只數線數的話，把平均值畫成 N 條一模一樣的線
   *   也會過——而那正是「看起來修好了、其實沒修」。
   */
  for (const road of expectedRoads) {
    const combined = (all?.byLine[road] ?? []).filter((value) => value != null);
    ok(
      `⚠️ ② 「${road}」在多線圖上的值 ＝ 單獨選它時的值`,
      combined.length > 0 &&
        JSON.stringify(combined) === JSON.stringify(single[road]),
      `多線 ${JSON.stringify(combined)}｜單獨 ${JSON.stringify(single[road])}`,
    );
  }
  const distinct = new Set(
    expectedRoads.map((road) => JSON.stringify(single[road])),
  );
  ok(
    "⚠️ ② 各條線**不可以全部一樣**（全一樣代表畫的仍然是那個平均值）",
    distinct.size > 1,
    `${distinct.size} 種不同的走勢`,
  );

  console.log("\n══ 三、計數型與取最差型指標**維持單線** ══");
  for (const [key, name] of [
    ["congestedShare", "E 級以下路段佔比"],
    ["worstLos", "最差服務水準等級"],
  ]) {
    await pickMetric(key);
    const chart = await readChart();
    ok(
      `⚠️ ③ 「${name}」維持單線（它是整個計畫的計數／取最差，不是平均）`,
      chart && Object.keys(chart.byLine).filter(Boolean).length <= 1,
      `線 ${Object.keys(chart?.byLine ?? {}).filter(Boolean).length} 條`,
    );
  }

  console.log("\n══ 四、說明文字要跟著拆，而且不可以再提平均 ══");
  await pickMetric("travel");
  await page.waitForTimeout(1000);
  /*
   * ⚠️ 讀說明時要**把 SVG 整個排除**。
   *   figure-row 的 textContent 會把 <style> 裡的 CSS 也算進來
   *   （那一段有幾百個字），於是「說明有沒有提到路段名稱」永遠量不到——
   *   而且失敗訊息印出來的是一整串 CSS，看不出真正的原因（實測踩到）。
   */
  const note = await page.evaluate(() => {
    const row = document.querySelector("#trendCharts .figure-row");
    if (!row) return "";
    const clone = row.cloneNode(true);
    clone.querySelectorAll("svg, style, figcaption").forEach((node) => node.remove());
    return (clone.textContent || "").replace(/\s+/g, " ");
  });
  ok(
    "⚠️ ④ 說明**不可以**寫「目前沒有可以繪製的資料」（畫面上明明有四條線）",
    !note.includes("目前沒有可以繪製的資料"),
    note.slice(0, 80),
  );
  ok(
    "⚠️ ④ 說明要逐條列出每一個路段",
    expectedRoads.every((road) => note.includes(road)),
    note.slice(0, 160),
  );
  ok(
    "⚠️ ④ 說明要講明「不取平均」",
    note.includes("不取平均"),
    note.slice(0, 160),
  );
}

/* ══ 五、選到「這一天沒有調查」的路段時，整塊不可以消失 ═══════ */
/*
 * ══════════════════════════════════════════════════════════════════════
 *  這一段是做多線時**實測撞到的**，不是使用者回報的
 * ══════════════════════════════════════════════════════════════════════
 *
 * 症狀：選一條「這一天沒有調查」的路段，整個歷季趨勢區塊被藏起來。
 * 三個後果一個比一個嚴重：
 *   ① 整塊消失——使用者已經為同一件事回報過「我一度以為系統錯誤」。
 *   ② **選單跟著消失，改不回去**。想換別的路段只能重新整理。
 *   ③ **上一個路段的圖還留在 DOM 裡**（提早 return，圖沒有重畫）。
 *      那是一份別的路段的資料躺在畫面上。
 *
 * ⚠️ 刻意迴避的假通過：
 *   ・不可以只驗「面板沒有 hidden」。圖還是上一個路段的話照樣是錯的，
 *     所以要驗**舊的線真的被清掉**。
 *   ・要驗**說明文字講得出下一步**，不是只留一片空白。
 */
console.log("\n══ 五、選到這一天沒有資料的路段：整塊要留著、舊圖要清掉 ══");
{
  const emptyRoad = realRoads.find(
    (option) => !Object.keys(single).includes(option.text),
  );
  if (!emptyRoad) {
    console.log("   （這批測資裡每一條路段在這一天都有資料，這一節跳過）");
  } else {
    await pickRoad(realRoads.find((o) => Object.keys(single).includes(o.text)).value);
    await pickMetric("travel");
    const before = await readChart();
    ok(
      "前置：先讓畫面上真的有一張圖（沒有的話下一條的「舊圖被清掉」是恆真）",
      Object.values(before?.byLine ?? {}).flat().filter((v) => v != null).length > 0,
      `${Object.keys(before?.byLine ?? {}).join("、")}`,
    );
    await pickRoad(emptyRoad.value);
    const after = await page.evaluate(() => {
      const panel = document.getElementById("trendPanel");
      const charts = document.getElementById("trendCharts");
      return {
        panelHidden: panel ? panel.hidden : null,
        roadSelectVisible: Boolean(
          document.getElementById("trendRoad")?.offsetParent,
        ),
        dots: charts ? charts.querySelectorAll("circle.trend-dot").length : -1,
        /* ⚠️ 要把 SVG／style 剝掉再讀，否則量到的是一整串 CSS。 */
        text: (function () {
          if (!charts) return "";
          const clone = charts.cloneNode(true);
          clone.querySelectorAll("svg, style").forEach((node) => node.remove());
          return (clone.textContent || "").replace(/\s+/g, " ").slice(0, 160);
        })(),
      };
    });
    ok(
      `⚠️ ⑤ 選到「${emptyRoad.text}」（這一天沒有調查）之後，整塊**不可以**被藏起來`,
      after.panelHidden === false,
      `panel.hidden=${after.panelHidden}`,
    );
    ok(
      "⚠️ ⑤ 路段選單要留著，使用者才換得回去（藏起來就只能重新整理）",
      after.roadSelectVisible === true,
    );
    ok(
      "⚠️ ⑤ **上一個路段的圖要被清掉**（留著等於把別的路段的資料放在畫面上）",
      after.dots === 0,
      `還留著 ${after.dots} 個資料點`,
    );
    ok(
      "⚠️ ⑤ 要講出下一步（不是只留一片空白）",
      after.text.includes("沒有可以繪製的資料") && after.text.includes("日別"),
      after.text,
    );
  }
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 歷季趨勢：一路段一條線、值對得上、計數型維持單線、說明與圖一致");
