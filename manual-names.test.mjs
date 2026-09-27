/*
 * ══════════════════════════════════════════════════════════════════════
 *  說明文字裡的分頁名稱，必須就是側欄上的那個名稱
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者定的規矩（大檢查規則 4.5）：
 *   「各功能要如同手冊裡所寫的，如果有不一致，看是系統是最新正確資訊要修正
 *     手冊內容，還是系統遺漏了，要重新補上功能，這樣搭配大檢查才能檢查出問題」
 *
 * 2026-09-20 大檢查實際抓到：`titles.setup` 早就依使用者 2026-09-13 的指定
 * 改成「建立與管理計畫」（三支統一），但**兩處說明文字沒跟著改**——
 *   ・app.js 內嵌手冊第一章：「進入『計畫設定』，輸入公司計畫編號與完整名稱。」
 *   ・index.html 新手操作順序第 1 步標題：「計畫設定」
 * 使用者照說明去側欄找「計畫設定」，找不到。
 *
 * ⚠️ 後果比「文件過期」嚴重：手冊是使用者唯一的權威說明，它和畫面互相矛盾時
 *   兩邊都變得不可信——而且這一類錯**不會有任何測試失敗**，所以只會愈積愈多。
 *
 * ── 這一支守什麼 ──
 *
 * 只守一件事、但守得死：**說明文字裡若用「」框起一個分頁名稱，那個名稱
 * 必須真的存在於 `titles`（或是明確的例外）**。
 *
 * ⚠️ 刻意迴避的假通過：
 *   一、**只驗「新名字有出現」不算數**——舊名字同時還留著照樣過。
 *       這裡驗的是**舊名字一個都不可以剩**。
 *   二、**只驗 app.js 不算數**——index.html 也有一份說明。兩份都掃。
 *   三、**前置檢查**：`titles` 真的讀得到而且抓得到那幾個名字，
 *       否則正規表示式改壞之後這一支會安靜地變成恆真。
 *
 * ⚠️ 為什麼用「已經改過名的舊名單」而不是「反向掃所有「」」：
 *   說明文字裡的「」也用在欄位名、按鈕名、檔名上，全掃會誤報一堆。
 *   改名是**有紀錄的事件**，把每一次改名的舊名字加進下面這張表，
 *   成本低而且抓得到真正會出事的那一類。
 *   ⚠️ 以後再改任何分頁名稱，**一定要把舊名字加進 RENAMED**。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validationFileName } from "./validation-file.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("./index.html", import.meta.url), "utf8");

/** 歷次改名：舊名字 → 現在的名字。改名時要往這裡加一列。 */
const RENAMED = [
  {
    old: "計畫設定",
    now: "建立與管理計畫",
    when: "2026-09-13（使用者指定，三支統一）",
  },
  {
    old: "健康檢查",
    now: "資料異常檢查",
    when: "2026-09-13（使用者指定）",
  },
  /*
   * ⚠️ 這一列是**功能區**的名字（NAV_ZONES 的 title），不是分頁名。
   *   2026-09-13 改名的理由寫在 app.js：「把建立計畫搬進一個叫
   *   『資料匯入』的區會名不副實」。手冊到 2026-09-25 都還寫著舊名，
   *   而原本的守門只掃 app.js 與 index.html，抓不到。
   */
  {
    old: "資料匯入",
    now: "建立與匯入",
    when: "2026-09-13（使用者指定，功能區改名）",
  },
  /*
   * ⚠️ 2026-09-25（第五輪改名、第六輪抓到漏掉的那一處）：
   *   側欄那一顆從「結論草稿」改成「結論草稿產生器」，而手冊那張
   *   明寫「選單項目」的表還留著舊名——照手冊去側欄找會找不到。
   *   這一支自己第 35 行就寫著「以後再改任何分頁名稱，一定要把舊名字加進
   *   RENAMED」，而第五輪改名時漏了。
   * ⚠️ 「結論草稿」三個字在**頁內**還是有效的（那是產生出來的草稿本身，
   *   以及成果交付頁裡對照用的說法），所以掃描樣式刻意只認
   *   「被引號或標籤框起來、明顯在指某一個分頁」的寫法。
   */
  {
    old: "結論草稿",
    now: "結論草稿產生器",
    when: "2026-09-25（與頁內標題統一）",
    /*
     * ⚠️ 「結論草稿」這三個字在**頁內**還是有效的名字：
     *   `<h3>結論草稿</h3>` 是那一頁裡裝草稿文字的面板抬頭
     *   （產生出來的東西就叫結論草稿），而**頁**才叫「結論草稿產生器」。
     *   這一條列成具名豁免，不是整類放行——日後多一種寫法照樣會紅。
     */
    notAPageName: ["<h3>結論草稿</h3>"],
  },
];

