import { createHearing, listHearings } from "../repositories/hearingRepository.js";

export function getHearings(caseId:string) { return listHearings(caseId); }

export async function scheduleHearing(input:{caseId:string;scheduledAt:string;room?:string}) {
  const date = new Date(input.scheduledAt);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_DATE");
  if (date.getTime() <= Date.now()) throw new Error("DATE_IN_PAST");
  return createHearing(input);
}
