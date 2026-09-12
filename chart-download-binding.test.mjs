import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./app.js", import.meta.url), "utf8");

test("三段圖下載按鈕只能綁定一次，且多圖必須走單一 ZIP 路徑", () => {
  const bindings = source.match(/\$\("bandDownloadPng"\)\.onclick\s*=/g) || [];
  assert.equal(bindings.length, 1, "重複綁定會讓後面的舊實作覆蓋 ZIP 下載");

  const start = source.indexOf('$("bandDownloadPng").onclick =');
  const end = source.indexOf('$("trendCopyScript").onclick =', start);
  assert.ok(start >= 0 && end > start, "找不到三段圖下載處理器");
  const handler = source.slice(start, end);
  assert.match(handler, /downloadChartImages\s*\(/);
  assert.doesNotMatch(handler, /for\s*\(const figure of figures\)/);
});

test("趨勢圖互動處理器各只綁定一次，避免後段舊程式覆蓋修正版", () => {
  for (const [id, event] of [
    ["trendCharts", "onclick"],
    ["trendDownloadXlsx", "onclick"],
    ["bandCopyScript", "onclick"],
    ["trendCopyScript", "onclick"],
    ["trendDay", "onchange"],
    ["trendMetricBoxes", "onchange"],
  ]) {
    const pattern = new RegExp(
      String.raw`\$\("${id}"\)\.${event}\s*=`,
      "g",
    );
    assert.equal(
      (source.match(pattern) || []).length,
      1,
      `${id}.${event} 不可重複綁定`,
    );
  }
});