/**
 * 「儲存計畫設定」是**按鈕**的名字，不是分頁名字，而且沒有改過。
 * 它含有「計畫設定」四個字，所以掃描時要先把它整串拿掉，
 * 否則永遠誤報。
 *
 * ⚠️ 這個豁免清單不可以變成萬用貼紙：每一條都要是
 *   「確實不是分頁名稱」的具體字串，不可以寫成通配。
 */
const NOT_A_PAGE_NAME = [
  "儲存計畫設定", // 建立與管理計畫頁上的按鈕
  "計畫設定已更新", // toast 訊息
  "請先完成計畫設定", // toast 訊息
];

function titlesMap() {
  /*
   * ⚠️ `titles` 有兩個來源：`app.js` 的字面物件，以及 quality-extension.js
   *   動態加上去的那幾個（`titles.delivery = "…"`）。只讀前者會讓
   *   動態掛的那幾頁變成「titles 裡沒有這一頁」。
   */
  const extra = Object.fromEntries(
    [
      ...readFileSync(new URL("./quality-extension.js", import.meta.url), "utf8").matchAll(
        /titles\.([A-Za-z]+)\s*=\s*"([^"]+)"/g,
      ),
    ].map((m) => [m[1], m[2]]),
  );
  const start = appSource.indexOf("const titles = {");
  assert.notEqual(start, -1, "app.js 裡找不到 `const titles = {`");
  const end = appSource.indexOf("\n};", start);
  assert.ok(end > start, "`const titles` 的結尾找不到");
  const block = appSource.slice(start, end);
  const out = {};
  for (const m of block.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*"([^"]+)"/gm))
    out[m[1]] = m[2];
  return { ...out, ...extra };
}

test("前置：titles 讀得到，而且含有本次要守的那幾個名字", () => {
  const titles = titlesMap();
  assert.ok(
    Object.keys(titles).length >= 8,
    `titles 只讀到 ${Object.keys(titles).length} 筆——正規表示式可能壞了，` +
      `再往下驗會全部恆真`,
  );
  const names = new Set(Object.values(titles));
  for (const { now } of RENAMED)
    assert.ok(
      names.has(now) ||
        appSource.includes(now) ||
        indexHtml.includes(now),
      `改名後的名稱「${now}」在程式裡一個字都找不到——RENAMED 這張表過期了`,
    );
});

