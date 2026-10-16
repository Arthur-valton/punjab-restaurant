import { useState, useRef, useEffect, useLayoutEffect, useEffectEvent } from "react";
import EtapesEditeur from "./EtapesEditeur";
import { problemesEtapes, estSuite } from "./questions";
import { getSubcatColor } from "./couleurs";
import { ALLERGENES } from "./notes";
import { ArrowLeft, Receipt, Flame, Copy, Trash2 } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────
// Fiche d'un produit, en plein écran, une chose par ligne.
// Sert à la création comme à la modification.
// ─────────────────────────────────────────────────────────────────────────

// Hors menu, le piment du produit se demande sur les réponses de sa première
// question : c'est là que la caisse sait le demander (pas sur le produit,
// qu'elle ouvre directement sur les questions).
function avecPimentProduit(etapes, oui) {
  const premiere = etapes.findIndex((e) => !estSuite(e));
  return etapes.map((e, k) => (k !== premiere ? e : {
    ...e,
    articles: (e.articles || []).map((a) => {
      const r = typeof a === "string" ? { name: a } : a;
      if (oui) return { ...r, piment: true };
      const { piment: _piment, ...sans } = r;
      return sans;
    }),
  }));
}

function nettoyer(produit) {
  const p = JSON.parse(JSON.stringify(produit));
  p.name = (p.name || "").trim();
  p.price = Number(String(p.price ?? "").replace(",", "."));
  if (p.subcategory != null) p.subcategory = String(p.subcategory).trim() || undefined;
  if (!p.piment) delete p.piment;
  // allergènes : seulement ceux de la liste réglementaire, dans son ordre ; aucun → pas de champ
  const allergenes = ALLERGENES.filter((a) => (p.allergenes || []).includes(a));
  if (allergenes.length) p.allergenes = allergenes;
  else delete p.allergenes;
  // Les espaces en trop (l'iPad en ajoute) sont retirés PARTOUT à la fois :
  // un titre nettoyé sans son siEtape détachait la question de suite.
  const net = (x) => String(x ?? "").trim();
  let etapes = (p.formulaSteps || []).map((e) => ({
    ...e,
    label: net(e.label),
    ...(estSuite(e) ? { siEtape: net(e.siEtape) } : {}),
    ...(e.pourChoix ? { pourChoix: e.pourChoix.map(net) } : {}),
    articles: (e.articles || []).map((a) => {
      if (typeof a === "string") return net(a);
      // un supplément à 0 € ne sert à rien : on ne le garde pas
      const { supplement, ...r } = a;
      return { ...r, name: net(a.name), ...(supplement === 0 ? {} : supplement != null ? { supplement } : {}) };
    }),
  }));
  if (p.isFormula && etapes.length) {
    if (p.category === "Menu") {
      // dans un menu, aucune question ne remplace le nom ni ne porte de prix :
      // c'est le nom et le prix du menu qui comptent
      p.formulaSteps = etapes.map((etape) => {
        const { remplaceNom: _remplaceNom, ...e } = etape;
        return {
          ...e,
          articles: e.articles.map((a) => {
            if (typeof a !== "object") return a;
            const { price: _price, ...r } = a;
            return r;
          }),
        };
      });
    } else {
      if (p.piment) etapes = avecPimentProduit(etapes, true);
      p.formulaSteps = etapes;
    }
  } else {
    delete p.isFormula;
    delete p.formulaSteps;
  }
  return p;
}

