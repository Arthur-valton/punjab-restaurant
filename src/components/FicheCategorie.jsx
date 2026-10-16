import { useState, useMemo, useRef, useEffect, useEffectEvent } from "react";
import { SECTIONS_TICKET, sectionDeCategorie, phraseTicket } from "./postes";
import { getSubcatColor, PALETTE } from "./couleurs";
import useAuBout from "./useAuBout";
import { ArrowLeft, ArrowRight, Receipt } from "lucide-react";
import { ICONE_SECTION } from "./icones";

// ─────────────────────────────────────────────────────────────────────────
// Fiche d'une catégorie (onglet de la caisse) : son nom, la partie du ticket
// où sortent ses produits, ses familles et sa place dans la barre.
// section = null pour en créer une nouvelle.
// ─────────────────────────────────────────────────────────────────────────

export default function FicheCategorie({ section, sections, onEnregistrer, onSupprimer, onFermer }) {
  const nouvelle = !section;
  const estMenu = section?.category === "Menu";
  const autres = sections.filter((s) => s !== section);
  const placeDepart = nouvelle ? sections.length : sections.indexOf(section);

  const [nom, setNom] = useState(section?.category || "");
  const [poste, setPoste] = useState(nouvelle ? null : sectionDeCategorie(section));
  const [place, setPlace] = useState(placeDepart);
  const [renommages, setRenommages] = useState({});   // { ancienne famille: nouveau nom }
  const [enCours, setEnCours] = useState(null);        // famille en train d'être renommée
  const [saisie, setSaisie] = useState("");
  const [confirmeSuppr, setConfirmeSuppr] = useState(false);
  const [retirees, setRetirees] = useState(() => new Set());   // familles vides à retirer
  // couleur choisie par famille (clé de PALETTE), indexée par le nom d'origine
  const [couleurs, setCouleurs] = useState(() => ({ ...(section?.couleurs || {}) }));
  const [palette, setPalette] = useState(null);                 // famille dont la palette est ouverte
  // L'alerte n'apparaît qu'après un essai d'enregistrement (Enregistrer reste
  // grisé tant qu'il manque quelque chose) : rien ne bouge sous le doigt avant.
  const [essaye, setEssaye] = useState(false);
  const corpsRef = useRef(null);
  const barreRef = useRef(null);
  const paletteRef = useRef(null);
  useEffect(() => {
    if (palette !== null) paletteRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [palette]);

  // familles des produits, puis familles créées vides (0 produit)
  const familles = useMemo(() => {
    const compte = new Map();
    for (const i of section?.items || []) {
      if (i.subcategory) compte.set(i.subcategory, (compte.get(i.subcategory) || 0) + 1);
    }
    for (const f of section?.familles || []) if (!compte.has(f)) compte.set(f, 0);
    return [...compte.entries()];
  }, [section]);
  // celles qui resteront après enregistrement (une famille retirée se remet d'un appui)
  const actives = familles.filter(([f]) => !retirees.has(f));

  const nomPropre = nom.trim();
  const problemes = [];
  if (!nomPropre) problemes.push("Donne un nom à la catégorie.");
  else if (autres.some((s) => s.category.toLowerCase() === nomPropre.toLowerCase())) {
    problemes.push(`Il existe déjà une catégorie « ${nomPropre} ».`);
  } else if (!estMenu && nomPropre.toLowerCase() === "menu") {
    problemes.push("« Menu » est réservé aux menus.");
  }
  if (!estMenu && !poste) problemes.push("Choisis où ses produits sortent sur le ticket.");
  const nomsFamilles = actives.map(([f]) => (renommages[f] ?? f).trim());
  if (nomsFamilles.some((f) => !f)) problemes.push("Une famille n'a plus de nom.");
  // deux familles du même nom (majuscules comprises) fusionneraient leurs produits
  const enDouble = nomsFamilles.find((f, k) => f && nomsFamilles.findIndex((g) => g.toLowerCase() === f.toLowerCase()) !== k);
  if (enDouble) problemes.push(`Deux familles s'appelleraient « ${enDouble} ». Donne-leur des noms différents.`);
  // tout est réglé : l'alerte ne reviendra qu'au prochain appui sur Créer / Enregistrer
  if (essaye && problemes.length === 0) setEssaye(false);

  const modifie = nouvelle
    || nomPropre !== section.category
    || poste !== sectionDeCategorie(section)
    || place !== placeDepart
    || actives.some(([f]) => (renommages[f] ?? f).trim() !== f)
    || retirees.size > 0
    || actives.some(([f]) => (couleurs[f] || null) !== ((section?.couleurs || {})[f] || null));

  // Ordre de la barre tel qu'il sera après enregistrement
  const ici = Math.min(place, autres.length);
  const barre = autres.map((s) => s.category);
  barre.splice(ici, 0, nomPropre || "Nouvelle");

  // La place choisie reste au milieu de l'aperçu. Seule la barre défile, à
  // l'horizontale : un scrollIntoView ouvrait la fiche déjà défilée (Nom caché).
  useEffect(() => {
    const b = barreRef.current;
    const on = b?.querySelector(".fc-onglet.on");
    if (!b || !on) return;
    const d = on.getBoundingClientRect().left - b.getBoundingClientRect().left;
    b.scrollLeft += d - (b.clientWidth - on.offsetWidth) / 2;
  }, [ici, nomPropre]);
  const [barreAuBout, barreAuDebut] = useAuBout(barreRef, [ici, nomPropre]);

  function fermer() {
    // une catégorie neuve déjà commencée (nom tapé ou ticket choisi) demande aussi
    const commence = nouvelle ? !!(nomPropre || poste) : modifie;
    if (commence && !window.confirm("Quitter sans enregistrer tes changements ?")) return;
    onFermer();
  }

  function enregistrer() {
    if (problemes.length) {
      setEssaye(true);
      corpsRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // rien n'a changé : on ferme sans réécrire la carte
    if (!nouvelle && !modifie) { onFermer(); return; }
    const familleFinale = {};
    actives.forEach(([f]) => {
      const n = (renommages[f] ?? f).trim();
      if (n !== f) familleFinale[f] = n;
    });
    // familles créées vides : on garde leur nom (éventuellement renommé), sauf celles retirées
    const declarees = (section?.familles || [])
      .filter((f) => !retirees.has(f))
      .map((f) => (renommages[f] ?? f).trim())
      .filter(Boolean);
    // couleurs choisies, sous le nom final de chaque famille encore là
    const couleursFinales = {};
    actives.forEach(([f]) => {
      if (couleurs[f]) couleursFinales[(renommages[f] ?? f).trim()] = couleurs[f];
    });
    onEnregistrer(section?.category ?? null, {
      nom: nomPropre, poste, place: ici, renommages: familleFinale, familles: [...new Set(declarees)],
      couleurs: couleursFinales,
    });
  }

  // Échap (sur ordinateur) : quitte d'abord le champ, puis un renommage ou
  // une confirmation encore ouverts, puis ferme la fiche (avec confirmation)
  const surEchap = useEffectEvent((ev) => {
    if (ev.key !== "Escape" || ev.defaultPrevented) return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { el.blur(); return; }
    if (enCours !== null) { setEnCours(null); return; }
    if (palette !== null) { setPalette(null); return; }
    if (confirmeSuppr) { setConfirmeSuppr(false); return; }
    fermer();
  });
  useEffect(() => {
    const touche = (ev) => surEchap(ev);
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, []);

  function validerRenommage(f) {
    setRenommages((r) => ({ ...r, [f]: saisie }));
    setEnCours(null);
  }

  const choisi = SECTIONS_TICKET.find((x) => x.poste === poste);
  const apercu = estMenu ? null : phraseTicket({ category: nomPropre || "?", poste });

  return (
    <div className="fp">
      <div className="fp-barre">
        <button className="fp-retour" onClick={fermer}><ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />Retour</button>
        <span className="fp-titre">{nouvelle ? "Nouvelle catégorie" : section.category}</span>
        <button className="fp-enregistrer" onClick={enregistrer} aria-disabled={problemes.length > 0}>
          {nouvelle ? "Créer" : "Enregistrer"}
        </button>
      </div>

      <div className="fp-corps" ref={corpsRef}>
        {essaye && problemes.length > 0 && (
          <div className="fp-alerte">
            <div className="fp-alerte-titre">Avant d'enregistrer :</div>
            {problemes.map((pb, k) => <div key={k} className="fp-alerte-ligne">• {pb}</div>)}
          </div>
        )}

        <label className="fp-champ">
          <span className="fp-etiquette">Nom de l'onglet</span>
          {estMenu
            ? <span className="fc-fixe">Menu <em>(ce nom ne change pas : la caisse s'en sert pour les menus)</em></span>
            : <input className="fp-saisie" value={nom} placeholder="Ex. Crapaud" autoFocus={nouvelle}
                onChange={(ev) => setNom(ev.target.value)} />}
        </label>

        {!estMenu && (
          <div className="fp-champ">
            <span className="fp-etiquette">Sur le ticket, ses produits sortent avec…</span>
            <div className="fc-sections">
              {SECTIONS_TICKET.map((s) => (
                <button key={s.poste} className={`fc-section ${poste === s.poste ? "on" : ""}`}
                  onClick={() => setPoste(s.poste)}>
                  <span className="fc-section-emoji">{(() => { const Ic = ICONE_SECTION[s.poste]; return Ic ? <Ic size={24} strokeWidth={1.6} aria-hidden="true" /> : s.emoji; })()}</span>
                  <span className="fc-section-nom">les {s.nom}</span>
                  <span className="fc-section-ticket">ticket {s.ticket}</span>
                </button>
              ))}
            </div>
            {choisi && (
              <div className="fc-exemple">
                <Receipt size={16} strokeWidth={1.8} aria-hidden="true" /> Exemple : « 1x {(section?.items?.[0]?.name) || nomPropre || "Produit"} » → {apercu}
              </div>
            )}
          </div>
        )}
        {estMenu && <div className="fc-exemple"><Receipt size={16} strokeWidth={1.8} aria-hidden="true" /> {phraseTicket(section)}</div>}

        <div className="fp-champ">
          <span className="fp-etiquette">Place dans la barre de la caisse</span>
          {/* toucher un onglet de l'aperçu y place la catégorie */}
          <div className={`fc-barre${barreAuBout ? " au-bout" : ""}${barreAuDebut ? " au-debut" : ""}`} ref={barreRef}>
            {barre.map((c, k) => (
              <button type="button" key={k} className={`fc-onglet ${k === ici ? "on" : ""}`} onClick={() => setPlace(k)}>{c}</button>
            ))}
          </div>
          <div className="fp-ouinon fc-place">
            <button className="fp-tuile" disabled={ici === 0} onClick={() => setPlace(ici - 1)}><ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />À gauche</button>
            <button className="fp-tuile" disabled={ici === barre.length - 1} onClick={() => setPlace(ici + 1)}>À droite<ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" /></button>
          </div>
        </div>

        {!nouvelle && (
          <div className="fp-champ">
            <span className="fp-etiquette">Familles (couleurs des boutons)</span>
            {familles.length === 0 && (
              <div className="fc-aide">Aucune famille. Tu en crées une avec « + Nouvelle famille » en bas de la liste, ou depuis la fiche d'un produit.</div>
            )}
            {familles.length > 0 && (
              <div className="fc-aide">La couleur est choisie toute seule. Touche la pastille ronde pour en mettre une autre.</div>
            )}
            <div className="fc-familles">
              {familles.map(([f, n]) => {
                const nomFinal = renommages[f] ?? f;
                const c = getSubcatColor(nomFinal, couleurs[f] ? { [nomFinal]: couleurs[f] } : null);
                const auto = getSubcatColor(nomFinal);
                const retiree = retirees.has(f);
                if (retiree) {
                  return (
                    <div key={f} className="fc-famille-bloc fc-famille-bloc--retiree">
                      <div className="fc-famille">
                        <span className="fc-famille-texte">
                          <span className="fc-famille-nom">{nomFinal}</span>
                          <span className="fc-famille-compte">sera retirée</span>
                        </span>
                        <button className="fp-tuile"
                          onClick={() => setRetirees((r) => { const n2 = new Set(r); n2.delete(f); return n2; })}>Remettre</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={f} className="fc-famille-bloc">
                  <div className="fc-famille">
                    {enCours === f ? (
                      <>
                        <input className="fp-saisie" value={saisie} autoFocus enterKeyHint="done"
                          onChange={(ev) => setSaisie(ev.target.value)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") validerRenommage(f);
                            // Échap annule le renommage sans fermer la fiche
                            if (ev.key === "Escape") { ev.preventDefault(); setEnCours(null); }
                          }} />
                        <button className="fp-tuile on" onClick={() => validerRenommage(f)}>OK</button>
                        <button className="fp-tuile" onClick={() => setEnCours(null)}>Annuler</button>
                      </>
                    ) : (
                      <>
                        <button className={`fc-couleur ${palette === f ? "on" : ""}`} aria-label={`Couleur de ${nomFinal}`}
                          aria-expanded={palette === f}
                          style={{ background: c?.vif || c?.border }} onClick={() => setPalette(palette === f ? null : f)} />
                        <span className="fc-famille-texte">
                          <span className="fc-famille-nom">
                            {renommages[f] ?? f}
                          </span>
                          <span className="fc-famille-compte">{n === 0 ? "vide" : `${n} produit${n > 1 ? "s" : ""}`}</span>
                        </span>
                        <button className="fp-tuile" onClick={() => { setPalette(null); setSaisie(renommages[f] ?? f); setEnCours(f); }}>Renommer</button>
                        {/* une famille sans produit peut être retirée */}
                        {n === 0 && (
                          <button className="fp-tuile fc-famille-retirer"
                            onClick={() => { setPalette(null); setRetirees((r) => new Set([...r, f])); }}>Retirer</button>
                        )}
                      </>
                    )}
                  </div>
                  {palette === f && enCours !== f && (
                    <div className="fc-palette" ref={paletteRef} role="group" aria-label={`Couleurs pour ${nomFinal}`}>
                      <button className={`fc-pastille-auto ${!couleurs[f] ? "on" : ""}`}
                        onClick={() => { setCouleurs((x) => { const s = { ...x }; delete s[f]; return s; }); setPalette(null); }}>
                        <span className="fc-pastille-mini" style={{ background: auto?.vif || auto?.border }} />Auto
                      </button>
                      {PALETTE.map((p) => (
                        <button key={p.cle} className={`fc-pastille ${couleurs[f] === p.cle ? "on" : ""}`}
                          aria-label={p.nom} title={p.nom} style={{ background: p.couleur.vif }}
                          onClick={() => { setCouleurs((x) => ({ ...x, [f]: p.cle })); setPalette(null); }}>
                          {couleurs[f] === p.cle ? "✓" : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!nouvelle && (
          (section.items || []).length > 0 ? (
            <div className="fc-aide">
              Pour supprimer cette catégorie, déplace ou supprime d'abord ses {section.items.length} produits.
            </div>
          ) : confirmeSuppr ? (
            <div className="fp-confirme">
              <span>Supprimer l'onglet « {section.category} » ?</span>
              <button className="fp-action fp-action--rouge" onClick={() => onSupprimer(section.category)}>Oui, supprimer</button>
              <button className="fp-action" onClick={() => setConfirmeSuppr(false)}>Non</button>
            </div>
          ) : (
            <button className="fp-action fp-action--rouge" onClick={() => setConfirmeSuppr(true)}>Supprimer cette catégorie</button>
          )
        )}
      </div>
    </div>
  );
}
