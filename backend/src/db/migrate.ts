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
  await pool.query(`INSERT INTO case_requirements(case_id,requirement_id,applicable)
    SELECT c.id,wr.id,TRUE
    FROM cases c JOIN workflow_requirements wr
      ON wr.status='SOUMIS' AND wr.active=true
      AND (wr.nature_code=c.nature_code OR wr.nature_code IS NULL)
    WHERE NOT EXISTS (
      SELECT 1 FROM workflow_requirement_rules rr
      WHERE rr.requirement_id=wr.id AND rr.active=true
    )
    ON CONFLICT(case_id,requirement_id) DO NOTHING`);
  await pool.query(`UPDATE case_requirements cr SET applicable=FALSE,updated_at=CURRENT_TIMESTAMP
    WHERE EXISTS (
      SELECT 1 FROM workflow_requirement_rules rr
      WHERE rr.requirement_id=cr.requirement_id AND rr.active=true
    )`);
}


async function seedRolePermissions(){
  const entries=await import("../auth/permissions.js");
  for(const role of Object.keys(entries.permissions) as Array<import("../auth/permissions.js").Role>){
    for(const permission of entries.permissions[role]){
      await pool.query(`INSERT INTO role_permissions(role,permission,enabled) VALUES($1,$2,TRUE)
        ON CONFLICT(role,permission) DO NOTHING`,[role,permission]);
    }
  }
  await entries.loadPermissions();
  console.log("Role permissions loaded");
}

async function seedStageAccess(){
  await pool.query(`INSERT INTO user_stage_access(user_id,stage_key)
    SELECT u.id,stage.key FROM users u
    CROSS JOIN (VALUES
      ('SAISINE','SAISINE'),('GREFFE','GREFFE'),('GREFFE','CONTROLE'),('GREFFE','ENROLEMENT'),('GREFFE','NOTIFICATION'),('GREFFE','ARCHIVAGE'),
      ('CONTROLE','CONTROLE'),('ENROLEMENT','ENROLEMENT'),('AUDIENCES','AUDIENCES'),('MAGISTRAT','AUDIENCES'),('MAGISTRAT','DECISIONS'),
      ('NOTIFICATION','NOTIFICATION'),('ARCHIVAGE','ARCHIVAGE')
    ) AS stage(role_name,key)
    WHERE u.role=stage.role_name
    ON CONFLICT(user_id,stage_key) DO NOTHING`);
  await pool.query(`INSERT INTO user_stage_access(user_id,stage_key)
    SELECT u.id,s.key FROM users u CROSS JOIN (VALUES
      ('SAISINE'),('GREFFE'),('CONTROLE'),('ENROLEMENT'),('AUDIENCES'),('DECISIONS'),('NOTIFICATION'),('ARCHIVAGE')
    ) AS s(key) WHERE u.role='ADMIN' ON CONFLICT(user_id,stage_key) DO NOTHING`);
  console.log("Stage access seeded for existing internal accounts");
}

