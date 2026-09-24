import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

function hashPassword(password:string){
  const salt=crypto.randomBytes(16).toString("hex");
  const derived=crypto.scryptSync(password,salt,64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

async function seedUser(email:string,password:string,role:"ADMIN"|"CITOYEN",fullName:string){
  const existing=await pool.query("SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1",[email]);
  if(existing.rowCount) return;
  await pool.query(
    "INSERT INTO users(email,password_hash,role,full_name,active) VALUES($1,$2,$3,$4,TRUE)",
    [email.trim().toLowerCase(),hashPassword(password),role,fullName]
  );
  console.log(`e-Travail bootstrap user created: ${email} (${role})`);
}



async function backfillCaseRequirements(){
  await pool.query(`INSERT INTO case_requirements(case_id,requirement_id)
    SELECT c.id,wr.id FROM cases c JOIN workflow_requirements wr ON wr.status='SOUMIS' AND wr.active=true
      AND (wr.nature_code=c.nature_code OR wr.nature_code IS NULL)
    WHERE NOT EXISTS (SELECT 1 FROM case_requirements cr WHERE cr.case_id=c.id)
    ON CONFLICT(case_id,requirement_id) DO NOTHING`);
}


async function seedRolePermissions(){
  const entries=await import("../auth/permissions.js");
  for(const role of Object.keys(entries.permissions) as Array<"CITOYEN"|"GREFFE"|"MAGISTRAT"|"ADMIN">){
    for(const permission of entries.permissions[role]){
      await pool.query(`INSERT INTO role_permissions(role,permission,enabled) VALUES($1,$2,TRUE)
        ON CONFLICT(role,permission) DO NOTHING`,[role,permission]);
    }
  }
  await entries.loadPermissions();
  console.log("Role permissions loaded");
}

async function seedWorkflowRequirements(){
  const defaults=[
    ["IDENTITE","Pièce d'identité du demandeur",true,48,10],
    ["CONTRAT_TRAVAIL","Contrat de travail ou justificatif de relation de travail",true,48,20],
    ["JUSTIFICATIF_LITIGE","Justificatif principal du litige",true,48,30]
  ];
  const natures=["LICENCIEMENT","SALAIRE_IMPAYE","CONGES","RUPTURE_CONTRAT","HARCELEMENT","ACCIDENT_TRAVAIL","AUTRE"];
  for(const nature of natures){
    for(const [code,label,required,hours,order] of defaults){
      await pool.query(`INSERT INTO workflow_requirements(status,nature_code,code,label,required,deadline_hours,sort_order)
        VALUES('SOUMIS',$1,$2,$3,$4,$5,$6) ON CONFLICT(status,nature_code,code) DO UPDATE SET label=EXCLUDED.label,required=EXCLUDED.required,deadline_hours=EXCLUDED.deadline_hours,sort_order=EXCLUDED.sort_order,active=true`,
        [nature,code,label,required,hours,order]);
    }
  }
  const extras=[
    ["ACCIDENT_TRAVAIL","CERTIFICAT_MEDICAL","Certificat médical / constat de l'accident",true,48,40],
    ["HARCELEMENT","ELEMENTS_HARCELEMENT","Éléments ou faits documentant le signalement",true,48,40],
    ["SALAIRE_IMPAYE","BULLETINS_SALAIRE","Bulletins de salaire / justificatifs de rémunération",true,48,40]
  ];
  for(const [nature,code,label,required,hours,order] of extras){
    await pool.query(`INSERT INTO workflow_requirements(status,nature_code,code,label,required,deadline_hours,sort_order)
      VALUES('SOUMIS',$1,$2,$3,$4,$5,$6) ON CONFLICT(status,nature_code,code) DO UPDATE SET label=EXCLUDED.label,required=EXCLUDED.required,deadline_hours=EXCLUDED.deadline_hours,sort_order=EXCLUDED.sort_order,active=true`,
      [nature,code,label,required,hours,order]);
  }
  console.log("Workflow requirements seeded");
}

async function seedDynamicQuestionnaire(){
  const questions=[
    ["SAISINE","LICENCIEMENT_ECRIT","Le licenciement a-t-il été notifié par écrit ?","BOOLEAN",true,10],
    ["SAISINE","RECLAMATION_EMPLOYEUR","Avez-vous déjà adressé une réclamation à l'employeur concernant ce litige ?","BOOLEAN",true,20],
    ["SAISINE","SALAIRE_IMPAYE_PERIODE","La période de salaire impayé est-elle précisément identifiable ?","BOOLEAN",true,30]
  ];
  for(const [status,code,label,type,required,sort] of questions){
    await pool.query(
      `INSERT INTO workflow_questions(status,nature_code,code,label,answer_type,required,sort_order)
       VALUES($1,NULL,$2,$3,$4,$5,$6)
       ON CONFLICT(status,nature_code,code) DO UPDATE SET
         label=EXCLUDED.label,answer_type=EXCLUDED.answer_type,required=EXCLUDED.required,sort_order=EXCLUDED.sort_order,active=true`,
      [status,code,label,type,required,sort]
    );
  }

  const conditionalRequirements=[
    ["LICENCIEMENT","LETTRE_LICENCIEMENT","Lettre de licenciement",true,48,50,"LICENCIEMENT_ECRIT","EQ",true],
    ["LICENCIEMENT","PREUVE_RECLAMATION","Preuve de réclamation adressée à l'employeur",false,48,60,"RECLAMATION_EMPLOYEUR","EQ",true]
  ];
  for(const [nature,code,label,required,hours,order,qcode,operator,expected] of conditionalRequirements){
    await pool.query(
      `INSERT INTO workflow_requirements(status,nature_code,code,label,required,deadline_hours,sort_order)
       VALUES('SOUMIS',$1,$2,$3,$4,$5,$6)
       ON CONFLICT(status,nature_code,code) DO UPDATE SET
         label=EXCLUDED.label,required=EXCLUDED.required,deadline_hours=EXCLUDED.deadline_hours,
         sort_order=EXCLUDED.sort_order,active=true`,
      [nature,code,label,required,hours,order]
    );
    await pool.query(
      `INSERT INTO workflow_requirement_rules(requirement_id,question_id,operator,expected_value,active)
       SELECT wr.id,wq.id,$3,$4::jsonb,TRUE
       FROM workflow_requirements wr CROSS JOIN workflow_questions wq
       WHERE wr.status='SOUMIS' AND wr.nature_code=$1 AND wr.code=$2
         AND wq.status='SAISINE' AND wq.code=$5
       ON CONFLICT(requirement_id,question_id,operator) DO UPDATE SET
         expected_value=EXCLUDED.expected_value,active=true`,
      [nature,code,operator,JSON.stringify(expected),qcode]
    );
  }
  console.log("Dynamic questionnaire seeded");
}

export async function migrateDatabase(){
  const here=path.dirname(fileURLToPath(import.meta.url));
  const schema=await fs.readFile(path.resolve(here,"../../../database/schema.sql"),"utf8");
  await pool.query(schema);

  const adminEmail=process.env.ETRAVAIL_BOOTSTRAP_ADMIN_EMAIL;
  const adminPassword=process.env.ETRAVAIL_BOOTSTRAP_ADMIN_PASSWORD;
  const userEmail=process.env.ETRAVAIL_BOOTSTRAP_USER_EMAIL;
  const userPassword=process.env.ETRAVAIL_BOOTSTRAP_USER_PASSWORD;

  if(adminEmail&&adminPassword) await seedUser(adminEmail,adminPassword,"ADMIN","Administrateur e-Travail");
  if(userEmail&&userPassword) await seedUser(userEmail,userPassword,"CITOYEN","Utilisateur test e-Travail");
  await seedRolePermissions();
  await seedWorkflowRequirements();
  await seedDynamicQuestionnaire();
  await backfillCaseRequirements();
  await seedLegalCorpus();
  await seedLabourAmendment2021();
}


const LEGAL_CORPUS_URL = "https://www.economie-ivoirienne.ci/sites/default/files/sites/default/files/inline-files/Le-code-du-travail-ivoirien-13-05-17.pdf";
const LEGAL_OFFICIAL_REFERENCE_URL = "https://www.famille.gouv.ci/public/front/docs/RCI-Code-2015-travail.pdf";

function decodeHtml(value:string){
  return value.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}

export function parseLegalArticles(html:string){
  const withoutNoise=html
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<br\s*\/?>/gi,"\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|td|section|article)>/gi,"\n")
    .replace(/<[^>]+>/g," ");
  const text=decodeHtml(withoutNoise)
    .replace(/\r/g,"")
    .replace(/[ \t]+/g," ")
    .replace(/\n[ \t]+/g,"\n")
    .trim();

  const marker=/\b(?:Article|ARTICLE|Art\.)\s+(\d+(?:\.\d+)?)(?:\s*[-–—:.]*)?/g;
  const matches=[...text.matchAll(marker)];
  const articles:{number:string;content:string}[]=[];
  for(let i=0;i<matches.length;i++){
    const start=matches[i].index??0;
    const bodyStart=start+(matches[i][0]?.length??0);
    const end=i+1<matches.length?(matches[i+1].index??text.length):text.length;
    const content=text.slice(bodyStart,end).replace(/\s+/g," ").trim();
    if(content.length>=120) articles.push({number:matches[i][1],content});
  }
  return articles;
}

async function seedLegalCorpus(){
  const existing=await pool.query("SELECT COUNT(*)::int AS count FROM legal_sources WHERE source_type=$1 AND version_label=$2",["CODE_DU_TRAVAIL","2023"]);
  if(Number(existing.rows[0]?.count??0)>0){ const validation=await pool.query("SELECT COUNT(*)::int AS count FROM legal_sources WHERE active=true AND to_tsvector('french',coalesce(content,'')) @@ plainto_tsquery('french',$1)",["licenciement"]); console.log("Legal corpus already seeded; search validation matches: "+validation.rows[0]?.count); return; }
  const response=await fetch(LEGAL_CORPUS_URL,{signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error("LEGAL_CORPUS_FETCH_FAILED");
  const pdfData=new Uint8Array(await response.arrayBuffer());
  // @ts-ignore pdfjs-dist ESM typing varies by installed version.
  const pdfjs:any=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask=pdfjs.getDocument({data:pdfData,useWorkerFetch:false,isEvalSupported:false});
  const pdf=await loadingTask.promise;
  let parsedText="";
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
    const page=await pdf.getPage(pageNo);
    const content=await page.getTextContent();
    parsedText+=content.items.map((item:any)=>typeof item.str==="string"?item.str:"").join(" ")+"\n";
  }
  await pdf.destroy();

  const articles=parseLegalArticles(parsedText);

  if(articles.length<100) throw new Error("LEGAL_CORPUS_TOO_SMALL");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    for(const article of articles){
      const content="Article "+article.number+". "+article.content;
      const hash=crypto.createHash("sha256").update(content).digest("hex");
      await client.query(
        "INSERT INTO legal_sources(title,jurisdiction,source_type,official_url,version_label,published_at,content,content_hash,active) SELECT $1,'COTE_D_IVOIRE','CODE_DU_TRAVAIL',$2,'2023','2015-07-20',$3,$4,TRUE WHERE NOT EXISTS (SELECT 1 FROM legal_sources WHERE source_type='CODE_DU_TRAVAIL' AND content_hash=$4::varchar)",
        ["Code du travail ivoirien — Article "+article.number,LEGAL_OFFICIAL_REFERENCE_URL,content,hash]
      );
    }
    await client.query("COMMIT");
    const validation=await pool.query("SELECT COUNT(*)::int AS count FROM legal_sources WHERE active=true AND to_tsvector('french',coalesce(content,'')) @@ plainto_tsquery('french',$1)",["licenciement"]);
    console.log("Legal search validation — licenciement matches: "+validation.rows[0]?.count);
  }catch(error){ await client.query("ROLLBACK"); throw error; }finally{ client.release(); }
}

async function seedLabourAmendment2021(){
  try{
    const existing=await pool.query("SELECT COUNT(*)::int AS count FROM legal_sources WHERE source_type=$1 AND version_label=$2",["CODE_DU_TRAVAIL_AMENDEMENT","2021"]);
    if(Number(existing.rows[0]?.count??0)>0) return;
    const url="https://loidici.biz/2023/09/20/ordonnance-n-2021-902-du-22-decembre-2021-modifiant-la-loi-n-2015-532-du-20-juillet-2015-portant-code-du-travailratifiee-par-la-loi-2023-594-du-07-06-2023/lois-article-par-article/codes/le-code-du-travail/45824/naty/";
    const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw new Error("LEGAL_AMENDMENT_FETCH_FAILED");
    const articles=parseLegalArticles(await response.text()).filter(a=>/^13\.3|^16\.6|^16\.11|^18\.11|^18\.14|^23\.1|^23\.13|^25\.2|^73\.2|^1$/.test(a.number));
    if(articles.length<9) throw new Error("LEGAL_AMENDMENT_TOO_SMALL");
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      for(const article of articles){
        const content="Ordonnance n°2021-902 — Article "+article.number+". "+article.content;
        const hash=crypto.createHash("sha256").update(content).digest("hex");
        await client.query(
          "INSERT INTO legal_sources(title,jurisdiction,source_type,official_url,version_label,published_at,content,content_hash,active) SELECT $1,'COTE_D_IVOIRE','CODE_DU_TRAVAIL_AMENDEMENT',$2,'2021','2021-12-22',$3,$4::varchar,TRUE WHERE NOT EXISTS (SELECT 1 FROM legal_sources WHERE source_type='CODE_DU_TRAVAIL_AMENDEMENT' AND content_hash=$4::varchar)",
          ["Code du travail ivoirien — Ordonnance 2021-902 — Article "+article.number,"https://jorci.oneci.ci/journaux-officiels/352",content,hash]
        );
      }
      await client.query("COMMIT");
      console.log("Labour Code amendment 2021 seeded: "+articles.length+" articles");
    }catch(error){ await client.query("ROLLBACK"); throw error; }finally{ client.release(); }
  }catch(error){ console.warn("Optional 2021 labour amendment seed skipped",error); }
}

if(import.meta.url===`file://${process.argv[1]}`){
  try{await migrateDatabase();}finally{await pool.end();}
}
