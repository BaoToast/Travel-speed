/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列每一個條件 × 每一頁：**要嘛真的算，要嘛寫明不適用**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「確保圖表在主工具列每種篩選條件下，能計算或繪製的話，
 *     都要確實去計算或繪製圖形，不要有遺漏。
 *     這方面我無法做檢查，只能靠你謹慎對待。」
 *   「當主工具列某個篩選條件不適用該圖表時，記得顯示提醒文字。」
 *
 * 對每一個條件、每一個**有資料的分頁**，切下去之後只有兩種結果算合格：
 *   ① 那一頁的數字真的變了（＝有算）
 *   ② 那一頁掛出「不適用」的說明（＝有講）
 * 兩者都沒有就是「有遺漏」——使用者按了一個看起來有用的下拉，
 * 畫面一動也不動，而且沒有任何一個字告訴他為什麼。
 *
 * ⚠️ 名單裡**不放**純操作頁（建立計畫、匯入、備份、說明）：
 *   它們本來就沒有數字可以篩，掛一句「不適用」反而是噪音。
 * ⚠️ 也不放成果交付與結論草稿：使用者 2026-09-14 明確裁示這兩頁**維持獨立**，
 *   改用一顆「套用主工具列目前的條件」（守門在 e2e-apply-main.mjs）。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

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
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "COVERAGE");
await page.fill("#projectName", "條件覆蓋守門用計畫");
await page.click("#saveProject");
await page.waitForTimeout(500);
async function importQuarter(index) {
  await page.evaluate(() =>
    document.querySelector('[data-view="import"]').click(),
  );
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
await importQuarter(0);
await importQuarter(1);
await importQuarter(2);
/* 品質總覽要按過「執行資料異常檢查」才有內容可以量。 */
await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((item) =>
    (item.textContent || "").includes("執行資料異常檢查"),
  );
  if (button) button.click();
});
await page.waitForTimeout(1500);

/** 有數字、要接主工具列的分頁。 */
const DATA_VIEWS = [
  ["home", "操作首頁"],
  ["detail", "尖峰明細"],
  ["summary", "尖峰彙總"],
  /*
   * ⚠️ X-62（2026-09-17）：原本是一頁 `["charts","LOS 圖表"]`。
   *   四張圖各自升格成大分頁之後，**四頁都要各自驗**——
   *   只留其中一頁的話，另外三頁的「有算或有講」從此沒有人守。
   */
  ["losChart", "各路段 LOS 圖"],
  ["speedTrend", "各路段歷季旅行速率"],
  ["trendChart", "歷季趨勢（可勾選指標）"],
  ["bandChart", "三段分法（順暢／尚可／壅塞）"],
  ["maintenance", "資料維護"],
  /*
   * ⚠️ 2026-09-15 補上「路段速限」。
   *
   *   它有一張表，卻**一直不在這份名單裡**——所以「每一張圖表都要嘛真的算了、
   *   要嘛寫明不適用」這條規則在這一頁上**從來沒有驗過**。
   *   （實際行為：它完全不吃主工具列，速限是「這條路段這個方向」的設定值，
   *     不隨季度或日別改變。那是對的，但在此之前畫面上一個字都沒說。）
   *
   * ⚠️ 新增分頁時請一併加進這份名單。這份名單就是這一整支守門的涵蓋範圍——
   *   沒列進來的分頁，等於沒有被檢查過，而畫面上看不出差別。
   */
  ["speed", "路段速限"],
];

/*
 * ⚠️ 季度要驗的是「**區間拉開**之後每一頁有沒有反應」。
 *   起＝迄是預設狀態（＝沒有篩），所以這一條用「把起拉到倒數第二季」，
 *   而迄維持最新一季——那才會真的把最早那一季篩掉。
 */
