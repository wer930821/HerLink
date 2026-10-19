export function buildRepairEngineRuntime({discoverContext,callModel,writeRepair,execute}={}) {
  if ([discoverContext,callModel,writeRepair,execute].some(fn=>typeof fn !== 'function')) throw new Error('repair engine capability missing');
  return {
    execute(input={}) {
      return execute({...input,discoverContext,callModel,writeRepair});
    },
  };
}