// categories : [{ nom, phrase, section, poste, familles }] (voir MenuSettings)
export default function FicheProduit({ produit, estNouveau, categories, onEnregistrer, onSupprimer, onDupliquer, onFermer }) {
  const [brouillon, setBrouillon] = useState(() => JSON.parse(JSON.stringify(produit)));
  const [confirmeSuppr, setConfirmeSuppr] = useState(false);
  const [nouvelleFamille, setNouvelleFamille] = useState(null);   // texte en cours, null = fermé
  // L'alerte n'apparaît qu'après un essai d'enregistrement (Enregistrer reste
  // grisé tant qu'il manque quelque chose) : rien ne bouge sous le doigt avant.
  const [essaye, setEssaye] = useState(false);
  // Sur téléphone, onglet et famille d'un produit existant se replient (« Changer… »)
  const [voirCat, setVoirCat] = useState(estNouveau);
  const [voirFam, setVoirFam] = useState(estNouveau);
  const corpsRef = useRef(null);
  const prixRef = useRef(null);
  const ligneFamilleRef = useRef(null);
  const familleOuverte = nouvelleFamille !== null;
  useEffect(() => {
    if (familleOuverte) ligneFamilleRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [familleOuverte]);

  const maj = (patch) => setBrouillon((b) => ({ ...b, ...patch }));
  const estMenu = brouillon.category === "Menu";
  const cat = categories.find((c) => c.nom === brouillon.category);
  const familles = cat ? [...cat.familles] : [];
  if (brouillon.subcategory && !familles.includes(brouillon.subcategory)) familles.push(brouillon.subcategory);
  // Le piment ne se demande que pour ce qui sort en cuisine
  const pimentUtile = !estMenu && (!!brouillon.piment || ["Naans", "Entrees", "Plats"].includes(cat?.section));
  const avecQuestions = !!brouillon.isFormula;
  const modifie = JSON.stringify(brouillon) !== JSON.stringify(produit);

  // calcul léger : refait à chaque rendu
  const problemes = (() => {
    const pb = [];
    if (!(brouillon.name || "").trim()) pb.push("Donne un nom au produit.");
    const prix = Number(String(brouillon.price ?? "").replace(",", "."));
    if (String(brouillon.price ?? "").trim() === "" || !Number.isFinite(prix) || prix < 0) {
      pb.push("Indique un prix (0 si c'est offert).");
    }
    if (avecQuestions) {
      if (!(brouillon.formulaSteps || []).length) pb.push("Ajoute au moins une question.");
      pb.push(...problemesEtapes(brouillon.formulaSteps || [], estMenu, brouillon.category, cat?.poste));
    }
    return pb;
  })();
  // tout est réglé : l'alerte ne reviendra qu'au prochain appui sur Enregistrer
  if (essaye && problemes.length === 0) setEssaye(false);

  function fermer() {
    if (modifie && !window.confirm("Quitter sans enregistrer tes changements ?")) return;
    onFermer();
  }

  function enregistrer() {
    if (problemes.length) {
      // Fiche longue déjà défilée : on remonte montrer ce qui manque
      setEssaye(true);
      corpsRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (!estNouveau && !modifie) { onFermer(); return; }
    onEnregistrer(nettoyer(brouillon));
  }

  // Échap (sur ordinateur) : quitte d'abord le champ, puis une saisie
  // secondaire encore ouverte, puis ferme la fiche (avec la même confirmation)
  const surEchap = useEffectEvent((ev) => {
    if (ev.key !== "Escape" || ev.defaultPrevented) return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { el.blur(); return; }
    if (nouvelleFamille !== null) { setNouvelleFamille(null); return; }
    if (confirmeSuppr) { setConfirmeSuppr(false); return; }
    fermer();
  });
  useEffect(() => {
    const touche = (ev) => surEchap(ev);
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, []);

  // « Oui, le client choisit » fait passer la fiche en 2 colonnes sur
  // ordinateur : la tuile touchée est ramenée dans la vue
  const basculeRef = useRef(false);
  useLayoutEffect(() => {
    if (!basculeRef.current) return;
    basculeRef.current = false;
    const corps = corpsRef.current;
    if (!corps) return;
    if (avecQuestions && window.matchMedia("(min-width: 1024px)").matches) {
      // 2 colonnes : la question apparaît en haut à droite, on y va
      corps.scrollTo({ top: 0 });
      corps.querySelector(".fp-col-questions .q-ajout-champ")?.focus({ preventScroll: true });
      return;
    }
    if (avecQuestions) {
      // une colonne : « Le client doit choisir » en haut, la question juste dessous
      corps.querySelector(".fp-ouinon--questions")?.closest(".fp-champ")?.scrollIntoView({ block: "start" });
      return;
    }
    corps.querySelector(".fp-ouinon--questions .fp-tuile.on")?.scrollIntoView({ block: "nearest" });
  }, [avecQuestions]);

  // Une famille n'existe que dans sa catégorie : on la quitte en changeant d'onglet
  function changerCategorie(nom) {
    const c = categories.find((x) => x.nom === nom);
    maj({ category: nom, subcategory: c?.familles.includes(brouillon.subcategory) ? brouillon.subcategory : undefined });
    setNouvelleFamille(null);
  }

  function validerNouvelleFamille() {
    const f = (nouvelleFamille || "").trim();
    const existante = familles.find((x) => x.toLowerCase() === f.toLowerCase());
    if (f) maj({ subcategory: existante || f });
    setNouvelleFamille(null);
  }

  // « Non » garde les questions de côté (enregistrer sans questions les
  // retire) : un appui par erreur ne doit pas tout effacer, « Oui » les rend.
  function basculerQuestions(oui) {
    if (oui === avecQuestions) return;
    basculeRef.current = true;
    if (!oui) { maj({ isFormula: false }); return; }
    const anciennes = brouillon.formulaSteps || [];
    // Une boisson s'écrit par sa réponse (« Coca ») ; un plat garde son nom
    // (« Biryani » puis « Agneau ») : rien ne disparaît du ticket cuisine.
    const premiere = { label: "Choix", articles: [], ...(cat?.section === "Boissons" ? { remplaceNom: true } : {}) };
    maj({ isFormula: true, formulaSteps: anciennes.length ? anciennes : (estMenu ? [] : [premiere]) });
  }

  // Les 14 allergènes réglementaires : on coche ce que contient le plat
  function basculerAllergene(a) {
    const actuels = brouillon.allergenes || [];
    const liste = ALLERGENES.filter((x) => (x === a ? !actuels.includes(a) : actuels.includes(x)));
    maj({ allergenes: liste.length ? liste : undefined });
  }

  function basculerPiment(oui) {
    const patch = { piment: oui || undefined };
    if (avecQuestions) patch.formulaSteps = avecPimentProduit(brouillon.formulaSteps || [], oui);
    maj(patch);
  }

  const alerte = essaye && problemes.length > 0 && (
    <div className="fp-alerte">
      <div className="fp-alerte-titre">Avant d'enregistrer :</div>
      {problemes.map((pb, k) => <div key={k} className="fp-alerte-ligne">• {pb}</div>)}
    </div>
  );

  return (
    <div className={`fp ${avecQuestions ? "fp--large" : ""}`}>
      <div className="fp-barre">
        <button className="fp-retour" onClick={fermer}><ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />Retour</button>
        <span className="fp-titre">{estNouveau ? "Nouveau produit" : brouillon.name || "Produit"}</span>
        <button className="fp-enregistrer" onClick={enregistrer} aria-disabled={problemes.length > 0}>
          Enregistrer
        </button>
      </div>

      <div className={`fp-corps ${avecQuestions ? "fp-corps--2col" : ""} ${alerte ? "fp-corps--alerte" : ""}`} ref={corpsRef}>
        {alerte}

        {/* Sur ordinateur, à gauche : ce qu'est le produit ; à droite : ses questions */}
        <div className="fp-col-infos">
          <div className="fp-rangee">
            <label className="fp-champ">
              <span className="fp-etiquette">Nom</span>
              <input className="fp-saisie" value={brouillon.name || ""} placeholder="Ex. Poulet Madras"
                autoFocus={estNouveau} enterKeyHint="next"
                onKeyDown={(ev) => { if (ev.key === "Enter") prixRef.current?.focus(); }}
                onChange={(ev) => maj({ name: ev.target.value })} />
            </label>

            <label className="fp-champ">
              <span className="fp-etiquette">Prix</span>
              <span className="fp-prix">
                {/* texte et non nombre : la molette de la souris changeait le prix sans prévenir */}
                <input className="fp-saisie fp-saisie--prix" type="text" inputMode="decimal" autoComplete="off" enterKeyHint="done"
                  ref={prixRef} onKeyDown={(ev) => { if (ev.key === "Enter") ev.currentTarget.blur(); }}
                  value={brouillon.price ?? ""} placeholder="0,00"
                  onChange={(ev) => maj({ price: ev.target.value })} />
                <span className="fp-euro">€</span>
              </span>
            </label>
          </div>

          <div className="fp-champ">
            <span className="fp-etiquette">Rangé dans</span>
            <div className={`fp-tuiles fp-tuiles--repliable ${voirCat ? "ouvert" : ""}`}>
              {categories.map((c) => (
                <button key={c.nom} className={`fp-tuile ${brouillon.category === c.nom ? "on" : ""}`}
                  onClick={() => changerCategorie(c.nom)}>{c.nom}</button>
              ))}
              <button className="fp-tuile fp-tuile--changer" onClick={() => setVoirCat(true)}>Changer…</button>
            </div>
            {cat && <span className="fp-ticket"><Receipt size={16} strokeWidth={1.8} aria-hidden="true" />{cat.phrase}</span>}
          </div>

          <div className="fp-champ">
            <span className="fp-etiquette">Famille <em className="fp-etiquette-aide">(le groupe et la couleur du bouton dans la caisse)</em></span>
            <div className={`fp-tuiles fp-tuiles--repliable ${voirFam || nouvelleFamille !== null ? "ouvert" : ""}`}>
              <button className={`fp-tuile ${!brouillon.subcategory ? "on" : ""}`}
                onClick={() => maj({ subcategory: undefined })}>Aucune</button>
              {familles.map((f) => {
                const c = getSubcatColor(f, cat?.couleurs);
                const on = brouillon.subcategory === f;
                return (
                  <button key={f} className={`fp-tuile fp-famille ${on ? "on" : ""}`}
                    onClick={() => maj({ subcategory: f })}>
                    <span className="adm-point" style={c ? { background: c.vif || c.border } : undefined} aria-hidden="true" />{f}
                  </button>
                );
              })}
              {nouvelleFamille === null && (
                <button className="fp-tuile fp-tuile--plus" onClick={() => setNouvelleFamille("")}>+ Nouvelle famille</button>
              )}
              <button className="fp-tuile fp-tuile--changer" onClick={() => setVoirFam(true)}>Changer…</button>
            </div>
            {nouvelleFamille !== null && (
              <div className="fp-ligne" ref={ligneFamilleRef}>
                <input className="fp-saisie" autoFocus placeholder="Ex. Poulet" value={nouvelleFamille} enterKeyHint="done"
                  onChange={(ev) => setNouvelleFamille(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") validerNouvelleFamille();
                    // Échap annule la saisie sans fermer la fiche
                    if (ev.key === "Escape") { ev.preventDefault(); setNouvelleFamille(null); }
                  }} />
                <button className="fp-tuile on" onClick={validerNouvelleFamille}>OK</button>
                <button className="fp-tuile" onClick={() => setNouvelleFamille(null)}>Annuler</button>
              </div>
            )}
          </div>

          {pimentUtile && (
            <div className="fp-champ">
              <span className="fp-etiquette">
                Demander le niveau de piment ?
                {avecQuestions && <em className="fp-etiquette-aide"> (demandé après la réponse à la première question)</em>}
              </span>
              <div className="fp-ouinon">
                <button className={`fp-tuile ${!brouillon.piment ? "on" : ""}`} onClick={() => basculerPiment(false)}>Non</button>
                <button className={`fp-tuile ${brouillon.piment ? "on" : ""}`} onClick={() => basculerPiment(true)}>Oui <Flame size={16} strokeWidth={2} aria-hidden="true" /></button>
              </div>
            </div>
          )}

          {!estMenu && (
            <div className="fp-champ">
              <span className="fp-etiquette">
                Allergènes <em className="fp-etiquette-aide">(cochez ce que contient le plat)</em>
              </span>
              <div className="fp-tuiles fp-allergenes">
                {ALLERGENES.map((a) => {
                  const on = (brouillon.allergenes || []).includes(a);
                  return (
                    <button key={a} className={`fp-tuile ${on ? "on" : ""}`} aria-pressed={on}
                            onClick={() => basculerAllergene(a)}>{a}</button>
                  );
                })}
              </div>
            </div>
          )}

          {!(estMenu && avecQuestions) && (
          <div className="fp-champ">
            <span className="fp-etiquette">
              {estMenu ? "Questions posées au client" : "Le client doit choisir quelque chose ?"}
            </span>
            {!estMenu && (
              <div className="fp-ouinon fp-ouinon--questions">
                <button className={`fp-tuile ${!avecQuestions ? "on" : ""}`} onClick={() => basculerQuestions(false)}>Non</button>
                <button className={`fp-tuile ${avecQuestions ? "on" : ""}`} onClick={() => basculerQuestions(true)}>Oui</button>
              </div>
            )}
            {estMenu && !avecQuestions && (
              <button className="fp-tuile on" onClick={() => basculerQuestions(true)}>Commencer le menu</button>
            )}
          </div>
          )}

        </div>

        {avecQuestions && (
          <div className="fp-col-questions">
            {/* dans un menu, le titre va avec ses questions (et non seul dans la colonne de gauche) */}
            <div className="fp-champ">
              {estMenu && <span className="fp-etiquette">Questions posées au client</span>}
              <EtapesEditeur
                etapes={brouillon.formulaSteps || []}
                onChange={(etapes) => maj({ formulaSteps: etapes })}
                estMenu={estMenu}
                nomProduit={brouillon.name}
                pimentProduit={!estMenu && !!brouillon.piment} />
            </div>
          </div>
        )}

        {!estNouveau && (
          <div className="fp-options">
            {!modifie && (
              <button className="fp-action" onClick={() => onDupliquer(produit)}><Copy size={18} strokeWidth={1.8} aria-hidden="true" />Faire une copie de ce produit</button>
            )}
            {confirmeSuppr ? (
              <div className="fp-confirme">
                <span>Supprimer « {produit.name} » pour de bon ?</span>
                <button className="fp-action fp-action--rouge" onClick={() => onSupprimer(produit)}>Oui, supprimer</button>
                <button className="fp-action" onClick={() => setConfirmeSuppr(false)}>Non</button>
              </div>
            ) : (
              <button className="fp-action fp-action--rouge" onClick={() => setConfirmeSuppr(true)}><Trash2 size={18} strokeWidth={1.8} aria-hidden="true" />Supprimer ce produit</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
