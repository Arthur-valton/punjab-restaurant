import { useState, useMemo, useEffect } from "react";
import defaultMenu from "./data/menu";
import Ticket from "./components/Ticket";
import MenuSettings from "./components/MenuSettings";
import PasswordGate, { isAppUnlocked, unlockApp, getDefaultPasswords } from "./components/PasswordGate";
import "./App.css";

const GET_MENU_URL = "https://punjab-restaurant.vercel.app/api/get-menu";
const ORDERS_API_URL = "https://punjab-restaurant.vercel.app/api/orders";

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
      fetch(ORDERS_API_URL)
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
  const [formulaPicker, setFormulaPicker] = useState(null); // { item, currentStep, choices } | null

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

  // Ajoute une formule au panier. Deux sélections identiques se regroupent
  // sur une seule ligne, comme un article normal.
  function addFormula(item, choices) {
    const sig = choices.map((c) => `${c.label}:${c.itemName}${c.piment || ""}`).join("|");
    const cartId = `${item.id}-f${sig}`;
    // Un choix peut porter son propre tarif : il remplace celui du produit
    const prix = choices.find((c) => c.prix != null)?.prix;
    setOrderItems((prev) => {
      const existing = prev.find((i) => i.cartId === cartId);
      if (existing) return prev.map((i) => (i.cartId === cartId ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { ...item, cartId, qty: 1, formulaChoices: choices,
                         ...(prix != null ? { price: prix } : {}) }];
    });
    setFormulaPicker(null);
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
        setFormulaPicker({ item, currentStep, choices: newChoices, parcours, showSummary: true });
      }
    } else {
      setFormulaPicker({ item, currentStep: suivante, choices: newChoices, parcours });
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
    let maxN = 0;
    for (const o of serverOrders) {
      if (o.orderType === "emporter" && o.emporterNum) {
        const parts = String(o.emporterNum).split("-").map(Number);
        if (parts.length === 2 && parts[0] === day && parts[1] > maxN) maxN = parts[1];
      }
    }
    return `${day}-${maxN + 1}`;
  }

  function validateOrder() {
    setShowOrderTypeModal(true);
    setCartOpen(false);
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
    fetch(ORDERS_API_URL, {
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

  async function reprintBill(orderId) {
    await fetch(`${getPrintUrl()}/order/${encodeURIComponent(orderId)}/reprint-bill`, { method: "POST" });
  }

  async function closeTable(orderId) {
    // Supprimer de Vercel (source de vérité)
    fetch(ORDERS_API_URL, {
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
      cartId: i.cartId || (i.formulaChoices ? `${i.id}-f${Date.now() + Math.random()}` : (i.piment ? `${i.id}-p${i.piment}` : String(i.id))),
    }));
    setOrderItems(items);
    setTableNumber(serverOrder.tableNumber);
    setEditingOrderId(serverOrder.id);
    setShowOrders(false);
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
          <div className="menu-grid-items">
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

            {formulaPicker.pendingArticle ? (
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
                              className="formula-picker-item-btn"
                              onClick={() => {
                                if (hasPiment) {
                                  setFormulaPicker({ ...formulaPicker, pendingArticle: name, pendingPrix: prix });
                                } else {
                                  pickFormulaItem(name, null, prix);
                                }
                              }}
                            >
                              {name}
                              {prix != null && <span className="formula-picker-price">{prix.toFixed(2)} €</span>}
                            </button>
                          );
                        })
                      : <p className="formula-picker-empty">Aucun article configuré pour cette étape</p>;
                  })()}
                </div>
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
                  <div className="orders-panel-items">
                    {o.items.slice(0, 4).map((item, i) => (
                      <span key={i} className="orders-panel-tag">{item.qty}× {item.name}</span>
                    ))}
                    {o.items.length > 4 && <span className="orders-panel-tag">+{o.items.length - 4}</span>}
                  </div>
                  <div className="orders-panel-actions">
                    <button className="orders-panel-edit-btn" onClick={() => loadOrderForEdit(o)}>Modifier</button>
                    <button className="orders-panel-bill-btn" onClick={() => reprintBill(o.id)}>Addition</button>
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
            fetch(ORDERS_API_URL, {
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
