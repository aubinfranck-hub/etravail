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
    officialUrl:input.officialUrl,
    versionLabel:input.versionLabel,
    publishedAt:input.publishedAt,
    effectiveFrom:input.effectiveFrom,
    effectiveTo:input.effectiveTo,
    content,
    contentHash,
    createdBy:input.createdBy
  });
}
