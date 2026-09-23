import {pool} from "../db.js";
export async function listCalendar(role:string,userId:string,caseId?:string){
 const args:any[]=[]; const filters:string[]=["x.scheduled_at>=CURRENT_TIMESTAMP"]; let idx=1;
 if(role==="CITOYEN"){args.push(userId);filters.push(`c.claimant_id=$${idx++}`);}
 if(caseId){args.push(caseId);filters.push(`x.case_id=$${idx++}`);}
 const q=`SELECT x.* FROM ((SELECT h.id,h.case_id,h.scheduled_at,h.room,h.status,'AUDIENCE' AS type FROM hearings h) UNION ALL (SELECT co.id,co.case_id,co.scheduled_at,co.room,co.status,'CONCILIATION' AS type FROM conciliations co)) x JOIN cases c ON c.id=x.case_id WHERE ${filters.join(" AND ")} ORDER BY x.scheduled_at LIMIT 200`;
 const r=await pool.query(q,args);return r.rows;
}
