import { pool } from "../db.js";

export async function searchDocuments(query: string) {
  const result = await pool.query(
    `SELECT id, case_id, filename, mime_type,
            ts_headline('french', coalesce(ocr_text,''), websearch_to_tsquery('french',$1)) AS excerpt
     FROM documents
     WHERE to_tsvector('french', coalesce(ocr_text,'')) @@ websearch_to_tsquery('french',$1)
     ORDER BY ts_rank(to_tsvector('french', coalesce(ocr_text,'')), websearch_to_tsquery('french',$1)) DESC
     LIMIT 50`,
    [query]
  );
  return result.rows;
}
