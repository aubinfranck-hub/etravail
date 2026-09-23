export type CaseStatus =
  | "BROUILLON" | "SOUMIS" | "RECU_GREFFE" | "A_VERIFIER"
  | "COMPLET" | "INCOMPLET" | "CONCILIATION"
  | "AUDIENCE_PLANIFIEE" | "AUDIENCE" | "DECISION_RENDUE"
  | "NOTIFIE" | "ARCHIVE";

export const transitions: Record<CaseStatus, CaseStatus[]> = {
  BROUILLON: ["SOUMIS"],
  SOUMIS: ["RECU_GREFFE"],
  RECU_GREFFE: ["A_VERIFIER"],
  A_VERIFIER: ["COMPLET", "INCOMPLET"],
  COMPLET: ["CONCILIATION"],
  INCOMPLET: ["SOUMIS"],
  CONCILIATION: ["AUDIENCE_PLANIFIEE", "DECISION_RENDUE"],
  AUDIENCE_PLANIFIEE: ["AUDIENCE"],
  AUDIENCE: ["DECISION_RENDUE"],
  DECISION_RENDUE: ["NOTIFIE"],
  NOTIFIE: ["ARCHIVE"],
  ARCHIVE: []
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return transitions[from]?.includes(to) ?? false;
}
