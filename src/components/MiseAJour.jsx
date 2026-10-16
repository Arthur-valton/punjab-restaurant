import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

// Bandeau « Nouvelle mise à jour » : la caisse restée ouverte voit qu'une
// nouvelle version est en ligne et propose de recharger. Elle ne recharge
// JAMAIS d'elle-même : en plein service, c'est le personnel qui choisit le
// moment (une commande en cours de saisie serait perdue).
//
// /version.json porte l'empreinte du code (vite.config.js) : la réponse lue à
// l'ouverture de la page sert de référence, et seul un nouveau code la fait
// changer (pas les commandes, qui relancent pourtant une construction Vercel).
// En développement : fichier .version.local.
const INTERVALLE = import.meta.env.DEV ? 5000 : 60000;

async function versionEnLigne() {
  const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  return j && j.version ? String(j.version) : null;
}

export default function MiseAJour({ commandeEnCours }) {
  const [nouvelle, setNouvelle] = useState(false);

  useEffect(() => {
    let reference = null;
    let arret = false;
    async function verifier() {
      try {
        const v = await versionEnLigne();
        if (arret || !v) return;
        if (reference === null) { reference = v; return; }
        if (v !== reference) setNouvelle(true);
      } catch { /* hors ligne : on réessaiera au prochain tour */ }
    }
    verifier();
    const minuterie = setInterval(verifier, INTERVALLE);
    // l'iPad remis en route après une pause : on regarde tout de suite
    const auRetour = () => { if (document.visibilityState === "visible") verifier(); };
    document.addEventListener("visibilitychange", auRetour);
    window.addEventListener("focus", auRetour);
    return () => {
      arret = true;
      clearInterval(minuterie);
      document.removeEventListener("visibilitychange", auRetour);
      window.removeEventListener("focus", auRetour);
    };
  }, []);

  if (!nouvelle) return null;

  function recharger() {
    if (commandeEnCours && !window.confirm(
      "La commande en cours n'est pas encore envoyée : elle sera perdue. Recharger quand même ?")) return;
    window.location.reload();
  }

  return (
    <div className="maj-bandeau" role="status" aria-live="polite">
      <RefreshCw className="maj-icone" size={18} strokeWidth={2} aria-hidden="true" />
      <div className="maj-texte">
        <strong>Nouvelle mise à jour</strong>
        {commandeEnCours && <span>Termine la commande en cours avant de recharger</span>}
      </div>
      <button className="maj-bouton" onClick={recharger}>Recharger</button>
    </div>
  );
}
