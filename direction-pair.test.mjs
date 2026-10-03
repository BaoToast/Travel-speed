/*
 * 本支（純 JS、無打包）的方向成對判定，必須與姊妹專案給出**完全相同**的結論。
 * 案例表在 direction-pair-contract.mjs——**三支逐位元相同**，
 * 由 cross-system-guards 的 SHA-256 釘住。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { checkDirectionPairContract } from "./direction-pair-contract.mjs";

const box = { globalThis: {} };
vm.createContext(box);
vm.runInContext(
  readFileSync(new URL("./direction-pair.js", import.meta.url), "utf8"),
  box,
);
const DirectionPair = box.globalThis.DirectionPair;

test("direction-pair.js 掛得上全域命名空間", () => {
  assert.ok(DirectionPair, "direction-pair.js 沒有掛上 globalThis.DirectionPair");
  for (const fn of ["directionTextKey", "bearingOf", "judgeDirectionPair", "directionPairMessage"])
    assert.equal(typeof DirectionPair[fn], "function", `缺少 ${fn}`);
});

test("方向成對判定與姊妹專案一致（共用契約）", () => {
  checkDirectionPairContract(DirectionPair.judgeDirectionPair, (label, ok, detail) => {
    assert.ok(ok, `${label} — ${detail}`);
  });
});

test("訊息要寫出原名稱與期望的方位（不可以只說「不成對」）", () => {
  const verdict = DirectionPair.judgeDirectionPair("北上", "西行");
  const message = DirectionPair.directionPairMessage("北上", "西行", verdict);
  for (const needle of ["北上", "西行", "南"])
    assert.ok(message.includes(needle), `訊息少了「${needle}」：${message}`);
  /* 不是 mismatched 時不可以吐訊息（否則畫面會出現空提醒）。 */
  assert.equal(
    DirectionPair.directionPairMessage("北上", "南下", DirectionPair.judgeDirectionPair("北上", "南下")),
    "",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  directionTextKey()：方向顯示名稱的比對鍵（2026-09-29 新增，三支共用）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 起因：交通服務水準的「方向對應不一致」檢查原本拿**原始字串**比對，
 * 於是「北上」「北 上」「北－上」被算成三種寫法而報出假的異常，
 * 而那一項的出路寫著「回去修正原始檔並重新匯入」——
 * 一個排版雜訊造成的假異常，會把人導向去改廠商交來的原始檔。
 *
 * 判準放在三支共用的 direction-pair，三支同一套。
 * ⚠️ 兩邊都要驗：吸收雜訊（下面第一條）與**不**吸收內容（第二條）。
 *   少了第二條，把整個字串正規化成空字串也會綠——那是半個守門。
 */
test("directionTextKey 吸收排版雜訊：空白、全半形、破折號、頓號、斜線", () => {
  for (const [a, b] of [
    ["北上", "北 上"],
    ["北上", "北－上"],
    ["北上", "北-上"],
    ["北上", "北　上"],
    ["往台北", "往　台北"],
    ["甲街／乙街", "甲街/乙街"],
    ["A線", "A 線"],
  ])
    assert.equal(
      DirectionPair.directionTextKey(a),
      DirectionPair.directionTextKey(b),
      `「${a}」與「${b}」只差排版雜訊，比對鍵應該相同`,
    );
});

test("directionTextKey 不吸收內容：方位與大小寫都要分得出來", () => {
  for (const [a, b] of [
    ["北上", "南下"],
    ["往台北", "往竹科"],
    ["A線", "a線"],
    ["北上", "北下"],
  ])
    assert.notEqual(
      DirectionPair.directionTextKey(a),
      DirectionPair.directionTextKey(b),
      `「${a}」與「${b}」是真的不同（使用者 2026-09-11 裁示：` +
        "空格與全半形是排版雜訊，大小寫是內容)",
    );
});

test("directionTextKey 對空值與非字串不可以炸", () => {
  for (const input of [null, undefined, "", "   ", 0, {}])
    assert.equal(typeof DirectionPair.directionTextKey(input), "string", String(input));
  assert.equal(DirectionPair.directionTextKey(null), "");
  assert.equal(DirectionPair.directionTextKey("  　 "), "");
});

test("bearingOf 走的就是 directionTextKey（不可以各自正規化一次）", () => {
  assert.equal(DirectionPair.bearingOf("北 上"), "北");
  assert.equal(DirectionPair.bearingOf("北－上"), "北");
  assert.equal(DirectionPair.bearingOf("北上"), DirectionPair.bearingOf("北 上"));
  /* 防誤報那三條不可以被放寬。 */
  assert.equal(DirectionPair.bearingOf("往台北"), null);
  assert.equal(DirectionPair.bearingOf("北屯路"), null);
  assert.equal(DirectionPair.bearingOf("南投端"), null);
});
