/*
 * ── v2.20.22 的守門測試 ──
 *
 * 本輪修正全部來自三支系統的跨系統徹查。
 *  H5 合併路段時速限版本無重疊檢查 → 未參與合併的紀錄 LOS 被改掉
 *  M1 三支共用的非調查日期清單漂移
 *  M2 roadSignature 沒清 ASCII 連字號 → 重複路段偵測失效
 *  M3 同一份檔案有兩個矛盾的調查日期卻回報「相符」
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as XLSX from "xlsx";

const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const pdSource = readFileSync(new URL("./period-date.js", import.meta.url), "utf8");
/*
 * ⚠️ los-rule-scope.js 也要載進這個沙箱。
 *
 *   2026-09-15 起 app.js 的 periodIndex() 是**轉呼叫** LosRuleScope.periodIndex
 *  （季別索引全站只有一份，避免三份實作漂移）。沒載進來的話，
 *   這裡每一條牽涉到季別排序的測試都會炸在 "Cannot read properties of undefined"
 *   ——而那不是程式的錯，是沙箱少載了一個相依。
 *   網頁上的載入順序見 index.html：los-rule-scope 在 app.js 之前。
 */
const scopeSource = readFileSync(
  new URL("./los-rule-scope.js", import.meta.url),
  "utf8",
);

const box = { XLSX, console };
box.window = box; box.globalThis = box; box.self = box;
new Function("window", "self", "globalThis", pdSource).call(box, box, box, box);
new Function("window", "self", "globalThis", scopeSource).call(box, box, box, box);

/** 取出 app.js 所有最上層 function 宣告，一起求值。 */
function loadAppFunctions(exports) {
  const decls = [];
  const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let m;
  while ((m = re.exec(appSource))) {
    let depth = 0, started = false, j = m.index;
    for (; j < appSource.length; j++) {
      if (appSource[j] === "{") { depth++; started = true; }
      else if (appSource[j] === "}") { depth--; if (started && depth === 0) { j++; break; } }
    }
    decls.push(appSource.slice(m.index, j));
  }
  const preamble = `const num=(v)=>{if(v==null||String(v).trim()==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;};
const fmt=(v,d=2)=>(v==null?"—":Number(v).toFixed(d));
const state={limits:{},limitConfirmed:{},aliases:{},roadMeta:{},speedVersions:{},projects:[],details:[]};`;
  return new Function(
    "XLSX", "globalThis", "document", "localStorage",
    preamble + "\n" + decls.join("\n") + `\nreturn {${exports.join(",")}};`,
  )(XLSX, box, null, null);
}

const REAL = new URL("../realdata/", import.meta.url);
const hasRealData = existsSync(new URL("batch2/14013TS601鳳北路平日.xlsx", REAL));

/* ── M1：三支共用的非調查日期清單 ── */

test("非調查日期清單要涵蓋彙整、輸出、建檔、產製", () => {
  /*
   * 這份清單是路口轉向、全日交通量、交通服務水準三支共用的。
   * v2.1.40 只在路口轉向加了這四個詞，另外兩支沒跟上——實測「彙整日期」
   * 會蓋掉真正的調查日期（它帶「日期：」標示，被當成明確標示的調查日期
   * 直接回傳，後面真正的調查日期永遠讀不到）。
   */
  for (const word of ["製表", "列印", "印製", "報告", "出圖", "填表", "核定",
                      "審查", "校核", "繪製", "修正", "更新",
                      "彙整", "輸出", "建檔", "產製"])
    assert.equal(
      box.PeriodDate.isNonSurveyDateText(`${word}日期：115年3月1日`),
      true,
      `「${word}日期」應排除`,
    );
  for (const word of ["調查", "監測"])
    assert.equal(
      box.PeriodDate.isNonSurveyDateText(`${word}日期：115年3月1日`),
      false,
      `「${word}日期」不可排除`,
    );
});

/* ── M2：重複路段偵測 ── */

