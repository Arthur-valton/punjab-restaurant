import express from "express";
import cors from "cors";
import net from "net";
import http from "http";
import fs from "fs";
import { execSync, exec } from "child_process";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Installer le cron de vérification urgente (toutes les 5 min) si absent
exec(
  `crontab -l 2>/dev/null | grep -q check-urgent || ` +
  `(crontab -l 2>/dev/null; echo "*/5 * * * * bash /home/punjab/punjab-restaurant/server/check-urgent.sh >> /tmp/punjab-urgent.log 2>&1") | crontab -`,
  () => {}
);

// Forcer cloudflared en HTTP/2 (TCP) — le routeur restaurant coupe QUIC (UDP) après 60s
exec(
  "grep -q 'protocol http2' /etc/systemd/system/punjab-cloudflared.service 2>/dev/null || " +
  "(sudo sed -i 's|--no-autoupdate tunnel run|--no-autoupdate --protocol http2 tunnel run|' " +
  "/etc/systemd/system/punjab-cloudflared.service && " +
  "sudo systemctl daemon-reload && " +
  "sudo systemctl restart punjab-cloudflared)",
  (err, stdout, stderr) => {
    if (err) console.error("CF protocol fix failed:", stderr || err.message);
    else console.log("cloudflared HTTP/2 OK");
  }
);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/kds-ws" });

const PORT = 3001;
const PRINTER_PORT = 9100;

// Catégories considérées comme "bar" (pas envoyées à la cuisine ni au KDS)
const BAR_CATEGORIES = new Set(["Boissons", "Vin", "Rosé", "Rose", "Apéritifs", "Aperitifs", "Bières", "Bieres", "Bar"]);

// IP imprimante selon le réseau WiFi ou la plage IP locale
const PRINTER_IPS = {
  "popina-new-punjab": "192.168.110.21",
  "Livebox-1720":      "192.168.1.29",
  "Internet":          "192.168.1.29",
};
const IP_RANGE_PRINTER = {
  "192.168.1.":   "192.168.1.29",
  "192.168.110.": "192.168.110.21",
};
const PRINTER_IP_DEFAULT = "192.168.110.21";

function getPrinterIp() {
  try {
    const ssid = execSync("iwgetid -r 2>/dev/null").toString().trim();
    if (ssid && PRINTER_IPS[ssid]) {
      console.log(`WiFi: "${ssid}" → Imprimante: ${PRINTER_IPS[ssid]}`);
      return PRINTER_IPS[ssid];
    }
  } catch {}
  // Fallback : détection par plage IP locale
  try {
    const ifaces = os.networkInterfaces();
    for (const iface of Object.values(ifaces).flat()) {
      if (iface.family === "IPv4" && !iface.internal) {
        for (const [range, ip] of Object.entries(IP_RANGE_PRINTER)) {
          if (iface.address.startsWith(range)) {
            console.log(`Réseau local ${iface.address} → Imprimante: ${ip}`);
            return ip;
          }
        }
      }
    }
  } catch {}
  console.log(`Réseau inconnu → Imprimante: ${PRINTER_IP_DEFAULT}`);
  return PRINTER_IP_DEFAULT;
}

const PRINTER_IP = getPrinterIp();

const WIDTH = 48;
const WIDTH_DOUBLE = 24;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Route /kds → kds.html
app.get("/kds", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "kds.html"));
});

// Route /service → service.html
app.get("/service", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "service.html"));
});

// Route GET /orders → liste les commandes actives
app.get("/orders", (req, res) => {
  res.json([...activeOrders.values()]);
});

