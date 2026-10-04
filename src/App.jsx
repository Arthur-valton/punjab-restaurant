import { useState, useMemo, useEffect, useRef } from "react";
import defaultMenu from "./data/menu";
import Ticket from "./components/Ticket";
import MenuSettings from "./components/MenuSettings";
import PasswordGate, { isAppUnlocked, unlockApp, getDefaultPasswords } from "./components/PasswordGate";
import "./App.css";

const GET_MENU_URL = "https://punjab-restaurant.vercel.app/api/get-menu";
const ORDERS_API_URL = "https://punjab-restaurant.vercel.app/api/orders";

// En developpement, l'app parle a la MEME base de commandes que la caisse du
// restaurant : valider y creait une vraie commande. On isole donc les essais
// dans le navigateur, et le serveur d'impression local tourne en mode essai.
const MODE_ESSAI = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  || window.location.hostname.startsWith("192.168.");
const CLE_COMMANDES_ESSAI = "punjab_commandes_essai";

function lireCommandesEssai() {
  try { return JSON.parse(localStorage.getItem(CLE_COMMANDES_ESSAI) || "[]"); }
  catch { return []; }
}
function ecrireCommandesEssai(liste) {
  try { localStorage.setItem(CLE_COMMANDES_ESSAI, JSON.stringify(liste)); } catch { /* navigation privee */ }
}
// Meme contrat que /api/orders : GET rend la liste, POST { action, order }
function fetchCommandes(url, options) {
  if (!MODE_ESSAI) return fetch(url, options);
  if (!options || !options.method || options.method === "GET") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(lireCommandesEssai()) });
  }
  let liste = lireCommandesEssai();
  try {
    const { action, order } = JSON.parse(options.body || "{}");
    if (action === "save") {
      const k = liste.findIndex((o) => o.id === order.id);
      liste = k < 0 ? [...liste, order] : liste.map((o, n) => (n === k ? { ...o, ...order } : o));
    } else if (action === "delete") {
      liste = liste.filter((o) => o.id !== order.id);
    }
    ecrireCommandesEssai(liste);
  } catch { /* corps illisible : on ne touche a rien */ }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
}

function getPrintUrl() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.")) {
    return `http://${host}:3001`;
  }
  const saved = localStorage.getItem("punjab_print_url");
  if (saved) return saved.replace(/\/+$/, "");
  return "https://print.restaurant-dev.fr";
}

// Niveaux de piment : 1 = recette normale (rien d'affiche), puis + / ++ / +++
const PIMENT_LEVELS = [
  { level: 1, label: "Sans piment", emoji: "—" },
  { level: 2, label: "Doux",        emoji: "+" },
  { level: 3, label: "Moyen",       emoji: "++" },
  { level: 4, label: "Fort",        emoji: "+++" },
];
function pimentMark(level) {
  return ({ 2: "+", 3: "++", 4: "+++" })[level] || "";
}

// Un vrai menu enchaîne des postes de production (entrée, plat, dessert) :
// là le récapitulatif est utile. Une formule de déclinaison (type, format,
// parfum, supplément) doit s'ajouter dès le dernier choix, même si elle
// compte deux étapes.
function estFormuleMenu(item) {
  // A partir de trois etapes on est sur un menu : le recapitulatif vaut la
  // peine avant d'envoyer. En dessous (type + supplement, deux boules...),
  // c'est une declinaison qui part directement au panier.
  return (item.formulaSteps || []).length >= 3;
}

// Une étape peut ne concerner que certains choix précédents (« pourChoix ») :
// le Kir indien n'a pas de supplément, l'étape est donc sautée pour lui.
function etapeApplicable(step, choices) {
  if (!step.pourChoix || step.pourChoix.length === 0) return true;
  // « siEtape » cible une étape précise. Indispensable sur un menu à
  // plusieurs convives : sans cela le choix du convive 2 déclencherait
  // aussi la sous-étape du convive 1.
  const pertinents = step.siEtape
    ? choices.filter((c) => c.label === step.siEtape)
    : choices;
  return pertinents.some((c) => step.pourChoix.includes(c.itemName));
}
function etapesApplicables(item, choices) {
  return (item.formulaSteps || []).filter((st) => etapeApplicable(st, choices));
}
function prochaineEtape(item, choices, apres) {
  const steps = item.formulaSteps || [];
  for (let k = apres + 1; k < steps.length; k++) {
    if (etapeApplicable(steps[k], choices)) return k;
  }
  return -1;
}

// ---- Commande groupée : un tour par service pour toute la table ----
// Deux étapes « Naan pers. 1 » et « Naan pers. 2 » désignent le même service.
function cleService(label) {
  let k = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  let avant;
  do {
    avant = k;
    k = k.replace(/\s*(pers\.?|personne)?\s*\d+\s*$/, "").trim();
  } while (k !== avant);
  return k;
}
function labelService(label) {
  let k = label, avant;
  do {
    avant = k;
    k = k.replace(/\s*(pers\.?|personne)?\s*\d+\s*$/i, "").trim();
  } while (k !== avant);
  return k;
}
// Les étapes conditionnelles ne sont pas des services : elles précisent un choix.
function etapesPrincipales(item) {
  return (item.formulaSteps || []).filter((st) => !st.siEtape);
}
// Une étape principale et toute sa descendance conditionnelle, dans l'ordre.
function sousArbre(item, step) {
  const steps = item.formulaSteps || [];
  const dedans = new Set([step.label]);
  let bouge = true;
  while (bouge) {
    bouge = false;
    for (const st of steps) {
      if (st.siEtape && dedans.has(st.siEtape) && !dedans.has(st.label)) {
        dedans.add(st.label);
        bouge = true;
      }
    }
  }
  return steps.filter((st) => dedans.has(st.label));
}
// Un menu dont deux étapes partagent le même service (le Dégustation et ses
// « pers. 1 / pers. 2 ») ne se prend pas en groupe : on ne saurait pas à quelle
// étape rattacher chaque choix. Il garde son parcours habituel.
function menuGroupable(item) {
  const principales = etapesPrincipales(item);
  if (!item.isFormula || principales.length === 0) return false;
  // Une etape principale conditionnelle ne concerne pas tout le monde : en
  // groupe on ne saurait pas combien de couverts doivent y repondre.
  if (principales.some((st) => st.pourChoix && st.pourChoix.length)) return false;
  const cles = principales.map((st) => cleService(st.label));
  return new Set(cles).size === cles.length;
}
// Fusionne les enchaînements de plusieurs menus en gardant l'ordre de chacun :
// l'apéritif du Taj Mahal se place avant les naans, pas à la fin.
function fusionnerOrdre(listes) {
  const res = [];
  for (const liste of listes) {
    let pos = 0;
    for (const k of liste) {
      const at = res.indexOf(k);
      if (at === -1) { res.splice(pos, 0, k); pos++; }
      else pos = at + 1;
    }
  }
  return res;
}

// Étapes encore à choisir sur une formule laissée en pause. Une étape
// conditionnelle dont le parent n'est pas tranché n'est pas réclamée.
function etapesManquantes(item, choices) {
  const faites = new Set((choices || []).map((c) => c.label));
  return (item.formulaSteps || []).filter(
    (st) => !faites.has(st.label) && etapeApplicable(st, choices || [])
  );
}

// Repère visuel sur le bouton : rien pour un article simple, le nombre de
// choix pour une déclinaison, le nombre d'étapes pour un menu.
function indicateurFormule(item) {
  const steps = item.formulaSteps || [];
  if (!item.isFormula || steps.length === 0) return null;
  // Un menu se reconnaît à sa catégorie, pas à son nombre d'étapes : le menu
  // Entrée+Plat n'en a que deux et reste un menu.
  if (item.category === "Menu") return { classe: "menu", texte: `${steps.length} étapes` };
  // Sinon : une seule étape = une liste de choix, plusieurs = un enchaînement
  if (steps.length === 1) return { classe: "choix", texte: `${(steps[0].articles || []).length} choix` };
  return { classe: "choix", texte: `${steps.length} étapes` };
}

// Quand les choix d'une formule portent des tarifs différents, le prix du
// produit n'est qu'un tarif d'appel : on affiche « dès X € » plutôt qu'un
// montant qui serait faux pour la moitié des choix.
function prixDepart(item) {
  const prix = (item.formulaSteps || [])
    .flatMap((s) => s.articles || [])
    .map((a) => (a && typeof a === "object" && a.price != null ? Number(a.price) : null))
    .filter((p) => p != null && !Number.isNaN(p));
  if (new Set(prix).size < 2) return null;
  return Math.min(...prix);
}

// Un choix de formule peut remplacer le nom du produit : le bouton
// s'appelle "Sirop à l'eau", le choix "Sirop à la menthe", et la ligne
// affichée devient "Sirop à la menthe".
function nomAffiche(item) {
  const c = (item.formulaChoices || []).find((x) => x.remplaceNom);
  return c ? c.itemName : item.name;
}
// Les choix qui remplacent le nom ne sont pas répétés en sous-ligne
function choixVisibles(item) {
  const choices = item.formulaChoices || [];
  // Un choix generique (« Jus de fruits ») disparaît au profit du detail
  const remplaces = new Set(choices.map((c) => c.remplaceParent).filter(Boolean));
  return choices.filter((c) => !c.remplaceNom && !remplaces.has(c.label));
}

