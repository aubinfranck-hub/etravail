import { pool } from "../db.js";

export async function listDocuments(caseId: string) {
  const result = await pool.query(
    "SELECT id,case_id,uploaded_by,filename,storage_key,mime_type,file_size,created_at FROM documents WHERE case_id=$1 ORDER BY created_at DESC",
    [caseId]
  );
  return result.rows;
}

export async function createDocument(input: {
  caseId: string;
  uploadedBy: string;
  filename: string;
  storageKey: string;
  mimeType?: string;
  fileSize?: number;
}) {
  const result = await pool.query(
    `INSERT INTO documents(case_id,uploaded_by,filename,storage_key,mime_type,file_size)
     VALUES($1,$2,$3,$4,$5,$6)
     RETURNING id,case_id,uploaded_by,filename,storage_key,mime_type,file_size,created_at`,
    [input.caseId,input.uploadedBy,input.filename,input.storageKey,input.mimeType ?? null,input.fileSize ?? null]
  );
  return result.rows[0];
}
