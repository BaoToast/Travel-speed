/*
 * 本專案的裸 test(...) 宣告計數（不是 AST 或執行次數）。
 * 保留行首／;／{／} 後的 test( 判準，不數別名／成員／直接插值運算式。
 * v2.20.84：插值遞迴詞彙掃描；以 token 上下文區分除法／正規式。
 * 舊法誤吃 manual-names 字串間的 2 行／54 字元，不是 36 行／1,079 字元。
 */
function neutralize(src, filename) {
  let i = 0;
  const fail = (why) => { throw new Error(filename + ": 第 " + src.slice(0, i).split("\n").length + " 行：" + why); };
  const start = (c) => !!c && /[$_\p{ID_Start}]/u.test(c);
  const part = (c) => !!c && /[$_\u200c\u200d\p{ID_Continue}]/u.test(c);
  const controls = new Set(["if", "while", "for", "with", "switch", "catch"]);
  const expressions = new Set(["return", "throw", "case", "delete", "void", "typeof", "new", "yield", "await", "in", "instanceof", "of", "else", "do"]);
  function quoted(q) {
    i++;
    while (i < src.length) {
      if (src[i] === "\\") i += src[i+1] === "\r" && src[i+2] === "\n" ? 3 : 2;
      else if (src[i] === q) { i++; return; }
      else if (src[i] === "\n" || src[i] === "\r") fail("字串沒有收尾");
      else i++;
    }
    fail("字串沒有收尾");
  }
  function regex() {
    i++;
    let inClass = false;
    while (i < src.length) {
      const c = src[i];
      if (c === "\n" || c === "\r") fail("正規式沒有收尾");
      if (c === "\\") { i += 2; continue; }
      if (inClass) { if (c === "]") inClass = false; }
      else if (c === "[") inClass = true;
      else if (c === "/") { i++; while (part(src[i])) i++; return; }
      i++;
    }
    fail("正規式沒有收尾");
  }
  function template() {
    i++;
    let out = "VALUE";
    while (i < src.length) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "`") { i++; return out; }
      if (src[i] === "$" && src[i+1] === "{") {
        i += 2;
        // 插值保持運算式位置，但內部 block／分號後的宣告可被計數。
        out += "(" + scan(true) + ")";
      } else i++;
    }
    fail("樣板字串沒有收尾");
  }
  function scan(interpolation = false) {
    let out = "", previous = "", regexAllowed = true;
    let controlCandidate = false, pendingFunction, functionBodyValue;
    const parentheses = [], braces = [];
    const emit = (token, nextRegex) => { out += token; previous = token; regexAllowed = nextRegex; controlCandidate = false; };
    while (i < src.length) {
      const c = src[i], d = src[i+1];
      if (/\s/.test(c)) { out += c; i++; continue; }
      if (c === "/" && d === "*") {
        const end = src.indexOf("*/", i+2);
        if (end < 0) fail("區塊註解沒有收尾");
        out += " " + (src.slice(i,end+2).match(/[\r\n]/g) || []).join("");
        i = end+2; continue;
      }
      if (c === "/" && d === "/") {
        const end = src.indexOf("\n", i+2);
        i = end < 0 ? src.length : end; out += " "; continue;
      }
      if (c === '"' || c === "'") { quoted(c); emit("VALUE",false); continue; }
      if (c === "`") { emit(template(),false); continue; }
      if (c === "/" && regexAllowed) { regex(); emit("VALUE",false); continue; }
      if (start(c)) {
        const from = i++;
        while (part(src[i])) i++;
        const word = src.slice(from,i);
        const member = previous === "." || previous === "?.";
        if (!member && word === "function") {
          pendingFunction = !["", ";", "{", "}", "export", "default"].includes(previous);
        }
        emit(word,!member && expressions.has(word));
        controlCandidate = !member && controls.has(word);
        continue;
      }
      if (/[0-9]/.test(c)) {
        const from = i++;
        while (i < src.length && /[0-9A-Za-z_.]/.test(src[i])) i++;
        emit(src.slice(from,i),false); continue;
      }
      if (c === "(") {
        parentheses.push({control: controlCandidate, functionValue: pendingFunction});
        pendingFunction = undefined;
        emit(c,true); i++; continue;
      }
      if (c === ")") {
        const context = parentheses.pop();
        functionBodyValue = context?.functionValue;
        emit(c,context?.control === true); i++; continue;
      }
      if (c === "{") {
        const valueBody = previous === "=>" || functionBodyValue === true;
        braces.push(!valueBody && ["",")",";","{","}","else","do","try","finally"].includes(previous));
        functionBodyValue = undefined;
        emit(c,true); i++; continue;
      }
      if (c === "}") {
        if (interpolation && braces.length === 0) { i++; return out; }
        emit(c,braces.pop() === true); i++; continue;
      }
      if (c === "]") { emit(c,false); i++; continue; }
      if ((c === "+" && d === "+") || (c === "-" && d === "-")) { emit(c+d,regexAllowed); i+=2; continue; }
      if ((c === "=" && d === ">") || (c === "?" && d === ".")) { emit(c+d,c === "="); i+=2; continue; }
      emit(c,c !== "."); i++;
    }
    if (interpolation) fail("樣板插值沒有收尾");
    return out;
  }
  return scan();
}

/** 非完整語法分析器，不宣稱判斷 binding／動態註冊次數／所有 JS 語法錯誤。 */
export function countTestCalls(source, filename = "(未命名)") {
  if (typeof source !== "string") throw new TypeError(filename + ": 要傳字串");
  return [...neutralize(source,filename).matchAll(/(^|[\n;{}])[ \t]*test[ \t]*\(/g)].length;
}

/** 前版有缺陷的寫法只留作反證，正式文件守門不得呼叫。 */
export function legacyRegexCount(source) {
  const body = source.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^[ \t]*\/\/[^\n]*$/gm,"");
  return (body.match(/^\s*test\(/gm) || []).length;
}
