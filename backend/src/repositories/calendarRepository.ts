import {pool} from "../db.js";
export async function listCalendar(role:string,userId:string,caseId?:string){
 const args:any[]=[userId]; let filter=""; let idx=2;
 if(caseId){args.push(caseId);filter=`AND x.case_id=$${idx++}`;}
 const owner=role==="CITOYEN"?"AND c.claimant_id=$1":"";
 const q=`SELECT x.* FROM ((SELECT h.id,h.case_id,h.scheduled_at,h.room,h.status,'AUDIENCE' AS type FROM hearings h) UNION ALL (SELECT co.id,co.case_id,co.scheduled_at,co.room,co.status,'CONCILIATION' AS type FROM conciliations co)) x JOIN cases c ON c.id=x.case_id WHERE x.scheduled_at>=CURRENT_TIMESTAMP ${owner} ${filter} ORDER BY x.scheduled_at LIMIT 200`;
 const r=await pool.query(q,args);return r.rows;
}