async function dedupeWorkflowRequirements(){
  // UNIQUE(status,nature_code,code) never caught duplicates for rows where
  // nature_code IS NULL, because SQL treats NULL <> NULL. Since this seed
  // runs on every server boot, that let every restart re-insert the three
  // generic filing requirements (PV_NON_CONCILIATION, REQUETE, CNI),
  // silently multiplying the pieces a citizen must supply. Collapse
  // existing duplicates before installing a NULL-safe unique index.
  await pool.query(`CREATE TEMP TABLE wr_canon AS
    SELECT DISTINCT ON (status, COALESCE(nature_code,''), code) id AS canon_id, status, nature_code, code
    FROM workflow_requirements
    ORDER BY status, COALESCE(nature_code,''), code, id`);

  await pool.query(`DELETE FROM case_requirements cr
    USING (
      SELECT cr2.id,
        ROW_NUMBER() OVER (
          PARTITION BY cr2.case_id, c.canon_id
          ORDER BY (cr2.document_id IS NULL),
            CASE cr2.status WHEN 'VALIDATED' THEN 0 WHEN 'RECEIVED' THEN 1 WHEN 'REJECTED' THEN 2 ELSE 3 END,
            cr2.id
        ) AS rn
      FROM case_requirements cr2
      JOIN workflow_requirements wr ON wr.id=cr2.requirement_id
      JOIN wr_canon c ON c.status=wr.status
        AND COALESCE(c.nature_code,'')=COALESCE(wr.nature_code,'') AND c.code=wr.code
    ) ranked
    WHERE cr.id=ranked.id AND ranked.rn>1`);

  await pool.query(`UPDATE case_requirements cr
    SET requirement_id=c.canon_id
    FROM workflow_requirements wr, wr_canon c
    WHERE cr.requirement_id=wr.id
      AND c.status=wr.status AND COALESCE(c.nature_code,'')=COALESCE(wr.nature_code,'') AND c.code=wr.code
      AND wr.id<>c.canon_id`);

  const removed=await pool.query(`DELETE FROM workflow_requirements wr
    USING wr_canon c
    WHERE c.status=wr.status AND COALESCE(c.nature_code,'')=COALESCE(wr.nature_code,'') AND c.code=wr.code
      AND wr.id<>c.canon_id`);
  if(removed.rowCount) console.log(`Removed ${removed.rowCount} duplicate workflow_requirements rows`);

  await pool.query(`DROP TABLE wr_canon`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_requirements_status_nature_code
    ON workflow_requirements (status, COALESCE(nature_code,''), code)`);
}

async function seedWorkflowRequirements(){
  // Procédure de saisine du Tribunal du Travail d'Abidjan :
  // PV de non-conciliation + requête + CNI.
  // Les anciennes exigences génériques de saisine sont désactivées.
  await pool.query(`UPDATE workflow_requirements
    SET active=FALSE
    WHERE status='SOUMIS'
      AND code IN ('IDENTITE','CONTRAT_TRAVAIL','JUSTIFICATIF_LITIGE')`);

  const defaults=[
    ["PV_NON_CONCILIATION","Procès-verbal de non-conciliation",true,10],
    ["REQUETE","Requête",true,20],
    ["CNI","Carte nationale d'identité (CNI)",true,30]
  ];

  for(const [code,label,required,order] of defaults){
    await pool.query(`INSERT INTO workflow_requirements(status,nature_code,code,label,required,sort_order,active)
      VALUES('SOUMIS',NULL,$1,$2,$3,$4,TRUE)
      ON CONFLICT (status, COALESCE(nature_code,''), code) DO UPDATE SET
        label=EXCLUDED.label,required=EXCLUDED.required,sort_order=EXCLUDED.sort_order,active=TRUE`,
      [code,label,required,order]);
  }

  console.log("Official Tribunal du Travail filing requirements seeded");
}

async function seedDynamicQuestionnaire(){
  await pool.query(`UPDATE workflow_questions SET active=FALSE
    WHERE status='SAISINE' AND nature_code IS NULL
      AND code IN ('LICENCIEMENT_ECRIT','RECLAMATION_EMPLOYEUR','SALAIRE_IMPAYE_PERIODE')`);
  const questions=[
    ["SAISINE","LICENCIEMENT","LICENCIEMENT_ECRIT","Le licenciement a-t-il été notifié par écrit ?","BOOLEAN",true,10],
    ["SAISINE","LICENCIEMENT","RECLAMATION_EMPLOYEUR","Avez-vous déjà adressé une réclamation à l'employeur concernant ce litige ?","BOOLEAN",true,20],
    ["SAISINE","SALAIRE_IMPAYE","SALAIRE_IMPAYE_PERIODE","La période de salaire impayé est-elle précisément identifiable ?","BOOLEAN",true,10]
  ];
  for(const [status,nature,code,label,type,required,sort] of questions){
    await pool.query(
      `INSERT INTO workflow_questions(status,nature_code,code,label,answer_type,required,sort_order)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(status,nature_code,code) DO UPDATE SET
         label=EXCLUDED.label,answer_type=EXCLUDED.answer_type,required=EXCLUDED.required,sort_order=EXCLUDED.sort_order,active=true`,
      [status,nature,code,label,type,required,sort]
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
       ON CONFLICT (status, COALESCE(nature_code,''), code) DO UPDATE SET
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

  // Upgrade constraints on existing databases when new service roles are introduced.
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('CITOYEN','SAISINE','GREFFE','CONTROLE','ENROLEMENT','AUDIENCES','MAGISTRAT','NOTIFICATION','ARCHIVAGE','ADMIN'))`);
  await pool.query(`ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check`);
  await pool.query(`ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check CHECK (role IN ('CITOYEN','SAISINE','GREFFE','CONTROLE','ENROLEMENT','AUDIENCES','MAGISTRAT','NOTIFICATION','ARCHIVAGE','ADMIN'))`);

  const adminEmail=process.env.ETRAVAIL_BOOTSTRAP_ADMIN_EMAIL;
  const adminPassword=process.env.ETRAVAIL_BOOTSTRAP_ADMIN_PASSWORD;
  const userEmail=process.env.ETRAVAIL_BOOTSTRAP_USER_EMAIL;
  const userPassword=process.env.ETRAVAIL_BOOTSTRAP_USER_PASSWORD;

  if(adminEmail&&adminPassword) await seedUser(adminEmail,adminPassword,"ADMIN","Administrateur e-Travail");
  if(userEmail&&userPassword) await seedUser(userEmail,userPassword,"CITOYEN","Utilisateur test e-Travail");
  await seedRolePermissions();
  await seedStageAccess();
  await dedupeWorkflowRequirements();
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
