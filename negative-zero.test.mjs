/*
 * ══════════════════════════════════════════════════════════════════
 *  「-0」不可以出現在任何要給人看的數字上（#26，2026-09-30 補）
 * ══════════════════════════════════════════════════════════════════
 *
 * 姊妹系統「路口轉向」2026-09-10 大檢查實際掃到的：
 *     「OD 逐筆加總 3,932.9 PCU/hr　核對差值 -0 PCU/hr　兩者一致」
 *
 * 判定是對的（-0 === 0），錯的是**印出來的那個負號**。
 * 看報表的人會以為有差額，然後花時間追一個不存在的問題；
 * 更糟的是那個值會被匯出到 Excel。
 *
 * 成因：`Math.round(x * 10) / 10` 在 x 是很小的負數時得到 -0，
 *       而 `(-0).toLocaleString()` 就是「-0」。
 *
 * ── ⚠️ 照實說：這一支是**預防**，不是在修一個看得到的錯 ──────────
 *
 *   2026-09-30 實際查過：這一支目前餵進 `round()` 的值都是非負的
 *   （歷季差值都先過 `Math.abs`），所以畫面上**還看不到** -0。
 *   但 `round()` 本身**真的會**產生 -0（實測 `round(-0.02, 1)` 是 -0），
 *   所以只差「有人新增一處相減直接丟進來」。
 *   另外兩支都已經有這一層，這一支沒有——那就是 #26 要補的東西。
 *
 * 這一支守三層：
 *   ① `round()` 本身：正規化 -0，而且不動到其他任何值
 *   ② 顯示路徑：拿極小負數走一次 formatValue／formatDelta，不可以印出負號
 *   ③ **掃描式**：原始碼裡不可以再出現「自己一份」的 Math.round(x*factor)/factor
 *      ——日後有人另寫一份四捨五入，這一條會自動抓到，不必有人記得
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./trend.js", import.meta.url), "utf8");

/** 把 trend.js 裡的純函式抓出來執行（它是瀏覽器端的 IIFE）。 */
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
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
  `${extract("isNum")}${extract("round")}${extract("ordinalToGrade")}${extract("formatValue")}${extract("formatDelta")}
   var GRADES = ["A","B","C","D","E","F"];
   this.round = round; this.formatValue = formatValue; this.formatDelta = formatDelta;`,
).call(scope);
const { round, formatValue, formatDelta } = scope;

/** Object.is 是唯一分得出 0 與 -0 的比較方式；=== 兩者都是 true。 */
const isNegZero = (value) => Object.is(value, -0);

test("① round() 把 -0 正規化成 0", () => {
  assert.equal(isNegZero(round(-0.02, 1)), false, "round(-0.02, 1) 仍是 -0");
  assert.equal(isNegZero(round(-0, 1)), false, "round(-0, 1) 仍是 -0");
  assert.equal(isNegZero(round(-0.0001, 2)), false);
  assert.equal(round(-0.02, 1).toLocaleString(), "0");
});

test("① round() 不可以動到其他任何值（只治 -0，別治壞了正確的數字）", () => {
  const cases = [
    [[0, 1], 0],
    [[1, 1], 1],
    [[12.34, 1], 12.3],
    [[12.35, 1], 12.4],
    [[-3.26, 1], -3.3],
    [[-12.5, 0], -12],
    [[0.049, 1], 0],
    [[99.99, 1], 100],
    [[1234.567, 2], 1234.57],
  ];
  for (const [[value, digits], expected] of cases)
    assert.equal(
      round(value, digits),
      expected,
      `round(${value}, ${digits}) 應該是 ${expected}`,
    );
  /* 非數字仍然要回 null，不可以變成 0——0 會被當成「真的量到 0」。 */
  assert.equal(round(null, 1), null);
  assert.equal(round("n/a", 1), null);
  assert.equal(round(Number.NaN, 1), null);
  assert.equal(round(Number.POSITIVE_INFINITY, 1), null);
});

test("② 顯示路徑：極小負數印出來不可以帶負號", () => {
  const series = { digits: 1, unit: "km/h" };
  assert.equal(formatValue(-0.02, series), "0 km/h");
  assert.equal(formatValue(-0, series), "0 km/h");
  /* 差值本來就先取絕對值，但這裡連同它一起釘住，免得哪天有人拿掉 abs。 */
  assert.equal(formatDelta(-0.02, series), "0 km/h");
  /* 真正的負值仍然要保留負號——別把「只治 -0」做成「把負號都吃掉」。 */
  assert.equal(formatValue(-3.26, series), "-3.3 km/h");
});

test("⚠️ ② 前置：沒有那一行正規化的話上面那一條會紅（不然它是恆真的）", () => {
  /*
   * 拿**舊版**的 round（沒有正規化）跑同一組輸入，必須印出「-0」。
   * 印不出來的話，代表這個坑根本不存在，那上面那幾條沒有意義。
   */
  const old = (value, digits) => {
    const factor = Math.pow(10, digits);
    return Math.round(Number(value) * factor) / factor;
  };
  assert.equal(isNegZero(old(-0.02, 1)), true, "舊版竟然不會產生 -0？");
  assert.equal(old(-0.02, 1).toLocaleString(), "-0");
});

test("③ 掃描：不可以再出現「自己一份」的四捨五入（會繞過 -0 正規化）", () => {
  /*
   * ⚠️ 只掃**執行碼**，註解要排除：上面那些說明裡就寫著這個式子。
   * ⚠️ 允許 `Math.round(x)`（取整數，不會產生 -0 的顯示問題，
   *   例如量元素高度、把序數換成級別）；擋的是「乘上 factor 再除回來」
   *   那一種小數四捨五入——只有它會在極小負數上生出 -0。
   */
  const files = ["trend.js", "app.js", "conclusion.js", "quality-extension.js", "trend-excel.js"];
  const offenders = [];
  let scanned = 0;
  for (const name of files) {
    const text = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    scanned += code.length;
    for (const match of code.matchAll(
      /Math\.round\(([^;\n]*?)\)\s*\/\s*(factor|Math\.pow\(10|10+\b)/g,
    )) {
      /* trend.js 的 round() 自己是唯一合法的那一處。 */
      const before = code.slice(Math.max(0, match.index - 200), match.index);
      if (name === "trend.js" && /function round\(value, digits\)/.test(before)) continue;
      offenders.push(`${name}｜${match[0].slice(0, 60)}`);
    }
  }
  assert.ok(scanned > 100000, `只掃到 ${scanned} 個字元——去註解的正規式把程式吃掉了`);
  assert.deepEqual(
    offenders,
    [],
    "這幾處自己寫了小數四捨五入，會繞過 -0 的正規化：\n  " + offenders.join("\n  "),
  );
});

test("⚠️ ③ 前置：那個掃描真的抓得到（拿一段假的程式餵它）", () => {
  /*
   * 沒有這一條的話，上面那個正規式寫壞了也會「通過」。
   */
  const fake = "var x = Math.round(a * factor) / factor;";
  const hits = [
    ...fake.matchAll(/Math\.round\(([^;\n]*?)\)\s*\/\s*(factor|Math\.pow\(10|10+\b)/g),
  ];
  assert.equal(hits.length, 1, "掃描用的正規式抓不到最典型的寫法");
});
