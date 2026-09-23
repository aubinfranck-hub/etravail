import { pool } from "../db.js";

export async function writeAudit(input: {
  actorId?: string;
  caseId?: string;
  action: string;
  metadata?: unknown;
}) {
  await pool.query(
    `INSERT INTO audit_logs (actor_id, case_id, action, metadata)
     VALUES ($1, $2, $3, $4)`,
    [input.actorId ?? null, input.caseId ?? null, input.action, input.metadata ?? null]
  );
}
