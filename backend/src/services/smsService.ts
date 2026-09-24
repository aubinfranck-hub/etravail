import {pool} from "../db.js";

const DEFAULT_UNIT_PRICE=Number(process.env.SMS_UNIT_PRICE_XOF??50);

let schemaReady:Promise<void>|null=null;
async function ensureSchema(){
  if(schemaReady)return schemaReady;
  schemaReady=(async()=>{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sms_accounts (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        balance_xof NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(balance_xof>=0),
        unit_price_xof NUMERIC(14,2) NOT NULL DEFAULT 50,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sms_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL CHECK(type IN ('CREDIT','DEBIT','REFUND')),
        amount_xof NUMERIC(14,2) NOT NULL CHECK(amount_xof>=0),
        quantity INTEGER NOT NULL DEFAULT 1,
        notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL,
        case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
        event_code VARCHAR(60),
        status VARCHAR(20) NOT NULL DEFAULT 'SENT',
        provider_reference VARCHAR(120),
        reference VARCHAR(120),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE sms_transactions ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES cases(id) ON DELETE SET NULL;
      ALTER TABLE sms_transactions ADD COLUMN IF NOT EXISTS event_code VARCHAR(60);
      ALTER TABLE sms_transactions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'SENT';
      ALTER TABLE sms_transactions ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(120);
      CREATE INDEX IF NOT EXISTS idx_sms_transactions_user ON sms_transactions(user_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sms_transactions_case ON sms_transactions(case_id,created_at DESC);
    `);
  })();
  return schemaReady;
}

export async function getSmsAccount(userId:string){
  await ensureSchema();
  const r=await pool.query(
    `SELECT user_id,enabled,balance_xof,unit_price_xof,updated_at
     FROM sms_accounts WHERE user_id=$1`,[userId]);
  return r.rows[0]??null;
}

export async function setSmsOption(userId:string,enabled:boolean){
  await ensureSchema();
  const r=await pool.query(
    `INSERT INTO sms_accounts(user_id,enabled,unit_price_xof)
     VALUES($1,$2,$3)
     ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=CURRENT_TIMESTAMP
     RETURNING user_id,enabled,balance_xof,unit_price_xof,updated_at`,
    [userId,enabled,DEFAULT_UNIT_PRICE]);
  return r.rows[0];
}

export async function creditSms(userId:string,amount:number,reference?:string){
  await ensureSchema();
  if(!Number.isFinite(amount)||amount<=0)throw new Error("INVALID_SMS_CREDIT");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO sms_accounts(user_id,enabled,balance_xof,unit_price_xof)
       VALUES($1,TRUE,$2,$3)
       ON CONFLICT(user_id) DO UPDATE SET balance_xof=sms_accounts.balance_xof+$2,updated_at=CURRENT_TIMESTAMP`,
      [userId,amount,DEFAULT_UNIT_PRICE]);
    await client.query(
      `INSERT INTO sms_transactions(user_id,type,amount_xof,reference)
       VALUES($1,'CREDIT',$2,$3)`,[userId,amount,reference??null]);
    const r=await client.query(
      `SELECT user_id,enabled,balance_xof,unit_price_xof,updated_at FROM sms_accounts WHERE user_id=$1`,[userId]);
    await client.query("COMMIT");
    return r.rows[0];
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
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
  const e=TRACKING_EVENTS[event];
  return `e-Travail : votre dossier ${reference} est ${e.label}. Consultez e-Travail pour les détails.`;
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

export async function sendTrackingSms(input:{userId:string;caseId:string;event:TrackingSmsEvent;phone?:string}){
  await ensureSchema();
  const event=TRACKING_EVENTS[input.event];
  if(!event)throw new Error("SMS_TRACKING_EVENT_NOT_ALLOWED");

  const caseResult=await pool.query(
    `SELECT c.reference,u.phone
     FROM cases c JOIN users u ON u.id=c.claimant_id
     WHERE c.id=$1 LIMIT 1`,[input.caseId]);
  if(!caseResult.rowCount)throw new Error("CASE_NOT_FOUND");
  const reference=String(caseResult.rows[0].reference);
  const phone=String(input.phone??caseResult.rows[0].phone??"").trim();
  if(!phone)throw new Error("SMS_PHONE_REQUIRED");

  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const account=await client.query(
      `SELECT balance_xof,unit_price_xof,enabled
       FROM sms_accounts WHERE user_id=$1 FOR UPDATE`,[input.userId]);
    const row=account.rows[0];
    if(!row||!row.enabled)throw new Error("SMS_OPTION_DISABLED");
    const price=Number(row.unit_price_xof??DEFAULT_UNIT_PRICE);
    if(Number(row.balance_xof)<price)throw new Error("SMS_INSUFFICIENT_BALANCE");

    const body=trackingMessage(reference,input.event);
    const providerReference=await providerSend(phone,body);

    await client.query(
      `UPDATE sms_accounts SET balance_xof=balance_xof-$1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$2`,
      [price,input.userId]);
    await client.query(
      `INSERT INTO sms_transactions(user_id,type,amount_xof,quantity,case_id,event_code,status,provider_reference,reference)
       VALUES($1,'DEBIT',$2,1,$3,$4,'SENT',$5,$6)`,
      [input.userId,price,input.caseId,input.event,providerReference??null,reference]);
    await client.query("COMMIT");
    return {sent:true,phone,charged_xof:price,event:input.event,reference};
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
