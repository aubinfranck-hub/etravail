import { pool } from "../db.js";

export async function createDecision(input:{caseId:string;reference?:string;content:string}) {
  const result=await pool.query(
    `INSERT INTO decisions(case_id,decision_reference,content)
     VALUES($1,$2,$3)
     RETURNING id,case_id,decision_reference,content,created_at`,
    [input.caseId,input.reference??null,input.content]
  );
  return result.rows[0];
}

export async function listDecisions(caseId:string) {
  const result=await pool.query(
    "SELECT id,case_id,decision_reference,content,created_at FROM decisions WHERE case_id=$1 ORDER BY created_at DESC",
    [caseId]
  );
  return result.rows;
}
