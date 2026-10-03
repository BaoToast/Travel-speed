/*
 * ══════════════════════════════════════════════════════════════════════
 *  #52：服務水準 A～F 的紅黃綠沒有任何測試保護（2026-09-29 補上）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-29 的裁示：「如果這一點你覺得很重要，就請你做」。
 * **我認為重要**，理由是這組顏色是使用者判讀報表的第一個訊號，而它：
 *   ・全專案 0 處測試碰過它（實測 `*.test.mjs` 對 `.los-a`／色碼都是 0 命中）；
 *   ・`.los-f` 被宣告了**兩次**（後面那一次覆寫前面），改錯一次不會有人發現；
 *   ・「統一配色」這種好意的重構，最容易順手把它改掉而全部測試照樣綠。
 *
 * ⚠️ 這一支驗的是**性質**，不是只把色碼抄一遍：
 *   ① 六個等級各有一個顏色，而且是**生效的那一個**（要解析覆寫，不是第一個）。
 *   ② 徽章上的文字在它自己的底色上 ≥ AA 4.5:1（A～E 深字、F 白字）。
 *   ③ **相鄰等級的亮度差 ≥ 10 個百分點**——這是「列印成灰階或色弱時分得出來」
 *     的那一條，也是使用者 2026-09-10 對這組配色提的驗收線之一。
 *   ④ F 必須是**最深**的那一個，而且是唯一用白字的。
 *   ⑤ 色碼本身釘住（防「統一配色」順手改掉），但釘的是**解析後生效的值**。
 *
 * ⚠️ 刻意**不**斷言「亮度由 A 到 F 遞減」：這是紅綠燈式的色階
 *   （綠→黃橙→紅），中間的黃色本來就是最亮的（實測 C 是 72.1%）。
 *   寫成遞減會得到一個在**正確配色**上恆紅的假守門。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("./styles.css", import.meta.url), "utf8");
const GRADES = ["a", "b", "c", "d", "e", "f"];

function luminance(hex) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
  const [hi, lo] = luminance(a) > luminance(b) ? [a, b] : [b, a];
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
}

/**
 * 解析 `.los-x` **最後生效**的 background 與 color。
 *
 * ⚠️ 一定要取**最後一條**：`.los-f` 在這份樣式表裡宣告了兩次，
 *   取第一條會驗到一個早就被覆寫掉的顏色——那是一個永遠驗不到真相的守門。
 */
function losStyle(grade) {
  const rules = [
    ...css.matchAll(
      new RegExp(`\\.los-${grade}\\s*\\{([^}]*)\\}`, "g"),
    ),
  ];
  assert.ok(rules.length, `樣式表裡找不到 .los-${grade}`);
  let background = null;
  let color = null;
  for (const rule of rules) {
    const bg = rule[1].match(/background\s*:\s*(#[0-9a-fA-F]{6})/);
    const fg = rule[1].match(/(?<!-)color\s*:\s*(#[0-9a-fA-F]{3,6})/);
    if (bg) background = bg[1].toLowerCase();
    if (fg) color = fg[1].toLowerCase();
  }
  assert.ok(background, `.los-${grade} 沒有解析得出 background`);
  return { background, color, declarations: rules.length };
}

test("① 六個等級各有一個生效的底色，而且 .los-f 的覆寫真的被解析到", () => {
  const seen = new Map();
  for (const grade of GRADES) {
    const { background } = losStyle(grade);
    assert.ok(
      !seen.has(background),
      `.los-${grade} 與 .los-${seen.get(background)} 用了同一個底色 ${background}` +
        "——兩個等級長一樣，使用者分不出來",
    );
    seen.set(background, grade);
  }
  /*
   * 前置：.los-f 必須真的有兩條宣告，而且解析出來的是**後面那一條**。
   * 哪天有人把前面那一條刪掉（很合理的清理），這裡會紅，
   * 提醒人回來確認解析邏輯還對不對。
   */
  const f = losStyle("f");
  assert.ok(
    f.declarations >= 2,
    ".los-f 只剩一條宣告了——請確認上面的「取最後一條」還有意義",
  );
  assert.equal(f.background, "#b83f3d", ".los-f 解析出來不是後面那一條覆寫值");
});

test("② 徽章上的文字在它自己的底色上要 ≥ AA 4.5:1", () => {
  const failures = [];
  for (const grade of GRADES) {
    const { background, color } = losStyle(grade);
    /* 沒有自己宣告 color 的，繼承的是 --ink。 */
    const fg = color === "#fff" ? "#ffffff" : color || "#1d2a34";
    const ratio = contrast(fg, background);
    if (ratio < 4.5)
      failures.push(
        `.los-${grade}：${fg} 配 ${background} 只有 ${ratio.toFixed(2)}:1`,
      );
  }
  assert.deepEqual(
    failures,
    [],
    "以下等級徽章上的文字未達 AA：\n- " + failures.join("\n- "),
  );
});

test("③ 相鄰等級的亮度差 ≥ 10 個百分點（列印成灰階或色弱時要分得出來）", () => {
  const failures = [];
  for (let i = 0; i < GRADES.length - 1; i += 1) {
    const a = losStyle(GRADES[i]).background;
    const b = losStyle(GRADES[i + 1]).background;
    const delta = Math.abs(luminance(a) - luminance(b)) * 100;
    if (delta < 10)
      failures.push(
        `${GRADES[i].toUpperCase()}→${GRADES[i + 1].toUpperCase()}：` +
          `${a} 與 ${b} 的亮度差只有 ${delta.toFixed(2)}%`,
      );
  }
  assert.deepEqual(
    failures,
    [],
    "以下相鄰等級在灰階下分不出來：\n- " + failures.join("\n- "),
  );
});

test("③ 前置：這條線真的擋得住（不然它是恆真的）", () => {
  /* 兩個只差一點的綠必須被判成太接近。 */
  const delta = Math.abs(luminance("#69c57b") - luminance("#6cc77e")) * 100;
  assert.ok(delta < 10, `算出來是 ${delta.toFixed(2)}%，這條線等於沒做`);
});

test("④ F 必須是最深的，而且是唯一用白字的", () => {
  const byLum = GRADES.map((g) => [g, luminance(losStyle(g).background)]);
  const darkest = byLum.reduce((a, b) => (a[1] <= b[1] ? a : b))[0];
  assert.equal(
    darkest,
    "f",
    `最深的是 .los-${darkest} 而不是 .los-f——F 是最差的等級，` +
      "它必須看起來最重，否則使用者會把它當成中間等級",
  );
  const white = GRADES.filter((g) => (losStyle(g).color || "") === "#fff");
  assert.deepEqual(
    white,
    ["f"],
    `用白字的是 ${white.join("、") || "（沒有）"}，應該只有 f`,
  );
});

test("⑤ 六個色碼釘住（防「統一配色」順手改掉）", () => {
  /*
   * ⚠️ 釘的是**解析後生效的值**。有人要改配色不是不行，
   *   但必須連這一條一起改——那時他會被迫回頭看上面那幾條性質還過不過。
   *   這就是這條守門的作用：讓改配色變成一個「要想一下」的動作。
   */
  assert.deepEqual(
    GRADES.map((g) => losStyle(g).background),
    ["#69c57b", "#a9d873", "#f7dc6d", "#f5ad65", "#ec7860", "#b83f3d"],
    "服務水準的配色被改動了。改是可以的，但請先確認上面①～④四條性質還過",
  );
});
