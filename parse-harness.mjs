/**
 * 把 app.js 裡的「讀取尖峰工作表」那幾個函式抽出來，在 Node 直接對真實檔案跑。
 *
 * 這些函式是純函式（不碰 DOM、不碰 state），但 app.js 是瀏覽器用的傳統腳本，
 * 沒有 export。這裡用文字切割的方式把需要的幾個函式取出來 eval，好處是
 * 「測到的就是網站上實際跑的那份程式碼」，不會出現測試通過但網站沒改到的情況。
 *
 * 用法：node parse-harness.mjs <資料夾>
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "app.js"), "utf8");

/** 從 app.js 取出某個 `function 名稱(` 到下一個頂層 `\n}` 為止的整段。 */
export function extractFunction(name, text = source) {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`app.js 裡找不到 function ${name}`);
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} 的括號沒有收尾`);
}

const NAMES = [
  "normalize",
  "metricAt",
  "findLabels",
  "nearestMetric",
  "delayPart",
  "recordBlocks",
  "labelsInBlock",
  "valueBelowLabel",
  "directionTextOf",
  "rowFromBlockData",
  "parseByRecordBlocks",
  "parseByTravelAnchors",
  "parsePeakSheet",
  "matrix",
];
const parts = NAMES.map((name) => {
  try {
    return extractFunction(name);
  } catch {
    return ""; // ownsRow 之類的函式可能已經被拿掉，缺了就跳過
  }
}).filter(Boolean);

const prelude = `
const num = (v) => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
`;
const factory = new Function(
  "XLSX",
  `${prelude}\n${parts.join("\n")}\nreturn { ${NAMES.filter((n) => parts.some((p) => p.startsWith(`function ${n}(`))).join(", ")} };`,
);
export const fns = factory(XLSX);

export function readWorkbook(file) {
  const wb = XLSX.read(readFileSync(file), { type: "buffer", cellFormula: false });
  const out = {};
  for (const [key, names] of [
    ["上午尖峰", ["上午尖峰", "上午", "AM尖峰", "AM"]],
    ["下午尖峰", ["下午尖峰", "下午", "PM尖峰", "PM"]],
  ]) {
    const m = fns.matrix(wb, names);
    out[key] = fns.parsePeakSheet(m, key);
  }
  out.sheetNames = wb.SheetNames;
  return out;
}

// 只有「直接執行這支檔案」時才跑批次輸出；被 import 時不可以自己動起來，
// 否則 verify-against-summary.mjs 一 import 就會先把整批結果印一遍。
const isEntry = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isEntry && process.argv[2]) {
  const dir = process.argv[2];
  let bad = 0;
  for (const name of readdirSync(dir).filter((n) => /\.xlsx?$/i.test(n)).sort()) {
    const result = readWorkbook(join(dir, name));
    const rows = [...result["上午尖峰"].rows, ...result["下午尖峰"].rows];
    const complete =
      rows.length === 4 &&
      rows.every((r) => r.travel != null && r.running != null && r.totalDelay != null);
    if (!complete) bad += 1;
    console.log(`${complete ? "✅" : "❌"} ${name}`);
    if (!complete) {
      const issue = result["上午尖峰"].issue || result["下午尖峰"].issue;
      if (issue) console.log(`     問題：${issue}`);
    }
    for (const r of rows)
      console.log(
        `     ${r.peak} ${r.direction}${r.directionText ? "（" + r.directionText + "）" : ""}  旅行=${fmt(r.travel)} 行駛=${fmt(r.running)} 路段延滯=${fmt(r.roadDelay)} 交叉口延滯=${fmt(r.junctionDelay)} 總延滯=${fmt(r.totalDelay)}`,
      );
  }
  console.log(bad ? `\n❌ ${bad} 份讀取不完整` : "\n全部讀取完整");
  process.exit(bad ? 1 : 0);
}

function fmt(v) {
  return v == null ? "—" : Number(v).toFixed(2).replace(/\.00$/, "");
}