const CASES = [
  ["A 季度區間", "mt-period-from", null, null, "periodFrom"],
  ["B 路段", "mt-roads", null, null, "roads"],
  /*
   * ⚠️ 甲案（使用者 2026-09-17）之後：
   *   ① 日別與方向的「全部」選項**已經移除**，還原值改成 "side-by-side"
   *     （它就是現在的預設）。原本寫 "all" 會讓 selectOption 找不到選項，
   *     等 30 秒後整支炸掉。
   *   ② 原本的 C2／D2（「平日＋假日並列」「雙向並列」）**整組拿掉**：
   *     那兩個值現在就是預設值，「選它」等於沒有篩，
   *     而這一支驗的是「篩了之後每一塊不是真的算了就是寫明不適用」——
   *     拿預設值來篩是一條永遠測不到東西的假斷言。
   *     尖峰的並列**不是**預設（預設是代表尖峰），所以 E2 留著。
   */
  ["C 日別", "mt-day", "weekday", "side-by-side", "day"],
  ["D 方向", "mt-direction", "方向1", "side-by-side", "direction"],
  ["E 尖峰", "mt-peak", "上午尖峰", "representative", "peak"],
  ["E2 上午＋下午並列", "mt-peak", "side-by-side", "representative", "peak"],
];

const goView = async (view) => {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view);
  await page.waitForTimeout(800);
};

const snapshot = () =>
  page.evaluate(() => {
    const host = document.querySelector(".view.active") || document.body;
    const skip = [
      ...document.querySelectorAll(
        ".main-toolbar, .chart-detach-note, .chart-inapplicable",
      ),
    ];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let text = "";
    let node;
    while ((node = walker.nextNode()))
      if (!skip.some((element) => element.contains(node.parentElement)))
        text += " " + node.nodeValue;
    return {
      numbers: (text.match(/-?\d[\d,]*\.?\d*/g) || [])
        .map((value) => value.replace(/,/g, ""))
        .join("|"),
      /*
       * ⚠️ 常駐的那幾句（data-inapplicable-always）不算——它們本來就一直在。
       *   這一條反面守門要抓的是「**沒篩卻跳出條件式的說明**」。
       */
      notes: host.querySelectorAll(
        ".chart-inapplicable:not([data-inapplicable-always])",
      ).length,
      /*
       * ⚠️ 常駐的那幾句要**另外**數一份。
       *
       * 「沒篩卻講話」那一條要排除它們（上面那個 notes）；
       * 但「這一頁既沒變也沒說」那一條**必須把它們算進去**——
       * 一整頁完全不吃主工具列的分頁（例如「路段速限」：速限是
       * 「這條路段這個方向」的設定值，不隨季度或日別改變），
       * 它的正確作法就是掛一句常駐說明，而不是每次篩了才跳一句。
       *
       * ⚠️ 兩條規則用同一個計數是 2026-09-15 才發現的漏洞：
       *   把「路段速限」加進名單後，它永遠是紅的——不是因為它沒說，
       *   而是因為這裡看不到它說的話。
       */
      alwaysNotes: host.querySelectorAll(
        ".chart-inapplicable[data-inapplicable-always]",
      ).length,
    };
  });

/*
 * ══════════════════════════════════════════════════════════════════════
 *  逐「塊」量，不是逐「頁」量
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：「偶爾會出現某張圖有出現提醒文字，卻對某一個篩選條件
 *   卻沒出現不受影響的提醒文字，因為我不能確實找出這類問題出來」。
 *
 * ⚠️ 上面的 snapshot() 是**整頁**一起量的，而一頁上有好幾塊。
 *   只要其中一塊的數字變了，整頁就算「有交代」——另一塊既沒變也沒說
 *   會被整個蓋過去。三支同一套做法。
 *
 * ⚠️ 判定「這一塊有交代」的憑據是 data-inapplicable（那一句說明**涵蓋了
 *   哪幾個條件**），不是「有沒有說明」——只數說明句數會假綠：
 *   一塊對季度講了一句、對顯示數值一個字都沒有，照樣算「有說明」。
 */