// Pastel Apple colors par sous-catégorie (couleurs manuelles prioritaires)
const SUBCAT_COLORS = {
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

// Génère automatiquement une couleur pastel déterministe pour toute sous-catégorie inconnue
function getSubcatColor(subcategory) {
  if (!subcategory) return null;
  if (SUBCAT_COLORS[subcategory]) return SUBCAT_COLORS[subcategory];
  let hash = 0;
  for (let i = 0; i < subcategory.length; i++) {
    hash = (subcategory.charCodeAt(i) + ((hash << 5) - hash)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg:     `hsla(${hue},55%,94%,1)`,
    active: `hsla(${hue},55%,85%,1)`,
    text:   `hsl(${hue},50%,32%)`,
    border: `hsla(${hue},55%,65%,0.7)`,
  };
}
const SAVE_API_URL = "https://punjab-restaurant.vercel.app/api/save-menu";

function getCachedMenu() {
  try {
    const saved = localStorage.getItem("punjab_menu_github");
    return saved ? JSON.parse(saved) : defaultMenu;
  } catch {
    return defaultMenu;
  }
}

function App() {
  const [menuData, setMenuData] = useState(getCachedMenu);

  // Fetch latest menu from GitHub on every load
  useEffect(() => {
    // Chargement menu
    fetch(GET_MENU_URL)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setMenuData(data);
          localStorage.setItem("punjab_menu_github", JSON.stringify(data));
        }
      })
      .catch(() => {});

    // Chargement commandes actives (stockées sur Vercel)
    function fetchOrders() {
      fetchCommandes(ORDERS_API_URL)
        .then((r) => r.json())
        .then((data) => setServerOrders(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
    fetchOrders();
    const ordersInterval = setInterval(fetchOrders, 15000);

    // Chargement config (printUrl)
    fetch("https://punjab-restaurant.vercel.app/api/get-config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.printUrl) localStorage.setItem("punjab_print_url", cfg.printUrl);
      })
      .catch(() => {});

    return () => clearInterval(ordersInterval);
  }, []);
  const [orderItems, setOrderItems] = useState([]);
  const [tableNumber, setTableNumber] = useState("");
  const [orderType, setOrderType] = useState("surplace"); // "surplace" | "emporter"
  const [emporterNum, setEmporterNum] = useState(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientPickupTime, setClientPickupTime] = useState("");
  const [showOrderTypeModal, setShowOrderTypeModal] = useState(false);
  const [showEmporterModal, setShowEmporterModal] = useState(false);
  const [activeCategory, setActiveCategory] = useState(() => getCachedMenu()[0].category);
  const [cartOpen, setCartOpen] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [ticketData, setTicketData] = useState(null);
  const [showNumpad, setShowNumpad] = useState(false);
  const [numpadValue, setNumpadValue] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [activeSubcategory, setActiveSubcategory] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "ok" | "error"
  const autoLogin = new URLSearchParams(window.location.search).get("autoLogin") === "1";
  const [appUnlocked, setAppUnlocked] = useState(isAppUnlocked || autoLogin);
  const [showSettingsPwd, setShowSettingsPwd] = useState(false);
  const [serverOrders, setServerOrders] = useState([]);
  const [showOrders, setShowOrders] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [pimentPicker, setPimentPicker] = useState(null); // { item } | null
  const [remisePour, setRemisePour] = useState(null); // { order, type, valeur } | null
  const [clotureApres, setClotureApres] = useState(null); // commande dont l'addition vient de sortir
  const [formulaPicker, setFormulaPicker] = useState(null); // { item, currentStep, choices } | null
  const [texteLibre, setTexteLibre] = useState("");  // plat saisi a la main (allergie, substitution)
  const [libreCat, setLibreCat] = useState(null);  // article hors carte saisi a la main
  const [libreNom, setLibreNom] = useState("");
  const [librePrix, setLibrePrix] = useState("");
  const [groupe, setGroupe] = useState(null);  // prise de commande par service pour toute la table
  const [envoyerApresPause, setEnvoyerApresPause] = useState(false);
  const pauseRef = useRef(0);  // deux menus en pause ne doivent jamais fusionner

  async function updateMenu(newMenu) {
    setMenuData(newMenu);
    localStorage.setItem("punjab_menu_github", JSON.stringify(newMenu));
    setSaveStatus("saving");
    try {
      const res = await fetch(SAVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMenu),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setSaveStatus("ok");
      setTimeout(() => setSaveStatus(null), 2500);
    } catch (err) {
      console.error("Failed to save menu to GitHub:", err);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 4000);
    }
  }

  const [numpadOnConfirm, setNumpadOnConfirm] = useState(null);

  function openNumpad(onConfirm) {
    setNumpadValue(tableNumber);
    setNumpadOnConfirm(onConfirm ? () => onConfirm : null);
    setShowNumpad(true);
  }

  function handleNumpadKey(key) {
    if (key === "del") {
      setNumpadValue((v) => v.slice(0, -1));
    } else {
      setNumpadValue((v) => {
        if (v.length >= 3) return v;
        return v + key;
      });
    }
  }

  function confirmNumpad() {
    setTableNumber(numpadValue);
    setShowNumpad(false);
    if (numpadOnConfirm) { numpadOnConfirm(numpadValue); setNumpadOnConfirm(null); }
  }

  const activeItems = useMemo(
    () => menuData.find((s) => s.category === activeCategory)?.items || [],
    [activeCategory, menuData]
  );

  const subcategories = useMemo(
    () => [...new Set(activeItems.filter((i) => i.subcategory).map((i) => i.subcategory))],
    [activeItems]
  );

  const visibleItems = useMemo(() => {
    const items = activeSubcategory
      ? activeItems.filter((i) => i.subcategory === activeSubcategory)
      : activeItems;
    return [...items].sort((a, b) => {
      const ia = a.subcategory ? subcategories.indexOf(a.subcategory) : 999;
      const ib = b.subcategory ? subcategories.indexOf(b.subcategory) : 999;
      return ia - ib;
    });
  }, [activeItems, activeSubcategory, subcategories]);

  const totalQty = orderItems.reduce((s, i) => s + i.qty, 0);
  const totalPrice = orderItems.reduce((s, i) => s + i.price * i.qty, 0);

  // Article hors carte : chaque saisie fait sa propre ligne, meme nom identique,
  // car le prix et l'intention peuvent differer d'une fois a l'autre.
  function ajouterLibre() {
    const nom = libreNom.trim();
    if (!nom) return;
    const prix = Number(String(librePrix).replace(",", ".")) || 0;
    const cle = `libre-${Date.now()}`;
    setOrderItems((prev) => [...prev, {
      id: cle, cartId: cle, name: nom, price: prix, qty: 1,
      category: libreCat, piment: null, isFormula: false, libre: true,
    }]);
    setLibreCat(null); setLibreNom(""); setLibrePrix("");
  }

  function addItem(item, piment = null) {
    // Formula item → open multi-step picker
    if (item.isFormula && item.formulaSteps?.length > 0) {
      const { idx, choices, parcours } = avancer(item, [], [], -1);
      if (idx === -1) addFormula(item, choices);          // tout etait automatique
      else setFormulaPicker({ item, currentStep: idx, choices, parcours });
      return;
    }
    if (item.piment && piment === null) {
      setPimentPicker({ item });
      return;
    }
    const cartId = piment ? `${item.id}-p${piment}` : String(item.id);
    setOrderItems((prev) => {
      const existing = prev.find((i) => i.cartId === cartId);
      if (existing) return prev.map((i) => i.cartId === cartId ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { ...item, cartId, qty: 1, ...(piment ? { piment } : {}) }];
    });
  }

  // Avance jusqu'a la prochaine etape qui demande vraiment un choix.
  // Une etape a option unique (le plateau du menu degustation) se resout
  // toute seule : elle doit figurer sur le ticket sans couter un tap.
  function avancer(item, choices, parcours, apres) {
    let idx = prochaineEtape(item, choices, apres);
    while (idx !== -1) {
      const st = item.formulaSteps[idx];
      const arts = st.articles || [];
      if (arts.length !== 1) break;
      const seul = arts[0];
      const nom = typeof seul === "string" ? seul : seul.name;
      if (typeof seul === "object" && seul.piment) break;   // il faut demander le piment
      const c = { label: st.label, itemName: nom };
      if (st.remplaceNom) c.remplaceNom = true;
      if (st.siEtape) {
        if (st.remplaceParent) c.remplaceParent = st.siEtape;
        else c.sousChoixDe = st.siEtape;
      }
      if (typeof seul === "object" && seul.price != null) c.prix = Number(seul.price);
      choices = [...choices, c];
      parcours = [...parcours, idx];
      idx = prochaineEtape(item, choices, idx);
    }
    return { idx, choices, parcours };
  }

  // ---- Commande groupée ----------------------------------------------
  // Menus de l'onglet courant qui acceptent la prise en groupe
  // Uniquement l'onglet Menu : prendre des lassis ou des kirs « par service »
  // n'a aucun sens, et leurs etapes ne se pretent pas au comptage par couvert.
  // Proposes a la composition : ceux de l'onglet courant
  const menusGroupables = useMemo(
    () => (activeCategory === "Menu" ? visibleItems.filter(menuGroupable) : []),
    [visibleItems, activeCategory]
  );
  // Mais le parcours lui-meme doit retrouver ses menus quel que soit l'onglet
  // affiche : en reprenant une commande, on n'est pas forcement sur « Menu ».
  const tousMenusGroupables = useMemo(
    () => menuData.flatMap((sec) => sec.items).filter(menuGroupable),
    [menuData]
  );
  // Les services à parcourir, dans l'ordre des menus retenus
  function calculerServices(compo) {
    const retenus = tousMenusGroupables.filter((it) => (compo[it.id] || 0) > 0);
    const cles = fusionnerOrdre(retenus.map((it) => etapesPrincipales(it).map((st) => cleService(st.label))));
    return cles.map((cle) => {
      const blocs = retenus
        .map((it) => {
          const step = etapesPrincipales(it).find((st) => cleService(st.label) === cle);
          return step ? { item: it, step, qty: compo[it.id] } : null;
        })
        .filter(Boolean);
      return { cle, label: labelService(blocs[0].step.label), blocs };
    });
  }
  const servicesGroupe = useMemo(
    () => (groupe ? calculerServices(groupe.compo) : []),
    [groupe, tousMenusGroupables]
  );

  // Dans une précision (boules d'une coupe, parfum, piment), « Retour » doit
  // reculer d'un cran : jeter le choix entier obligerait à retaper la coupe.
  function retourGroupe() {
    setGroupe((g) => {
      const ctx = g.encours;
      const net = { ...g, pendingArticle: null, pendingPrix: null, saisie: null };
      if (!ctx || ctx.parcours.length <= 1) return { ...net, encours: null };
      const parcours = ctx.parcours.slice(0, -1);
      return { ...net, encours: { ...ctx, choices: ctx.choices.slice(0, -1),
                                  parcours, currentStep: ctx.parcours[ctx.parcours.length - 1] } };
    });
  }

  useEffect(() => {
    if (!envoyerApresPause) return;
    setEnvoyerApresPause(false);
    validateOrder();
  }, [envoyerApresPause]);

  // Ce que montre la ligne récapitulative : le choix qui a remplacé le
  // générique prend la tête, les précisions suivent.
  function libellePick(choices) {
    const remplaces = new Set(choices.map((c) => c.remplaceParent).filter(Boolean));
    const gardes = choices.filter((c) => !remplaces.has(c.label));
    if (gardes.length === 0) return "";
    const mk = pimentMark(gardes[0].piment);
    const suite = gardes.slice(1).map((c) => c.itemName);
    return gardes[0].itemName + (mk ? " " + mk : "") + (suite.length ? " — " + suite.join(" / ") : "");
  }
  function retirerPick(cle, itemId, libelle) {
    setGroupe((g) => {
      const liste = [...((g.picks[cle] || {})[itemId] || [])];
      for (let k = liste.length - 1; k >= 0; k--) {
        if (libellePick(liste[k]) === libelle) { liste.splice(k, 1); break; }
      }
      return { ...g, picks: { ...g.picks, [cle]: { ...(g.picks[cle] || {}), [itemId]: liste } } };
    });
  }

  function picksDe(cle, itemId) {
    return (groupe?.picks?.[cle]?.[itemId]) || [];
  }
  function couvertsGroupe() {
    return Object.values(groupe?.compo || {}).reduce((s, q) => s + q, 0);
  }

  // Enregistre un choix complet (article + ses précisions) pour un menu
  function poserPick(cle, itemId, choices) {
    setGroupe((g) => {
      const parCle = { ...(g.picks[cle] || {}) };
      parCle[itemId] = [...(parCle[itemId] || []), choices];
      return { ...g, picks: { ...g.picks, [cle]: parCle }, encours: null,
               pendingArticle: null, pendingPrix: null, saisie: null };
    });
  }

  // Avance dans les sous-étapes du choix en cours, ou le valide s'il n'y en a plus
  function suiteGroupe(ctx, choices, parcours, apres) {
    const { idx, choices: apresAuto, parcours: pc } = avancer(ctx.sub, choices, parcours, apres);
    if (idx === -1) poserPick(ctx.cle, ctx.item.id, apresAuto);
    else setGroupe((g) => ({ ...g, encours: { ...ctx, choices: apresAuto, parcours: pc, currentStep: idx },
                             pendingArticle: null, pendingPrix: null, saisie: null }));
  }

  // Tap sur un article : soit on demande le piment, soit on saisit un plat
  // hors carte, soit on enchaîne directement sur les sous-étapes.
  function tapArticleGroupe(item, cle, step, article) {
    const nom = typeof article === "string" ? article : article.name;
    const prix = typeof article !== "string" && article.price != null ? Number(article.price) : null;
    const sub = { ...item, formulaSteps: sousArbre(item, step) };
    const ctx = { item, cle, step, sub, choices: [], parcours: [], currentStep: 0 };
    if (typeof article !== "string" && article.libre) {
      setTexteLibre("");
      setGroupe((g) => ({ ...g, encours: ctx, saisie: { prix, piment: !!article.piment } }));
      return;
    }
    if (typeof article !== "string" && article.piment) {
      setGroupe((g) => ({ ...g, encours: ctx, pendingArticle: nom, pendingPrix: prix }));
      return;
    }
    choisirGroupe(ctx, nom, null, prix);
  }

  // Ajoute le choix courant au parcours puis cherche la suite
  function choisirGroupe(ctx, nom, piment, prix) {
    const step = ctx.sub.formulaSteps[ctx.currentStep];
    const choice = { label: step.label, itemName: nom };
    if (step.remplaceNom) choice.remplaceNom = true;
    if (step.siEtape) {
      if (step.remplaceParent) choice.remplaceParent = step.siEtape;
      else choice.sousChoixDe = step.siEtape;
    }
    if (prix != null) choice.prix = prix;
    if (piment && piment > 1) choice.piment = piment;
    suiteGroupe(ctx, [...ctx.choices, choice], [...ctx.parcours, ctx.currentStep], ctx.currentStep);
  }

  // Chaque couvert reçoit une formule complète : le serveur d'impression
  // éclate déjà les menus poste par poste, rien d'autre à adapter.
  function validerGroupe(pause = false) {
    const incomplete = pause === true;
    const ajouts = [];
    for (const it of tousMenusGroupables) {
      const n = groupe.compo[it.id] || 0;
      for (let k = 0; k < n; k++) {
        const choices = [];
        for (const st of etapesPrincipales(it)) {
          const pick = picksDe(cleService(st.label), it.id)[k];
          if (pick) choices.push(...pick);
        }
        if (choices.length) ajouts.push({ item: it, choices });
      }
    }
    const reprises = new Set(groupe.reprise || []);
    setOrderItems((prev) => {
      let suite = reprises.size ? prev.filter((i) => !reprises.has(i.cartId)) : [...prev];
      for (const { item, choices } of ajouts) {
        const sig = choices.map((c) => `${c.label}:${c.itemName}${c.piment || ""}`).join("|");
        // Un couvert laissé incomplet ne doit jamais fusionner avec un autre :
        // compléter l'un compléterait les deux, et leurs clients n'ont pas
        // forcément choisi la même chose.
        const incomplet = etapesManquantes(item, choices).length > 0;
        const cartId = incomplet ? `${item.id}-pause${++pauseRef.current}` : `${item.id}-f${sig}`;
        const prix = choices.find((c) => c.prix != null)?.prix;
        const existing = suite.find((i) => i.cartId === cartId);
        if (existing) suite = suite.map((i) => (i.cartId === cartId ? { ...i, qty: i.qty + 1 } : i));
        else suite = [...suite, { ...item, cartId, qty: 1, formulaChoices: choices,
                                  ...(prix != null ? { price: prix } : {}) }];
      }
      return suite;
    });
    setGroupe(null);
    if (incomplete) setEnvoyerApresPause(true);
  }

  // Ajoute une formule au panier. Deux sélections identiques se regroupent
  // sur une seule ligne, comme un article normal.
  function addFormula(item, choices) {
    const sig = choices.map((c) => `${c.label}:${c.itemName}${c.piment || ""}`).join("|");
    const cartId = `${item.id}-f${sig}`;
    // Un choix peut porter son propre tarif : il remplace celui du produit
    const prix = choices.find((c) => c.prix != null)?.prix;
    // Une formule reprise remplace sa ligne en pause au lieu d'en créer une
    const reprise = formulaPicker?.reprise;
    setOrderItems((prev) => {
      const base = reprise ? prev.filter((i) => i.cartId !== reprise) : prev;
      const existing = base.find((i) => i.cartId === cartId);
      if (existing) return base.map((i) => (i.cartId === cartId ? { ...i, qty: i.qty + 1 } : i));
      return [...base, { ...item, cartId, qty: 1, formulaChoices: choices,
                         ...(prix != null ? { price: prix } : {}) }];
    });
    setFormulaPicker(null);
  }

  // Un plat hors carte (allergie, substitution) : le nom tape remplace
  // l'article, le reste du parcours ne change pas.
  function validerSaisieLibre() {
    const nom = texteLibre.trim();
    if (!nom) return;
    const { saisie, ...rest } = formulaPicker;
    setTexteLibre("");
    if (saisie.piment) {
      setFormulaPicker({ ...rest, pendingArticle: nom, pendingPrix: saisie.prix ?? null });
    } else {
      setFormulaPicker(rest);
      pickFormulaItem(nom, null, saisie.prix ?? null);
    }
  }

  // Le client n'a pas encore choisi son dessert : on pose le menu au panier
  // avec ce qui est décidé, le ticket part, et on revient compléter après.
  function mettreEnPause() {
    const { item, choices, reprise } = formulaPicker;
    if (!choices.length) return;
    const prix = choices.find((c) => c.prix != null)?.prix;
    const cartId = reprise || `${item.id}-pause${++pauseRef.current}`;
    setOrderItems((prev) => {
      const ligne = { ...item, cartId, qty: 1, formulaChoices: choices,
                      ...(prix != null ? { price: prix } : {}) };
      const k = prev.findIndex((i) => i.cartId === cartId);
      if (k === -1) return [...prev, ligne];
      return prev.map((i, n) => (n === k ? { ...ligne, qty: i.qty } : i));
    });
    setFormulaPicker(null);
    setEnvoyerApresPause(true);   // le ticket doit sortir avec ce qui est decide
  }

  // Point d'entree unique : plusieurs couverts en attente se reprennent en
  // groupe, un seul se reprend dans son menu.
  function reprendreDepuis(articles, ligneVisee) {
    const menus = (articles || []).filter((it) => it.isFormula && menuGroupable(it));
    const incomplets = menus.filter((it) => etapesManquantes(it, it.formulaChoices).length > 0);
    if (incomplets.length > 1) { reprendreGroupe(menus); return; }
    const cible = ligneVisee && etapesManquantes(ligneVisee, ligneVisee.formulaChoices).length > 0
      ? ligneVisee : incomplets[0];
    if (cible) reprendreFormule(cible);
  }

  // Reprise d'une table entiere : on reconstruit le parcours par service a
  // partir des lignes du panier, au lieu de rouvrir chaque couvert un par un.
  function reprendreGroupe(lignes) {
    const compo = {};
    const picks = {};
    for (const l of lignes) {
      const n = l.qty || 1;
      compo[l.id] = (compo[l.id] || 0) + n;
      for (const st of etapesPrincipales(l)) {
        // Un choix et ses precisions (parfum, boules, piment) forment un bloc
        const dansLEtape = new Set(sousArbre(l, st).map((x) => x.label));
        const pick = (l.formulaChoices || []).filter((c) => dansLEtape.has(c.label));
        if (!pick.length) continue;
        const cle = cleService(st.label);
        const parMenu = picks[cle] || (picks[cle] = {});
        const liste = parMenu[l.id] || (parMenu[l.id] = []);
        for (let k = 0; k < n; k++) liste.push(pick);
      }
    }
    // On ouvre sur le premier service ou un couvert manque a l'appel
    const services = calculerServices(compo);
    const premier = services.findIndex((sv) =>
      sv.blocs.some((b) => ((picks[sv.cle] || {})[b.item.id] || []).length < b.qty)
    );
    setGroupe({
      compo, picks, phase: "services", etape: premier === -1 ? 0 : premier,
      encours: null, pendingArticle: null, pendingPrix: null, saisie: null,
      reprise: lignes.map((l) => l.cartId),
    });
  }

  // Rouvre une formule en pause à la première étape encore à choisir,
  // réponses précédentes conservées.
  function reprendreFormule(ligne) {
    const manquantes = etapesManquantes(ligne, ligne.formulaChoices);
    if (!manquantes.length) return;
    const steps = ligne.formulaSteps || [];
    const choices = ligne.formulaChoices || [];
    const faites = new Set(choices.map((c) => c.label));
    const parcours = steps.map((st, k) => (faites.has(st.label) ? k : -1)).filter((k) => k >= 0);
    // On repart du produit, pas de la ligne de panier : son cartId et sa
    // quantité ne doivent pas se recopier dans la formule complétée.
    const { cartId, qty, formulaChoices, ...produit } = ligne;
    setFormulaPicker({ item: produit, currentStep: steps.indexOf(manquantes[0]),
                       choices, parcours, reprise: cartId });
  }

  function pickFormulaItem(articleName, piment = null, prix = null) {
    const { item, currentStep, choices } = formulaPicker;
    const step = item.formulaSteps[currentStep];
    const choice = { label: step.label, itemName: articleName };
    if (step.remplaceNom) choice.remplaceNom = true;
    // Sous-etape de precision : le detail remplace le choix generique
    if (step.siEtape) {
      // Soit le detail remplace le choix generique (jus, kir), soit il
      // s'y rattache (les boules restent collees a leur coupe).
      if (step.remplaceParent) choice.remplaceParent = step.siEtape;
      else choice.sousChoixDe = step.siEtape;
    }
    if (prix != null) choice.prix = prix;
    if (piment && piment > 1) choice.piment = piment;
    let newChoices = [...choices, choice];
    const base = [...(formulaPicker.parcours || []), currentStep];
    const { idx: suivante, choices: apresAuto, parcours } = avancer(item, newChoices, base, currentStep);
    newChoices = apresAuto;
    if (suivante === -1) {
      // Déclinaison → ajout direct. Le récapitulatif ne s'affiche que pour un
      // menu enchaînant plusieurs postes de production.
      if (!estFormuleMenu(item)) {
        addFormula(item, newChoices);
      } else {
        setFormulaPicker({ item, currentStep, choices: newChoices, parcours, showSummary: true, reprise: formulaPicker.reprise });
      }
    } else {
      setFormulaPicker({ item, currentStep: suivante, choices: newChoices, parcours, reprise: formulaPicker.reprise });
    }
  }

  function goBackFormula() {
    const { choices } = formulaPicker;
    const parcours = formulaPicker.parcours || [];
    if (parcours.length === 0) { setFormulaPicker(null); return; }
    // On revient à l'étape d'où venait le dernier choix, pas à currentStep - 1 :
    // des étapes ont pu être sautées.
    setFormulaPicker({
      ...formulaPicker,
      currentStep: parcours[parcours.length - 1],
      parcours: parcours.slice(0, -1),
      choices: choices.slice(0, -1),
      showSummary: false,
      pendingArticle: null,
    });
  }

  function confirmFormulaOrder() {
    addFormula(formulaPicker.item, formulaPicker.choices);
  }

  function updateQty(cartId, qty) {
    if (qty < 1) return removeItem(cartId);
    setOrderItems((prev) => prev.map((i) => (i.cartId === cartId ? { ...i, qty } : i)));
  }

  function removeItem(cartId) {
    setOrderItems((prev) => prev.filter((i) => i.cartId !== cartId));
  }

  function getItemQty(id) {
    return orderItems.filter((i) => i.id === id).reduce((s, i) => s + i.qty, 0);
  }

  function generateEmporterNum() {
    const day = new Date().getDate();
    const prefixe = String(day);
    let maxN = 0;
    for (const o of serverOrders) {
      if (o.orderType !== "emporter" || !o.emporterNum) continue;
      const num = String(o.emporterNum);
      // On accepte encore l'ancien format JJ-N : des commandes emises avant
      // le changement peuvent etre en cours, et le compteur doit en tenir compte.
      let reste = null;
      if (num.includes("-")) {
        const [j, n] = num.split("-");
        if (j === prefixe) reste = n;
      } else if (num.startsWith(prefixe)) {
        reste = num.slice(prefixe.length);
      }
      const n = reste === null || reste === "" ? NaN : Number(reste);
      if (!Number.isNaN(n) && n > maxN) maxN = n;
    }
    return `${day}${maxN + 1}`;
  }

  function validateOrder() {
    setCartOpen(false);
    // En modification on ne repose pas la question du type : la commande
    // existe deja, son numero et sa table sont fixes.
    if (editingOrderId) {
      if (orderType === "emporter") setShowEmporterModal(true);  // numero conserve
      else submitOrder();
      return;
    }
    setShowOrderTypeModal(true);
  }

  function chooseOrderType(type) {
    setOrderType(type);
    setShowOrderTypeModal(false);
    if (type === "surplace") {
      if (!tableNumber) {
        openNumpad((table) => submitOrder(undefined, table));
        return;
      }
      submitOrder();
    } else {
      const num = generateEmporterNum();
      setEmporterNum(num);
      setShowEmporterModal(true);
    }
  }

  function submitOrder(overrideEmporterNum, overrideTable) {
    const num = overrideEmporterNum || emporterNum;
    const effectiveTable = orderType === "emporter" ? num : (overrideTable || tableNumber);
    const orderNum = Math.floor(Math.random() * 9000) + 1000;
    const orderId = editingOrderId || `order-${orderNum}-${Date.now()}`;
    const orderData = {
      id: orderId,
      orderNum,
      tableNumber: effectiveTable,
      orderType,
      ...(orderType === "emporter" ? {
        emporterNum: num,
        ...(clientName ? { clientName } : {}),
        ...(clientPhone ? { clientPhone } : {}),
        ...(clientPickupTime ? { clientPickupTime } : {}),
      } : {}),
      items: [...orderItems],
      receivedAt: Date.now(),
    };
    fetchCommandes(ORDERS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", order: orderData }),
    })
      .then(() => setServerOrders((prev) => {
        const idx = prev.findIndex((o) => o.id === orderId);
        return idx >= 0 ? prev.map((o, i) => (i === idx ? orderData : o)) : [...prev, orderData];
      }))
      .catch(() => {});
    setTicketData({
      items: [...orderItems],
      table: effectiveTable,
      orderNum,
      orderId,
      orderData,
      orderType,
      emporterNum: num,
      clientName,
      clientPhone,
      clientPickupTime,
    });
    setShowTicket(true);
    setCartOpen(false);
    setShowEmporterModal(false);
  }

  function newOrder() {
    setOrderItems([]);
    setTableNumber("");
    setOrderType("surplace");
    setEmporterNum(null);
    setClientName("");
    setClientPhone("");
    setClientPickupTime("");
    setShowOrderTypeModal(false);
    setShowEmporterModal(false);
    setShowTicket(false);
    setTicketData(null);
    setEditingOrderId(null);
  }

  async function reprintBill(cmd, remise) {
    // On transmet la commande : le serveur d'impression l'oublie des que la
    // cuisine a termine, alors que l'addition se demande apres.
    const corps = {
      order: cmd.items,
      tableNumber: cmd.tableNumber,
      orderNum: cmd.orderNum,
      date: cmd.date || new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }),
      orderType: cmd.orderType,
      emporterNum: cmd.emporterNum,
      clientName: cmd.clientName,
      clientPhone: cmd.clientPhone,
      clientPickupTime: cmd.clientPickupTime,
      ...(remise ? { remise } : {}),
    };
    try {
      const res = await fetch(`${getPrintUrl()}/order/${encodeURIComponent(cmd.id)}/reprint-bill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch (err) {
      // Sans ce retour, l'addition ne sortait pas et personne ne le savait.
      alert("L'addition n'a pas pu s'imprimer : " + err.message);
      return false;
    }
  }

  async function closeTable(orderId) {
    // Supprimer de Vercel (source de vérité)
    fetchCommandes(ORDERS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", order: { id: orderId } }),
    }).catch(() => {});
    // Notifier le ThinkCentre pour que le KDS/service retirent la commande
    const serverOrder = serverOrders.find((o) => o.id === orderId);
    const tcId = serverOrder?.tcOrderId;
    if (tcId) {
      fetch(`${getPrintUrl()}/order/${encodeURIComponent(tcId)}`, { method: "DELETE" }).catch(() => {});
    }
    setServerOrders((prev) => prev.filter((o) => o.id !== orderId));
  }

  function loadOrderForEdit(serverOrder) {
    const items = serverOrder.items.map((i) => ({
      id: i.id,
      name: i.name,
      price: i.price,
      category: i.category,
      subcategory: i.subcategory || null,
      qty: i.qty,
      piment: i.piment || null,
      formulaChoices: i.formulaChoices || null,
      // Sans les etapes, on ne peut plus savoir ce qui reste a choisir sur
      // un menu mis en pause : le bouton « A completer » disparaissait des
      // qu'on rouvrait la commande. Repli sur la carte pour les anciennes.
      isFormula: i.isFormula ?? !!i.formulaChoices,
      formulaSteps: i.formulaSteps
        || menuData.flatMap((sec) => sec.items).find((p) => p.id === i.id)?.formulaSteps
        || null,
      cartId: i.cartId || (i.formulaChoices ? `${i.id}-f${Date.now() + Math.random()}` : (i.piment ? `${i.id}-p${i.piment}` : String(i.id))),
    }));
    setOrderItems(items);
    setTableNumber(serverOrder.tableNumber);
    // (les articles sont rendus en fin de fonction : l'appelant peut enchainer
    //  sur celui qui attend encore un choix)
    // Une commande a emporter garde son identite : sans ca la validation
    // redemandait le type et regenerait un numero du jour.
    setOrderType(serverOrder.orderType === "emporter" ? "emporter" : "surplace");
    setEmporterNum(serverOrder.emporterNum || null);
    setClientName(serverOrder.clientName || "");
    setClientPhone(serverOrder.clientPhone || "");
    setClientPickupTime(serverOrder.clientPickupTime || "");
    setEditingOrderId(serverOrder.id);
    setShowOrders(false);
    return items;
  }

  // App-level password gate
  if (!appUnlocked) {
    return (
      <PasswordGate
        title="Punjab Restaurant"
        onSuccess={(pwd) => {
          if (pwd === getDefaultPasswords().app) {
            unlockApp();
            setAppUnlocked(true);
            return true;
          }
          return false;
        }}
      />
    );
  }

  const cartContent = (
    <>
      {orderItems.length > 0 ? (
        <>
          <div className="cart-detail cart-detail--always">
            {orderItems.map((item) => (
              <div key={item.cartId} className="cart-item-block">
                <div className="cart-item">
                  <span className="cart-item-name">
                    {nomAffiche(item)}
                    {pimentMark(item.piment) && <span className="cart-piment">{pimentMark(item.piment)}</span>}
                  </span>
                  <div className="cart-item-controls">
                    <button
                      className={`qty-btn ${item.qty === 1 ? "delete" : ""}`}
                      onClick={() => updateQty(item.cartId, item.qty - 1)}
                    >
                      {item.qty === 1 ? "✕" : "−"}
                    </button>
                    <span className="cart-item-qty">{item.qty}</span>
                    <button className="qty-btn" onClick={() => updateQty(item.cartId, item.qty + 1)}>+</button>
                  </div>
                  <span className="cart-item-subtotal">{(item.price * item.qty).toFixed(2)} &euro;</span>
                </div>
                {choixVisibles(item).map((choice, ci) => (
                  <div key={ci} className="cart-formula-choice">↳ {choice.label} : {choice.itemName}{pimentMark(choice.piment) && <span className="cart-piment">{pimentMark(choice.piment)}</span>}</div>
                ))}
                {(() => {
                  const reste = etapesManquantes(item, item.formulaChoices);
                  if (!reste.length) return null;
                  return (
                    <button className="cart-a-completer" onClick={() => reprendreDepuis(orderItems, item)}>
                      <span className="cart-a-completer-puce">⏸</span>
                      À compléter : {reste.map((st) => st.label).join(", ")}
                    </button>
                  );
                })()}
              </div>
            ))}
            <div className="cart-detail-actions">
              <button className="btn-clear" onClick={() => setOrderItems([])}>Vider</button>
            </div>
          </div>
          <div className="cart-bottom">
            <button className="btn-validate-big" onClick={validateOrder}>
              <span className="btn-validate-label">Commander</span>
              <span className="btn-validate-price">{totalPrice.toFixed(2)} &euro;</span>
            </button>
          </div>
        </>
      ) : (
        <div className="cart-empty-sidebar">
          <span>🛒</span>
          <p>Panier vide</p>
        </div>
      )}
    </>
  );

  return (
    <div className="app">

      {/* ── MAIN COLUMN ── */}
      <div className="app-main">

        <header className="app-header">
          <h1>PUNJAB</h1>
          {MODE_ESSAI && <span className="badge-essai">MODE ESSAI</span>}
          <div className="header-right">
            <button className="settings-btn" onClick={() => setShowSettingsPwd(true)}>⚙</button>
            <button className="orders-btn" onClick={() => setShowOrders(true)}>
              <span className="orders-btn-label">En cours</span>
              {serverOrders.length > 0 && <span className="orders-btn-count">{serverOrders.length}</span>}
            </button>
            <button className="table-btn" onClick={openNumpad}>
              <span className="table-btn-label">Table</span>
              <span className="table-btn-value">{tableNumber || "--"}</span>
            </button>
          </div>
        </header>

        <div className="category-tabs">
          {menuData.map((section) => (
            <button
              key={section.category}
              className={`category-tab ${activeCategory === section.category ? "active" : ""}`}
              onClick={() => { setActiveCategory(section.category); setActiveSubcategory(null); }}
            >
              {section.category}
            </button>
          ))}
        </div>

        {subcategories.length > 0 && (
          <div className="subcategory-tabs">
            <button className={`subcategory-tab ${!activeSubcategory ? "active" : ""}`} onClick={() => setActiveSubcategory(null)}>Tous</button>
            {subcategories.map((sub) => {
              const c = getSubcatColor(sub);
              const isActive = activeSubcategory === sub;
              return (
                <button
                  key={sub}
                  className="subcategory-tab"
                  onClick={() => setActiveSubcategory(sub)}
                  style={c ? {
                    background: isActive ? c.active : c.bg,
                    borderColor: isActive ? c.border : "transparent",
                    color: c.text,
                    fontWeight: isActive ? 700 : 500,
                  } : undefined}
                >
                  {sub}
                </button>
              );
            })}
          </div>
        )}

        <div className="menu-grid">
          {menusGroupables.length > 0 && (
            <button
              className="groupe-ouvrir"
              onClick={() => setGroupe({ compo: {}, phase: "compo", etape: 0, picks: {},
                                         encours: null, pendingArticle: null, pendingPrix: null, saisie: null })}
            >
              <span className="groupe-ouvrir-titre">Commande groupée</span>
              <span className="groupe-ouvrir-aide">toute la table, un service à la fois</span>
            </button>
          )}
          <div className="menu-grid-items">
            {activeCategory !== "Menu" && (
              <button
                className="menu-btn menu-btn--libre"
                onClick={() => { setLibreNom(""); setLibrePrix(""); setLibreCat(activeCategory); }}
              >
                <span className="menu-btn-name">Autre</span>
                <span className="menu-btn-bottom">
                  <span className="menu-btn-price menu-btn-price--libre">à saisir</span>
                </span>
              </button>
            )}
            {visibleItems.map((item) => {
              const qty = getItemQty(item.id);
              const c = getSubcatColor(item.subcategory);
              return (
                <button
                  key={item.id}
                  className="menu-btn"
                  onClick={() => addItem(item)}
                  style={c ? { borderColor: c.border, background: c.bg } : undefined}
                >
                  {qty > 0 && <span className="menu-btn-badge">{qty}</span>}
                  <span className="menu-btn-name">{item.name}</span>
                  <span className="menu-btn-bottom">
                    <span className="menu-btn-price" style={c ? { color: c.text } : undefined}>
                      {(() => {
                        const depart = prixDepart(item);
                        return depart === null
                          ? <>{item.price.toFixed(2)} &euro;</>
                          : <><span className="menu-btn-price-prefix">dès </span>{depart.toFixed(2)} &euro;</>;
                      })()}
                    </span>
                    {(() => {
                      const ind = indicateurFormule(item);
                      return ind && <span className={`menu-btn-tag ${ind.classe}`}>{ind.texte}</span>;
                    })()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Cart bar — mobile only */}
        {orderItems.length > 0 && (
          <div className="cart-bar">
            {cartOpen && (
              <div className="cart-detail">
                {orderItems.map((item) => (
                  <div key={item.cartId} className="cart-item-block">
                    <div className="cart-item">
                      <span className="cart-item-name">
                        {nomAffiche(item)}
                        {pimentMark(item.piment) && <span className="cart-piment">{pimentMark(item.piment)}</span>}
                      </span>
                      <div className="cart-item-controls">
                        <button className={`qty-btn ${item.qty === 1 ? "delete" : ""}`} onClick={() => updateQty(item.cartId, item.qty - 1)}>
                          {item.qty === 1 ? "✕" : "−"}
                        </button>
                        <span className="cart-item-qty">{item.qty}</span>
                        <button className="qty-btn" onClick={() => updateQty(item.cartId, item.qty + 1)}>+</button>
                      </div>
                      <span className="cart-item-subtotal">{(item.price * item.qty).toFixed(2)} &euro;</span>
                    </div>
                    {choixVisibles(item).map((choice, ci) => (
                      <div key={ci} className="cart-formula-choice">↳ {choice.label} : {choice.itemName}{pimentMark(choice.piment) && <span className="cart-piment">{pimentMark(choice.piment)}</span>}</div>
                    ))}
                    {(() => {
                      const reste = etapesManquantes(item, item.formulaChoices);
                      if (!reste.length) return null;
                      return (
                        <button className="cart-a-completer" onClick={() => reprendreDepuis(orderItems, item)}>
                          <span className="cart-a-completer-puce">⏸</span>
                          À compléter : {reste.map((st) => st.label).join(", ")}
                        </button>
                      );
                    })()}
                  </div>
                ))}
                <div className="cart-detail-actions">
                  <button className="btn-clear" onClick={() => { setOrderItems([]); setCartOpen(false); }}>Vider</button>
                </div>
              </div>
            )}
            <div className="cart-bottom">
              <button className="cart-expand" onClick={() => setCartOpen(!cartOpen)}>
                <span className="cart-count">{totalQty}</span>
                <span className="cart-expand-arrow">{cartOpen ? "▼" : "▲"}</span>
              </button>
              <button className="btn-validate-big" onClick={validateOrder}>
                <span className="btn-validate-label">{tableNumber ? "Valider" : "Entrez la table"}</span>
                <span className="btn-validate-price">{totalPrice.toFixed(2)} &euro;</span>
              </button>
            </div>
          </div>
        )}
      </div>{/* end app-main */}

      {/* ── SIDEBAR — desktop only ── */}
      <div className="app-sidebar">
        <div className="sidebar-header">
          <span>Commande{tableNumber ? ` — Table ${tableNumber}` : ""}</span>
          {totalQty > 0 && <span className="sidebar-count">{totalQty}</span>}
        </div>
        {cartContent}
      </div>

      {/* Numpad overlay */}
      {showNumpad && (
        <div className="numpad-overlay" onClick={() => setShowNumpad(false)}>
          <div className="numpad" onClick={(e) => e.stopPropagation()}>
            <div className="numpad-display">
              <span className="numpad-display-label">Table N°</span>
              <span className="numpad-display-value">{numpadValue || "--"}</span>
            </div>
            <div className="numpad-grid">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button key={n} className="numpad-key" onClick={() => handleNumpadKey(String(n))}>{n}</button>
              ))}
              <button className="numpad-key numpad-key-del" onClick={() => handleNumpadKey("del")}>⌫</button>
              <button className="numpad-key" onClick={() => handleNumpadKey("0")}>0</button>
              <button className="numpad-key numpad-key-ok" onClick={confirmNumpad} disabled={!numpadValue}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings password prompt */}
      {showSettingsPwd && (
        <PasswordGate
          title="Paramètres — mot de passe"
          onSuccess={(pwd) => {
            if (pwd === getDefaultPasswords().settings) {
              setShowSettingsPwd(false);
              setShowSettings(true);
              return true;
            }
            return false;
          }}
          onCancel={() => setShowSettingsPwd(false)}
        />
      )}

      {/* Settings overlay */}
      {showSettings && (
        <MenuSettings menuData={menuData} onUpdate={updateMenu} onClose={() => setShowSettings(false)} saveStatus={saveStatus} />
      )}

      {/* Piment picker */}
      {pimentPicker && (
        <div className="numpad-overlay" onClick={() => setPimentPicker(null)}>
          <div className="piment-picker" onClick={(e) => e.stopPropagation()}>
            <div className="piment-picker-title">{pimentPicker.item.name}</div>
            <div className="piment-picker-subtitle">Niveau de piment ?</div>
            {PIMENT_LEVELS.map(({ level, label, emoji }) => (
              <button
                key={level}
                className="piment-picker-btn"
                onClick={() => { addItem(pimentPicker.item, level); setPimentPicker(null); }}
              >
                <span className="piment-picker-emoji">{emoji}</span>
                <span className="piment-picker-label">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Formula picker */}
      {formulaPicker && (
        <div className="numpad-overlay" onClick={() => setFormulaPicker(null)}>
          <div className="formula-picker" onClick={(e) => e.stopPropagation()}>
            <div className="formula-picker-header">
              <div className="formula-picker-title">{formulaPicker.item.name}</div>
              <div className="formula-picker-progress">
                {etapesApplicables(formulaPicker.item, formulaPicker.choices).map((_, i) => {
                  const rang = (formulaPicker.parcours || []).length;
                  return <span key={i} className={`formula-picker-dot ${i < rang ? "done" : i === rang ? "active" : ""}`} />;
                })}
              </div>
            </div>

            {formulaPicker.showSummary ? (
              /* ── Écran de confirmation ── */
              <>
                <div className="formula-picker-step-label" style={{ color: "#27ae60" }}>✓ Récapitulatif</div>
                <div className="formula-picker-items">
                  {formulaPicker.choices.map((c, i) => (
                    <div key={i} className="formula-summary-row">
                      <span className="formula-summary-label">{c.label}</span>
                      <span className="formula-summary-name">
                        {c.itemName}
                        {pimentMark(c.piment) && <span style={{ marginLeft: 5 }}>{pimentMark(c.piment)}</span>}
                      </span>
                    </div>
                  ))}
                </div>
                <button className="formula-picker-confirm" onClick={confirmFormulaOrder}>
                  Ajouter au panier
                </button>
                <button className="formula-picker-cancel" onClick={goBackFormula}>← Modifier</button>
              </>
            ) : (
            /* ── Récap des choix déjà faits (étapes précédentes) ── */
            <>
            {formulaPicker.choices.length > 0 && (
              <div className="formula-picker-recap">
                {formulaPicker.choices.map((c, i) => (
                  <div key={i} className="formula-picker-recap-row">
                    <span className="formula-picker-recap-label">{c.label}</span>
                    <span className="formula-picker-recap-name">
                      {c.itemName}
                      {pimentMark(c.piment) && <span style={{ marginLeft: 4 }}>{pimentMark(c.piment)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {formulaPicker.saisie ? (
              /* ── Saisie libre : plat hors carte ── */
              <>
                <div className="formula-picker-step-label">Saisir le plat</div>
                <input
                  className="formula-libre-input"
                  autoFocus
                  value={texteLibre}
                  placeholder="Nom du plat"
                  onChange={(e) => setTexteLibre(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") validerSaisieLibre(); }}
                />
                <button className="formula-picker-confirm" disabled={!texteLibre.trim()} onClick={validerSaisieLibre}>
                  Valider
                </button>
                <button className="formula-picker-cancel" onClick={() => {
                  setTexteLibre("");
                  const { saisie, ...rest } = formulaPicker;
                  setFormulaPicker(rest);
                }}>← Retour</button>
              </>
            ) : formulaPicker.pendingArticle ? (
              /* ── Sous-étape piment ── */
              <>
                <div className="formula-picker-step-label">
                  🌶️ Niveau de piment — <strong>{formulaPicker.pendingArticle}</strong>
                </div>
                <div className="formula-picker-items">
                  {PIMENT_LEVELS.map(({ level, label, emoji }) => (
                    <button
                      key={level}
                      className="formula-picker-item-btn"
                      onClick={() => {
                        const { pendingArticle, pendingPrix, ...rest } = formulaPicker;
                        setFormulaPicker(rest); // efface pendingArticle avant pick
                        pickFormulaItem(pendingArticle, level, pendingPrix ?? null);
                      }}
                    >
                      <span style={{ marginRight: 8 }}>{emoji}</span>{label}
                    </button>
                  ))}
                </div>
                <button className="formula-picker-cancel" onClick={() => setFormulaPicker({ ...formulaPicker, pendingArticle: null })}>← Retour</button>
              </>
            ) : (
              /* ── Liste articles ── */
              <>
                <div className="formula-picker-step-label">
                  {(() => {
                    const item = formulaPicker.item;
                    const label = item.formulaSteps[formulaPicker.currentStep].label;
                    // Seules les étapes qui concernent les choix faits sont comptées
                    const concernees = etapesApplicables(item, formulaPicker.choices);
                    const rang = (formulaPicker.parcours || []).length + 1;
                    // « Étape 1/1 » n'apporte rien : on ne compte que s'il y en a plusieurs
                    return concernees.length > 1
                      ? `Étape ${rang}/${concernees.length} — ${label}`
                      : label;
                  })()}
                </div>
                <div className="formula-picker-items">
                  {(() => {
                    const step = formulaPicker.item.formulaSteps[formulaPicker.currentStep];
                    const articles = step.articles || [];
                    return articles.length > 0
                      ? articles.map((article, ai) => {
                          const name = typeof article === "string" ? article : article.name;
                          const hasPiment = typeof article !== "string" && article.piment;
                          // « Autre » : le nom du plat est tape a la main
                          const libre = typeof article !== "string" && article.libre;
                          // Le prix du choix, sinon celui du produit. Sur un menu
                          // multi-étapes on n'affiche rien : le prix couvre le menu
                          // entier, pas chaque entrée ou plat pris isolément.
                          const prixArticle = typeof article !== "string" && article.price != null ? Number(article.price) : null;
                          // Repli sur le prix du produit uniquement pour l'étape qui
                          // définit l'article. Un supplément n'a pas de tarif propre.
                          const etapeCourante = formulaPicker.item.formulaSteps[formulaPicker.currentStep];
                          const prix = prixArticle != null
                            ? prixArticle
                            : (etapeCourante?.remplaceNom && !estFormuleMenu(formulaPicker.item)
                                ? formulaPicker.item.price : null);
                          return (
                            <button
                              key={ai}
                              className={`formula-picker-item-btn${libre ? " libre" : ""}`}
                              onClick={() => {
                                if (libre) {
                                  setTexteLibre("");
                                  setFormulaPicker({ ...formulaPicker, saisie: { prix, piment: hasPiment } });
                                } else if (hasPiment) {
                                  setFormulaPicker({ ...formulaPicker, pendingArticle: name, pendingPrix: prix });
                                } else {
                                  pickFormulaItem(name, null, prix);
                                }
                              }}
                            >
                              {name}
                              {libre && <span className="formula-picker-price">à saisir</span>}
                              {!libre && prix != null && <span className="formula-picker-price">{prix.toFixed(2)} €</span>}
                            </button>
                          );
                        })
                      : <p className="formula-picker-empty">Aucun article configuré pour cette étape</p>;
                  })()}
                </div>
                {formulaPicker.choices.length > 0 && (
                  <button className="formula-picker-pause" onClick={mettreEnPause}>
                    Mettre en pause — {etapesManquantes(formulaPicker.item, formulaPicker.choices).length} à choisir
                  </button>
                )}
                <button className="formula-picker-cancel" onClick={(formulaPicker.parcours || []).length > 0 ? goBackFormula : () => setFormulaPicker(null)}>
                  {(formulaPicker.parcours || []).length > 0 ? "← Retour" : "Annuler"}
                </button>
              </>
            )}
            </>
            )}
          </div>
        </div>
      )}

      {/* Orders panel */}
      {showOrders && (
        <div className="numpad-overlay" onClick={() => setShowOrders(false)}>
          <div className="orders-panel" onClick={(e) => e.stopPropagation()}>
            <div className="orders-panel-header">
              <span>Commandes en cours</span>
              <button className="orders-panel-close" onClick={() => setShowOrders(false)}>✕</button>
            </div>
            {serverOrders.length === 0 ? (
              <p className="orders-panel-empty">Aucune commande active</p>
            ) : (
              serverOrders.map((o) => (
                <div key={o.id} className={`orders-panel-item${o.orderType === "emporter" ? " orders-panel-item--emporter" : ""}`}>
                  <div className="orders-panel-meta">
                    {o.orderType === "emporter" ? (
                      <div className="orders-panel-meta-emporter">
                        <span className="orders-panel-emporter-badge">À EMPORTER</span>
                        <strong className="orders-panel-emporter-num">#{o.emporterNum}</strong>
                        {o.clientName && <span className="orders-panel-emporter-info">{o.clientName}</span>}
                        {o.clientPickupTime && <span className="orders-panel-emporter-time">⏰ {o.clientPickupTime}</span>}
                      </div>
                    ) : (
                      <strong>Table {o.tableNumber}</strong>
                    )}
                    <span className="orders-panel-num">#{o.orderNum}</span>
                  </div>
                  {(() => {
                    // Un menu laisse en pause doit sauter aux yeux ici :
                    // sinon personne ne se souvient d'aller le completer.
                    const reste = (o.items || []).flatMap((it) =>
                      etapesManquantes(
                        it.formulaSteps ? it : { ...it, formulaSteps: menuData.flatMap((sec) => sec.items).find((p) => p.id === it.id)?.formulaSteps },
                        it.formulaChoices
                      ).map((st) => st.label)
                    );
                    if (!reste.length) return null;
                    return (
                      <button className="orders-panel-a-completer" onClick={() => {
                        // On charge la table ET on ouvre le menu concerne :
                        // retrouver la ligne dans le panier pour retaper
                        // dessus etait un tap de trop en plein service.
                        reprendreDepuis(loadOrderForEdit(o) || []);
                      }}>
                        ⏸ À compléter : {[...new Set(reste)].join(", ")}
                      </button>
                    );
                  })()}
                  <div className="orders-panel-items">
                    {o.items.slice(0, 4).map((item, i) => (
                      <span key={i} className="orders-panel-tag">{item.qty}× {item.name}</span>
                    ))}
                    {o.items.length > 4 && <span className="orders-panel-tag">+{o.items.length - 4}</span>}
                  </div>
                  <div className="orders-panel-actions">
                    <button className="orders-panel-edit-btn" onClick={() => loadOrderForEdit(o)}>Modifier</button>
                    <button className="orders-panel-bill-btn" onClick={() => setRemisePour({ order: o, type: "aucune", valeur: "" })}>Addition</button>
                    <button className="orders-panel-close-btn" onClick={() => closeTable(o.id)}>Clôturer</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Modal choix Sur place / À emporter */}
      {showOrderTypeModal && (
        <div className="emporter-modal-overlay" onClick={() => setShowOrderTypeModal(false)}>
          <div className="emporter-modal" onClick={e => e.stopPropagation()}>
            <div className="order-type-modal-title">Type de commande</div>
            <div className="order-type-modal-choices">
              <button className="order-type-choice surplace" onClick={() => chooseOrderType("surplace")}>
                <span className="order-type-choice-icon">🍽️</span>
                <span className="order-type-choice-label">Sur place</span>
              </button>
              <button className="order-type-choice emporter" onClick={() => chooseOrderType("emporter")}>
                <span className="order-type-choice-icon">🛍️</span>
                <span className="order-type-choice-label">À emporter</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal À emporter */}
      {showEmporterModal && (
        <div className="emporter-modal-overlay" onClick={() => setShowEmporterModal(false)}>
          <div className="emporter-modal" onClick={e => e.stopPropagation()}>
            <div className="emporter-modal-header">
              <span className="emporter-modal-label">À EMPORTER</span>
              <span className="emporter-modal-num">#{emporterNum}</span>
            </div>
            <div className="emporter-modal-fields">
              <input
                className="emporter-input"
                type="text"
                placeholder="Nom (optionnel)"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
              />
              <input
                className="emporter-input"
                type="tel"
                placeholder="Téléphone (optionnel)"
                value={clientPhone}
                onChange={e => setClientPhone(e.target.value)}
              />
              {/* Sélecteur heure tactile */}
              {(() => {
                const ph = clientPickupTime ? Number(clientPickupTime.split(":")[0]) : null;
                const pm = clientPickupTime ? Number(clientPickupTime.split(":")[1]) : null;
                const HOURS = [10,11,12,13,14,15,16,17,18,19,20,21,22,23];
                const MINS  = [0,5,10,15,20,25,30,35,40,45,50,55];
                return (
                  <div className="time-picker">
                    <div className="time-picker-header">
                      <span className="time-picker-label">⏰ Heure de retrait</span>
                      <span className="time-picker-display">{clientPickupTime || "--:--"}</span>
                      {clientPickupTime && (
                        <button className="time-picker-clear" onClick={() => setClientPickupTime("")}>✕</button>
                      )}
                    </div>
                    <div className="time-picker-section-label">Heure</div>
                    <div className="time-picker-row">
                      {HOURS.map(h => (
                        <button key={h} type="button"
                          className={`time-picker-btn${ph === h ? " selected" : ""}`}
                          onClick={() => setClientPickupTime(`${String(h).padStart(2,"0")}:${pm !== null ? String(pm).padStart(2,"0") : "00"}`)}
                        >{String(h).padStart(2,"0")}</button>
                      ))}
                    </div>
                    <div className="time-picker-section-label">Minutes</div>
                    <div className="time-picker-row">
                      {MINS.map(m => (
                        <button key={m} type="button"
                          className={`time-picker-btn${pm === m ? " selected" : ""}`}
                          onClick={() => setClientPickupTime(`${ph !== null ? String(ph).padStart(2,"0") : "10"}:${String(m).padStart(2,"0")}`)}
                        >{String(m).padStart(2,"0")}</button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="emporter-modal-actions">
              <button className="emporter-btn-cancel" onClick={() => setShowEmporterModal(false)}>Annuler</button>
              <button className="emporter-btn-confirm" onClick={() => submitOrder(emporterNum)}>Confirmer</button>
            </div>
          </div>
        </div>
      )}


      {/* Remise avant impression de l'addition */}
      {remisePour && (() => {
        const cmd = remisePour.order;
        const total = (cmd.items || []).reduce((s, i) => s + i.price * i.qty, 0);
        const v = parseFloat(String(remisePour.valeur).replace(",", "."));
        const brut = remisePour.type === "aucune" || !Number.isFinite(v) || v <= 0 ? 0
          : remisePour.type === "euro" ? v : total * v / 100;
        const montant = Math.min(Math.max(brut, 0), total);
        const choisir = (type, valeur) => setRemisePour({ ...remisePour, type, valeur });
        return (
          <div className="emporter-modal-overlay" onClick={() => setRemisePour(null)}>
            <div className="emporter-modal" onClick={(e) => e.stopPropagation()}>
              <div className="remise-entete">
                <span className="remise-titre">ADDITION</span>
                <span className="remise-cible">
                  {cmd.orderType === "emporter" ? `À emporter #${cmd.emporterNum}` : `Table ${cmd.tableNumber}`}
                </span>
                <span className="remise-total">{total.toFixed(2)} &euro;</span>
              </div>
              <div className="remise-corps">
                <div className="remise-choix">
                  <button className={`remise-btn ${remisePour.type === "aucune" ? "actif" : ""}`}
                    onClick={() => choisir("aucune", "")}>Aucune</button>
                  <button className={`remise-btn ${remisePour.type === "pourcent" && String(remisePour.valeur) === "10" ? "actif" : ""}`}
                    onClick={() => choisir("pourcent", "10")}>−10 %</button>
                </div>
                <div className="remise-libre">
                  <input className="emporter-input" type="number" inputMode="decimal" min="0" step="0.5"
                    placeholder="Montant libre"
                    value={remisePour.type === "aucune" ? "" : remisePour.valeur}
                    onChange={(e) => choisir(remisePour.type === "aucune" ? "pourcent" : remisePour.type, e.target.value)} />
                  <button className={`remise-unite ${remisePour.type === "pourcent" ? "actif" : ""}`}
                    onClick={() => choisir("pourcent", remisePour.valeur)}>%</button>
                  <button className={`remise-unite ${remisePour.type === "euro" ? "actif" : ""}`}
                    onClick={() => choisir("euro", remisePour.valeur)}>&euro;</button>
                </div>
                {montant > 0 && (
                  <div className="remise-resume">
                    <span>Remise −{montant.toFixed(2)} &euro;</span>
                    <strong>À payer {(total - montant).toFixed(2)} &euro;</strong>
                  </div>
                )}
              </div>
              <div className="emporter-modal-actions">
                <button className="emporter-btn-cancel" onClick={() => setRemisePour(null)}>Annuler</button>
                <button className="emporter-btn-confirm" onClick={async () => {
                  const ok = await reprintBill(cmd, montant > 0 ? { type: remisePour.type, valeur: v } : null);
                  setRemisePour(null);
                  // On ne propose la cloture que si l'addition est bien sortie
                  if (ok) setClotureApres(cmd);
                }}>Imprimer</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Cloture proposee juste apres l'impression de l'addition */}
      {clotureApres && (
        <div className="emporter-modal-overlay" onClick={() => setClotureApres(null)}>
          <div className="emporter-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cloture-entete">
              <span className="cloture-titre">ADDITION IMPRIMÉE</span>
              <span className="cloture-cible">
                {clotureApres.orderType === "emporter"
                  ? `À emporter #${clotureApres.emporterNum}`
                  : `Table ${clotureApres.tableNumber}`}
              </span>
            </div>
            <div className="cloture-corps">
              {clotureApres.orderType === "emporter"
                ? "Clôturer cette commande ?"
                : "Clôturer la table ?"}
            </div>
            <div className="emporter-modal-actions">
              <button className="emporter-btn-cancel" onClick={() => setClotureApres(null)}>Plus tard</button>
              <button className="cloture-btn-valider" onClick={() => {
                closeTable(clotureApres.id);
                setClotureApres(null);
              }}>Clôturer</button>
            </div>
          </div>
        </div>
      )}

      {/* Commande groupée : un tour par service pour toute la table */}
      {groupe && (
        // Pas de fermeture au clic a cote : une table entiere represente des
        // dizaines de taps, un doigt pose sur le fond les effacerait tous.
        <div className="numpad-overlay">
          <div className="formula-picker" onClick={(e) => e.stopPropagation()}>
            <div className="formula-picker-header">
              <div className="formula-picker-title">
                {groupe.phase === "compo" ? "Commande groupée" : `Table de ${couvertsGroupe()}`}
              </div>
              {groupe.phase === "services" && (
                <>
                  <div className="groupe-compo-rappel">
                    {tousMenusGroupables.filter((it) => groupe.compo[it.id] > 0)
                      .map((it) => `${groupe.compo[it.id]}× ${it.name.replace(/^Menu /, "")}`).join("  ·  ")}
                  </div>
                  <div className="formula-picker-progress">
                    {servicesGroupe.map((_, i) => (
                      <span key={i} className={`formula-picker-dot ${i < groupe.etape ? "done" : i === groupe.etape ? "active" : ""}`} />
                    ))}
                  </div>
                </>
              )}
            </div>

            {groupe.saisie ? (
              /* ── Plat hors carte ── */
              <>
                <div className="formula-picker-step-label">Saisir le plat</div>
                <input
                  className="formula-libre-input"
                  autoFocus
                  value={texteLibre}
                  placeholder="Nom du plat"
                  onChange={(e) => setTexteLibre(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || !texteLibre.trim()) return;
                    const nom = texteLibre.trim(), sai = groupe.saisie, ctx = groupe.encours;
                    setTexteLibre("");
                    if (sai.piment) setGroupe((g) => ({ ...g, saisie: null, pendingArticle: nom, pendingPrix: sai.prix }));
                    else choisirGroupe(ctx, nom, null, sai.prix);
                  }}
                />
                <button className="formula-picker-confirm" disabled={!texteLibre.trim()} onClick={() => {
                  const nom = texteLibre.trim(), sai = groupe.saisie, ctx = groupe.encours;
                  setTexteLibre("");
                  if (sai.piment) setGroupe((g) => ({ ...g, saisie: null, pendingArticle: nom, pendingPrix: sai.prix }));
                  else choisirGroupe(ctx, nom, null, sai.prix);
                }}>Valider</button>
                <button className="formula-picker-cancel" onClick={() => {
                  setTexteLibre("");
                  retourGroupe();
                }}>← Retour</button>
              </>
            ) : groupe.pendingArticle ? (
              /* ── Niveau de piment ── */
              <>
                <div className="formula-picker-step-label">
                  🌶️ Niveau de piment — <strong>{groupe.pendingArticle}</strong>
                </div>
                <div className="formula-picker-items">
                  {PIMENT_LEVELS.map(({ level, label, emoji }) => (
                    <button key={level} className="formula-picker-item-btn" onClick={() => {
                      choisirGroupe(groupe.encours, groupe.pendingArticle, level, groupe.pendingPrix ?? null);
                    }}>
                      <span style={{ marginRight: 8 }}>{emoji}</span>{label}
                    </button>
                  ))}
                </div>
                <button className="formula-picker-cancel" onClick={retourGroupe}>← Retour</button>
              </>
            ) : groupe.encours ? (
              /* ── Précision rattachée au choix en cours ── */
              (() => {
                const ctx = groupe.encours;
                const step = ctx.sub.formulaSteps[ctx.currentStep];
                return (
                  <>
                    <div className="formula-picker-step-label">
                      {step.label} — <strong>{ctx.item.name.replace(/^Menu /, "")}</strong>
                    </div>
                    <div className="formula-picker-items">
                      {(step.articles || []).map((a, ai) => {
                        const nom = typeof a === "string" ? a : a.name;
                        const px = typeof a !== "string" && a.price != null ? Number(a.price) : null;
                        return (
                          <button key={ai} className="formula-picker-item-btn" onClick={() => {
                            if (typeof a !== "string" && a.piment) {
                              setGroupe((g) => ({ ...g, pendingArticle: nom, pendingPrix: px }));
                            } else choisirGroupe(ctx, nom, null, px);
                          }}>{nom}</button>
                        );
                      })}
                    </div>
                    <button className="formula-picker-cancel" onClick={retourGroupe}>← Retour</button>
                  </>
                );
              })()
            ) : groupe.phase === "compo" ? (
              /* ── Composition de la table ── */
              <>
                <div className="formula-picker-step-label">Combien de chaque menu ?</div>
                <div className="formula-picker-items">
                  {menusGroupables.map((it) => {
                    const q = groupe.compo[it.id] || 0;
                    return (
                      <div key={it.id} className="groupe-stepper">
                        <span className="groupe-stepper-nom">
                          {it.name}
                          <span className="groupe-stepper-prix">{it.price.toFixed(2)} €</span>
                        </span>
                        <button className="groupe-rond" disabled={q === 0} onClick={() =>
                          setGroupe((g) => ({ ...g, compo: { ...g.compo, [it.id]: Math.max(0, q - 1) } }))
                        }>−</button>
                        <span className="groupe-stepper-n">{q}</span>
                        <button className="groupe-rond" onClick={() =>
                          setGroupe((g) => ({ ...g, compo: { ...g.compo, [it.id]: q + 1 } }))
                        }>+</button>
                      </div>
                    );
                  })}
                </div>
                <button className="formula-picker-confirm" disabled={couvertsGroupe() === 0}
                        onClick={() => setGroupe((g) => {
                          // La composition a pu changer depuis un « Retour » : on rogne les
                          // choix deja pris aux quantites retenues, sinon ils comptent pour
                          // des couverts qui n'existent plus et sont jetes en silence.
                          const picks = {};
                          for (const [cle, parItem] of Object.entries(g.picks)) {
                            const net = {};
                            for (const [id, liste] of Object.entries(parItem)) {
                              const n = g.compo[id] || 0;
                              if (n > 0 && liste.length) net[id] = liste.slice(0, n);
                            }
                            if (Object.keys(net).length) picks[cle] = net;
                          }
                          return { ...g, picks, phase: "services", etape: 0 };
                        })}>
                  {couvertsGroupe() ? `Prendre la commande — ${couvertsGroupe()} couvert${couvertsGroupe() > 1 ? "s" : ""}`
                                    : "Choisis au moins un menu"}
                </button>
                <button className="formula-picker-cancel" onClick={() => setGroupe(null)}>Annuler</button>
              </>
            ) : (
              /* ── Un service, toutes les cartes à la fois ── */
              (() => {
                const sv = servicesGroupe[groupe.etape];
                if (!sv) return null;
                const attendus = sv.blocs.reduce((n, b) => n + b.qty, 0);
                // Plafonne par menu : sinon deux naans pour un couvert masqueraient
                // le couvert voisin qui n'a rien, et le menu partirait incomplet.
                const faits = sv.blocs.reduce((n, b) => n + Math.min(b.qty, picksDe(sv.cle, b.item.id).length), 0);
                const manque = attendus - faits;
                const dernier = groupe.etape === servicesGroupe.length - 1;
                return (
                  <>
                    <div className="formula-picker-step-label groupe-service-label">
                      <span>Étape {groupe.etape + 1}/{servicesGroupe.length} — {sv.label}</span>
                      <span className={`groupe-compte ${manque ? "" : "plein"}`}>{faits} / {attendus}</span>
                    </div>
                    <div className="formula-picker-items">
                      {sv.blocs.map((b) => {
                        const pris = picksDe(sv.cle, b.item.id);
                        const reste = b.qty - pris.length;
                        const groupes = [];
                        pris.forEach((pk) => {
                          const lb = libellePick(pk);
                          const ex = groupes.find((x) => x.lb === lb);
                          if (ex) ex.n++; else groupes.push({ lb, n: 1 });
                        });
                        return (
                          <div key={b.item.id} className="groupe-bloc">
                            {sv.blocs.length > 1 && (
                              <div className={`groupe-bloc-tete ${reste ? "" : "plein"}`}>
                                <span className="groupe-bloc-nom">{b.item.name.replace(/^Menu /, "")}</span>
                                <span className="groupe-bloc-compte">{pris.length} / {b.qty}</span>
                              </div>
                            )}
                            {(b.step.articles || []).map((a, ai) => {
                              const nom = typeof a === "string" ? a : a.name;
                              const libre = typeof a !== "string" && a.libre;
                              return (
                                <button key={ai} disabled={reste <= 0}
                                        className={`formula-picker-item-btn${libre ? " libre" : ""}`}
                                        onClick={() => tapArticleGroupe(b.item, sv.cle, b.step, a)}>
                                  {nom}
                                  {libre && <span className="formula-picker-price">à saisir</span>}
                                </button>
                              );
                            })}
                            {groupes.length > 0 && (
                              <div className="groupe-pris">
                                {groupes.map((x) => (
                                  <div key={x.lb} className="groupe-pris-ligne">
                                    <span className="groupe-pris-n">{x.n}</span>
                                    <span className="groupe-pris-txt">{x.lb}</span>
                                    <button className="groupe-pris-moins"
                                            aria-label={`Retirer ${x.lb}`}
                                            onClick={() => retirerPick(sv.cle, b.item.id, x.lb)}>−</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button className="formula-picker-confirm" disabled={manque > 0}
                            onClick={() => dernier ? validerGroupe() : setGroupe((g) => ({ ...g, etape: g.etape + 1 }))}>
                      {manque > 0 ? `Il reste ${manque} couvert${manque > 1 ? "s" : ""}`
                                  : dernier ? "Ajouter au panier" : "Service suivant"}
                    </button>
                    {(() => {
                      // La pause ne depend pas du service en cours : on peut
                      // vouloir s'arreter alors qu'il est complet mais que les
                      // suivants ne le sont pas, ou arriver sur un service ou
                      // personne n'a encore choisi. Seul compte : a-t-on
                      // quelque chose a envoyer, et resterait-il a completer ?
                      const aDesChoix = Object.values(groupe.picks || {})
                        .some((parMenu) => Object.values(parMenu).some((l) => l.length > 0));
                      if (!aDesChoix || (dernier && manque === 0)) return null;
                      return (
                        <button className="formula-picker-pause" onClick={() => validerGroupe(true)}>
                          Mettre en pause — envoyer ce qui est choisi
                        </button>
                      );
                    })()}
                    <button className="formula-picker-cancel" onClick={() =>
                      groupe.etape > 0 ? setGroupe((g) => ({ ...g, etape: g.etape - 1 }))
                                       : setGroupe((g) => ({ ...g, phase: "compo" }))
                    }>← Retour</button>
                  </>
                );
              })()
            )}
          </div>
        </div>
      )}

      {/* Article hors carte */}
      {libreCat && (
        <div className="numpad-overlay" onClick={() => setLibreCat(null)}>
          <div className="formula-picker" onClick={(e) => e.stopPropagation()}>
            <div className="formula-picker-header">
              <div className="formula-picker-title">Autre — {libreCat}</div>
            </div>
            <div className="formula-picker-step-label">Que faut-il écrire ?</div>
            <input
              className="formula-libre-input"
              autoFocus
              value={libreNom}
              placeholder="Désignation"
              onChange={(e) => setLibreNom(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ajouterLibre(); }}
            />
            <div className="formula-picker-step-label">Prix (facultatif)</div>
            <input
              className="formula-libre-input"
              type="text"
              inputMode="decimal"
              value={librePrix}
              placeholder="0,00"
              onChange={(e) => setLibrePrix(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ajouterLibre(); }}
            />
            <button className="formula-picker-confirm" disabled={!libreNom.trim()} onClick={ajouterLibre}>
              Ajouter au panier
            </button>
            <button className="formula-picker-cancel" onClick={() => setLibreCat(null)}>Annuler</button>
          </div>
        </div>
      )}
      {/* Ticket overlay */}
      {showTicket && ticketData && (
        <Ticket
          order={ticketData.items}
          tableNumber={ticketData.table}
          orderNum={ticketData.orderNum}
          orderId={ticketData.orderId}
          orderType={ticketData.orderType}
          emporterNum={ticketData.emporterNum}
          clientName={ticketData.clientName}
          clientPhone={ticketData.clientPhone}
          clientPickupTime={ticketData.clientPickupTime}
          onNewOrder={newOrder}
          editingOrderId={editingOrderId}
          onPrintSuccess={(tcOrderId) => {
            const vercelId = ticketData.orderId;
            // Mettre à jour le state local
            setServerOrders((prev) =>
              prev.map((o) => o.id === vercelId ? { ...o, tcOrderId } : o)
            );
            // Persister tcOrderId dans Vercel
            fetchCommandes(ORDERS_API_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "save", order: { ...ticketData.orderData, tcOrderId } }),
            }).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

export default App;
