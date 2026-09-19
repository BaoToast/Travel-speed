/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列的條件模型（純資料，沒有 DOM，可以單獨寫測試）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一套三態機制**三支程式一律相同**（使用者 2026-09-14：
 *   「三個程式要統一的，包含主工具列的 全部回歸鍵 和 各自圖表的回歸鍵，
 *     以及你說的圖自己的篩選只影響自己，不會影響到其他圖表，
 *     這方面的規定應該是適用三項程式」）。
 *   主工具列上**放哪些條件**則三支不同，因為三支擁有的東西不一樣。
 *   路口轉向的同一份模型在 g2164/app/main-filters.ts，欄位不同、規則相同。
 *
 * ── 三態，缺一不可 ────────────────────────────────────────────
 *
 *   (1) 鏡子：區塊上那一顆下拉顯示的就是主工具列現在的值；主工具列一改，
 *          那一顆**看得到跟著變**，而且數字要真的重算。
 *          ⚠️ 這一態最容易被漏掉：只驗「改區塊上的不影響別塊」的話，
 *            一個「區塊永遠顯示自己預設值、根本不看主工具列」的實作也會全綠。
 *   (2) 脫離：使用者真的動了區塊上的條件 → **只有那一塊**改用自己的值，
 *          並寫明「目前用本區塊自己的條件（主工具列：…）」。
 *   (3) 回歸：每一塊脫離的區塊有一顆「回到主工具列條件」；
 *          主工具列上另有一顆「回歸全部（N 塊）」。
 *
 * ── 這一支程式的條件（與路口轉向不同，見對照表） ──────────────
 *
 *   A 季度   起訖區間（預設起＝迄＝最新一季，等於單季）
 *   B 路段   多選
 *   C 日別   平日／假日／平日＋假日並列
 *   D 方向   方向1／方向2／雙向並列
 *   E 尖峰   上午／下午／上午＋下午並列／**代表尖峰（系統取最差）**
 *
 *   ⚠️ 「代表尖峰」＝**升級前的既有行為**，所以它是預設值。
 *     尖峰彙總的每一列本來就是「同一組 4 筆裡最差的那一筆」，
 *     那同時決定了是上午還是下午、是哪一個方向。
 *     預設維持它，升級當天一個數字都不會變（基準逐格比對過）。
 */