test("路段名稱只差分隔符時要算出相同的簽章", () => {
  /*
   * 字元類裡列了各種連字號的原形（‐‑‒–—―－），卻漏了 ASCII 的 `-`；
   * 但 normalize() 已經先把那六種全部換成 ASCII `-`，於是「-」永遠留著、
   * 「～」永遠被清掉，任何「波浪號 vs 連字號」的配對都算不出相同簽章。
   * 實測 14013TS601 的平日與假日兩份真實檔就是差這一個字元。
   */
  const F = loadAppFunctions(["roadSignature"]);
  const base = "鳳北路(南星路～沿海四路)";
  for (const variant of [
    "鳳北路(南星路-沿海四路)",
    "鳳北路(南星路－沿海四路)",
    "鳳北路(南星路–沿海四路)",
    "鳳北路(南星路—沿海四路)",
    "鳳北路(南星路~沿海四路)",
    "鳳北路（南星路～沿海四路）",
    "鳳北路 (南星路 ～ 沿海四路)",
  ])
    assert.equal(
      F.roadSignature(base),
      F.roadSignature(variant),
      `「${variant}」應與「${base}」視為同一條路段`,
    );
  /* 反面：真的不同的路段不可以被併成一條 */
  assert.notEqual(
    F.roadSignature(base),
    F.roadSignature("鳳北路(南星路～中林路)"),
    "端點不同就是不同路段，不可誤併",
  );
});

test("真實的平假日配對要算出相同簽章", { skip: !hasRealData }, () => {
  const F = loadAppFunctions(["roadSignature", "roadFromWorkbook", "normalize",
                              "stripRoadSuffix", "headerTextsOf", "suspiciousRoadName"]);
  const read = (name) =>
    F.roadFromWorkbook(XLSX.read(readFileSync(new URL("batch2/" + name, REAL)), { type: "buffer" }));
  const weekday = read("14013TS601鳳北路平日.xlsx");
  const holiday = read("14013TS601鳳北路假日.xlsx");
  assert.notEqual(weekday, holiday, "這兩份真實檔的站名本來就寫得不一樣");
  assert.equal(
    F.roadSignature(weekday),
    F.roadSignature(holiday),
    "同一站的平日與假日必須算出相同簽章，否則平假日比較整個不成立",
  );
});

/* ── M3：同一份檔案的矛盾調查日期 ── */

test("同一份檔案有兩個不同的調查日期時要指出來", { skip: !hasRealData }, () => {
  /*
   * 實測 11535TS1501／1502／1503 三份真實檔，上午尖峰的表頭寫 115Q1、
   * 下午尖峰卻還留著上一季的 114Q4（套模板時忘了改）。舊版只看第一個
   * 有標示的日期，於是回報「調查日期與所選期別相符」——對一份自己前後
   * 矛盾的檔案發出無保留的通過。
   */
  const F = loadAppFunctions(["surveyDateFromWorkbook"]);
  const check = (name) =>
    F.surveyDateFromWorkbook(XLSX.read(readFileSync(new URL("batch2/" + name, REAL)), { type: "buffer" }));
  for (const name of [
    "11535TS1501左楠路加昌路世運大道平日.XLS",
    "11535TS1502後昌路左楠路加昌路平日.xls",
    "11535TS1503高楠公路楠陽路水管路假日.xls",
  ]) {
    const found = check(name);
    assert.ok(found, `${name} 應讀得到調查日期`);
    assert.ok(
      found.conflicts?.length,
      `${name} 有兩個不同的調查日期，必須回報衝突`,
    );
  }
  /* 反面：只有一個日期的檔案不可以誤報 */
  const clean = check("14013TS601鳳北路平日.xlsx");
  assert.ok(clean, "應讀得到調查日期");
  assert.ok(!clean.conflicts, "只有一個日期時不可誤報衝突");
});

test("矛盾日期要寫進預覽的提示文字", () => {
  assert.match(
    appSource,
    /surveyDateFound\?\.conflicts\?\.length/,
    "conflictNote 要涵蓋日期衝突",
  );
  assert.match(appSource, /這份檔案有兩個不同的調查日期/);
});

/* ── H5：合併路段時的速限版本 ── */

