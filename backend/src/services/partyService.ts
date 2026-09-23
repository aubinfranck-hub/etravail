import { createParty, listParties } from "../repositories/partyRepository.js";

export function getParties(caseId: string) {
  return listParties(caseId);
}

export function addParty(input: { caseId: string; type: string; fullName: string; contact?: string }) {
  if (!input.fullName.trim()) throw new Error("INVALID_PARTY");
  return createParty(input);
}
