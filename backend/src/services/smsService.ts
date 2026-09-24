import {pool} from "../db.js";
import {writeAudit} from "../repositories/auditRepository.js";

const PACKAGE_CODE="SUIVI_DOSSIER";
const PACKAGE_PRICE_XOF=Number(process.env.SMS_TRACKING_PACKAGE_PRICE_XOF??500);
const PACKAGE_QUOTA=Number(process.env.SMS_TRACKING_PACKAGE_QUOTA??10);
const PACKAGE_DURATION_DAYS=Number(process.env.SMS_TRACKING_PACKAGE_DURATION_DAYS??0);

let schemaReady:Promise<void>|null=null;
async function ensureSchema(){
  if(schemaReady)return schemaReady;
  schemaReady=(async()=>{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS case_sms_tracking (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        package_code VARCHAR(50) NOT NULL DEFAULT 'SUIVI_DOSSIER',
        package_price_xof NUMERIC(14,2) NOT NULL DEFAULT 500,
        sms_quota INTEGER NOT NULL DEFAULT 10 CHECK(sms_quota>=0),
        sms_used INTEGER NOT NULL DEFAULT 0 CHECK(sms_used>=0),
        payment_status VARCHAR(20) NOT NULL DEFAULT 'A_PAYER'
          CHECK(payment_status IN ('A_PAYER','PAYE','ANNULE','EXPIRE')),
        payment_reference VARCHAR(120),
        activated_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_case_sms_tracking_enabled
        ON case_sms_tracking(enabled,payment_status);
      CREATE TABLE IF NOT EXISTS sms_tracking_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        type VARCHAR(30) NOT NULL CHECK(type IN ('PURCHASE','DEBIT','REFUND')),
        amount_xof NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(amount_xof>=0),
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),
        event_code VARCHAR(60),
        status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
        provider_reference VARCHAR(120),
        reference VARCHAR(120),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sms_tracking_transactions_case
        ON sms_tracking_transactions(case_id,created_at DESC);
    `);
  })();
  return schemaReady;
}

const TRACKING_EVENTS:Record<string,{status:string;label:string}>={
  CASE_REGISTERED:{status:"SOUMIS",label:"dossier enregistré"},
  CASE_UNDER_REVIEW:{status:"A_VERIFIER",label:"dossier en cours de vérification"},
  CASE_INCOMPLETE:{status:"INCOMPLET",label:"dossier incomplet"},
  CASE_ENROLLED:{status:"ENROLEMENT",label:"dossier enrôlé"},
  HEARING_SCHEDULED:{status:"AUDIENCE_PLANIFIEE",label:"audience planifiée"},
  DECISION_AVAILABLE:{status:"DECISION_RENDUE",label:"décision disponible"}
};
export type TrackingSmsEvent=keyof typeof TRACKING_EVENTS;

function trackingMessage(reference:string,event:TrackingSmsEvent){
  return `e-Travail : votre dossier ${reference} est ${TRACKING_EVENTS[event].label}. Consultez e-Travail pour les détails.`;
}

async function providerSend(phone:string,body:string){
  const providerUrl=String(process.env.SMS_PROVIDER_URL??"").trim();
  const providerKey=String(process.env.SMS_PROVIDER_API_KEY??"").trim();
  if(!providerUrl||!providerKey)throw new Error("SMS_PROVIDER_NOT_CONFIGURED");
  const response=await fetch(providerUrl,{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${providerKey}`},
    body:JSON.stringify({to:phone,message:body})
  });
  if(!response.ok)throw new Error("SMS_PROVIDER_FAILED");
  let providerReference:string|undefined;
  try{
    const data=await response.json() as Record<string,unknown>;
    const candidate=data.message_id??data.messageId??data.id;
    if(candidate)providerReference=String(candidate);
  }catch{}
  return providerReference;
}

async function getCase(caseId:string){
  const r=await pool.query(
    `SELECT c.id,c.reference,c.status,u.id AS claimant_id,u.phone
     FROM cases c JOIN users u ON u.id=c.claimant_id WHERE c.id=$1 LIMIT 1`,[caseId]);
  if(!r.rowCount)throw new Error("CASE_NOT_FOUND");
  return r.rows[0];
}