// Route PUT /order/:id → modifie et réimprime une commande
app.put("/order/:id", async (req, res) => {
  try {
    const orderId = decodeURIComponent(req.params.id);
    const { order, tableNumber, orderNum, date } = req.body;
    const existing = activeOrders.get(orderId);
    if (!existing) return res.status(404).json({ error: "Commande introuvable" });

    const boissons = order.filter((i) => BAR_CATEGORIES.has(i.category));
    const cuisine = order.filter((i) => !BAR_CATEGORIES.has(i.category));
    const cuisineAll = [...cuisine, ...boissons];
    const common = { tableNumber, orderNum, date };

    const emporterInfo = existing.orderType === "emporter" ? {
      orderType: "emporter",
      emporterNum: existing.emporterNum,
      clientName: existing.clientName,
      clientPhone: existing.clientPhone,
      clientPickupTime: existing.clientPickupTime,
    } : {};

    // Le restaurant echange le papier en cuisine : on reimprime le ticket
    // complet, mais seulement pour les postes dont le contenu a change.
    // On compare a date identique, seuls les articles different donc.
    const info = { ...common, ...emporterInfo };
    const emporter = existing.orderType === "emporter";
    const avant = ticketsDeCommande(existing.items || [], info, emporter);
    const apres = ticketsDeCommande(order, info, emporter);
    const POSTES = emporter ? ["COMMANDE"] : ["CUISINE", "DESSERTS", "BAR"];
    const tickets = apres.map((t, k) => {
      if (t && t !== avant[k]) return t;                    // contenu modifie
      if (!t && avant[k]) return ticketAnnulation(POSTES[k], info);  // poste vide
      return "";                                            // inchange : on n'imprime pas
    });
    // Pas de ticket SERVICE ici : l'addition s'imprime manuellement en fin de service

    const printable = tickets.filter(Boolean);
    if (printable.length > 0) await sendToPrinter(printable.join(""));

    const groups = buildGroups(cuisineAll);
    const catStatus = {};
    groups.forEach((g) => { catStatus[g.cat] = existing.catStatus?.[g.cat] || "waiting"; });

    const updatedOrder = { ...existing, items: cuisineAll, tableNumber, date, catStatus };
    activeOrders.set(orderId, updatedOrder);
    saveOrders(activeOrders);
    broadcast({ type: "update_order", order: updatedOrder });

    console.log(`Modification Table ${tableNumber} #${orderNum}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur modification:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Route POST /order/:id/reprint-bill → réimprime l'addition
app.post("/order/:id/reprint-bill", async (req, res) => {
  try {
    const orderId = decodeURIComponent(req.params.id);
    const order = activeOrders.get(orderId);
    if (!order) return res.status(404).json({ error: "Commande introuvable" });
    const ticket = formatTicket({
      title: "ADDITION",
      order: order.items,
      tableNumber: order.tableNumber,
      orderNum: order.orderNum,
      date: order.date,
      showTotal: true,
      orderType: order.orderType,
      emporterNum: order.emporterNum,
      clientName: order.clientName,
      clientPhone: order.clientPhone,
      clientPickupTime: order.clientPickupTime,
    });
    await sendToPrinter(ticket);
    console.log(`Réimpression addition — Table ${order.tableNumber} #${order.orderNum}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route DELETE /order/:id → supprime une commande
app.delete("/order/:id", (req, res) => {
  const orderId = decodeURIComponent(req.params.id);
  if (activeOrders.has(orderId)) {
    activeOrders.delete(orderId);
    saveOrders(activeOrders);
    broadcast({ type: "order_ready", orderId }); // retire des interfaces
    console.log(`Commande supprimée manuellement : ${orderId}`);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "Commande introuvable" });
  }
});

// ----- ESC/POS helpers -----
const ESC = "\x1B";
const GS = "\x1D";

const CMD = {
  INIT: ESC + "@",
  CENTER: ESC + "a\x01",
  LEFT: ESC + "a\x00",
  BOLD_ON: ESC + "E\x01",
  BOLD_OFF: ESC + "E\x00",
  DOUBLE_ON: GS + "!\x11",
  DOUBLE_H: GS + "!\x01",
  QUAD: GS + "!\x33",
  DOUBLE_OFF: GS + "!\x00",
  REVERSE_ON: GS + "B\x01",
  REVERSE_OFF: GS + "B\x00",
  FEED: ESC + "d\x03",
  CUT: GS + "V\x00",
  PARTIAL_CUT: GS + "V\x01",
};

function normName(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/œ/g, "oe").replace(/Œ/g, "Oe").replace(/æ/g, "ae").replace(/Æ/g, "Ae").toLowerCase();
}

function sanitize(str) {
  if (!str) return str;
  return str
    .replace(/œ/g, "oe").replace(/Œ/g, "Oe").replace(/æ/g, "ae").replace(/Æ/g, "Ae")
    .replace(/[éèëê]/g, "e").replace(/[ÉÈËÊ]/g, "E")
    .replace(/[àâä]/g, "a").replace(/[ÀÂÄ]/g, "A")
    .replace(/[ùûü]/g, "u").replace(/[ÙÛÜ]/g, "U")
    .replace(/[îï]/g, "i").replace(/[ÎÏ]/g, "I")
    .replace(/[ôö]/g, "o").replace(/[ÔÖ]/g, "O")
    .replace(/[çÇ]/g, "c");
}

// Niveaux de piment : 1 = sans (rien affiche), 2 = +, 3 = ++, 4 = +++
const PIMENT_MARKS = { 2: "+", 3: "++", 4: "+++" };
function pimentMark(level) {
  return PIMENT_MARKS[level] || "";
}

// Ligne d'article : le marqueur piment suit directement le nom du plat
function itemLine(label, mark) {
  return mark ? `${label} ${mark}\n` : `${label}\n`;
}

// Deux natures de formule :
//  - formule-MENU (Menu Midi = entree + plat + dessert) : chaque choix part
//    vers un poste different, le nom du menu n'interesse pas la cuisine ;
//  - formule-VARIANTE (Sirop parfum fraise, Lassi mangue, Kir cassis) : le
//    produit c'est l'article lui-meme, le choix n'est qu'une declinaison.
// On n'eclate que la premiere : sinon le bar recoit "1x Mangue" sans savoir
// qu'il s'agit d'un lassi.
function isMenuFormula(item) {
  const choices = item.formulaChoices || [];
  if (choices.length === 0) return false;
  const own = CAT_MERGE_SHARED[item.category] || item.category;
  const cats = choices.map((c) => mapFormulaLabelShared(c.label));
  const toutesConnues = cats.every((c) => Object.values(FORMULA_LABEL_MAP_SHARED).includes(c));
  return toutesConnues && cats.some((c) => c !== own);
}

// Signature des choix : deux declinaisons du meme article ne doivent pas
// fusionner en une seule ligne sur le ticket.
function formulaSig(item) {
  return (item.formulaChoices || []).map((c) => `${c.label}=${c.itemName}=${c.piment || ""}`).join("|");
}

// Un choix peut remplacer le nom du produit : le bouton s'appelle
// "Sirop a l'eau", le choix "Sirop a la menthe", et la ligne du ticket
// affiche directement "Sirop a la menthe".
function nomAffiche(item) {
  const c = (item.formulaChoices || []).find((x) => x.remplaceNom);
  return c ? c.itemName : item.name;
}

// Choix a imprimer : on ecarte ceux qui ont remplace le nom ou leur parent
function choixImprimables(item) {
  const choices = item.formulaChoices || [];
  const remplaces = new Set(choices.map((x) => x.remplaceParent).filter(Boolean));
  return choices.filter((x) => !x.remplaceNom && !remplaces.has(x.label));
}

// Ticket de production : les precisions tiennent sur une seule ligne, a la
// meme taille que l'article. « 1x Coupe de glace 2 boules » puis
// « Vanille / Mangue » se lit d'un coup d'oeil ; des sous-lignes en petit
// caractere avec leurs libelles cassaient la mise en page.
function formulaLineCompacte(item) {
  const c = choixImprimables(item);
  if (c.length === 0) return "";
  return "  " + c.map((x) => {
    const mk = pimentMark(x.piment);
    return sanitize(x.itemName) + (mk ? " " + mk : "");
  }).join(" / ") + "\n";
}

// Sous-lignes detaillees "> Parfum: Fraise" — pour l'addition
function formulaLines(item, indent = "   ") {
  let b = "";
  for (const c of choixImprimables(item)) {
    const cm = pimentMark(c.piment);
    b += `${indent}> ${sanitize(c.label)}: ${sanitize(c.itemName)}${cm ? "  " + cm : ""}\n`;
  }
  return b;
}

function line(char = "-", width = WIDTH) {
  return char.repeat(width) + "\n";
}

// Bande noire pleine largeur : fond inverse, texte blanc centre en double
// taille. Interligne reduit pour eviter la rayure blanche entre les lignes.
const WIDTH_QUAD = 12;

// ---- Pictogramme d'alerte, imprime en mode raster (GS v 0) ----
// Triangle evide avec point d'exclamation, dessine puis encode en bitmap.
function grilleAttention(W, H) {
  const g = Array.from({ length: H }, () => new Array(W).fill(0));
  const dansTriangle = (x, y, ax, ay, bx, by, cx, cy) => {
    const d = (px,py,qx,qy,rx,ry) => (px-rx)*(qy-ry) - (qx-rx)*(py-ry);
    const d1 = d(x,y,ax,ay,bx,by), d2 = d(x,y,bx,by,cx,cy), d3 = d(x,y,cx,cy,ax,ay);
    return !((d1<0||d2<0||d3<0) && (d1>0||d2>0||d3>0));
  };
  const b = Math.round(H * 0.118);                       // epaisseur du trait
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dehors = dansTriangle(x, y, W/2, 2, 2, H-2, W-2, H-2);
    const dedans = dansTriangle(x, y, W/2, 2 + b*1.9, 2 + b*1.5, H-2-b, W-2-b*1.5, H-2-b);
    if (dehors && !dedans) g[y][x] = 1;
  }
  const cx = Math.round(W/2), demi = Math.round(W * 0.05);
  for (let y = Math.round(H*0.40); y <= Math.round(H*0.68); y++)
    for (let x = cx-demi; x <= cx+demi; x++) g[y][x] = 1;
  const py = Math.round(H*0.80), r = Math.round(W * 0.056);
  for (let y = py-r; y <= py+r; y++) for (let x = cx-r; x <= cx+r; x++)
    if ((x-cx)**2 + (y-py)**2 <= r*r) g[y][x] = 1;
  return g;
}