const blockSnapshot = () =>
  page.evaluate(() => {
    const host = document.querySelector(".view.active") || document.body;
    const candidates = [...host.querySelectorAll(".panel[id], section[id], article[id]")]
      .filter((el) => el.getBoundingClientRect().height >= 20)
      .filter((el) => el.tagName !== "svg" && el.tagName !== "SVG");
    const out = {};
    for (const el of candidates) {
      if (candidates.some((other) => other !== el && el.contains(other)))
        continue;
      /* 收起來的 <details> 內容沒有渲染，數字當然不會變——那是量不到。 */
      if (el.tagName === "DETAILS" && !el.open) continue;
      if (el.closest("details:not([open])")) continue;
      /*
       * ⚠️ 2026-09-18 大檢查：`.chart-scope-note`（「目前畫的是：115Q1～115Q3・…・
       *   上午＋下午並列」那一句口徑說明）也要跳過——它**逐字複述主工具列的條件**，
       *   任何條件一動它一定變，把它算進指紋等於「數字變了」永遠成立，
       *   反向那一半（寫不適用卻變）會對一張其實沒動的圖報假錯。
       */
      const skip = [
        ...el.querySelectorAll(".chart-detach-note, .chart-inapplicable, .chart-scope-note"),
      ];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let text = "";
      let node;
      while ((node = walker.nextNode()))
        if (!skip.some((element) => element.contains(node.parentElement)))
          text += " " + node.nodeValue;
      out[el.id] = {
        /*
         * ⚠️ 指紋**不可以只取數字**。
         *
         *   「各路段 LOS 圖」上面幾乎沒有數字——它顯示的是 A～F 的等級字母
         *   與柱子高度。只比對數字的話，主工具列切了日別、方向、尖峰之後
         *   圖明明整個換了一批資料，指紋卻一模一樣，於是被誤判成
         *   「既沒變也沒說」，接著就會有人去替一個其實有反應的圖
         *   掛一句「不適用」——**那是讓畫面說謊**。
         *
         *   所以這裡連**文字內容**與柱子的 data-value 一起算進指紋。
         */
        numbers:
          text.replace(/\s+/g, " ").trim() +
          "||" +
          [...el.querySelectorAll("[data-value]")]
            .map((n) => n.getAttribute("data-value"))
            .join(","),
        covered: [
          ...new Set(
            [...el.querySelectorAll("[data-inapplicable]")].flatMap((n) =>
              (n.getAttribute("data-inapplicable") || "").split(/\s+/),
            ),
          ),
        ].filter(Boolean),
        /*
         * ⚠️ 2026-09-18 大檢查：反向那一半要用的清單——只算**此刻真的顯示著**、
         *   而且不是常駐資訊句（data-inapplicable-always）的「不適用」宣告。
         */
        declared: [
          ...new Set(
            [...el.querySelectorAll('[data-inapplicable]:not([data-inapplicable-always]):not([data-note-kind="applied"])')]
              .filter((n) => n.offsetParent !== null || n.getClientRects().length > 0)
              .flatMap((n) => (n.getAttribute("data-inapplicable") || "").split(/\s+/)),
          ),
        ].filter(Boolean),
        detached: el.querySelectorAll(".chart-detach-note").length > 0,
        /*
         * 這一塊**宣告**自己真的吃哪幾個條件（寫在 data-consumes 上）。
         * ⚠️ 有些條件在某一批資料上剛好算出一樣的結果（先篩再挑最差時，
         *   篩掉幾筆之後最差的仍是同一筆），那不是漏，是資料的性質。
         *   只驗「有沒有變」會把那種情形誤判成漏，然後有人為了消紅
         *   去掛一句錯的說明——**畫面說謊比沒說更糟**。
         */
        consumes: (el.getAttribute("data-consumes") || "")
          .split(/\s+/)
          .filter(Boolean),
        title: (el.querySelector("h2, h3, b")?.textContent || el.id)
          .replace(/\s+/g, "")
          .slice(0, 22),
      };
    }
    return out;
  });

const views = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav button")].map((b) => b.dataset.view),
);
const targets = DATA_VIEWS.filter(([id]) => views.includes(id));
ok(
  "前置：名單上的分頁都找得到",
  targets.length === DATA_VIEWS.length,
  DATA_VIEWS.filter(([id]) => !views.includes(id))
    .map(([, name]) => name)
    .join("、"),
);

