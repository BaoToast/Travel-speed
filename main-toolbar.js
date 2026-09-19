/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列（交通服務水準）——畫面與接線
 * ══════════════════════════════════════════════════════════════════════
 *
 * 條件與三態的模型在 main-filters.js（純資料，沒有 DOM）。
 * 這一支只負責：畫出那一條、把值接到各區塊、以及「不適用」的說明。
 *
 * ⚠️ 升級前這一支程式**完全沒有跨頁的篩選條件**（實測 2026-09-14）：
 *   頂端只有計畫選單、期別顯示、年份顯示。所有條件散在各區塊自己的工具列，
 *   於是同一組條件要在四個地方各設一次；而「各路段 LOS 圖」與
 *   「各路段歷季旅行速率」**根本沒有條件可設**，永遠畫全部路段、全部季度。
 *
 * ⚠️ 「代表尖峰」是預設值，而且必須是。升級前的彙總就是「同一組 4 筆裡
 *   最差的那一筆」，那同時決定了是上午還是下午、是哪一個方向。
 *   預設維持它，升級當天一個數字都不會變。
 */
(function (globalScope) {
  "use strict";

  var M = globalScope.LosMainFilters;

  /**
   * 各區塊的 id。⚠️ 不要用中文標題當 id：標題改名過好幾次。
   *
   * ⚠️ 這裡的每一個 id **都必須真的有一塊在畫面上掛著
   *   `[data-detached-chart="<id>"]`**，否則它一旦脫離，
   *   主工具列的「看是哪幾塊」找不到那一塊，名稱只能寫「未命名區塊」。
   *   2026-09-16 移除的 `speed: "speed-trend"` 就是這種空號：
   *   全專案沒有任何一處讀它——「各路段歷季旅行速率」與「各路段 LOS 圖」
   *   在同一個區段裡、**共用 los 這一組條件**（見 renderLosChartNotes）。
   */
  var CHART_IDS = {
    detail: "detail-table",
    summary: "summary-table",
    los: "los-charts",
    trend: "trend-panel",
    band: "band-panel",
    quality: "quality-overview",
  };

  var state = {
    main: Object.assign({}, M.DEFAULT_MAIN_FILTERS),
    overrides: {},
    /** 呼叫端（app.js）在值變動之後要做的事。 */
    onChange: function () {},
    /** 目前計畫可選的季度與路段，由 app.js 每次重畫時餵進來。 */
    periods: [],
    roads: [],
    /** 期別在畫面上要顯示成什麼（app.js 的 showQuarter）。 */
    label: function (value) {
      return value;
    },
  };

  /**
   * 這一塊實際要用的條件。
   *
   * ⚠️ `"__unfiltered__"` 是一個**保留字**：呼叫端用它表示
   *   「我要的是完全沒有篩過的母體」（拿來算「主工具列篩掉了幾筆」的分母）。
   *
   * 大檢查 2026-09-15 查到的錯：這裡原本沒有處理這個保留字，
   * 於是它走一般路徑 → 沒有 override → **回傳主工具列那一份（已經篩過）**。
   * 後果是彙總表的「主工具列目前篩掉了 N 組（全部 M 組）」永遠算出
   * N ＝ 0，那一句**從來不會出現**——而使用者正是因為沒有這一句，
   * 以為表格裡的 114 年資料不見了（2026-09-15 回報）。
   */
  function filtersOf(chartId) {
    if (chartId === "__unfiltered__") return M.DEFAULT_MAIN_FILTERS;
    /*
     * 「__main__」＝主工具列那一份，**不看任何區塊的脫離**。
     *
     * ⚠️ 交出去的檔案要用這一個。使用者 2026-09-14 定的規則是
     *   「圖可以為了看而脫離，交出去的文件一律吃主工具列」；
     *   而拿某一個區塊的 id 去要條件，那一塊剛好脫離時就會把
     *   脫離後的條件寫進交付物。
     */
    if (chartId === "__main__") return M.normalizeLegacyAll(state.main);
    return M.filtersFor(state.main, state.overrides, chartId);
  }

  /*
   * ── hasOwnPeriod() 已於 2026-09-15 移除 ────────────────────────
   *
   * 它存在的唯一理由是分辨「起＝迄」的兩種意思：
   *   ・主工具列的起＝迄＝預設狀態（歷季類區塊看全部季度）
   *   ・使用者自己指定的起＝迄＝只看那一季
   *
   * 使用者 2026-09-15 把語意定死了：「起＝迄……**代表只有那一季**」，
   * 並指出「你一開始說的起＝迄代表不限季是錯誤的」。
   * 主工具列的預設值改成「起＝最早一季、迄＝最新一季」之後，
   * 預設狀態本來就是完整區間——**那個分辨本身就不存在了**。
   *
   * ⚠️ 不要再把它加回來：兩種意思合而為一是這一次的重點，
   *   加回去等於讓同一個操作又有兩種結果。
   */

  /**
   * 這一塊的季度區間**比全部季度窄**嗎？
   *
   * ⚠️ 不可以用 `MF.isFiltered(filters, "periodFrom")` 判斷這件事。
   *
   * 那一支比的是「與 DEFAULT_MAIN_FILTERS 不同」，而 2026-09-15 起主工具列
   * 的預設值是**實際的最早一季**（不是空字串），所以它會**恆為 true**——
   * 於是「季度區間已拉開」「選項只列這個範圍內的值」這幾句話會一直掛著，
   * 變成使用者永遠看得到的噪音（實測 e2e-main-toolbar 的前置當場轉紅）。
   *
   * 要問的其實是「有沒有變窄」，所以這裡拿目前區間去比**全部季度**。
   *
   * @param chartId  哪一塊
   * @param allPeriods 這個計畫全部的季度（已排序）
   */
  function isPeriodNarrowed(chartId, allPeriods) {
    var list = Array.isArray(allPeriods) ? allPeriods : state.periods || [];
    if (list.length <= 1) return false;
    var f = filtersOf(chartId);
    if (!f.periodFrom || !f.periodTo) return false;
    return f.periodFrom !== list[0] || f.periodTo !== list[list.length - 1];
  }

  function setMain(field, value) {
    state.main = Object.assign({}, state.main, {});
    state.main[field] = value;
    /*
     * ⚠️ 起 > 迄 是使用者做得到的動作（兩個下拉各自獨立）。
     *   不修的話後面每一個吃區間的區塊都會篩出 0 筆，
     *   而畫面上看起來條件是設好的。這裡把另一端一起帶過去，
     *   並由畫面上的說明告訴使用者發生了什麼。
     */
    if (field === "periodFrom" && indexOfPeriod(value) > indexOfPeriod(state.main.periodTo))
      state.main.periodTo = value;
    if (field === "periodTo" && indexOfPeriod(value) < indexOfPeriod(state.main.periodFrom))
      state.main.periodFrom = value;
    state.onChange();
  }

  /*
   * ⚠️ 季別索引全站**只有一份**，在 los-rule-scope.js 裡（它比這一支先載入）。
   *   這裡只是轉呼叫；理由見 app.js 的 periodIndex 註解。
   */
  function indexOfPeriod(value) {
    return globalScope.LosRuleScope.periodIndex(value);
  }

  function setChart(chartId, field, value) {
    state.overrides = M.setChartFilter(state.overrides, chartId, field, value);
    state.onChange();
  }

  /**
   * 一次設定同一塊的好幾個條件，只重畫一次。
   *
   * ⚠️ 不要在呼叫端連續呼叫 setChart()：那會重畫 N 次，
   *   而且中間每一次都是「條件只改了一半」的畫面——
   *   L-1 的脫離會在那幾格裡先畫出一張仍被主工具列篩過的表。
   */
  function setChartMany(chartId, values) {
    var next = state.overrides;
    Object.keys(values || {}).forEach(function (field) {
      next = M.setChartFilter(next, chartId, field, values[field]);
    });
    state.overrides = next;
    state.onChange();
  }

  function resetChart(chartId) {
    state.overrides = M.resetChart(state.overrides, chartId);
    state.onChange();
  }

  function resetAll() {
    state.overrides = M.resetAllCharts();
    state.onChange();
  }

  /**
   * X-10：把**主工具列自己**的條件全部回到預設（使用者 2026-09-16 交辦）。
   *
   * ⚠️ 與 resetAll() 是兩件事，不可以合併：
   *   ・resetMain()：改主工具列的值（季度、路段、日別、方向、尖峰）
   *   ・resetAll()：把**脫離的區塊**拉回來跟隨主工具列
   *   合併的話，使用者只想把條件歸零，卻連自己在某一塊上設好的條件
   *   也一起被清掉——而那是他刻意設的。
   *
   * ⚠️ 季度的預設值**不在** DEFAULT_MAIN_FILTERS 裡（那裡是空字串）：
   *   真正的預設是「最早一季～最新一季」，要由呼叫端在 onChange 之後
   *   用 syncMainToolbarPeriods() 填回去。所以這裡清成空字串就好，
   *   呼叫端同時要把「使用者動過區間」的旗標放掉。
   */
  function resetMain() {
    state.main = Object.assign({}, M.DEFAULT_MAIN_FILTERS);
    state.onChange();
  }

  /**
   * 主工具列現在是不是**完全等於預設**？（決定「恢復預設條件」要不要出現）
   *
   * @param main 目前的值
   * @param periods 這個計畫全部的季度（已排序）；沒有資料時傳空陣列
   */
  function isMainDefault(main, periods) {
    var d = M.DEFAULT_MAIN_FILTERS;
    var list = Array.isArray(periods) ? periods : state.periods || [];
    if ((main.roads || []).length) return false;
    if (main.day !== d.day) return false;
    if (main.direction !== d.direction) return false;
    if (main.peak !== d.peak) return false;
    /* 沒有季度可選時，季度那兩格本來就不算數。 */
    if (!list.length) return true;
    return (
      main.periodFrom === list[0] && main.periodTo === list[list.length - 1]
    );
  }

  /* ══ 篩選：明細 ══════════════════════════════════════════════ */

  /**
   * 依某一塊的條件篩出尖峰明細。
   *
   * ⚠️ 「並列」（side-by-side）在資料層**不篩掉任何東西**——
   *   它的意思是「這一塊要同時呈現兩邊」，是呈現方式不是篩選。
   *   在這裡當成篩選的話，兩邊都會被留下沒錯，但「全部」與「並列」
   *   就變成同一件事，使用者選了也看不出差別。
   *   真正的差別由各區塊自己在畫的時候處理（例如分成兩組柱子）。
   */
  function matchesDetail(row, filters, label) {
    if (filters.roads && filters.roads.length && !filters.roads.includes(row.road))
      return false;
    var from = filters.periodFrom;
    var to = filters.periodTo;
    /*
     * ── 「起＝迄」＝**只有那一季**（使用者 2026-09-15 定義，三支統一）──
     *
     * 使用者原話：「起＝迄，是指單一季度，例如起 114Q1、迄 114Q4，
     *   代表 114Q1~114Q4，如果起 114Q1、迄 114Q1，**代表只有 114Q1 這一季**」
     *   「你一開始說的**起＝迄代表不限季是錯誤的**」
     *   「如果該計畫目前只有一季的資料，主工具列的起迄就會顯示一季，
     *     **也是代表單季的意思**」
     *
     * ⚠️ 舊版把「起＝迄」在歷季類區塊上解釋成「不限季」，理由是
     *   「否則趨勢圖只剩一個點」。那是**用錯誤的語意去補預設值的問題**——
     *   真正該改的是預設值（起＝最早一季、迄＝最新一季），語意不該動。
     *   使用者也直接回掉了那個顧慮：「如果歷季圖出現起＝迄，導致趨勢圖
     *   只有單筆資料，那就只顯示單筆資料，是沒問題的，總不能這個計畫
     *   只有一季的資料，圖片卻顯示空白吧」。
     *
     * ⚠️ 所以這裡**不再分 single／range**：區間就是區間，起＝迄就是一季。
     *   `rangeMode` 參數因此失去意義（呼叫端仍可傳，但不影響結果），
     *   `hasOwnPeriod()` 也不再需要——它存在的唯一理由就是分辨
     *   「預設的起＝迄」與「使用者指定的起＝迄」，兩種意思合而為一之後，
     *   那個分辨本身就消失了。
     */
    if (from && to) {
      var index = indexOfPeriod(row.period);
      if (index < indexOfPeriod(from) || index > indexOfPeriod(to)) return false;
    }
    if (filters.day === "weekday" && row.day !== "平日") return false;
    if (filters.day === "holiday" && row.day !== "假日") return false;
    if (filters.direction === "方向1" && row.direction !== "方向1") return false;
    if (filters.direction === "方向2" && row.direction !== "方向2") return false;
    if (filters.peak === "上午尖峰" && row.peak !== "上午尖峰") return false;
    if (filters.peak === "下午尖峰" && row.peak !== "下午尖峰") return false;
    return true;
  }

  /**
   * @param rows      這個計畫的全部明細
   * @param chartId   哪一塊
   * @param rangeMode "single" ＝ 起＝迄時只看結束季度；"range" ＝ 永遠吃整個區間
   */
  /**
   * @param ignore  這一塊**刻意不吃**的條件（例如三段分法不吃「路段」）。
   *
   * ⚠️ 這個參數存在的理由，是讓「畫面上寫著不適用」與「真的不適用」
   *   變成同一件事。以前是靠各區塊自己記得不要套，結果三段分法上
   *   寫著「本圖不適用路段篩選，目前仍以全部路段計算」，
   *   而它其實照篩——篩成單一路段之後分母是 1，比例只會是 0% 或 100%，
   *   但畫面上那一句還在說它沒篩。（2026-09-16 實測抓到）
   *   寫著不適用卻其實會變，比沒有那一句更糟。
   */
  function detailsFor(rows, chartId, rangeMode, ignore) {
    var filters = filtersOf(chartId);
    if (ignore && ignore.length) {
      var relaxed = {};
      for (var key in filters)
        if (Object.prototype.hasOwnProperty.call(filters, key))
          relaxed[key] = filters[key];
      for (var i = 0; i < ignore.length; i += 1) {
        var field = ignore[i];
        /* ⚠️ 陣列要給一份新的，不可以把共用的預設陣列傳出去。 */
        relaxed[field] = Array.isArray(M.DEFAULT_MAIN_FILTERS[field])
          ? []
          : M.DEFAULT_MAIN_FILTERS[field];
      }
      filters = relaxed;
    }
    return rows.filter(function (row) {
      return matchesDetail(row, filters, rangeMode === "single" ? "single" : "range");
    });
  }

  /* ══ 篩選：彙總（先篩再挑最差） ══════════════════════════════ */

  /**
   * ⚠️ 這一段是這一支程式最容易算錯的地方。
   *
   *   彙總的每一列是「同一組（計畫・年・季・路段・日別）4 筆裡最差的那一筆」。
   *   主工具列篩了方向或尖峰時，**先把候選縮到符合條件的那幾筆，再挑最差**——
   *   例如只看方向1，就從方向1的上午、下午兩筆裡挑最差。
   *
   *   ⚠️ 絕對不可以拿已經建好的 state.summaries 再去篩：
   *     那一份是從**全部 4 筆**挑出來的，篩掉之後只會剩下
   *     「剛好代表值就是方向1」的那幾列，其餘整列消失——
   *     使用者會以為那些路段沒有資料。
   *
   *   ⚠️ 挑最差的排序**必須與 rebuild() 完全相同**，不可以在這裡另寫一套。
   *     所以排序函式由 app.js 傳進來（它就是 rebuild 用的那一支）。
   */
  function summariesFor(rows, chartId, worstOf, rangeMode, ignore) {
    var filtered = detailsFor(rows, chartId, rangeMode, ignore);
    var groups = {};
    for (var i = 0; i < filtered.length; i += 1) {
      var d = filtered[i];
      var key = [d.projectCode, d.year, d.quarter, d.road, d.day].join("|");
      (groups[key] = groups[key] || []).push(d);
    }
    return Object.keys(groups).map(function (key) {
      var list = groups[key];
      var best = worstOf(list);
      return Object.assign({}, best, {
        detailCount: list.length,
        /*
         * ⚠️ 篩過之後一定要寫明**代表值是從哪幾筆挑出來的**，
         *   否則使用者無法判斷這個數字的來源
         *  （既有規則「彙總代表值三項數值必須來自同一筆」的延伸）。
         */
        pickedFrom: list
          .map(function (row) {
            return row.direction + "・" + row.peak;
          })
          .join("、"),
      });
    });
  }

  globalScope.LosMainToolbar = {
    CHART_IDS: CHART_IDS,
    state: state,
    filtersOf: filtersOf,
    isPeriodNarrowed: isPeriodNarrowed,
    setMain: setMain,
    setChart: setChart,
    setChartMany: setChartMany,
    resetChart: resetChart,
    resetAll: resetAll,
    resetMain: resetMain,
    isMainDefault: isMainDefault,
    indexOfPeriod: indexOfPeriod,
    matchesDetail: matchesDetail,
    detailsFor: detailsFor,
    summariesFor: summariesFor,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
