/*
 * ══════════════════════════════════════════════════════════════════════
 *  參數的適用範圍：依「季別**區間** × 路段（× 方向）」覆寫
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15（原話）：
 *   「服務水準判定方式，應該要比照全日交通量和路口轉向程式的參數設定那樣，
 *     新增一個依照**每季**和**各路段／路口**，當衝突發生時，**以每季優先**
 *    （和另外兩程式一致的判斷方式），套用後進行重新計算，請確定服務水準有將
 *     需要用到的原始資料保存下來，讓使用者不須重新匯入檔案。」
 *
 * ── 這一支只做一件事：回答「這一筆資料該用哪一組門檻」 ──────────
 *
 * 刻意做成**純函式、不碰畫面、不碰儲存**。理由與姊妹專案「全日交通量」的
 * app/factor-scope.ts 相同：門檻是每一個 LOS 等級的來源，這個判斷錯一次，
 * 畫面、Excel、報告草稿、歷季趨勢會一起錯，而且錯得很安靜
 *（每一個等級看起來都很合理）。所以它必須是可以單獨測到爛的東西。
 *
 * ⚠️ **最重要的一條不變量**：沒有任何覆寫時，`resolveLosRule()` 回傳的
 *   就是原本那一組計畫預設門檻，**一模一樣的物件參考**。
 *   也就是說這個改版對「還沒開始用範圍設定」的使用者是**完全無感**的。
 *   los-rule-scope.test.mjs 的 A 段就是在守這一條。
 */
