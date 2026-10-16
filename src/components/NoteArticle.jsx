import { useState } from "react";
import { MessageSquareText, TriangleAlert } from "lucide-react";
import { posteDuChoix } from "./postes";
import {
  NOTES_RAPIDES, ALLERGENES, NOTE_MAX, choixCibles, estLigneMenu, ligneANote,
  decomposerNote, composerNote, decomposerAllergie, composerAllergie, allergieDeLigne, ticketDeLaNote,
} from "./notes";

const POUR = { CUISINE: "pour la cuisine", DESSERTS: "pour les desserts", BAR: "pour le bar" };

// Fenêtre « Note » d'une ligne du panier : notes rapides du poste, précision
// libre, allergie. Même gabarit que le choix d'une formule. Un toucher sur le
// fond ne ferme rien : une allergie à moitié saisie ne part pas sur un doigt.
// La ligne reçue porte son « poste » (posterArticles) : c'est lui qui dit
// quel ticket recevra la note. allergenesPlat : les allergènes cochés dans
// « Ma carte » pour ce plat ; seuls ceux-là sont proposés (aucun → pas de
// rubrique Allergènes, pour ne rien laisser croire).
export default function NoteArticle({ ligne, nom, piment, paye, allergenesPlat = [], onValider, onFermer }) {
  const menu = estLigneMenu(ligne);
  const choices = ligne.formulaChoices || [];
  const cibles = menu ? choixCibles(ligne) : [];
  const ticketDe = (cle) => ticketDeLaNote(ligne, menu ? choices[cle] : null);
  // Dans un menu, le plat est choisi d'office : c'est lui qu'on note le plus
  const [cible, setCible] = useState(() => {
    if (!menu) return "ligne";
    return cibles.find((k) => posteDuChoix(choices[k], choices) === "Plats") ?? cibles[0];
  });
  // Un brouillon par plat du menu : passer du dessert au plat ne perd rien
  const [brouillons, setBrouillons] = useState(() => Object.fromEntries((menu ? cibles : ["ligne"]).map((cle) =>
    [cle, decomposerNote(menu ? choices[cle].note : ligne.note, NOTES_RAPIDES[ticketDe(cle)])])));
  const avant = decomposerAllergie(allergieDeLigne(ligne));
  const [allergie, setAllergie] = useState(avant);
  // ce que contient le plat, plus une allergie déjà posée (qu'on doit pouvoir retirer)
  const proposes = ALLERGENES.filter((a) => allergenesPlat.includes(a) || avant.choisis.includes(a));
  const avecAllergenes = proposes.length > 0 || avant.autres.length > 0;
  // Deux assiettes ou plus : rien d'office, sinon une allergie pourrait
  // partir sur la mauvaise
  const [combien, setCombien] = useState(null);

  const ticket = ticketDe(cible);
  const liste = NOTES_RAPIDES[ticket];
  const br = brouillons[cible] || { rapides: [], libre: "" };
  const aDecider = ligne.qty > 1 && combien === null;
  const allergieTapee = /allerg|intol/i.test(br.libre);

  function majBrouillon(maj) {
    setBrouillons((b) => ({ ...b, [cible]: { ...(b[cible] || { rapides: [], libre: "" }), ...maj } }));
  }
  function basculerNote(n) {
    const rapides = br.rapides.includes(n)
      ? br.rapides.filter((x) => x !== n)
      : liste.filter((x) => x === n || br.rapides.includes(x));
    majBrouillon({ rapides });
  }
  // Retirer une allergie déjà posée se confirme : c'est elle qui protège le client
  function basculerAllergene(a, libre = false) {
    const cle = libre ? "autres" : "choisis";
    const pris = allergie[cle].includes(a);
    if (pris && avant[cle].includes(a) && !window.confirm(`Retirer l'allergie ${a.toLowerCase()} ?`)) return;
    setAllergie((al) => ({ ...al, [cle]: pris ? al[cle].filter((x) => x !== a) : [...al[cle], a] }));
  }
  function valider() {
    const notes = {};
    for (const [cle, b] of Object.entries(brouillons)) {
      const n = composerNote(b.rapides, b.libre);
      if (n) notes[cle] = n;
    }
    onValider({ notes, allergie: composerAllergie(allergie.choisis, allergie.autres) }, combien === 1);
  }
  function effacer() {
    // Menu : seule la note du plat choisi part ; celles des autres plats et
    // l'allergie du menu restent comme elles étaient
    if (menu) {
      const notes = {};
      for (const k of cibles) if (k !== cible && choices[k].note) notes[k] = choices[k].note;
      onValider({ notes, allergie: composerAllergie(avant.choisis, avant.autres) }, combien === 1);
      return;
    }
    const a = composerAllergie(avant.choisis, avant.autres);
    if (a && !window.confirm(`Retirer aussi l'allergie ${a.toLowerCase()} ?`)) return;
    onValider({ notes: {}, allergie: "" }, combien === 1);
  }

  const puceAllergene = (a, libre = false) => {
    const on = allergie[libre ? "autres" : "choisis"].includes(a);
    return (
      <button key={a} type="button" className={`note-puce note-puce--allergie${on ? " on" : ""}`}
              aria-pressed={on} onClick={() => basculerAllergene(a, libre)}>{a}</button>
    );
  };

  return (
    <div className="numpad-overlay">
      <div className="formula-picker note-fenetre" role="dialog" aria-modal="true" aria-labelledby="note-titre">
        <div className="formula-picker-header note-entete">
          <div className="formula-picker-title" id="note-titre">Note {POUR[ticket]}</div>
          <div className="note-article">
            {ligne.qty > 1 && <span className="note-article-qte">{ligne.qty}×</span>}
            {nom}
            {piment && <span className="cart-piment">{piment}</span>}
          </div>
        </div>

        <div className="note-corps">
          {paye && <p className="note-paye">Déjà encaissé : la note de ce plat ne se change plus</p>}
          <fieldset className="note-champs" disabled={paye}>
            {menu && cibles.length > 1 && (
              <div className="note-section">
                <div className="note-lib">Pour quel plat ?</div>
                <div className="note-puces">
                  {cibles.map((k) => {
                    const b = brouillons[k];
                    const note = b && (b.rapides.length > 0 || b.libre.trim());
                    return (
                      <button key={k} type="button" className={`note-puce${cible === k ? " on" : ""}`}
                              aria-pressed={cible === k} onClick={() => setCible(k)}>
                        {choices[k].itemName}
                        {note && <MessageSquareText size={15} strokeWidth={2} aria-label="noté" />}
                      </button>
                    );
                  })}
                </div>
                {avecAllergenes && <p className="note-aide">L'allergie vaut pour tout le menu</p>}
              </div>
            )}

            {ligne.qty > 1 && (
              <div className="note-section">
                <div className="note-lib">Pour combien ?</div>
                <div className="note-combien">
                  <button type="button" className={`note-puce${combien === 1 ? " on" : ""}`}
                          aria-pressed={combien === 1} onClick={() => setCombien(1)}>1</button>
                  <button type="button" className={`note-puce${combien === "tous" ? " on" : ""}`}
                          aria-pressed={combien === "tous"} onClick={() => setCombien("tous")}>Les {ligne.qty}</button>
                </div>
              </div>
            )}

            <div className="note-section">
              <div className="note-puces">
                {liste.map((n) => {
                  const on = br.rapides.includes(n);
                  return (
                    <button key={n} type="button" className={`note-puce${on ? " on" : ""}`}
                            aria-pressed={on} onClick={() => basculerNote(n)}>{n}</button>
                  );
                })}
              </div>
              <input
                className="formula-libre-input note-champ"
                value={br.libre}
                maxLength={NOTE_MAX}
                placeholder="Autre précision…"
                aria-label="Autre précision"
                enterKeyHint="done"
                onChange={(e) => majBrouillon({ libre: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
              {allergieTapee && (
                <p className="note-alerte" role="status">
                  <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
                  {avecAllergenes
                    ? "Une allergie ? Touchez l'allergène du plat ci-dessous, il sortira en noir sur le ticket"
                    : "Aucun allergène n'est coché pour ce plat dans Ma carte"}
                </p>
              )}
            </div>

            {avecAllergenes && (
              <div className="note-section">
                <div className="note-lib note-lib--rouge">Allergènes du plat</div>
                <p className="note-aide">Touchez celui auquel le client est allergique : il sortira en noir sur le ticket</p>
                <div className="note-puces">
                  {proposes.map((a) => puceAllergene(a))}
                  {[...new Set([...avant.autres, ...allergie.autres])].map((a) => puceAllergene(a, true))}
                </div>
              </div>
            )}
          </fieldset>
        </div>

        <div className="note-actions">
          {!paye && (
            <button className="formula-picker-confirm" disabled={aDecider} onClick={valider}>Valider</button>
          )}
          {!paye && (menu ? !!choices[cible]?.note : ligneANote(ligne)) && (
            <button className="note-effacer" onClick={effacer}>{menu ? "Effacer la note de ce plat" : "Effacer la note"}</button>
          )}
          <button className="formula-picker-cancel" onClick={onFermer}>{paye ? "Fermer" : "Annuler"}</button>
        </div>
      </div>
    </div>
  );
}
