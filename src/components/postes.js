// Aiguillage des étapes de menu vers les postes de production.
//
// ⚠ COPIE de FORMULA_LABEL_MAP_SHARED et mapFormulaLabelShared dans
// server/print-server.js. Les deux doivent rester identiques : c'est le
// serveur d'impression qui décide réellement du ticket, l'admin ne fait que
// prévenir avant d'enregistrer un libellé que l'imprimante ne saurait pas
// router. Un libellé inconnu dans un menu fait sortir TOUT le menu de travers
// (isMenuFormula exige que chaque étape soit reconnue).
const TABLE = {
  "entree": "Entrees", "entrees": "Entrees",
  "plat": "Plats", "plats": "Plats",
  "dessert": "Desserts", "desserts": "Desserts",
  "naan": "Naans", "naans": "Naans",
  "boisson": "Boissons", "boissons": "Boissons",
  "aperitif": "Boissons", "aperitifs": "Boissons",
  "pichet": "Boissons", "pichet a vin": "Boissons",
  "boule": "Desserts", "boules": "Desserts",
  "jus": "Boissons", "kir": "Boissons",
  "parfum kir": "Boissons",
  "parfum kulfi": "Desserts",
};

// Ticket sur lequel part chaque poste
const TICKET = {
  Entrees: "Cuisine", Plats: "Cuisine", Naans: "Cuisine",
  Desserts: "Desserts", Boissons: "Bar",
};

