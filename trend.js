/*
 * 歷季趨勢圖的「資料」與「說明文字」——交通服務水準分析系統。
 *
 * ── 這個檔案存在的唯一理由 ──────────────────────────────────
 *
 * 圖上畫的數字、旁邊說明欄位裡寫的數字、匯出 Excel 裡的數字，
 * **必須是同一次計算的結果**。
 *
 * 如果說明文字自己再算一遍，遲早會出現「圖上畫 41%、旁邊寫 38%」這種狀況——
 * 而那是最難發現的一種錯，因為兩個數字看起來都很合理，沒有人會去懷疑。
 * 這個系統裡已經有過同類的教訓（尖峰挑選規則一度在畫面與匯出各寫一份，
 * 後來合併成同一支函式）。所以這裡從一開始就只給一個入口：
 *
 *     buildTrendSeries()  →  { points, ... }      ← 圖、說明、Excel 都吃這一份
 *     describeTrendChart()→  { title, script, ... }  ← 說明文字只讀上面那一份
 *
 * describeTrendChart() **不碰原始資料**，它只讀 buildTrendSeries() 的輸出。
 * 這一點請不要改成「為了方便」直接把 details 傳進去算。
 *
 * ── 說明欄位要寫成什麼樣子 ──────────────────────────────────
 *
 * 使用者的原話：預設場景是「把這張圖放進簡報，聽眾會想知道這張圖代表什麼」，
 * 所以文字要寫成**可以照著念、也可以直接貼到投影片下面**的講稿，
 * 不是給工程師看的技術註解。
 *
 * 因此固定四段：
 *   一、這張圖在看什麼（範圍與定義，含分界值——不要讓人問「你憑什麼這樣分」）
 *   二、看到了什麼（走勢、幅度、最大變化落在哪一季）
 *   三、代表什麼意思（把數字翻成白話）
 *   四、判讀時要注意（缺資料、樣本少、尖峰時段不同季不一樣…）
 *
 * 第四段是最有價值的一段：系統本來就知道哪一季缺資料、哪個計畫只有 3 條路段，
 * 只是以前沒講出來。主動講出來，比被業主當場問到才解釋好。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var GRADES = ["A", "B", "C", "D", "E", "F"];

  function isNum(value) {
    return value != null && value !== "" && Number.isFinite(Number(value));
  }

  /** 只給說明文字用的四捨五入；圖上的值一律用原始數字。 */
  function round(value, digits) {
    if (!isNum(value)) return null;
    var factor = Math.pow(10, digits);
    return Math.round(Number(value) * factor) / factor;
  }

  /**
   * 可以畫的指標。
   *
   * congestedShare 的名字是動態的——它跟著三段分界走（分界設 E 就叫
   * 「E 級以下路段佔比」）。**不可以寫死成「D 級以下」**：那樣一頁上會出現
   * 兩條不一樣的紅線，圖例說壅塞是 E 開始、指標卻算 D 開始。
   */
  var TREND_METRICS = [
    {
      key: "congestedShare",
      unit: "%",
      digits: 1,
      dynamicLabel: true,
      meaning: "壅塞路段佔全部路段的比例。這個數字越高，代表整體服務水準越差。",
    },
    {
      key: "worstLos",
      label: "最差服務水準等級",
      unit: "級",
      digits: 0,
      ordinal: true,
      meaning:
        "該季所有路段裡最差的那一個等級。這是警示用的指標——只要有一條路變差，整條線就會往上跳。",
    },
    {
      key: "travel",
      label: "平均旅行速率",
      unit: "km/h",
      digits: 1,
      lowerIsWorse: true,
      meaning: "所有路段代表紀錄的旅行速率平均。數字越低代表車走得越慢。",
    },
    {
      key: "running",
      label: "平均行駛速率",
      unit: "km/h",
      digits: 1,
      lowerIsWorse: true,
      meaning: "扣掉停等時間之後的速率平均。與旅行速率的差距反映停等損失。",
    },
    {
      key: "totalDelay",
      label: "平均總延滯",
      unit: "秒",
      digits: 1,
      meaning: "每一趟平均多花的時間。數字越高代表越常停等。",
    },
    {
      key: "ratio",
      label: "平均速限比",
      unit: "",
      digits: 2,
      lowerIsWorse: true,
      meaning: "實際速率相對於公告速限的比值，也是服務水準判定的依據。",
    },
  ];

  function metricByKey(key) {
    for (var i = 0; i < TREND_METRICS.length; i += 1)
      if (TREND_METRICS[i].key === key) return TREND_METRICS[i];
    return null;
  }

  /** 指標在畫面上的名稱；會跟著三段分界變的那一個在這裡組出來。 */
  function metricLabel(key, options) {
    var metric = metricByKey(key);
    if (!metric) return key;
    if (!metric.dynamicLabel) return metric.label;
    var start = (options && options.congestedStart) || "E";
    var population = (options && options.populationLabel) || "路段";
    return start + " 級以下" + population + "佔比";
  }

  /** 補齊頭尾之間真正缺少的季度，避免折線直接跨過未調查季。 */
  function completeQuarterRange(periods) {
    if (!periods.length) return periods;
    var parsed = periods.map(function (period) {
      var match = /^(\d{2,4})Q([1-4])$/.exec(String(period));
      return match ? Number(match[1]) * 4 + Number(match[2]) - 1 : null;
    });
    if (parsed.some(function (value) { return value == null; })) return periods;
    var from = Math.min.apply(null, parsed);
    var to = Math.max.apply(null, parsed);
    if (to - from > 400) return periods;
    var out = [];
    for (var index = from; index <= to; index += 1)
      out.push(Math.floor(index / 4) + "Q" + ((index % 4) + 1));
    return out;
  }

  /**
   * 把一批彙總紀錄整理成一條趨勢線。
   *
   * rows：state.summaries 那種形狀（一路段一日別一季一筆代表紀錄）。
   * 只做加總與平均，**不重新判定服務水準**——LOS 一律照抄 row.los，
   * 那是 app.js 依速限比與各計畫門檻算好的，這裡再算一次就會有第二個來源。
   */
  function buildTrendSeries(rows, options) {
    var opts = options || {};
    var metricKey = opts.metric || "congestedShare";
    var metric = metricByKey(metricKey) || TREND_METRICS[0];
    var congestedStart = opts.congestedStart || "E";
    var congestedIndex = GRADES.indexOf(congestedStart);
    var periods = [];
    var byPeriod = {};

    (rows || []).forEach(function (row) {
      var period = row.period;
      if (!period) return;
      if (!byPeriod[period]) {
        byPeriod[period] = { period: period, rows: [] };
        periods.push(period);
      }
      byPeriod[period].rows.push(row);
    });

    periods.sort(function (a, b) {
      return typeof opts.comparePeriod === "function"
        ? opts.comparePeriod(a, b)
        : String(a).localeCompare(String(b));
    });
    if (opts.completePeriods !== false) {
      periods = completeQuarterRange(periods);
      periods.forEach(function (period) {
        if (!byPeriod[period]) byPeriod[period] = { period: period, rows: [] };
      });
    }

    var points = periods.map(function (period) {
      var own = byPeriod[period].rows;
      var counts = {};
      GRADES.forEach(function (grade) {
        counts[grade] = 0;
      });
      var unknown = 0;
      own.forEach(function (row) {
        if (GRADES.indexOf(row.los) >= 0) counts[row.los] += 1;
        else unknown += 1;
      });
      var graded = own.length - unknown;
      var congestedRows = own.filter(function (row) {
        var index = GRADES.indexOf(row.los);
        return index >= 0 && index >= congestedIndex;
      });
      /*
       * 佔比的分母是**判定得出等級的筆數**，不是全部筆數。
       * 用全部筆數當分母的話，讀不到速率的那幾筆會被當成「不壅塞」，
       * 佔比被稀釋——那是把缺值默默算成好消息。
       */
      var share = graded ? (congestedRows.length / graded) * 100 : null;

      var worstIndex = -1;
      own.forEach(function (row) {
        var index = GRADES.indexOf(row.los);
        if (index > worstIndex) worstIndex = index;
      });
      var worstRows = own.filter(function (row) {
        return GRADES.indexOf(row.los) === worstIndex;
      });

      function mean(field) {
        var values = own
          .map(function (row) {
            return row[field];
          })
          .filter(isNum)
          .map(Number);
        if (!values.length) return null;
        return (
          values.reduce(function (sum, value) {
            return sum + value;
          }, 0) / values.length
        );
      }

      var valueRows =
        metricKey === "congestedShare" || metricKey === "worstLos"
          ? own.filter(function (row) { return GRADES.indexOf(row.los) >= 0; })
          : own.filter(function (row) { return isNum(row[metricKey]); });

      var value =
        metricKey === "congestedShare"
          ? share
          : metricKey === "worstLos"
            ? worstIndex >= 0
              ? worstIndex
              : null
            : mean(metricKey);

      return {
        period: period,
        value: value,
        /* 下鑽用：這個點是哪幾筆湊出來的。點一下就是把這些丟給明細表。 */
        rows:
          metricKey === "worstLos"
            ? worstRows
            : metricKey === "congestedShare"
              ? congestedRows
              : valueRows,
        sampleSize: own.length,
        valueSize: valueRows.length,
        missingValueSize: own.length - valueRows.length,
        gradedSize: graded,
        unknownSize: unknown,
        counts: counts,
        congestedCount: congestedRows.length,
        worstLos: worstIndex >= 0 ? GRADES[worstIndex] : null,
        worstCount: worstIndex >= 0 ? worstRows.length : 0,
        roads: [
          ...new Set(
            own.map(function (row) {
              return row.road;
            }),
          ),
        ],
      };
    });

    return {
      metric: metricKey,
      unit: metric.unit,
      digits: metric.digits,
      ordinal: Boolean(metric.ordinal),
      congestedStart: congestedStart,
      populationLabel: opts.populationLabel || "路段",
      sampleLabel: opts.sampleLabel || "條",
      label: metricLabel(metricKey, {
        congestedStart: congestedStart,
        populationLabel: opts.populationLabel || "路段",
      }),
      points: points,
    };
  }

  /** 把序數（0..5）換回等級字母，只有 worstLos 這個指標用得到。 */
  function ordinalToGrade(value) {
    return GRADES[Math.round(Number(value))] || "?";
  }

  function formatValue(value, series) {
    if (value == null) return "—";
    if (series.ordinal) return ordinalToGrade(value) + " 級";
    var text = round(value, series.digits);
    if (text == null) return "—";
    /* 「34km/h」讀起來會黏在一起；% 與無單位則不加空白。 */
    var unit = series.unit || "";
    return String(text) + (unit && unit !== "%" ? " " + unit : unit);
  }

  /**
   * 兩個值的差。
   *
   * ── 為什麼百分比的差可以寫，但一定要接在頭尾兩個值後面 ──────
   *
   * 「增加 28.6%」單獨出現時有兩種讀法（42.9-14.3＝28.6，
   * 或 14.3×1.286＝18.4），是報告審查會被抓的寫法。
   *
   * 但使用者指出：如果前面已經先講了「從 14.3% 到 42.9%」，
   * 讀的人自己就看得出 28.6 是怎麼來的，歧義就消失了。這一點對。
   *
   * 所以規則是——**差值只在「頭尾兩個值之後」出現，不單獨使用**。
   * 而且百分比再補一句倍數，讓使用者自己挑要講哪一種：
   *
   *   從 113Q3 的 14.3%，到 114Q2 的 42.9%，整體上升（變差）28.6%，
   *   大約是原來的 3 倍。
   *
   * 呈現最完整的結果，怎麼講交給使用者決定。
   */
  function formatDelta(delta, series) {
    if (delta == null) return "—";
    var text = round(Math.abs(delta), series.digits);
    if (text == null) return "—";
    var unit = series.unit || "";
    return String(text) + (unit && unit !== "%" ? " " + unit : unit);
  }

  /** 「大約是原來的 N 倍」；原值太小或為 0 時不寫（會變成無限大）。 */
  function timesText(from, to) {
    if (!isNum(from) || !isNum(to)) return "";
    var a = Number(from);
    var b = Number(to);
    if (a <= 0 || b <= 0) return "";
    var ratio = b / a;
    if (ratio >= 1.15) return "大約是原來的 " + round(ratio, 1) + " 倍";
    if (ratio <= 0.87) return "大約只剩原來的 " + round(ratio * 100, 0) + " %";
    return "";
  }

  /**
   * 產生說明欄位的文字。
   *
   * ⚠️ 只讀 series（buildTrendSeries 的輸出），**不碰原始資料**。
   *    這是刻意的：文字與圖只要有一邊自己算，兩邊就會分岔。
   */
  function describeTrendChart(series, meta) {
    var info = meta || {};
    var metric = metricByKey(series.metric) || TREND_METRICS[0];
    var points = (series.points || []).filter(function (point) {
      return point.value != null;
    });
    var scopeText = info.scopeText || "全部路段";
    var showPeriod =
      typeof info.showPeriod === "function"
        ? info.showPeriod
        : function (value) {
            return String(value);
          };

    /*
     * ⚠️ levels ＝ 圖說的第 3 級「代表什麼狀況」與第 4 級「要怎麼處理」
     *   （使用者 2026-09-20，三支同步）。判定一律走 chart-levels.js
     *   （三支逐位元同一份規則），**不可以在這裡自己寫一套區間**。
     *   寫不出來就維持 null，呼叫端看到 null 要**整段不畫**。
     */
    var out = { title: "", meaning: "", observed: "", caveats: [], levels: null };

    out.title = series.label + "（" + scopeText + "）";

    /* ── 一、這張圖在看什麼 ── */
    var definition = metric.meaning;
    if (series.metric === "congestedShare" && info.bandText)
      definition += "本圖的「壅塞」定義為 " + info.bandText + "。";
    out.meaning =
      "這張圖看的是「" +
      scopeText +
      "」的 " +
      series.label +
      "，橫軸是季度，共 " +
      (series.points || []).length +
      " 季（" +
      (series.points.length
        ? showPeriod(series.points[0].period) +
          " 到 " +
          showPeriod(series.points[series.points.length - 1].period)
        : "無資料") +
      "）。" +
      definition;

    /*
     * ══════════════════════════════════════════════════════════════
     *  一張圖多條線時：**逐條講**，不講平均
     * ══════════════════════════════════════════════════════════════
     *
     * 使用者 2026-09-16：「每一行展示一筆季別+日別的結果……
     *   而不是要你平均起來」。
     *
     * ⚠️ 多線時 series.points 的 value 已經被呼叫端清成 null（那個平均
     *   本來就不該存在），所以**不可以**走下面單線那條路——
     *   那會印出「目前沒有可以繪製的資料」，而圖上明明畫著好幾條線。
     *   這種「畫面有、文字說沒有」正是我們一路在擋的那種錯。
     */
    if (series.lines && series.lines.length) {
      var perLine = series.lines.map(function (line) {
        var own = (line.points || []).filter(function (point) {
          return point.value != null;
        });
        if (!own.length) return "・" + line.label + "：這個範圍內沒有資料。";
        if (own.length === 1)
          return (
            "・" + line.label + "：只有 " + showPeriod(own[0].period) +
            " 一季有資料（" + formatValue(own[0].value, series) +
            "），還看不出趨勢。"
          );
        var lineFirst = own[0];
        var lineLast = own[own.length - 1];
        var lineDiff = Number(lineLast.value) - Number(lineFirst.value);
        var lineFlat =
          Math.abs(lineDiff) < Math.pow(10, -series.digits) / 2;
        return (
          "・" + line.label + "：由 " + showPeriod(lineFirst.period) + " 的 " +
          formatValue(lineFirst.value, series) + " 變為 " +
          showPeriod(lineLast.period) + " 的 " +
          formatValue(lineLast.value, series) + "，" +
          (lineFlat
            ? "大致持平"
            : (lineDiff > 0 ? "上升 " : "下降 ") +
              formatValue(Math.abs(lineDiff), series)) +
          "。"
        );
      });
      out.observed =
        "這張圖一條線代表一個路段，共 " + series.lines.length + " 條。" +
        "各路段的長度與速限都不同，所以不取平均，逐條列出：\n" +
        perLine.join("\n");
      out.caveats.push(
        "各路段的長度與速限不同，這張圖只比同一條路段自己的歷季變化，" +
          "不同路段之間只能比大小，不可以相加，也不取平均。",
      );
      /*
       * 多條線時的第 3 級：講**有幾條在變好、幾條在變差**，
       * 不可以把幾條線的變化平均起來講——各路段的長度與速限都不同，
       * 平均出來的數字不對應任何一條路。
       * ⚠️ 第 4 級只在「真的有路段變差」時才寫；全部持平或全部改善時
       *   沒有具體要做的事，整段不寫。
       */
      var moved = series.lines
        .map(function (line) {
          var own = (line.points || []).filter(function (point) {
            return point.value != null;
          });
          if (own.length < 2) return 0;
          var delta = Number(own[own.length - 1].value) - Number(own[0].value);
          if (Math.abs(delta) < Math.pow(10, -series.digits) / 2) return 0;
          /* lowerIsWorse＝數值越小越糟（例如速率）；否則越大越糟（例如延滯）。 */
          var improved = metric.lowerIsWorse ? delta > 0 : delta < 0;
          return improved ? 1 : -1;
        })
        .filter(function (value) {
          return value !== 0;
        });
      var worse = moved.filter(function (value) {
        return value < 0;
      }).length;
      var better = moved.length - worse;
      out.levels = {
        state:
          "這 " + series.lines.length + " 條路段之中，" + better + " 條往好的方向變、" +
          worse + " 條往差的方向變，其餘大致持平。" +
          "各路段的長度與速限不同，所以這裡講的是「條數」，不是平均幅度。",
        action: worse
          ? "往差的方向變的那 " + worse + " 條建議在報告中單獨列出；" +
            "要判斷是資料問題還是真的變差，請先到「資料維護 → 執行資料異常檢查」" +
            "確認那幾條沒有漏匯或速限設定改過。"
          : undefined,
      };
      return out;
    }

    /* ── 二、看到了什麼 ＋ 三、代表什麼 ── */
    if (points.length < 2) {
      out.observed =
        points.length === 1
          ? "目前只有 " +
            showPeriod(points[0].period) +
            " 一季有資料（" +
            formatValue(points[0].value, series) +
            "），還看不出趨勢，要再累積一季以上才能比較。"
          : "目前沒有可以繪製的資料。";
    } else {
      var first = points[0];
      var last = points[points.length - 1];
      var diff = Number(last.value) - Number(first.value);
      var rising = diff > 0;
      var flat = Math.abs(diff) < Math.pow(10, -series.digits) / 2;
      /* 單季變化最大的那一段，講出來比只講頭尾有用 */
      var biggest = null;
      for (var i = 1; i < points.length; i += 1) {
        var step = Math.abs(Number(points[i].value) - Number(points[i - 1].value));
        if (!biggest || step > biggest.step)
          biggest = { step: step, from: points[i - 1], to: points[i] };
      }
      var worseWhenRising = !metric.lowerIsWorse;
      var direction = flat
        ? "大致持平"
        : rising
          ? worseWhenRising
            ? "上升（變差）"
            : "上升（改善）"
          : worseWhenRising
            ? "下降（改善）"
            : "下降（變差）";

      out.observed =
        "從 " +
        showPeriod(first.period) +
        " 的 " +
        formatValue(first.value, series) +
        "，到 " +
        showPeriod(last.period) +
        " 的 " +
        formatValue(last.value, series) +
        "，整體" +
        direction +
        (flat || series.ordinal
          ? "。"
          : /*
             * 差值緊接在頭尾兩個值後面，讀的人看得出它是怎麼來的。
             * 百分比再補一句倍數，兩種說法都給，使用者自己挑。
             */
            (function () {
              var body = formatDelta(diff, series);
              var times =
                series.unit === "%" ? timesText(first.value, last.value) : "";
              return body + (times ? "，" + times : "") + "。";
            })()) +
        /*
         * 單季變化這一句寫「從多少到多少」，不寫差值。
         * 這裡沒有前文可以讓人看出差是怎麼來的，單獨寫一個
         *「（14.3%）」會回到那個歧義；寫兩個端點反而更清楚。
         */
        (biggest && !flat && !series.ordinal
          ? "單季變化最大的是 " +
            showPeriod(biggest.from.period) +
            " → " +
            showPeriod(biggest.to.period) +
            "（" +
            formatValue(biggest.from.value, series) +
            " → " +
            formatValue(biggest.to.value, series) +
            "）。"
          : "");

      /*
       * 用實際條數再講一次，這是最不會被誤讀的說法。
       * 百分比可以吵，「7 條裡有 3 條」不會有人吵。
       */
      if (series.metric === "congestedShare" && last.gradedSize) {
        var countLabel = (series.sampleLabel || "條") === "條" ? "條" : "筆";
        /*
         * ⚠️ 兩段都要把「壅塞」講完，不可以只有前面那一段有。
         *
         *   使用者 2026-09-14（附圖）：
         *     「『115Q2 是 1 條裡有 0 條』正確應該是『115Q2 是 1 條裡有 0 條壅塞』。
         *       它前文『114Q4 是 1 條裡有 1 條壅塞』有點出，後聞反而沒有」
         *
         *   舊寫法前半接「壅塞，」、後半只接「。」——讀起來變成
         *   「1 條裡有 0 條」，0 條**什麼**沒有講。中文省略主詞在前後對仗時
         *   還勉強讀得懂，但這一句的兩半中間隔了一整串季度與數字，
         *   讀到後面早就接不回去了。
         *
         *   兩段之間也從「，」改成「；」：這是兩個並列的完整陳述，
         *   用逗號會讓人以為後半是前半的延續。
         */
        out.observed +=
          "以實際樣本來看，" +
          showPeriod(first.period) +
          " 是 " +
          first.gradedSize +
          " " + (series.sampleLabel || "條") + "裡有 " +
          first.congestedCount +
          " " + countLabel + "壅塞；" +
          showPeriod(last.period) +
          " 是 " +
          last.gradedSize +
          " " + (series.sampleLabel || "條") + "裡有 " +
          last.congestedCount +
          " " + countLabel + "壅塞。";
      }
      if (series.metric === "worstLos" && last.worstLos)
        out.observed +=
          "最新一季最差的是 " +
          last.worstLos +
          " 級，共 " +
          last.worstCount +
          " 條路段。";
      /*
       * ══════════════════════════════════════════════════════════
       *  第 3 級「代表什麼狀況」與第 4 級「要怎麼處理」
       * ══════════════════════════════════════════════════════════
       *
       * 使用者 2026-09-20（三支同步）。判定一律走 chart-levels.js，
       * **不可以在這裡自己寫一套區間**。
       *
       * ⚠️ 序數型指標（最差等級 A～F）**不可以算百分比變化**：
       *   「從 D 變成 E」除以 D 沒有意義。那一種另外寫，
       *   走的是「有沒有掉進壅塞段」那一支。
       * ⚠️ 起點是 0 時也不可以算百分比（分母是 0）。
       */
      var CL = typeof globalThis !== "undefined" && globalThis.ChartLevels;
      if (CL) {
        if (series.metric === "worstLos" && last.worstLos) {
          out.levels = CL.losLevels(
            last.worstLos,
            info.congestedStart || last.worstLos,
            Number(last.worstCount) || 0,
            Number(last.gradedSize) || Number(last.worstCount) || 0,
          );
        } else if (
          !series.ordinal &&
          Number(first.value) > 0 &&
          points.length >= 2
        ) {
          out.levels = CL.trendChangeLevels(
            ((Number(last.value) - Number(first.value)) / Number(first.value)) *
              100,
            points.length,
          );
        }
      }
    }

    /* ── 四、判讀時要注意 ── */
    var missing = (series.points || []).filter(function (point) {
      return point.value == null;
    });
    if (missing.length)
      out.caveats.push(
        "有 " +
          missing.length +
          " 季沒有可用的數值（" +
          missing
            .map(function (point) {
              return showPeriod(point.period);
            })
            .join("、") +
          "），線在那裡是斷開的，不是數值為 0。",
      );

    var unknown = (series.points || []).reduce(function (sum, point) {
      return sum +
        (series.metric === "congestedShare" || series.metric === "worstLos"
          ? point.unknownSize
          : point.missingValueSize);
    }, 0);
    if (unknown)
      out.caveats.push(
        "有 " +
          unknown +
          " 筆" +
          (series.metric === "congestedShare" || series.metric === "worstLos"
            ? "讀不到速率、判定不出服務水準，"
            : "缺少這個指標的有效數值，") +
          /*
           * 說法要跟著指標走。佔比類的指標把這些筆數排除在分母之外；
           * 平均類的指標則是這幾筆本來就沒有數值可以平均。
           * 兩種寫成同一句話會讓人看不懂「分母」是指什麼。
           */
          (series.metric === "congestedShare" || series.metric === "worstLos"
            ? "這些筆數不列入分母，也不列入最差值的比較；"
            : "這些筆數沒有數值可以納入平均；") +
          "請回到「尖峰明細」核對原始檔。",
      );

    /*
     * 樣本太少時的提醒，只對「佔比」類的指標有意義。
     *
     * 寫法刻意避開「跳動 N 個百分點」這種說法（使用者要求講白話，
     * 而且百分比的差本來就容易被誤讀）。改成直接把「這個佔比只可能是
     * 哪幾個值」列出來——2 條路段時只可能是 0%、50%、100%，
     * 看到這一句就會知道線為什麼跳那麼大格，不需要再解釋一次。
     */
    var smallest = (series.points || []).reduce(function (min, point) {
      if (!(point.gradedSize > 0)) return min;
      return min == null || point.gradedSize < min ? point.gradedSize : min;
    }, null);
    if (
      series.unit === "%" &&
      smallest != null &&
      smallest > 0 &&
      smallest < 5
    ) {
      var possible = [];
      for (var step = 0; step <= smallest; step += 1)
        possible.push(round((step / smallest) * 100, 0) + "%");
      out.caveats.push(
        "有效樣本最少的一季只有 " +
          smallest +
          " " + (series.sampleLabel || "條") + "，這種情況下佔比只可能是 " +
          possible.join("、") +
          " 這幾個值；一條路的變化就會讓線跳一大格，解讀時要留意。",
      );
    }

    if (series.metric === "worstLos")
      out.caveats.push(
        "這是「最差值」不是平均——只要有一條路段變差，整條線就會往上跳，" +
          "不代表整體都變差。要看整體走向請改看佔比那個指標。",
      );

    if (info.extraCaveats)
      [].push.apply(out.caveats, [].concat(info.extraCaveats));

    return out;
  }

  /*
   * ⚠️ 2026-09-17 移除 buildCrossProjectTrend()／describeCrossProjectTrend()。
   *
   * 「跨計畫比較」那一條線在畫面上早就拿掉了（使用者的評估是
   * 「跨計畫比較似乎沒什麼意義」），這兩支函式從此只剩自己的單元測試在呼叫——
   * 也就是說它們**唯一的作用是讓測試數字變好看**。
   * 留著的代價不是佔空間：改到 buildTrendSeries 時要連帶想它，
   * 而它的行為沒有任何畫面在驗證，改壞了也不會有人發現。
   * 《加總與並列稽核_三支程式_20260916》第六節列的兩處死程式之一。
   */

  /** 把說明整理成可以直接貼進投影片或報告的一段文字。 */
  function trendScript(description) {
    var lines = [];
    lines.push("【" + description.title + "】");
    lines.push(description.meaning);
    if (description.observed) lines.push(description.observed);
    if (description.caveats.length) {
      lines.push("判讀時要注意：");
      description.caveats.forEach(function (item) {
        lines.push("・" + item);
      });
    }
    lines.push("");
    lines.push("本段文字由系統依圖上同一份資料自動產生，正式引用前請核對原始檔。");
    return lines.join("\n");
  }


  /* ── 三段分法（順暢／尚可／壅塞）的組成 ──────────────────────
   *
   * 使用者要的圖：「多少路段是順暢、多少是尚可、多少是壅塞」，逐季看變化。
   *
   * ⚠️ 三件事一定要守住：
   *
   * 一、**分界從外面傳進來，這裡不做預設判斷**。單一計畫用它自己的分界，
   *     Manager 用 Manager 自己那一把尺；同一支程式算，兩邊各給各的規則。
   *     在這裡寫死或補預設值，就會出現「圖上分成三段，但不知道是誰的尺」。
   *
   * 二、**平日與假日不加總**。呼叫端一種日別給一份 rows，這裡不碰日別。
   *     把兩種日別的路段數加起來，得到的柱子不對應任何一天。
   *
   * 三、**判定不出等級的那幾筆要算出來、講出來，不可以默默丟掉**。
   *     丟掉的話佔比的分母會縮小，圖上看起來一切正常，
   *     但「100% 壅塞」可能其實是「唯一算得出來的那一條是壅塞」。
   */
  function bandOfGrade(los, bands) {
    var index = GRADES.indexOf(String(los || ""));
    if (index < 0) return null;
    if (index <= GRADES.indexOf(bands.smoothEnd)) return "smooth";
    if (index >= GRADES.indexOf(bands.congestedStart)) return "congested";
    return "fair";
  }

  /**
   * 一批彙總紀錄 → 逐季的三段組成。
   *
   * rows：state.summaries 那種形狀（一路段一日別一季一筆代表紀錄）。
   * bands：{ smoothEnd, congestedStart }，由呼叫端決定。
   */
  function buildBandSeries(rows, options) {
    var opts = options || {};
    var bands = opts.bands || { smoothEnd: "B", congestedStart: "E" };
    /*
     * ⚠️ 2026-09-15 起三段分界可以**依季別區間 × 路段覆寫**，
     *   所以同一張圖裡不同的列可能用不同的尺。
     *   呼叫端傳 `bandsOf(row)` 進來時，**逐列**問一次；沒傳就全部用同一組
     *  （＝改版前的行為，完全無感）。
     *
     * ⚠️ 不可以只在圖例上換一組尺而內部還用舊的：那會讓圖例與柱子說不同的話。
     */
    var bandsOf =
      typeof opts.bandsOf === "function"
        ? opts.bandsOf
        : function () {
            return bands;
          };
    var periods = [];
    var byPeriod = {};
    (rows || []).forEach(function (row) {
      var period = row.period;
      if (!period) return;
      if (!byPeriod[period]) {
        byPeriod[period] = { period: period, rows: [] };
        periods.push(period);
      }
      byPeriod[period].rows.push(row);
    });
    periods.sort(function (a, b) {
      return typeof opts.comparePeriod === "function"
        ? opts.comparePeriod(a, b)
        : String(a).localeCompare(String(b));
    });
    if (opts.completePeriods !== false) {
      periods = completeQuarterRange(periods);
      periods.forEach(function (period) {
        if (!byPeriod[period]) byPeriod[period] = { period: period, rows: [] };
      });
    }
    var points = periods.map(function (period) {
      var own = byPeriod[period].rows;
      var counts = { smooth: 0, fair: 0, congested: 0 };
      var unknown = 0;
      var worstIndex = -1;
      own.forEach(function (row) {
        var band = bandOfGrade(row.los, bandsOf(row));
        if (band) {
          counts[band] += 1;
          var gradeIndex = GRADES.indexOf(row.los);
          if (gradeIndex > worstIndex) worstIndex = gradeIndex;
        } else unknown += 1;
      });
      var graded = counts.smooth + counts.fair + counts.congested;
      return {
        period: period,
        counts: counts,
        unknown: unknown,
        graded: graded,
        /* 圖說必須讀實際出現的最差等級，不可以由三段筆數反猜。 */
        worstLos: worstIndex >= 0 ? GRADES[worstIndex] : null,
        size: own.length,
        /* 佔比的分母是**判定得出等級的筆數**，不是全部筆數。 */
        shares: graded
          ? {
              smooth: (counts.smooth / graded) * 100,
              fair: (counts.fair / graded) * 100,
              congested: (counts.congested / graded) * 100,
            }
          : null,
      };
    });
    var gradesOf = bandGradeGroups(bands);
    return {
      bands: bands,
      grades: gradesOf,
      /* 圖例要寫出「哪幾級算這一段」，看圖的人才知道尺是怎麼訂的。 */
      legend: [
        { key: "smooth", name: "順暢", grades: gradesOf.smooth },
        { key: "fair", name: "尚可", grades: gradesOf.fair },
        { key: "congested", name: "壅塞", grades: gradesOf.congested },
      ],
      periods: periods,
      points: points,
    };
  }

  /** 三段各自涵蓋哪幾級。中間那一段是算出來的，不讓使用者分別設。 */
  function bandGradeGroups(bands) {
    var smoothEnd = GRADES.indexOf(bands.smoothEnd);
    var congestedStart = GRADES.indexOf(bands.congestedStart);
    return {
      smooth: GRADES.slice(0, smoothEnd + 1),
      fair: GRADES.slice(smoothEnd + 1, congestedStart),
      congested: GRADES.slice(congestedStart),
    };
  }

  /**
   * 將多條趨勢數列排到同一組季度欄位，供 Excel 匯出使用。
   *
   * 平日與假日可能從不同季度開始，或其中一種日別少一季；若直接沿用
   * 第一條數列的季度，後面的值會被貼到錯誤季別。這裡先取季度聯集，
   * 再逐季以 period 精確對位，缺少的季度保留 null（Excel 會畫成斷線）。
   */
  function alignTrendSeriesForExcel(list, comparePeriod) {
    var periods = [];
    (list || []).forEach(function (item) {
      (item.points || []).forEach(function (point) {
        if (periods.indexOf(point.period) < 0) periods.push(point.period);
      });
    });
    periods.sort(comparePeriod || function (a, b) { return String(a).localeCompare(String(b)); });
    return {
      periods: periods,
      /*
       * ⚠️ 一張圖多條線時，Excel 也要**一條線一個數列**。
       *
       *   多線的 item.points 已經被清成 null（那個跨路段平均本來就不該
       *   存在），直接照 item.points 匯出會得到一整欄空白——
       *   畫面上有四條線、檔案裡卻一格數字都沒有。
       *   使用者拿到的是 Excel，不是畫面，所以這裡一定要跟著拆。
       *
       * ⚠️ 欄名要帶上路段名稱，否則四個數列全叫同一個指標名，
       *   在 Excel 裡分不出哪一欄是哪一條路。
       */
      series: (list || [])
        .filter(function (item) { return !item.ordinal; })
        .reduce(function (out, item) {
          var valuesFor = function (source) {
            return periods.map(function (period) {
              var point = (source || []).find(function (candidate) {
                return candidate.period === period;
              });
              return point ? point.value : null;
            });
          };
          if (item.lines && item.lines.length)
            item.lines.forEach(function (line) {
              out.push({
                label: item.label + "／" + line.label,
                unit: item.unit,
                values: valuesFor(line.points),
              });
            });
          else
            out.push({
              label: item.label,
              unit: item.unit,
              values: valuesFor(item.points),
            });
          return out;
        }, []),
    };
  }

  return {
    TREND_METRICS: TREND_METRICS,
    TREND_GRADES: GRADES,
    trendMetricLabel: metricLabel,
    buildTrendSeries: buildTrendSeries,
    buildBandSeries: buildBandSeries,
    bandGradeGroups: bandGradeGroups,
    describeTrendChart: describeTrendChart,
    trendScript: trendScript,
    trendFormatValue: formatValue,
    alignTrendSeriesForExcel: alignTrendSeriesForExcel,
  };
});
