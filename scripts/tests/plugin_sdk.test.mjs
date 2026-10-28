import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../../src-tauri/src/services/plugin_runtime/product.js',import.meta.url),'utf8');
function fixture(){
 const listeners=new Map(),calls=[];const invoke=async(...args)=>{calls.push(args);return null;};const window={addEventListener:(name,handler)=>listeners.set(name,handler)};
 vm.runInNewContext(script,{window,AbortController,Promise,Map,Set});
 const sdk=window.__echobirdProduct(invoke,{pluginId:'fixture.tools',commands:['format','slow'],textProcessors:['clean']});return{window,sdk,calls,listeners};
}
test('SDK activation does not run commands or write data and confines calls to typed IPC',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);f.listeners.get('load')();await Promise.resolve();assert.equal(f.calls.at(-1)[0],'plugin_host_call');assert.equal(f.calls.at(-1)[1].operation,'ready');await f.sdk.configuration.get('mode');assert.equal(f.calls.at(-1)[1].operation,'configuration.get');assert.equal(f.calls.at(-1)[1].input.key,'mode');await f.sdk.events.emit('done',{length:1});assert.equal(f.calls.at(-1)[1].input.key,'fixture.tools.done');
});
test('SDK dispatches only declared handlers and disposes registrations',async()=>{
 const f=fixture();assert.throws(()=>f.sdk.commands.register('undeclared',()=>null));const handler=input=>input.text.trim();const disposable=f.sdk.commands.register('format',handler);assert.throws(()=>f.sdk.commands.register('format',handler));await f.window.__echobirdDispatch({requestId:'one',kind:'command',id:'format',input:{text:' hello '}});assert.equal(f.calls.at(-1)[0],'plugin_host_result');assert.equal(f.calls.at(-1)[1].value,'hello');disposable.dispose();await f.window.__echobirdDispatch({requestId:'two',kind:'command',id:'format',input:{}});assert.equal(f.calls.at(-1)[1].error,'Extension failed');
});
test('SDK aborts pending work on cancellation and does not return late results',async()=>{
 const f=fixture();let done,signal;f.sdk.commands.register('slow',(_,context)=>{signal=context.signal;return new Promise(resolve=>{done=resolve;});});const pending=f.window.__echobirdDispatch({requestId:'slow',kind:'command',id:'slow',input:null});f.window.__echobirdCancel('slow');assert.equal(signal.aborted,true);done('late');await pending;assert.equal(f.calls.length,0);
});
test('SDK keeps subscriptions until the last listener leaves and cleans up lifecycle state',async()=>{
 const f=fixture();let first=0,second=0,cleaned=0;const a=await f.sdk.events.on('echo.theme.changed',()=>{first++;}),b=await f.sdk.events.on('echo.theme.changed',()=>{second++;});f.window.__echobirdEvent({topic:'echo.theme.changed',value:{}});await Promise.resolve();assert.equal(first,1);assert.equal(second,1);f.calls.length=0;await a.dispose();assert.equal(f.calls.length,0);await b.dispose();assert.equal(f.calls.at(-1)[1].operation,'events.unsubscribe');f.sdk.lifecycle.onDispose(()=>{cleaned++;});f.listeners.get('beforeunload')();f.window.__echobirdEvent({topic:'echo.theme.changed',value:{}});await Promise.resolve();assert.equal(cleaned,1);assert.equal(first,1);
});

test('concurrent event listeners share one subscription and disposal precedes resubscription',async()=>{const listeners=new Map(),operations=[];let finish;let held=false;const window={addEventListener:(name,handler)=>listeners.set(name,handler)};const invoke=async(_,{operation})=>{operations.push(operation);if(operation==='events.unsubscribe'&&!held){held=true;await new Promise(resolve=>{finish=resolve;});}};vm.runInNewContext(script,{window,AbortController,Promise,Map,Set});const sdk=window.__echobirdProduct(invoke,{pluginId:'fixture.tools',commands:[],textProcessors:[]});const [a,b]=await Promise.all([sdk.events.on('echo.theme.changed',()=>{}),sdk.events.on('echo.theme.changed',()=>{})]);assert.deepEqual(operations,['events.subscribe']);await a.dispose();const old=b.dispose();await Promise.resolve();await Promise.resolve();const next=sdk.events.on('echo.theme.changed',()=>{});await Promise.resolve();assert.deepEqual(operations,['events.subscribe','events.unsubscribe']);finish();await old;const current=await next;assert.deepEqual(operations,['events.subscribe','events.unsubscribe','events.subscribe']);await b.dispose();assert.equal(operations.length,3);await current.dispose();assert.equal(operations.at(-1),'events.unsubscribe');});
