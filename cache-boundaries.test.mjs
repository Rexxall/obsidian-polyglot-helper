import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import esbuild from 'esbuild';
import path from 'node:path';
const source = esbuild.buildSync({entryPoints:[path.join(import.meta.dirname,'src/cache-manager.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['obsidian']}).outputFiles[0].text;
function fixture() {
 const exports={}; const context={module:{exports},exports,require:()=>({Notice:class{}}),console};vm.runInNewContext(source,context);
 const removed=[],scanned=[];const app={vault:{adapter:{exists:async p=>{scanned.push(p);return false},remove:async p=>removed.push(p)}}};
 const logger={info(){},warn(){},error(){}};
 return {manager:new context.module.exports.CacheManager(app,logger,'.obsidian_mac/plugins/polyglot'),removed,scanned};
}
test('scans only private cache roots, never note audio folders',async()=>{
 const f=fixture();await f.manager.scanAllCache();assert.deepEqual(f.scanned,['.obsidian_mac/plugins/polyglot/.cache','.obsidian_mac/plugins/polyglot/voice-cache']);
});
test('rejects note assets, traversal and sibling prefixes when deleting',async()=>{
 const f=fixture();const root='.obsidian_mac/plugins/polyglot';
 const result=await f.manager.deleteItems(['Audio/lesson.mp3',root+'/voice-cache/../../note.md',root+'/voice-cache-other/a.mp3',root+'/.cache/one.json',root+'/voice-cache/one.mp3'].map(path=>({path})));
 assert.equal(result.success,2);assert.equal(result.failed,3);assert.deepEqual(f.removed,[root+'/.cache/one.json',root+'/voice-cache/one.mp3']);
});
