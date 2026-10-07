import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const counter=readFileSync(join(root,"test-call-count.mjs"),"utf8");
const data=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
function run(testFile,implementation){
 let source=readFileSync(join(root,testFile),"utf8").replace('"./test-call-count.mjs"',JSON.stringify(data(implementation)));
 source=source.replace('const here = dirname(fileURLToPath(import.meta.url));','const here = '+JSON.stringify(root)+';');
 return spawnSync(process.execPath,["--input-type=module","--eval","await import("+JSON.stringify(data(source))+");"],{encoding:"utf8",maxBuffer:8*1024*1024});
}
const stats=result=>({status:result.status,pass:Number(result.stdout.match(/\bpass\s+(\d+)/)?.[1]),fail:Number(result.stdout.match(/\bfail\s+(\d+)/)?.[1])});
for(const testFile of ["test-call-count.test.mjs","test-call-count-regression.test.mjs"]){
 const result=run(testFile,counter);assert.equal(result.status,0,result.stdout+result.stderr);console.log(JSON.stringify({mode:"normal",testFile,...stats(result)}));
}
const legacy=counter.replace('return [...neutralize(source,filename).matchAll(/(^|[\\n;{}])[ \\t]*test[ \\t]*\\(/g)].length;','return legacyRegexCount(source);');
assert.notEqual(legacy,counter,"legacy mutation anchor");
const original=run("test-call-count.test.mjs",legacy);
assert.equal(original.status,1,original.stdout+original.stderr);assert.equal(stats(original).fail,5);console.log(JSON.stringify({mode:"legacy",...stats(original)}));
const mutations=[
 ["strings-exposed",counter.replace('quoted(c); emit("VALUE",false);','const from=i; quoted(c); emit(src.slice(from,i),false);')],
 ["return-regex-disabled",counter.replace('expressions.has(word)','(expressions.has(word) && word !== "return")')],
];
for(const [mode,implementation] of mutations){
 assert.notEqual(implementation,counter,mode+" anchor");
 const result=run("test-call-count-regression.test.mjs",implementation);assert.equal(result.status,1,result.stdout+result.stderr);assert(stats(result).fail>0);console.log(JSON.stringify({mode,...stats(result)}));
}
const {countTestCalls,legacyRegexCount}=await import(data(counter));
const files=readdirSync(root).filter(n=>n.endsWith(".test.mjs")).sort();
let total=0;for(const file of files){const source=readFileSync(join(root,file),"utf8"),actual=countTestCalls(source,file),old=legacyRegexCount(source);total+=actual;if(actual!==old)console.log(JSON.stringify({file,actual,legacy:old}));}
console.log(JSON.stringify({files:files.length,staticDeclarations:total}));
let check=readFileSync(join(root,"check-version.mjs"),"utf8").replace('"./test-call-count.mjs"',JSON.stringify(data(legacy)));
check=check.replace('const here = dirname(fileURLToPath(import.meta.url));','const here = '+JSON.stringify(root)+';');
const result=spawnSync(process.execPath,["--input-type=module"],{input:"await import("+JSON.stringify(data(check))+");",encoding:"utf8",maxBuffer:8*1024*1024});
assert.equal(result.status,1,result.stdout+result.stderr);
assert.match(result.stdout,/test-call-count\.test\.mjs（8 條）.*寫 8 條，實際 3 條/);
console.log("PASS: actual check-version with legacy counter rejects documented 8 vs 3.");
if(process.argv[2]){
 const author=readFileSync(process.argv[2],"utf8");
 const result=run("test-call-count-regression.test.mjs",author);assert.equal(result.status,1);assert(stats(result).fail>0);console.log(JSON.stringify({mode:"actual-Claude-v83",...stats(result)}));
}
console.log("PASS independent counter positive/mutation/document-gate proofs; no official files changed.");
