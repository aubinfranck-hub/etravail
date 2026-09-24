import { pool } from "../db.js";
import { createNotification, listNotifications, unreadNotificationCount, markNotificationRead as markRead } from "../repositories/notificationRepository.js";

export function getNotifications(userId:string){ return listNotifications(userId); }
export function getUnreadNotificationCount(userId:string){ return unreadNotificationCount(userId); }
export function markNotificationRead(id:string,userId:string){ return markRead(id,userId); }

export async function notify(input:{userId:string;caseId?:string;channel:string;subject:string;body:string}){
  if(!["IN_APP","EMAIL"].includes(input.channel)) throw new Error("INVALID_CHANNEL");
  return createNotification(input);
}

export async function notifyCaseParticipants(input:{caseId:string;stage?:string;subject:string;body:string;includeClaimant?:boolean}){
  const caseResult=await pool.query("SELECT claimant_id,assigned_to FROM cases WHERE id=$1 LIMIT 1",[input.caseId]);
  if(!caseResult.rowCount) return 0;
  const recipients=new Set<string>();
  if(input.includeClaimant!==false && caseResult.rows[0].claimant_id) recipients.add(String(caseResult.rows[0].claimant_id));
  if(caseResult.rows[0].assigned_to) recipients.add(String(caseResult.rows[0].assigned_to));
  if(input.stage){
    const agents=await pool.query(
      "SELECT DISTINCT u.id FROM users u JOIN user_stage_access usa ON usa.user_id=u.id WHERE u.active=true AND usa.stage_key=$1 AND u.role IN ('GREFFE','MAGISTRAT','ADMIN')",
      [input.stage]
    );
    for(const row of agents.rows) recipients.add(String(row.id));
  }
  let created=0;
  for(const userId of recipients){
    await notify({userId,caseId:input.caseId,channel:"IN_APP",subject:input.subject,body:input.body});
    created++;
  }
  return created;
}
