/*
 * ══════════════════════════════════════════════════════════════════════
 *  長計畫名稱／長計畫編號不可以撐破版面（三支共通）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10 實測（附截圖）：
 *   「長計畫名稱會撐破卡片」
 *   「計畫名稱沒問題了，但忘記限制計畫編號（三個程式都是），
 *     當編號過長時會遮蓋到計畫名稱」
 *
 * 另外兩支早就做了（路口轉向 `lib/final-features.ts` 的
 * `PROJECT_NAME_LIMIT`／`PROJECT_CODE_LIMIT` ＋ `app/globals.css`；
 * 全日交通量 `tests/project-name-limit.test.mjs`），
 * **這一支到 2026-09-20 大檢查才補上**——三支共通的項目漏了一支，
 * 而且沒有任何檢查在看，所以漏了十天沒人發現。
 *
 * ── 這一支守什麼 ──
 *
 * 兩件事都要，缺一不可：
 *   (甲) **上限**擋得住新輸入（maxlength ＋ capText，貼上也要擋）
 *   (乙) **換行**擋得住舊資料（既有的超長名稱不會因為加了上限就變短）
 *
 * ⚠️ 刻意迴避的假通過：
 *   一、**只驗「有 PROJECT_NAME_LIMIT 這個字」不算數**——宣告了卻沒用到
 *       照樣過。這裡驗它真的被 `capText` 與 `maxlength` 兩條路用到。
 *   二、**只驗 maxlength 不算數**——整段貼上不受 maxlength 限制。
 *   三、**只驗上限不算數**——舊資料不會變短，沒有換行照樣撐破。
 *   四、**capText 不可以截斷既有超長值**：`capText(舊值, 舊值, 40)` 必須
 *       原樣回傳，否則使用者只是點一下欄位就會無聲掉字。
 *   五、前置檢查：`app.js`／`styles.css` 真的讀得到內容。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("前置：原始檔讀得到內容（不然下面全部恆真）", () => {
  assert.ok(app.length > 100000, `app.js 只有 ${app.length} 字元`);
  assert.ok(css.length > 10000, `styles.css 只有 ${css.length} 字元`);
});

test("(甲) 兩個上限都宣告了，而且數字與另外兩支一致", () => {
  const name = app.match(/const PROJECT_NAME_LIMIT = (\d+);/);
  const code = app.match(/const PROJECT_CODE_LIMIT = (\d+);/);
  assert.ok(name, "app.js 找不到 PROJECT_NAME_LIMIT");
  assert.ok(code, "app.js 找不到 PROJECT_CODE_LIMIT");
  /* 路口轉向 lib/final-features.ts 用的就是 40 / 20。 */
  assert.equal(name[1], "40", "計畫名稱上限要與另外兩支一致（40）");
  assert.equal(code[1], "20", "計畫編號上限要與另外兩支一致（20）");
});

test("(甲) maxlength 與 capText 兩條路都接上了（只做一條擋不住貼上）", () => {
  assert.match(
    app,
    /setAttribute\("maxlength"/,
    "沒有把 maxlength 掛到輸入框上——鍵盤輸入擋不住",
  );
  assert.match(
    app,
    /function capText\(next, previous, limit\)/,
    "沒有 capText——貼上擋不住",
  );
  /* 兩個欄位都要被 capProjectFields 涵蓋。 */
  for (const id of ["projectCode", "projectName"])
    assert.ok(
      new RegExp(`\\["${id}", PROJECT_(?:CODE|NAME)_LIMIT\\]`).test(app),
      `capProjectFields 沒有涵蓋 ${id}`,
    );
  /* 送出時也要再過一次，避免程式其他路徑繞過輸入框。 */
  assert.match(
    app,
    /capText\(\$\("projectCode"\)\.value\.trim\(\), "", PROJECT_CODE_LIMIT\)/,
    "saveProject 沒有再過一次 capText",
  );
  assert.match(
    app,
    /capText\(\$\("projectName"\)\.value\.trim\(\), "", PROJECT_NAME_LIMIT\)/,
    "saveProject 沒有再過一次 capText",
  );
});

test("(甲) capText 不可以把既有的超長值一刀砍掉", () => {
  /* 把 app.js 裡那一份 capText 原樣取出來求值，不另外寫一份。 */
  const src = app.match(
    /function capText\(next, previous, limit\) \{[\s\S]*?\n\}/,
  );
  assert.ok(src, "取不到 capText 的原始碼");
  // eslint-disable-next-line no-new-func
  const capText = new Function(`${src[0]}; return capText;`)();

  const legacy = "舊".repeat(60); // 既有 60 字的名稱
  assert.equal(
    capText(legacy, legacy, 40),
    legacy,
    "既有超長值被截斷了——使用者只要點一下欄位就會無聲掉字",
  );
  assert.equal(
    capText(legacy + "再加一個字", legacy, 40),
    legacy,
    "既有超長值可以留著，但不可以再變更長",
  );
  assert.equal(capText("短".repeat(10), "", 40), "短".repeat(10), "正常值不該被動");
  assert.equal(
    capText("長".repeat(50), "", 40),
    "長".repeat(40),
    "新輸入超過上限要被截到上限",
  );
});

test("(乙) 版面這一側也擋住了：既有超長值要換行而不是撐開", () => {
  /*
   * ⚠️ min-width: 0 是關鍵。header 是 flex，flex item 的預設 min-width
   *   是 auto，長字串會把它撐出去而不是換行——這就是截圖裡
   *   「編號蓋到名稱」的直接原因。
   */
  assert.match(
    css,
    /header > div:first-child \{\s*min-width: 0;/,
    "header 的第一個子元素沒有 min-width: 0，長字串會把它撐開",
  );
  assert.match(
    css,
    /overflow-wrap: anywhere/,
    "沒有 overflow-wrap: anywhere，長字串不會換行",
  );
  /* 只寫 white-space: normal 而沒有 overflow-wrap 是擋不住無空白長字串的。 */
  const block = css.slice(css.indexOf("header strong,"));
  assert.ok(
    block.includes("overflow-wrap: anywhere") &&
      block.includes("white-space: normal"),
    "header strong / small / #headProject 這一組要同時有 white-space 與 overflow-wrap",
  );
});
