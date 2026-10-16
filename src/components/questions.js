// Questions et réponses d'un produit : règles pures, sans affichage.
// Partagées par l'éditeur (EtapesEditeur) et la fiche produit.
import { ticketDeEtape, posteDeEtape, posteDeCategorie } from "./postes";

// Questions d'un menu : le titre décide du ticket (bar, cuisine, desserts)
export const QUESTIONS_MENU = [
  { label: "Apéritif", icone: "🥂" },
  { label: "Boisson", icone: "🥤" },
  { label: "Naan", icone: "🫓" },
  { label: "Entrée", icone: "🥗" },
  { label: "Plat", icone: "🍛" },
  { label: "Dessert", icone: "🍨" },
];

export function nomChoix(a) { return typeof a === "string" ? a : a.name; }
export function objet(a) { return typeof a === "string" ? { name: a, piment: false } : a; }
export function simple(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
// Une question de suite garde son siEtape même vide, le temps qu'on retape
// le titre de sa question : sinon elle se détachait pour toujours.
export function estSuite(e) { return e.siEtape != null; }
export function avecPrix(e) { return (e.articles || []).some((a) => typeof a === "object" && a && a.price != null); }

// « Kir » → « Kir royal » : la réponse reprend le nom ENTIER du choix, elle le
// remplace. « Café gourmand » → « Café allongé » : elle le précise (le
// premier mot seul effaçait le café gourmand du ticket desserts). Ce n'est
// qu'une proposition à la première réponse : l'équipe peut changer.
export function remplaceLeChoix(declencheur, reponses) {
  const nom = simple(declencheur).trim();
  return reponses.length > 0 && !!nom
    && reponses.every((r) => simple(nomChoix(r)).trim().startsWith(nom + " "));
}

// Seule cette question peut donner le prix hors menu : celle dont la réponse
// s'écrit sur le ticket (la caisse y met sinon le prix du produit), ou, à
// défaut, une seule question à prix (la caisse ne garde que le premier).
export function questionDuPrix(etapes) {
  return etapes.find((x) => x.remplaceNom) || null;
}

// Ce qui empêcherait le produit de marcher, en mots simples
export function problemesEtapes(etapes, estMenu, categorie, sectionTicket) {
  const pb = [];
  etapes.forEach((e, i) => {
    const nom = (e.label || "").trim() || `Question ${i + 1}`;
    if (!(e.label || "").trim()) pb.push("Une question n'a pas de titre.");
    if (!(e.articles || []).length) pb.push(`« ${nom} » n'a encore aucune réponse.`);
    if ((e.articles || []).some((a) => !String(nomChoix(a) || "").trim())) pb.push(`« ${nom} » : une réponse n'a pas de nom.`);
    // dans un menu, seules les questions principales décident du ticket
    if (estMenu && !estSuite(e) && (e.label || "").trim() && !ticketDeEtape(e.label)) {
      pb.push(`« ${nom} » : remplace-la par une question de la liste (Plat, Dessert…), sinon l'imprimante ne sait pas où l'envoyer.`);
    }
    // une condition qui cite une réponse disparue ne serait plus jamais vraie
    if ((e.pourChoix || []).length) {
      const parent = estSuite(e) ? etapes.find((x) => x.label === e.siEtape) : null;
      // une question principale dépend des questions posées AVANT elle
      const fixes = (x) => (x.articles || []).filter((a) => !(typeof a === "object" && a?.libre)).map(nomChoix);
      const noms = new Set((parent ? [parent] : etapes.slice(0, i)).flatMap(fixes));
      const perdu = e.pourChoix.find((c) => !noms.has(c));
      const apres = perdu != null && !parent && etapes.slice(i + 1).find((x) => (x.articles || []).some((a) => nomChoix(a) === perdu));
      if (apres) pb.push(`« ${nom} » dépend de « ${apres.label} », qui vient après : remonte « ${apres.label} ».`);
      else if (perdu != null) pb.push(`« ${nom} » est posée pour « ${perdu} », qui n'existe plus.`);
    }
  });
  etapes.forEach((e) => {
    if ((e.articles || []).some((a) => typeof a === "object" && a.price != null && !(a.price >= 0))) {
      pb.push(`« ${e.label} » : un prix est négatif ou invalide.`);
    }
    if ((e.articles || []).some((a) => typeof a === "object" && a.supplement != null && !(a.supplement >= 0))) {
      pb.push(`« ${e.label} » : un supplément est négatif ou invalide.`);
    }
    // une suite accrochee a une question qui ne fait que preciser ne sortirait jamais
    if (estSuite(e)) {
      const parent = etapes.find((x) => x.label === e.siEtape);
      if (parent && estSuite(parent) && !parent.remplaceParent) {
        pb.push(`« ${e.label} » est accrochée à une question qui est déjà une suite : elle ne sortirait pas sur le ticket.`);
      }
    }
  });

  // Hors menu, l'imprimante traite pourtant comme un menu un produit dont
  // toutes les questions portent un titre de menu (Naan, Plat, Boule...) qui
  // part sur un autre poste que le produit : le produit disparaissait alors
  // de tous les tickets. Meme condition que isMenuFormula cote serveur.
  if (!estMenu && categorie) {
    const principales = etapes.filter((e) => !estSuite(e));
    const postes = principales.map((e) => posteDeEtape(e.label));
    // section reglee dans l'admin pour la categorie, sinon la regle par defaut
    const propre = sectionTicket || posteDeCategorie(categorie);
    // entrée + plat + dessert… : c'est un menu, il ne part ticket par ticket
    // que dans l'onglet « Menu » (renommer une question ne ferait que tout
    // envoyer en cuisine)
    const tickets = new Set(principales.map((e) => ticketDeEtape(e.label)).filter(Boolean));
    if (tickets.size > 1) {
      pb.push("Entrée, plat, dessert, boisson… : c'est un menu. Range-le dans l'onglet « Menu » pour que chaque choix sorte sur son ticket.");
    } else if (principales.length && postes.every(Boolean) && postes.some((p) => p !== propre)) {
      const fautif = principales[postes.findIndex((p) => p !== propre)].label;
      pb.push(`« ${fautif} » est un titre réservé aux menus. Appelle la question autrement (Parfum, Choix, Taille…).`);
    }
  }

  // Hors menu, un seul endroit donne le prix : sinon la caisse encaisse le premier trouvé
  if (!estMenu) {
    const porteuse = questionDuPrix(etapes);
    const aPrix = etapes.filter(avecPrix);
    if (porteuse) {
      aPrix.filter((e) => e !== porteuse).forEach((e) => pb.push(
        `« ${e.label} » a des prix, mais c'est « ${porteuse.label} » qui donne le prix (sa réponse s'écrit sur le ticket). Vide les prix de « ${e.label} ».`));
    } else if (aPrix.length > 1) {
      pb.push(`Des prix sont mis sur plusieurs questions (${aPrix.map((e) => `« ${e.label} »`).join(", ")}) : la caisse ne garde que le premier. Garde les prix sur une seule question.`);
    }
  }

  const titres = etapes.map((e) => (e.label || "").trim()).filter(Boolean);
  const doublon = titres.find((t, k) => titres.indexOf(t) !== k);
  if (doublon) pb.push(`Deux questions s'appellent « ${doublon} ». Renomme l'une des deux.`);
  return pb;
}

// Une question et ses questions de suite forment un bloc indivisible
export function finDuBloc(etapes, i) {
  const dedans = new Set([etapes[i].label]);
  let j = i + 1;
  while (j < etapes.length && estSuite(etapes[j]) && dedans.has(etapes[j].siEtape)) {
    dedans.add(etapes[j].label);
    j++;
  }
  return j;
}

// Une question (ou une de ses suites) qu'il faut encore compléter : même
// contrôles que problemesEtapes, pour la signaler même repliée
export function etapeIncomplete(x, etapes, estMenu) {
  if (!(x.label || "").trim() || !(x.articles || []).length) return true;
  if ((x.articles || []).some((a) => !String(nomChoix(a) || "").trim())) return true;
  if (estMenu && !estSuite(x) && !ticketDeEtape(x.label)) return true;
  if ((x.pourChoix || []).length) {
    const parent = estSuite(x) ? etapes.find((p) => p.label === x.siEtape) : null;
    const k = etapes.indexOf(x);
    const noms = new Set((parent ? [parent] : etapes.slice(0, k < 0 ? etapes.length : k))
      .flatMap((p) => (p.articles || []).filter((a) => !(typeof a === "object" && a?.libre)).map(nomChoix)));
    if (x.pourChoix.some((c) => !noms.has(c))) return true;
  }
  // mêmes contrôles que problemesEtapes pour une question seule
  if ((x.articles || []).some((a) => typeof a === "object" && a && a.price != null && !(a.price >= 0))) return true;
  if ((x.articles || []).some((a) => typeof a === "object" && a && a.supplement != null && !(a.supplement >= 0))) return true;
  if (estSuite(x)) {
    const p = etapes.find((y) => y.label === x.siEtape);
    if (p && estSuite(p) && !p.remplaceParent) return true;
  }
  const t = (x.label || "").trim();
  if (t && etapes.some((y) => y !== x && (y.label || "").trim() === t)) return true;
  return false;
}
export function fautiveDuBloc(etapes, i, estMenu) {
  return etapes.slice(i, finDuBloc(etapes, i)).find((x) => etapeIncomplete(x, etapes, estMenu)) || null;
}

// Dans un menu « Plat 2 » (l'imprimante le reconnaît comme un plat), ailleurs « Choix (2) »
export function titreLibre(etapes, voulu, menu = false) {
  const pris = new Set(etapes.map((e) => e.label));
  if (!pris.has(voulu)) return voulu;
  const nom = (n) => (menu ? `${voulu} ${n}` : `${voulu} (${n})`);
  for (let n = 2; ; n++) if (!pris.has(nom(n))) return nom(n);
}
