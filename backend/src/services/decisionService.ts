import { createDecision, listDecisions } from "../repositories/decisionRepository.js";

export function getDecisions(caseId:string){return listDecisions(caseId);}

export async function issueDecision(input:{caseId:string;reference?:string;content:string}) {
  if(input.content.trim().length<10) throw new Error("DECISION_TOO_SHORT");
  return createDecision(input);
}
