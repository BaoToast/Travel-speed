/*
 * findAllSurveyDates：三支共用契約（案例表 survey-date-contract.mjs 逐位元相同）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { checkSurveyDateContract } from "./survey-date-contract.mjs";

const box = { globalThis: {} };
vm.createContext(box);
vm.runInContext(
  readFileSync(new URL("./period-date.js", import.meta.url), "utf8"),
  box,
);
const P = box.globalThis.PeriodDate;

test("findAllSurveyDates 符合三支共用契約", () => {
  assert.equal(typeof P.findAllSurveyDates, "function", "period-date.js 沒有掛出 findAllSurveyDates");
  checkSurveyDateContract(P.findAllSurveyDates, P.findSurveyDate, (label, ok, detail) => {
    assert.ok(ok, `${label} — ${detail}`);
  });
});