// GS v 0 : m=0, largeur en octets (xL xH), hauteur en lignes (yL yH), puis les
// octets, bit de poids fort a gauche.
function imageRaster(grille) {
  const H = grille.length, W = grille[0].length;
  if (W % 8 !== 0) throw new Error("largeur d'image non multiple de 8");
  const oct = W / 8;
  let data = "";
  for (let y = 0; y < H; y++) {
    for (let o = 0; o < oct; o++) {
      let v = 0;
      for (let bit = 0; bit < 8; bit++) if (grille[y][o*8 + bit]) v |= 0x80 >> bit;
      data += String.fromCharCode(v);
    }
  }
  return GS + "v0" + String.fromCharCode(0)
       + String.fromCharCode(oct & 0xFF, (oct >> 8) & 0xFF)
       + String.fromCharCode(H & 0xFF, (H >> 8) & 0xFF)
       + data;
}

function logoAttention() {
  return CMD.CENTER + imageRaster(grilleAttention(160, 136)) + "\n" + CMD.LEFT;
}

function bandeNoire(texte, taille = "double") {
  const quad = taille === "quad";
  const large = quad ? WIDTH_QUAD : WIDTH_DOUBLE;
  const t = texte.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const centre = t.padStart(Math.floor((large + t.length) / 2)).padEnd(large);
  const epaisseur = quad ? "\x18" : "\x0C";   // marge haute/basse, 24 ou 12 points
  let b = CMD.CENTER + CMD.REVERSE_ON;
  b += ESC + "3" + epaisseur;
  b += " ".repeat(WIDTH) + "\n";
  b += ESC + "2";
  b += (quad ? CMD.QUAD : CMD.DOUBLE_ON) + CMD.BOLD_ON + centre + "\n" + CMD.BOLD_OFF + CMD.DOUBLE_OFF;
  b += ESC + "3" + epaisseur;
  b += " ".repeat(WIDTH) + "\n";
  b += ESC + "2" + CMD.REVERSE_OFF + CMD.LEFT;
  b += "\n";
  return b;
}

function pad(left, right, width = WIDTH, fill = " ") {
  const space = width - left.length - right.length;
  return left + fill.repeat(Math.max(1, space)) + right + "\n";
}

// Bloc d'identification de la commande : TABLE n, ou infos emporter.
// Partage par le ticket de commande et le ticket de modification.
function orderHeader({ orderType, tableNumber, emporterNum, clientName, clientPhone, clientPickupTime, withNumber = true }) {
  let b = CMD.CENTER;
  if (orderType === "emporter") {
    b += CMD.BOLD_ON + CMD.QUAD + "A EMPORTER\n" + CMD.DOUBLE_OFF + CMD.BOLD_OFF;
    // Sur les tickets de production le numero figure deja dans le titre
    if (withNumber) b += CMD.BOLD_ON + CMD.DOUBLE_ON + `#${emporterNum}\n` + CMD.DOUBLE_OFF + CMD.BOLD_OFF;
    // Nom et telephone sur une seule ligne
    const contact = [clientName, clientPhone].filter(Boolean).map(sanitize).join(" - ");
    if (contact) b += CMD.BOLD_ON + contact + "\n" + CMD.BOLD_OFF;
    // Heure de retrait en tres gros : information critique pour l'emporter
    if (clientPickupTime) {
      b += CMD.BOLD_ON + "RETRAIT\n" + CMD.BOLD_OFF;
      b += CMD.BOLD_ON + CMD.QUAD + `${clientPickupTime}\n` + CMD.DOUBLE_OFF + CMD.BOLD_OFF;
    }
  } else {
    b += CMD.BOLD_ON + CMD.QUAD + `TABLE ${tableNumber}\n` + CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  }
  return b + CMD.LEFT;
}

