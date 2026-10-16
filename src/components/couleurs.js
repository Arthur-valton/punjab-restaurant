// Couleurs des familles (sous-catégories), partagées par la caisse et l'admin

// Pastel Apple colors par sous-catégorie (couleurs manuelles prioritaires)
export const SUBCAT_COLORS = {
  "Grillades":       { bg: "rgba(255,149,0,0.12)",   active: "rgba(255,149,0,0.22)",   text: "#b36200", border: "rgba(255,149,0,0.4)"   },
  "Salade / Soupe":  { bg: "rgba(52,199,89,0.10)",   active: "rgba(52,199,89,0.22)",   text: "#1e7a3a", border: "rgba(52,199,89,0.4)"    },
  "Salade":          { bg: "rgba(52,199,89,0.10)",   active: "rgba(52,199,89,0.22)",   text: "#1e7a3a", border: "rgba(52,199,89,0.4)"    },
  "Soupe":           { bg: "rgba(10,132,255,0.10)",  active: "rgba(10,132,255,0.22)",  text: "#005bcc", border: "rgba(10,132,255,0.4)"   },
  "Beignets":        { bg: "rgba(255,214,10,0.12)",   active: "rgba(255,214,10,0.25)",  text: "#8a6800", border: "rgba(255,214,10,0.5)"   },
  "Naans":           { bg: "rgba(175,82,222,0.10)",   active: "rgba(175,82,222,0.22)",  text: "#7a38bb", border: "rgba(175,82,222,0.4)"   },
  "Poulet":          { bg: "rgba(255,149,0,0.10)",    active: "rgba(255,149,0,0.22)",   text: "#b36200", border: "rgba(255,149,0,0.4)"    },
  "Agneau":          { bg: "rgba(255,59,48,0.08)",    active: "rgba(255,59,48,0.18)",   text: "#c0271e", border: "rgba(255,59,48,0.35)"   },
  "Boeuf":           { bg: "rgba(94,92,230,0.10)",    active: "rgba(94,92,230,0.22)",   text: "#3c3aaa", border: "rgba(94,92,230,0.4)"    },
  "Poisson":         { bg: "rgba(10,132,255,0.10)",   active: "rgba(10,132,255,0.22)",  text: "#005bcc", border: "rgba(10,132,255,0.4)"   },
  "Végétarien":      { bg: "rgba(0,199,190,0.10)",    active: "rgba(0,199,190,0.22)",   text: "#007a74", border: "rgba(0,199,190,0.4)"    },
  "Riz":             { bg: "rgba(255,204,0,0.12)",    active: "rgba(255,204,0,0.25)",   text: "#806000", border: "rgba(255,204,0,0.45)"   },
  "Entrée":          { bg: "rgba(255,45,85,0.08)",    active: "rgba(255,45,85,0.18)",   text: "#c0003a", border: "rgba(255,45,85,0.35)"   },
  "Biryani":         { bg: "rgba(180,120,60,0.10)",   active: "rgba(180,120,60,0.22)",  text: "#7a4e1a", border: "rgba(180,120,60,0.4)"   },
  "Desserts":        { bg: "rgba(255,45,85,0.08)",    active: "rgba(255,45,85,0.18)",   text: "#c0003a", border: "rgba(255,45,85,0.35)"   },
  "Menu Midi":       { bg: "rgba(48,209,88,0.10)",    active: "rgba(48,209,88,0.22)",   text: "#1a6e35", border: "rgba(48,209,88,0.4)"    },
  "Formules":        { bg: "rgba(48,209,88,0.10)",    active: "rgba(48,209,88,0.22)",   text: "#1a6e35", border: "rgba(48,209,88,0.4)"    },

  // ---- Boissons ----
  "Rouge":           { bg: "rgba(200,20,45,0.22)", active: "rgba(200,20,45,0.38)", text: "#8f1020", border: "rgba(200,20,45,0.65)" },  // vin rouge — impose
  "Blanc":           { bg: "rgba(240,200,0,0.28)", active: "rgba(240,200,0,0.45)", text: "#7a6600", border: "rgba(240,200,0,0.7)" },  // vin blanc — impose
  "Rosé":            { bg: "rgba(255,105,175,0.22)", active: "rgba(255,105,175,0.38)", text: "#a8175e", border: "rgba(255,105,175,0.65)" },  // rose — impose
  "Vin":             { bg: "rgba(155,70,150,0.12)", active: "rgba(155,70,150,0.26)", text: "#853280", border: "rgba(155,70,150,0.45)" },  // autres vins : prune
  "Apéritifs":       { bg: "rgba(130,80,225,0.12)", active: "rgba(130,80,225,0.26)", text: "#481b9d", border: "rgba(130,80,225,0.45)" },  // violet
  "Digestif":        { bg: "rgba(70,105,200,0.12)", active: "rgba(70,105,200,0.26)", text: "#2a458e", border: "rgba(70,105,200,0.45)" },  // bleu indigo
  "Eaux":            { bg: "rgba(30,150,235,0.12)", active: "rgba(30,150,235,0.26)", text: "#0f69a9", border: "rgba(30,150,235,0.45)" },  // bleu
  "Boisson Maison":  { bg: "rgba(0,175,170,0.12)", active: "rgba(0,175,170,0.26)", text: "#00afaa", border: "rgba(0,175,170,0.45)" },  // turquoise
  "Bière":           { bg: "rgba(60,165,75,0.12)", active: "rgba(60,165,75,0.26)", text: "#31873d", border: "rgba(60,165,75,0.45)" },  // vert
  "Sirop":           { bg: "rgba(140,200,50,0.12)", active: "rgba(140,200,50,0.26)", text: "#679325", border: "rgba(140,200,50,0.45)" },  // vert anis
  "Jus & Soda":      { bg: "rgba(255,140,20,0.12)", active: "rgba(255,140,20,0.26)", text: "#b85e00", border: "rgba(255,140,20,0.45)" },  // orange vif
  "Whisky":          { bg: "rgba(150,105,60,0.12)", active: "rgba(150,105,60,0.26)", text: "#855c32", border: "rgba(150,105,60,0.45)" },  // brun clair
  "Café/Thé":        { bg: "rgba(90,65,50,0.12)", active: "rgba(90,65,50,0.26)", text: "#663e27", border: "rgba(90,65,50,0.45)" },  // brun cafe fonce
};

