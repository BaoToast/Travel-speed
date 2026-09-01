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
   */
  function isNum(value) {
    return (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      isFinite(Number(value))
    );
  }

  function num(value, digits) {
    if (!isNum(value)) return "—";
    return Number(value).toLocaleString("zh-TW", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function pct(value) {
    if (!isNum(value)) return "—";
    return Number(value).toFixed(1) + "%";
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

  function selectRows(details, condition) {
    var c = condition || DEFAULT_CONDITION;
    return (details || [])
      .filter(function (row) {
        if (!inScope(row, c.scope)) return false;
        if (c.peaks && c.peaks.length && c.peaks.indexOf(row.peak) < 0) return false;
        if (c.directions && c.directions.length && c.directions.indexOf(row.direction) < 0)
          return false;
        if (c.days && c.days.length && c.days.indexOf(row.day) < 0) return false;
        if (c.roads && c.roads.length && c.roads.indexOf(row.road) < 0) return false;
        return true;
      })
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

  function uniqueDirections(rows) {
    var seen = [];
    for (var i = 0; i < rows.length; i += 1) {
      var name = dirLabel(rows[i]);
      if (seen.indexOf(name) < 0) seen.push(name);
    }
    return seen;
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
      parts.push(
        "速限 " +
          num(row.limit, 0) +
          " km/h、速限比 " +
          (isNum(row.ratio) ? pct(Number(row.ratio) * 100) : "—"),
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
  function describeGrowth(rows, digits) {
    var groups = {};
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var key = [row.road, row.day, row.peak, row.direction].join("|");
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
      var label =
        "　" + first.road + "（" + first.day + "）・" + first.peak + "・" + dirLabel(first) + "：";
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
          "。",
      );
    });
    return lines;
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
      Math.abs(change).toFixed(1) +
      "%"
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

  function describeExtremes(rows, digits) {
    var points = rows.filter(function (row) {
      return isNum(row.travel);
    });
    if (points.length < 2) return ["　可比較的紀錄不足兩筆，未做快慢比較。"];
    var sorted = points.slice().sort(function (a, b) {
      return Number(b.travel) - Number(a.travel);
    });
    var mean =
      points.reduce(function (sum, row) {
        return sum + Number(row.travel);
      }, 0) / points.length;
    var name = function (row) {
      return periodText(row.period) + " " + row.road + "（" + row.day + "・" + row.peak + "・" + dirLabel(row) + "）";
    };
    return [
      "　旅行速率最快為 " +
        name(sorted[0]) +
        " " +
        num(sorted[0].travel, digits) +
        " km/h，最慢為 " +
        name(sorted[sorted.length - 1]) +
        " " +
        num(sorted[sorted.length - 1].travel, digits) +
        " km/h，" +
        points.length +
        " 筆平均 " +
        num(mean, digits) +
        " km/h。（各路段長度與速限不同，此處僅比較大小。）",
    ];
  }

  function describeLosCount(rows) {
    var counts = {};
    var unknown = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var los = rows[i].los;
      if (LOS_ORDER.indexOf(los) < 0) unknown += 1;
      else counts[los] = (counts[los] || 0) + 1;
    }
    var parts = LOS_ORDER.filter(function (los) {
      return counts[los];
    }).map(function (los) {
      return los + " 級 " + counts[los] + " 筆（" + pct((counts[los] / rows.length) * 100) + "）";
    });
    if (unknown) parts.push("無法判定 " + unknown + " 筆");
    return parts.length
      ? ["　共 " + rows.length + " 筆：" + parts.join("、") + "。"]
      : ["　範圍內沒有可統計的服務水準。"];
  }

  function buildConclusion(details, condition, meta) {
    var c = Object.assign({}, DEFAULT_CONDITION, condition || {});
    var m = meta || {};
    periodText =
      typeof m.showPeriod === "function"
        ? m.showPeriod
        : function (value) {
            return String(value == null ? "" : value);
          };
    var rows = selectRows(details, c);
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
        if (wants("growth")) Array.prototype.push.apply(out, describeGrowth(group, c.digits));
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
      if (wants("losCount")) Array.prototype.push.apply(out, describeLosCount(rows));
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
      Array.prototype.push.apply(out, describeLosCount(rows));
    }
    if (wants("worst") && c.grouping !== "byPeriod") {
      heading("服務水準最差的路段");
      Array.prototype.push.apply(out, describeWorst(rows));
    }
    if (wants("extremes")) {
      heading("旅行速率的最快與最慢");
      Array.prototype.push.apply(out, describeExtremes(rows, c.digits));
    }
    if (wants("growth") && c.grouping !== "byRoad") {
      heading("季度之間的變動");
      var lines = describeGrowth(rows, c.digits);
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