function formatTicket({ title, order, tableNumber, orderNum, date, showTotal, orderType, emporterNum, clientName, clientPhone, clientPickupTime, catFilter }) {
  let buf = "";
  buf += CMD.INIT;
  buf += CMD.CENTER;
  if (showTotal) {
    // Ticket client : en-tete complet
    buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
    buf += "PUNJAB\n";
    buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
    buf += "3 RUE RENE D'ANJOU\n";
    buf += "53200 CHATEAU-GONTIER-SUR-MAYENNE\n";
    buf += "SIRET: 94372706500014\n";
    buf += "APE: 5610A - TVA: FR12943727065\n";
    buf += "\n";
    buf += CMD.BOLD_ON;
    buf += `*** ${title} ***\n`;
    buf += CMD.BOLD_OFF;
  } else {
    // Ticket production : titre + numero en gros.
    // A emporter, on affiche la numerotation du jour (JJ-N) et non le
    // numero interne, pour ne pas avoir deux numeros concurrents.
    const ticketNum = orderType === "emporter" ? emporterNum : orderNum;
    buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
    buf += `${title} #${ticketNum}\n`;
    buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  }
  buf += CMD.LEFT;
  buf += line("=");
  // Le numero figure deja dans le titre des tickets de production
  if (showTotal) buf += `Commande: #${orderNum}\n`;
  buf += orderHeader({ orderType, tableNumber, emporterNum, clientName, clientPhone, clientPickupTime, withNumber: showTotal });
  buf += CMD.LEFT;
  buf += `Date: ${date}\n`;
  buf += line("=");

  // Pour ticket cuisine : eclater les formules-MENU en articles par poste.
  // Les formules-VARIANTE gardent leur article, le choix passe en sous-ligne.
  let itemsToGroup = [];
  if (!showTotal) {
    for (const item of order) {
      if (item.formulaChoices && item.formulaChoices.length > 0) {
        if (isMenuFormula(item)) {
          // Un choix generique remplace par un sous-choix ne part pas en
          // production : le bar recevrait « Jus de fruits » ET « Jus mangue ».
          const remplaces = new Set(item.formulaChoices.map((c) => c.remplaceParent).filter(Boolean));
          for (const choice of item.formulaChoices) {
            if (remplaces.has(choice.label)) continue;
            if (choice.sousChoixDe) continue;   // sort sous son parent, pas seul
            const article = { name: choice.itemName, category: mapFormulaLabelShared(choice.label), qty: item.qty, piment: choice.piment || null };
            // Les precisions rattachees (boules d'une coupe) suivent leur
            // article : imprimees a part, on ne saurait plus a quelle coupe
            // elles appartiennent quand il y en a plusieurs.
            const rattaches = item.formulaChoices.filter((c) => c.sousChoixDe === choice.label);
            if (rattaches.length > 0) article.formulaChoices = rattaches;
            itemsToGroup.push(article);
          }
        } else {
          itemsToGroup.push({ ...item });
        }
      } else if (item.isFormula && item.formulaSteps?.length > 0) {
        // Formule sans choix : afficher le nom + les étapes attendues
        const stepLabels = item.formulaSteps.map(s => s.label).join(" / ");
        itemsToGroup.push({ ...item, name: `${item.name}  [? ${stepLabels}]` });
      } else {
        itemsToGroup.push({...item});
      }
    }
  } else {
    itemsToGroup.push(...order.map(i => ({...i})));
  }

  // Ordre de production en cuisine : naans, entrees, plats, desserts
  // (Biryani fusionné dans Plats). Les boissons ferment le ticket.
  const CAT_ORDER = ["Naans", "Entrees", "Plats", "Desserts", "Menu Midi",
                     "Boissons", "Apéritifs", "Aperitifs", "Vin", "Rosé", "Rose", "Bières", "Bieres", "Bar"];
  const CAT_MERGE = { "Biryani": "Plats", "Entrées": "Entrees", "Entrees": "Entrees" };
  const mergedCat = (item) => CAT_MERGE[item.category] || item.category || "Autres";

  // Filtre de catégorie appliqué APRES eclatement des formules
  // (permet de sortir le dessert d'un menu sur le ticket desserts)
  if (catFilter) itemsToGroup = itemsToGroup.filter((i) => catFilter(mergedCat(i)));
  if (itemsToGroup.length === 0) return "";

  const nbArticles = itemsToGroup.reduce((s, i) => s + i.qty, 0);

  const seenCats = {};
  for (const item of itemsToGroup) {
    const cat = mergedCat(item);
    if (!seenCats[cat]) seenCats[cat] = [];
    // Regroupe sur le marqueur affiche : deux lignes identiques a l'impression
    // fusionnent, mais un plat avec piment reste separe du meme plat sans piment.
    const existing = seenCats[cat].find(x => normName(nomAffiche(x)) === normName(nomAffiche(item))
      && pimentMark(x.piment) === pimentMark(item.piment)
      && formulaSig(x) === formulaSig(item));
    if (existing) existing.qty += item.qty;
    else seenCats[cat].push(item);
  }
  const sortedCats = [...CAT_ORDER.filter(c => seenCats[c]), ...Object.keys(seenCats).filter(c => !CAT_ORDER.includes(c))];
  const groups = sortedCats.map(cat => ({ cat, items: seenCats[cat] }));

  for (const group of groups) {
    // Bande noire de categorie — tickets de production (cuisine / desserts / bar)
    if (!showTotal) buf += bandeNoire(group.cat);

    for (const item of group.items) {
      if (showTotal) {
        const totalStr = `${(item.price * item.qty).toFixed(2)} EUR`;
        const mark = pimentMark(item.piment);
        buf += CMD.BOLD_ON;
        buf += pad(`${item.qty}x ${sanitize(nomAffiche(item))}${mark ? " " + mark : ""}`, totalStr, WIDTH);
        buf += CMD.BOLD_OFF;
        buf += formulaLines(item);
        buf += `   ${item.price.toFixed(2)} EUR/u\n`;
        buf += ESC + "J\x06";
      } else {
        buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
        buf += itemLine(`${item.qty}x ${sanitize(nomAffiche(item))}`, pimentMark(item.piment));
        buf += formulaLineCompacte(item);
        buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
        buf += ESC + "J\x0C";
      }
    }

    if (!showTotal) {
      buf += line("-");
    }
  }

  buf += line("=");

  if (showTotal) {
    const total = order.reduce((s, i) => s + i.price * i.qty, 0);
    buf += CMD.BOLD_ON;
    buf += CMD.DOUBLE_ON;
    buf += pad("TOTAL", `${total.toFixed(2)} EUR`, WIDTH_DOUBLE);
    buf += CMD.DOUBLE_OFF;
    buf += CMD.BOLD_OFF;
    buf += line("=");
    buf += CMD.CENTER;
    buf += "Merci de votre visite !\n";
  } else {
    buf += CMD.CENTER;
    buf += `${nbArticles} article(s)\n`;
  }

  // Bon de reduction sur toutes les additions (sur place et a emporter).
  // Pas de decoupe entre l'addition et le bon, juste une separation nette.
  if (showTotal) buf += couponBlock();

  buf += CMD.FEED;
  buf += CMD.PARTIAL_CUT;
  return buf;
}

