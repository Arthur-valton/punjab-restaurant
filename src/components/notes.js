// Note (« sans oignon ») et allergie (« arachide ») sur un article du panier.
//
// ⚠ Contrat avec server/print-server.js, kds.html et service.html :
//   - ligne simple : champs « note » et « allergie » (texte), ABSENTS quand
//     vides ; plusieurs notes ou allergènes sont réunis par ", " ;
//   - menu : la note va sur le choix concerné (formulaChoices[k].note) et
//     l'allergie est recopiée sur CHAQUE choix (formulaChoices[k].allergie) ;
//     jamais de note ni d'allergie sur la ligne du menu elle-même ;
//   - une ligne notée a son propre cartId (empreinte de la note) : elle ne se
//     regroupe jamais avec la même sans note.
import { posteArticle, posteDuChoix, estMenuEclate, ticketDuPoste } from "./postes";

// Notes en un toucher, par ticket (un article à emporter garde la liste de son poste)
export const NOTES_RAPIDES = {
  CUISINE: ["Sans oignon", "Sans coriandre", "Sans ail", "Sans crème", "Sauce à part",
            "Bien cuit", "Peu salé", "Sans beurre", "À partager"],
  DESSERTS: ["Bougie", "2 cuillères", "Sans chantilly", "Sans sauce"],
  BAR: ["Sans glaçon", "Avec citron", "Sans sucre", "Lait à part"],
};
// Les plus fréquents d'abord, les 8 autres allergènes officiels derrière « Autres… »
export const ALLERGENES_PRINCIPAUX = ["Arachide", "Fruits à coque", "Lait", "Gluten", "Crustacés", "Moutarde"];
export const ALLERGENES_AUTRES = ["Œuf", "Poisson", "Mollusques", "Sésame", "Soja", "Céleri", "Sulfites", "Lupin"];
export const ALLERGENES = [...ALLERGENES_PRINCIPAUX, ...ALLERGENES_AUTRES];
export const NOTE_MAX = 60;
const SEP = ", ";

// Comparaison sans casse, sans accents, espaces réduits
export function normaliser(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}
// Texte tapé à la main : sans emoji (l'imprimante ne sait pas les sortir),
// espaces réduits, 60 caractères au plus
export function nettoyerTexte(t) {
  return String(t || "")
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|\u200D|\uFE0E|\uFE0F|\u20E3/gu, "")
    .replace(/\s+/g, " ").trim().slice(0, NOTE_MAX).trim();
}
function segments(t) {
  return String(t || "").split(",").map((x) => x.trim()).filter(Boolean);
}

// Note d'une ligne : les notes rapides (déjà dans l'ordre de la liste), puis
// le texte libre nettoyé
export function composerNote(rapides, libre) {
  return [...(rapides || []), nettoyerTexte(libre)].filter(Boolean).join(SEP);
}
// Inverse, pour rouvrir la fenêtre : ce qui est dans la liste du poste
// redevient une pastille, le reste retourne dans le champ libre
export function decomposerNote(note, liste) {
  const rapides = [];
  const reste = [];
  for (const s of segments(note)) {
    const n = (liste || []).find((x) => normaliser(x) === normaliser(s));
    if (n) { if (!rapides.includes(n)) rapides.push(n); }
    else reste.push(s);
  }
  return { rapides: (liste || []).filter((x) => rapides.includes(x)), libre: reste.join(SEP) };
}
// Allergie : les allergènes dans l'ordre de ALLERGENES, puis un éventuel libre
export function composerAllergie(choisis, autres) {
  return [...ALLERGENES.filter((a) => (choisis || []).includes(a)), ...(autres || [])].join(SEP);
}
export function decomposerAllergie(allergie) {
  const choisis = [];
  const autres = [];
  for (const s of segments(allergie)) {
    const a = ALLERGENES.find((x) => normaliser(x) === normaliser(s));
    if (a) { if (!choisis.includes(a)) choisis.push(a); }
    else if (!autres.some((x) => normaliser(x) === normaliser(s))) autres.push(s);
  }
  return { choisis, autres };
}

// Empreinte d'une note : djb2 en base 36, sur le texte normalisé (une
// majuscule ou un accent de plus ne crée pas une deuxième ligne)
export function empreinte(note, allergie) {
  const s = `${normaliser(note)}|${normaliser(allergie)}`;
  let h = 5381;
  for (let k = 0; k < s.length; k++) h = (h * 33 + s.charCodeAt(k)) >>> 0;
  return h.toString(36);
}

