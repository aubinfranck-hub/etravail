import { pool } from "../db.js";

export interface CaseRecord {
  id: string;
  reference: string;
  title: string;
  claimant_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  assigned_to?: string | null;
  assigned_role?: string | null;
  nature_code?: string | null;
  due_at?: string | null;
}

export async function listCases(): Promise<CaseRecord[]> {
  const result = await pool.query(
    "SELECT id, reference, title, claimant_id, status, assigned_to, assigned_role, nature_code, due_at, created_at, updated_at FROM cases ORDER BY created_at DESC"
  );
  return result.rows;
}

export async function createCase(input: {
  reference: string;
  title: string;
  claimantId: string;
  natureCode?: string;
}): Promise<CaseRecord> {
  const result = await pool.query(
    `INSERT INTO cases (reference, title, claimant_id, nature_code)
     VALUES ($1, $2, $3, $4)
     RETURNING id, reference, title, claimant_id, status, assigned_to, assigned_role, nature_code, due_at, created_at, updated_at`,
    [input.reference, input.title, input.claimantId, input.natureCode ?? 'AUTRE']
  );
  return result.rows[0];
}

export async function findCase(id: string): Promise<CaseRecord | null> {
  const result = await pool.query(
    "SELECT id, reference, title, claimant_id, status, assigned_to, assigned_role, nature_code, due_at, created_at, updated_at FROM cases WHERE id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function updateCaseStatus(id: string, status: string): Promise<CaseRecord | null> {
  const result = await pool.query(
    `UPDATE cases SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id, reference, title, claimant_id, status, assigned_to, assigned_role, nature_code, due_at, created_at, updated_at`,
    [status, id]
  );
  return result.rows[0] ?? null;
}

export async function assignCase(id:string, assignedTo:string|null, assignedRole:string|null):Promise<CaseRecord|null>{
  const r=await pool.query(`UPDATE cases SET assigned_to=$2, assigned_role=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,reference,title,claimant_id,status,assigned_to,assigned_role,nature_code,due_at,created_at,updated_at`,[id,assignedTo,assignedRole]);
  return r.rows[0]??null;
}
