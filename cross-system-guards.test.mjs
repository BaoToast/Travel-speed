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

const box = { XLSX, console };
box.window = box; box.globalThis = box; box.self = box;
new Function("window", "self", "globalThis", pdSource).call(box, box, box, box);

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
  assert.match(appSource, /function showQuarter\(period\)/, "要有統一的顯示換字函式");
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
  /* 草稿的儲存鍵不可以跟著顯示切換走，否則切一次就找不到之前存的草稿 */
  assert.match(quality, /return `\$\{state\.activeCode\}\|\$\{deliveryRange\(\)\.label\}`/);
  assert.match(quality, /label: start === end \? start : `\$\{start\}-\$\{end\}`/,
    "deliveryRange().label 必須維持儲存值");

  /* 所有使用者看得到的季度提示都要經過同一個顯示函式。 */
  assert.match(appSource, /impact\.periods\.map\(showQuarter\)\.join\("、"\)/,
    "路段合併預覽的影響季度要跟著切換");
  assert.match(appSource, /showQuarter\(batch\.period\)/,
    "刪除季度復原提示要跟著切換");
  assert.doesNotMatch(appSource, /detail: `相較 \$\{prev\.period\}/,
    "健康檢查的說明不可直接印出儲存值");
  assert.match(quality, /range\.periods\.map\(showQuarter\)\.join\("、"\)/,
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