export function aUneNote(x) {
  return Boolean(x && (x.note || x.allergie));
}
export function estLigneMenu(ligne) {
  return Boolean(ligne && ligne.formulaChoices && ligne.formulaChoices.length);
}
export function ligneANote(ligne) {
  return aUneNote(ligne) || (ligne?.formulaChoices || []).some(aUneNote);
}
// Copie sans note ni allergie (un produit de la carte ne les transmet jamais)
export function sansNote(x) {
  if (!x) return x;
  const { note: _NOTE, allergie: _ALLERGIE, ...reste } = x;
  return reste;
}
// Ligne envoyée pour l'addition du client : ni note ni allergie, choix compris
export function sansNotes(ligne) {
  const net = sansNote(ligne);
  return Array.isArray(net.formulaChoices) ? { ...net, formulaChoices: net.formulaChoices.map(sansNote) } : net;
}
// Allergie d'un menu : la réunion de celles de ses choix (deux couverts
// recombinés peuvent en porter des différentes), dans l'ordre de la liste
export function allergieDuMenu(choices) {
  const toutes = (choices || []).map((c) => c.allergie).filter(Boolean).join(SEP);
  if (!toutes) return "";
  const { choisis, autres } = decomposerAllergie(toutes);
  return composerAllergie(choisis, autres);
}
// Un menu porte la même allergie sur chacun de ses choix, y compris ceux
// ajoutés après coup (menu en pause complété, commande groupée) : sans cela
// le dessert choisi plus tard partait sans l'allergie sur le ticket DESSERTS
export function avecAllergieDuMenu(choices) {
  const a = allergieDuMenu(choices);
  return a ? (choices || []).map((c) => (c.allergie === a ? c : { ...c, allergie: a })) : choices;
}
// L'allergie d'une ligne : la sienne, ou celle du menu (réunion de ses choix)
export function allergieDeLigne(ligne) {
  return ligne?.allergie || allergieDuMenu(ligne?.formulaChoices);
}
// Allergènes cochés dans « Ma carte » pour ce que contient la ligne : le
// produit lui-même, et pour un menu chaque plat choisi (retrouvé par son nom).
// La fenêtre Note ne propose que ceux-là : rien n'est affiché si aucun n'est coché.
export function allergenesDeclares(ligne, carte) {
  const produits = (carte || []).flatMap((s) => s.items || []);
  const parNom = (n) => (n ? produits.find((p) => normaliser(p.name) === normaliser(n)) : null);
  const trouves = new Set();
  const ajouter = (p) => (p?.allergenes || []).forEach((x) => trouves.add(x));
  ajouter(produits.find((p) => p.id === ligne?.id) || parNom(ligne?.name));
  for (const c of ligne?.formulaChoices || []) ajouter(parNom(c.itemName));
  return ALLERGENES.filter((x) => trouves.has(x));
}
export function texteAllergie(allergie) {
  return `Allergie ${String(allergie || "").toLowerCase()}`;
}

// Choix d'un menu qui peuvent porter une note : ceux qui sortent sur leur
// propre ligne. Un choix remplacé par son détail (« Jus » → « Jus orange »)
// et une précision rattachée (boules d'une coupe) n'en portent pas.
export function choixCibles(ligne) {
  const ch = ligne?.formulaChoices || [];
  const remplaces = new Set(ch.map((c) => c.remplaceParent).filter(Boolean));
  return ch.map((c, k) => k).filter((k) => !remplaces.has(ch[k].label) && !ch[k].sousChoixDe);
}
// Ticket qui recevra la note : celui du choix dans un menu éclaté poste par
// poste (la note du dessert part sur DESSERTS), sinon celui de l'article.
// La ligne doit porter son « poste » (posterArticles).
export function ticketDeLaNote(ligne, choix) {
  if (choix && estMenuEclate(ligne)) return ticketDuPoste(posteDuChoix(choix, ligne.formulaChoices));
  return ticketDuPoste(posteArticle(ligne));
}

// Signature des choix d'un menu (cartId « id-f… ») : celle d'avant les notes,
// plus l'empreinte des choix notés. Sans note, rien ne change.
export function signatureChoix(choices) {
  return (choices || []).map((c) => `${c.label}:${c.itemName}${c.piment || ""}`
    + (aUneNote(c) ? `~n${empreinte(c.note, c.allergie)}` : "")).join("|");
}
function empreinteChoix(choices) {
  return empreinte((choices || []).map((c) => c.note || "").join(";"),
                   (choices || []).map((c) => c.allergie || "").join(";"));
}

// Nouvelle version d'une ligne après la fenêtre « Note ».
// notes : { ligne: "…" } pour un article, { [indice du choix]: "…" } pour un
// menu ; allergie : texte, vide pour la retirer.
export function ligneNotee(ligne, { notes = {}, allergie = "" }) {
  if (estLigneMenu(ligne)) {
    const choices = ligne.formulaChoices.map((c, k) => ({
      ...sansNote(c), ...(notes[k] ? { note: notes[k] } : {}), ...(allergie ? { allergie } : {}),
    }));
    const net = { ...sansNote(ligne), formulaChoices: choices };
    // Menu complet : même fabrique que addFormula. En pause (ou autre clé),
    // la clé est gardée et seule l'empreinte change.
    if (String(ligne.cartId).startsWith(`${ligne.id}-f`)) return { ...net, cartId: `${ligne.id}-f${signatureChoix(choices)}` };
    const avant = ligne.formulaChoices.some(aUneNote) ? `-n${empreinteChoix(ligne.formulaChoices)}` : "";
    const base = avant && ligne.cartId.endsWith(avant) ? ligne.cartId.slice(0, -avant.length) : ligne.cartId;
    return { ...net, cartId: choices.some(aUneNote) ? `${base}-n${empreinteChoix(choices)}` : base };
  }
  const note = notes.ligne || "";
  const net = { ...sansNote(ligne), ...(note ? { note } : {}), ...(allergie ? { allergie } : {}) };
  // cartId de base (« 12 », « 12-p3 », « libre-… ») + « -n » + empreinte
  const avant = aUneNote(ligne) ? `-n${empreinte(ligne.note, ligne.allergie)}` : "";
  const base = avant && ligne.cartId.endsWith(avant) ? ligne.cartId.slice(0, -avant.length) : ligne.cartId;
  return { ...net, cartId: aUneNote(net) ? `${base}-n${empreinte(note, allergie)}` : base };
}

// Ce qui distingue une ligne d'une autre dans l'addition (petit, en gris)
export function resumeNote(ligne) {
  const notes = estLigneMenu(ligne)
    ? ligne.formulaChoices.filter((c) => c.note).map((c) => `${c.itemName} : ${c.note}`)
    : [ligne?.note].filter(Boolean);
  const a = allergieDeLigne(ligne);
  return [...notes, ...(a ? [texteAllergie(a).toLowerCase()] : [])].join(" · ");
}
