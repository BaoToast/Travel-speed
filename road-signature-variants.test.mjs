/*
 * ══════════════════════════════════════════════════════════════════════
 *  W-0f：同一條路的不同寫法要算出同一個簽章——但不可以矯枉過正
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這一條是 2026-09-29 **封關驗證時**，在解開的交付包上用 66 份真實調查檔
 * 跑出來的，不是推論：
 *
 *   平日檔：「台17線(中門路32巷至沿海四路)」
 *   假日檔：「台17(中門路32巷-沿海四路)」
 *
 * 兩份是同一條路，卻算出不同的簽章 → 被當成兩條路 → 平假日比較整個不成立。
 * 兩個計畫各中一次（14013TS6-05、14013TS7-05，同一條路的兩季）。
 *
 * ⚠️ 這一支有一半是**反面**：放寬之後最容易犯的錯是「假合併」——
 *   把兩條真的不一樣的路算成同一條。那比假分裂更危險，因為假分裂看得出來
 *   （畫面上多一條路），假合併看不出來（兩條路的數字被混在一起）。
 *   所以「至善路」與「中山線」這兩條反面一定要在。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "app.js"), "utf8");

/** 把 app.js 裡的 roadSignature 與它依賴的 stripRoadSuffix 抽出來跑。 */
function loadSignature() {
  const pick = (name) => {
    const at = appSource.indexOf(`function ${name}(`);
    assert.ok(at > 0, `前置：app.js 裡找不到 ${name}()——抽法壞了，不可以讓這一支安靜地變成恆真`);
    let depth = 0;
    for (let i = appSource.indexOf("{", at); i < appSource.length; i += 1) {
      if (appSource[i] === "{") depth += 1;
      if (appSource[i] === "}") depth -= 1;
      if (depth === 0) return appSource.slice(at, i + 1);
    }
    throw new Error(`${name}() 讀不到結尾`);
  };
  /* stripRoadSuffix 依賴 normalize，一起抽進來（漏掉會變成 normalize is not defined）。 */
  const body = [
    pick("normalize"),
    pick("stripRoadSuffix"),
    pick("roadSignature"),
    "return roadSignature;",
  ].join("\n");
  return new Function(body)();
}

const signature = loadSignature();

test("前置：抽得出 roadSignature，而且它真的會動", () => {
  assert.equal(typeof signature, "function");
  assert.ok(signature("中正路").length > 0, "算出空字串，代表抽出來的不是真的那一支");
});

/* ══════════════════════════════════════════════════════════════════════
 *  正面：真實檔上實際出現過的兩種寫法要算成同一條
 * ══════════════════════════════════════════════════════════════════════ */

test("① 真實檔實測：「台17線(…至…)」與「台17(…-…)」是同一條", () => {
  assert.equal(
    signature("台17線(中門路32巷至沿海四路)"),
    signature("台17(中門路32巷-沿海四路)"),
    "封關時真的發生過的那一對又分裂了",
  );
});

test("② 省道／縣道／市道的「線」字可有可無", () => {
  assert.equal(signature("台1線"), signature("台1"));
  assert.equal(signature("縣道186線"), signature("縣道186"));
  assert.equal(signature("市道186線"), signature("市道186"));
  assert.equal(signature("臺17線"), signature("臺17"));
});

test("③ 起訖連接詞「至」「到」與「-」「～」「~」「—」同一族", () => {
  const base = signature("中正路(甲街-乙街)");
  for (const variant of [
    "中正路(甲街至乙街)",
    "中正路(甲街到乙街)",
    "中正路(甲街～乙街)",
    "中正路(甲街~乙街)",
    "中正路(甲街—乙街)",
  ])
    assert.equal(signature(variant), base, `「${variant}」沒有和 - 寫法算成同一條`);
});

/* ══════════════════════════════════════════════════════════════════════
 *  反面：不可以矯枉過正（假合併比假分裂更危險）
 * ══════════════════════════════════════════════════════════════════════ */

test("④ ★反面：「至善路」不可以被切成「善路」", () => {
  /*
   * 台北真的有至善路。如果把「至」全部拿掉，這條路會和一條叫「善路」的路
   * 合併——兩條路的數字被混在一起，而且畫面上完全看不出來。
   *
   * 規則刻意寫成「至的前面要是路名結尾字才拿掉」：
   * 路名裡的「至」出現在詞頭，所以不會被誤判。
   */
  assert.notEqual(
    signature("至善路"),
    signature("善路"),
    "「至」被全部拿掉了——至善路會和善路假合併",
  );
  assert.equal(signature("至善路"), signature("至善路"));
  /* 而且它自己的起訖寫法照樣要能配對 */
  assert.equal(signature("至善路(甲街至乙街)"), signature("至善路(甲街-乙街)"));
});

test("⑤ ★反面：「中山線」不可以被切成「中山」", () => {
  /*
   * 「線」如果全部拿掉，路名裡帶「線」的會和不帶的假合併。
   * 規則限定成「台／臺／縣／市／鄉／區 ＋ 數字 ＋ 線」。
   */
  assert.notEqual(
    signature("中山線"),
    signature("中山"),
    "「線」被全部拿掉了——路名裡帶線的會假合併",
  );
  assert.notEqual(signature("海線"), signature("海"));
});

test("⑥ ★反面：不同的路還是要算出不同的簽章", () => {
  const distinct = [
    "台17線(中門路32巷至沿海四路)",
    "台1線(中門路32巷至沿海四路)",
    "台17線(甲街至乙街)",
    "中正路(甲街至乙街)",
    "中山路(甲街至乙街)",
  ].map(signature);
  assert.equal(
    new Set(distinct).size,
    distinct.length,
    `有兩條不同的路被算成同一條：${distinct.join("、")}`,
  );
});

test("⑦ 前置：這兩條新規則真的有在動（不是恆真）", () => {
  /*
   * ⚠️ 沒有這一條的話，把兩個 replace 整個刪掉，上面的正面測試會紅、
   *   但如果有人把規則改成「什麼都不做」又剛好讓某些案例碰巧相等，
   *   就看不出來了。這裡直接證明兩條規則各自改變了字串。
   */
  assert.notEqual(signature("台17線"), "台17線", "「台N線 → 台N」那一條沒有作用");
  assert.ok(
    signature("中正路(甲街至乙街)").includes("至") === false,
    "「路名結尾字 ＋ 至」那一條沒有作用",
  );
});