// Bon de reduction 10% valable 30 jours, imprime a la suite de l'addition
function couponBlock() {
  const end = new Date();
  end.setDate(end.getDate() + 30);
  const endStr = end.toLocaleDateString("fr-FR");

  let b = "";
  b += ESC + "d\x02";                     // un peu d'air pour detacher a la main
  b += line("*");
  b += CMD.CENTER;
  b += CMD.BOLD_ON + "BON DE REDUCTION\n" + CMD.BOLD_OFF;
  b += CMD.BOLD_ON + CMD.QUAD + "-10%\n" + CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  b += "sur votre prochaine commande\n";
  b += CMD.BOLD_ON + "Valable sur place ou a emporter\n" + CMD.BOLD_OFF;
  b += CMD.BOLD_ON + CMD.DOUBLE_ON + `Jusqu'au ${endStr}\n` + CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  b += "A presenter avant le paiement\n";
  b += CMD.BOLD_ON + "Ticket entier exige : addition + bon\n" + CMD.BOLD_OFF;
  b += CMD.BOLD_ON + "Non cumulable\n" + CMD.BOLD_OFF;
  b += CMD.LEFT;
  b += line("*");
  return b;
}

function formatModifTicket({ title, oldItems, newItems, tableNumber, orderNum, date, showTotal, orderType, emporterNum, clientName, clientPhone, clientPickupTime }) {
  // Clé unique par item : cartId si présent (formules), sinon id
  const itemKey = (i) => i.cartId || String(i.id);
  const oldMap = new Map((oldItems || []).map((i) => [itemKey(i), i]));
  const newMap = new Map((newItems || []).map((i) => [itemKey(i), i]));
  const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);

  const added = [], removed = [];
  for (const key of allKeys) {
    const oldQty = oldMap.get(key)?.qty || 0;
    const newQty = newMap.get(key)?.qty || 0;
    const delta = newQty - oldQty;
    const item = newMap.get(key) || oldMap.get(key);
    if (delta > 0) added.push({ ...item, qty: delta });
    else if (delta < 0) removed.push({ ...item, qty: -delta });
  }

  // Rien a montrer sur ce perimetre (ex : commande sans dessert) -> pas de ticket
  if (newItems.length === 0 && added.length === 0 && removed.length === 0) return "";

  let buf = "";
  buf += CMD.INIT;
  // Un ticket de modification arrive au milieu d'un service deja lance :
  // il doit se distinguer immediatement d'une commande neuve.
  if (!showTotal) buf += logoAttention() + bandeNoire("Attention", "quad");
  buf += CMD.CENTER;
  if (showTotal) {
    buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
    buf += "PUNJAB\n";
    buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
    buf += "\n";
    buf += CMD.BOLD_ON;
    buf += `*** ${title} ***\n`;
    buf += CMD.BOLD_OFF;
  } else {
    const ticketNum = orderType === "emporter" ? emporterNum : orderNum;
    buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
    buf += `${title} #${ticketNum}\n`;
    buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  }
  buf += CMD.LEFT;
  buf += line("=");
  if (showTotal) buf += `Commande: #${orderNum}\n`;
  buf += orderHeader({ orderType, tableNumber, emporterNum, clientName, clientPhone, clientPickupTime, withNumber: showTotal });
  buf += `Date: ${date}\n`;
  buf += line("=");

  // ── Section MODIFICATIONS ──
  if (added.length > 0 || removed.length > 0) {
    // Deux blocs nettement separes : ce qui arrive, ce qui part. Des
    // prefixes ++ / -- se confondraient avec les marqueurs de piment.
    if (added.length > 0) {
      buf += bandeNoire("Ajouts");
      for (const item of added) {
        buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
        buf += itemLine(`${item.qty}x ${sanitize(nomAffiche(item))}`, pimentMark(item.piment));
        buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
        buf += CMD.BOLD_ON + formulaLines(item) + CMD.BOLD_OFF;
      }
    }
    if (removed.length > 0) {
      if (added.length > 0) buf += line("=");   // separe nettement les deux blocs
      buf += bandeNoire("Annules");
      for (const item of removed) {
        buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
        buf += itemLine(`${item.qty}x ${sanitize(nomAffiche(item))}`, pimentMark(item.piment));
        buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
        buf += formulaLines(item);
      }
    }
    buf += line("=");
  }

  // ── Section COMMANDE COMPLÈTE ──
  buf += bandeNoire("Commande complete");

  for (const item of newItems) {
    const mark = pimentMark(item.piment);
    if (showTotal) {
      const totalStr = `${(item.price * item.qty).toFixed(2)} EUR`;
      buf += CMD.BOLD_ON;
      buf += pad(`${item.qty}x ${sanitize(nomAffiche(item))}${mark ? " " + mark : ""}`, totalStr, WIDTH);
      buf += CMD.BOLD_OFF;
      buf += formulaLines(item);
      buf += `   ${item.price.toFixed(2)} EUR/u\n`;
    } else {
      buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
      buf += itemLine(`${item.qty}x ${sanitize(nomAffiche(item))}`, mark);
      buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
      buf += CMD.BOLD_ON + formulaLines(item, "  ") + CMD.BOLD_OFF;
    }
  }

  buf += line("=");
  if (showTotal) {
    const total = newItems.reduce((s, i) => s + i.price * i.qty, 0);
    buf += CMD.BOLD_ON + CMD.DOUBLE_ON;
    buf += pad("TOTAL", `${total.toFixed(2)} EUR`, WIDTH_DOUBLE);
    buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF + line("=");
  } else {
    const totalQty = newItems.reduce((s, i) => s + i.qty, 0);
    buf += CMD.CENTER + `${totalQty} article(s)\n`;
  }

  buf += CMD.FEED + CMD.PARTIAL_CUT;
  return buf;
}

