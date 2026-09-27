/*
 * 結論草稿產生器（自訂條件）——交通服務水準分析系統。
 *
 * 和「成果交付 → 報告文字草稿」的分工：
 * ・那一份寫的是固定格式的交付草稿，每一筆代表紀錄各一行。
 * ・這一支是**使用者自己出題**：想只寫「115Q2 每個路段上午尖峰的旅行速率
 *   與服務水準」可以，想寫「114 年度四季的變化」也可以。
 *
 * 這個檔案只負責**組字**，不做任何解析或服務水準判定。傳進來的就是
 * state.details（畫面上「尖峰明細」那一批），數字與 LOS 都已經由 app.js
 * 算好，這裡照抄。數字只能有一個來源，草稿才不會和畫面、Excel 分岔。
 *
 * 單位規則：
 * ・旅行速率／行駛速率是 km/h，延滯是秒，兩者都是「該尖峰小時的代表值」。
 * ・跨路段、跨季度一律不加總，只寫各自的值、最大／最小、平均與變動幅度。
 * ・服務水準 A～F 是等級不是數字，永遠不做平均。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CONCLUSION_METRICS = [
    { key: "los", label: "服務水準（A～F）" },
    { key: "travel", label: "旅行速率（km/h）" },
    { key: "running", label: "行駛速率（km/h）" },
    { key: "totalDelay", label: "總延滯（秒）" },
    { key: "delayParts", label: "路段延滯與交叉口延滯（秒）" },
    { key: "limit", label: "速限與速限比" },
    { key: "directionText", label: "方向文字（報告上寫的起訖）" },
    { key: "growth", label: "季度之間的變動幅度" },
    { key: "worst", label: "範圍內服務水準最差的路段" },
    { key: "extremes", label: "範圍內旅行速率的最快／最慢" },
    { key: "losCount", label: "各服務水準等級的筆數統計" },
    /*
     * ⚠️ 這一項是**圖上算得出來、草稿以前寫不出來**的數字（使用者 2026-09-15：
     *   「希望草稿產生器能讓使用者查到任何狀況下的數值，只要是可以從圖表中
     *     獲得的數據或計算結果」）。
     *   它的口徑必須與「三段分法」那張圖**完全相同**：每一季、每個路段一筆
     *   代表紀錄，再按目前的三段分界歸成順暢／尚可／壅塞。
     *   拿逐筆明細去算會多出三倍的筆數，數字和圖對不起來——那是最難查的一種錯。
     */
    { key: "bandShare", label: "三段分法佔比（順暢／尚可／壅塞，同「三段分法」圖）" },
  ];

  var DEFAULT_METRICS = ["los", "travel", "totalDelay"];

  var DEFAULT_CONDITION = {
    scope: { kind: "project" },
    peaks: [],
    directions: [],
    days: [],
    roads: [],
    metrics: DEFAULT_METRICS.slice(),
    grouping: "byRoad",
    digits: 1,
    /*
     * 資料層級——對應主工具列「尖峰」那一格的「代表尖峰（系統取最差）」。
     *
     * "detail"（預設，＝舊行為）：逐筆明細，一個路段一季最多四筆。
     * "representative"：**先篩再挑最差**，與「尖峰彙總」「各路段 LOS 圖」
     *   同一個口徑——同一組（計畫・年・季・路段・日別）裡，
     *   從**符合條件的那幾筆**挑最差的一筆。
     *
     * ⚠️ 挑最差的規則不可以在這裡另寫一套，由呼叫端把 rebuild() 用的那一支
     *   透過 meta.worstOf 傳進來（`describeWorst` 之外全站唯一一份）。
     */
    rowLevel: "detail",
  };

  /**
   * 條件在畫面上的名字。草稿寫「不適用」時要寫使用者看得懂的字，不是欄位名。
   */
  var CONDITION_LABELS = {
    scope: "統計範圍（季度）",
    peaks: "尖峰",
    directions: "方向",
    days: "日別",
    roads: "路段",
    rowLevel: "資料層級",
  };

  /*
   * ── 哪一個數字不吃哪一個條件 ────────────────────────────────
   *
   * 使用者 2026-09-15：「針對不適用某些篩選條件的結果，在產生草稿時，
   *   可以直接說**該數值不適用 XXX 條件**」。
   *
   * ⚠️ 只列「這個數字**真的**不隨那個條件改變」的組合。
   *   多列一項＝畫面說謊（明明會變卻說不適用），少列一項＝使用者以為
   *   自己設的條件有生效。兩種都比不寫更糟。
   * ⚠️ 只有在使用者**確實設了**那個條件時才寫出來——
   *   沒設的條件寫一堆「不適用」只是噪音。
   */
  var METRIC_INAPPLICABLE = {
    limit: [
      { field: "peaks", reason: "公告速限是「這條路段這個方向」的設定值，不隨尖峰改變" },
      { field: "days", reason: "公告速限不分平日假日" },
    ],
    directionText: [
      { field: "peaks", reason: "方向文字是路段與方向的名稱，不隨尖峰改變" },
      { field: "days", reason: "方向文字不分平日假日" },
    ],
    bandShare: [
      {
        field: "rowLevel",
        reason:
          "這一項「固定以代表紀錄」（每季每路段各一筆）計算，才會與「三段分法」圖上的佔比相同；" +
          "所以選「逐筆明細」時，上方統計範圍寫的筆數與這一段的筆數本來就不一樣",
      },
    ],
  };

  var LOS_ORDER = ["A", "B", "C", "D", "E", "F"];

  /*
   * 季度在草稿上要寫成民國年還是西元年。
   *
   * 這是**純顯示**的換字：分組、排序、篩選（periodKey／periodYear／scope 比對）
   * 一律走傳進來的儲存值，換寫法不會挑到不同的資料，也不會動到任何數字。
   * 呼叫端在 meta.showPeriod 傳一個函式進來就會生效；沒傳就照原樣輸出，
   * 單元測試與舊呼叫端的行為完全不變。
   *
   * 用模組層變數而不是一路傳參數：組字的輔助函式有七、八個，全部加一個參數
   * 會讓每一個簽章都變髒。buildConclusion 是同步的，進入時設定、用完即可。
   */
  var periodText = function (value) {
    return String(value == null ? "" : value);
  };

  function periodKey(period) {
    var match = String(period || "").match(/^(\d{2,4})Q([1-4])$/);
    if (!match) return Number.NEGATIVE_INFINITY;
    var year = Number(match[1]);
    // 這支程式的季度一律是民國年（99Q4、115Q2）；四碼視為西元，換算後再比。
    var gregorian = String(match[1]).length === 4 ? year : year + 1911;
    return gregorian * 4 + Number(match[2]);
  }

  function periodYear(period) {
    var match = String(period || "").match(/^(\d{2,4})Q[1-4]$/);
    return match ? match[1] : "";
  }

  /*
   * 「有沒有數值」一律走這一支。
   * 不能只寫 isFinite(Number(v))：Number(null) 是 0、Number("") 也是 0，
   * 讀不到的欄位會被當成「確實量到 0」，接著變動幅度就會拿 0 當基期，
   * 而那句話會原封不動寫進報告。
   *
   * ══════════════════════════════════════════════════════════════════
   *  ⚠️ 2026-09-25 修正：只排掉 null／undefined／"" **不夠**
   * ══════════════════════════════════════════════════════════════════
   *
   * 第一版寫成 `value !== null && value !== undefined && value !== "" &&
   * isFinite(Number(value))`。上面那段註解講對了雷，程式只擋掉三種值。
   * 實測漏掉的（每一種 Number() 都給得出「看起來正常」的數字）：
   *
   *     " "   → Number 0      "\t"  → Number 0
   *     []    → Number 0      false → Number 0
   *     true  → Number 1
   *
   * 於是 `travel: " "` 會讓草稿寫「旅行速率 0.0 km/h」——0 km/h 的意思是
   * 完全動不了，會被讀報告的人當成最嚴重的壅塞；`changeText(" ", 25)`
   * 還會寫出「由 0 km/h 增為 25.0 km/h」，一句憑空造出來的結論。
   *
   * 正解是**先擋型別再轉數字**：只有「真的是數字」或「去掉空白之後還有東西
   * 的字串」才算有值。與 quality-extension.js 的 asNumber() 同一個判準，
   * 兩邊必須一致（跨檔守門 draft-key-and-missing.test.mjs 會盯）。
   */
  function isNum(value) {
    var usable =
      typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "");
    return usable && isFinite(Number(value));
  }

  function num(value, digits) {
    if (!isNum(value)) return "—";
    return Number(value).toLocaleString("zh-TW", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  /*
   * 百分比一律要把「小數位數」帶進來。
   *
   * 舊版寫死 toFixed(1)，於是使用者把小數位數改成 2 位時百分比完全不動
   * （三支系統都是同一個毛病）。digits 是必填參數；呼叫端漏傳時，
   * buildConclusion 會先把整份條件安全還原為 1 位，避免無聲變成 0 位。
   */
  function pct(value, digits) {
    if (!isNum(value)) return "—";
    return Number(value).toFixed(digits) + "%";
  }

  function inScope(row, scope) {
    if (!scope || scope.kind === "project") return true;
    if (scope.kind === "quarter") return row.period === scope.quarter;
    if (scope.kind === "year") return periodYear(row.period) === String(scope.year);
    if (scope.kind === "range") {
      var key = periodKey(row.period);
      // 看不懂的季度字樣一律保留，讓使用者自己看到，不要無聲濾掉。
      if (key === Number.NEGATIVE_INFINITY) return true;
      var a = periodKey(scope.from);
      var b = periodKey(scope.to);
      return key >= Math.min(a, b) && key <= Math.max(a, b);
    }
    return true;
  }

  /**
   * 「先篩再挑最差」——與尖峰彙總、各路段 LOS 圖同一個口徑。
   *
   * ⚠️ 絕對不可以拿已經挑好的代表紀錄再去篩：那一份是從**全部四筆**挑出來的，
   *   篩掉之後只會剩下「剛好代表值就是方向1」的那幾列，其餘整組消失，
   *   使用者會以為那些路段那一季沒有資料。所以一定是**先篩**（呼叫端已經做完）
   *   **再挑**（這裡）。
   * ⚠️ 挑最差的排序由 meta.worstOf 傳進來（就是 rebuild() 用的那一支）。
   *   沒傳就原樣回傳逐筆明細——舊呼叫端與單元測試行為完全不變。
   */
  function reduceToRepresentative(rows, worstOf) {
    if (typeof worstOf !== "function") return rows;
    var groups = {};
    var order = [];
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var key = [row.projectCode, row.year, row.quarter, row.road, row.day].join("|");
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push(row);
    }
    var out = [];
    for (var j = 0; j < order.length; j += 1) {
      var list = groups[order[j]];
      var best = worstOf(list);
      if (best) out.push(best);
    }
    return out;
  }

  /**
   * @param worstOf 只有 condition.rowLevel === "representative" 時才會用到。
   */
  function selectRows(details, condition, worstOf) {
    var c = condition || DEFAULT_CONDITION;
    var picked = (details || [])
      .filter(function (row) {
        if (!inScope(row, c.scope)) return false;
        if (c.peaks && c.peaks.length && c.peaks.indexOf(row.peak) < 0) return false;
        if (c.directions && c.directions.length && c.directions.indexOf(row.direction) < 0)
          return false;
        if (c.days && c.days.length && c.days.indexOf(row.day) < 0) return false;
        if (c.roads && c.roads.length && c.roads.indexOf(row.road) < 0) return false;
        return true;
      });
    if (c.rowLevel === "representative")
      picked = reduceToRepresentative(picked, worstOf);
    return picked
      .slice()
      .sort(function (a, b) {
        return (
          periodKey(a.period) - periodKey(b.period) ||
          String(a.road).localeCompare(String(b.road), "zh-TW") ||
          String(a.day).localeCompare(String(b.day), "zh-TW") ||
          String(a.peak).localeCompare(String(b.peak), "zh-TW") ||
          String(a.direction).localeCompare(String(b.direction), "zh-TW")
        );
      });
  }

  function scopeLabel(scope, rows) {
    if (!scope || scope.kind === "project") {
      var periods = uniquePeriods(rows);
      return periods.length
        ? "全計畫（" +
            periodText(periods[0]) +
            "～" +
            periodText(periods[periods.length - 1]) +
            "）"
        : "全計畫";
    }
    if (scope.kind === "quarter") return periodText(scope.quarter);
    if (scope.kind === "year") return yearText(scope.year) + " 年度";
    return periodText(scope.from) + "～" + periodText(scope.to);
  }

  /*
   * 年度是「115」這種光年份的字串，沒有 Qn，periodText 認不得。
   * 借一個季度殼子換算完再把 Qn 去掉，換不成就原樣回傳。
   */
  function yearText(year) {
    var shown = periodText(String(year) + "Q1");
    var match = String(shown).match(/^(\d{2,4})Q1$/);
    return match ? match[1] : String(year);
  }

  function uniquePeriods(rows) {
    var seen = [];
    for (var i = 0; i < rows.length; i += 1)
      if (seen.indexOf(rows[i].period) < 0) seen.push(rows[i].period);
    return seen.sort(function (a, b) {
      return periodKey(a) - periodKey(b);
    });
  }

  /*
   * 方向要寫「使用者替這個路段取的名稱」，不是鍵值。
   * app.js 在餵資料進來之前已經把名稱解析好放在 directionLabel；
   * 這支模組不碰 state，也不做解析，沒有 directionLabel（例如單元測試直接
   * 餵舊格式的列）就照原本的鍵值寫，行為不變。
   */
  function dirLabel(row) {
    return row.directionLabel || row.direction;
  }

  /*
   * 草稿抬頭的「方向：…」。
   *
   * ⚠️ 2026-09-25 修正：去重要用**鍵值**，顯示才用名稱。
   *   舊寫法拿 dirLabel() 去重，兩個方向撞名時會寫成「只有一個方向」，
   *   而實際上兩個方向都在這一批資料裡。
   *   與 sameSlot 同一個修法（判斷用鍵值、顯示用標籤）。
   */
  function uniqueDirections(rows) {
    var seenKeys = [];
    var labels = [];
    for (var i = 0; i < rows.length; i += 1) {
      var key = rows[i].direction;
      if (seenKeys.indexOf(key) >= 0) continue;
      seenKeys.push(key);
      labels.push(dirLabel(rows[i]));
    }
    return labels;
  }

  function uniqueBy(rows, field) {
    var seen = [];
    for (var i = 0; i < rows.length; i += 1)
      if (seen.indexOf(rows[i][field]) < 0) seen.push(rows[i][field]);
    return seen;
  }

  /** 一筆代表紀錄要寫出來的那一行。 */
  function describeRow(row, condition) {
    var wants = function (key) {
      return condition.metrics.indexOf(key) >= 0;
    };
    var digits = condition.digits;
    var head =
      "　　" +
      row.peak +
      "・" +
      dirLabel(row) +
      /*
       * 沒有命名時，方向的顯示名稱本來就會退回報告上的起訖文字，
       * 這時候再括號補一次，會寫成「甲路口--->乙路口（甲路口--->乙路口）」。
       * 只有兩者真的不同才補。
       */
      (wants("directionText") && row.directionText && row.directionText !== dirLabel(row)
        ? "（" + row.directionText + "）"
        : "") +
      "：";
    var parts = [];
    if (wants("los")) parts.push("服務水準 " + (row.los || "?"));
    if (wants("travel")) parts.push("旅行速率 " + num(row.travel, digits) + " km/h");
    if (wants("running")) parts.push("行駛速率 " + num(row.running, digits) + " km/h");
    if (wants("totalDelay")) parts.push("總延滯 " + num(row.totalDelay, digits) + " 秒");
    if (wants("delayParts"))
      parts.push(
        "路段延滯 " +
          num(row.roadDelay, digits) +
          " 秒、交叉口延滯 " +
          num(row.junctionDelay, digits) +
          " 秒",
      );
    if (wants("limit"))
      /*
       * ══════════════════════════════════════════════════════════════
       *  ⚠️ 速限與速限比的寫法，要能跟表格對得起來
       * ══════════════════════════════════════════════════════════════
       *
       * 2026-09-23 的反向對帳抓到兩件事：
       *
       * ① **速限的位數寫死 0**。`app.js` 的尖峰明細是
       *    `fmt(x.limit, Number.isInteger(x.limit) ? 0 : 1)`——程式本身就
       *    預期速限可能不是整數，會顯示 47.5。草稿卻把它四捨五入成 48，
       *    而速限比是拿 47.5 算的，讀的人怎麼除都對不上。
       *    改成**整數就不寫小數、非整數就寫一位**，與表格同一套。
       *
       * ② **速限比全站用比值，只有草稿用百分比**。彙總表寫 `0.782`、
       *    判定標準頁的門檻寫「A：速限比 ≧ 0.90」、趨勢圖寫 `0.78`、
       *    成果包 CSV 的欄名是「速限比（比值，0～1）」——只有這裡寫 78.2%。
       *    使用者拿草稿回去核對時，兩邊長得不一樣。
       *    改成**先寫比值、括號附百分比**：比值那一個對得上表格與門檻，
       *    百分比那一個是給不熟比值的人看的，兩邊都不必再換算。
       */
      parts.push(
        "速限 " +
          num(row.limit, Number.isInteger(Number(row.limit)) ? 0 : 1) +
          " km/h、速限比 " +
          (isNum(row.ratio)
            ? num(Number(row.ratio), 3) +
              "（" +
              pct(Number(row.ratio) * 100, digits) +
              "）"
            : "—"),
      );
    /*
     * 只勾「方向文字」時 parts 是空的。舊寫法直接回空陣列，等於這個選項
     * 點了沒反應——使用者會以為程式壞了。改成仍然寫出那一行。
     */
    if (!parts.length)
      return wants("directionText") ? [head.replace(/：$/, "。")] : [];
    return [head + parts.join("；") + "。"];
  }

  /** 同一路段、同一日別、同一尖峰、同一方向，跨季度才可以比。 */
  /**
   * 季度之間的變動。
   *
   * ══════════════════════════════════════════════════════════════════
   *  ⚠️ 分組鍵要看「資料層級」，不可以永遠帶著尖峰與方向
   * ══════════════════════════════════════════════════════════════════
   *
   * 2026-09-23 的反向對帳抓到，而且**踩在預設動線上**：
   *
   *   主工具列的尖峰預設是「代表尖峰」→ 套用到結論草稿時 `rowLevel` 會變成
   *   `"representative"` → 每一季每條路只留**最差的那一筆**。而「最差的那一筆
   *   是哪個尖峰、哪個方向」**逐季會不同**（114Q1 最差是上午·方向1、
   *   114Q2 最差是下午·方向2）。
   *
   *   舊的分組鍵帶著 `peak` 與 `direction`，於是那兩季被分進**兩個不同的群組**，
   *   每組只剩 1 筆 → `group.length < 2` → 直接 return。後果分兩種，都很糟：
   *     ・`byRoad` 分組：**一行都不印，也沒有任何說明**
   *     ・其他分組：印出「範圍內沒有任何一筆具備兩季以上的資料，未做季度比較。」
   *       ——**這句話是錯的**，範圍內就是兩季，而同一份資料在
   *       「各路段歷季旅行速率」圖上畫得出下降線，重點路段總覽也把它列為需優先檢視。
   *
   * ⚠️ 修法不是新口徑，是**比照全站另外兩個地方**：
   *   `quality-extension.js` 的 `narrative()` 與重點路段總覽都是用
   *   `road + day` 當鍵。代表紀錄本來就是「這條路這一天的代表」，
   *   再往下切尖峰與方向等於把代表紀錄當成逐筆明細用。
   *
   * ⚠️ 逐筆明細（`rowLevel === "detail"`）維持原本的四個鍵，一個字都不改——
   *   那時候同一條路同一天真的有好幾筆，不分尖峰與方向會把不同的東西比在一起。
   *
   * @param rowLevel "representative" 或 "detail"（舊的呼叫端沒傳就當 detail）
   */
  function describeGrowth(rows, digits, rowLevel) {
    var representative = rowLevel === "representative";
    var groups = {};
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var key = representative
        ? [row.road, row.day].join("|")
        : [row.road, row.day, row.peak, row.direction].join("|");
      (groups[key] = groups[key] || []).push(row);
    }
    var lines = [];
    Object.keys(groups).forEach(function (key) {
      var group = groups[key].slice().sort(function (a, b) {
        return periodKey(a.period) - periodKey(b.period);
      });
      if (group.length < 2) return;
      var first = group[0];
      var last = group[group.length - 1];
      /*
       * ⚠️ 代表紀錄時，頭尾兩季的尖峰／方向可能不同——那正是這個修正的起因。
       *   標題要**照實寫出兩季各自是哪一個**，不可以只寫第一季那一個
       *   （只寫第一季的話，讀的人會以為兩季比的是同一個尖峰同一個方向）。
       */
      /*
       * ⚠️ 2026-09-25 修正：可比性要比**鍵值**，不可以比給人看的名稱。
       *
       * 舊寫法是 `dirLabel(first) === dirLabel(last)`，而 dirLabel() 回的是
       * `row.directionLabel || row.direction`——使用者在「路段管理」自己取的
       * 顯示名稱。兩個方向被取成同一串名稱時（程式不擋撞名），
       * sameSlot 會誤判為 true，於是「（代表紀錄，兩季最差的時段／方向不同）」
       * 這句警語被整句吞掉，讀的人會以為兩季比的是同一個方向。
       *
       * 鍵值（`row.direction`）永遠是「方向1／方向2」，不會因為改名而變，
       * 那才是判斷「是不是同一個方向」的依據。顯示仍然用 dirLabel()。
       * 這與系統其他地方「判斷用鍵值、顯示用標籤」的原則一致。
       */
      var sameSlot =
        first.peak === last.peak && first.direction === last.direction;
      var slot = sameSlot
        ? first.peak + "・" + dirLabel(first)
        : first.peak +
          "・" +
          dirLabel(first) +
          " → " +
          last.peak +
          "・" +
          dirLabel(last) +
          "（代表紀錄，兩季最差的時段／方向不同）";
      var label = "　" + first.road + "（" + first.day + "）・" + slot + "：";
      var speed = changeText(first.travel, last.travel, "旅行速率", digits, "km/h");
      var delay = changeText(first.totalDelay, last.totalDelay, "總延滯", digits, "秒");
      lines.push(
        label +
          "由 " +
          periodText(first.period) +
          " 至 " +
          periodText(last.period) +
          "，" +
          speed +
          "；" +
          delay +
          "；服務水準 " +
          (first.los || "?") +
          " → " +
          (last.los || "?") +
          losShiftText(first.los, last.los) +
          "。",
      );
    });
    return lines;
  }

  /*
   * ══════════════════════════════════════════════════════════════════════
   *  「C → D」到底是變好還是變差？（使用者 2026-09-23 核准新增）
   * ══════════════════════════════════════════════════════════════════════
   *
   * 舊版只寫「服務水準 C → D」，讀報告的人要自己記得 A 最好、F 最差，
   * 才知道那是變差了。而**畫面上的歷季服務水準圖早就寫著**
   *「平日從 114Q1 的 C 到 115Q2 的 D，等級變差了。」（app.js 的 losCardScript）——
   * 表格講得出來、草稿講不出來，正是這一輪要補的那一類。
   *
   * ⚠️ 好壞方向一律由 LOS_ORDER 決定，**不另外寫一份順序**。
   *   app.js 那邊用的是 losRank（A=6…F=1，數字越大越好），
   *   這裡用的是 LOS_ORDER 的索引（A=0…F=5，索引越小越好）。
   *   兩者方向相反，很容易寫反——所以下面刻意用「索引變大＝變差」
   *   一句話講死，並且有一支測試把 A→F 與 F→A 兩個方向都釘住。
   *
   * ⚠️ 任一季讀不出等級時回空字串，不寫「無法判斷」之類的話——
   *   前面已經印了「? → D」，再補一句只是噪音。
   */
  function losShiftText(before, after) {
    var from = LOS_ORDER.indexOf(before);
    var to = LOS_ORDER.indexOf(after);
    if (from < 0 || to < 0) return "";
    if (from === to) return "（等級沒有變化）";
    /* 索引變大＝往 F 走＝變差。 */
    return (
      "（等級" + (to > from ? "變差 " : "變好 ") + Math.abs(to - from) + " 級）"
    );
  }

  /*
   * 變動幅度的寫法。
   *
   * 基期為 0 時絕對不能寫成「增加 0.0%」或無限大——那句話會原封不動進報告。
   * 直接把實際數值寫出來，讓看的人自己判斷。
   */
  function changeText(before, after, label, digits, unit) {
    if (!isNum(before) || !isNum(after)) return label + "無法比較（資料含非數值）";
    if (!Number(before))
      return Number(after) > 0
        ? label + "由 0 " + unit + " 增為 " + num(after, digits) + " " + unit
        : label + "維持 0 " + unit;
    var change = ((Number(after) - Number(before)) / Number(before)) * 100;
    return (
      label +
      "由 " +
      num(before, digits) +
      " 變為 " +
      num(after, digits) +
      " " +
      unit +
      "，" +
      (change >= 0 ? "增加" : "下降") +
      " " +
      pct(Math.abs(change), digits)
    );
  }

  function describeWorst(rows) {
    var ranked = rows
      .filter(function (row) {
        return LOS_ORDER.indexOf(row.los) >= 0;
      })
      .slice()
      .sort(function (a, b) {
        return (
          LOS_ORDER.indexOf(b.los) - LOS_ORDER.indexOf(a.los) ||
          (isNum(a.ratio) ? Number(a.ratio) : 1) - (isNum(b.ratio) ? Number(b.ratio) : 1)
        );
      });
    if (!ranked.length) return ["　範圍內沒有可判定服務水準的紀錄。"];
    var worst = ranked[0];
    var same = ranked.filter(function (row) {
      return row.los === worst.los;
    });
    return [
      "　服務水準最差為 " +
        worst.los +
        "：" +
        same
          .slice(0, 5)
          .map(function (row) {
            return periodText(row.period) + " " + row.road + "（" + row.day + "・" + row.peak + "・" + dirLabel(row) + "）";
          })
          .join("、") +
        (same.length > 5 ? " 等 " + same.length + " 筆" : "") +
        "。",
    ];
  }

  /**
   * ══════════════════════════════════════════════════════════════════
   *  ⚠️ 2026-09-16 起**不再寫「N 筆平均」**（使用者裁示）
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者原話：
   *   「每一行展示一筆季別+日別的結果，例如 A路段 在114Q1 平日結果XXX
   *     假日結果YYY，而不是要你平均起來，除非評估過後 某個數值是以平均
   *     來呈現最佳。」
   *
   * 那個平均本來就不該寫：它把**不同路段、不同季別、不同日別、不同尖峰、
   * 不同方向**的旅行速率混成一個數字。路段長度與速限都不同，
   * 平均出來的值不對應任何一條路在任何一個時段的實際速率——
   * 這一點原本的括號裡自己就寫著「各路段長度與速限不同」，
   * 既然如此就更不該取平均。
   *
   * ⚠️ 最快／最慢**保留**——那是在比大小，不是把數字混在一起。
   * ⚠️ 筆數太多時**不給任何平均或合計**，只說明還有幾筆。
   */
  var EXTREME_LINE_LIMIT = 12;
  function describeExtremes(rows, digits) {
    var points = rows.filter(function (row) {
      return isNum(row.travel);
    });
    if (points.length < 2) return ["　可比較的紀錄不足兩筆，未做快慢比較。"];
    var sorted = points.slice().sort(function (a, b) {
      return Number(b.travel) - Number(a.travel);
    });
    var name = function (row) {
      return periodText(row.period) + " " + row.road + "（" + row.day + "・" + row.peak + "・" + dirLabel(row) + "）";
    };
    var lines = [
      "　旅行速率最快為 " +
        name(sorted[0]) +
        " " +
        num(sorted[0].travel, digits) +
        " km/h，最慢為 " +
        name(sorted[sorted.length - 1]) +
        " " +
        num(sorted[sorted.length - 1].travel, digits) +
        " km/h。（各路段長度與速限不同，此處僅比較大小，不取平均。）",
    ];
    if (sorted.length <= EXTREME_LINE_LIMIT)
      for (var i = 0; i < sorted.length; i += 1)
        lines.push(
          "　　・" + name(sorted[i]) + "：" + num(sorted[i].travel, digits) + " km/h",
        );
    else
      lines.push(
        "　　（共 " +
          sorted.length +
          " 筆，逐筆列出過長，此處不列；各路段長度與速限不同，不取平均，" +
          "要看個別數值請縮小路段或季度範圍後重新產生。）",
      );
    return lines;
  }

  /*
   * ⚠️ 分母必須與「三段分法」那一段相同＝**判定得出等級的筆數**。
   *
   * 稽核表 L：舊版這裡用 `rows.length`（全部筆數）當分母，而同一份草稿下方的
   * 「三段分法佔比」用的是可判定筆數。兩組百分比**並排印在同一份草稿裡**，
   * 讀的人無從分辨哪一個是哪一種分母——只要有一筆讀不到等級，
   * 上面那組加起來不到 100%、下面那組剛好 100%，看起來像其中一組算錯了，
   * 實際上兩個都「對」，只是口徑不同。抄進報告之後沒有人查得出來。
   *
   * 統一成可判定筆數，並且**把口徑寫在句子裡**（不能只改數字不改字）：
   * 不寫的話，同一句話在修正前後印出不同的百分比，卻長得一模一樣。
   */
  function describeLosCount(rows, digits) {
    var counts = {};
    var unknown = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var los = rows[i].los;
      if (LOS_ORDER.indexOf(los) < 0) unknown += 1;
      else counts[los] = (counts[los] || 0) + 1;
    }
    var graded = rows.length - unknown;
    var parts = LOS_ORDER.filter(function (los) {
      return counts[los];
    }).map(function (los) {
      return (
        los +
        " 級 " +
        counts[los] +
        " 筆（" +
        (graded ? pct((counts[los] / graded) * 100, digits) : "—") +
        "）"
      );
    });
    if (unknown) parts.push("無法判定 " + unknown + " 筆（不計入分母）");
    return parts.length
      ? [
          "　共 " +
            rows.length +
            " 筆（可判定 " +
            graded +
            " 筆，佔比的分母是可判定筆數，與下方「三段分法」相同）：" +
            parts.join("、") +
            "。",
        ]
      : ["　範圍內沒有可統計的服務水準。"];
  }

  /** 一個等級落在三段的哪一段。認不得的等級回 null，**不可以**當成壅塞。 */
  function bandOfGrade(los, bands) {
    var index = LOS_ORDER.indexOf(String(los));
    if (index < 0) return null;
    var smooth = LOS_ORDER.indexOf(String((bands || {}).smoothEnd));
    var congested = LOS_ORDER.indexOf(String((bands || {}).congestedStart));
    /*
     * ⚠️ 分界讀不到時回 null，**不可以**讓判斷式自己滑過去。
     *   舊寫法直接用 indexOf 的結果比大小：分界是 undefined 時 indexOf 回 -1，
     *   於是 `index >= -1` 恆真——**每一筆都會被歸成壅塞**，
     *   而草稿上會寫出一個看起來很合理的 100%。
     */
    if (smooth < 0 || congested < 0 || smooth >= congested) return null;
    if (index <= smooth) return "smooth";
    if (index >= congested) return "congested";
    return "fair";
  }

  /**
   * 三段分法的佔比——**與「三段分法」那張圖同一個口徑**。
   *
   * 口徑（不可以自己另定一套，否則草稿與圖上的百分比會不一樣）：
   *   ・每一季、每個路段各一筆**代表紀錄**（先篩再挑最差），不是逐筆明細。
   *   ・分界走 meta.bandsOf(row)，所以「依季別區間／路段覆寫的分界」也會生效。
   *
   * @param rows 已經篩過的列（逐筆或代表紀錄都可以，這裡一律再歸一次）
   */
  function describeBandShare(rows, digits, meta) {
    if (typeof meta.bandsOf !== "function")
      return ["　讀不到三段分界設定，這一項沒有寫出來（請回報這個情形）。"];
    var reps = reduceToRepresentative(rows, meta.worstOf);
    if (!reps.length) return ["　範圍內沒有可統計的代表紀錄。"];
    /*
     * ⚠️ **一個日別一張圖**——這是「三段分法」那一塊自己的口徑
     *  （app.js 的 renderBandPanel 依 row.day 分成好幾組 series）。
     *   把平日與假日混在一起算，草稿上的百分比就和兩張圖上的都不一樣，
     *   而三個數字加起來還是 100%，看起來完全正常。
     */
    var days = [];
    var byDay = {};
    for (var i = 0; i < reps.length; i += 1) {
      var row = reps[i];
      var day = row.day || "";
      if (!byDay[day]) {
        byDay[day] = [];
        days.push(day);
      }
      byDay[day].push(row);
    }
    days.sort(function (a, b) {
      return String(a).localeCompare(String(b), "zh-TW");
    });
    var names = { smooth: "順暢", fair: "尚可", congested: "壅塞" };
    var signatures = {};
    var lines = [];
    var indent = days.length > 1 ? "　　" : "　";
    days.forEach(function (day) {
      if (days.length > 1) lines.push("　〔" + (day || "未標示日別") + "〕");
      var group = byDay[day];
      var periods = [];
      var byPeriod = {};
      group.forEach(function (row) {
        if (!byPeriod[row.period]) {
          byPeriod[row.period] = [];
          periods.push(row.period);
        }
        byPeriod[row.period].push(row);
        var bands = meta.bandsOf(row);
        if (bands && bands.smoothEnd && bands.congestedStart)
          signatures["順暢 A～" + bands.smoothEnd + "、壅塞 " + bands.congestedStart + "～F"] = true;
      });
      periods.sort(function (a, b) {
        return periodKey(a) - periodKey(b);
      });
      periods.forEach(function (period) {
        var list = byPeriod[period];
        var counts = { smooth: 0, fair: 0, congested: 0 };
        var unknown = 0;
        list.forEach(function (row) {
          var band = bandOfGrade(row.los, meta.bandsOf(row));
          if (band) counts[band] += 1;
          else unknown += 1;
        });
        /*
         * ⚠️ 佔比的分母是**判定得出等級的筆數**，不是全部筆數——
         *   這一條與 trend.js 的 buildBandSeries 完全相同，不可以各算各的。
         *   用全部筆數當分母的話，只要有一筆讀不到等級，草稿上的三個百分比
         *   加起來就不到 100%，而圖上是 100%。
         */
        var graded = counts.smooth + counts.fair + counts.congested;
        var parts = ["smooth", "fair", "congested"].map(function (key) {
          return (
            names[key] +
            " " +
            counts[key] +
            " 筆（" +
            (graded ? pct((counts[key] / graded) * 100, digits) : "—") +
            "）"
          );
        });
        if (unknown) parts.push("無法判定 " + unknown + " 筆（不計入分母）");
        lines.push(
          indent +
            periodText(period) +
            "（可判定 " +
            graded +
            " 筆代表紀錄）：" +
            parts.join("、") +
            "。",
        );
      });
    });
    var keys = Object.keys(signatures);
    lines.push(
      "　（口徑：一個日別一組，每一季、每個路段各一筆代表紀錄，分母是判定得出等級的筆數，" +
        "與「三段分法」圖完全相同；壅塞那一欄就是歷季趨勢圖那個壅塞佔比指標（分界只有一組時，那個指標就叫「X 級以下路段佔比」，X 就是上面寫的壅塞起始等級；不只一組時兩邊都逐筆各自套用，指標名稱不指名等級）。目前的分界：" +
        (keys.length === 1
          ? keys[0]
          : keys.length > 1
            ? keys.length + " 組（有依季別區間或路段覆寫），逐筆各自套用"
            : "讀不到（請回報這個情形）") +
        "。）",
    );
    return lines;
  }

  /**
   * 「這個數字不吃你設的那個條件」——逐項寫出來。
   *
   * ⚠️ 只寫使用者**確實設了**的條件；沒設的不寫，否則整段都是噪音。
   */
  function describeInapplicable(c) {
    var setFields = {};
    if (c.scope && c.scope.kind && c.scope.kind !== "project") setFields.scope = true;
    if (c.peaks && c.peaks.length) setFields.peaks = true;
    if (c.directions && c.directions.length) setFields.directions = true;
    if (c.days && c.days.length) setFields.days = true;
    if (c.roads && c.roads.length) setFields.roads = true;
    /*
     * ⚠️ 2026-09-23 修正：`rowLevel` 的判斷**方向是反的**。
     *
     *   舊寫法是「使用者改過預設值才算有設」（預設是 `"detail"`），於是：
     *     ・選「代表紀錄」→ 印出「本數值不適用『資料層級』條件」，
     *       但三段分法本來就用代表紀錄，兩者**一致**，這句話是多餘的；
     *     ・選「逐筆明細」→ **什麼都不印**，而三段分法會強制再歸一次代表紀錄
     *       （見 describeBandShare），使用者的選擇**真的沒作用**——
     *       這才是該講的那一種，卻剛好不講。
     *
     *   症狀：草稿開頭寫「資料層級：逐筆明細……共 8 筆」，
     *   三段分法那一段卻寫「可判定 1 筆代表紀錄」，兩個筆數並排在同一份草稿裡，
     *   而唯一會解釋這件事的那句提示剛好不出現。
     *
     *   `rowLevel` 與別的條件不同：它**永遠有值**（不是「沒設就是全部」），
     *   所以只要那個指標宣告不吃它，就一律要寫出來。
     */
    if (c.rowLevel) setFields.rowLevel = true;
    var lines = [];
    for (var i = 0; i < CONCLUSION_METRICS.length; i += 1) {
      var metric = CONCLUSION_METRICS[i];
      if (c.metrics.indexOf(metric.key) < 0) continue;
      var rules = METRIC_INAPPLICABLE[metric.key] || [];
      var hits = rules.filter(function (rule) {
        return setFields[rule.field];
      });
      if (!hits.length) continue;
      lines.push(
        "　・" +
          metric.label +
          "：本數值不適用「" +
          hits
            .map(function (rule) {
              return CONDITION_LABELS[rule.field];
            })
            .join("」「") +
          "」條件——" +
          hits
            .map(function (rule) {
              return rule.reason;
            })
            .join("；") +
          "。",
      );
    }
    return lines;
  }

  function buildConclusion(details, condition, meta) {
    var c = Object.assign({}, DEFAULT_CONDITION, condition || {});
    /*
     * 舊範本可能沒有 digits；匯入內容也可能超出畫面允許的 0～2。
     *
     * ⚠️ 本版：**先擋型別再轉數字**，順序不可以反。
     *   舊寫法只擋 null 與 ""，而 Number() 對好幾種不是數字的東西
     *   都給得出落在 0～2 裡面的整數：
     *
     *       Number([])   === 0    ← 空陣列會變成 0 位（實測踩到）
     *       Number(" ")  === 0    ← 空白字串同上
     *       Number(true) === 1
     *
     *   於是存著 `digits: []` 的舊範本會讓百分比與速率**安靜地變成 0 位**，
     *   使用者設定的 1 位被吃掉，畫面上沒有任何提示。
     *   姊妹系統全日交通量的 safeConclusionDigits() 早就有這個型別守衛，
     *   本支漏了——判準現在三支一致，不要再改回只判 null 與 ""。
     */
    var acceptable =
      typeof c.digits === "number" ||
      (typeof c.digits === "string" && c.digits.trim() !== "");
    var parsedDigits = Number(c.digits);
    c.digits =
      acceptable &&
      Number.isInteger(parsedDigits) &&
      parsedDigits >= 0 &&
      parsedDigits <= 2
        ? parsedDigits
        : DEFAULT_CONDITION.digits;
    var m = meta || {};
    periodText =
      typeof m.showPeriod === "function"
        ? m.showPeriod
        : function (value) {
            return String(value == null ? "" : value);
          };
    /* 舊範本沒有 rowLevel；認不得的值一律回到預設，不讓草稿悄悄換口徑。 */
    if (c.rowLevel !== "representative") c.rowLevel = "detail";
    var rows = selectRows(details, c, m.worstOf);
    var out = [];
    out.push("【結論草稿】" + scopeLabel(c.scope, rows));
    out.push(
      "計畫：" +
        (m.projectName || "未命名計畫") +
        "｜產生時間：" +
        (m.generatedAt || "") +
        "｜系統版本：" +
        (m.systemVersion || ""),
    );

    if (!rows.length) {
      out.push("");
      out.push("所選條件沒有對應的資料。請放寬季度範圍、改選其他路段、日別、尖峰或方向後再產生一次。");
      return out.join("\n");
    }

    var periods = uniquePeriods(rows);
    out.push("");
    out.push(
      "統計範圍：" +
        periods.length +
        " 個季度（" +
        periods.map(periodText).join("、") +
        "）、" +
        uniqueBy(rows, "road").length +
        " 個路段、共 " +
        rows.length +
        " 筆尖峰方向紀錄；日別：" +
        uniqueBy(rows, "day").join("、") +
        "；尖峰：" +
        uniqueBy(rows, "peak").join("、") +
        "；方向：" +
        uniqueDirections(rows).join("、") +
        "。",
    );
    out.push(
      "說明：旅行速率與行駛速率為 km/h、延滯為秒，皆為該尖峰小時的代表值；" +
        "不同路段的長度與速限不同，跨路段、跨季度只做比較，不做加總。" +
        "服務水準 A～F 是等級不是數值，不做平均。",
    );
    /*
     * ⚠️ 「資料層級」一定要寫在草稿裡。
     *   逐筆明細與代表紀錄算出來的筆數、佔比、最快最慢**都不一樣**，
     *   而文字上看不出差別——不寫的話，兩份用不同層級產生的草稿
     *   會被當成同一件事互相對帳，然後怎麼對都對不起來。
     */
    out.push(
      "資料層級：" +
        (c.rowLevel === "representative"
          ? "代表紀錄——同一組（季度・路段・日別）裡，從符合上列條件的那幾筆挑最差的一筆，" +
            "與「尖峰彙總」「各路段 LOS 圖」同一個口徑。"
          : "逐筆明細——每一個尖峰、每一個方向各寫一筆，與「尖峰明細」同一個口徑。") ,
    );
    var notes = describeInapplicable(c);
    if (notes.length) {
      out.push("");
      out.push("條件適用情形：");
      Array.prototype.push.apply(out, notes);
    }

    var wants = function (key) {
      return c.metrics.indexOf(key) >= 0;
    };
    var section = 0;
    var heading = function (text) {
      section += 1;
      out.push("");
      out.push(section + ". " + text);
    };

    if (c.grouping === "byRoad") {
      var byRoad = {};
      var roadOrder = [];
      rows.forEach(function (row) {
        if (!byRoad[row.road]) {
          byRoad[row.road] = [];
          roadOrder.push(row.road);
        }
        byRoad[row.road].push(row);
      });
      roadOrder.forEach(function (road) {
        var group = byRoad[road];
        heading(road);
        var lastKey = "";
        group.forEach(function (row) {
          var key = row.period + "|" + row.day;
          if (key !== lastKey) {
            out.push("　〔" + periodText(row.period) + "・" + row.day + "〕");
            lastKey = key;
          }
          Array.prototype.push.apply(out, describeRow(row, c));
        });
        if (wants("growth"))
          Array.prototype.push.apply(
            out,
            describeGrowth(group, c.digits, c.rowLevel),
          );
      });
    } else if (c.grouping === "byPeriod") {
      periods.forEach(function (period) {
        var group = rows.filter(function (row) {
          return row.period === period;
        });
        heading(periodText(period) + "（共 " + group.length + " 筆）");
        var lastKey = "";
        group.forEach(function (row) {
          var key = row.road + "|" + row.day;
          if (key !== lastKey) {
            out.push("　〔" + row.road + "・" + row.day + "〕");
            lastKey = key;
          }
          Array.prototype.push.apply(out, describeRow(row, c));
        });
        if (wants("worst")) Array.prototype.push.apply(out, describeWorst(group));
      });
    } else {
      heading("整體結果");
      /*
       * 這裡原本是 if(losCount) ... else { 代表紀錄 + describeRow }，
       * 也就是「勾了等級統計」就把代表紀錄整段吃掉。
       * 而 describeRow 是 los / travel / running / totalDelay / delayParts /
       * limit / directionText 這七個指標**唯一**的輸出路徑，結果變成
       * 「多勾一個選項反而少寫六行」——那七個全都成了死選項。
       * 兩者互不衝突，應該各寫各的。
       */
      if (wants("losCount")) Array.prototype.push.apply(out, describeLosCount(rows, c.digits));
      var first = rows[0];
      var rowLines = describeRow(first, c);
      if (rowLines.length) {
        out.push(
          "　代表紀錄：" + periodText(first.period) + "　" + first.road + "（" + first.day + "）",
        );
        Array.prototype.push.apply(out, rowLines);
        if (rows.length > 1)
          out.push(
            "　（範圍內共 " +
              rows.length +
              " 筆；逐筆數值不能跨路段相加，僅以上列這一筆為代表。要逐筆寫出請改選「依路段分段」或「依季度分段」。）",
          );
      }
    }

    if (wants("losCount") && c.grouping !== "overall") {
      heading("服務水準等級統計");
      Array.prototype.push.apply(out, describeLosCount(rows, c.digits));
    }
    if (wants("worst") && c.grouping !== "byPeriod") {
      heading("服務水準最差的路段");
      Array.prototype.push.apply(out, describeWorst(rows));
    }
    if (wants("extremes")) {
      heading("旅行速率的最快與最慢");
      Array.prototype.push.apply(out, describeExtremes(rows, c.digits));
    }
    if (wants("bandShare")) {
      heading("三段分法佔比（順暢／尚可／壅塞）");
      Array.prototype.push.apply(out, describeBandShare(rows, c.digits, m));
    }
    if (wants("growth") && c.grouping !== "byRoad") {
      heading("季度之間的變動");
      var lines = describeGrowth(rows, c.digits, c.rowLevel);
      if (lines.length) Array.prototype.push.apply(out, lines);
      else out.push("　範圍內沒有任何一筆具備兩季以上的資料，未做季度比較。");
    }

    var missing = rows.filter(function (row) {
      return !isNum(row.travel) || !isNum(row.totalDelay);
    }).length;
    if (missing) {
      out.push("");
      out.push(
        "註：" +
          missing +
          " 筆紀錄的旅行速率或總延滯讀不到數值（以「—」表示），該筆不列入比較與變動幅度；" +
          "請回到「尖峰明細」核對原始檔。",
      );
    }
    out.push("");
    out.push("本段文字由系統依現有資料自動產生，正式引用前應核對原始檔、速限設定及現地情況。");
    return out.join("\n");
  }

  return {
    SPEED_CONCLUSION_METRICS: CONCLUSION_METRICS,
    SPEED_DEFAULT_CONDITION: DEFAULT_CONDITION,
    buildSpeedConclusion: buildConclusion,
    selectSpeedConclusionRows: selectRows,
    speedPeriodKey: periodKey,
    speedPeriodYear: periodYear,
  };
});
