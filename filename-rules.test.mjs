/*
 * ── 檔名規則：不確定就不要猜 ──
 *
 * 這支系統的路段名稱與平日／假日兩個欄位完全取自檔名，而且兩個都是資料
 * 識別鍵的一部分（id 由 計畫|年|季|路段|日別|尖峰|方向 組成）。
 *
 * 舊版的判讀失敗一律靜默給預設值：
 *   ・`name.includes("假日") ? "假日" : "平日"` —— 檔名任何位置有「假日」
 *     就贏，於是 `假日路口段-平日.xlsx` 被判成假日；兩個字都沒有時一律當平日。
 *   ・路段名稱切不出來時回傳空字串也照樣放行。
 *
 * 同一支程式對活頁簿內容的態度完全相反（讀不到兩個調查方向時寧可報錯，
 * 註解還寫明「系統不會猜測哪兩個才是調查方向」）。這組測試把同樣的標準
 * 套用到檔名這條路徑上。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* app.js 是瀏覽器端腳本，這裡只把要測的純函式取出來執行。 */
const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `找不到函式 ${name}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0)
      return source.slice(start, i + 1);
  }
  throw new Error(`函式 ${name} 括號不成對`);
}
const scope = {};
new Function(
  `${extract("normalize")}${extract("stripRoadSuffix")}${extract("roadFromFile")}${extract("dayFromFile")}
   this.roadFromFile = roadFromFile; this.dayFromFile = dayFromFile;`,
).call(scope);
const { roadFromFile, dayFromFile } = scope;

test("平假日只認檔名結尾的標記，路段名稱裡的字樣不得誤判", () => {
  assert.equal(dayFromFile("99999TS1-01-測試路段-平日.xlsx"), "平日");
  assert.equal(dayFromFile("99999TS1-01-測試路段-假日.xlsx"), "假日");
  /* 這一筆是舊版的實際錯誤：路段名稱含「假日」，結果整筆被當成假日 */
  assert.equal(
    dayFromFile("假日路口段-平日.xlsx"),
    "平日",
    "路段名稱裡的「假日」不可以蓋掉結尾的「平日」",
  );
  assert.equal(dayFromFile("假日路口段-假日.xlsx"), "假日");
});

test("瀏覽器重複下載加上的 (1) 不影響平假日判讀", () => {
  assert.equal(dayFromFile("測試路段-平日 (1).xlsx"), "平日");
  assert.equal(dayFromFile("測試路段-假日(2).xlsx"), "假日");
  assert.equal(dayFromFile("測試路段-平日_114.0210.xlsx"), "平日");
});

test("判斷不出平假日時回傳空字串，不得預設平日", () => {
  assert.equal(dayFromFile("測試路段.xlsx"), "", "沒有標記時不可以預設平日");
  assert.equal(
    dayFromFile("假日路口段.xlsx"),
    "",
    "路段名稱中的「假日」不是尾端日別標記，不可以拿來猜日別",
  );
  assert.equal(
    dayFromFile("平日市場聯外道路.xlsx"),
    "",
    "路段名稱中的「平日」不是尾端日別標記，不可以拿來猜日別",
  );
  assert.equal(
    dayFromFile("平日與假日對照表.xlsx"),
    "",
    "兩個都出現時不可以擇一",
  );
  assert.equal(dayFromFile("114Q1.xlsx"), "");
});

test("表頭與檔名衝突時，寫入前必須產生二次確認訊息", () => {
  const scope4 = {};
  new Function(
    `${extract("sourceConflictPrompt")}this.sourceConflictPrompt = sourceConflictPrompt;`,
  ).call(scope4);
  const none = scope4.sourceConflictPrompt([
    { ok: true, file: "一致.xlsx", dayConflict: false, roadConflict: false },
  ]);
  assert.equal(none, "", "來源一致時不應多問一次");
  const prompt = scope4.sourceConflictPrompt([
    {
      ok: true,
      file: "衝突.xlsx",
      dayConflict: true,
      roadConflict: false,
      conflictNote: "表頭寫平日、檔名寫假日",
    },
  ]);
  assert.match(prompt, /衝突\.xlsx/);
  assert.match(prompt, /表頭寫平日、檔名寫假日/);
  assert.match(prompt, /採用工作表表頭/);
  assert.match(prompt, /確定仍要寫入/);
});

test("Manager 匯入不可靜默略過格式正確但不是 Project 專案包的 JSON", () => {
  assert.match(
    source,
    /packs\.some\(\(pack\) => pack\.kind !== "TLM_PROJECT_PACKAGE" \|\| !pack\.project\?\.code\)/,
  );
  assert.match(source, /throw new Error\("不是有效的 Project 專案包"\)/);
});

test("路段名稱：正常格式仍照舊切掉案號與平假日字尾", () => {
  assert.equal(
    roadFromFile("99999TS1-01-測試路段(甲路～乙路)-平日.xlsx"),
    "測試路段(甲路～乙路)",
  );
  assert.equal(
    roadFromFile("13545TS9-11-中正一路-假日.xls"),
    "中正一路",
  );
});

test("路段名稱切不出來時回傳空字串，由呼叫端擋下並提示改檔名", () => {
  assert.equal(roadFromFile("平日.xlsx"), "");
});

/*
 * ── 使用者實際看到的錯誤訊息 ──
 *
 * 這一條原本是 `assert.match(source, /找不到「站名：」欄位/)`——只驗「原始碼裡
 * 有這串字」。字串確實在，但 `catch` 區塊讀的是 `e.name`（恆為 "Error"）而不是
 * `e.message`，於是每一種失敗都被顯示成「檔案無法開啟或格式不支援」，
 * 連原型污染的安全中止訊息都被降級。測試全綠，缺陷照樣在。
 * 現在改成驗真正的行為：把錯誤丟進同一段邏輯，看使用者會看到什麼。
 */
function userVisibleError(error) {
  /* 取出 app.js 裡真正的那兩行判斷與那個三元式，不在測試裡重寫一份 */
  const decl = source.match(
    /const detail = String\(e\?\.message[\s\S]*?const changed = [\s\S]*?\);/,
  );
  assert.ok(decl, "找不到 detail／changed 的宣告");
  const branch = source.match(/error: changed\n([\s\S]*?),\n\s*\}\);/);
  assert.ok(branch, "找不到錯誤訊息的三元式");
  const expr = "changed" + branch[1];
  return new Function("e", `${decl[0]}\nreturn (${expr});`)(error);
}

test("丟出的錯誤訊息要原樣傳給使用者，不能被吞成「格式不支援」", () => {
  const message =
    "工作表表頭找不到「站名：」欄位，檔名也讀不出路段名稱。請確認調查表表頭有站名";
  assert.equal(userVisibleError(new Error(message)), message);
});

test("原型污染的安全中止訊息不可被降級", () => {
  const message =
    "「x.xlsx」在解析過程中試圖修改瀏覽器的內建物件，本次匯入已中止，系統資料沒有變動。";
  assert.equal(userVisibleError(new Error(message)), message);
});

test("檔案在選取後被修改，仍走專用的說明", () => {
  const err = Object.assign(new Error("The requested file could not be read"), {
    name: "NotReadableError",
  });
  assert.match(userVisibleError(err), /重新選取一次檔案/);
});

test("完全沒有訊息時才退回通用說明", () => {
  assert.match(userVisibleError(new Error("")), /檔案無法開啟或格式不支援/);
});

test("名稱看起來沒切乾淨時要攔下來問，即使計畫裡還沒有既有路段", () => {
  const scope2 = {};
  new Function(`${extract("suspiciousRoadName")}
     this.suspiciousRoadName = suspiciousRoadName;`).call(scope2);
  const { suspiciousRoadName } = scope2;
  /* 這幾種都是舊版會靜靜長出幽靈路段的實際案例 */
  assert.ok(suspiciousRoadName(""), "空白名稱要攔");
  assert.ok(
    suspiciousRoadName("13545-TS1-01-中正路"),
    "案號沒切掉要攔（中間多一個符號就切不掉）",
  );
  assert.ok(suspiciousRoadName("複本-99999TS1-01-測試路段"), "複本前綴要攔");
  assert.ok(suspiciousRoadName("測試路段(甲路～乙路)-平日(1)"), "(1) 流水號要攔");
  assert.ok(suspiciousRoadName("114Q1"), "只有季度字樣要攔");
  /* 正常名稱不可以被攔，否則每次匯入都要多按一輪確認 */
  assert.equal(suspiciousRoadName("中正一路(甲街～乙街)"), "");
  assert.equal(suspiciousRoadName("測試路段(甲路～乙路)"), "");
  assert.equal(suspiciousRoadName("台1線"), "");
});

test("預覽必須印出實際取到的路段名稱", () => {
  assert.doesNotMatch(
    source,
    /"使用目前正式名稱"/,
    "全新計畫根本沒有「目前正式名稱」，這句話會讓使用者看不到系統實際取到什麼",
  );
  assert.match(source, /路段：\$\{esc\(x\.road\)\}/);
});


/*
 * ── 內容優先：能從檔案讀到的，就不要猜檔名 ──
 *
 * 使用者實際的檔案叫 `TS1401_平日.xlsx`，舊版從檔名切出來的「路段名稱」是
 * `TS1401_`（案號沒切掉、還帶一個尾底線）。但調查表表頭本來就寫著
 * 「站　　名：台1(中山南路~中山路/國昌路/民強街)」與「日　期：…(平日)」——
 * 資訊一直都在檔案裡，只是沒去讀。
 */
test("路段名稱優先讀調查表表頭的「站名：」欄位", () => {
  const scope3 = {};
  /* 巢狀樣板字串會讓 new Function 解析失敗，這裡一律用字串相接。 */
  const stubXlsx =
    "var XLSX = { utils: {" +
    "  decode_range: function () { return { s: { r: 0, c: 0 }, e: { r: 5, c: 2 } }; }," +
    "  encode_cell: function (a) { return a.r + ',' + a.c; }" +
    "} };";
  new Function(
    stubXlsx +
      extract("normalize") +
      extract("stripRoadSuffix") +
      extract("headerTextsOf") +
      extract("roadFromWorkbook") +
      extract("dayFromWorkbook") +
      "this.roadFromWorkbook = roadFromWorkbook;" +
      "this.dayFromWorkbook = dayFromWorkbook;",
  ).call(scope3);
  const { roadFromWorkbook, dayFromWorkbook } = scope3;
  /* 仿造一份只有表頭的活頁簿，格式照實際調查表 */
  const book = {
    SheetNames: ["上午"],
    Sheets: {
      上午: {
        "!ref": "A1:C6",
        "2,0": { v: "站　　名：台1(中山南路~中山路/國昌路/民強街)" },
        "2,1": { v: "日    期：115年01月26日(平日)" },
      },
    },
  };
  assert.equal(
    roadFromWorkbook(book),
    "台1(中山南路～中山路/國昌路/民強街)",
    "應讀出表頭的站名，而不是回去猜檔名",
  );
  assert.equal(dayFromWorkbook(book), "平日");
});

test("表頭讀不到時才退回檔名，且兩種來源都要記錄下來", () => {
  assert.match(source, /roadFromContent \|\| roadFromName/, "必須內容優先、檔名備援");
  assert.match(source, /dayFromContent \|\| dayFromName/);
  assert.match(source, /roadSource = roadFromContent \?/);
  assert.match(source, /daySource = dayFromContent \?/);
});

test("預覽要分辨名稱是讀自內容還是猜自檔名", () => {
  assert.match(source, /皆讀自調查表表頭/);
  assert.match(source, /路段名稱取自\$\{esc\(x\.roadSource/);
});


/*
 * ── 用真的 xlsx 驗表頭讀取 ──
 *
 * 先前這一組用手寫的 XLSX stub（decode_range 寫死、encode_cell 回 "r,c"），
 * 因此掃描列數、多工作表取捨、站名值的貪婪比對、製表日期干擾一律測不到。
 * 這裡改用 vendor 的真 SheetJS 建活頁簿。
 */
import { createRequire } from "node:module";
const XLSX = createRequire(import.meta.url)("./vendor/xlsx.full.min.js");

function headerBook(cells) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cells), "上午");
  return XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), {
    type: "array",
  });
}
function headerScope() {
  const scope = {};
  new Function(
    "XLSX",
    extract("normalize") +
      extract("stripRoadSuffix") +
      extract("headerTextsOf") +
      extract("roadFromWorkbook") +
      extract("dayFromWorkbook") +
      "this.roadFromWorkbook = roadFromWorkbook;" +
      "this.dayFromWorkbook = dayFromWorkbook;",
  ).call(scope, XLSX);
  return scope;
}

test("真 xlsx：站名讀得到，全形空白與半形冒號都支援", () => {
  const { roadFromWorkbook } = headerScope();
  assert.equal(
    roadFromWorkbook(headerBook([["站　　名：台1(中山南路~中山路/國昌路/民強街)"]])),
    "台1(中山南路～中山路/國昌路/民強街)",
  );
  assert.equal(
    roadFromWorkbook(headerBook([["站名:中正路(甲街～乙街)"]])),
    "中正路(甲街～乙街)",
  );
});

test("真 xlsx：站名與其他欄位排在同一格時，不可把後面整串吃進來", () => {
  const { roadFromWorkbook } = headerScope();
  /* 合併儲存格的表頭很常見。吃進來就會無聲長出一個幽靈路段。 */
  assert.equal(
    roadFromWorkbook(headerBook([["站名：中正路(甲街～乙街)  方向：北往南"]])),
    "中正路(甲街～乙街)",
  );
  assert.equal(
    roadFromWorkbook(headerBook([["站名：中正路(甲街～乙街)　備註：本季新增"]])),
    "中正路(甲街～乙街)",
  );
});

test("真 xlsx：表頭來的名稱也要剝掉案號，否則同一路段會被拆成兩個", () => {
  const { roadFromWorkbook } = headerScope();
  assert.equal(
    roadFromWorkbook(headerBook([["站名：99999TS1-01-中正路(甲街～乙街)"]])),
    "中正路(甲街～乙街)",
  );
});

test("真 xlsx：不是站名的標籤不可誤抓", () => {
  const { roadFromWorkbook } = headerScope();
  for (const text of ["測站名稱：中正路", "調查站名稱說明", "路線：中正路"])
    assert.equal(roadFromWorkbook(headerBook([[text]])), "", `不該抓：${text}`);
});

test("真 xlsx：平假日要排除「製表日期」這類非調查日期", () => {
  const { dayFromWorkbook } = headerScope();
  assert.equal(
    dayFromWorkbook(headerBook([["製表日期：115年3月1日(假日)"]])),
    "",
    "製表日期不是調查日期",
  );
  assert.equal(
    dayFromWorkbook(
      headerBook([["製表日期：115年3月1日(假日)"], ["日期：115年1月26日(平日)"]]),
    ),
    "平日",
    "有真正的調查日期時要用它",
  );
  assert.equal(
    dayFromWorkbook(headerBook([["日　　期：115年01月26日(平日)"]])),
    "平日",
  );
});
