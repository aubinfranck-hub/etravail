import { pool } from "../db.js";

export interface CaseRecord {
  id: string;
  reference: string;
  title: string;
  claimant_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function listCases(): Promise<CaseRecord[]> {
  const result = await pool.query(
    "SELECT id, reference, title, claimant_id, status, created_at, updated_at FROM cases ORDER BY created_at DESC"
  );
  return result.rows;
}

export async function createCase(input: {
  reference: string;
  title: string;
  claimantId: string;
}): Promise<CaseRecord> {
  const result = await pool.query(
    `INSERT INTO cases (reference, title, claimant_id)
     VALUES ($1, $2, $3)
     RETURNING id, reference, title, claimant_id, status, created_at, updated_at`,
    [input.reference, input.title, input.claimantId]
  );
  return result.rows[0];
}

export async function findCase(id: string): Promise<CaseRecord | null> {
  const result = await pool.query(
    "SELECT id, reference, title, claimant_id, status, created_at, updated_at FROM cases WHERE id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function updateCaseStatus(id: string, status: string): Promise<CaseRecord | null> {
  const result = await pool.query(
    `UPDATE cases SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id, reference, title, claimant_id, status, created_at, updated_at`,
    [status, id]
  );
  return result.rows[0] ?? null;
}