(function (globalScope) {
  "use strict";

  /** 萬用字元：代表「全季別」「全路段」或「全方向」。 */
  var ANY = "*";

  /**
   * 季別的排序索引（115Q2 → 一個可以比大小的整數）。
   *
   * ⚠️ 全站**只有這一份**。app.js 的 periodIndex 與 main-toolbar.js 的
   *   indexOfPeriod 都轉呼叫這裡——三份各寫各的遲早會漂移，而漂移之後
   *   「這一季在不在區間內」會在不同地方給出不同答案，
   *   那是會直接影響數字的錯，而且非常難找。
   *   los-rule-scope.test.mjs 有一條掃描擋著，別的檔案自己再寫一份會紅。
   *
   * ⚠️ 兩位數是民國年、四位數是西元年，換算到同一把尺上。
   */
  function periodIndex(value) {
    var m = String(value || "").match(/^(\d{2,4})Q([1-4])$/);
    if (!m) return -1;
    var year = Number(m[1]);
    return (year >= 1000 ? year - 1911 : year) * 4 + Number(m[2]);
  }

  /**
   * 把舊格式（單一 period）與新格式（periodFrom～periodTo）統一成同一個形狀。
   *
   * ⚠️ 舊資料**一定要讀得回來**：使用者已經存過的覆寫是單一季別，
   *   直接改欄位名會讓那些設定安靜地失效——而失效之後畫面上每一格都還在，
   *   只是全部退回計畫預設門檻，沒有任何訊息。
   *   單一季別等價於「起＝迄＝那一季」（與主工具列的語意一致）。
   */
  function normalizeScope(scope) {
    if (!scope) return null;
    var from = scope.periodFrom != null ? scope.periodFrom : scope.period;
    var to = scope.periodTo != null ? scope.periodTo : scope.period;
    var out = {};
    for (var key in scope) if (Object.hasOwn(scope, key)) out[key] = scope[key];
    out.periodFrom = from == null || from === "" ? ANY : from;
    out.periodTo = to == null || to === "" ? ANY : to;
    out.road = scope.road == null || scope.road === "" ? ANY : scope.road;
    out.direction =
      scope.direction == null || scope.direction === "" ? ANY : scope.direction;
    return out;
  }

  /**
   * 這個區間涵蓋幾季（用來比「誰比較細」）。
   * ANY（不限季）回傳 Infinity——它一定是最粗的那一個。
   */
  function rangeWidth(scope) {
    var normalized = normalizeScope(scope);
    if (!normalized) return Infinity;
    if (normalized.periodFrom === ANY && normalized.periodTo === ANY)
      return Infinity;
    var from = periodIndex(normalized.periodFrom);
    var to = periodIndex(normalized.periodTo);
    if (from < 0 || to < 0) return Infinity;
    return Math.abs(to - from) + 1;
  }

  /**
   * 解析順位——**由細到粗**，取第一個命中的。
   *
   * | 順位 | 範圍 | 意思 |
   * |---|---|---|
   * | 1 | (這一季, 這一段) | 這一季、這一段的專屬門檻 |
   * | 2 | (這一季, 全部)   | 這一季標準改了 |
   * | 3 | (全季別, 這一段) | 這一段路型特殊 |
   * | 4 | 計畫預設         | **就是現在的行為** |
   *
   * ⚠️ 順位 2 蓋過順位 3（**季別優先**）——這是使用者 2026-09-15 指定的，
   *   而且與全日交通量、路口轉向的係數範圍**同一套順位**。
   * ⚠️ 但**不可以默默套用**：`conflictsIn()` 會把這種重疊挑出來，
   *   由畫面明白寫出「目前套用的是哪一組」。
   *   看不見的優先順位，就是下一個「算出來的數字沒人解釋得了」。
   */
  var TIER_ORDER = ["period-road", "period-any", "any-road"];
  var TIER_LABELS = {
    "period-road": "這一季 × 這一路段",
    "period-any": "這一季 × 全路段",
    "any-road": "全季別 × 這一路段",
    "project-default": "全季別 × 全路段（計畫預設）",
  };

  function tierOf(scope) {
    var normalized = normalizeScope(scope);
    if (!normalized) return "project-default";
    var anyPeriod =
      normalized.periodFrom === ANY && normalized.periodTo === ANY;
    var anyRoad = normalized.road === ANY;
    if (!anyPeriod && !anyRoad) return "period-road";
    if (!anyPeriod) return "period-any";
    if (!anyRoad) return "any-road";
    return "project-default";
  }

  /**
   * 這一條覆寫命不命中某一筆資料。
   *
   * @param {string} period    這一筆的季別
   * @param {string} road      這一筆的路段
   * @param {string} direction 這一筆的方向（只有速限那張表會用；其餘傳空）
   *
   * ⚠️ 季別是**區間**：起與迄都含在內（closed interval）。
   *   使用者 2026-09-15：「季別功能擴增為季別區間」。
   *   只設一邊（例如只有起）時，另一邊視為不限——那是「從這一季開始一直有效」，
   *   正是速限「某一季改了之後都用新的」的情形。
   */
  function matches(scope, period, road, direction) {
    var normalized = normalizeScope(scope);
    if (!normalized) return false;
    if (normalized.periodFrom !== ANY || normalized.periodTo !== ANY) {
      var here = periodIndex(period);
      if (here < 0) return false;
      if (normalized.periodFrom !== ANY && here < periodIndex(normalized.periodFrom))
        return false;
      if (normalized.periodTo !== ANY && here > periodIndex(normalized.periodTo))
        return false;
    }
    if (normalized.road !== ANY && normalized.road !== road) return false;
    /*
     * ⚠️ 方向只有在這一條覆寫**指定了方向**時才比。
     *   沒指定就是「這一段兩個方向都適用」——不可以因為呼叫端沒傳方向
     *   就讓有指定方向的那一條也命中。
     */
    if (normalized.direction !== ANY && normalized.direction !== direction)
      return false;
    return true;
  }

  /**
   * 這一筆資料實際要用的門檻，以及它是怎麼命中的。
   *
   * @param {object} fallback 計畫預設門檻（沒有任何覆寫時原樣回傳）
   * @param {Array} scopes    覆寫清單 [{period, road, rules}]
   * @param {string} period   這一筆的季別
   * @param {string} road     這一筆的路段
   * @returns {{rules: object, tier: string, tierLabel: string, scope: object|null}}
   */
  function resolveLosRule(fallback, scopes, period, road, direction) {
    var list = Array.isArray(scopes) ? scopes : [];
    for (var i = 0; i < TIER_ORDER.length; i += 1) {
      var tier = TIER_ORDER[i];
      /*
       * ⚠️ 同一層裡可能有**好幾條都命中**（季別改成區間之後一定會發生：
       *   「115Q1～115Q4」與「115Q2～115Q2」兩條都蓋到 115Q2）。
       *   這時取**涵蓋季數最少**的那一條——「設得比較細的優先」，
       *   與跨層的順位是同一個道理。
       *   ⚠️ 一樣細時取**先宣告的那一條**（穩定、可預期）；
       *     而且 conflictsIn() 會把重疊講出來，不會默默吃掉。
       *   ⚠️ 不可以只取第一個命中的：那樣「後來補設的單季例外」會被
       *     早就存在的大區間蓋掉，使用者看到的是「我設了卻沒用」。
       */
      var best = null;
      var bestWidth = Infinity;
      for (var j = 0; j < list.length; j += 1) {
        var scope = list[j];
        if (!scope || !scope.rules) continue;
        if (tierOf(scope) !== tier) continue;
        if (!matches(scope, period, road, direction)) continue;
        var width = rangeWidth(scope);
        if (best === null || width < bestWidth) {
          best = scope;
          bestWidth = width;
        }
      }
      if (best)
        return {
          rules: best.rules,
          tier: tier,
          tierLabel: TIER_LABELS[tier],
          scope: best,
        };
    }
    /*
     * ⚠️ 這裡一定要回**原本那個物件**（不是複製一份）。
     *   複製的話，「沒有覆寫時與改版前逐格相同」這條不變量
     *   就只能靠逐欄比對來驗，而不是靠參考相等——那是弱得多的保證。
     */
    return {
      rules: fallback,
      tier: "project-default",
      tierLabel: TIER_LABELS["project-default"],
      scope: null,
    };
  }

  /**
   * 兩條覆寫的**季別區間**有沒有交集。
   *
   * ⚠️ 全站只有這一份。conflictsIn()（畫面上的重疊提示）與「路段改名／合併時
   *   要不要把覆寫搬過去」用的必須是同一套判斷——各寫一份的話，
   *   畫面上說會重疊的那兩條，搬家時卻被當成不重疊而直接併入，
   *   於是目標路段原本的設定被蓋掉，而且沒有任何訊息。
   * ⚠️ 不限的那一端當成正負無限大，不可以當成 0——
   *   當成 0 的話「全季別」會變成「只有最早那一季」，重疊就漏報了。
   */
  function rangesOverlap(a, b) {
    var na = normalizeScope(a);
    var nb = normalizeScope(b);
    if (!na || !nb) return false;
    var aFrom = na.periodFrom === ANY ? -Infinity : periodIndex(na.periodFrom);
    var aTo = na.periodTo === ANY ? Infinity : periodIndex(na.periodTo);
    var bFrom = nb.periodFrom === ANY ? -Infinity : periodIndex(nb.periodFrom);
    var bTo = nb.periodTo === ANY ? Infinity : periodIndex(nb.periodTo);
    return aFrom <= bTo && bFrom <= aTo;
  }

  /**
   * 找出「同一筆資料被兩條以上規則命中」的重疊。
   *
   * ⚠️ 重疊**不是錯**（季別優先本來就會蓋過路段），但**一定要講出來**——
   *   使用者設了一條路段專屬門檻，卻因為那一季有全路段的設定而沒生效，
   *   畫面上不說的話，他會以為自己設的那一條壞了。
   */
  function conflictsIn(scopes) {
    var list = Array.isArray(scopes) ? scopes : [];
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var a = list[i];
      if (!a) continue;
      for (var j = 0; j < list.length; j += 1) {
        var b = list[j];
        if (i === j || !b) continue;
        var aTier = tierOf(a);
        var bTier = tierOf(b);
        if (TIER_ORDER.indexOf(aTier) >= TIER_ORDER.indexOf(bTier)) continue;
        /* b 比 a 粗；有交集才算重疊。 */
        var na = normalizeScope(a);
        var nb = normalizeScope(b);
        /* 區間有沒有交集：走全站唯一那一份 rangesOverlap()。 */
        var periodOverlap = rangesOverlap(a, b);
        var roadOverlap =
          na.road === nb.road || na.road === ANY || nb.road === ANY;
        var directionOverlap =
          na.direction === nb.direction ||
          na.direction === ANY ||
          nb.direction === ANY;
        if (periodOverlap && roadOverlap && directionOverlap)
          out.push({
            winner: a,
            loser: b,
            winnerLabel: TIER_LABELS[aTier],
            loserLabel: TIER_LABELS[bTier],
          });
      }
    }
    return out;
  }

  globalScope.LosRuleScope = {
    ANY: ANY,
    TIER_LABELS: TIER_LABELS,
    periodIndex: periodIndex,
    normalizeScope: normalizeScope,
    rangeWidth: rangeWidth,
    tierOf: tierOf,
    matches: matches,
    rangesOverlap: rangesOverlap,
    resolveLosRule: resolveLosRule,
    conflictsIn: conflictsIn,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
