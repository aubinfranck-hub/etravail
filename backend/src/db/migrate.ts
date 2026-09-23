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

if(import.meta.url===`file://${process.argv[1]}`){
  try{await migrateDatabase();}finally{await pool.end();}
}
