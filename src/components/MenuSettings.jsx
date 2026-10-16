import { useState, useMemo, useRef, useEffect, useEffectEvent } from "react";
import { getDefaultPasswords, savePasswords, lockApp } from "./PasswordGate";
import FicheProduit from "./FicheProduit";
import FicheCategorie from "./FicheCategorie";
import { getSubcatColor } from "./couleurs";
import { avecSection, famillesDe, phraseTicket, posteRegle, sectionDeCategorie } from "./postes";
import useHauteurVisible from "./useHauteurVisible";
import useAuBout from "./useAuBout";
import { ArrowLeft, Settings, Search, X, Plus, Receipt, Pencil, Flame, Printer, KeyRound, Lock, Eye, EyeOff } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────
// Admin de la carte : la même chose que la caisse, mais toucher un bouton
// ouvre sa fiche au lieu de l'ajouter à la commande.
// ─────────────────────────────────────────────────────────────────────────

// Repere identique a celui des boutons de la caisse
function badgeFormule(item) {
  const n = (item.formulaSteps || []).length;
  if (!item.isFormula || !n) return null;
  // Les mêmes mots que dans la fiche (« Questions posées au client »), et
  // court : « Menu · 10 étapes » élargissait la tuile hors de l'écran du téléphone.
  const questions = `${n} question${n > 1 ? "s" : ""}`;
  if (item.category === "Menu") return { cls: "menu", txt: questions };
  if (n === 1) return { cls: "choix", txt: `${(item.formulaSteps[0].articles || []).length} choix` };
  return { cls: "choix", txt: questions };
}