for (const [label, testid, value, backTo, field] of CASES) {
  /* 季度與路段的可選值要從畫面上讀。 */
  let target = value;
  let restore = backTo;
  if (!target) {
    /*
     * ⚠️ 路段從 2026-09-15 起是**下拉式多選**（不是 <select multiple>），
     *   所以它的可選值要從面板裡的核取方塊讀，不是 <option>。
     */
    const options =
      testid === "mt-roads"
        ? await roadOptionValues(page)
        : await page.evaluate(
            (id) =>
              [...document.querySelectorAll(`[data-testid="${id}"] option`)].map(
                (o) => o.value,
              ),
            testid,
          );
    if (testid === "mt-period-from") {
      /*
       * ⚠️ 不可以選**最早**那一季當起點：迄仍然是最後一季，
       *   區間會涵蓋全部資料，等於沒有篩——這一條就變成永遠測不到東西。
       *   選倒數第二季才真的會把最早那一季篩掉。
       */
      target = options[options.length - 2] || options[0];
      /*
       * ⚠️ 還原回**最早**一季，不是最後一季。
       *
       *   2026-09-15 起主工具列的預設是「起＝最早一季、迄＝最新一季」
       *  （使用者定義：起＝迄就是只有那一季，所以預設不能是起＝迄）。
       *   還原成最後一季的話，區間會變成起＝迄＝只有一季——那不是預設狀態，
       *   於是後面「回到預設之後不適用說明要全部收掉」那一條就會紅，
       *   而紅的原因是測試自己沒有還原乾淨。
       */
      restore = options[0];
    } else {
      target = options[0];
      restore = "";
    }
  }
  if (!target) {
    ok(`${label}：選得到一個非預設值`, false, "沒有可選的值，這一條驗不了");
    continue;
  }
  const before = {};
  const beforeBlocks = {};
  for (const [view] of targets) {
    await goView(view);
    before[view] = (await snapshot()).numbers;
    beforeBlocks[view] = await blockSnapshot();
  }
  if (testid === "mt-roads") await pickRoads(page, [target]);
  else await page.selectOption(`[data-testid="${testid}"]`, target);
  await page.waitForTimeout(1100);
  const silent = [];
  const silentBlocks = [];
  const sameButDeclared = [];
  const lyingBlocks = [];
  for (const [view, name] of targets) {
    await goView(view);
    const after = await snapshot();
    const afterBlocks = await blockSnapshot();
    /*
     * ⚠️ X-62（2026-09-17）之後，四張圖各自一頁，於是**一頁常常只有一塊**。
     *   這一條原本沒有「宣告吃這個條件」的出口——那是舊版可以將就的地方：
     *   舊的「LOS 圖表」一頁裡有四塊，只要其中一塊的數字變了，整頁就算過。
     *   拆頁之後同一份判斷會把「真的吃了這個條件、只是這批資料算出來剛好相同」
     *   判成「既沒變也沒說」——而下面那一條逐塊看的判斷早就有這個出口，
     *   兩條對同一件事給出相反的結論。
     *
     *   所以這裡採用**同一套規則**：這一頁上只要有一塊 data-consumes 宣告了
     *   這個條件，就不算「沒說」。宣告本身是會被守門檢查的
     *  （blockSnapshot 讀的就是畫面上的宣告），不是隨便寫寫。
     */
    const declaredOnPage = Object.values(afterBlocks).some((block) =>
      block.consumes.includes(field),
    );
    if (
      after.numbers === before[view] &&
      after.notes === 0 &&
      /* 常駐說明也算「有說」——見 snapshot() 裡 alwaysNotes 的說明。 */
      after.alwaysNotes === 0 &&
      !declaredOnPage
    )
      silent.push(name);
    for (const [id, now] of Object.entries(afterBlocks)) {
      const was = beforeBlocks[view][id];
      if (!was || !was.numbers) continue;
      /*
       * ⚠️ 2026-09-18 大檢查（三支統一）：反向那一半。
       *   一塊**寫著**「不適用 X」、數字卻因為 X 變了——那句說明在說謊，
       *   比沒說更糟。同時宣告 consumes 與不適用也是自相矛盾。
       *   脫離中的塊不算。
       */
      /*
       * ⚠️ 不把「consumes 與不適用同時宣告」判成錯：一個條件可以**某些值**適用、
       *   **某些值**不適用（例如方向單選會篩、「雙向並列」畫不出來），
       *   那時兩者同時存在是對的。要抓的只有「寫不適用、數字卻變了」。
       */
      if (!now.detached && now.declared.includes(field) && now.numbers !== was.numbers)
        lyingBlocks.push(`${now.title}（${id}）`);
      if (now.numbers !== was.numbers) continue;
      if (now.detached) continue;
      if (now.covered.includes("all")) continue;
      if (now.covered.includes(field)) continue;
      if (now.consumes.includes(field)) {
        sameButDeclared.push(`${now.title}（${field}）`);
        continue;
      }
      silentBlocks.push(`${now.title}（${id}）`);
    }
  }
  ok(
    `⚠️ ${label} → ${target}：寫著「不適用」的塊，數字不可以跟著變（說明不可以說謊）`,
    lyingBlocks.length === 0,
    lyingBlocks.length
      ? `這幾塊**寫不適用卻變了**：${[...new Set(lyingBlocks)].join("、")}`
      : "沒有說謊的說明",
  );
  ok(
    `${label} → ${target}：每一頁不是真的算了，就是寫明不適用`,
    silent.length === 0,
    silent.length
      ? `這幾頁**既沒變也沒說**：${silent.join("、")}`
      : "全部有交代",
  );
  ok(
    `⚠️ ${label} → ${target}：逐**塊**看，每一塊不是真的算了，就是寫明不適用`,
    silentBlocks.length === 0,
    silentBlocks.length
      ? `這幾塊**既沒變也沒說**：${[...new Set(silentBlocks)].join("、")}`
      : `全部有交代${
          sameButDeclared.length
            ? `（另有宣告吃這個條件但這批資料算出來剛好相同：${[
                ...new Set(sameButDeclared),
              ].join("、")}）`
            : ""
        }`,
  );
  if (testid === "mt-roads") await pickRoads(page, []);
  else await page.selectOption(`[data-testid="${testid}"]`, restore);
  await page.waitForTimeout(1100);
}

