import { isAuthorizedOperatorRequest } from './auth.mjs';

const EVENTS=new Set(['ci_success','ci_failure','deploy_success','deploy_failure']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeMetadata(payload={}) {
  const metadata={};
  if (Number.isSafeInteger(payload.runId) && payload.runId > 0) metadata.runId=payload.runId;
  if (typeof payload.commitSha === 'string' && /^[0-9a-f]{3,64}$/i.test(payload.commitSha)) metadata.commitSha=payload.commitSha;
  if (typeof payload.deploymentId === 'string' && /^[A-Za-z0-9_.-]{1,120}$/.test(payload.deploymentId)) metadata.deploymentId=payload.deploymentId;
  if (Number.isSafeInteger(payload.prNumber) && payload.prNumber > 0) metadata.prNumber=payload.prNumber;
  return metadata;
}

function isInvalidTransition(error) {
  return error instanceof Error && /^invalid repair transition(?:\b|:)/i.test(error.message);
}

export async function handleRepairCallback({authorization,secret,payload,db}) {
  if (!isAuthorizedOperatorRequest(authorization,secret)) return {status:401,body:{ok:false}};
  if (!payload || typeof payload.repairId !== 'string' || !UUID.test(payload.repairId) || !EVENTS.has(payload.event)) {
    return {status:400,body:{ok:false}};
  }
  try {
    const result=await db.applyRepairEvent({repairId:payload.repairId,event:payload.event,metadata:safeMetadata(payload)});
    return {status:200,body:{ok:true,...result}};
  } catch (error) {
    if (isInvalidTransition(error)) return {status:409,body:{ok:false,error:'invalid_transition'}};
    throw error;
  }
}
