import { pool } from "../db.js";

export async function listNotifications(userId: string) {
  const result = await pool.query(
    "SELECT id,user_id,case_id,channel,subject,body,sent_at,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC",
    [userId]
  );
  return result.rows;
}
export async function unreadNotificationCount(userId:string){
  const r=await pool.query("SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL",[userId]);
  return Number(r.rows[0]?.count??0);
}
export async function createNotification(input:{userId:string;caseId?:string;channel:string;subject:string;body:string}){
  const result=await pool.query(
    `INSERT INTO notifications(user_id,case_id,channel,subject,body,sent_at)
     VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
     RETURNING id,user_id,case_id,channel,subject,body,sent_at,read_at,created_at`,
    [input.userId,input.caseId??null,input.channel,input.subject,input.body]
  );
  return result.rows[0];
}
export async function markNotificationRead(id:string,userId:string){
  const r=await pool.query("UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=$1 AND user_id=$2 RETURNING id,user_id,read_at",[id,userId]);
  if(!r.rowCount) throw new Error("NOTIFICATION_NOT_FOUND");
  return r.rows[0];
}
