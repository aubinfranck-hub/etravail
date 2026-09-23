const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

export async function api(path:string, options:RequestInit = {}) {
  const token=localStorage.getItem("etravail_token");
  const headers=new Headers(options.headers);
  if(options.body && !headers.has("Content-Type")) headers.set("Content-Type","application/json");
  if(token) headers.set("Authorization",`Bearer ${token}`);
  const response=await fetch(`${API_URL}${path}`,{...options,headers});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error ?? "Erreur API");
  return data;
}
export async function login(email:string,password:string){const d=await api("/auth/login",{method:"POST",body:JSON.stringify({email,password})});localStorage.setItem("etravail_token",d.token);localStorage.setItem("etravail_user",JSON.stringify(d.user));return d.user;}
export async function getDashboard(){return api("/dashboard");}
export async function getCases(){return api("/cases");}
export async function searchDocuments(q:string){return api(`/search/documents?q=${encodeURIComponent(q)}`);}