export function cleEtape(label) {
  let k = String(label || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  let avant;
  do {
    avant = k;
    k = k.replace(/\s*(pers\.?|personne)?\s*\d+\s*$/, "").trim();
  } while (k !== avant);
  return k;
}

// Poste brut (Plats, Boissons...) ou null : sert a reproduire isMenuFormula
export function posteDeEtape(label) { return TABLE[cleEtape(label)] || null; }
// ⚠ COPIE de CAT_MERGE_SHARED du serveur
const FUSION = { "Biryani": "Plats", "Entrées": "Entrees", "Entrees": "Entrees" };
export function posteDeCategorie(cat) { return FUSION[cat] || cat; }

// Section du ticket d'une catégorie, réglée dans l'admin (champ « poste » de
// la catégorie, recopié sur chaque article à l'envoi). ⚠ Les valeurs sont
// celles de POSTES_ADMIN dans server/print-server.js.
export const SECTIONS_TICKET = [
  { poste: "Naans",    nom: "Naans",    ticket: "cuisine",  emoji: "🫓" },
  { poste: "Entrees",  nom: "Entrées",  ticket: "cuisine",  emoji: "🥗" },
  { poste: "Plats",    nom: "Plats",    ticket: "cuisine",  emoji: "🍛" },
  { poste: "Desserts", nom: "Desserts", ticket: "desserts", emoji: "🍨" },
  { poste: "Boissons", nom: "Boissons", ticket: "bar",      emoji: "🥤" },
];
const POSTES_VALIDES = new Set(SECTIONS_TICKET.map((x) => x.poste));
// ⚠ COPIE de BAR_CATEGORIES du serveur
const BAR = new Set(["Boissons", "Vins", "Vin", "Rosé", "Rose", "Apéritifs", "Aperitifs", "Bières", "Bieres", "Bar"]);

// Ce que fait l'imprimante quand rien n'est réglé ; null = la catégorie sort
// en cuisine sous son propre titre (c'est le cas d'une catégorie nouvelle).
export function sectionParDefaut(cat) {
  if (BAR.has(cat)) return "Boissons";
  const m = FUSION[cat] || cat;
  return POSTES_VALIDES.has(m) && m !== "Boissons" ? m : null;
}
// Seulement ce qui a été réglé : c'est ce que l'imprimante reçoit (posteAdmin)
export function posteRegle(section) {
  return section && POSTES_VALIDES.has(section.poste) ? section.poste : null;
}
export function sectionDeCategorie(section) {
  if (!section) return null;
  return POSTES_VALIDES.has(section.poste) ? section.poste : sectionParDefaut(section.category);
}
// Le champ n'est écrit que s'il change quelque chose : une catégorie déjà
// bien routée garde exactement son ticket (les Vins gardent leur titre VINS).
export function avecSection(section, poste) {
  const { poste: _ancien, ...reste } = section;
  return poste && poste !== sectionParDefaut(section.category) ? { ...reste, poste } : reste;
}
// Recopie la section de la catégorie sur chaque article envoyé à l'imprimante
export function posterArticles(items, menuData) {
  const postes = {};
  for (const sec of menuData || []) if (POSTES_VALIDES.has(sec.poste)) postes[sec.category] = sec.poste;
  return items.map((i) => {
    const { poste: _ancien, ...reste } = i;
    return postes[i.category] ? { ...reste, poste: postes[i.category] } : reste;
  });
}

// Poste d'un article, comme le serveur d'impression : réglage de la catégorie
// (champ « poste »), sinon la catégorie elle-même
export function posteArticle(item) {
  return POSTES_VALIDES.has(item.poste) ? item.poste : sectionParDefaut(item.category);
}
// Poste d'un choix de menu, comme le serveur (posteDuChoix) : une précision
// part avec la question qui l'a déclenchée
export function posteDuChoix(c, choices) {
  let x = c;
  for (let g = 0; g < 10 && (x.remplaceParent || x.sousChoixDe); g++) {
    const lb = x.remplaceParent || x.sousChoixDe;
    const p = (choices || []).find((y) => y.label === lb);
    if (!p) return posteDeEtape(lb);
    x = p;
  }
  return posteDeEtape(x.label);
}
// Un vrai menu (entrée, plat, dessert…) part poste par poste : même test que
// isMenuFormula côté serveur
export function estMenuEclate(item) {
  const ch = item.formulaChoices || [];
  if (!ch.length) return false;
  const propre = POSTES_VALIDES.has(item.poste) ? item.poste : posteDeCategorie(item.category);
  const postes = ch.map((c) => posteDuChoix(c, ch));
  return postes.every(Boolean) && postes.some((p) => p !== propre);
}
// Ticket de production d'un poste (une catégorie inconnue sort en cuisine)
export function ticketDuPoste(p) {
  return p === "Boissons" ? "BAR" : p === "Desserts" ? "DESSERTS" : "CUISINE";
}

// null quand l'imprimante ne sait pas router ce libellé
export function ticketDeEtape(label) {
  const poste = TABLE[cleEtape(label)];
  return poste ? TICKET[poste] : null;
}

// Libellés proposés pour une étape de menu, tous routables
export const LIBELLES_MENU = [
  "Apéritif", "Kir", "Parfum kir", "Jus", "Boisson", "Pichet à vin",
  "Naan", "Entrée", "Plat", "Dessert", "Parfum kulfi", "Boule 1", "Boule 2",
];

// En mots simples : où sortent les produits d'une catégorie
const NOM_TICKET = { cuisine: "CUISINE", desserts: "DESSERTS", bar: "BAR" };
export function phraseTicket(section) {
  if (!section) return "";
  if (section.category === "Menu") return "Chaque question du menu sort sur son ticket (bar, cuisine, desserts).";
  const s = SECTIONS_TICKET.find((x) => x.poste === sectionDeCategorie(section));
  if (!s) return `Ticket CUISINE, sous le titre « ${String(section.category).toUpperCase()} ».`;
  if (s.ticket === "cuisine") return `Ticket CUISINE, avec les ${s.nom}.`;
  return `Ticket ${NOM_TICKET[s.ticket]}.`;
}

// Familles d'une catégorie : celles portées par ses produits, puis celles
// créées depuis « + Nouvelle famille » qui n'ont pas encore de produit
// (champ « familles » de la catégorie, ignoré par la caisse et l'imprimante).
export function famillesDe(section) {
  if (!section) return [];
  return [...new Set([
    ...(section.items || []).map((i) => i.subcategory).filter(Boolean),
    ...(section.familles || []),
  ])];
}