function sendToPrinter(data) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error("Timeout: imprimante injoignable"));
    }, 5000);

    client.connect(PRINTER_PORT, PRINTER_IP, () => {
      client.write(data, "binary", () => {
        clearTimeout(timeout);
        client.end();
        resolve();
      });
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      client.destroy();
      reject(err);
    });
  });
}

// ----- Stockage des commandes en cours (avec persistance fichier) -----
const ORDERS_FILE = path.join(__dirname, "active-orders.json");

function loadOrders() {
  try {
    const data = fs.readFileSync(ORDERS_FILE, "utf8");
    const arr = JSON.parse(data);
    const maxAge = 12 * 60 * 60 * 1000; // 12h
    const now = Date.now();
    const active = arr.filter((o) => {
      // Supprimer si trop vieux
      if (o.receivedAt && now - o.receivedAt > maxAge) return false;
      // Supprimer si toutes catégories terminées
      if (o.catStatus) {
        const statuses = Object.values(o.catStatus);
        if (statuses.length > 0 && statuses.every(s => s === "done" || s === "delivered")) return false;
      }
      return true;
    });
    return new Map(active.map((o) => [o.id, o]));
  } catch {
    return new Map();
  }
}

function saveOrders(map) {
  const tmp = ORDERS_FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify([...map.values()]), "utf8");
    fs.renameSync(tmp, ORDERS_FILE);
  } catch (err) {
    console.error("Erreur sauvegarde commandes:", err.message);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

const activeOrders = loadOrders();
console.log(`${activeOrders.size} commande(s) en cours chargée(s)`);


// ----- Ticket partiel "SECTION PRÊTE" -----
function formatPartialReadyTicket({ tableNumber, orderNum, catName, items, orderType, emporterNum }) {
  const date = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  let buf = "";
  buf += CMD.INIT;
  buf += CMD.CENTER;
  buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
  buf += "PUNJAB\n";
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  buf += "\n";
  buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
  buf += orderType === "emporter" ? "A EMPORTER\n" : `${catName.toUpperCase()}\n`;
  buf += "PRET !\n";
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  buf += CMD.LEFT;
  buf += line("=");
  buf += CMD.CENTER + CMD.BOLD_ON + CMD.QUAD;
  if (orderType === "emporter") {
    buf += `#${emporterNum || tableNumber}\n`;
  } else {
    buf += `TABLE ${tableNumber}\n`;
  }
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF + CMD.LEFT;
  buf += `Commande: #${orderNum}\n`;
  buf += `Date: ${date}\n`;
  buf += line("=");
  for (const item of items) {
    buf += CMD.DOUBLE_H + CMD.BOLD_ON;
    buf += `${item.qty}x ${sanitize(item.name)}
`;
    buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
    buf += ESC + "J\x0C";
  }
  buf += line("=");
  buf += CMD.CENTER;
  buf += "Pret a servir !\n";
  buf += CMD.FEED;
  buf += CMD.PARTIAL_CUT;
  return buf;
}

// ----- Helpers catégories (partagés) -----
const CAT_ORDER_SHARED = ["Naans", "Entrees", "Plats", "Desserts", "Boissons", "Vin", "Rosé", "Apéritifs", "Menu Midi", "Menu Rajasthan", "Menu Taj Mahal"];
const CAT_MERGE_SHARED = { "Biryani": "Plats", "Entrées": "Entrees", "Entrees": "Entrees" };

const FORMULA_LABEL_MAP_SHARED = {
  "entree": "Entrees", "entrees": "Entrees",
  "plat": "Plats", "plats": "Plats",
  "dessert": "Desserts", "desserts": "Desserts",
  "naan": "Naans", "naans": "Naans",
  // Tout ce qui se sert au bar part sur le ticket BAR
  "boisson": "Boissons", "boissons": "Boissons",
  "aperitif": "Boissons", "aperitifs": "Boissons",
  "pichet": "Boissons", "pichet a vin": "Boissons",
  // Les boules d'une coupe partent au poste desserts
  "boule": "Desserts", "boules": "Desserts",
  "jus": "Boissons", "kir": "Boissons",
};
function mapFormulaLabelShared(label) {
  let key = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Menus pour plusieurs convives : « Plat pers. 1 » vise le meme poste que
  // « Plat ». On retire les suffixes de rang et de convive avant de router —
  // en boucle, car « Boule 1 pers. 1 » en cumule deux.
  let avant;
  do {
    avant = key;
    key = key.replace(/\s*(pers\.?|personne)?\s*\d+\s*$/, "").trim();
  } while (key !== avant);
  return FORMULA_LABEL_MAP_SHARED[key] || label;
}

function buildGroups(items) {
  const seen = {};
  for (const item of items) {
    // Meme distinction que sur les tickets : seules les formules-MENU sont
    // eclatees. Sinon le KDS afficherait une categorie "Parfum" pour un sirop.
    if (item.formulaChoices && item.formulaChoices.length > 0 && isMenuFormula(item)) {
      for (const choice of item.formulaChoices) {
        const cat = mapFormulaLabelShared(choice.label);
        const merged = CAT_MERGE_SHARED[cat] || cat;
        if (!seen[merged]) seen[merged] = [];
        const existing = seen[merged].find(x => normName(x.name) === normName(choice.itemName) && (x.piment || null) === (choice.piment || null));
        if (existing) existing.qty += item.qty;
        else seen[merged].push({ name: choice.itemName, category: merged, qty: item.qty, piment: choice.piment || null });
      }
    } else {
      const cat = CAT_MERGE_SHARED[item.category] || item.category || "Autres";
      if (!seen[cat]) seen[cat] = [];
      const nom = nomAffiche(item);
      const existing = seen[cat].find(x => normName(nomAffiche(x)) === normName(nom)
        && (x.piment || null) === (item.piment || null)
        && formulaSig(x) === formulaSig(item));
      if (existing) existing.qty += item.qty;
      else seen[cat].push({ ...item, name: nom });
    }
  }
  const sorted = [...CAT_ORDER_SHARED.filter(c => seen[c]), ...Object.keys(seen).filter(c => !CAT_ORDER_SHARED.includes(c))];
  return sorted.map(cat => ({ cat, items: seen[cat] }));
}

// ----- WebSocket KDS + Service -----
function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

// Ping toutes les 20s pour garder les connexions Cloudflare actives
setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({ type: "ping" }));
    }
  });
}, 20000);

