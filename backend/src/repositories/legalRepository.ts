import {pool} from "../db.js";

export async function searchLegalSources(q:string){
  const r=await pool.query(
    `SELECT id,title,jurisdiction,source_type,official_url,version_label,published_at,effective_from,effective_to,
            ts_headline('french',content,plainto_tsquery('french',$1),'MaxFragments=2,MaxWords=45,MinWords=12') AS excerpt
     FROM legal_sources
     WHERE active=true AND to_tsvector('french',coalesce(content,'')) @@ plainto_tsquery('french',$1)
     ORDER BY GREATEST(ts_rank(to_tsvector('french',coalesce(content,'')),plainto_tsquery('french',$1)),0) DESC, published_at DESC NULLS LAST
     LIMIT 20`,[q]);
  return r.rows;
}

export async function createLegalSource(i:{title:string;jurisdiction:string;sourceType:string;officialUrl?:string;versionLabel?:string;publishedAt?:string;effectiveFrom?:string;effectiveTo?:string;content:string;contentHash?:string;createdBy?:string}){
  const r=await pool.query(
    `INSERT INTO legal_sources(title,jurisdiction,source_type,official_url,version_label,published_at,effective_from,effective_to,content,content_hash,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [i.title,i.jurisdiction,i.sourceType,i.officialUrl??null,i.versionLabel??null,i.publishedAt??null,i.effectiveFrom??null,i.effectiveTo??null,i.content,i.contentHash??null,i.createdBy??null]
  );
  return r.rows[0];
}

export async function logAIAssistance(i:{userId:string;caseId?:string;question:string;answer:string;sources:unknown;model?:string}){
  await pool.query(
    `INSERT INTO ai_assistance_logs(user_id,case_id,question,answer,sources,model) VALUES($1,$2,$3,$4,$5,$6)`,
    [i.userId,i.caseId??null,i.question,i.answer,i.sources??null,i.model??null]
  );
}
