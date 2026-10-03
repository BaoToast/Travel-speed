/*
 * ══════════════════════════════════════════════════════════════════════
 *  尖峰時段認定的契約——**這一支不自己挑時段**（2026-09-30 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 另外兩支（全日交通量、路口轉向）各有一支 `peak-hour-contract.test.mjs`，
 * 釘的是「**滾動一小時怎麼算**」的十種情境（`PEAK_HOUR_CASES`，兩支逐位元相同）。
 * 這一支一直沒有，A3 就是為了補上它。
 *
 * ⚠️ 但**不可以把那張表抄過來**。這一支根本沒有滾動一小時的算法：
 *   尖峰時段是調查報告自己分好的（「上午尖峰」「下午尖峰」兩張工作表），
 *   系統只負責**認出那兩張表**並讀裡面的欄位。
 *   把別支的情境表抄過來，斷言的是這一支沒有的東西——
 *   **那是永遠綠的守門，比沒有守門更糟**（使用者 2026-09-30 定的界線）。
 *
 * 所以這一支釘的是這一支自己的三件事：
 *
 *   一、**工作表別名清單**：認得哪些名字、以及「不確定就不要猜」的界線。
 *   二、**不可以自己推算尖峰小時**：原始碼裡不准出現滾動一小時那類算法。
 *       哪一天有人「順手對齊另外兩支」，這一條就會紅，而且會說明為什麼不對。
 *   三、**尖峰這個維度只有四個值**，而且「代表尖峰」是預設。
 *
 * ⚠️ 代表紀錄怎麼挑（先 LOS 最差 → 再速限比最低 → 再旅行速率最低）
 *   已經由 `los-and-selection-golden.test.mjs` 釘住黃金值，這裡不重複。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");

/* app.js 是瀏覽器端腳本，這裡只把要測的純函式取出來執行。 */
function extract(name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `找不到函式 ${name}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`函式 ${name} 括號不成對`);
}
const scope = {};
new Function(
  `${extract("normalize")}${extract("sheetNameHits")}${extract("matrix")}
   this.normalize = normalize; this.sheetNameHits = sheetNameHits; this.matrix = matrix;`,
).call(scope);
const { normalize, sheetNameHits } = scope;

/** 重現 matrix() 的挑表順序，但只回傳「挑到哪一張」。 */
function pickSheet(sheetNames, aliases) {
  const targets = aliases.map(normalize);
  for (const target of targets) {
    const hit =
      sheetNames.find((n) => normalize(n) === target) ||
      sheetNames.find((n) => sheetNameHits(normalize(n), target));
    if (hit) return hit;
  }
  return null;
}

/*
 * 別名清單——**必須與 app.js 裡真正在用的那兩組逐字相同**。
 * 下面第一條測試就是在核對這件事，所以這裡寫錯不會變成假的綠。
 */
const AM_ALIASES = ["上午尖峰", "上午", "AM尖峰", "AM"];
const PM_ALIASES = ["下午尖峰", "下午", "PM尖峰", "PM"];

test("別名清單必須與 app.js 裡真正在用的那兩組逐字相同", () => {
  const call = (list) =>
    `matrix(wb, [${list.map((n) => JSON.stringify(n)).join(", ")}])`;
  assert.ok(
    source.includes(call(AM_ALIASES)),
    `app.js 裡找不到 ${call(AM_ALIASES)}——別名清單改過了，這一支的期望值要跟著改`,
  );
  assert.ok(
    source.includes(call(PM_ALIASES)),
    `app.js 裡找不到 ${call(PM_ALIASES)}——別名清單改過了`,
  );
});

test("認得的寫法：四種別名、前後空白、全形括號與時段字樣", () => {
  const cases = [
    ["上午尖峰", "上午尖峰"],
    ["  上午尖峰  ", "  上午尖峰  "],
    ["上午", "上午"],
    ["AM尖峰", "AM尖峰"],
    ["AM", "AM"],
    /* 真實檔常見：別名後面接時段。這個子字串退路必須留著。 */
    ["上午尖峰(07:00~09:00)", "上午尖峰(07:00~09:00)"],
    ["上午尖峰（07:00～09:00）", "上午尖峰（07:00～09:00）"],
    ["AM(07:00~09:00)", "AM(07:00~09:00)"],
  ];
  for (const [sheet, expect] of cases)
    assert.equal(
      pickSheet([sheet, "下午尖峰"], AM_ALIASES),
      expect,
      `「${sheet}」應該被認成上午尖峰那一張`,
    );
  assert.equal(pickSheet(["上午尖峰", "PM尖峰"], PM_ALIASES), "PM尖峰");
});

test("⚠️ 英文字裡的 AM／PM 不可以被認成尖峰工作表（2026-09-30 抓到的實際誤判）", () => {
  /*
   * 舊版用 includes()，所以這四種都會中：
   *   活頁簿裡有一張 PROGRAM，上午尖峰就被認成它——**安靜讀錯一張表**，
   *   然後照樣算出 LOS。這正是這一支自己在註解裡拒絕的「猜」。
   */
  for (const bad of ["PROGRAM", "SAMPLE", "EXAMPLE", "TEAMPM", "DIAGRAM"])
    assert.equal(
      pickSheet([bad, "下午尖峰"], AM_ALIASES),
      null,
      `「${bad}」不可以被認成上午尖峰——寧可報「找不到工作表」，也不要讀錯一張`,
    );
  for (const bad of ["TEMPMAP", "PUMP"])
    assert.equal(
      pickSheet(["上午尖峰", bad], PM_ALIASES),
      null,
      `「${bad}」不可以被認成下午尖峰`,
    );
});

test("認不出來的時候回 null（不可以退而求其次挑一張）", () => {
  assert.equal(pickSheet(["工作表1", "Sheet2"], AM_ALIASES), null);
  assert.equal(pickSheet([], AM_ALIASES), null);
  /* 只有下午那一張時，上午一定要是 null——不可以拿下午那張頂替。 */
  assert.equal(pickSheet(["下午尖峰"], AM_ALIASES), null);
});

test("⚠️ 前置：把字界比對拔掉，上面那一條要真的轉紅", () => {
  /*
   * 這一條是這支測試自己的反證。沒有它的話，
   * 「PROGRAM 不會被認成上午尖峰」可能只是因為我 pickSheet 寫錯而恆綠。
   */
  const naive = (sheetNames, aliases) => {
    const targets = aliases.map(normalize);
    for (const target of targets) {
      const hit =
        sheetNames.find((n) => normalize(n) === target) ||
        sheetNames.find((n) => normalize(n).includes(target));
      if (hit) return hit;
    }
    return null;
  };
  assert.equal(
    naive(["PROGRAM", "下午尖峰"], AM_ALIASES),
    "PROGRAM",
    "用舊的 includes() 應該會誤認——誤認不了的話，上面那一條證明不了任何事",
  );
  assert.equal(
    pickSheet(["PROGRAM", "下午尖峰"], AM_ALIASES),
    null,
    "現在的版本必須擋下來",
  );
});

test("★ 這一支不可以自己推算尖峰小時（不准對齊另外兩支的滾動一小時）", () => {
  /*
   * 為什麼要擋：
   *   使用者的四個統計範圍是「上午尖峰／下午尖峰／全調查時段／全調查時段尖峰」，
   *   而這一支讀的是調查報告**已經分好**的上午／下午兩張表。
   *   哪一天有人看到另外兩支有 rollingPeak，「順手」在這裡也加一個，
   *   這一支就會開始自己挑時段——那是換掉計算口徑，而且使用者看不出來。
   *
   * ⚠️ 只掃**執行碼**，註解要排除：這一段註解本身就寫著 rollingPeak 這個字。
   */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  for (const banned of ["rollingPeak", "peakWindow", "滾動一小時", "尖峰小時"])
    assert.ok(
      !code.includes(banned),
      `執行碼裡出現「${banned}」——這一支不自己挑尖峰時段，` +
        "要加滾動一小時那類算法之前必須先問使用者（那是計算口徑）",
    );
});

test("⚠️ 前置：上面那條掃描真的看得到執行碼（不是把整份掃成空字串）", () => {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.ok(
    code.length > source.length * 0.3,
    `去掉註解之後只剩 ${code.length}／${source.length} 個字元——正規式把執行碼吃掉了`,
  );
  assert.ok(code.includes("function matrix("), "掃描後的執行碼裡找不到 matrix()");
  /* 而且註解真的被拿掉了，否則上一條會被註解裡的字樣誤判。 */
  assert.ok(!code.includes("滾動一小時"), "註解沒有被排除乾淨");
});

test("尖峰這個維度只有四個值，而且預設是「代表尖峰」", () => {
  const filters = readFileSync(new URL("./main-filters.js", import.meta.url), "utf8");
  assert.ok(
    filters.includes(
      'var PEAK_CHOICES = ["representative", "上午尖峰", "下午尖峰", "side-by-side"];',
    ),
    "PEAK_CHOICES 變了——尖峰維度的可選值是計算範圍的一部分，改之前要問使用者",
  );
  assert.ok(
    /peak:\s*"representative"/.test(filters),
    "主工具列的尖峰預設值不是 representative（代表尖峰）",
  );
});