test("合併路段不得讓來源的速限版本蓋掉目標路段既有的紀錄", () => {
  /*
   * speedFor() 挑版本的規則是「開始季度較新者優先，相同時取後建立的 id」，
   * 所以來源路段的版本只要開始季度不早於目標路段的，就會蓋過目標路段
   * **原本就有、而且不在這次合併範圍內**的紀錄。實測目標路段一筆紀錄的
   * LOS 由 A 變成 D，而確認對話框只統計來源路段的列數，完全不會提到。
   * 手動新增版本時 saveSpeedVersion() 對重疊是會跳確認的，這條路徑不能更寬鬆。
   */
  const F = loadAppFunctions(["mergeSpeedVersions"]);
  const state = {
    speedVersions: {
      "P|路段B|方向1": [{ id: "SV1000", start: "115Q1", end: "", speed: 40 }],
      "P|路段A|方向1": [{ id: "SV2000", start: "115Q1", end: "", speed: 70 }],
    },
  };
  const result = F.mergeSpeedVersions(state, "P|路段A|方向1", "P|路段B|方向1");
  assert.equal(result.skipped.length, 1, "重疊的版本要被擋下並回報");
  assert.equal(result.moved, 0, "重疊的版本不可併入");
  assert.deepEqual(
    state.speedVersions["P|路段B|方向1"].map((v) => v.speed),
    [40],
    "目標路段既有的速限必須原封不動",
  );
  assert.equal(state.speedVersions["P|路段A|方向1"], undefined, "來源鍵要清掉");

  /* 不重疊的版本仍要正常搬過去，否則整組查證紀錄會變成孤兒 */
  const state2 = {
    speedVersions: {
      "P|路段B|方向1": [{ id: "SV1000", start: "115Q1", end: "115Q2", speed: 40 }],
      "P|路段A|方向1": [{ id: "SV2000", start: "115Q3", end: "", speed: 70 }],
    },
  };
  const r2 = F.mergeSpeedVersions(state2, "P|路段A|方向1", "P|路段B|方向1");
  assert.equal(r2.moved, 1, "不重疊的版本要搬過去");
  assert.equal(r2.skipped.length, 0);
  assert.deepEqual(
    state2.speedVersions["P|路段B|方向1"].map((v) => v.speed),
    [40, 70],
  );
});