wss.on("connection", (ws) => {
  console.log("Client connecté (KDS/Service)");
  // Envoyer toutes les commandes actives au nouveau client
  if (activeOrders.size > 0) {
    activeOrders.forEach((order) => {
      ws.send(JSON.stringify({ type: "new_order", order }));
    });
  }

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw);

      // Service → demande une catégorie
      if (msg.type === "service_call") {
        const order = activeOrders.get(msg.orderId);
        if (order && order.catStatus && order.catStatus[msg.catName] === "waiting") {
          order.catStatus[msg.catName] = "called";
          if (!order.catCalledAt) order.catCalledAt = {};
          order.catCalledAt[msg.catName] = Date.now();
          saveOrders(activeOrders);
          broadcast({ type: "cat_status", orderId: msg.orderId, catName: msg.catName, status: "called", calledAt: order.catCalledAt[msg.catName] });
          console.log(`Service demande ${msg.catName} — Table ${order.tableNumber}`);
        }
      }

      // Cuisine → prend en charge
      if (msg.type === "cat_in_progress") {
        const order = activeOrders.get(msg.orderId);
        if (order && order.catStatus) {
          order.catStatus[msg.catName] = "in_progress";
          saveOrders(activeOrders);
          broadcast({ type: "cat_status", orderId: msg.orderId, catName: msg.catName, status: "in_progress" });
          console.log(`Cuisine en cours ${msg.catName} — Table ${order.tableNumber}`);
        }
      }

      // Cuisine → prêt → imprime ticket
      if (msg.type === "cat_ready") {
        const order = activeOrders.get(msg.orderId);
        if (order && order.catStatus) {
          order.catStatus[msg.catName] = "done";
          if (!order.catReadyAt) order.catReadyAt = {};
          order.catReadyAt[msg.catName] = Date.now();
          saveOrders(activeOrders);
          broadcast({ type: "cat_status", orderId: msg.orderId, catName: msg.catName, status: "done", readyAt: order.catReadyAt[msg.catName] });
        }
        try {
          await sendToPrinter(formatPartialReadyTicket({
            ...msg,
            orderType: order?.orderType,
            emporterNum: order?.emporterNum,
          }));
          console.log(`Ticket ${msg.catName} PRÊT — Table ${msg.tableNumber} #${msg.orderNum}`);
        } catch (err) {
          console.error("Erreur impression ticket partiel:", err.message);
        }
      }

      // Service → confirme livraison
      if (msg.type === "cat_delivered") {
        const order = activeOrders.get(msg.orderId);
        if (order && order.catStatus) {
          order.catStatus[msg.catName] = "delivered";
          saveOrders(activeOrders);
          broadcast({ type: "cat_status", orderId: msg.orderId, catName: msg.catName, status: "delivered" });
          console.log(`Service livré ${msg.catName} — Table ${order.tableNumber}`);
        }
      }

      // Toutes catégories prêtes → supprimer la commande du serveur
      if (msg.type === "order_ready") {
        broadcast({ type: "order_ready", orderId: msg.orderId });
        const order = activeOrders.get(msg.orderId);
        if (order) {
          activeOrders.delete(msg.orderId);
          saveOrders(activeOrders);
          console.log(`Commande terminée — Table ${order.tableNumber} #${order.orderNum}`);
        }
      }

    } catch (err) {
      console.error("WS message error:", err.message);
    }
  });
  ws.on("close", () => console.log("Client déconnecté"));
});

// ----- Route POST /print-all -----
// Un poste vide de tout article apres modification : sans ce mot, la cuisine
// garderait son ancien papier et preparerait des plats annules.
function ticketAnnulation(titre, common) {
  let b = CMD.INIT + CMD.CENTER;
  b += CMD.DOUBLE_ON + CMD.BOLD_ON + `${titre} #${common.orderType === "emporter" ? common.emporterNum : common.orderNum}\n`;
  b += CMD.DOUBLE_OFF + CMD.BOLD_OFF + CMD.LEFT + line("=");
  b += orderHeader({ ...common, withNumber: false });
  b += `Date: ${common.date}\n` + line("=");
  b += bandeNoire("Rien a preparer");
  b += CMD.CENTER + CMD.BOLD_ON + "Tous les articles de ce poste\n";
  b += "ont ete retires de la commande.\n" + CMD.BOLD_OFF + CMD.LEFT;
  b += line("=") + CMD.FEED + CMD.PARTIAL_CUT;
  return b;
}