(function (globalScope) {
  "use strict";

  /** 日別。 */
  /*
   * ══════════════════════════════════════════════════════════════════
   *  日別與方向**沒有**「全部」這一個選項（使用者 2026-09-17 裁示甲案）
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者問：「平日＋假日並列 和 全部日別，有什麼差異嗎?」
   * 查證結果：**完全沒有差異**。matchesDetail 只在選「平日」或「假日」時
   * 才真的擋掉列，"all" 與 "side-by-side" 兩個值一個都不進入那兩個分支；
   * 會依日別拆開畫的區塊，拆的依據是「資料裡有哪幾種日別」，也不看這個值。
   * 方向同理（只有「方向1」「方向2」會擋列）。
   *
   * ⚠️ 兩個名字不同、行為相同的選項比少一個選項更糟：
   *   使用者會合理地以為它們不一樣，於是花時間去比對兩份一模一樣的結果。
   * ⚠️ 留下來的是「並列」，不是「全部」——理由是全日交通量那一支就是
   *   「平日／假日／平日＋假日」三個，三支要一致（使用者一貫的原則）；
   *   而且「並列」講的是**呈現方式**，比「全部」多給了一個資訊。
   * ⚠️ 舊的存檔裡會有 "all"，載入時一律換成 "side-by-side"（見 normalizeMain）。
   */
  var DAY_CHOICES = ["weekday", "holiday", "side-by-side"];
  /** 方向。 */
  var DIRECTION_CHOICES = ["方向1", "方向2", "side-by-side"];
  /** 尖峰。 */
  var PEAK_CHOICES = ["representative", "上午尖峰", "下午尖峰", "side-by-side"];

  var DEFAULT_MAIN_FILTERS = {
    /* 起＝迄＝最新一季；開機時由呼叫端填入，這裡留空字串。 */
    periodFrom: "",
    periodTo: "",
    /** 空陣列＝全部路段。 */
    roads: [],
    /* ⚠️ 預設＝並列（＝舊的 "all"，行為完全相同，見 DAY_CHOICES 的說明）。 */
    day: "side-by-side",
    direction: "side-by-side",
    /*
     * ⚠️ 預設一定是 "representative"（代表尖峰）。
     *   那是升級前唯一的行為：彙總取同一組 4 筆裡最差的那一筆。
     *   改成 "上午尖峰" 之類的話，升級當天全部的彙總數字都會變。
     */
    peak: "representative",
  };

  var FIELD_LABELS = {
    periodFrom: "季度",
    periodTo: "季度",
    roads: "路段",
    day: "日別",
    direction: "方向",
    peak: "尖峰",
  };

  var DAY_LABELS = {
    /* ⚠️ "all" 只為了讀得懂舊存檔而留在對照表裡，選單上不再出現。 */
    all: "平日＋假日並列",
    weekday: "平日",
    holiday: "假日",
    "side-by-side": "平日＋假日並列",
  };

  var DIRECTION_LABELS = {
    /* ⚠️ 同上，只為了讀得懂舊存檔。 */
    all: "雙向並列",
    方向1: "方向1",
    方向2: "方向2",
    "side-by-side": "雙向並列",
  };

  var PEAK_LABELS = {
    representative: "代表尖峰（系統取最差）",
    上午尖峰: "上午尖峰",
    下午尖峰: "下午尖峰",
    "side-by-side": "上午＋下午並列",
  };

  /** 某一塊實際該用的條件（沒脫離時就是主工具列那一份）。 */
  /**
   * 把舊存檔裡的 "all" 換成 "side-by-side"。
   *
   * ⚠️ 2026-09-17 起日別與方向都沒有「全部」這一個值了（見 DAY_CHOICES）。
   *   不換的話，舊存檔載進來之後下拉會選不到任何一項（顯示成空白），
   *   而畫面上的數字其實是對的——那是最難查的一種：控制項看起來壞了，
   *   資料卻沒事。兩個值的行為本來就相同，所以換過去不會改變任何數字。
   */
  function normalizeLegacyAll(filters) {
    if (!filters) return filters;
    if (filters.day !== "all" && filters.direction !== "all") return filters;
    var next = Object.assign({}, filters);
    if (next.day === "all") next.day = "side-by-side";
    if (next.direction === "all") next.direction = "side-by-side";
    return next;
  }
  function filtersFor(main, overrides, chartId) {
    var own = overrides && overrides[chartId];
    if (!own) return normalizeLegacyAll(main);
    return normalizeLegacyAll(Object.assign({}, main, own));
  }

  function isDetached(overrides, chartId) {
    var own = overrides && overrides[chartId];
    return Boolean(own) && Object.keys(own).length > 0;
  }

  function detachedIds(overrides) {
    return Object.keys(overrides || {}).filter(function (id) {
      return isDetached(overrides, id);
    });
  }

  /**
   * 在某一塊上改一個條件 → 只有那一塊脫離。
   * ⚠️ 回傳新的 overrides，不就地改——呼叫端可能拿舊的那一份做比較。
   */
  function setChartFilter(overrides, chartId, field, value) {
    var next = Object.assign({}, overrides || {});
    next[chartId] = Object.assign({}, next[chartId] || {});
    next[chartId][field] = value;
    return next;
  }

  function resetChart(overrides, chartId) {
    if (!overrides || !overrides[chartId]) return overrides || {};
    var next = Object.assign({}, overrides);
    delete next[chartId];
    return next;
  }

  function resetAllCharts() {
    return {};
  }

  /**
   * 季度區間**有沒有被拉開**（起 ≠ 迄）。
   *
   * ⚠️ 這**不是**「有沒有篩季度」。
   *
   *   2026-09-15 使用者定案：**起＝迄＝只有那一季**（不是「不限季」）。
   *   所以選了單季**也是在篩**——只是這個函式答不出來，因為它看不到
   *   「總共有哪幾季」。要問「有沒有比全部季度窄」請用
   *   `MT.isPeriodNarrowed(chartId, allPeriods)`，它拿得到季度清單。
   *
   *   這個函式只回答一件事：**一張卡放不下的那種情形**——
   *   區間拉開時，只能顯示其中一季，那時要跟使用者說一聲。
   */
  function isRangeWidened(filters) {
    return Boolean(
      filters.periodFrom &&
        filters.periodTo &&
        filters.periodFrom !== filters.periodTo,
    );
  }

  /**
   * 「有沒有真的篩」——不適用的提醒只在這個為真時才出現。
   *
   * ⚠️ 沒篩的時候跳出來講一句沒有人問的話，是另一種噪音
   *   （使用者 2026-09-14 明確要求「只在真的篩了那個條件時出現」）。
   *
   * ⚠️⚠️ **季度不要用這個函式問**（2026-09-15 起）。
   *   舊註解寫著「起＝迄不算篩」——那是 M-1 之前的語意，現在剛好相反：
   *   起＝迄就是「只有那一季」，那當然是在篩。
   *   但這個函式看不到季度清單，答不出「有沒有比全部季度窄」，
   *   所以季度一律走 `isPeriodNarrowed`（要問「是不是拉開了」走
   *   `isRangeWidened`）。tests/main-filters.test.mjs 有一條掃描擋著，
   *   任何呼叫端把 periodFrom／periodTo 丟進來都會紅。
   *   為了不讓舊呼叫端整支壞掉，這裡仍然回答 isRangeWidened 的值，
   *   **但那不是「有沒有篩」的答案**。
   */
  function isFiltered(filters, field) {
    if (field === "roads") return (filters.roads || []).length > 0;
    if (field === "periodFrom" || field === "periodTo")
      return isRangeWidened(filters);
    return filters[field] !== DEFAULT_MAIN_FILTERS[field];
  }

  /**
   * 使用者**主動選了**這個值嗎？
   *
   * ⚠️ 甲案（使用者 2026-09-17）之後，日別與方向的預設值**就是** "side-by-side"。
   *   所以「值等於並列」不再等於「使用者選了並列」。
   *
   *   幾張表與圖上掛著「並列在這一塊不適用／看到的是同一份」那幾句，
   *   條件原本寫的是 `f.day === "side-by-side" || …`——甲案之前那等於
   *   「他主動選了並列」，甲案之後變成**恆真**，於是那幾句在預設狀態下
   *   就一直掛在畫面上。而這類說明的規則一直是
   *   **只在使用者真的縮小／改動了條件時才出現**（沒改卻講一句是噪音，
   *   而常駐的噪音會讓人連真正要緊的那幾句一起略過）。
   *   2026-09-17 由 e2e-main-toolbar ④ 抓到。
   *
   * ⚠️ 尖峰的並列**仍然不是**預設（預設是代表尖峰），所以那一格照舊會講。
   */
  function chose(filters, field, value) {
    return filters[field] === value && isFiltered(filters, field);
  }

  /**
   * 主工具列目前的條件，寫成一行給脫離的區塊標註用。
   *
   * ⚠️ 第二個參數 showQuarter **必須**傳進來（畫面上所有顯示季度的地方都要走它），
   *   否則這一行會是**唯一**還寫著「115Q1」的地方——使用者切到西元年／調查月份時，
   *   整頁都改了、只有這一句沒改，等於一頁兩種年份寫法。
   *   （2026-09-15 在全日交通量上被 e2e 抓到，三支同一套寫法，一起修。）
   *   預設值只是為了不讓舊呼叫端壞掉，**不是可以省略**。
   */
  function describeMain(main, showQuarter) {
    var fmt =
      typeof showQuarter === "function"
        ? showQuarter
        : function (value) {
            return value;
          };
    var parts = [];
    parts.push(
      main.periodFrom && main.periodTo
        ? main.periodFrom === main.periodTo
          ? fmt(main.periodFrom)
          : fmt(main.periodFrom) + "～" + fmt(main.periodTo)
        : "全部季度",
    );
    parts.push((main.roads || []).length ? (main.roads || []).length + " 個路段" : "全部路段");
    /* ⚠️ 兩個都一律印出來：現在沒有「全部」那一個值可以當「不必講」。 */
    parts.push(DAY_LABELS[main.day] || DAY_LABELS.all);
    parts.push(DIRECTION_LABELS[main.direction] || DIRECTION_LABELS.all);
    parts.push(PEAK_LABELS[main.peak]);
    return parts.join("・");
  }

  /**
   * 不適用的說明文字。
   *
   * ⚠️ 「不適用」**不可以只是不做事**——使用者會以為篩選壞掉。
   *   每一句都要說**為什麼**，而且要說目前實際上是拿什麼在算。
   */
  function inapplicableNote(reason, actually) {
    return reason + "目前仍以" + actually + "計算。";
  }

  globalScope.LosMainFilters = {
    DAY_CHOICES: DAY_CHOICES,
    DIRECTION_CHOICES: DIRECTION_CHOICES,
    PEAK_CHOICES: PEAK_CHOICES,
    DEFAULT_MAIN_FILTERS: DEFAULT_MAIN_FILTERS,
    FIELD_LABELS: FIELD_LABELS,
    normalizeLegacyAll: normalizeLegacyAll,
    DAY_LABELS: DAY_LABELS,
    DIRECTION_LABELS: DIRECTION_LABELS,
    PEAK_LABELS: PEAK_LABELS,
    filtersFor: filtersFor,
    isDetached: isDetached,
    detachedIds: detachedIds,
    setChartFilter: setChartFilter,
    resetChart: resetChart,
    resetAllCharts: resetAllCharts,
    isFiltered: isFiltered,
    chose: chose,
    isRangeWidened: isRangeWidened,
    describeMain: describeMain,
    inapplicableNote: inapplicableNote,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
