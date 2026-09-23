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

type ProviderResult={answer:string;model:string;provider:string};

async function callGemini(prompt:string):Promise<ProviderResult|null>{
  const key=process.env.GEMINI_API_KEY??process.env.GOOGLE_GEMINI_API_KEY;
  if(!key)return null;
  const model=process.env.GEMINI_MODEL??"gemini-2.5-flash";
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.1}})
  });
  if(!response.ok)return null;
  const data:any=await response.json();
  const answer=String(data?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text??"").join("")??"").trim();
  return answer?{answer,model,provider:"gemini"}:null;
}

async function callOpenAICompatible(baseUrl:string,key:string,model:string,prompt:string,provider:string):Promise<ProviderResult|null>{
  const response=await fetch(baseUrl.replace(/\/$/,"")+"/chat/completions",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
    body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature:0.1})
  });
  if(!response.ok)return null;
  const data:any=await response.json();
  const answer=String(data?.choices?.[0]?.message?.content??"").trim();
  return answer?{answer,model,provider}:null;
}

async function generateLegalAnswer(prompt:string):Promise<ProviderResult|null>{
  const gemini=await callGemini(prompt);
  if(gemini)return gemini;

  const deepseekKey=process.env.DEEPSEEK_API_KEY??process.env.DEEPSEEK_KEY;
  if(deepseekKey){
    const result=await callOpenAICompatible(
      process.env.DEEPSEEK_BASE_URL??"https://api.deepseek.com/v1",
      deepseekKey,
      process.env.DEEPSEEK_MODEL??"deepseek-chat",
      prompt,
      "deepseek"
    );
    if(result)return result;
  }

  const openaiKey=process.env.OPENAI_API_KEY;
  if(openaiKey){
    const model=process.env.OPENAI_MODEL??"gpt-5.6-luna";
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${openaiKey}`},
      body:JSON.stringify({model,input:prompt})
    });
    if(response.ok){
      const data:any=await response.json();
      const answer=String(data.output_text??"").trim();
      if(answer)return {answer,model,provider:"openai"};
    }
  }
  return null;
}

export async function assistLegal(input:{userId:string;question:string;caseId?:string}){
  const question=input.question.trim();
  if(question.length<5)throw new Error("QUERY_TOO_SHORT");
  const sources=await searchLegalSources(question);
  if(!sources.length){
    const answer="Les sources juridiques actuellement indexées ne permettent pas de répondre de manière suffisamment fondée à cette question.";
    await logAIAssistance({userId:input.userId,caseId:input.caseId,question,answer,sources,model:"retrieval-only"});
    return {answer,sources,model:"retrieval-only",provider:"none",grounded:false};
  }
  const context=sources.map((s:any,i:number)=>`[SOURCE ${i+1}] ${s.title} — ${s.source_type} — ${s.official_url??"URL non renseignée"}\\n${s.excerpt??""}`).join("\\n\\n");
  const prompt=`Tu es un assistant juridique administratif pour e-Travail. Tu n'es ni juge ni avocat et tu ne rends aucune décision. Réponds uniquement à partir des sources fournies. Distingue clairement ce qui est établi de ce qui doit être vérifié. Cite les sources par [SOURCE n]. Si les sources ne permettent pas de répondre, dis-le explicitement. Question: ${question}\\n\\nSources:\\n${context}`;
  const generated=await generateLegalAnswer(prompt);
  if(!generated){
    const answer="Les sources ont été retrouvées, mais aucun fournisseur IA configuré n'a pu générer la réponse. Vérification humaine requise.";
    await logAIAssistance({userId:input.userId,caseId:input.caseId,question,answer,sources,model:"retrieval-only"});
    return {answer,sources,model:"retrieval-only",provider:"none",grounded:true};
  }
  await logAIAssistance({userId:input.userId,caseId:input.caseId,question,answer:generated.answer,sources,model:`${generated.provider}:${generated.model}`});
  return {answer:generated.answer,sources,model:generated.model,provider:generated.provider,grounded:true};
}
