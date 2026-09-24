import { createDecision, listDecisions } from "../repositories/decisionRepository.js";

export function getDecisions(caseId:string){return listDecisions(caseId);}

export function decisionStageAllowed(status:string){ return status==="AUDIENCE"; }

export async function issueDecision(input:{caseId:string;reference?:string;content:string}) {
  if(input.content.trim().length<10) throw new Error("DECISION_TOO_SHORT");
  return createDecision(input);
}
