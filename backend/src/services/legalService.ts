import {createHash} from "node:crypto";
import {createLegalSource,searchLegalSources} from "../repositories/legalRepository.js";

export async function searchLegal(q:string){
  const query=q.trim();
  if(query.length<2)throw new Error("QUERY_TOO_SHORT");
  return searchLegalSources(query);
}

export async function addLegalSource(input:any){
  if(!input?.title||!input?.content||!input?.sourceType)throw new Error("LEGAL_SOURCE_REQUIRED");
  const content=String(input.content);
  const contentHash=createHash("sha256").update(content).digest("hex");
  return createLegalSource({
    title:String(input.title).trim(),
    jurisdiction:String(input.jurisdiction??"COTE_D_IVOIRE"),
    sourceType:String(input.sourceType),
    officialUrl:validateOfficialUrl(input.officialUrl),
    versionLabel:input.versionLabel,
    publishedAt:input.publishedAt,
    effectiveFrom:input.effectiveFrom,
    effectiveTo:input.effectiveTo,
    content,
    contentHash,
    createdBy:input.createdBy
  });
}


import {logAIAssistance} from "../repositories/legalRepository.js";

function validateOfficialUrl(value: unknown) {
  if (value == null || value === "") return undefined;
  const url = new URL(String(value));
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("INVALID_SOURCE_URL");
  return url.toString();
}

export async function assistLegal(input:{userId:string;question:string;caseId?:string}){
  const question=input.question.trim();
  if(question.length<5)throw new Error("QUERY_TOO_SHORT");
  const sources=await searchLegalSources(question);
  if(!process.env.OPENAI_API_KEY){
    const answer="Aucune réponse générative n'est activée sur cette instance. Les sources juridiques retrouvées sont fournies ci-dessous pour vérification humaine.";
    await logAIAssistance({userId:input.userId,caseId:input.caseId,question,answer,sources,model:"retrieval-only"});
    return {answer,sources,model:"retrieval-only",grounded:true};
  }
  const model=process.env.OPENAI_MODEL??"gpt-5.6-luna";
  const context=sources.map((s:any,i:number)=>`[SOURCE ${i+1}] ${s.title} — ${s.source_type} — ${s.official_url??"URL non renseignée"}\n${s.excerpt??""}`).join("\n\n");
  const prompt=`Tu es un assistant juridique administratif pour e-Travail. Tu n'es ni juge ni avocat et tu ne rends aucune décision. Réponds uniquement à partir des sources fournies. Distingue clairement ce qui est établi de ce qui doit être vérifié. Cite les sources par [SOURCE n]. Si les sources ne permettent pas de répondre, dis-le explicitement. Question: ${question}\n\nSources:\n${context}`;
  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.OPENAI_API_KEY}`},
    body:JSON.stringify({model,input:prompt})
  });
  if(!response.ok)throw new Error("AI_PROVIDER_ERROR");
  const data:any=await response.json();
  const answer=String(data.output_text??"Aucune réponse générée.");
  await logAIAssistance({userId:input.userId,caseId:input.caseId,question,answer,sources,model});
  return {answer,sources,model,grounded:true};
}
