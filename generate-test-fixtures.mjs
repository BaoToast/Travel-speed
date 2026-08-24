/*
 * 建立可公開散布的匿名 Excel 回歸測資。
 *
 * 測資只保留系統需要辨識的版型特徵與已知數值，不含任何正式計畫、
 * 調查日期、原始路段或使用者資料。每次完整驗證都重新產生，讓交付包
 * 在全新的電腦上不依賴外部 speed-samples 資料夾。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "test-fixtures");
mkdirSync(outDir, { recursive: true });

function directionBlock({ travel, running, roadDelay, junctionDelay, directionText }) {
  return [
    ["旅次編號"],
    [`方向 往：${directionText}`],
    ["路段延滯"],
    [roadDelay],
    ["交叉口延滯"],
    [junctionDelay],
    ["平均總旅行速率", travel],
    ["平均總行駛速率", running],
    [],
  ];
}

function peakSheet(rows) {
  return XLSX.utils.aoa_to_sheet([
    ...directionBlock({ ...rows[0], directionText: "甲路口--->乙路口" }),
    ...directionBlock({ ...rows[1], directionText: "乙路口--->甲路口" }),
  ]);
}

function workbook(am, pm) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, peakSheet(am), "上午尖峰");
  XLSX.utils.book_append_sheet(wb, peakSheet(pm), "下午尖峰");
  return wb;
}

function save(name, am, pm, bookType = "xlsx") {
  const bytes = XLSX.write(workbook(am, pm), { type: "buffer", bookType });
  writeFileSync(join(outDir, name), bytes);
}

const primaryAM = [
  { travel: 21.08402028, running: 35.78338798, roadDelay: 80, junctionDelay: 48.333333333333 },
  { travel: 26.251, running: 38.643, roadDelay: 52, junctionDelay: 30 },
];
const primaryPM = [
  { travel: 22.411, running: 36.275, roadDelay: 70, junctionDelay: 44 },
  { travel: 20.5280172289065, running: 34.7321490769767, roadDelay: 90, junctionDelay: 42 },
];

save("99999TS1-01-測試路段(甲路～乙路)-平日.xlsx", primaryAM, primaryPM);

const secondAM = [
  { travel: 24.2, running: 36.1, roadDelay: 55, junctionDelay: 25 },
  { travel: 22.8, running: 34.7, roadDelay: 62, junctionDelay: 29 },
];
const secondPM = [
  { travel: 23.5, running: 35.4, roadDelay: 58, junctionDelay: 27 },
  { travel: 21.9, running: 33.8, roadDelay: 66, junctionDelay: 31 },
];
save("99999TS1-02-第二測試路段(丙路～丁路)-平日.xlsx", secondAM, secondPM);
save("99999TS1-02-第二測試路段(丙路～丁路)-假日.xlsx", secondPM, secondAM);

const reportAM = [
  { travel: 18.6, running: 31.2, roadDelay: 72, junctionDelay: 36 },
  { travel: 20.4, running: 33.5, roadDelay: 64, junctionDelay: 32 },
];
const reportPM = [
  { travel: 17.9, running: 30.7, roadDelay: 78, junctionDelay: 39 },
  { travel: 19.8, running: 32.9, roadDelay: 68, junctionDelay: 34 },
];
save("99999TS1-03-報告測試路段(入口～出口)-平日.xlsx", reportAM, reportPM);
save("99999TS1-03-報告測試路段(入口～出口)-假日.xlsx", reportPM, reportAM);

// 同一匿名版型另存舊版 .xls，專門守住 Excel 2007/2010 舊檔讀取能力。
save("99999TS1-04-舊版測試路段(南端～北端)-平日.xls", secondAM, secondPM, "xls");

console.log(`已建立 6 份匿名回歸測資：${outDir}`);
