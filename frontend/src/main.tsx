import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {api,getCases,searchDocuments} from "./api";
import "./styles.css";

type CaseItem={id:string;reference:string;title:string;status:string};
function App(){
 const [cases,setCases]=useState<CaseItem[]>([]);
 const [query,setQuery]=useState("");
 const [results,setResults]=useState<any[]>([]);
 const [error,setError]=useState("");
 useEffect(()=>{getCases().then(x=>setCases(x.data??[])).catch(e=>setError(e.message));},[]);
 async function search(){try{setResults((await searchDocuments(query)).data??[]);setError("");}catch(e:any){setError(e.message)}}
 return <main className="shell">
  <header><div className="brand"><span className="mark">eT</span><div><strong>e-Travail</strong><small>Gestion numérique des dossiers de travail</small></div></div><button>Connexion</button></header>
  <section className="hero"><div><span className="eyebrow">ESPACE DOSSIERS</span><h1>Suivre un dossier, retrouver une pièce, agir au bon moment.</h1><p>Une interface unifiée pour les parties et les services habilités.</p></div><div className="card"><span>DOSSIERS</span><strong>{cases.length}</strong><i>chargés depuis l'API</i></div></section>
  <section><div className="sectionHead"><h2>Recherche dans les pièces OCR</h2><div><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ex. licenciement, contrat..." /><button onClick={search}>Rechercher</button></div></div>{error&&<p className="error">{error}</p>}<div className="results">{results.map(r=><article key={r.id}><h3>{r.filename}</h3><p>{r.excerpt||"Aucun extrait"}</p><small>{r.case_id}</small></article>)}</div></section>
  <section><h2>Dossiers</h2><div className="grid">{cases.map(c=><article key={c.id}><span>{c.reference}</span><h3>{c.title}</h3><p>{c.status}</p></article>)}</div></section>
  <footer>e-Travail — plateforme numérique. Elle ne constitue pas un tribunal.</footer>
 </main>
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
