import { createCase, findCase, listCases, updateCaseStatus, assignCase } from "../repositories/caseRepository.js";
import { writeAudit } from "../repositories/auditRepository.js";
import { canTransition, CaseStatus } from "../domain/workflow.js";

export async function getCases() {
  return listCases();
}

export async function openCase(input: { claimantId: string; title: string; actorId: string }) {
  const reference = `ET-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
  const item = await createCase({ reference, title: input.title, claimantId: input.claimantId });
  await writeAudit({ actorId: input.actorId, caseId: item.id, action: "CASE_CREATED", metadata: { reference } });
  return item;
}

export async function transitionCase(input: { id: string; next: CaseStatus; actorId: string }) {
  const item = await findCase(input.id);
  if (!item) throw new Error("CASE_NOT_FOUND");
  if (!canTransition(item.status as CaseStatus, input.next)) throw new Error("INVALID_TRANSITION");
  const updated = await updateCaseStatus(input.id, input.next);
  await writeAudit({
    actorId: input.actorId,
    caseId: input.id,
    action: "CASE_STATUS_CHANGED",
    metadata: { from: item.status, to: input.next }
  });
  return updated;
}

export async function assignCaseTo(input:{id:string;assignedTo:string|null;assignedRole:string|null;actorId:string}){
 const item=await findCase(input.id); if(!item) throw new Error("CASE_NOT_FOUND");
 const updated=await assignCase(input.id,input.assignedTo,input.assignedRole);
 await writeAudit({actorId:input.actorId,caseId:input.id,action:"CASE_ASSIGNED",metadata:{assignedTo:input.assignedTo,assignedRole:input.assignedRole}});
 return updated;
}
