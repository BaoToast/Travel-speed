import assert from "node:assert/strict";
import test from "node:test";
import { countTestCalls } from "./test-call-count.mjs";

test("插值內字串的假 test 不算，真正宣告仍算", () => {
  const code = 'const x = `${ (() => { const s = ";test(1);"; })() }`;\ntest("real",()=>{});';
  assert.equal(countTestCalls(code), 1);
});
test("插值內字串的右大括號不可以提早結束插值", () => {
  const code = 'const x = `${ (() => { const s = "}"; test("nested",()=>{}); })() }`;\ntest("real",()=>{});';
  assert.equal(countTestCalls(code), 2);
});
test("插值內註解的大括號及假 test 必須跳過", () => {
  const code = 'const x = `${ (() => { /* } ;test(1); */ test("nested",()=>{}); })() }`;\ntest("real",()=>{});';
  assert.equal(countTestCalls(code), 2);
});
test("巢狀模板的文字不能變成測試，巢狀 block 仍算", () => {
  const code = 'const x = `${ (() => { const y = `text ;test(1); ${ (() => { test("nested",()=>{}); })() }`; })() }`;\ntest("real",()=>{});';
  assert.equal(countTestCalls(code), 2);
});
test("字串後的除法不能吞掉真測試", () => {
  assert.equal(countTestCalls('const x = "a" / 2; test("real",()=>{}); const r = /x/;'), 1);
});
test("模板及括號物件值後的除法不能吞掉真測試", () => {
  for (const value of ['`a`', '({a: 1})', '[1]', '10', '({}).return', 'function(){}', '(()=>{})']) {
    assert.equal(countTestCalls('const x = ' + value + ' / 2; test("real",()=>{}); const r = /x/;'), 1, value);
  }
});
test("return 後正規式的假 test 不算", () => {
  assert.equal(countTestCalls('function f(){ return /x;test(1);y/; }\ntest("real",()=>{});'), 1);
});
test("控制條件後正規式與普通呼叫後除法各自判別", () => {
  assert.equal(countTestCalls('if (true) /x;test(1);y/.test("x");\ntest("real",()=>{});'), 1);
  assert.equal(countTestCalls('const x = f() / 2; test("real",()=>{}); const r = /x/;'), 1);
  assert.equal(countTestCalls('const x = obj.if() / 2; test("real",()=>{}); const r = /x/;'), 1);
});
test("正規式轉義斜線字元類別及插值大括號不洩漏", () => {
  assert.equal(countTestCalls(String.raw`const r = /[};]test\(1\);\/x/; test("real",()=>{});`), 1);
  assert.equal(countTestCalls('const x = `${ (() => { const r = /[}];test(1);/; test("nested",()=>{}); })() }`;'), 1);
});
test("塊結束後正規式不洩漏，物件值後除法不漏數", () => {
  assert.equal(countTestCalls('if (true) {} /x;test(1);y/.test("x");\ntest("real",()=>{});'), 1);
  assert.equal(countTestCalls('const x = {a:1} / 2; test("real",()=>{}); const r = /x/;'), 1);
});
test("直接插值運算式、成員、別名仍不數，CRLF 及註解換行可數", () => {
  const code = 'const x = `${test("expression",()=>{})}`; obj.test("member"); latest("alias");\r\ntest /*x*/ ("real",()=>{});';
  assert.equal(countTestCalls(code), 1);
  assert.equal(countTestCalls('foo()/*\ncomment*/test("real",()=>{});'), 1);
});
test("未閉合字串模板插值註解正規式必須拋錯，不能靜默回零", () => {
  for (const code of ['const s = "x', 'const t = `x', 'const t = `${foo(', '/* never closed', 'const r = /x']) {
    assert.throws(() => countTestCalls(code, "broken.mjs"), /broken\.mjs/);
  }
  assert.throws(() => countTestCalls(null), TypeError);
});