// Tickets de production d'une commande. Sert aussi bien a la prise de
// commande qu'a la modification : le restaurant veut alors le ticket complet
// remis a jour, pas un differentiel.
function ticketsDeCommande(order, common, isEmporter, suffixe = "") {
  if (isEmporter) {
    // A emporter : cuisine, desserts et bar sur un SEUL ticket,
    // separes par les bandes noires de categorie.
    return [formatTicket({ title: "COMMANDE" + suffixe, order, showTotal: false, ...common })];
  }
  // La commande entiere est passee aux trois tickets : c'est le filtre,
  // applique APRES eclatement des formules, qui aiguille chaque article.
  // Trier sur la categorie de l'article laisserait l'aperitif d'un menu
  // (categorie « Menu ») partir en cuisine au lieu du bar.
  const estBar = (c) => BAR_CATEGORIES.has(c);
  return [
    formatTicket({ title: "CUISINE" + suffixe, order, showTotal: false,
      catFilter: (c) => !estBar(c) && c !== "Desserts", ...common }),
    formatTicket({ title: "DESSERTS" + suffixe, order, showTotal: false,
      catFilter: (c) => c === "Desserts", ...common }),
    formatTicket({ title: "BAR" + suffixe, order, showTotal: false,
      catFilter: estBar, ...common }),
  ];
}

app.post("/print-all", async (req, res) => {
  try {
    const { order, tableNumber, orderNum, date, orderId: clientOrderId,
            orderType, emporterNum, clientName, clientPhone, clientPickupTime } = req.body;

    const isEmporter = orderType === "emporter";
    const effectiveTable = isEmporter ? emporterNum : tableNumber;

    if (!order || !effectiveTable || !orderNum) {
      return res.status(400).json({ error: "Donnees manquantes" });
    }

    // Log des formules pour diagnostic
    const formulaItems = order.filter(i => i.isFormula);
    if (formulaItems.length > 0) {
      formulaItems.forEach(i => {
        console.log(`Formule "${i.name}" — formulaChoices: ${i.formulaChoices ? JSON.stringify(i.formulaChoices) : "null/vide"}`);
      });
    }

    const boissons = order.filter((i) => BAR_CATEGORIES.has(i.category));
    const cuisine = order.filter((i) => !BAR_CATEGORIES.has(i.category));
    const common = { tableNumber: effectiveTable, orderNum, date, orderType, emporterNum, clientName, clientPhone, clientPickupTime };
    const tickets = [];

    tickets.push(...ticketsDeCommande(order, common, isEmporter));
    // Pas de ticket SERVICE ici : l'addition s'imprime manuellement en fin de service

    // formatTicket renvoie "" si le filtre ne laisse aucun article
    const printable = tickets.filter(Boolean);

    console.log(`Impression ${isEmporter ? `Emporter #${emporterNum}` : `Table ${effectiveTable}`} #${orderNum} : ${printable.length} ticket(s)`);
    if (printable.length > 0) await sendToPrinter(printable.join(""));

    // Broadcast au KDS + stockage en mémoire
    const orderId = clientOrderId || `${orderNum}-${Date.now()}`;
    const cuisineAll = [...cuisine, ...boissons];
    let catStatus;
    if (isEmporter) {
      catStatus = { "A emporter": "waiting" };
    } else {
      const groups = buildGroups(cuisineAll);
      catStatus = {};
      groups.forEach(g => { catStatus[g.cat] = "waiting"; });
    }
    const orderData = {
      id: orderId, orderNum, tableNumber: effectiveTable, date,
      items: cuisineAll, receivedAt: Date.now(), catStatus,
      orderType, emporterNum, clientName, clientPhone, clientPickupTime,
    };
    activeOrders.set(orderId, orderData);
    saveOrders(activeOrders);
    broadcast({ type: "new_order", order: orderData });

    res.json({ success: true, message: `${printable.length} ticket(s) imprime(s)`, tickets: printable.length, orderId });
  } catch (err) {
    console.error("Erreur impression:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/print", async (req, res) => {
  try {
    const { type, order, tableNumber, orderNum, date } = req.body;
    if (!order || !tableNumber || !orderNum) {
      return res.status(400).json({ error: "Donnees manquantes" });
    }
    const title = type === "cuisine" ? "CUISINE" : "SERVICE";
    const showTotal = type !== "cuisine";
    const ticket = formatTicket({ title, order, tableNumber, orderNum, date, showTotal });
    console.log(`Impression ${type} - Table ${tableNumber} - #${orderNum}`);
    await sendToPrinter(ticket);
    res.json({ success: true, message: "Ticket imprime" });
  } catch (err) {
    console.error("Erreur impression:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/ping-printer", async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      const client = new net.Socket();
      const timeout = setTimeout(() => { client.destroy(); reject(new Error("Timeout")); }, 3000);
      client.connect(PRINTER_PORT, PRINTER_IP, () => { clearTimeout(timeout); client.end(); resolve(); });
      client.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });
    res.json({ success: true, printer: `${PRINTER_IP}:${PRINTER_PORT}` });
  } catch {
    res.status(500).json({ success: false, error: "Imprimante injoignable", printer: `${PRINTER_IP}:${PRINTER_PORT}` });
  }
});

app.post("/admin/stop-tunnel", (req, res) => {
  exec("pkill -f cloudflared", (err) => {
    res.json({ success: true, message: "Tunnel arrêté" });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur d'impression sur http://0.0.0.0:${PORT}`);
  console.log(`KDS disponible sur http://0.0.0.0:${PORT}/kds.html`);
  console.log(`Imprimante cible: ${PRINTER_IP}:${PRINTER_PORT}`);
});
