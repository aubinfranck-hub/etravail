import { pool } from "../db.js";

export async function getDashboard(role:string, userId:string) {
  const cases = await pool.query(
    role === "CITOYEN"
      ? "SELECT status, COUNT(*)::int AS count FROM cases WHERE claimant_id=$1 GROUP BY status"
      : "SELECT status, COUNT(*)::int AS count FROM cases GROUP BY status",
    role === "CITOYEN" ? [userId] : []
  );
  const hearings = await pool.query(
    role === "CITOYEN"
      ? "SELECT COUNT(*)::int AS count FROM hearings h JOIN cases c ON c.id=h.case_id WHERE c.claimant_id=$1 AND h.scheduled_at > CURRENT_TIMESTAMP"
      : "SELECT COUNT(*)::int AS count FROM hearings WHERE scheduled_at > CURRENT_TIMESTAMP",
    role === "CITOYEN" ? [userId] : []
  );
  return { role, casesByStatus: cases.rows, upcomingHearings: hearings.rows[0]?.count ?? 0 };
}
