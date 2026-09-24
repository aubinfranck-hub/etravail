import crypto from "node:crypto";
import {pool} from "../db.js";

export async function writeAudit(i:{actorId?:string;caseId?:string;action:string;metadata?:unknown;actorRole?:string;ipAddress?:string;userAgent?:string}){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    // Serialize the global audit chain so concurrent writes cannot share the same previous_hash.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('etravail:audit-chain'))");
    const prev=await client.query("SELECT event_hash FROM audit_logs ORDER BY created_at DESC,id DESC LIMIT 1");
    const previousHash=prev.rows[0]?.event_hash??null;
    const createdAt=new Date().toISOString();
    const payload=JSON.stringify({actorId:i.actorId??null,caseId:i.caseId??null,action:i.action,metadata:i.metadata??null,actorRole:i.actorRole??null,createdAt,previousHash});
    const eventHash=crypto.createHash("sha256").update(payload).digest("hex");
    await client.query(
      "INSERT INTO audit_logs(actor_id,case_id,action,metadata,actor_role,ip_address,user_agent,previous_hash,event_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [i.actorId??null,i.caseId??null,i.action,i.metadata??null,i.actorRole??null,i.ipAddress??null,i.userAgent??null,previousHash,eventHash,createdAt]
    );
    await client.query("COMMIT");
    return {eventHash,createdAt};
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{
    client.release();
  }
}
export async function listAudit(caseId:string){
  const r=await pool.query(`SELECT a.id,a.case_id,a.action,a.metadata,a.created_at,a.actor_role,a.ip_address,a.user_agent,a.previous_hash,a.event_hash,u.full_name AS actor_name,u.role AS current_actor_role
    FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.case_id=$1 ORDER BY a.created_at ASC,a.id ASC`,[caseId]);
  return r.rows;
}
export async function listAuditAll(limit=500){
  const r=await pool.query(`SELECT a.id,a.case_id,a.action,a.metadata,a.created_at,a.actor_role,a.ip_address,a.user_agent,a.previous_hash,a.event_hash,
    u.full_name AS actor_name,u.role AS current_actor_role,c.reference AS case_reference
    FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN cases c ON c.id=a.case_id
    ORDER BY a.created_at DESC,a.id DESC LIMIT $1`,[Math.min(Math.max(limit,1),1000)]);
  return r.rows;
}
