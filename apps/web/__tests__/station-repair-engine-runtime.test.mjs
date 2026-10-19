import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepairEngineRuntime } from '../lib/station-operator/repair-engine-runtime.mjs';

test('repair engine runtime wires only bounded server-side capabilities',()=>{
  const discoverContext=async()=>({ok:true,context:[]});
  const callModel=async()=>'{"ok":true}';
  const writeRepair=async()=>({ok:true});
  const execute=async input=>input;
  const runtime=buildRepairEngineRuntime({discoverContext,callModel,writeRepair,execute});
  assert.equal(typeof runtime.execute,'function');
  assert.deepEqual(Object.keys(runtime).sort(),['execute']);
});

test('repair engine runtime passes the three constrained capabilities to core execution',async()=>{
  const discoverContext=async()=>({ok:true,context:[]});
  const callModel=async()=>'{"ok":true}';
  const writeRepair=async()=>({ok:true});
  let received;
  const execute=async input=>{received=input;return{ok:true};};
  const runtime=buildRepairEngineRuntime({discoverContext,callModel,writeRepair,execute});
  const input={authenticated:true,mode:'allowlist',repair:{id:'r1'},request:{repairId:'r1'}};
  assert.deepEqual(await runtime.execute(input),{ok:true});
  assert.equal(received.discoverContext,discoverContext);
  assert.equal(received.callModel,callModel);
  assert.equal(received.writeRepair,writeRepair);
  assert.equal(received.authenticated,true);
  assert.equal(received.mode,'allowlist');
});

test('repair engine runtime fails closed when any required capability is missing',()=>{
  const noop=async()=>({ok:true});
  assert.throws(()=>buildRepairEngineRuntime({callModel:noop,writeRepair:noop,execute:noop}));
  assert.throws(()=>buildRepairEngineRuntime({discoverContext:noop,writeRepair:noop,execute:noop}));
  assert.throws(()=>buildRepairEngineRuntime({discoverContext:noop,callModel:noop,execute:noop}));
  assert.throws(()=>buildRepairEngineRuntime({discoverContext:noop,callModel:noop,writeRepair:noop}));
});
