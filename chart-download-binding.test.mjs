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

/*
 * ── 匯出解析度：一個系統只能有一個倍率，而且要跟另外兩支一樣 ──
 *
 * ⚠️ 2026-09-12 稽核抓到：這一支有**兩條**下載路徑（單張 downloadSvgAsPng
 *   與打包 ZIP 的 svgFigureToPngBlob），各自寫死 `scale = 2`，而路口轉向與
 *   全日交通量都是 3。症狀很難自己發現——圖下載得出來、也打得開，
 *   只是貼進同一份報告時這一支的圖比較糊，而且同一個系統裡兩條路徑
 *   將來只要有一邊被改到就會不一致。
 */
test("匯出 PNG 的倍率只有一個來源，而且是 3（三支程式一致）", () => {
  assert.match(
    source,
    /const EXPORT_PNG_SCALE = 3;/,
    "找不到 EXPORT_PNG_SCALE＝3；路口轉向與全日交通量用的是 3",
  );
  /*
   * 反面檢查：不可以再有第二個寫死的倍率。
   * 只看 `scale = 2` 之類的字面值——`scale = EXPORT_PNG_SCALE` 是允許的。
   */
  const hardCoded = source.match(/\bscale\s*=\s*\d+/g) || [];
  assert.deepEqual(
    hardCoded,
    [],
    `還有寫死的倍率：${hardCoded.join("、")}——請改用 EXPORT_PNG_SCALE`,
  );
});
