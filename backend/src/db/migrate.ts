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
  await seedLegalCorpus();
}


const LEGAL_CORPUS_URL = "https://www.droit-afrique.com/uploads/RCI-Code-2015-travail1.pdf";
const LEGAL_OFFICIAL_REFERENCE_URL = "https://cepici.ci/autre-code";

function decodeHtml(value:string){
  return value.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}

export function parseLegalArticles(html:string){
  const withoutNoise=html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>/gi,"\n").replace(/<\/(?:p|div|h[1-6]|li|tr|td|section|article)>/gi,"\n").replace(/<[^>]+>/g," ");
  const text=decodeHtml(withoutNoise).replace(/\r/g,"").replace(/[ \t]+/g," ").replace(/\n[ \t]+/g,"\n").trim();
  const lawStart=text.search(/LOI N[°º] 2015-532 DU 20 JUILLET 2015 PORTANT CODE DU TRAVAIL/i);
  if(lawStart<0) throw new Error("LEGAL_CORPUS_START_NOT_FOUND");
  const conventionStart=text.indexOf("LA CONVENTION COLLECTIVE INTERPROFESSIONNELLE",lawStart+1000);
  const corpus=text.slice(lawStart,conventionStart>lawStart?conventionStart:text.length);
  const marker=/(?:ARTICLE|ART\.?)[ \t]+(\d+(?:\.\d+)?)(?:[ \t]*[-–—:.]?)/gi;
  const matches=[...corpus.matchAll(marker)];
  const articles:{number:string;content:string}[]=[];
  for(let i=0;i<matches.length;i++){
    const start=matches[i].index??0;
    const bodyStart=start+(matches[i][0]?.length??0);
    const end=i+1<matches.length?(matches[i+1].index??corpus.length):corpus.length;
    const content=corpus.slice(bodyStart,end).replace(/\s+/g," ").trim();
    if(content.length>=80) articles.push({number:matches[i][1],content});
  }
  return articles;
}

async function seedLegalCorpus(){
  const existing=await pool.query("SELECT COUNT(*)::int AS count FROM legal_sources WHERE source_type=$1 AND version_label=$2",["CODE_DU_TRAVAIL","2022"]);
  if(Number(existing.rows[0]?.count??0)>0){ console.log("Legal corpus already seeded; skipping"); return; }
  const response=await fetch(LEGAL_CORPUS_URL,{signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error("LEGAL_CORPUS_FETCH_FAILED");
  const pdfBuffer=Buffer.from(await response.arrayBuffer());
  const pdfModule:any=await import("pdf-parse");
  const parsed=await pdfModule.default(pdfBuffer);
  const articles=parseLegalArticles(parsed.text);
  if(articles.length<100) throw new Error("LEGAL_CORPUS_TOO_SMALL");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    for(const article of articles){
      const content="Article "+article.number+". "+article.content;
      const hash=crypto.createHash("sha256").update(content).digest("hex");
      await client.query(
        "INSERT INTO legal_sources(title,jurisdiction,source_type,official_url,version_label,published_at,content,content_hash,active) SELECT $1,'COTE_D_IVOIRE','CODE_DU_TRAVAIL',$2,'2022','2015-07-20',$3,$4,TRUE WHERE NOT EXISTS (SELECT 1 FROM legal_sources WHERE source_type='CODE_DU_TRAVAIL' AND content_hash=$4)",
        ["Code du travail ivoirien — Article "+article.number,LEGAL_OFFICIAL_REFERENCE_URL,content,hash]
      );
    }
    await client.query("COMMIT");
    console.log("Legal corpus seeded: "+articles.length+" articles");
  }catch(error){ await client.query("ROLLBACK"); throw error; }finally{ client.release(); }
}

if(import.meta.url===`file://${process.argv[1]}`){
  try{await migrateDatabase();}finally{await pool.end();}
}
