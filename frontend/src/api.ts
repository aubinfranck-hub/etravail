const API_URL=import.meta.env.VITE_API_URL??"https://etravail-api.onrender.com/api/v1";
export async function api(path:string,options:RequestInit={}){const token=localStorage.getItem("etravail_token");const headers=new Headers(options.headers);if(options.body&&!(options.body instanceof FormData)&&!headers.has("Content-Type"))headers.set("Content-Type","application/json");if(token)headers.set("Authorization",`Bearer ${token}`);const r=await fetch(`${API_URL}${path}`,{...options,headers});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error??"Erreur API");return d;}
export async function login(email:string,password:string){const d=await api("/auth/login",{method:"POST",body:JSON.stringify({email,password})});localStorage.setItem("etravail_token",d.token);localStorage.setItem("etravail_user",JSON.stringify(d.user));return d.user;}
export async function getDashboard(){return api("/dashboard");}
export async function getCases(){return api("/cases");}
export async function createCase(title:string,natureCode?:string){return api("/cases",{method:"POST",body:JSON.stringify({title,natureCode})});}
export async function getCaseParties(id:string){return api(`/cases/${id}/parties`);}
export async function addParty(id:string,data:any){return api(`/cases/${id}/parties`,{method:"POST",body:JSON.stringify(data)});}
export async function getCaseDocuments(id:string){return api(`/cases/${id}/documents`);}
export async function getCaseRequirements(id:string){return api(`/cases/${id}/requirements`);}
export async function validateCaseRequirement(caseId:string,requirementId:string,valid:boolean,reason?:string){return api(`/cases/${caseId}/requirements/${requirementId}/validate`,{method:"PATCH",body:JSON.stringify({valid,reason})});}
export async function uploadDocument(id:string,file:File,requirementId?:string){const body=new FormData();body.append("file",file);if(requirementId)body.append("requirementId",requirementId);return api(`/cases/${id}/documents/upload`,{method:"POST",body});}
export async function transitionCase(id:string,status:string){return api(`/cases/${id}/transition`,{method:"POST",body:JSON.stringify({status})});}
export async function getHearings(id:string){return api(`/cases/${id}/hearings`);}
export async function createHearing(id:string,data:any){return api(`/cases/${id}/hearings`,{method:"POST",body:JSON.stringify(data)});}
export async function getConciliations(id:string){return api(`/cases/${id}/conciliations`);}
export async function createConciliation(id:string,data:any){return api(`/cases/${id}/conciliations`,{method:"POST",body:JSON.stringify(data)});}
export async function updateConciliation(id:string,status:string,notes?:string){return api(`/conciliations/${id}`,{method:"PATCH",body:JSON.stringify({status,notes})});}
export async function getDecisions(id:string){return api(`/cases/${id}/decisions`);}
export async function createDecision(id:string,data:any){return api(`/cases/${id}/decisions`,{method:"POST",body:JSON.stringify(data)});}
export async function getAudit(id:string){return api(`/cases/${id}/audit`);}
export async function getCalendar(){return api("/calendar");}
export async function getNotifications(){return api("/notifications");}
export async function searchDocuments(q:string){return api(`/search/documents?q=${encodeURIComponent(q)}`);}
export async function getUsers(){return api("/admin/users");}
export async function updateUserAccess(id:string,data:{role:string;active:boolean}){return api(`/admin/users/${id}`,{method:"PATCH",body:JSON.stringify(data)});}
export async function assignCase(id:string,data:{assignedTo:string|null;assignedRole:string|null;reason?:string}){return api(`/admin/cases/${id}/assignment`,{method:"PATCH",body:JSON.stringify(data)});}
export async function searchLegalSources(q:string){return api(`/legal/sources?q=${encodeURIComponent(q)}`);}
export async function legalAssist(question:string,caseId?:string){return api("/ai/assist",{method:"POST",body:JSON.stringify({question,caseId})});}

export async function downloadDocument(caseId:string,documentId:string){const token=localStorage.getItem("etravail_token");const r=await fetch(`${API_URL}/cases/${caseId}/documents/${documentId}/download`,{headers:token?{Authorization:`Bearer ${token}`}:{}});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error??"Téléchargement impossible");}return r.blob();}
export async function getPayment(id:string){return api(`/cases/${id}/payment`);}
export async function setupPayment(id:string,data:{feeAmount:number;currency?:string}){return api(`/admin/cases/${id}/payment/setup`,{method:"POST",body:JSON.stringify(data)});}
export async function registerPaymentValidationCode(id:string,data:{code:string;source:"COMPTABILITE"|"CAISSE"|"EXTERNE";externalReference?:string;amount:number;currency?:string}){return api(`/admin/cases/${id}/payment/validation-code`,{method:"POST",body:JSON.stringify(data)});}
export async function verifyPayment(id:string,code:string){return api(`/cases/${id}/payment/verify`,{method:"POST",body:JSON.stringify({code})});}

export function getWorkflowRequirements(status?:string,natureCode?:string){const q=new URLSearchParams();if(status)q.set("status",status);if(natureCode)q.set("natureCode",natureCode);return request(`/api/v1/admin/workflow/requirements?${q.toString()}`);}
export function createWorkflowRequirement(input:any){return request("/api/v1/admin/workflow/requirements",{method:"POST",body:JSON.stringify(input)});}
export function updateWorkflowRequirement(id:string,input:any){return request(`/api/v1/admin/workflow/requirements/${id}`,{method:"PATCH",body:JSON.stringify(input)});}
