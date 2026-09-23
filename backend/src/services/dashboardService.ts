import { pool } from "../db.js";
import { getUnreadNotificationCount } from "./notificationService.js";

export async function getDashboard(role:string,userId:string){
  const params=role==="CITOYEN"||role==="GREFFE"||role==="MAGISTRAT"?[userId]:[];
  const where=role==="CITOYEN"?"WHERE claimant_id=$1":role==="ADMIN"?"":"WHERE assigned_to=$1";
  const cases=await pool.query(`SELECT status,COUNT(*)::int AS count FROM cases ${where} GROUP BY status ORDER BY status`,params);
  const hearings=await pool.query(
    role==="CITOYEN"
      ? "SELECT COUNT(*)::int AS count FROM hearings h JOIN cases c ON c.id=h.case_id WHERE c.claimant_id=$1 AND h.scheduled_at>CURRENT_TIMESTAMP"
      : role==="ADMIN"
        ? "SELECT COUNT(*)::int AS count FROM hearings WHERE scheduled_at>CURRENT_TIMESTAMP"
        : "SELECT COUNT(*)::int AS count FROM hearings h JOIN cases c ON c.id=h.case_id WHERE c.assigned_to=$1 AND h.scheduled_at>CURRENT_TIMESTAMP",
    params
  );
  const queue=await pool.query(`SELECT
    COUNT(*) FILTER (WHERE status<>'ARCHIVE')::int AS pending,
    COUNT(*) FILTER (WHERE status<>'ARCHIVE' AND due_at IS NOT NULL AND due_at<=CURRENT_TIMESTAMP + INTERVAL '24 hours')::int AS due_soon,
    COUNT(*) FILTER (WHERE status<>'ARCHIVE' AND due_at IS NOT NULL AND due_at<CURRENT_TIMESTAMP)::int AS overdue
    FROM cases ${where}`,params);
  const documents=await pool.query(`SELECT COUNT(*)::int AS count FROM documents d JOIN cases c ON c.id=d.case_id ${where.replace("WHERE claimant_id","WHERE c.claimant_id").replace("WHERE assigned_to","WHERE c.assigned_to")}`,params);
  return {
    role,
    casesByStatus:cases.rows,
    upcomingHearings:Number(hearings.rows[0]?.count??0),
    pendingCases:Number(queue.rows[0]?.pending??0),
    dueSoon:Number(queue.rows[0]?.due_soon??0),
    overdueCases:Number(queue.rows[0]?.overdue??0),
    unreadNotifications:await getUnreadNotificationCount(userId),
    documents:Number(documents.rows[0]?.count??0)
  };
}
