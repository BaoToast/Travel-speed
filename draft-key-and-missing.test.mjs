/*
 * ══════════════════════════════════════════════════════════════════════
 *  GPT 獨立複查（2026-09-24）在 v2.20.71 候選上抓到的兩件，永久釘住
 * ══════════════════════════════════════════════════════════════════════
 *
 * 兩件都是「程式與它自己的註解相反」——最難自己發現的一類。
 *
 * ① `draftKey()` 的向下相容只在「四個條件全空」時成立。
 *    註解宣稱「全部是預設值時維持舊格式，舊草稿照樣讀得回來」，
 *    但**只設方向（或只設尖峰）時鍵值也變了**：
 *    v2.20.68 存 `base|東向|`，v2.20.71 去找 `base|東向|||` → 找不到
 *    → 使用者看到的是「我存過的草稿不見了」。
 *
 * ② 報告文字草稿用 `Number.isFinite(Number(value))` 判斷有沒有值，
 *    而 `Number(null)` 與 `Number("")` 都是 **0**，於是讀不到的行駛速率或
 *    延滯分項被寫成「0」。同一段註解自己寫著「不可以寫 0——0 在這裡會被
 *    讀成『延滯是 0 秒』」。這一支程式在 safeConclusionDigits() 踩過同一個雷。
 *
 * ⚠️ 這兩支是**來源掃描**（quality-extension.js 直接讀 DOM，抽不出純函式），
 *   所以各自都配了對照斷言，掃不到東西時不會安靜通過。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./quality-extension.js", import.meta.url), "utf8");

/** 把 draftKey() 的函式本體抽出來（含註解，所以另外做無註解版）。 */
function draftKeyBody() {
  const start = source.indexOf("function draftKey()");
  assert.notEqual(start, -1, "找不到 draftKey()——這一支現在守不到任何東西");
  const end = source.indexOf("\n  let draftDirty", start);
  assert.ok(end > start, "找不到 draftKey() 的結尾");
  return source.slice(start, end);
}