test("兩處合併路徑都要用同一支函式，且會把略過的版本告訴使用者", () => {
  assert.doesNotMatch(
    appSource,
    /state\.speedVersions\[newLimit\] = \(state\.speedVersions\[newLimit\] \|\| \[\]\)\.concat\(/,
    "不可以再直接 concat，那會略過重疊檢查",
  );
  assert.equal(
    (appSource.match(/mergeSpeedVersions\(state, oldLimit, newLimit\)/g) ?? []).length,
    2,
    "applyRoadChange 與日期尾碼合併兩處都要用同一支函式",
  );
  assert.match(appSource, /未併入/, "略過的版本要出現在給使用者的訊息裡");
});

/* ── 季度：民國與西元都收，但一律存成民國年 ── */

test("normalizeSurveyPeriod 把西元季度換算成民國年", () => {
  /*
   * 三支系統的季度輸入都同時接受民國與西元，但寫進資料時一定要統一，
   * 否則同一季會因為打字寫法不同而變成兩個不同的鍵：季度清單是以字串
   * 分組的，115Q1 與 2026Q1 會並列成兩季、歷季比較被拆成兩段，
   * 而且永遠不會合併——兩者的排序鍵完全相同，所以會相鄰出現，
   * 看起來只像「同一季出現兩次」，很難聯想到是寫法問題。
   */
  const N = box.PeriodDate.normalizeSurveyPeriod;
  assert.equal(N("2026Q1"), "115Q1");
  assert.equal(N("2025Q4"), "114Q4");
  assert.equal(N("115Q1"), "115Q1", "民國年原樣保留");
  assert.equal(N("2026q1"), "115Q1", "小寫 q 也要認");
  assert.equal(N("  115Q1  "), "115Q1", "前後空白要去掉");
  /* 認不得的原樣回傳，交給呼叫端的格式驗證去擋，這裡不猜 */
  assert.equal(N("abc"), "abc");
  assert.equal(N(""), "");
  assert.equal(N("115年1月"), "115年1月", "月份期別不是季度欄位的格式");
});

test("年份輸入同時接受民國與西元，且換算成民國年", () => {
  /*
   * 舊版的輸入框是 min=90 max=200 的「民國年」，打西元被擋掉，
   * 拿到西元年標示的委託案時只能自己換算。另外兩支系統早就兩種都收。
   */
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.doesNotMatch(
    html,
    /id="rocYear"[^>]*max="200"/,
    "年份輸入框仍限制在民國 200 以內",
  );
  assert.match(html, /id="rocYear"[^>]*max="2111"/);
  assert.match(html, /id="yearHint"/, "要有即時提示說明會存成什麼");

  const block = appSource.slice(
    appSource.indexOf('$("preview").onclick'),
    appSource.indexOf('$("preview").disabled = true'),
  );
  assert.match(block, /yearNumber >= 2001 && yearNumber <= 2111/, "要接受西元年");
  assert.match(block, /yearNumber >= 90 && yearNumber <= 200/, "民國年範圍檢查要保留");
  assert.match(
    block,
    /String\(isAdYear \? yearNumber - 1911 : yearNumber\)/,
    "寫入前要換算成民國年",
  );
  /* 範圍檢查不可以拿掉——打錯成 1145 會產生一個比對不到的幽靈季度 */
  assert.match(block, /Number\.isInteger\(yearNumber\)/);
});

test("季度排序鍵要認得四碼西元年", () => {
  /*
   * 寫入路徑已經一律正規化成民國年，但備份還原、手動編輯過的資料與外部
   * 匯入都可能帶進四碼寫法。舊版只認 2～3 碼，四碼回 -1 會排到最前面。
   * 另外兩支的 quarterOrderKey() 一直是認到四碼的。
   */
  const q = readFileSync(new URL("./quality-extension.js", import.meta.url), "utf8");
  const src = q.slice(q.indexOf("const periodKey = (v) =>"), q.indexOf("const ordered ="));
  const periodKey = new Function(src + "\nreturn periodKey;")();
  assert.equal(periodKey("115Q1"), periodKey("2026Q1"), "同一季的兩種寫法排序鍵要相同");
  assert.equal(periodKey("114Q4"), periodKey("2025Q4"));
  assert.ok(periodKey("115Q1") > periodKey("114Q4"), "季度先後不得改變");
  assert.equal(periodKey("abc"), -1, "認不得仍回 -1");

  const F = loadAppFunctions(["validPeriod", "periodIndex"]);
  assert.equal(F.validPeriod("2026Q1"), true, "主程式的季度驗證要接受西元年");
  assert.equal(F.periodIndex("115Q1"), F.periodIndex("2026Q1"), "主程式排序鍵要把同季視為同一季");
  assert.ok(F.periodIndex("2026Q1") > F.periodIndex("2025Q4"), "主程式排序要維持季度先後");

  const xl = readFileSync(new URL("./excel-export.js", import.meta.url), "utf8");
  const orderSrc = xl.match(/function periodOrder\(value\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(orderSrc, "應能從 Excel 匯出元件取出季度排序函式");
  const periodOrder = new Function(orderSrc + "\nreturn periodOrder;")();
  assert.equal(periodOrder("115Q1"), periodOrder("2026Q1"), "Excel 匯出排序鍵要把同季視為同一季");
  assert.ok(periodOrder("2026Q1") > periodOrder("2025Q4"), "Excel 匯出要維持季度先後");
});

/* ── 民國／西元顯示切換 ── */

test("quarterInYearStyle 兩種寫法可以互轉，且不動到認不得的字串", () => {
  const { quarterInYearStyle } = box.PeriodDate;
  for (const [roc, ad] of [
    ["115Q1", "2026Q1"],
    ["114Q4", "2025Q4"],
    ["99Q2", "2010Q2"], /* 民國 99 在 90～200 之內，換成西元是 2010 */
    ["100Q3", "2011Q3"],
    ["113Q2", "2024Q2"],
  ]) {
    assert.equal(quarterInYearStyle(roc, "ad"), ad, `${roc} → 西元`);
    assert.equal(quarterInYearStyle(ad, "roc"), roc, `${ad} → 民國`);
    /* 來回一趟要回到原點，否則切兩次畫面就對不上了 */
    assert.equal(quarterInYearStyle(quarterInYearStyle(roc, "ad"), "roc"), roc);
  }
  /* 認不得的字串一律原樣回傳：健康檢查的「全部」、空字串、亂填的都不能被改掉 */
  for (const odd of ["全部", "", "115", "115Q5", "115年2、3月", "abc"])
    assert.equal(quarterInYearStyle(odd, "ad"), odd, `「${odd}」不可被改寫`);
});

test("periodDisplayLabel 的月份寫法也跟著年份切換", () => {
  const { periodDisplayLabel } = box.PeriodDate;
  const dates = ["2026-02-11", "2026-03-04"];
  assert.equal(periodDisplayLabel("115Q1", dates, "month", "roc"), "115年2、3月");
  assert.equal(periodDisplayLabel("115Q1", dates, "month", "ad"), "2026年2、3月");
  assert.equal(periodDisplayLabel("115Q1", [], "month", "ad"), "2026Q1");
  /* 不傳 yearStyle 時要維持舊行為（民國年），否則既有呼叫端會整批改掉 */
  assert.equal(periodDisplayLabel("115Q1", dates, "month"), "115年2、3月");
  assert.equal(periodDisplayLabel("115Q1", [], "quarter"), "115Q1");
});

test("切換鈕存在，而且切換只換文字、不換篩選值", () => {
  assert.match(appSource, /yearStyleButton\.dataset\.testid = "year-style-toggle"/,
    "要有年份顯示切換鈕");
  assert.match(appSource, /yearStyle: "roc"/, "預設是民國年");
  /*
   * ⚠️ 2026-09-13 起 showQuarter 多了第二個參數（計畫代碼），
   *   而且要同時套上「年份寫法」與「期別寫法」兩層——
   *   使用者回報「期別顯示調查月份……只有成功變成西元年，沒有變成調查月份」。
   *   這裡連帶驗它**真的走了兩層**（委派給 projectPeriodLabel），
   *   只驗「函式存在」的話，把它改回只換年份照樣會綠。
   */
  assert.match(
    appSource,
    /function showQuarter\(period, projectCode = state\.activeCode\)/,
    "要有統一的顯示換字函式（第二個參數是計畫代碼）",
  );
  assert.match(
    appSource,
    /function showQuarter\([^)]*\)\s*\{\s*return projectPeriodLabel\(/,
    "showQuarter 必須同時套上年份與期別兩層（委派給 projectPeriodLabel）",
  );
  /*
   * ⚠️ 反面：map(showQuarter) 會把陣列索引當成計畫代碼傳進去，
   *   查不到明細就安靜地退回季別寫法——我自己踩過這個坑。
   */
  assert.doesNotMatch(
    appSource,
    /\.map\(showQuarter\)/,
    "不可以寫 list.map(showQuarter)：索引會被當成計畫代碼",
  );
  /*
   * 下拉選單的 value 一定要是儲存值。舊寫法是 `<option ${selected}>${safe(x)}</option>`
   * ——沒有 value，文字就是值；文字一換成西元年，成果範圍與品質篩選立刻挑不到
   * 任何一筆資料。這三處都必須明寫 value。
   */
  const quality = readFileSync(new URL("./quality-extension.js", import.meta.url), "utf8");
  assert.match(
    quality,
    /`<option value="\$\{safe\(x\)\}" \$\{x === value \? "selected" : ""\}>\$\{safe\(showQuarter\(x\)\)\}<\/option>`/,
    "成果交付的季度選單要 value=儲存值、文字=顯示值",
  );
  assert.match(
    quality,
    /`<option value="\$\{safe\(x\)\}" \$\{x === value \? "selected" : ""\}>\$\{safe\(label\(x\)\)\}<\/option>`/,
    "結論草稿的季度／年度選單要 value=儲存值、文字=顯示值",
  );
  assert.match(
    appSource,
    /`<option value="\$\{esc\(v\)\}"\$\{v === keep \? " selected" : ""\}>\$\{esc\(label\(v\)\)\}<\/option>`/,
    "品質總覽的季度選單要 value=儲存值、文字=顯示值",
  );
  /*
   * 反面也要擋：把顯示文字塞進 value 一樣會讓篩選落空。
   * 只檢查「有沒有 value」還不夠——寫成 value=顯示值就繞過去了。
   */
  assert.doesNotMatch(
    quality,
    /<option value="\$\{safe\(showQuarter\(/,
    "季度選單的 value 不可以是顯示文字",
  );
  assert.doesNotMatch(
    appSource,
    /<option value="\$\{esc\(showQuarter\(/,
    "季度選單的 value 不可以是顯示文字",
  );
  /*
   * 草稿的儲存鍵不可以跟著顯示切換走，否則切一次就找不到之前存的草稿。
   *
   * ⚠️ 2026-09-15 起這個鍵多了「方向｜尖峰」兩段（報告文字草稿新增了那兩個
   *   條件，不同條件下的草稿不可以互相蓋掉）。所以這裡不再比對整行字面，
   *   改成守**不變量**本身：
   *     ① 基底一定是 `計畫代碼 | deliveryRange().label`（兩個都是儲存值）
   *     ② draftKey() 裡**不可以**出現任何顯示換字函式
   *   只比字面的話，任何合理的擴充都會紅，而真正的錯（把顯示值塞進鍵）
   *   反而可以繞過去。
   */
  assert.match(
    quality,
    /const base = `\$\{state\.activeCode\}\|\$\{deliveryRange\(\)\.label\}`/,
    "草稿鍵的基底必須是「計畫代碼｜deliveryRange().label」（都是儲存值）",
  );
  const draftKeyBody = quality.slice(
    quality.indexOf("function draftKey()"),
    quality.indexOf("let draftDirty"),
  );
  assert.ok(draftKeyBody.length > 0, "找得到 draftKey()");
  assert.doesNotMatch(
    draftKeyBody,
    /showQuarter|projectPeriodLabel|quarterInYearStyle/,
    "草稿的儲存鍵裡不可以出現任何顯示換字函式",
  );
  assert.match(quality, /label: start === end \? start : `\$\{start\}-\$\{end\}`/,
    "deliveryRange().label 必須維持儲存值");

  /* 所有使用者看得到的季度提示都要經過同一個顯示函式。 */
  /* ⚠️ 2026-09-13 改寫成箭頭函式（見上面「不可以直接交給 map」那一條）。 */
  assert.match(
    appSource,
    /impact\.periods\.map\(\(x\) => showQuarter\(x\)\)\.join\("、"\)/,
    "路段合併預覽的影響季度要跟著切換",
  );
  assert.match(appSource, /showQuarter\(batch\.period\)/,
    "刪除季度復原提示要跟著切換");
  assert.doesNotMatch(appSource, /detail: `相較 \$\{prev\.period\}/,
    "健康檢查的說明不可直接印出儲存值");
  assert.match(quality, /range\.periods\.map\(\(x\) => showQuarter\(x\)\)\.join\("、"\)/,
    "成果草稿的季度清單要跟著切換");
  assert.doesNotMatch(quality, /`較 \$\{prev\.period\}/,
    "結論草稿的前期季度不可直接印出儲存值");
  assert.doesNotMatch(quality, /detail: `相較 \$\{prev\.period\}/,
    "擴充健康檢查的說明不可直接印出儲存值");
});

test("匯出跟著切換：Excel 的季度欄與圖表類別軸都走顯示文字，排序仍走儲存值", () => {
  const xl = readFileSync(new URL("./excel-export.js", import.meta.url), "utf8");
  assert.match(xl, /globalThis\.periodExportLabel/, "要有顯示文字的掛勾");
  assert.match(xl, /textCell\(`C\$\{row\}`, p\.label \?\? p\.period\)/, "儲存格寫顯示文字");
  assert.match(xl, /cats = block\.periods\.map\(\(x\) => x\.label \?\? x\.period\)/,
    "圖表類別軸要與儲存格一致，否則兩邊會寫出不同的季度");
  /* 排序仍必須走儲存值：periodOrder 吃的是 period，不是 label */
  assert.match(xl, /periodOrder\(a\.period\) - periodOrder\(b\.period\)/);
  /* CSV 只換季度欄 */
  const quality = readFileSync(new URL("./quality-extension.js", import.meta.url), "utf8");
  assert.match(quality, /k === "period" \? showQuarter\(x\[k\]\) : x\[k\]/);
});

test("結論草稿的換字是可選的，不傳就維持舊輸出", async () => {
  const src = readFileSync(new URL("./conclusion.js", import.meta.url), "utf8");
  assert.match(src, /typeof m\.showPeriod === "function"/, "showPeriod 要是可選的");
  /* 篩選與排序一律走儲存值，不可以改成顯示值 */
  assert.match(src, /if \(scope\.kind === "quarter"\) return row\.period === scope\.quarter;/);
  assert.match(src, /periodKey\(a\.period\) - periodKey\(b\.period\)/);

  /*
   * 實際跑一遍。三種分段方式都要跑到：期別是從好幾條不同的路徑寫出來的
   *（scopeLabel、統計範圍、〔期別〕小標、季度分段標題、代表紀錄、季度變動），
   * 只跑預設的 byRoad 會漏掉其中一半——漏掉的那幾條就會在畫面上出現
   *「2026Q1 的表、115Q1 的內文」這種前後不一致。
   */
  /* conclusion.js 是 CommonJS，從 ESM 匯入時掛在 default 底下。 */
  const { buildSpeedConclusion, SPEED_DEFAULT_CONDITION } = (
    await import("./conclusion.js")
  ).default;
  const row = (period, travel, los) => ({
    period,
    road: "測試路段(甲路～乙路)",
    day: "平日",
    peak: "上午尖峰",
    direction: "方向1",
    directionLabel: "甲路口→乙路口",
    directionText: "甲路口至乙路口",
    travel,
    running: travel + 2,
    totalDelay: 40,
    limit: 50,
    ratio: travel / 50,
    los,
  });
  const rows = [row("114Q4", 32, "C"), row("115Q1", 28, "D")];
  const show = (v) => (v === "115Q1" ? "2026Q1" : v === "114Q4" ? "2025Q4" : v);
  const meta = { projectName: "測試計畫", systemVersion: "test", generatedAt: "2026-01-01 00:00" };
  for (const grouping of ["byRoad", "byPeriod", "overall"])
    for (const scope of [
      { kind: "quarter", quarter: "115Q1" },
      { kind: "range", from: "114Q4", to: "115Q1" },
      { kind: "project" },
    ]) {
      const condition = {
        ...SPEED_DEFAULT_CONDITION,
        scope,
        grouping,
        metrics: ["los", "travel", "totalDelay", "growth", "worst", "extremes"],
      };
      const roc = buildSpeedConclusion(rows, condition, meta);
      const ad = buildSpeedConclusion(rows, condition, { ...meta, showPeriod: show });
      const where = `${grouping}／${scope.kind}`;
      assert.doesNotMatch(roc, /所選條件沒有對應的資料/, `${where}：民國年寫法要挑得到資料`);
      assert.doesNotMatch(ad, /所選條件沒有對應的資料/, `${where}：換寫法仍要挑到同一批資料`);
      assert.ok(/11[45]Q[1-4]/.test(roc), `${where}：民國年版本本來就該出現期別字樣`);
      assert.doesNotMatch(ad, /11[45]Q[1-4]/, `${where}：草稿上不應再出現民國年寫法`);
      assert.match(ad, /20(?:25|26)Q[1-4]/, `${where}：草稿上要寫西元年`);
      assert.equal(
        ad.replaceAll("2026Q1", "115Q1").replaceAll("2025Q4", "114Q4"),
        roc,
        `${where}：換寫法之後除了期別字樣以外必須逐字相同（數字不可以有任何變化）`,
      );
    }
});

test("共用的季度輸入把關在獨立交付包內可完整驗證", () => {
  const { checkSurveyPeriodInput, surveyPeriodInputMessage } = box.PeriodDate;
  assert.equal(typeof checkSurveyPeriodInput, "function");
  assert.equal(typeof surveyPeriodInputMessage, "function");

  /* 民國 90～200 的每一季，兩種寫法都要放行且存成同一個民國年鍵 */
  for (let roc = 90; roc <= 200; roc += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const key = `${roc}Q${quarter}`;
      assert.deepEqual(checkSurveyPeriodInput(key), { ok: true, key });
      assert.deepEqual(checkSurveyPeriodInput(`${roc + 1911}Q${quarter}`), { ok: true, key });
    }
  }

  assert.match(surveyPeriodInputMessage("format"), /115Q2.*2026Q2/);
  assert.match(surveyPeriodInputMessage("range"), /90～200.*2001～2111/);
});

/* ── 三支共用的季度輸入行為契約（v2.20.30） ── */

test("季度輸入把關必須完全符合三支共用的行為契約", async () => {
  /*
   * 上一輪三支的 checkSurveyPeriodInput() 被改成三種不同寫法，而三支的守門
   * 測試都只驗自己那一份，所以沒有任何一支看得到分歧。這裡改成跑共用契約：
   * 契約檔在三支裡逐位元相同，任何一支的實作漂掉，就是它自己的測試紅。
   */
  const { runContract, CASES } = await import("./period-input-contract.mjs");
  assert.ok(CASES.length >= 50, "契約案例數異常，檔案可能被截斷");
  const problems = runContract(box.PeriodDate.checkSurveyPeriodInput, box.PeriodDate.normalizeSurveyPeriod);
  assert.deepEqual(problems, [], "與共用行為契約不符：\n" + problems.join("\n"));
});

test("行為契約檔本身必須與另外兩支逐位元相同", async () => {
  /*
   * 三支各自釘同一個 SHA-256。只改一支的契約檔，那一支就會紅；
   * 要改行為就得三支的契約檔一起改、雜湊一起換——這正是我們要的。
   * 用雜湊而不是跨包引用檔案，交付包才能解壓後獨立執行。
   */
  const { createHash } = await import("node:crypto");
  const bytes = readFileSync(new URL("./period-input-contract.mjs", import.meta.url));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "638f2b48ed3d7e24e7c605314eb2149f3cc5c07865f69a99d8c767a52945fe75",
    "行為契約檔與另外兩支不同步；三支必須是同一份檔案",
  );
});

test("「要編輯的計畫」不得再叫「目前計畫」，且不一致時要當場說明", () => {
  assert.doesNotMatch(appSource, /'目前計畫<select id="projectPicker">/);
  assert.match(appSource, /'要編輯的計畫<select id="projectPicker">/);
  assert.match(appSource, /projectScopeHint/);
  assert.match(
    appSource,
    /const mismatched = Boolean\(active && code && exists && code !== active\.code\)/,
  );
  assert.match(appSource, /目前作用中的是「\$\{active\.code\} \$\{active\.name\}」/);
  assert.match(appSource, /這張表單編輯的是「\$\{code\}」/);

  const picker = appSource.slice(
    appSource.indexOf('$("projectPicker").onchange'),
    appSource.indexOf("const deleteProjectBtn"),
  );
  assert.match(picker, /renderProjectSetupActions\(\)/);
  assert.doesNotMatch(picker, /state\.activeCode\s*=/);
  assert.match(
    appSource,
    /projectSwitch\.onchange = async \(\) => \{\s*\n\s*state\.activeCode = projectSwitch\.value;/,
  );
});

/* ── F-3：路段有效期間**已整組移除**（2026-09-15） ── */

test("路段有效期間必須真的被移除，不可以只是藏起來", () => {
  /*
   * 使用者 2026-09-15 定案（原話）：
   *   「不管是哪個程式，其實都是從檔案中匯入去抓取，**沒抓到＝沒資料了**，
   *     可能是整個停止監測，也可能是暫時停止監測幾季，不論哪個情況，
   *     使用者可能都會忘記回報。所以我偏向程式直接以有沒匯入去判斷就好，
   *     沒匯入＝沒資料，篩選某季時，沒資料的路段就不顯示……
   *     三份程式都已經有『前季有但本季沒有的路段』的異常提醒了，
   *     就足夠應付狀況了。」
   *
   * ⚠️ 這一條**取代**了原本三條 F-3（輸入把關、界線退化、載入正規化）。
   *   那三條守的是這個功能怎麼做對，功能不存在之後留著它們只會擋住刪除。
   *
   * ⚠️ 為什麼要有一條「已經刪掉」的守門：這個功能的欄位散在
   *   roadMeta、migrate、路段合併、品質總覽、清冊六個地方，
   *   刪一半是最可能的結果——留下一個沒有畫面可以編輯、卻仍在篩資料的欄位，
   *   那比不刪更糟。
   */
  for (const name of [
    "roadIsActive",
    "periodBoundIndex",
    "canonicalPeriod",
    "roadObservedPeriods",
    "saveRoadPeriod",
    "roadStartPeriod",
    "roadEndPeriod",
    "periodRoad",
  ]) {
    /* 註解裡提到名字是可以的（那是在說「已經移除、不要加回來」）。 */
    const code = appSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      new RegExp(name),
      `app.js 仍然有 ${name}——路段有效期間沒有刪乾淨`,
    );
  }
  assert.doesNotMatch(
    appSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    /startPeriod|endPeriod/,
    "app.js 仍然在讀寫 roadMeta 的 startPeriod／endPeriod",
  );
});

test("拿掉有效期間之後，「日別不完整」不可以對整季沒資料的路段報警", () => {
  /*
   * ⚠️ 這是移除有效期間時**最容易漏掉**的一步，而且漏掉不會有任何錯誤訊息。
   *
   *   「日別不完整」那一段是「全部季度 × 全部路段」的交叉迴圈，
   *   舊版靠 roadIsActive() 把「這一季本來就沒有這條路」的組合擋掉。
   *   直接把那一行刪掉、不補替代條件的話，一個分階段施工的計畫
   *  （開工前調查 100 條、第一階段只調查其中 80 條）會在第一階段的每一季
   *   各冒出 20 條假警報——使用者要的正好相反。
   *
   *   正確的替代是「這一季這條路段完全沒資料就跳過」：只報
   *   「匯了平日卻漏了假日」這種真的漏了一半的情形。
   */
  const block = appSource.slice(
    appSource.indexOf("const periods = projectPeriods(),"),
    appSource.indexOf("const limitKeys = new Map();"),
  );
  assert.ok(block.length > 200, "找不到「日別不完整」那一段");
  assert.match(
    block,
    /if \(!days\.size\) continue;/,
    "整季沒有資料的路段必須跳過，不可以報成「日別不完整」",
  );
  assert.doesNotMatch(block, /roadIsActive/, "不可以再用有效期間判斷");
  assert.doesNotMatch(
    block,
    /有效期間內沒有平日及假日資料/,
    "那一句說明是有效期間時代的寫法，功能移除後不可以留著",
  );
});