test("說明文字裡不可以再用改名前的分頁名稱", () => {
  const titles = titlesMap();
  const current = new Set(Object.values(titles));

  for (const { old, now, when, notAPageName = [] } of RENAMED) {
    assert.ok(
      !current.has(old),
      `「${old}」還在 titles 裡——RENAMED 這張表把還在用的名字當成舊名字了`,
    );

    /*
     * ⚠️ 2026-09-25 第五輪獨立複查：這一段原本只掃 app.js 與 index.html，
     *   **手冊沒掃**——而手冊正是使用者唯一的權威說明。實際漏掉的後果見
     *   同一輪抓到的「手冊還寫著『一 資料匯入』」（區名 2026-09-13 已改成
     *   「一　建立與匯入」）。手冊一併掃進來。
     */
    for (const [label, source] of [
      ["app.js", appSource],
      ["index.html", indexHtml],
      ["manual-src/manual.html", MANUAL_HTML],
    ]) {
      let text = source;
      for (const exempt of [...NOT_A_PAGE_NAME, ...notAPageName])
        text = text.split(exempt).join("");

      /*
       * 只抓「」或 <h3> 框起來的——那才是「指路到某一個分頁」的寫法。
       * 註解裡的歷史說明（例如「原本叫『四　圖表與比較』」）不算，
       * 所以要求前後緊貼引號或標籤，不做寬鬆的子字串比對。
       */
      const patterns = [
        new RegExp(`「${old}」`, "g"),
        new RegExp(`<h3>${old}</h3>`, "g"),
        new RegExp(`進入${old}`, "g"),
        /*
         * 手冊列區名／分頁名時用的是 <strong>…</strong>（有時前面帶區號），
         * 所以多加這一種寫法，否則手冊那一份掃進來了也照樣抓不到。
         */
        new RegExp(`<strong>(?:[一二三四五][ 　])?${old}</strong>`, "g"),
        /*
         * ⚠️ 手冊列「選單項目」時用的是表格第一欄 `<td class="k">…</td>`，
         *   既有的三種樣式都抓不到——第六輪就是這樣漏掉「結論草稿」的。
         */
        new RegExp(`<td class="k">(?:[一二三四五][ 　])?${old}</td>`, "g"),
      ];
      const hits = [];
      for (const re of patterns)
        for (const m of text.matchAll(re)) {
          /*
           * 註解裡的歷史敘述放行——它不是使用者看得到的文字。
           * 區塊註解：往前找最近的開頭與結尾比大小。
           * 單行註解：看這一行在命中處之前有沒有 `//`。
           */
          const before = text.slice(0, m.index);
          const openAt = before.lastIndexOf("/*");
          const closeAt = before.lastIndexOf("*/");
          if (openAt > closeAt) continue;
          const lineStart = before.lastIndexOf("\n") + 1;
          if (before.slice(lineStart).includes("//")) continue;
          hits.push(m[0]);
        }
      assert.deepEqual(
        hits,
        [],
        `${label} 的說明文字還寫著「${old}」，但畫面上那一頁叫「${now}」` +
          `（${when} 改的）——使用者照說明去側欄找會找不到`,
      );
    }
  }
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  手冊裡寫的按鈕／分頁名字，必須是畫面上真的那一個
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-23 的獨立複查抓到：手冊第 9 步寫
 *     「備份與淨空」→ 下載目前 Project 專案包
 * 但畫面上那顆按鈕改名之後是「下載目前計畫的專案包」
 * （app.js：`$("downloadBackup").textContent = "下載目前計畫的專案包"`）。
 *
 * ⚠️ 上面那幾支守門看不到這件事，因為它們**只讀 app.js 與 index.html**，
 *   `manual-src/manual.html` 完全不在掃描範圍內——而手冊正是使用者
 *   唯一的權威說明。守「說明文字」卻不守「手冊」，是這一組守門最大的洞。
 *
 * ── 判法，以及一個踩過的坑 ──
 *
 * ⚠️ **不可以用「整份原始碼裡找得到這幾個字」來判**。
 *   第一版就是那樣寫的，結果把舊名字塞回手冊、測試照樣全綠——因為
 *   app.js 的一段**說明文字**裡剛好也有「下載目前 Project 專案包」這句話。
 *   找得到那幾個字，不等於畫面上有一顆那樣的按鈕。
 *
 * 所以這裡先把**真正的控制項名稱**抽出來（按鈕文字、textContent 指派、
 * summary／區塊標題、分頁名稱），再拿手冊的名字去對。
 */
const MANUAL_HTML = readFileSync(
  new URL("./manual-src/manual.html", import.meta.url),
  "utf8",
);

/** 掃得到控制項名稱的檔案：畫面骨架 ＋ 所有非測試的 .js。 */
const UI_FILES = [
  "index.html",
  "app.js",
  "quality-extension.js",
  "column-filter.js",
  "main-filters.js",
  "main-toolbar.js",
  "trend.js",
  "conclusion.js",
  "excel-export.js",
  "trend-excel.js",
  "period-date.js",
  "los-rule-scope.js",
  "direction-pair.js",
  "chart-levels.js",
];

function controlLabels() {
  const source = UI_FILES.map((name) =>
    readFileSync(new URL(`./${name}`, import.meta.url), "utf8"),
  ).join("\n");
  const found = new Set();
  const PATTERNS = [
    /<button[^>]*>([^<]{1,40})<\/button>/g,
    /\.textContent\s*=\s*"([^"]{1,40})"/g,
    /\.textContent\s*=\s*`([^`]{1,40})`/g,
    /<summary[^>]*>([^<]{1,40})<\/summary>/g,
    /<h2[^>]*>([^<]{1,40})<\/h2>/g,
    /<h3[^>]*>([^<]{1,40})<\/h3>/g,
    /<h4[^>]*>([^<]{1,40})<\/h4>/g,
  ];
  for (const pattern of PATTERNS)
    for (const match of source.matchAll(pattern)) found.add(match[1].trim());
  /* 分頁名稱也算控制項——手冊常寫「到『資料維護』頁」。 */
  for (const value of Object.values(titlesMap())) found.add(String(value).trim());
  return found;
}

/**
 * 名字是**動態組出來的**，原始碼裡不會有一模一樣的字串。
 * ⚠️ 只有這一種理由可以進這張表。「我找不到但應該有吧」不算。
 */
const DYNAMIC_BUTTON_LABELS = new Map([
  [
    "刪除計畫「編號」",
    "實際文字是 `刪除計畫「${code}」`，會帶入目前的計畫編號（app.js 的 deleteProjectBtn）",
  ],
  [
    "回歸全部",
    "實際文字是 `回歸全部（${n} 塊正在用自己的條件）`，括號裡的數字會變（app.js 主工具列）",
  ],
]);

test("⚠️ 手冊裡的按鈕／分頁名字都是畫面上真的那一個", () => {
  const labels = [
    ...new Set(
      [...MANUAL_HTML.matchAll(/<span class="btn">([^<]+)<\/span>/g)].map(
        (match) => match[1].trim(),
      ),
    ),
  ];
  assert.ok(
    labels.length >= 15,
    `只抓到 ${labels.length} 個名字——正規表示式可能改壞了，這一支會安靜地變成恆真`,
  );
  const controls = controlLabels();
  assert.ok(
    controls.size >= 80,
    `只抓到 ${controls.size} 個控制項名稱——抽取規則可能改壞了，` +
      "那樣下面會誤報一堆，最後有人把這一支關掉",
  );
  const missing = labels.filter(
    (label) => !DYNAMIC_BUTTON_LABELS.has(label) && !controls.has(label),
  );
  assert.deepEqual(
    missing,
    [],
    "手冊寫了這幾個名字，但畫面上沒有同名的控制項：\n  " +
      missing.join("\n  ") +
      "\n使用者照手冊操作會找不到。若名字是動態組出來的，" +
      "請加進 DYNAMIC_BUTTON_LABELS 並寫明理由。",
  );
});

test("⚠️ 這一支真的抓得到（反面檢查，不然它可能永遠是綠的）", () => {
  const controls = controlLabels();
  assert.ok(
    controls.has("下載目前計畫的專案包"),
    "抽不到那顆按鈕的現名，下面的反證沒有意義",
  );
  assert.ok(
    !controls.has("下載目前 Project 專案包"),
    "舊名字被當成控制項抽出來了——它只出現在說明文字裡，" +
      "抽取規則太寬的話這一支就會漏掉真正的不一致（第一版就是這樣）",
  );
});

test("⚠️ 例外表裡不可以放「其實是靜態名稱」的項目（免得理由與事實對不上）", () => {
  const controls = controlLabels();
  const stale = [...DYNAMIC_BUTTON_LABELS.keys()].filter((label) =>
    controls.has(label),
  );
  assert.deepEqual(
    stale,
    [],
    "例外表說這幾個是動態組出來的，但抽得到一模一樣的控制項名稱：" +
      stale.join("、"),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  K37：「支援名稱」清單必須就是程式真的接受的那一組
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-24 大檢查抓到：程式接受四個上午分頁名
 *   matrix(wb, ["上午尖峰", "上午", "AM尖峰", "AM"])
 * 但找不到工作表時給使用者的訊息只列了「上午尖峰、下午尖峰、上午、下午、AM、PM」
 * ——漏掉「AM尖峰」「PM尖峰」。
 *
 * ⚠️ 這種漏列的後果是使用者做出錯誤的動作：他的分頁叫「AM尖峰」，
 *   因為別的原因匯入失敗時，他讀到這份清單會以為是分頁名不對，
 *   於是去改一個本來就正確的分頁名，真正的原因反而被放過。
 *   程式對、訊息錯，而這種錯不會有任何測試紅。
 *
 * ── 守法 ──
 *
 * 不釘死訊息字串（那樣只是把今天的內容抄一遍，明天程式多收一個名字照樣漏）。
 * 改為**從程式實際的 matrix() 呼叫把名單抓出來**，逐一驗它出現在訊息裡。
 * 這樣「程式多收一個名字、訊息沒跟上」就會紅。
 *
 * 反證：把訊息裡的「AM尖峰、PM尖峰、」刪掉（也就是修正前的樣子），這一項會紅。
 */
test("找不到工作表的訊息，必須列出程式真的接受的每一個分頁名", () => {
  const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");

  const accepted = [];
  for (const call of source.matchAll(/matrix\(wb,\s*\[([^\]]+)\]/g)) {
    for (const piece of call[1].split(","))
      if (/^\s*"[^"]+"\s*$/.test(piece)) accepted.push(piece.trim().slice(1, -1));
  }

  /* 前置檢查：名單真的抓到了，否則正規式改壞後這一支會變恆真。 */
  assert.ok(
    accepted.length >= 6,
    `沒抓到 matrix() 的分頁名單（只抓到 ${accepted.length} 個），正規式要修`,
  );
  assert.ok(accepted.includes("上午尖峰"), "前置檢查：名單裡應該有「上午尖峰」");

  /*
   * ⚠️ 2026-09-25 F6 第三輪抓到：第一版只驗**錯誤訊息**這一處，
   *   而同一份名單在使用者真的會讀到的另外兩個地方仍然是舊的：
   *     ・`manual-src/manual.html` 的「上午／下午」那一列
   *     ・`app.js` 內嵌使用說明「九、舊版 Excel 相容」那一段
   *   v2.20.72 宣稱「補上程式其實接受的 AM尖峰／PM尖峰」，實際只補了一處，
   *   而守門也只守那一處——所以漏的兩處永遠不會紅。
   *   手冊比錯誤訊息更常被拿來照著改檔案，漏列的後果一模一樣。
   *
   * ⚠️ 三處的**寫法刻意不同**（訊息用「、」、手冊用「、」、內嵌說明用「／」），
   *   所以比對的是「每一個名字有沒有出現在那一段文字裡」，不是整串字串相等。
   */
  const manual = readFileSync(
    new URL("./manual-src/manual.html", import.meta.url),
    "utf8",
  );
  const places = [
    {
      what: "匯入失敗的錯誤訊息",
      text: source.match(/"找不到上午／下午工作表（支援名稱：[^"]+"/)?.[0],
    },
    {
      what: "手冊「上午／下午」那一列",
      text: manual.match(/<td class="k">上午／下午<\/td><td>[^<]*/)?.[0],
    },
    {
      what: "畫面內說明「九、舊版 Excel 相容」",
      text: source.match(/支援 \.xls、\.xlsx、\.xlsm，以及[^。]*。/)?.[0],
    },
  ];

  const wanted = [...new Set(accepted)];
  const problems = [];
  for (const place of places) {
    /* 前置檢查：三段文字都要抓得到，抓不到就是寫法改了，不可以安靜略過。 */
    assert.ok(
      place.text,
      `抓不到「${place.what}」那一段文字——寫法改過的話這一支要跟著改`,
    );
    const missing = wanted.filter((name) => !place.text.includes(name));
    if (missing.length) problems.push(`${place.what}：漏了 ${missing.join("、")}`);
  }
  assert.deepEqual(
    problems,
    [],
    "程式接受的分頁名，在這些地方沒有列齊：\n  " + problems.join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  側欄按鈕上的字，必須與點進去之後的頁內標題**逐字相同**
 *  （2026-09-25 第五輪獨立複查抓到）
 * ══════════════════════════════════════════════════════════════════════
 *
 * e2e-nav-naming.mjs 把這一條寫成它要驗的準則③（「側欄叫 A、點進去叫 B 更糟」），
 * 但它只對 `setup` 一頁驗，其餘十幾頁沒有任何檢查。實際抓到兩處：
 *   ・側欄「結論草稿」／頁內「結論草稿產生器」
 *   ・側欄「成果交付」／頁內「季度成果交付」
 * 使用者要照手冊或說明去找頁面時，這種不一致就要自己在腦子裡對應。
 *
 * ⚠️ 只比對「側欄按鈕 ↔ titles[view]」這一組機械可算的關係，
 *   不列白名單、不打地鼠。`titles` 就是頁內標題的唯一來源
 *   （renderView 用它寫 h2），所以比它等於比頁內標題。
 * ⚠️ 反證：把側欄的「結論草稿產生器」改回「結論草稿」→ 紅。已驗過。
 */
/*
 * ══════════════════════════════════════════════════════════════════════
 *  側欄按鈕的字 = titles = **頁內那一塊的 h2**（2026-09-25 第六輪修正）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 第一版（第五輪加的）只比「側欄按鈕 ↔ titles」，而註解寫著
 *   「titles 就是頁內標題的唯一來源（renderView 用它寫 h2）」——**那是錯的**：
 *   `app.js` 裡沒有 `renderView`，`go(id)` 把 `titles[id]` 寫到**頁首那一行**
 *   （`#headTitle`），而每一頁的 `.title h2` 是各自寫死的。
 *   於是三頁不一致（新手說明／新手操作順序、匯入紀錄／匯入批次紀錄、
 *   資料維護／資料維護與資料異常檢查）**完全沒被抓到**，而報告還宣稱已「全表比對」。
 *
 * ⚠️ 另一個缺口：側欄按鈕原本只從 `index.html` 抓（14 顆），
 *   而 `roadadmin`／`importlog`／`maintenance`／`delivery` 是程式動態建的，
 *   一共 18 顆——那四顆的字改壞了也不會紅。現在三份原始碼一起抓。
 *
 * ⚠️ 四張圖那幾頁**刻意沒有頁內標題**（每一塊自己已經有區塊標題，
 *   再加一層會變成標題疊標題，使用者 2026-09-14 指名拿掉過）。
 *   所以「沒有 h2」是允許的，只有「有 h2 而且與側欄不一樣」才紅。
 */
{
  const extension = readFileSync(
    new URL("./quality-extension.js", import.meta.url),
    "utf8",
  );
  /** 側欄按鈕：index.html 的靜態 14 顆 ＋ 程式動態建的那幾顆。 */
  const navButtons = [
    ...[...indexHtml.matchAll(/<button[^>]*data-view="([a-zA-Z]+)"[^>]*>([^<]+)<\/button>/g)]
      .map((m) => ({ view: m[1], label: m[2] })),
    ...[...(appSource + extension).matchAll(
      /([A-Za-z]+)Button\.dataset\.view\s*=\s*"([a-zA-Z]+)"[\s\S]{0,200}?\1Button\.textContent\s*=\s*"([^"]+)"/g,
    )].map((m) => ({ view: m[2], label: m[3] })),
  ];
  /** 頁內那一塊的 h2：`<div class="title">…<h2>…</h2>`。 */
  const pageTitles = new Map();
  for (const source of [indexHtml, appSource, extension])
    for (const m of source.matchAll(
      /id="([a-zA-Z]+)" class="view">\s*<div class="title">[\s\S]{0,200}?<h2>([^<]*)<\/h2>/g,
    ))
      pageTitles.set(m[1], m[2]);
  /* 動態掛的那幾塊是 `xxxSection.innerHTML = ` 開頭，抓法不同。 */
  for (const source of [appSource, extension])
    for (const m of source.matchAll(
      /([A-Za-z]+)Section\.id\s*=\s*"([a-zA-Z]+)"[\s\S]{0,4000}?\1Section\.innerHTML\s*=\s*`<div class="title"><div><span class="eyebrow">[^<]*<\/span><h2>([^<]*)<\/h2>/g,
    ))
      pageTitles.set(m[2], m[3]);

  test("側欄按鈕的字 = titles = 頁內那一塊的 h2", () => {
    /* 前置檢查：三樣都抓得到，否則這一支等於沒在守。 */
    assert.ok(
      navButtons.length >= 17,
      `只抓到 ${navButtons.length} 顆側欄按鈕（靜態＋動態），應該有 18 顆——結構改了嗎？`,
    );
    const titles = titlesMap();
    assert.ok(Object.keys(titles).length >= 15, "titles 抓得太少，解析壞了");
    assert.ok(
      pageTitles.size >= 9,
      `只抓到 ${pageTitles.size} 個頁內 h2——抓法壞了嗎？（四張圖刻意沒有）`,
    );

    const bad = [];
    for (const { view, label } of navButtons) {
      const title = titles[view];
      if (!title) {
        bad.push(`${view}：側欄有這顆按鈕，但 titles 裡沒有這一頁`);
        continue;
      }
      if (title !== label) bad.push(`${view}：側欄「${label}」／titles「${title}」`);
      const h2 = pageTitles.get(view);
      /* 沒有頁內標題是允許的（四張圖）；有就必須一字不差。 */
      if (h2 !== undefined && h2 !== label)
        bad.push(`${view}：側欄「${label}」／頁內 h2「${h2}」`);
    }
    assert.deepEqual(
      bad,
      [],
      "側欄的字與 titles 或點進去之後的頁內標題不一樣。使用者要自己對應，"
        + "而手冊只能寫一個名字：\n  " + bad.join("\n  "),
    );
  });
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一顆側欄按鈕都要走 gotoView()（2026-09-25 第六輪獨立複查）
 * ══════════════════════════════════════════════════════════════════════
 *
 * `gotoView()` 比 `go()` 多做一件事：`setCollapsed(id, false)`——
 * 「點大分頁＝要看那一頁，所以它底下的小分頁一定要展開」
 * （使用者 2026-09-14 指名要的行為）。
 *
 * 第六輪抓到：成果交付那一顆是全站**唯一**繞過它、直接呼叫 `go()` 的，
 * 而 `e2e-nav-collapse.mjs` 只驗 `speed` 一頁，剛好落在守備範圍外。
 *
 * 守法：掃三份原始碼裡所有 `xxxButton.onclick = () => …("view")` 的寫法，
 * 要求呼叫的是 `gotoView`。這是機械可算的。
 */
test("側欄按鈕一律走 gotoView()，不可以只呼叫 go()", () => {
  const extension = readFileSync(
    new URL("./quality-extension.js", import.meta.url),
    "utf8",
  );
  const bad = [];
  for (const [source, name] of [
    [appSource, "app.js"],
    [extension, "quality-extension.js"],
  ])
    for (const m of source.matchAll(
      /([A-Za-z]+Button)\.onclick\s*=\s*\(\)\s*=>\s*(go|gotoView)\("([a-zA-Z]+)"\)/g,
    ))
      if (m[2] !== "gotoView") bad.push(`${name}：${m[1]} 走的是 ${m[2]}("${m[3]}")`);
  /* 前置檢查：真的抓到一批，否則這一支等於沒在守。 */
  const all = [
    ...appSource.matchAll(/[A-Za-z]+Button\.onclick\s*=\s*\(\)\s*=>\s*gotoView\(/g),
  ];
  assert.ok(
    all.length >= 3,
    `只抓到 ${all.length} 顆走 gotoView 的側欄按鈕——寫法改了嗎？`,
  );
  assert.deepEqual(
    bad,
    [],
    "這幾顆側欄按鈕繞過了 gotoView()，點下去不會展開它底下的小分頁：\n  "
      + bad.join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  「手冊第 N 章」的 N 必須真的是那一章（2026-09-25 第六輪）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 第六輪抓到三件互相獨立的事：
 *   ① `VALIDATION` 把「結論草稿產生器」寫成第 14 章（實際第 15 章）；
 *   ② 「左側選單的結構」說明框（講畫面導覽）被放在第 15 章末，
 *      所以文件引用它時寫成第 16 章——**兩邊都錯，而且互相對得起來**；
 *   ③ 封面導讀從第 14 章直接跳到第 16 章，第 15 章整章沒有入口。
 *
 * 光比對「章號存在嗎」抓不到 ①：14 章是存在的。所以這裡驗兩件事——
 *   ・任何「第 N 章」指到的 N 都必須存在（抓打錯與章節增刪）；
 *   ・**指名主題的引用**（例如「結論草稿產生器」）必須落在標題含那個主題的
 *     那一章（抓「號碼存在但指錯章」）。
 */
const CHAPTERS = new Map(
  [...MANUAL_HTML.matchAll(/<h2 class="sec[^"]*"><span class="n">([\d-b c]+?)\.<\/span>([^<]+)<\/h2>/g)].map(
    (m) => [m[1].trim(), m[2].trim()],
  ),
);

test("前置：手冊的章節標題真的抓得到", () => {
  assert.ok(
    CHAPTERS.size >= 15,
    `只抓到 ${CHAPTERS.size} 章——標題寫法改了嗎？抓不到就等於下面兩條恆真`,
  );
  assert.ok(CHAPTERS.has("1") && CHAPTERS.has("15"), `章號清單：${[...CHAPTERS.keys()].join("／")}`);
});

test("所有「第 N 章」的引用都指到真的存在的章", () => {
  const FILES = {
    "manual-src/manual.html": MANUAL_HTML,
    "README.md": readFileSync(new URL("./README.md", import.meta.url), "utf8"),
    "VALIDATION": readFileSync(
      new URL(`./${validationFileName(here)}`, import.meta.url),
      "utf8",
    ),
    "【更新說明】請先讀我.txt": readFileSync(
      new URL("./【更新說明】請先讀我.txt", import.meta.url),
      "utf8",
    ),
  };
  const bad = [];
  for (const [name, text] of Object.entries(FILES))
    for (const m of text.matchAll(/第 ?(\d+(?:-[bc])?) ?章/g))
      if (!CHAPTERS.has(m[1])) bad.push(`${name}：第 ${m[1]} 章`);
  assert.deepEqual(bad, [], `這些引用指到手冊裡不存在的章：\n  ${bad.join("\n  ")}`);
});

test("指名主題的章號引用，必須落在標題含那個主題的那一章", () => {
  /*
   * ⚠️ 期望值刻意寫死主題字，不從文件反推：從文件反推就永遠相符。
   *   新增這種「主題＋章號」的引用時，請把主題字補進這張表。
   */
  const TOPICS = [
    ["結論草稿產生器", "結論草稿"],
    ["成果交付", "成果交付"],
    ["方向名稱", "方向名稱"],
  ];
  const bad = [];
  for (const [topic, titleMustInclude] of TOPICS) {
    const want = [...CHAPTERS].find(([, title]) => title.includes(titleMustInclude));
    assert.ok(want, `手冊裡找不到標題含「${titleMustInclude}」的章`);
    /*
     * ⚠️ 數字可能被 Markdown 粗體包起來（`第 **15** 章`）。
     *   2026-09-25 第六輪發現：原本的樣式抓不到那種寫法，
     *   於是驗證報告裡帶粗體的章號引用**完全不在守備範圍**。
     */
    const NUM = "\\*{0,2}(\\d+(?:-[bc])?)\\*{0,2}";
    const re = new RegExp(
      `第\\s*${NUM}\\s*章[^。\\n]{0,12}${topic}|${topic}[^。\\n]{0,12}第\\s*${NUM}\\s*章`,
      "g",
    );
    for (const [name, text] of [
      ["manual-src/manual.html", MANUAL_HTML],
      ["README.md", readFileSync(new URL("./README.md", import.meta.url), "utf8")],
      [
        "VALIDATION",
        readFileSync(new URL(`./${validationFileName(here)}`, import.meta.url), "utf8"),
      ],
    ])
      for (const m of text.matchAll(re)) {
        const got = m[1] ?? m[2];
        if (got !== want[0])
          bad.push(`${name}：「${topic}」寫成第 ${got} 章，實際是第 ${want[0]} 章（${want[1]}）`);
      }
  }
  assert.deepEqual(bad, [], `章號指錯章：\n  ${bad.join("\n  ")}`);
});

test("封面導讀不可以跳過任何整數章", () => {
  /*
   * 第六輪抓到：導讀從「第 14 章」直接跳到「第 16 章」，
   * 第 15 章（結論草稿產生器）整章沒有任何入口——讀者找不到它。
   */
  const guide = MANUAL_HTML.match(/<th[^>]*>您想完成的事<\/th>[\s\S]*?<\/table>/);
  assert.ok(guide, "找不到封面的導讀表");
  const cited = new Set();
  for (const m of guide[0].matchAll(/第 (\d+)(?:～(\d+))? 章/g)) {
    const from = Number(m[1]);
    const to = Number(m[2] ?? m[1]);
    for (let n = from; n <= to; n += 1) cited.add(String(n));
  }
  assert.ok(cited.size >= 10, `導讀表只引用了 ${cited.size} 章——選擇器要跟著改`);
  const maxInt = Math.max(
    ...[...CHAPTERS.keys()].filter((k) => /^\d+$/.test(k)).map(Number),
  );
  const missing = [];
  for (let n = 1; n <= maxInt; n += 1)
    if (!cited.has(String(n))) missing.push(`第 ${n} 章（${CHAPTERS.get(String(n))}）`);
  assert.deepEqual(
    missing,
    [],
    `導讀表沒有任何一列指到這些章，讀者找不到它們：\n  ${missing.join("\n  ")}`,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  手冊叫使用者按的按鈕，必須是**真正的按鈕文字**（2026-09-25 第六輪）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 三支同一條。姊妹系統路口轉向本輪抓到：手冊、畫面上的提示與註解三處都叫
 *   使用者「按一下『重新套用計算』」，而**全站沒有那一顆按鈕**。
 *   它之所以「在原始碼裡找得到」，是因為它出現在一段**說明文字**裡——
 *   而「說明文字提到一個不存在的按鈕」正是要抓的東西。
 *   所以判準不是「這串字在原始碼裡」，而是「它是某一顆按鈕的字」。
 *
 * ⚠️ 允許「後面接括號補述」的前綴相符（手冊寫「取消匯入」、按鈕上是
 *   「取消匯入（清除預覽）」）。只允許括號，不允許任意前綴——任意前綴會讓這一支鬆掉。
 */
test("手冊叫使用者按的按鈕，必須是真正的按鈕文字", () => {
  const FILES = [
    "app.js",
    "index.html",
    "quality-extension.js",
    "column-filter.js",
    "main-toolbar.js",
    "main-filters.js",
    "trend.js",
    "conclusion.js",
    "excel-export.js",
  ];
  let source = "";
  for (const name of FILES) {
    const url = new URL(`./${name}`, import.meta.url);
    if (!existsSync(url)) continue;
    source += readFileSync(url, "utf8");
  }
  assert.ok(source.length > 300_000, `只讀到 ${source.length} 字，檔案清單壞了嗎？`);

  const squeeze = (text) => text.replace(/\s+/g, "");
  const buttons = new Set();
  for (const m of source.matchAll(/<button[^>]*>([^<]{1,40})<\/button>/g))
    buttons.add(squeeze(m[1]));
  /* 動態建立的按鈕：`x.textContent = "…"`、`x.innerHTML = "…"` */
  for (const m of source.matchAll(
    /(?:textContent|innerHTML)\s*=\s*["'`]([^"'`\n<>]{2,40})["'`]/g,
  ))
    buttons.add(squeeze(m[1]));
  /* 側欄按鈕（index.html 的 nav） */
  for (const m of source.matchAll(/data-view="[^"]+"[^>]*>([^<]{1,30})</g))
    buttons.add(squeeze(m[1]));
  assert.ok(buttons.size >= 30, `只抽到 ${buttons.size} 個按鈕文字，抽取方式不對`);
  for (const must of ["套用並重算LOS", "清除全部篩選"])
    assert.ok(buttons.has(must), `按鈕文字清單裡沒有「${must}」，抽取方式不對`);

  const plain = MANUAL_HTML.replace(/<[^>]+>/g, "");
  const cited = [
    ...new Set(
      [...plain.matchAll(/(?:按一下|按|點一下|點)「([^」]{2,16})」/g)].map((m) => m[1]),
    ),
  ];
  assert.ok(cited.length >= 3, `手冊裡只抓到 ${cited.length} 個「按「…」」`);
  const isReal = (name) => {
    const want = squeeze(name);
    for (const text of buttons) {
      if (text === want) return true;
      if (text.startsWith(want) && /^[（(]/.test(text.slice(want.length))) return true;
    }
    return false;
  };
  const missing = cited.filter((name) => !isReal(name));
  assert.deepEqual(
    missing,
    [],
    "手冊叫使用者按這幾顆按鈕，但它們**不是畫面上任何一顆按鈕的字**"
      + "（字串只出現在說明文字裡不算）：\n  "
      + missing.join("\n  "),
  );
});