export async function getCaseSmsTracking(caseId:string){
  await ensureSchema();
  await getCase(caseId);
  const r=await pool.query(
    `SELECT id,case_id,enabled,package_code,package_price_xof,sms_quota,sms_used,
            GREATEST(sms_quota-sms_used,0) AS sms_remaining,payment_status,
            payment_reference,activated_at,expires_at,updated_at
     FROM case_sms_tracking WHERE case_id=$1`,[caseId]);
  return r.rows[0]??{
    case_id:caseId,enabled:false,package_code:PACKAGE_CODE,
    package_price_xof:PACKAGE_PRICE_XOF,sms_quota:PACKAGE_QUOTA,sms_used:0,
    sms_remaining:PACKAGE_QUOTA,payment_status:"A_PAYER",
    payment_reference:null,activated_at:null,expires_at:null
  };
}

export async function purchaseCaseSmsTracking(caseId:string,userId:string){
  await ensureSchema();
  const c=await getCase(caseId);
  if(c.claimant_id!==userId)throw new Error("SMS_CASE_ACCESS_DENIED");
  if(c.status==="ARCHIVE")throw new Error("SMS_CASE_CLOSED");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const existing=await client.query(
      `SELECT * FROM case_sms_tracking WHERE case_id=$1 FOR UPDATE`,[caseId]);
    if(existing.rowCount&&existing.rows[0].payment_status==="PAYE"&&existing.rows[0].enabled){
      await client.query("COMMIT");
      return existing.rows[0];
    }
    const r=await client.query(
      `INSERT INTO case_sms_tracking(case_id,enabled,package_code,package_price_xof,sms_quota,sms_used,payment_status)
       VALUES($1,FALSE,$2,$3,$4,0,'A_PAYER')
       ON CONFLICT(case_id) DO UPDATE SET
         package_code=EXCLUDED.package_code,package_price_xof=EXCLUDED.package_price_xof,
         sms_quota=EXCLUDED.sms_quota,sms_used=0,payment_status='A_PAYER',
         payment_reference=NULL,activated_at=NULL,expires_at=NULL,updated_at=CURRENT_TIMESTAMP
       RETURNING *`,[caseId,PACKAGE_CODE,PACKAGE_PRICE_XOF,PACKAGE_QUOTA]);
    await client.query(
      `INSERT INTO sms_tracking_transactions(case_id,user_id,type,amount_xof,quantity,status,reference)
       VALUES($1,$2,'PURCHASE',$3,$4,'PENDING',$5)`,
      [caseId,userId,PACKAGE_PRICE_XOF,PACKAGE_QUOTA,`SMS-${c.reference}-${Date.now()}`]);
    await client.query("COMMIT");
    return r.rows[0];
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}

export async function validateCaseSmsPayment(caseId:string,actorId:string,paymentReference?:string){
  await ensureSchema();
  const c=await getCase(caseId);
  if(c.status==="ARCHIVE")throw new Error("SMS_CASE_CLOSED");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const current=await client.query(
      `SELECT * FROM case_sms_tracking WHERE case_id=$1 FOR UPDATE`,[caseId]);
    if(!current.rowCount)throw new Error("SMS_PACKAGE_NOT_PURCHASED");
    const row=current.rows[0];
    if(row.payment_status==="PAYE"){
      await client.query("COMMIT");
      return row;
    }
    const expires=PACKAGE_DURATION_DAYS>0
      ? new Date(Date.now()+PACKAGE_DURATION_DAYS*86400000)
      : null;
    const r=await client.query(
      `UPDATE case_sms_tracking
       SET enabled=TRUE,payment_status='PAYE',payment_reference=$2,
           activated_at=COALESCE(activated_at,CURRENT_TIMESTAMP),
           expires_at=$3,updated_at=CURRENT_TIMESTAMP
       WHERE case_id=$1 RETURNING *`,
      [caseId,paymentReference??null,expires]);
    await client.query(
      `INSERT INTO sms_tracking_transactions(case_id,user_id,type,amount_xof,quantity,status,reference)
       VALUES($1,$2,'PURCHASE',$3,$4,'PAID',$5)`,
      [caseId,actorId,Number(row.package_price_xof),Number(row.sms_quota),
       paymentReference??`SMS-PAY-${Date.now()}`]);
    await client.query("COMMIT");
    await writeAudit({actorId,caseId,action:"SMS_TRACKING_PAYMENT_VALIDATED",
      metadata:{packageCode:row.package_code,amount:Number(row.package_price_xof),quota:Number(row.sms_quota),paymentReference:paymentReference??null}});
    return r.rows[0];
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}

