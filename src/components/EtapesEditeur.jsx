import { Fragment, useState, useRef, useEffect, useLayoutEffect } from "react";
import { ticketDeEtape } from "./postes";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, X, Flame, TriangleAlert } from "lucide-react";
import { ICONE_QUESTION } from "./icones";
import {
  QUESTIONS_MENU, nomChoix, objet, simple, estSuite, avecPrix, remplaceLeChoix, questionDuPrix, finDuBloc, fautiveDuBloc, titreLibre,
} from "./questions";

// ─────────────────────────────────────────────────────────────────────────
// Éditeur « comme pour un enfant ».
//
// Un produit pose des QUESTIONS au client ; chaque question a des RÉPONSES ;
// une réponse peut entraîner une QUESTION DE SUITE (Kir → « Quel kir ? »).
// L'équipe ne voit jamais les mots du modèle de données :
//   question         → étape sans siEtape
//   question de suite → étape avec siEtape (titre du parent) et pourChoix
//   remplace / précise → « Sur le ticket : Kir royal seulement » ou
//                        « Café gourmand puis Café allongé », deviné à la
//                        première réponse, toujours modifiable
// ─────────────────────────────────────────────────────────────────────────

// pimentProduit : hors menu, le produit demande le piment, posé sur les
// réponses de sa première question (c'est là que la caisse le demande)
export default function EtapesEditeur({ etapes, onChange, estMenu, nomProduit, pimentProduit = false }) {
  const [saisie, setSaisie] = useState({});
  const [ouverte, setOuverte] = useState(null);       // réponse dont on règle les options : "i:ai"
  const [choixQuestion, setChoixQuestion] = useState(false);
  const [titreNouvelle, setTitreNouvelle] = useState("");
  // Un gros menu s'ouvre replié : on voit toutes ses questions d'un coup
  // d'œil et on déplie celle à modifier (7 à 18 écrans à faire défiler sinon)
  const [repliees, setRepliees] = useState(() => {
    const p = etapes.filter((e) => !estSuite(e));
    // une question à compléter reste dépliée
    return new Set(estMenu && p.length > 3
      ? p.filter((e) => !fautiveDuBloc(etapes, etapes.indexOf(e), estMenu)).map((e) => e.label) : []);
  });
  const ancreRepli = useRef(null);
  const racineRef = useRef(null);
  const basculerRepli = (label, cible) => {
    // deux questions du même titre ne se replient pas (l'état est rangé par titre)
    if (etapes.filter((x) => !estSuite(x) && x.label === label).length > 1) return;
    const k = etapes.findIndex((e) => e.label === label && !estSuite(e));
    const q = document.querySelector(`.q[data-etape="${k}"]`);
    // on garde sous le doigt la question dont on vient de toucher ▾ ou le résumé :
    // c'est ce bouton qui doit être visible, le haut de la carte peut dépasser
    const zone = q?.closest(".fp-corps")?.getBoundingClientRect();
    const touche = (cible || q?.querySelector(":scope > .q-tete .q-plier"))?.getBoundingClientRect();
    ancreRepli.current = q && zone && touche && touche.bottom > zone.top && touche.top < zone.bottom
      ? { k, top: q.getBoundingClientRect().top } : null;
    setOuverte(null);
    setRepliees((avant) => {
    const n = new Set(avant);
    if (n.has(label)) n.delete(label); else n.add(label);
    return n;
  }); };
  useLayoutEffect(() => {
    const a = ancreRepli.current;
    ancreRepli.current = null;
    if (!a) return;
    const q = document.querySelector(`.q[data-etape="${a.k}"]`);
    const corps = q?.closest(".fp-corps");
    if (!q || !corps) return;
    // le rab d'un repli précédent est retiré ici, après la mesure du doigt :
    // la compensation ci-dessous rattrape le décalage qu'il cause
    const options = corps.querySelector(":scope > .fp-options");
    const porteRab = options && getComputedStyle(corps).display !== "grid" ? options : racineRef.current;
    if (racineRef.current) racineRef.current.style.paddingBottom = "";
    if (options) options.style.paddingBottom = "";
    const d = q.getBoundingClientRect().top - a.top;
    if (Math.abs(d) <= 1) return;
    // Replier en bas de fiche raccourcit la page : le défilement ne pourrait
    // plus garder la question sous le doigt. On ajoute la hauteur qui manque
    // sous les questions (retirée au prochain repli).
    const manque = corps.scrollTop + d - (corps.scrollHeight - corps.clientHeight);
    if (manque > 0 && porteRab) porteRab.style.paddingBottom = `${Math.ceil(manque)}px`;
    corps.scrollTop += d;
  }, [repliees]);

  // Ce qui s'ouvre en bas de l'écran est ramené dans la vue
  const refOptions = useRef(null);
  const refChoix = useRef(null);
  useEffect(() => {
    const o = refOptions.current;
    const corps = o?.closest(".fp-corps");
    if (!o || !corps) return;
    const rep = o.previousElementSibling?.querySelector(".q-reponse") || o.previousElementSibling;
    const c = corps.getBoundingClientRect(), ob = o.getBoundingClientRect();
    const deborde = ob.bottom + 24 - c.bottom;
    if (deborde <= 0) return;
    // on remonte juste assez pour voir les options, sans cacher la réponse touchée
    const marge = rep ? rep.getBoundingClientRect().top - c.top - 8 : deborde;
    corps.scrollBy({ top: Math.max(0, Math.min(deborde, marge)), behavior: "smooth" });
  }, [ouverte]);

  // « + Poser une autre question » : la nouvelle question est montrée, prête à recevoir ses réponses
  const aMontrerRef = useRef(null);
  useEffect(() => {
    const n = aMontrerRef.current;
    if (n === null) return;
    aMontrerRef.current = null;
    const q = document.querySelector(`.q[data-etape="${n}"]`);
    if (!q) return;
    const champ = q.querySelector(":scope > .q-reponses .q-ajout-champ");
    (champ || q).scrollIntoView({ block: "center", behavior: "smooth" });
    champ?.focus({ preventScroll: true });
  }, [etapes]);
  useEffect(() => { if (choixQuestion) refChoix.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [choixQuestion]);

  // Échap ferme d'abord ce qui est ouvert ici (panneau, options, saisie)
  // au lieu de fermer toute la fiche et de perdre ce qui était tapé
  useEffect(() => {
    const f = (ev) => {
      if (ev.key !== "Escape" || ev.defaultPrevented) return;
      // le curseur est dans « Nouvelle famille » : c'est elle qui se ferme, seule
      const actif = document.activeElement;
      if (actif instanceof HTMLInputElement && actif.closest(".fp-ligne")) return;
      if (choixQuestion) { ev.preventDefault(); setChoixQuestion(false); setTitreNouvelle(""); return; }
      if (ouverte !== null) { ev.preventDefault(); setOuverte(null); return; }
      const el = document.activeElement;
      // quitter « Nouvelle réponse… » l'ajoute (onBlur), comme en touchant ailleurs
      if (el instanceof HTMLInputElement && el.closest(".qq")) { ev.preventDefault(); el.blur(); }
    };
    window.addEventListener("keydown", f, true);   // avant l'écouteur de la fiche
    return () => window.removeEventListener("keydown", f, true);
  }, [choixQuestion, ouverte]);

  const changer = (liste) => onChange(liste);
  // Quand des questions changent de place, le texte en cours ne doit pas
  // sauter dans la voisine : on l'efface plutot que de le deplacer de travers.
  const restructurer = (liste) => { setSaisie({}); setOuverte(null); changer(liste); };
  const majEtape = (i, patch) => changer(etapes.map((e, k) => (k === i ? { ...e, ...patch } : e)));

  // Renommer une question : ses questions de suite la suivent
  function renommer(i, titre) {
    const ancien = etapes[i].label;
    const fin = finDuBloc(etapes, i);
    // une question repliée le reste pendant qu'on la renomme
    const partage = etapes.some((x, k) => k !== i && !estSuite(x) && x.label === ancien);
    // prendre en passant le titre d'une autre question ne doit pas replier celle-ci
    const prisAilleurs = etapes.some((x, k) => k !== i && !estSuite(x) && x.label === titre);
    if (repliees.has(ancien) && !partage) {
      setRepliees((avant) => { const n = new Set(avant); n.delete(ancien); if (!prisAilleurs) n.add(titre); return n; });
    }
    // On ne touche qu'aux questions de suite de CE bloc : effacer le titre
    // lettre par lettre ne doit ni les detacher ni en voler a une autre question.
    changer(etapes.map((e, k) => {
      if (k === i) return { ...e, label: titre };
      return k > i && k < fin && e.siEtape === ancien ? { ...e, siEtape: titre } : e;
    }));
  }

  function ajouterQuestion(titre) {
    const t = (titre || "").trim();
    if (!t) return;
    const label = titreLibre(etapes, t, estMenu);
    setRepliees((avant) => { const n = new Set(avant); n.delete(label); return n; });
    changer([...etapes, { label, articles: [] }]);
    setChoixQuestion(false);
    setTitreNouvelle("");
  }

  // Une question principale ne dépend que de réponses posées AVANT elle (et pas
  // « écrites à la main ») : une réponse disparue est oubliée ; s'il n'en reste
  // aucune, la question redevient posée à chaque fois
  function nettoyerConditions(liste) {
    return liste.map((e, k) => {
      if (estSuite(e) || !(e.pourChoix || []).length) return e;
      const noms = new Set(liste.slice(0, k).flatMap((x) => (x.articles || [])
        .filter((a) => !(typeof a === "object" && a?.libre)).map(nomChoix)));
      const reste = e.pourChoix.filter((c) => noms.has(c));
      if (reste.length === e.pourChoix.length) return e;
      if (reste.length) return { ...e, pourChoix: reste };
      const { pourChoix: _p, ...sans } = e;
      return sans;
    });
  }

  // Titre automatique d'une question de suite dont les réponses déclencheuses
  // ont changé (retirée, renommée) : il les suit, comme quand on coche
  function retitrer(liste, k, ancienne) {
    const e = liste[k];
    if (!e || !estSuite(e) || !titreAutomatique(ancienne)) return liste;
    const pc = e.pourChoix || [];
    if (!pc.length) return liste;
    const label = titreLibre(liste.filter((_, x) => x !== k), pc.length <= 2 ? `Choix ${pc.join(" ou ")}` : "Précision");
    if (label === e.label) return liste;
    const fin = finDuBloc(liste, k);
    return liste.map((x, n) => (n === k ? { ...x, label } : n > k && n < fin && x.siEtape === e.label ? { ...x, siEtape: label } : x));
  }

  function deplacerBloc(i, sens) {
    const principales = etapes.map((e, k) => (estSuite(e) ? -1 : k)).filter((k) => k >= 0);
    const voisin = principales[principales.indexOf(i) + sens];
    if (voisin === undefined) return;
    const [a, b] = sens < 0 ? [voisin, i] : [i, voisin];
    const finA = finDuBloc(etapes, a), finB = finDuBloc(etapes, b);
    restructurer(nettoyerConditions([...etapes.slice(0, a), ...etapes.slice(b, finB), ...etapes.slice(a, finA), ...etapes.slice(finB)]));
  }

  function supprimerBloc(i) {
    // un titre supprimé ne doit pas replier plus tard une question renommée ainsi
    const partis = new Set(etapes.slice(i, finDuBloc(etapes, i)).map((e) => e.label));
    setRepliees((avant) => new Set([...avant].filter((l) => !partis.has(l))));
    restructurer(nettoyerConditions([...etapes.slice(0, i), ...etapes.slice(finDuBloc(etapes, i))]));
  }

  function ajouterReponse(i) {
    const nom = (saisie[i] || "").trim();
    const e = etapes[i];
    if (!nom || (e.articles || []).some((a) => nomChoix(a) === nom)) return;
    // dans un menu, un plat se demande toujours avec son piment : règle de la maison
    const premiere = etapes.findIndex((x) => !estSuite(x));
    const piment = (estMenu && simple(e.label).startsWith("plat")) || (!estMenu && pimentProduit && i === premiere);
    const patch = { articles: [...(e.articles || []), { name: nom, piment }] };
    // première réponse d'une question de suite : on devine remplace / précise
    if (estSuite(e) && !(e.articles || []).length) {
      const remplace = (e.pourChoix || []).length > 0 && e.pourChoix.every((d) => remplaceLeChoix(d, [nom]));
      patch.remplaceParent = remplace || undefined;
    }
    majEtape(i, patch);
    setSaisie({ ...saisie, [i]: "" });
  }

  // Renommer une réponse : les questions posées « quand le client choisit »
  // cette réponse suivent le nouveau nom
  function renommerReponse(i, ai, nouveau) {
    const ancien = nomChoix(etapes[i].articles[ai]);
    const parent = etapes[i].label;
    if (etapes[i].articles.some((a, k) => k !== ai && nomChoix(a) === nouveau)) return;
    let liste = etapes.map((e, k) => {
      if (k === i) return { ...e, articles: e.articles.map((a, x) => (x === ai ? { ...objet(a), name: nouveau } : a)) };
      if (e.siEtape === parent && (e.pourChoix || []).includes(ancien)) {
        return { ...e, pourChoix: e.pourChoix.map((c) => (c === ancien ? nouveau : c)) };
      }
      // question principale posée après : si une autre réponse porte encore
      // l'ancien nom avant elle, la condition le garde (et suit aussi le nouveau)
      if (k > i && !estSuite(e) && (e.pourChoix || []).includes(ancien)) {
        const encore = etapes.slice(0, k).some((x, n) => (x.articles || []).some((a, m) =>
          !(n === i && m === ai) && !(typeof a === "object" && a?.libre) && nomChoix(a) === ancien));
        const pc = encore ? [...e.pourChoix, nouveau] : e.pourChoix.map((c) => (c === ancien ? nouveau : c));
        return { ...e, pourChoix: [...new Set(pc)] };
      }
      return e;
    });
    etapes.forEach((e, k) => {
      if (e.siEtape === parent && (e.pourChoix || []).includes(ancien)) liste = retitrer(liste, k, e);
    });
    changer(liste);
  }

  function deplacerReponse(i, ai, sens) {
    const arts = [...etapes[i].articles];
    const j = ai + sens;
    if (j < 0 || j >= arts.length) return;
    [arts[ai], arts[j]] = [arts[j], arts[ai]];
    majEtape(i, { articles: arts });
    setOuverte(`${i}:${j}`);
  }

  function majReponse(i, ai, patch) {
    majEtape(i, { articles: etapes[i].articles.map((a, k) => (k === ai ? { ...objet(a), ...patch } : a)) });
  }

  // Supplément : s'ajoute au prix (Cassis +0,50 €), sur n'importe quelle question
  function supplementReponse(i, ai, valeur) {
    const r = objet(etapes[i].articles[ai]);
    const { supplement: _s, ...sans } = r;
    majEtape(i, { articles: etapes[i].articles.map((a, k) =>
      (k === ai ? (valeur === "" ? sans : { ...r, supplement: parseFloat(valeur) }) : a)) });
  }

  function prixReponse(i, ai, valeur) {
    const r = objet(etapes[i].articles[ai]);
    const { price: _price, ...sans } = r;
    majEtape(i, { articles: etapes[i].articles.map((a, k) =>
      (k === ai ? (valeur === "" ? sans : { ...r, price: parseFloat(valeur) }) : a)) });
  }

  // Retirer une réponse retire la question de suite qu'elle seule déclenchait
  function retirerReponse(i, ai) {
    const nom = nomChoix(etapes[i].articles[ai]);
    const parent = etapes[i].label;
    let liste = etapes.map((e, k) => {
      if (k === i) return { ...e, articles: e.articles.filter((_, x) => x !== ai) };
      if (e.siEtape === parent && (e.pourChoix || []).includes(nom)) {
        return { ...e, pourChoix: e.pourChoix.filter((c) => c !== nom) };
      }
      return e;
    });
    etapes.forEach((e, k) => {
      if (e.siEtape === parent && (e.pourChoix || []).includes(nom)) liste = retitrer(liste, k, e);
    });
    for (let k = liste.length - 1; k >= 0; k--) {
      if (estSuite(liste[k]) && !(liste[k].pourChoix || []).length) {
        liste = [...liste.slice(0, k), ...liste.slice(finDuBloc(liste, k))];
      }
    }
    changer(nettoyerConditions(liste));
    setOuverte(null);
  }

  // Réponses qui peuvent déclencher une question : celles de sa question
  // parente (question de suite), sinon celles des questions posées avant elle.
  // Une réponse « écrite à la main » ne déclenche rien (son nom change).
  function declencheursPossibles(i) {
    const e = etapes[i];
    const avant = etapes.slice(0, i);
    const sources = estSuite(e) ? avant.filter((x) => x.label === e.siEtape) : avant;
    const noms = sources.flatMap((x) => (x.articles || [])
      .filter((a) => !(typeof a === "object" && a?.libre)).map(nomChoix)).filter(Boolean);
    return [...new Set(noms)];
  }

  // Cocher / décocher une réponse qui déclenche la question (Supplément posé
  // pour le Kir vin blanc et le Kir royal, pas pour le Kir indien)
  function basculerDeclencheur(i, nom) {
    const e = etapes[i];
    const possibles = declencheursPossibles(i);
    const actuels = (e.pourChoix || []).filter((c) => possibles.includes(c));
    const voulus = actuels.includes(nom) ? actuels.filter((c) => c !== nom) : [...actuels, nom];
    if (!voulus.length) return;   // une question à condition garde au moins une réponse
    const pourChoix = possibles.filter((c) => voulus.includes(c));
    // Le titre donné automatiquement (« Choix … ») suit les réponses cochées ;
    // un titre écrit à la main ne bouge pas
    let label = e.label;
    if (estSuite(e) && titreAutomatique(e)) {
      const voulu = pourChoix.length <= 2 ? `Choix ${pourChoix.join(" ou ")}` : "Précision";
      label = titreLibre(etapes.filter((_, k) => k !== i), voulu);
    }
    const fin = finDuBloc(etapes, i);
    changer(etapes.map((x, k) => {
      if (k === i) return { ...x, pourChoix, label };
      return label !== e.label && k > i && k < fin && x.siEtape === e.label ? { ...x, siEtape: label } : x;
    }));
  }

  // Titre encore tel que la fiche l'a donné (« Choix Kir royal 15cl »,
  // « Choix A ou B », « Précision »), éventuellement numéroté (« (2) »)
  function titreAutomatique(e) {
    const base = (e.label || "").replace(/ \(\d+\)$/, "");
    const pc = e.pourChoix || [];
    return base === "Précision" || base === `Choix ${pc.join(" ou ")}` || (pc.length > 0 && base === `Choix ${pc[0]}`);
  }

  // Une question de B est posée seulement après une réponse de A : B ne peut
  // pas passer avant A
  function dependDe(a, b) {
    const noms = new Set(etapes.slice(a, finDuBloc(etapes, a)).flatMap((x) => (x.articles || []).map(nomChoix)));
    return etapes.slice(b, finDuBloc(etapes, b)).some((x) => !estSuite(x) && (x.pourChoix || []).some((c) => noms.has(c)));
  }

  function ajouterSuite(i, ai) {
    const declencheur = nomChoix(etapes[i].articles[ai]);
    const fin = finDuBloc(etapes, i);
    const nouvelle = {
      // sans guillemets : « et » sortaient en caractères parasites sur l'addition
      label: titreLibre(etapes, `Choix ${declencheur}`),
      siEtape: etapes[i].label,
      pourChoix: [declencheur],
      articles: [],
    };
    restructurer([...etapes.slice(0, fin), nouvelle, ...etapes.slice(fin)]);
    aMontrerRef.current = fin;
  }

  const principales = etapes.map((e, k) => (estSuite(e) ? -1 : k)).filter((k) => k >= 0);
  const porteuse = estMenu ? null : questionDuPrix(etapes);

  function changerMode(i, remplace) {
    majEtape(i, { remplaceParent: remplace || undefined });
  }

  function rendreQuestion(i) {
    const e = etapes[i];
    const principale = !estSuite(e);
    const doublon = principale && principales.filter((k) => etapes[k].label === e.label).length > 1;
    const replie = principale && repliees.has(e.label) && !doublon;
    const pos = principales.indexOf(i);
    const suites = etapes.map((x, k) => ({ x, k })).filter(({ x }) => estSuite(x) && x.siEtape === e.label && x !== e);
    // Le prix d'une reponse remplace le prix du produit : sans objet dans un
    // menu (le prix est celui du menu), et une seule question peut le porter.
    const questionPrix = !estMenu && (porteuse
      ? e === porteuse
      : (avecPrix(e) || !etapes.some((x) => x !== e && avecPrix(x))));
    // Une question de suite qui precise sans remplacer n'est pas imprimee
    // comme article : une suite accrochee a elle ne sortirait jamais.
    const peutAvoirSuite = principale || e.remplaceParent;
    // le titre d'une question principale de menu vient de la liste : il décide
    // du ticket. Un titre que l'imprimante ne connaît pas se remplace par la liste.
    const titreFixe = estMenu && principale && !!ticketDeEtape(e.label);
    const titreAChanger = estMenu && principale && !titreFixe;

    const nbReponses = (e.articles || []).length;
    const tete = (
      <div className="q-tete">
        {principale && (
          <button className="q-rond q-plier" aria-expanded={!replie} aria-label={replie ? "Déplier la question" : "Replier la question"}
            disabled={doublon} onClick={(ev) => basculerRepli(e.label, ev.currentTarget)}>{replie ? <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" /> : <ChevronDown size={18} strokeWidth={1.8} aria-hidden="true" />}</button>
        )}
        {titreFixe
          ? <span className="q-titre q-titre--fixe">{e.label.replace(/ (\S+)$/, "\u00a0$1")}</span>
          : <input className="q-titre" value={e.label} placeholder="Titre de la question"
              onChange={(ev) => renommer(i, ev.target.value)} />}
        <span className="q-actions">
          {principale && (
            <span className="q-ordre">
              <button className="q-rond" disabled={pos === 0 || dependDe(principales[pos - 1], i)}
                title={pos > 0 && dependDe(principales[pos - 1], i) ? "Elle dépend de la question du dessus" : undefined}
                onClick={() => deplacerBloc(i, -1)} aria-label="Monter la question"><ArrowUp size={18} strokeWidth={1.8} aria-hidden="true" /></button>
              <button className="q-rond" disabled={pos === principales.length - 1 || dependDe(i, principales[pos + 1])}
                title={pos < principales.length - 1 && dependDe(i, principales[pos + 1]) ? "La question du dessous dépend d'elle" : undefined}
                onClick={() => deplacerBloc(i, 1)} aria-label="Descendre la question"><ArrowDown size={18} strokeWidth={1.8} aria-hidden="true" /></button>
            </span>
          )}
          {/* un seul appui effaçait la question et toutes ses réponses */}
          <button className="q-rond q-rond--rouge" aria-label="Supprimer la question"
            onClick={() => {
              // tout le bloc part : la question, ses réponses et ses questions de suite
              const nbSuites = finDuBloc(etapes, i) - i - 1;
              const detail = `ses ${nbReponses} réponse(s)${nbSuites ? ` et ${nbSuites} question(s) de suite` : ""}`;
              if (!nbReponses && !nbSuites) { supprimerBloc(i); return; }
              if (window.confirm(`Supprimer la question « ${e.label || "sans titre"} », ${detail} ?`)) supprimerBloc(i);
            }}><X size={18} strokeWidth={1.8} aria-hidden="true" /></button>
        </span>
      </div>
    );

    if (replie) {
      const fautive = fautiveDuBloc(etapes, i, estMenu);
      return (
        <div key={i} className={`q q--repliee ${fautive ? "q--a-voir" : ""}`} data-etape={i}>
          {tete}
          <button className="q-resume" onClick={(ev) => basculerRepli(e.label, ev.currentTarget)}>
            {fautive && <span className="q-resume-alerte"><TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />« {fautive.label || "Question sans titre"} » à compléter · </span>}
            {nbReponses} réponse{nbReponses > 1 ? "s" : ""}
            {(() => {
              const n = finDuBloc(etapes, i) - i - 1;
              return n > 0 && ` · ${n} question${n > 1 ? "s" : ""} de suite`;
            })()}
            {nbReponses > 0 && <span className="q-resume-noms"> : {(e.articles || []).slice(0, 4).map(nomChoix).join(", ")}{nbReponses > 4 ? "…" : ""}</span>}
          </button>
        </div>
      );
    }

    return (
      <div key={i} className={`q ${principale ? "" : "q--suite"}`} data-etape={i}>
        {tete}

        {titreAChanger && (
          <div className="q-remplacer">
            <span>Remplacer par :</span>
            {QUESTIONS_MENU.map((q) => (
              <button key={q.label} className="q-mini" onClick={() => renommer(i, titreLibre(etapes, q.label, true))}>
                {(() => { const Ic = ICONE_QUESTION[q.label]; return Ic ? <Ic size={16} strokeWidth={1.8} aria-hidden="true" /> : q.icone; })()} {q.label}
              </button>
            ))}
          </div>
        )}

        {(e.pourChoix || []).length > 0 && (() => {
          const possibles = declencheursPossibles(i);
          if (!possibles.length) {
            return (
              <div className="q-quand">
                Posée quand le client choisit <b>{e.pourChoix.join(" ou ")}</b>
                {principale && (
                  <button className="fp-tuile q-quand-tuile q-quand-toujours" onClick={() => {
                    const { pourChoix: _p, ...sans } = e;
                    changer(etapes.map((x, k) => (k === i ? sans : x)));
                  }}>Poser à chaque fois</button>
                )}
              </div>
            );
          }
          return (
            <div className="q-quand">
              <span className="q-quand-titre">Posée seulement quand le client choisit :</span>
              <div className="fp-tuiles q-quand-choix">
                {possibles.map((nom) => {
                  const on = e.pourChoix.includes(nom);
                  const dernier = on && possibles.filter((n) => e.pourChoix.includes(n)).length === 1;
                  return (
                    <button key={nom} className={`fp-tuile q-quand-tuile ${on ? "on" : ""}`}
                      aria-pressed={on} aria-disabled={dernier || undefined}
                      title={dernier ? "Il faut au moins une réponse" : undefined}
                      onClick={() => basculerDeclencheur(i, nom)}>{nom}</button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {principale && pos > 0 && dependDe(principales[pos - 1], i) && (
          <div className="q-lien">Posée après « {etapes[principales[pos - 1]].label} » : elle reste en dessous.</div>
        )}
        {principale && pos < principales.length - 1 && dependDe(i, principales[pos + 1]) && (
          <div className="q-lien">« {etapes[principales[pos + 1]].label} » dépend de ses réponses : elle reste au-dessus.</div>
        )}

        {/* Question de suite : ce qui sort sur le ticket, montré tel quel */}
        {!principale && (() => {
          const decl = (e.pourChoix || [])[0] || "le choix";
          const ex = (e.articles || []).length ? nomChoix(e.articles[0]) : "la réponse";
          return (
            <div className="q-ticket">
              <span className="q-ticket-titre">Sur le ticket :</span>
              <div className="q-ticket-choix">
                <button className={`q-ticket-btn ${!e.remplaceParent ? "on" : ""}`} onClick={() => changerMode(i, false)}>
                  {decl} <em>puis</em> {ex}
                </button>
                <button className={`q-ticket-btn ${e.remplaceParent ? "on" : ""}`} onClick={() => changerMode(i, true)}>
                  {ex} <em>seulement</em>
                </button>
              </div>
            </div>
          );
        })()}

        {/* Hors menu : la réponse peut prendre la place du nom (Soda → « Coca ») */}
        {!estMenu && principale && (
          <button className={`q-bascule ${e.remplaceNom ? "on" : ""}`}
            onClick={() => changer(etapes.map((x, k) => {
              // une seule question peut prendre la place du nom
              if (k === i) return { ...x, remplaceNom: !e.remplaceNom };
              if (!e.remplaceNom && x.remplaceNom) { const { remplaceNom: _remplaceNom, ...r } = x; return r; }
              return x;
            }))}>
            {(() => {
              const ex = (e.articles || []).length ? nomChoix(e.articles[0]) : "Coca";
              return <span>Sur le ticket, écrire seulement la réponse<em>« {ex} » au lieu de « {nomProduit || "Produit"} · {ex} »</em></span>;
            })()}
            <span className="q-oui-non">{e.remplaceNom ? "Oui" : "Non"}</span>
          </button>
        )}

        <div className="q-reponses">
          {(e.articles || []).map((a, ai) => {
            const r = objet(a);
            const cle = `${i}:${ai}`;
            const estOuverte = ouverte === cle;
            const aUneSuite = suites.some(({ x }) => (x.pourChoix || []).includes(r.name));
            // une question posée après cette réponse : son nom doit rester fixe
            const declencheAutre = etapes.some((x, k) => k > i && !estSuite(x) && (x.pourChoix || []).includes(r.name));
            return (
              <Fragment key={ai}>
              <div className="q-reponse-bloc">
                <button className={`q-reponse ${estOuverte ? "on" : ""} ${r.libre ? "q-reponse--libre" : ""}`}
                  onClick={() => setOuverte(estOuverte ? null : cle)}>
                  <span className="q-reponse-nom">{r.name}</span>
                  <span className="q-reponse-tags">
                    {!estMenu && r.price != null && <span className="q-tag">{Number(r.price).toFixed(2)} €</span>}
                    {r.supplement > 0 && <span className="q-tag">+{Number(r.supplement).toFixed(2)} €</span>}
                    {r.piment && <span className="q-tag q-tag--icone" role="img" aria-label="Piment demandé" title="Piment demandé"><Flame size={14} strokeWidth={2} aria-hidden="true" /></span>}
                    {r.libre && <span className="q-tag">écrit à la main</span>}
                    {aUneSuite && <span className="q-tag q-tag--suite">+ question</span>}
                  </span>
                </button>
              </div>

                {estOuverte && (
                  <div className="q-options" ref={refOptions}>
                    <div className="q-option">
                      <span>Nom</span>
                      <input className="q-nom" value={r.name} onChange={(ev) => renommerReponse(i, ai, ev.target.value)} />
                    </div>
                    {(e.articles || []).length > 1 && (
                      <div className="q-option">
                        <span>Place</span>
                        <span className="q-ordre">
                          <button className="q-rond" disabled={ai === 0} onClick={() => deplacerReponse(i, ai, -1)} aria-label="Monter la réponse"><ArrowUp size={18} strokeWidth={1.8} aria-hidden="true" /></button>
                          <button className="q-rond" disabled={ai === e.articles.length - 1} onClick={() => deplacerReponse(i, ai, 1)} aria-label="Descendre la réponse"><ArrowDown size={18} strokeWidth={1.8} aria-hidden="true" /></button>
                        </span>
                      </div>
                    )}
                    {!estMenu && (questionPrix || r.price != null) && (
                      <div className="q-option">
                        <span>Prix de ce choix</span>
                        <span className="fp-prix">
                          {/* la molette de la souris ne doit pas changer le prix sans prévenir */}
                          <input className="q-prix" type="number" inputMode="decimal" step="0.5" min="0" placeholder="idem"
                            value={r.price ?? ""} onWheel={(ev) => ev.currentTarget.blur()}
                            onChange={(ev) => prixReponse(i, ai, ev.target.value)} />
                          <span className="fp-euro">€</span>
                        </span>
                      </div>
                    )}
                    {/* supplément payant, possible partout (y compris dans un menu) */}
                    <div className="q-option">
                      <span>Supplément payant</span>
                      <span className="fp-prix">
                        <span className="fp-euro">+</span>
                        <input className="q-prix" type="number" inputMode="decimal" step="0.5" min="0" placeholder="0"
                          aria-label={`Supplément pour ${r.name}`}
                          value={r.supplement ?? ""} onWheel={(ev) => ev.currentTarget.blur()}
                          onChange={(ev) => supplementReponse(i, ai, ev.target.value)} />
                        <span className="fp-euro">€</span>
                      </span>
                    </div>
                    {estMenu && simple(e.label).startsWith("plat") && (
                      <button className={`q-option q-option--bascule ${r.piment ? "on" : ""}`}
                        onClick={() => majReponse(i, ai, { piment: !r.piment })}>
                        <span>Demander le piment</span><span className="q-oui-non">{r.piment ? "Oui" : "Non"}</span>
                      </button>
                    )}
                    {!aUneSuite && !declencheAutre && (
                      <button className={`q-option q-option--bascule ${r.libre ? "on" : ""}`}
                        onClick={() => majReponse(i, ai, { libre: !r.libre })}>
                        <span>Le serveur écrit lui-même le nom</span><span className="q-oui-non">{r.libre ? "Oui" : "Non"}</span>
                      </button>
                    )}
                    {!r.libre && peutAvoirSuite && (
                      <button className="q-option q-option--action" onClick={() => ajouterSuite(i, ai)}>
                        {aUneSuite ? `+ Poser encore une question après « ${r.name} »` : `+ Poser une autre question après « ${r.name} »`}
                      </button>
                    )}
                    <button className="q-option q-option--suppr" onClick={() => retirerReponse(i, ai)}>
                      Retirer « {r.name} »
                    </button>
                  </div>
                )}
              </Fragment>
            );
          })}

          <div className="q-ajout">
            <input className="q-ajout-champ" placeholder="Nouvelle réponse…"
              value={saisie[i] || ""}
              onChange={(ev) => setSaisie({ ...saisie, [i]: ev.target.value })}
              onKeyDown={(ev) => { if (ev.key === "Enter") ajouterReponse(i); }}
              onBlur={() => ajouterReponse(i)} />
            <button className="q-ajout-btn" disabled={!(saisie[i] || "").trim()} onMouseDown={(ev) => ev.preventDefault()} onClick={() => ajouterReponse(i)}>Ajouter</button>
          </div>
        </div>

        {suites.map(({ k }) => rendreQuestion(k))}
      </div>
    );
  }

  return (
    <div className="qq" ref={racineRef}>
      {principales.map((i) => rendreQuestion(i))}

      {!choixQuestion && (
        <button className="qq-ajouter" onClick={() => setChoixQuestion(true)}>+ Ajouter une question</button>
      )}

      {choixQuestion && estMenu && (
        <div className="qq-choix" ref={refChoix}>
          <div className="qq-choix-titre">Quelle question poser au client ?</div>
          <div className="qq-choix-grille">
            {QUESTIONS_MENU.map((q) => (
              <button key={q.label} className="qq-tuile" onClick={() => ajouterQuestion(q.label)}>
                <span className="qq-tuile-icone">{(() => { const Ic = ICONE_QUESTION[q.label]; return Ic ? <Ic size={26} strokeWidth={1.6} aria-hidden="true" /> : q.icone; })()}</span>{q.label}
              </button>
            ))}
          </div>
          <div className="qq-choix-actions">
            <button className="qq-annuler" onClick={() => { setChoixQuestion(false); setTitreNouvelle(""); }}>Annuler</button>
          </div>
        </div>
      )}

      {choixQuestion && !estMenu && (
        <div className="qq-choix" ref={refChoix}>
          <div className="qq-choix-titre">Quelle question poser au client ?</div>
          <input className="q-ajout-champ" autoFocus placeholder="Parfum, Taille, Format…"
            value={titreNouvelle} onChange={(ev) => setTitreNouvelle(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") ajouterQuestion(titreNouvelle); }} />
          <div className="qq-choix-actions">
            <button className="qq-annuler" onClick={() => { setChoixQuestion(false); setTitreNouvelle(""); }}>Annuler</button>
            <button className="q-ajout-btn" disabled={!titreNouvelle.trim()} onClick={() => ajouterQuestion(titreNouvelle)}>Ajouter</button>
          </div>
        </div>
      )}
    </div>
  );
}
