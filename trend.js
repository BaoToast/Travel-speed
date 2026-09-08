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
   * 「增加 28.6%」單獨出現時有兩種讀法（42.9−14.3＝28.6，
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

    var out = { title: "", meaning: "", observed: "", caveats: [] };

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
        out.observed +=
          "以實際樣本來看，" +
          showPeriod(first.period) +
          " 是 " +
          first.gradedSize +
          " " + (series.sampleLabel || "條") + "裡有 " +
          first.congestedCount +
          " " + countLabel + "壅塞，" +
          showPeriod(last.period) +
          " 是 " +
          last.gradedSize +
          " " + (series.sampleLabel || "條") + "裡有 " +
          last.congestedCount +
          " " + countLabel + "。";
      }
      if (series.metric === "worstLos" && last.worstLos)
        out.observed +=
          "最新一季最差的是 " +
          last.worstLos +
          " 級，共 " +
          last.worstCount +
          " 條路段。";
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

  /**
   * 跨計畫比較：一個計畫一條線。
   *
   * ⚠️ 跨計畫**只能比佔比與平均，不能比總數**。
   *    各計畫的路段數不一樣（甲 20 條、乙 5 條），比條數一定會誤導：
   *    甲壅塞 8 條、乙 3 條看起來甲比較糟，但 8/20＝40%、3/5＝60%，
   *    其實是乙比較糟。所以這裡回傳的每一條線都用同一個指標，
   *    而且一定把 N（路段數）帶著，畫面要標出來。
   */
  function buildCrossProjectTrend(groups, options) {
    var opts = options || {};
    return (groups || []).map(function (group) {
      var series = buildTrendSeries(group.rows, {
        metric: opts.metric,
        congestedStart: opts.congestedStart || group.congestedStart,
        populationLabel: opts.populationLabel,
        sampleLabel: opts.sampleLabel,
        comparePeriod: opts.comparePeriod,
      });
      series.projectCode = group.code;
      series.projectName = group.name;
      /* 這個計畫最少的一季有幾條路段——樣本太少要在畫面上標記 */
      series.smallestSample = series.points.reduce(function (min, point) {
        if (!(point.valueSize > 0)) return min;
        return min == null || point.valueSize < min ? point.valueSize : min;
      }, null);
      return series;
    });
  }

  /**
   * 跨計畫圖的說明文字。
   *
   * 與單一計畫版的差別：這裡要講的是「誰在變差、誰在改善」，
   * 而不是某一條線的細節。而且一定要把「路段數不同」講出來——
   * 那是跨計畫比較最容易被質疑的地方。
   */
  function describeCrossProjectTrend(list, meta) {
    var info = meta || {};
    var showPeriod =
      typeof info.showPeriod === "function"
        ? info.showPeriod
        : function (value) {
            return String(value);
          };
    var usable = (list || []).filter(function (series) {
      return series.points.some(function (point) {
        return point.value != null;
      });
    });
    var metric = metricByKey(usable.length ? usable[0].metric : "") || TREND_METRICS[0];
    var out = { title: "", meaning: "", observed: "", caveats: [] };
    var label = usable.length ? usable[0].label : "";
    out.title = "跨計畫比較：" + label;

    if (!usable.length) {
      out.meaning = "目前沒有可以比較的計畫資料。";
      return out;
    }

    var periods = [
      ...new Set(
        usable.flatMap(function (series) {
          return series.points.map(function (point) {
            return point.period;
          });
        }),
      ),
    ];
    out.meaning =
      "這張圖把 " +
      usable.length +
      " 個計畫的" +
      label +
      "畫在同一張圖上，一個計畫一條線，橫軸是季度（共 " +
      periods.length +
      " 季）。" +
      metric.meaning +
      "跨計畫比較一律用比例或平均，不用總數——各計畫的路段數不一樣，比總數會誤導。";

    /* 誰變差最多、誰改善最多 */
    var changes = usable
      .map(function (series) {
        var valued = series.points.filter(function (point) {
          return point.value != null;
        });
        if (valued.length < 2) return null;
        var first = valued[0];
        var last = valued[valued.length - 1];
        return {
          series: series,
          first: first,
          last: last,
          diff: Number(last.value) - Number(first.value),
        };
      })
      .filter(Boolean);

    if (!changes.length) {
      out.observed = "每個計畫都只有一季資料，還看不出趨勢。";
    } else {
      var worseIsUp = !metric.lowerIsWorse;
      changes.forEach(function (change) {
        change.deterioration = worseIsUp ? change.diff : -change.diff;
      });
      var worsening = changes.filter(function (change) { return change.deterioration > 0; })
        .sort(function (a, b) { return b.deterioration - a.deterioration; });
      var improving = changes.filter(function (change) { return change.deterioration < 0; })
        .sort(function (a, b) { return a.deterioration - b.deterioration; });
      function changeText(prefix, change) {
        return prefix + "「" + change.series.projectName + "」：從 " +
          showPeriod(change.first.period) + " 的 " +
          formatValue(change.first.value, change.series) + " 到 " +
          showPeriod(change.last.period) + " 的 " +
          formatValue(change.last.value, change.series) + "。";
      }
      out.observed = worsening.length
        ? changeText("惡化幅度最大的是", worsening[0])
        : "可比較的計畫都沒有惡化。";
      if (improving.length)
        out.observed += changeText("改善幅度最大的是", improving[0]);
    }

    /* 路段數不同——跨計畫比較一定要講的那一句 */
    var sizes = usable
      .map(function (series) {
        return series.projectName + " " + (series.smallestSample || 0) + " " +
          (series.sampleLabel || "條");
      })
      .join("、");
    out.caveats.push(
      "各計畫的路段數不一樣（" +
        sizes +
        "），所以這張圖比的是比例不是總數；樣本少的計畫，線的跳動會比較大。",
    );
    /*
     * 門檻用「5 條以下」（含 5）。5 條的佔比只可能是
     * 0/20/40/60/80/100% 六個值，已經粗到不適合單看，所以一起提醒。
     */
    var tiny = usable.filter(function (series) {
      return series.smallestSample != null && series.smallestSample <= 5;
    });
    if (tiny.length)
      out.caveats.push(
        "其中 " +
          tiny
            .map(function (series) {
              return series.projectName + "（" + series.smallestSample + " " +
                (series.sampleLabel || "條") + "）";
            })
            .join("、") +
          " 的路段數在 5 條以下，比例會跳得很大，不宜單看這張圖下結論。",
      );

    return out;
  }

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

  return {
    TREND_METRICS: TREND_METRICS,
    TREND_GRADES: GRADES,
    trendMetricLabel: metricLabel,
    buildTrendSeries: buildTrendSeries,
    describeTrendChart: describeTrendChart,
    trendScript: trendScript,
    trendFormatValue: formatValue,
    buildCrossProjectTrend: buildCrossProjectTrend,
    describeCrossProjectTrend: describeCrossProjectTrend,
  };
});
