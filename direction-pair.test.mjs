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
  for (const fn of ["bearingOf", "judgeDirectionPair", "directionPairMessage"])
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
