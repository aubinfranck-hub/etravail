import { pool } from "../db.js";

export async function listHearings(caseId: string) {
  const result = await pool.query(
    "SELECT id,case_id,scheduled_at,room,status FROM hearings WHERE case_id=$1 ORDER BY scheduled_at",
    [caseId]
  );
  return result.rows;
}

export async function createHearing(input: { caseId:string; scheduledAt:string; room?:string }) {
  const result = await pool.query(
    `INSERT INTO hearings(case_id,scheduled_at,room)
     VALUES($1,$2,$3)
     RETURNING id,case_id,scheduled_at,room,status`,
    [input.caseId,input.scheduledAt,input.room ?? null]
  );
  return result.rows[0];
}
