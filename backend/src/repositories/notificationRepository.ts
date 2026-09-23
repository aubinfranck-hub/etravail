import { pool } from "../db.js";

export async function listNotifications(userId: string) {
  const result = await pool.query(
    "SELECT id,user_id,case_id,channel,subject,body,sent_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC",
    [userId]
  );
  return result.rows;
}

export async function createNotification(input: {
  userId:string; caseId?:string; channel:string; subject:string; body:string;
}) {
  const result = await pool.query(
    `INSERT INTO notifications(user_id,case_id,channel,subject,body)
     VALUES($1,$2,$3,$4,$5)
     RETURNING id,user_id,case_id,channel,subject,body,sent_at,created_at`,
    [input.userId,input.caseId ?? null,input.channel,input.subject,input.body]
  );
  return result.rows[0];
}
