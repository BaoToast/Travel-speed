/*
 * 結論草稿的「小數位數」必須真的管到百分比。
 *
 * 起因（使用者在全日交通量實測回報，三支系統寫法相同、毛病也相同）：
 * 小數位數選 2 位，產生出來的百分比還是 1 位。
 * 本支系統的 pct() 是寫死 toFixed(1)，同樣沒有把設定帶進去。
 * 受影響的三處：速限比、各服務水準等級筆數統計的百分比、
 * 季度變動幅度的增減百分比。
 *
 * ⚠️ 假通過陷阱：只驗「digits=2 時字串裡有兩位小數」不夠——旅行速率走
 *    num() 本來就會有兩位小數，整段字串一定會通過。所以只抓百分比比對。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SPEED_DEFAULT_CONDITION, buildSpeedConclusion } = require("./conclusion.js");

const META = {
  projectName: "測試計畫",
  systemVersion: "v2.20",
  generatedAt: "2026-09-07 10:00",
};

function row(over = {}) {
  return {
    projectCode: "P1",
    projectName: "測試計畫",
    period: "115Q2",
    road: "中山路",
    day: "平日",
    peak: "上午尖峰",
    direction: "方向1",
    directionText: "大同路口--->中正路口",
    travel: 32.5,
    running: 41.2,
    roadDelay: 40,
    junctionDelay: 20,
    totalDelay: 60,
    limit: 50,
    ratio: 0.65,
    los: "C",
    ...over,
  };
}

function percentages(text) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map((match) => match[1]);
}

function decimalsOf(value) {
  return value.includes(".") ? value.split(".")[1].length : 0;
}

test("速限比與服務水準筆數統計的百分比要跟著「小數位數」走", () => {
  const rows = [row(), row({ road: "民權路", los: "D", travel: 21.4 })];
  for (const digits of [0, 1, 2]) {
    const text = buildSpeedConclusion(
      rows,
      { ...SPEED_DEFAULT_CONDITION, digits, metrics: ["travel", "limit", "losCount"] },
      META,
    );
    const values = percentages(text);
    assert.ok(values.length > 0, `digits=${digits} 應該要有百分比可以檢查`);
    for (const value of values)
      assert.equal(
        decimalsOf(value),
        digits,
        `小數位數選 ${digits} 位，百分比卻印成 ${value}%`,
      );
  }
});

test("季度變動幅度的百分比也要跟著走", () => {
  const rows = [
    row({ period: "114Q4", travel: 30, totalDelay: 50 }),
    row({ period: "115Q2", travel: 36, totalDelay: 65 }),
  ];
  for (const digits of [0, 2]) {
    const text = buildSpeedConclusion(
      rows,
      { ...SPEED_DEFAULT_CONDITION, digits, metrics: ["travel", "growth"] },
      META,
    );
    for (const value of percentages(text))
      assert.equal(
        decimalsOf(value),
        digits,
        `小數位數選 ${digits} 位，變動幅度卻印成 ${value}%`,
      );
  }
});

test("舊範本缺少或帶入非法小數位數時，安全回到 1 位", () => {
  const rows = [row(), row({ road: "民權路", los: "D", travel: 21.4 })];
  for (const digits of [undefined, null, -1, 101, "不是數字"]) {
    const text = buildSpeedConclusion(
      rows,
      { ...SPEED_DEFAULT_CONDITION, digits, metrics: ["travel", "limit", "losCount"] },
      META,
    );
    const values = percentages(text);
    assert.ok(values.length > 0, `digits=${String(digits)} 應有百分比`);
    for (const value of values)
      assert.equal(decimalsOf(value), 1, `digits=${String(digits)} 應安全回到 1 位：${value}%`);
    assert.match(text, /旅行速率 32\.5 km\/h/);
  }
});