// Couleurs qu'on peut choisir pour une famille (pastille dans la fiche
// catégorie). Même style que les couleurs manuelles : fond transparent,
// lisible en thème clair comme en sombre. « vif » sert à la pastille.
// Texte : la teinte mêlée à la couleur du texte du thème (#1a1a1a en clair,
// blanc en sombre) : lisible sur le fond teinté dans les deux thèmes.
const texteLisible = (vif) => `color-mix(in srgb, ${vif} 45%, var(--text-primary, #1a1a1a))`;
const teinte = (r, g, b) => ({
  bg: `rgba(${r},${g},${b},0.14)`, active: `rgba(${r},${g},${b},0.28)`,
  text: texteLisible(`rgb(${r},${g},${b})`), border: `rgba(${r},${g},${b},0.6)`, vif: `rgb(${r},${g},${b})`,
});
export const PALETTE = [
  { cle: "rouge",     nom: "Rouge",     couleur: teinte(220, 40, 50) },
  { cle: "orange",    nom: "Orange",    couleur: teinte(255, 140, 20) },
  { cle: "jaune",     nom: "Jaune",     couleur: teinte(235, 190, 0) },
  { cle: "vert",      nom: "Vert",      couleur: teinte(52, 170, 80) },
  { cle: "turquoise", nom: "Turquoise", couleur: teinte(0, 175, 170) },
  { cle: "bleu",      nom: "Bleu",      couleur: teinte(30, 130, 235) },
  { cle: "violet",    nom: "Violet",    couleur: teinte(140, 80, 220) },
  { cle: "rose",      nom: "Rose",      couleur: teinte(240, 90, 160) },
  { cle: "marron",    nom: "Marron",    couleur: teinte(140, 95, 55) },
  { cle: "gris",      nom: "Gris",      couleur: teinte(120, 120, 130) },
];

// Couleur d'une famille. « choix » = couleurs choisies dans la catégorie
// ({ famille: clé de PALETTE }) ; sans choix, couleur manuelle connue, sinon
// couleur automatique tirée du nom (le même nom donne toujours la même).
export function getSubcatColor(subcategory, choix) {
  if (!subcategory) return null;
  const cle = choix && choix[subcategory];
  const choisie = cle && PALETTE.find((p) => p.cle === cle);
  if (choisie) return choisie.couleur;
  if (SUBCAT_COLORS[subcategory]) {
    // couleurs manuelles inchangées ; « vif » (pastille) = leur bordure rendue opaque
    const c = SUBCAT_COLORS[subcategory];
    return { ...c, vif: c.border.replace("rgba", "rgb").replace(/,\s*[\d.]+\)$/, ")") };
  }
  let hash = 0;
  for (let i = 0; i < subcategory.length; i++) {
    hash = (subcategory.charCodeAt(i) + ((hash << 5) - hash)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  // Transparente comme les couleurs manuelles : un fond plein et clair
  // rendait le nom blanc illisible en mode sombre (famille creee dans l'admin).
  return {
    bg:     `hsla(${hue},60%,50%,0.12)`,
    active: `hsla(${hue},60%,50%,0.26)`,
    text:   texteLisible(`hsl(${hue},60%,50%)`),
    border: `hsla(${hue},60%,50%,0.45)`,
    vif:    `hsl(${hue},60%,50%)`,
  };
}