function normal(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function prixTexte(p) {
  const n = Number(p);
  return Number.isFinite(n) ? `${n.toFixed(2)} €` : "Sans prix";
}

// Une couleur choisie pour une famille qui n'existe plus (produits déplacés ou
// supprimés) est oubliée : une famille recréée plus tard repart en « Auto ».
function sansCouleursOrphelines(sections) {
  return sections.map((sec) => {
    if (!sec.couleurs) return sec;
    const vivantes = new Set(famillesDe(sec));
    const gardees = Object.fromEntries(Object.entries(sec.couleurs).filter(([f]) => vivantes.has(f)));
    if (Object.keys(gardees).length === Object.keys(sec.couleurs).length) return sec;
    const { couleurs: _c, ...reste } = sec;
    return Object.keys(gardees).length ? { ...reste, couleurs: gardees } : reste;
  });
}

export default function MenuSettings({ menuData, onUpdate: publier, onClose, saveStatus }) {
  const onUpdate = (sections) => publier(sansCouleursOrphelines(sections));
  const [vue, setVue]                       = useState("carte");   // carte | reglages
  const [activeCategory, setActiveCategory] = useState(menuData[0]?.category || "");
  const [recherche, setRecherche]           = useState("");
  const [fiche, setFiche]                   = useState(null);      // { produit, estNouveau }
  const [ficheCat, setFicheCat]             = useState(null);      // { nom } ou { nom: null } pour une nouvelle
  const [saisieFamille, setSaisieFamille]   = useState(null);      // nom en cours, null = fermé
  const familleAMontrer = useRef(null);                             // famille créée, montrée une fois
  const formFamilleRef = useRef(null);

  // Réglages
  const [printUrl, setPrintUrl]       = useState(() => localStorage.getItem("punjab_print_url") || "");
  const [urlStatus, setUrlStatus]     = useState(null);
  const pwds = getDefaultPasswords();
  const [appPwd, setAppPwd]           = useState(pwds.app);
  const [settPwd, setSettPwd]         = useState(pwds.settings);
  const [pwdSaved, setPwdSaved]       = useState(false);
  const [voirMdp, setVoirMdp]         = useState(false);

  useHauteurVisible();
  const ongletsRef = useRef(null);

  const section = menuData.find((s) => s.category === activeCategory) || menuData[0];

  // Ce que la fiche produit doit savoir de chaque catégorie
  const categories = useMemo(() => menuData.map((sec) => ({
    nom: sec.category,
    phrase: phraseTicket(sec),
    section: sectionDeCategorie(sec),
    poste: posteRegle(sec),
    familles: famillesDe(sec),
    couleurs: sec.couleurs || {},
  })), [menuData]);

  // Produits groupés par famille, dans l'ordre de la caisse (sans famille à la fin)
  // couleurs choisies, par catégorie (un résultat de recherche garde la sienne)
  const couleursDe = useMemo(() => Object.fromEntries(menuData.map((s) => [s.category, s.couleurs])), [menuData]);

  // une famille créée vide apparaît aussi, avec sa tuile « Ajouter dans … »
  const groupes = useMemo(() => {
    const items = section?.items || [];
    const ordre = famillesDe(section);
    const res = ordre.map((f) => ({ famille: f, items: items.filter((i) => i.subcategory === f) }));
    const sans = items.filter((i) => !i.subcategory);
    if (sans.length || !res.length) res.push({ famille: null, items: sans });
    return res;
  }, [section]);

  const trouves = useMemo(() => {
    const q = normal(recherche.trim());
    if (!q) return null;
    return menuData.flatMap((sec) => sec.items.filter((i) => normal(i.name).includes(q)));
  }, [menuData, recherche]);

  // L'onglet choisi reste visible dans la barre (téléphone, tablette)
  const enRecherche = trouves !== null;
  // l'ordre des onglets compte aussi : une catégorie déplacée doit rester visible
  const ordreOnglets = menuData.map((s) => s.category).join("|");
  const [ongletsAuBout, ongletsAuDebut] = useAuBout(ongletsRef, [enRecherche, vue, ordreOnglets]);
  useEffect(() => {
    ongletsRef.current?.querySelector(".category-tab.active")
      ?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [activeCategory, enRecherche, vue, ordreOnglets]);

  /* ── Produits ── */
  function prochainId() {
    const ids = menuData.flatMap((sec) => sec.items.map((i) => i.id).filter((x) => typeof x === "number"));
    return Math.max(...ids, 0) + 1;
  }

  function nouveauProduit(famille) {
    const p = { id: prochainId(), name: "", price: "", category: section.category };
    if (famille) p.subcategory = famille;
    setFiche({ produit: p, estNouveau: true });
  }

  // La categorie aiguille le ticket : changer d'onglet deplace le produit
  function enregistrerFiche(p) {
    onUpdate(menuData.map((sec) => {
      const ici = sec.items.some((i) => i.id === p.id);
      if (sec.category === p.category) {
        return ici ? { ...sec, items: sec.items.map((i) => (i.id === p.id ? p : i)) }
                   : { ...sec, items: [...sec.items, p] };
      }
      return ici ? { ...sec, items: sec.items.filter((i) => i.id !== p.id) } : sec;
    }));
    if (p.category !== activeCategory) setActiveCategory(p.category);
    setFiche(null);
  }

  function supprimerProduit(p) {
    onUpdate(menuData.map((sec) => ({ ...sec, items: sec.items.filter((i) => i.id !== p.id) })));
    setFiche(null);
  }

  // On copie toujours la version ENREGISTREE : copier un brouillon en cours
  // ecrivait dans la carte un prix encore en texte, et la caisse plantait
  // (« toFixed is not a function »).
  function dupliquerProduit(p) {
    const enregistre = menuData.flatMap((sec) => sec.items).find((i) => i.id === p.id);
    if (!enregistre) return;
    const copie = JSON.parse(JSON.stringify(enregistre));
    copie.id = prochainId();
    copie.name = `${enregistre.name} (copie)`;
    onUpdate(menuData.map((sec) => {
      const k = sec.items.findIndex((i) => i.id === enregistre.id);
      if (k === -1) return sec;
      const items = [...sec.items];
      items.splice(k + 1, 0, copie);
      return { ...sec, items };
    }));
    setFiche({ produit: copie, estNouveau: false });
  }

  /* ── Familles ── */
  // Créer une famille sans passer par un produit : elle est rangée dans la
  // catégorie (champ « familles ») jusqu'à ce qu'on y ajoute des produits.
  const nomFamille = (saisieFamille || "").trim();
  const erreurFamille = !nomFamille ? null
    : famillesDe(section).some((f) => f.toLowerCase() === nomFamille.toLowerCase())
      ? `« ${nomFamille} » existe déjà dans ${section.category}.` : null;

  function creerFamille() {
    if (!nomFamille || erreurFamille) return;
    onUpdate(menuData.map((sec) => (sec.category !== section.category ? sec
      : { ...sec, familles: [...(sec.familles || []), nomFamille] })));
    familleAMontrer.current = nomFamille;
    setSaisieFamille(null);
  }

  // la famille créée (en bas de la liste) est ramenée dans la vue
  useEffect(() => {
    const f = familleAMontrer.current;
    if (!f) return;
    familleAMontrer.current = null;
    document.querySelector(`.adm-groupe[data-famille="${CSS.escape(f)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [menuData]);

  // le formulaire (et son message de doublon) est ramené dans l'écran
  const formOuvert = saisieFamille !== null;
  useEffect(() => {
    if (formOuvert) formFamilleRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [formOuvert, erreurFamille]);

  // Échap ferme le formulaire « Nouvelle famille » où que soit le curseur
  // (les fiches ouvertes gèrent Échap elles-mêmes)
  const surEchap = useEffectEvent((ev) => {
    if (ev.key !== "Escape" || ev.defaultPrevented || fiche || ficheCat) return;
    if (saisieFamille !== null) setSaisieFamille(null);
  });
  useEffect(() => {
    const t = (ev) => surEchap(ev);
    window.addEventListener("keydown", t);
    return () => window.removeEventListener("keydown", t);
  }, []);

  /* ── Catégories ── */
  // ancienNom = null : création. Renommer l'onglet renomme aussi la catégorie
  // portée par chacun de ses produits (c'est elle qui part à l'imprimante).
  function enregistrerCategorie(ancienNom, { nom, poste, place, renommages, familles, couleurs }) {
    let sections;
    if (ancienNom === null) {
      sections = [...menuData, avecSection({ category: nom, items: [] }, poste)];
    } else {
      sections = menuData.map((sec) => {
        if (sec.category !== ancienNom) return sec;
        const items = sec.items.map((i) => {
          const it = { ...i, category: nom };
          if (it.subcategory && renommages[it.subcategory]) it.subcategory = renommages[it.subcategory];
          return it;
        });
        // familles créées vides : renommées ou retirées dans la fiche catégorie
        const { familles: _avant, couleurs: _avantCouleurs, ...reste } = sec;
        const base = {
          ...reste, items,
          ...(familles && familles.length ? { familles } : {}),
          ...(couleurs && Object.keys(couleurs).length ? { couleurs } : {}),
        };
        return sec.category === "Menu" ? base : avecSection({ ...base, category: nom }, poste);
      });
    }
    const k = sections.findIndex((s) => s.category === nom);
    const [deplacee] = sections.splice(k, 1);
    sections.splice(Math.min(place, sections.length), 0, deplacee);
    onUpdate(sections);
    setActiveCategory(nom);
    setFicheCat(null);
  }

  function supprimerCategorie(nom) {
    const reste = menuData.filter((s) => s.category !== nom);
    onUpdate(reste);
    setActiveCategory(reste[0]?.category || "");
    setFicheCat(null);
  }

  /* ── Réglages ── */
  async function savePrintUrl() {
    const val = printUrl.trim();
    localStorage.setItem("punjab_print_url", val);
    // En local on ne pousse pas la configuration du restaurant
    if (import.meta.env.DEV) {
      setUrlStatus("ok"); setTimeout(() => setUrlStatus(null), 2500);
      return;
    }
    setUrlStatus("saving");
    try {
      const res = await fetch("https://punjab-restaurant.vercel.app/api/save-config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printUrl: val }),
      });
      if (!res.ok) throw new Error();
      setUrlStatus("ok"); setTimeout(() => setUrlStatus(null), 2500);
    } catch { setUrlStatus("error"); setTimeout(() => setUrlStatus(null), 4000); }
  }

  function handleSavePasswords() {
    savePasswords({ app: appPwd, settings: settPwd });
    setPwdSaved(true); setTimeout(() => setPwdSaved(false), 2000);
  }

  /* ── Bouton produit, comme dans la caisse ── */
  function boutonProduit(item, avecOnglet) {
    const c = getSubcatColor(item.subcategory, couleursDe[item.category]);
    const b = badgeFormule(item);
    return (
      <button key={item.id} className={`menu-btn adm-produit${c ? " caisse-produit--famille" : ""}`}
        onClick={() => setFiche({ produit: item, estNouveau: false })}
        style={c ? { "--famille": c.vif || c.border } : undefined}>
        {/* le bloc porte la couleur de la famille ; en haut les repères, en bas le nom et le prix */}
        <span className="adm-produit-haut">
          {avecOnglet && <span className="adm-produit-onglet">{item.category}</span>}
          <span className="adm-produit-reperes">
            {item.piment && <span className="adm-piment" role="img" aria-label="Demande le piment" title="Demande le piment"><Flame size={14} strokeWidth={2} aria-hidden="true" /></span>}
            {b && <span className={`menu-btn-tag ${b.cls}`}>{b.txt}</span>}
          </span>
        </span>
        <span className="adm-produit-bas">
          <span className="menu-btn-name">{item.name}</span>
          <span className="menu-btn-price">{prixTexte(item.price)}</span>
        </span>
      </button>
    );
  }

  const enregistrement = saveStatus === "saving" ? { cls: "en-cours", txt: "Enregistrement…" }
    : saveStatus === "ok" ? { cls: "ok", txt: "✓ Enregistré" }
    : saveStatus === "error" ? { cls: "erreur", txt: "✗ Pas enregistré" }
    : null;

  /* ═══════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════ */
  return (
    <div className="adm">
      <header className={`adm-barre${vue === "reglages" ? " adm-barre--reglages" : ""}`}>
        {vue === "carte"
          ? <button className="fp-retour" onClick={onClose}><ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />Caisse</button>
          : <button className="fp-retour" onClick={() => setVue("carte")}><ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />Ma carte</button>}
        <span className="adm-titre">
          <span className="adm-titre-texte">{vue === "carte" ? "Ma carte" : "Réglages"}</span>
          {import.meta.env.DEV && <span className="badge-essai">MODE ESSAI</span>}
        </span>
        {/* Sur ordinateur et téléphone en paysage, la recherche tient dans la
            barre ; ailleurs elle passe sur sa propre ligne (CSS) */}
        {vue === "carte" && (
          <div className="adm-recherche">
            <Search className="adm-recherche-icone" size={18} strokeWidth={1.8} aria-hidden="true" />
            <input className="adm-recherche-saisie" type="search" placeholder="Chercher un produit"
              enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
              value={recherche} onChange={(ev) => setRecherche(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") ev.currentTarget.blur(); }} />
            {recherche && (
              <button className="adm-recherche-effacer" aria-label="Effacer la recherche" onClick={() => setRecherche("")}><X size={18} strokeWidth={1.8} aria-hidden="true" /></button>
            )}
          </div>
        )}
        {vue === "carte" && (
          <button className="adm-reglages" aria-label="Réglages" onClick={() => setVue("reglages")}>
            <Settings size={20} strokeWidth={1.8} aria-hidden="true" /><span className="adm-reglages-mot">Réglages</span>
          </button>
        )}
      </header>

      {vue === "carte" && (
        <>
          {!trouves && (
            <div className="adm-onglets-ligne">
              <div ref={ongletsRef} className={`category-tabs adm-onglets${ongletsAuBout ? " au-bout" : ""}${ongletsAuDebut ? " au-debut" : ""}`}>
                {menuData.map((sec) => (
                  <button key={sec.category}
                    className={`category-tab ${section?.category === sec.category ? "active" : ""}`}
                    onClick={() => { setActiveCategory(sec.category); setSaisieFamille(null); }}>
                    {sec.category}
                  </button>
                ))}
              </div>
              {/* hors de la zone qui défile : toujours visible, même sur téléphone */}
              <button className="category-tab adm-onglet-plus" aria-label="Nouvelle catégorie" onClick={() => setFicheCat({ nom: null })}>
                +<span className="adm-onglet-plus-mot"> Catégorie</span>
              </button>
            </div>
          )}

          {/* une zone par onglet : changer d'onglet repart du haut */}
          <div className="menu-grid adm-grille" key={trouves ? "__recherche__" : section?.category}>
            {trouves ? (
              <>
                <div className="adm-groupe-titre">
                  {trouves.length === 0 ? `Rien ne s'appelle « ${recherche.trim()} »` : `${trouves.length} produit${trouves.length > 1 ? "s" : ""} trouvé${trouves.length > 1 ? "s" : ""}`}
                </div>
                <div className="menu-grid-items">{trouves.map((i) => boutonProduit(i, true))}</div>
              </>
            ) : section ? (
              <>
                <button className="adm-cat" onClick={() => setFicheCat({ nom: section.category })}>
                  <span className="adm-cat-texte">
                    <span className="adm-cat-nom">{section.category}</span>
                    <span className="adm-cat-ticket"><Receipt size={16} strokeWidth={1.8} aria-hidden="true" />{phraseTicket(section)}</span>
                  </span>
                  <span className="adm-cat-changer"><Pencil size={16} strokeWidth={1.8} aria-hidden="true" />Modifier</span>
                </button>

                {groupes.map((g) => {
                  const c = getSubcatColor(g.famille, section.couleurs);
                  return (
                    <div key={g.famille || "__sans__"} className="adm-groupe" data-famille={g.famille || ""}>
                      {g.famille && (
                        <div className="adm-groupe-titre adm-groupe-titre--famille">
                          <span className="adm-pastille" style={c ? { background: c.vif || c.border } : undefined} />
                          {g.famille}
                        </div>
                      )}
                      {!g.famille && groupes.length > 1 && <div className="adm-groupe-titre">Sans famille</div>}
                      <div className="menu-grid-items">
                        <button className="menu-btn adm-ajouter" onClick={() => nouveauProduit(g.famille)}>
                          <span className="adm-ajouter-plus"><Plus size={22} strokeWidth={1.8} aria-hidden="true" /></span>
                          <span className="adm-ajouter-texte">
                            {g.famille ? <>Ajouter dans<br />{g.famille}</> : "Ajouter un produit"}
                          </span>
                        </button>
                        {g.items.map((i) => boutonProduit(i, false))}
                      </div>
                    </div>
                  );
                })}

                {/* créer une famille directement, sans passer par un produit */}
                <div className="adm-nouvelle-famille">
                  {saisieFamille === null ? (
                    // même tuile que « + Ajouter dans … », à la même taille dans la grille
                    <div className="menu-grid-items">
                      <button className="menu-btn adm-ajouter" onClick={() => setSaisieFamille("")}>
                        <span className="adm-ajouter-plus"><Plus size={22} strokeWidth={1.8} aria-hidden="true" /></span>
                        <span className="adm-ajouter-texte">Nouvelle<br />famille</span>
                      </button>
                    </div>
                  ) : (
                    <div className="adm-famille-form" ref={formFamilleRef}>
                      <span className="fp-etiquette">Nouvelle famille dans « {section.category} »</span>
                      <div className="fp-ligne">
                        <input className="fp-saisie" autoFocus placeholder="Ex. Poulet, Agneau…" value={saisieFamille}
                          enterKeyHint="done" autoComplete="off"
                          onChange={(ev) => setSaisieFamille(ev.target.value)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") creerFamille();
                            if (ev.key === "Escape") setSaisieFamille(null);
                          }} />
                        <button className="fp-tuile on" aria-disabled={!nomFamille || !!erreurFamille} onClick={creerFamille}>Créer</button>
                        <button className="fp-tuile" onClick={() => setSaisieFamille(null)}>Annuler</button>
                      </div>
                      {erreurFamille && <span className="adm-famille-erreur">{erreurFamille}</span>}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="adm-vide">
                Aucune catégorie.
                <button className="fp-tuile on" onClick={() => setFicheCat({ nom: null })}>+ Créer une catégorie</button>
              </div>
            )}
          </div>
        </>
      )}

      {vue === "reglages" && (
        <div className="fp-corps adm-reglages-corps">
          <div className="fp-champ">
            <span className="fp-etiquette fp-etiquette--icone"><Printer size={18} strokeWidth={1.8} aria-hidden="true" />Adresse de l'imprimante</span>
            <input className="fp-saisie" type="url" inputMode="url" autoCapitalize="none"
              placeholder="Automatique" value={printUrl} onChange={(ev) => setPrintUrl(ev.target.value)} />
            <span className="fc-aide">Laisse vide pour l'adresse automatique. Ex. : http://192.168.1.62:3001</span>
            <button className="fp-tuile on adm-valider" onClick={savePrintUrl}>
              {urlStatus === "saving" ? "…" : urlStatus === "ok" ? "✓ Enregistré" : urlStatus === "error" ? "✗ Erreur" : "Enregistrer l'adresse"}
            </button>
          </div>

          <div className="fp-champ">
            <span className="fp-etiquette fp-etiquette--icone"><KeyRound size={18} strokeWidth={1.8} aria-hidden="true" />Mots de passe</span>
            <label className="fp-champ">
              <span className="fc-aide">Pour ouvrir la caisse</span>
              <input className="fp-saisie" type={voirMdp ? "text" : "password"} value={appPwd}
                onChange={(ev) => setAppPwd(ev.target.value)} />
            </label>
            <label className="fp-champ">
              <span className="fc-aide">Pour ouvrir cet écran (Ma carte)</span>
              <input className="fp-saisie" type={voirMdp ? "text" : "password"} value={settPwd}
                onChange={(ev) => setSettPwd(ev.target.value)} />
            </label>
            <div className="fp-ouinon">
              <button className="fp-tuile" onClick={() => setVoirMdp((v) => !v)}>{voirMdp ? <><EyeOff size={18} strokeWidth={1.8} aria-hidden="true" />Cacher</> : <><Eye size={18} strokeWidth={1.8} aria-hidden="true" />Voir</>}</button>
              <button className="fp-tuile on adm-valider" onClick={handleSavePasswords}>
                {pwdSaved ? "✓ Enregistré" : "Enregistrer les mots de passe"}
              </button>
            </div>
          </div>

          <button className="fp-action fp-action--rouge" onClick={() => { lockApp(); window.location.reload(); }}>
            <Lock size={18} strokeWidth={1.8} aria-hidden="true" />Verrouiller la caisse
          </button>
        </div>
      )}

      {/* Fiche produit plein ecran : creation et modification */}
      {fiche && (
        <FicheProduit
          key={`${fiche.produit.id}-${fiche.estNouveau}`}
          produit={fiche.produit}
          estNouveau={fiche.estNouveau}
          categories={categories}
          onEnregistrer={enregistrerFiche}
          onSupprimer={supprimerProduit}
          onDupliquer={dupliquerProduit}
          onFermer={() => setFiche(null)} />
      )}

      {/* L'état d'enregistrement flotte en bas : la barre ne saute plus */}
      {enregistrement && (
        <div role="status" className={`adm-etat adm-etat--${enregistrement.cls}`}>{enregistrement.txt}</div>
      )}

      {ficheCat && (
        <FicheCategorie
          key={ficheCat.nom ?? "__nouvelle__"}
          section={ficheCat.nom === null ? null : menuData.find((s) => s.category === ficheCat.nom)}
          sections={menuData}
          onEnregistrer={enregistrerCategorie}
          onSupprimer={supprimerCategorie}
          onFermer={() => setFicheCat(null)} />
      )}
    </div>
  );
}
