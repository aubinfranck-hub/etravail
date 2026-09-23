import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {getDashboard,getCases,searchDocuments} from "./api";
import "./styles.css";

function App(){
 const [dashboard,setDashboard]=useState<any>(null),[cases,setCases]=useState<any[]>([]),[query,setQuery]=useState(""),[results,setResults]=useState<any[]>([]),[error,setError]=useState("");
 const user=JSON.parse(localStorage.getItem("etravail_user")||'{"role":"VISITEUR"}');
 useEffect(()=>{getDashboard().then(x=>setDashboard(x.data)).catch(()=>{});getCases().then(x=>setCases(x.data??[])).catch(e=>setError(e.message));},[]);
 async function search(){try{setResults((await searchDocuments(query)).data??[]);setError("")}catch(e:any){setError(e.message)}}
 return <main className="shell">
  <header><div className="brand"><span className="mark">eT</span><div><strong>e-Travail</strong><small>Gestion numérique des dossiers de travail</small></div></div><div className="role">{user.role}</div></header>
  <section className="hero"><div><span className="eyebrow">TABLEAU DE BORD</span><h1>Bienvenue dans e-Travail.</h1><p>Suivez les dossiers, les échéances et les pièces depuis un espace adapté à votre rôle.</p></div><div className="card"><span>DOSSIERS</span><strong>{cases.length}</strong><i>{dashboard?.upcomingHearings??0} audience(s) à venir</i></div></section>
  <section><h2>Recherche documentaire</h2><div className="search"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher dans les pièces OCR"/><button onClick={search}>Rechercher</button></div>{error&&<p className="error">{error}</p>}<div className="results">{results.map(r=><article key={r.id}><b>{r.filename}</b><p>{r.excerpt}</p></article>)}</div></section>
  <section><h2>Dossiers</h2><div className="grid">{cases.map(c=><article key={c.id}><small>{c.reference}</small><h3>{c.title}</h3><p>{c.status}</p></article>)}</div></section>
  <footer>e-Travail — plateforme numérique de gestion et de suivi. Elle ne constitue pas un tribunal.</footer>
 </main>
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