test("⚠️ draftKey：只設方向或尖峰時要維持 v2.20.68 的鍵值格式", () => {
  const body = draftKeyBody().replace(/\/\*[\s\S]*?\*\//g, "");
  /*
   * 要看到三段：有路段或日別 → 五段式；只有方向／尖峰 → 三段式（舊格式）；
   * 都沒有 → base。中間那一段是相容性的關鍵，缺了它舊草稿就找不到。
   */
  assert.match(
    body,
    /if \(road \|\| day\) return `\$\{base\}\|\$\{direction\}\|\$\{peak\}\|\$\{road\}\|\$\{day\}`/,
    "有路段或日別時應該用五段式鍵值",
  );
  assert.match(
    body,
    /if \(direction \|\| peak\) return `\$\{base\}\|\$\{direction\}\|\$\{peak\}`/,
    "只設方向／尖峰時必須回 v2.20.68 的三段式，否則舊草稿讀不回來",
  );
  assert.match(body, /return base;/, "四個都空時應該回最舊的格式");
  /*
   * 反面：不可以回到「只要有任何一個就一律五段式」那種寫法。
   */
  assert.doesNotMatch(
    body,
    /direction \|\| peak \|\| road \|\| day\s*\n?\s*\?/,
    "又寫回一律五段式了——只設方向時舊草稿會找不到",
  );
});

test("⚠️ 報告文字草稿：先擋型別再轉數字，null／空字串不可以變成 0", () => {
  const start = source.indexOf("const asNumber = (value)");
  assert.notEqual(start, -1, "找不到 asNumber()——型別守衛不見了");
  const body = source.slice(start, start + 600).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(
    body,
    /typeof value === "number"/,
    "沒有先判斷 typeof number",
  );
  assert.match(
    body,
    /typeof value === "string" && value\.trim\(\) !== ""/,
    "沒有擋掉空白字串（Number(\" \") 是 0）",
  );
  /*
   * 對照斷言：numOr／ratioText／limitText 三處都必須走 asNumber，
   * 不可以有任何一處還留著直接 Number.isFinite(Number(...)) 的舊寫法。
   */
  /*
   * ⚠️ 2026-09-30（#33）：結尾原本是拿**畫面文案**定位的
   *  （`indexOf("本段文字由系統依彙總資料自動產生")`）。改一個字這一條就紅，
   *   而程式沒有問題——那種紅只會讓下一個人把字串改成新文案，
   *   於是這一條變成文案的複本，永遠測不到它本來要測的事。
   *   改成釘結構：下一個函式宣告（`function draftKey()`）就是這一段的結尾。
   */
  const narrativeStart = source.indexOf("const asNumber = (value)");
  assert.notEqual(narrativeStart, -1, "找不到 asNumber()");
  const narrativeEnd = source.indexOf("function draftKey()", narrativeStart);
  assert.ok(narrativeEnd > narrativeStart, "找不到 narrative() 的結尾（draftKey 不見了？）");
  const narrative = source
    .slice(narrativeStart, narrativeEnd)
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(
    narrative,
    /Number\.isFinite\(Number\(/,
    "還有地方直接用 Number.isFinite(Number(...))——null 與空字串會變成 0",
  );
  const users = narrative.match(/asNumber\(/g) || [];
  assert.ok(
    users.length >= 3,
    `只有 ${users.length} 處走 asNumber（速率／延滯、速限比、速限至少 3 處）——這一支可能已經守不到東西`,
  );
});

test("⚠️ 前置：兩個檔案都要有「先擋型別再轉數字」的守衛（同一個雷、同一個修法）", () => {
  /*
   * quality-extension.js 的 asNumber() 與 conclusion.js 的 digits 夾範圍
   * 是同一個雷：`Number(null)`、`Number("")`、`Number([])`、`Number(" ")`
   * 全都給得出 0。判準漂移的話，下一個維護者會以為其中一處是特例而改掉它。
   *
   * ⚠️ 兩處的變數名不同（`value` 與 `c.digits`），所以比對的是**判斷方式**
   *   而不是字面字串——寫死字面字串會讓這一支在改名後變成假的紅。
   *
   * ══════════════════════════════════════════════════════════════════
   *  ⚠️ 2026-09-25：這一條原本是一顆**假的綠**，已改成逐函式指定
   * ══════════════════════════════════════════════════════════════════
   *
   * 原本只做整檔 `assert.match(conclusion, /typeof … === "number"/)`。
   * 而 `conclusion.js` 裡符合那個樣式的**只有** `c.digits` 的夾範圍，
   * 與同一支檔案裡真正會把數值寫進報告的 `isNum()` 毫無關係。
   * 也就是：`isNum()` 破著（只排掉 null／""／undefined 就去 Number()），
   * 這一條照樣全綠——而它的標題宣稱「兩個檔案都要有守衛」。
   *
   * 實際後果：2026-09-24 的複查抓到 `isNum(" ")` 為 true、`Number(" ")` 是 0，
   * 草稿因此寫出「旅行速率 0.0 km/h」。這一條沒有紅，所以那個缺陷活了好幾輪。
   *
   * 改法：**指名到函式本體**，而不是整檔搜尋。行為面的保護在
   * `type-guard-before-number.test.mjs`（那一支已證明對五處舊寫法都會紅）。
   */
  const conclusion = readFileSync(new URL("./conclusion.js", import.meta.url), "utf8");
  const NUMBER_GUARD = /typeof\s+[\w.]+\s*===\s*"number"/;
  const STRING_GUARD = /typeof\s+[\w.]+\s*===\s*"string"\s*&&\s*[\w.]+\.trim\(\)\s*!==\s*""/;

  /**
   * 把指定函式的本體切出來，只在那一段裡找守衛。
   *
   * ⚠️ 兩種宣告方式都要認得：`function name(` 與 `const name = (…) => {`。
   *   只認前者的話，`asNumber` 這個箭頭函式會被判成「找不到」而變成假的紅
   *   ——那和假的綠一樣糟，維護者會直接把這一條刪掉。
   */
  const bodyOf = (text, name, file) => {
    let start = text.indexOf(`function ${name}(`);
    if (start === -1) {
      const arrow = new RegExp(
        `(?:const|let|var)\\s+${name}\\s*=\\s*(?:function\\s*)?\\([^)]*\\)\\s*(?:=>\\s*)?\\{`,
      ).exec(text);
      if (arrow) start = arrow.index;
    }
    assert.notEqual(start, -1, `${file} 找不到 ${name}()——它被改名或刪掉了`);
    const open = text.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (!depth) return text.slice(start, i + 1);
      }
    }
    assert.fail(`${file} 的 ${name}() 括號不成對`);
  };

  const CASES = [
    ["quality-extension.js", bodyOf(source, "asNumber", "quality-extension.js")],
    ["conclusion.js（isNum）", bodyOf(conclusion, "isNum", "conclusion.js")],
  ];
  for (const [name, text] of CASES) {
    assert.match(
      text,
      NUMBER_GUARD,
      `${name} 少了 typeof === "number" 的守衛——` +
        `Number(" ")／Number([])／Number(false) 都是 0，缺值會被寫成「量到 0」`,
    );
    assert.match(
      text,
      STRING_GUARD,
      `${name} 少了「非空白字串」的守衛`,
    );
  }

  /*
   * conclusion.js 的 digits 夾範圍是**另外一處**，也要有守衛——
   * 但它不可以再被當成「isNum 已經有守衛」的證據（那就是原本的假綠）。
   */
  assert.match(
    conclusion,
    /typeof c\.digits === "number" \|\|/,
    "conclusion.js 的小數位數夾範圍少了型別守衛",
  );
});
/*
 * ══════════════════════════════════════════════════════════════════════
 *  小數位數的型別守衛（2026-09-24 實測抓到的第三件）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 本支的 buildConclusion() 早就有夾範圍（所以壞值不會讓草稿崩潰），
 * 但它**只擋 null 與 ""**，漏了型別守衛。實測：
 *   digits = []  → 0 位（使用者設定的 1 位被安靜吃掉）
 *   digits = " " → 0 位
 * 因為 Number([]) 與 Number(" ") 都是 0，而 0 落在合法範圍 0～2 裡面。
 * 姊妹系統全日交通量的 safeConclusionDigits() 早就有這個守衛，本支漏了。
 */
test("⚠️ 小數位數：Number() 給得出 0 的那幾種型別都要回到預設值", async () => {
  globalThis.window = globalThis;
  const code = readFileSync(new URL("./conclusion.js", import.meta.url), "utf8");
  new Function(code)();
  const row = {
    projectCode: "P1", projectName: "測", road: "A路", day: "平日",
    period: "115Q1", year: 115, quarter: 1, peak: "上午尖峰",
    direction: "方向1", directionText: "甲--->乙",
    travel: 30.456, running: 40, roadDelay: 20, junctionDelay: 10,
    totalDelay: 30, limit: 50, ratio: 0.6, los: "E",
  };
  const META = {
    projectName: "測", systemVersion: "v0", generatedAt: "x",
    bandsOf: () => ({ smoothEnd: "B", congestedStart: "E" }),
    worstOf: (list) => list[0],
  };
  const speed = (digits) => {
    const condition = {
      ...globalThis.SPEED_DEFAULT_CONDITION,
      scope: { kind: "project" },
      metrics: ["travel"],
      grouping: "overall",
      digits,
    };
    const text = globalThis.buildSpeedConclusion([row], condition, META);
    return (text.match(/旅行速率 ([\d.,]+)/) || [])[1];
  };
  /* 合法值照走（0、1、2 與可解析的字串）。 */
  assert.equal(speed(0), "30", "0 位");
  assert.equal(speed(1), "30.5", "1 位");
  assert.equal(speed(2), "30.46", "2 位");
  assert.equal(speed("2"), "30.46", "數字字串要當成 2 位");
  /*
   * ⚠️ 這幾種都要回到**預設 1 位**。
   *   `[]` 與 `" "` 是這一次抓到的漏洞（Number() 給 0，而 0 是合法值）。
   */
  for (const bad of [null, undefined, -1, "abc", 100, [], true, " ", "", {}])
    assert.equal(
      speed(bad),
      "30.5",
      `digits = ${JSON.stringify(bad)} 應該回到預設 1 位，實得 ${speed(bad)}`,
    );
});