export async function setCaseSmsTrackingOption(caseId:string,userId:string,enabled:boolean){
  await ensureSchema();
  const c=await getCase(caseId);
  if(c.claimant_id!==userId)throw new Error("SMS_CASE_ACCESS_DENIED");
  if(c.status==="ARCHIVE")throw new Error("SMS_CASE_CLOSED");
  const current=await getCaseSmsTracking(caseId);
  if(enabled && (current.payment_status!=="PAYE" || Number(current.sms_remaining)<=0)){
    throw new Error("SMS_PACKAGE_NOT_PAID");
  }
  const r=await pool.query(
    `INSERT INTO case_sms_tracking(case_id,enabled,package_code,package_price_xof,sms_quota,sms_used,payment_status)
     VALUES($1,$2,$3,$4,$5,0,'A_PAYER')
     ON CONFLICT(case_id) DO UPDATE SET enabled=$2,updated_at=CURRENT_TIMESTAMP
     RETURNING *`,
    [caseId,enabled,PACKAGE_CODE,PACKAGE_PRICE_XOF,PACKAGE_QUOTA]);
  return r.rows[0];
}

export async function sendTrackingSms(input:{caseId:string;event:TrackingSmsEvent;actorId?:string;phone?:string}){
  await ensureSchema();
  const event=TRACKING_EVENTS[input.event];
  if(!event)throw new Error("SMS_TRACKING_EVENT_NOT_ALLOWED");
  const c=await getCase(input.caseId);
  if(c.status==="ARCHIVE")throw new Error("SMS_CASE_CLOSED");
  const phone=String(input.phone??c.phone??"").trim();
  if(!phone)throw new Error("SMS_PHONE_REQUIRED");

  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const tracking=await client.query(
      `SELECT * FROM case_sms_tracking WHERE case_id=$1 FOR UPDATE`,[input.caseId]);
    const row=tracking.rows[0];
    if(!row||!row.enabled)throw new Error("SMS_OPTION_DISABLED");
    if(row.payment_status!=="PAYE")throw new Error("SMS_PACKAGE_NOT_PAID");
    if(row.expires_at&&new Date(row.expires_at).getTime()<Date.now())throw new Error("SMS_PACKAGE_EXPIRED");
    if(Number(row.sms_used)>=Number(row.sms_quota))throw new Error("SMS_QUOTA_EXHAUSTED");

    const providerReference=await providerSend(phone,trackingMessage(String(c.reference),input.event));
    await client.query(
      `UPDATE case_sms_tracking SET sms_used=sms_used+1,
          enabled=CASE WHEN sms_used+1>=sms_quota THEN FALSE ELSE enabled END,
          updated_at=CURRENT_TIMESTAMP WHERE case_id=$1`,[input.caseId]);
    await client.query(
      `INSERT INTO sms_tracking_transactions(case_id,user_id,type,amount_xof,quantity,event_code,status,provider_reference,reference)
       VALUES($1,$2,'DEBIT',0,1,$3,'SENT',$4,$5)`,
      [input.caseId,input.actorId??null,input.event,providerReference??null,String(c.reference)]);
    await client.query("COMMIT");
    await writeAudit({actorId:input.actorId,caseId:input.caseId,action:"SMS_TRACKING_SENT",
      metadata:{event:input.event,reference:c.reference,providerReference:providerReference??null}});
    return {sent:true,phone,event:input.event,reference:c.reference};
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
