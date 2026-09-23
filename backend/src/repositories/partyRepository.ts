import { pool } from "../db.js";

export async function listParties(caseId: string) {
  const result = await pool.query(
    "SELECT id,case_id,type,full_name,contact,created_at FROM parties WHERE case_id=$1 ORDER BY created_at",
    [caseId]
  );
  return result.rows;
}

export async function createParty(input: {
  caseId: string;
  type: string;
  fullName: string;
  contact?: string;
}) {
  const result = await pool.query(
    `INSERT INTO parties(case_id,type,full_name,contact)
     VALUES($1,$2,$3,$4)
     RETURNING id,case_id,type,full_name,contact,created_at`,
    [input.caseId, input.type, input.fullName, input.contact ?? null]
  );
  return result.rows[0];
}
