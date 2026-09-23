import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const modules = [
  ["Dossiers", "Suivi des dossiers et de leur état"],
  ["Pièces", "Documents, classement et OCR"],
  ["Conciliation", "Préparation et suivi des conciliations"],
  ["Audiences", "Calendrier et audiences"],
  ["Décisions", "Actes et décisions"],
  ["Notifications", "Convocations et informations"],
];

function App() {
  return (
    <main className="shell">
      <header>
        <div className="brand"><span className="mark">eT</span><div><strong>e-Travail</strong><small>Plateforme de gestion des dossiers de travail</small></div></div>
        <button className="login">Connexion</button>
      </header>
      <section className="hero">
        <div><span className="eyebrow">ESPACE NUMÉRIQUE</span><h1>Un parcours de dossier plus simple, sécurisé et traçable.</h1><p>Préparer, déposer, suivre et administrer les dossiers dans un environnement unifié.</p><button className="primary">Créer un dossier</button></div>
        <div className="card"><span>ÉTAT DU SERVICE</span><strong>Opérationnel</strong><i>API e-Travail</i></div>
      </section>
      <section><h2>Modules</h2><div className="grid">{modules.map(([title,desc]) => <article key={title}><h3>{title}</h3><p>{desc}</p><span>Accéder →</span></article>)}</div></section>
      <footer>e-Travail — plateforme numérique. Elle ne constitue pas un tribunal et ne remplace pas les autorités compétentes.</footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
