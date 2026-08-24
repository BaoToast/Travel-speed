/**
 * 用報告自己的「延滯統計表」驗證系統從尖峰工作表讀出來的四筆數值。
 *
 * 這些調查報告在明細之外，還附了一張已經算好的統計表（平均總旅行速率、
 * 平均總行駛速率、路段延滯、交叉口延滯，兩個尖峰各兩個方向共四欄）。
 * 那張表是報告作者自己的答案，拿它來對系統的讀取結果，是唯一能證明
 * 「讀對了」而不只是「讀到了」的方法。
 *
 * 用法：node verify-against-summary.mjs <資料夾>
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { readWorkbook } from "./parse-harness.mjs";

const norm = (v) => String(v ?? "").normalize("NFKC").replace(/[\s　]/g, "");
const TOLERANCE = 0.01;

/** 從「延滯統計表」抓出四欄數值：上午方向1、上午方向2、下午方向1、下午方向2。 */
function readSummary(file) {
  const wb = XLSX.read(readFileSync(file), { type: "buffer", cellFormula: false });
  const name = wb.SheetNames.find((n) => norm(n).includes("統計表") && norm(n).includes("2"));
  if (!name) return null;
  const m = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
  const pick = (label, wantSeconds) => {
    for (let r = 0; r < m.length; r++) {
      const row = m[r] || [];
      const hit = row.findIndex((v) => norm(v).includes(label));
      if (hit < 0) continue;
      // 延滯有「秒」與「％」兩列，只取標了「秒」的那一列。
      if (wantSeconds && !row.some((v) => norm(v) === "秒")) continue;
      // 空白格在 sheet_to_json 是 null，而 Number(null) 是 0——不先擋掉的話，
      // 一整列空白會被當成四個 0，比對就永遠「不符」。
      const numbers = row
        .map((v, c) => ({ c, raw: v }))
        .filter(
          (x) =>
            x.c > hit &&
            x.raw != null &&
            String(x.raw).trim() !== "" &&
            Number.isFinite(Number(x.raw)),
        );
      if (numbers.length >= 4) return numbers.slice(0, 4).map((x) => Number(x.raw));
    }
    return null;
  };
  const travel = pick("平均總旅行速率", false);
  const running = pick("平均總行駛速率", false);
  const road = pick("路段延滯", true);
  const junction = pick("交叉口延滯", true);
  if (!travel || !running || !road || !junction) return null;
  // 統計表的欄序是「上午方向1、上午方向2、下午方向1、下午方向2」。
  return [0, 1, 2, 3].map((i) => ({
    travel: travel[i],
    running: running[i],
    roadDelay: road[i],
    junctionDelay: junction[i],
  }));
}

const dir = process.argv[2] || "speed-samples";
const files = readdirSync(dir).filter((n) => /\.xlsx?$/i.test(n)).sort();
let bad = 0;
let noSummary = 0;
for (const file of files) {
  const path = join(dir, file);
  const parsed = [
    ...readWorkbook(path)["上午尖峰"].rows,
    ...readWorkbook(path)["下午尖峰"].rows,
  ];
  const summary = readSummary(path);
  if (!summary) {
    noSummary += 1;
    console.log(`➖ ${file}　（沒有可比對的統計表，略過）`);
    continue;
  }
  const problems = [];
  for (let i = 0; i < 4; i += 1) {
    const got = parsed[i];
    const want = summary[i];
    if (!got) {
      problems.push(`第 ${i + 1} 筆完全沒讀到`);
      continue;
    }
    for (const [key, label] of [
      ["travel", "旅行速率"],
      ["running", "行駛速率"],
      ["roadDelay", "路段延滯"],
      ["junctionDelay", "交叉口延滯"],
    ]) {
      const a = Number(got[key]);
      const b = Number(want[key]);
      if (!Number.isFinite(a) || Math.abs(a - b) > TOLERANCE)
        problems.push(`第 ${i + 1} 筆 ${label}：讀到 ${fmt(a)}，統計表是 ${fmt(b)}`);
    }
  }
  if (problems.length) bad += 1;
  console.log(`${problems.length ? "❌" : "✅"} ${file}`);
  problems.forEach((p) => console.log("     " + p));
}
console.log(
  `\n共 ${files.length} 份：${files.length - bad - noSummary} 份與統計表完全相符、${bad} 份不符、${noSummary} 份無統計表`,
);
process.exit(bad ? 1 : 0);

function fmt(v) {
  return Number.isFinite(v) ? Number(v).toFixed(2) : "—";
}
