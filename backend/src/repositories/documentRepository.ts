import { pool } from "../db.js";

export async function findDocumentById(id:string){const r=await pool.query("SELECT id,case_id,uploaded_by,filename,storage_key,mime_type,file_size,ocr_text,created_at FROM documents WHERE id=$1",[id]);return r.rows[0]??null;}

export async function listDocuments(caseId: string) {
  const result = await pool.query(
    "SELECT id,case_id,uploaded_by,filename,storage_key,mime_type,file_size,ocr_text,created_at FROM documents WHERE case_id=$1 ORDER BY created_at DESC",
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
  ocrText?: string | null;
}) {
  const result = await pool.query(
    `INSERT INTO documents(case_id,uploaded_by,filename,storage_key,mime_type,file_size,ocr_text)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     RETURNING id,case_id,uploaded_by,filename,storage_key,mime_type,file_size,ocr_text,created_at`,
    [input.caseId,input.uploadedBy,input.filename,input.storageKey,input.mimeType ?? null,input.fileSize ?? null,input.ocrText ?? null]
  );
  return result.rows[0];
}

export async function updateOCRText(id: string, text: string | null) {
  const result = await pool.query(
    "UPDATE documents SET ocr_text=$1 WHERE id=$2 RETURNING id,ocr_text",
    [text, id]
  );
  return result.rows[0] ?? null;
}