/*
 * ⚠️ 反面守門：全部回到預設之後，**不可以**還留著任何一句「不適用」。
 *   沒篩卻講一句沒有人問的話，是我們自己訂下的另一種錯。
 */
const leftovers = [];
for (const [view, name] of targets) {
  await goView(view);
  if ((await snapshot()).notes > 0) leftovers.push(name);
}
ok(
  "回到預設之後，不適用說明要全部收掉（沒篩卻講話是噪音）",
  leftovers.length === 0,
  leftovers.join("、"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 每一個條件在每一頁上，不是真的算了就是寫明不適用");

/* 路段是下拉式多選（見 e2e-main-toolbar.mjs 的同名函式）。 */
async function pickRoads(page, names) {
  await page.evaluate((wanted) => {
    const button = document.querySelector('[data-testid="mt-roads"]');
    const panel = document.getElementById("mtRoadsPanel");
    if (!button || !panel) throw new Error("找不到路段下拉");
    if (panel.hidden) button.click();
    if (!wanted.length) {
      panel.querySelector("[data-roads-all]").click();
      return;
    }
    for (const box of panel.querySelectorAll("input[data-road]")) {
      const want = wanted.includes(box.dataset.road);
      if (box.checked !== want) box.click();
    }
  }, names);
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}
async function roadOptionValues(page) {
  return page.evaluate(() => {
    const button = document.querySelector('[data-testid="mt-roads"]');
    const panel = document.getElementById("mtRoadsPanel");
    if (panel && panel.hidden) button.click();
    const values = [
      ...(panel?.querySelectorAll("input[data-road]") || []),
    ].map((box) => box.dataset.road);
    if (panel && !panel.hidden) button.click();
    return values;
  });
}
