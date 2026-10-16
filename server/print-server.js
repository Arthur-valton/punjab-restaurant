import express from "express";
import cors from "cors";
import net from "net";
import http from "http";
import fs from "fs";
import crypto from "crypto";
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
const BAR_CATEGORIES = new Set(["Boissons", "Vins", "Vin", "Rosé", "Rose", "Apéritifs", "Aperitifs", "Bières", "Bieres", "Bar"]);

// Section du ticket choisie dans l'admin pour la categorie d'un article
// (champ « poste » pose par la caisse). Absent ou inconnu : on garde les
// regles ci-dessus, inchangees. Une categorie creee dans l'admin (« Crapaud »)
// peut ainsi sortir avec les entrees ou au bar sans toucher a ce fichier.
const POSTES_ADMIN = new Set(["Naans", "Entrees", "Plats", "Desserts", "Boissons"]);
function posteAdmin(item) {
  return item && POSTES_ADMIN.has(item.poste) ? item.poste : null;
}
function estBarArticle(item) {
  const p = posteAdmin(item);
  return p ? p === "Boissons" : BAR_CATEGORIES.has(item.category);
}

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

// Mode essai : on peut derouler toute la prise de commande sans qu'une
// seule ligne n'atteigne l'imprimante du restaurant. Le ticket est decode
// et affiche dans le terminal a la place.
const DRY_RUN = process.env.PUNJAB_DRY_RUN === "1";

// Rend lisible un flux ESC/POS : un seul passage, en suivant l'etat de
// l'imprimante (taille, video inverse) plutot que ligne par ligne.
function apercuTicket(data) {
  const SIZES = { 0x00: "", 0x11: "DOUBLE", 0x33: "QUAD", 0x22: "TRIPLE" };
  let taille = "", inverse = false, gras = false;
  const lignes = [];
  let courant = "", marque = "";
  const pousser = () => {
    if (courant.trim() || marque) lignes.push(("   " + marque + courant).trimEnd());
    courant = ""; marque = "";
  };
  const etiquette = () => {
    const e = [inverse ? "NOIR" : null, taille || null].filter(Boolean);
    return e.length ? "[" + e.join(" ") + "] " : "";
  };
  for (let i = 0; i < data.length; i++) {
    const c = data[i], o = data.charCodeAt(i);
    if (o === 0x1d) {                       // GS
      const cmd = data[i + 1];
      if (cmd === "!") { taille = SIZES[data.charCodeAt(i + 2)] ?? "?"; i += 2; }
      else if (cmd === "B") { inverse = data.charCodeAt(i + 2) !== 0; i += 2; }
      else if (cmd === "V") { pousser(); lignes.push("   --- COUPE ---"); i += 2 + (data.charCodeAt(i + 2) === 0x42 ? 1 : 0); }
      else i += 1;
      if (!courant.trim()) marque = etiquette();
      continue;
    }
    if (o === 0x1b) {                       // ESC
      const cmd = data[i + 1];
      // ESC @ et ESC 2 ne font que deux octets ; les autres en font trois.
      // En avaler un de trop decale tout le flux et orpheline la commande
      // suivante (on voyait « ! » et « B » trainer dans l'apercu).
      if (cmd === "@" || cmd === "2") { i += 1; }
      else if (cmd === "E") { gras = data.charCodeAt(i + 2) !== 0; i += 2; }
      else i += 2;
      continue;
    }
    if (c === "\n") { pousser(); continue; }
    if (o < 0x20) continue;                 // autres caracteres de controle
    if (!courant && !marque) marque = etiquette();
    courant += c;
  }
  pousser();
  // Une bande noire est faite de deux lignes pleines autour du titre :
  // on les remplace par un trait, plus lisible qu'une ligne d'espaces.
  return lignes
    .map((l) => (/^\s*\[NOIR[^\]]*\]\s*$/.test(l) ? "   [NOIR] " + "█".repeat(40) : l))
    .join("\n");
}

function getPrinterIp() {
  if (DRY_RUN) {
    console.log("MODE ESSAI — aucune impression reelle");
    return "(mode essai)";
  }
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
// 1 Mo : une modification envoie la commande ET sa version d'avant ; avec les
// questions des menus, une grande table depassait les 100 Ko par defaut (erreur 413)
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

// Route /kds → kds.html
app.get("/kds", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "kds.html"));
});

// Route /service → service.html
// L'ecran service ouvre la caisse d'essai (et pas celle de production)
// quand ce serveur tourne en essai
// « notes: true » : la caisse ne propose la note sur un article qu'a un serveur
// qui sait l'imprimer — un serveur pas a jour ne perd ainsi jamais de note
app.get("/mode", (req, res) => {
  res.json({ essai: DRY_RUN, notes: true });
});

// Version des ecrans (cuisine, bar, salle) : empreinte des pages et du serveur,
// calculee au demarrage. Un ecran reste ouvert sur l'ancienne version la voit
// changer apres une mise a jour et affiche « Nouvelle mise a jour » ; il ne se
// recharge jamais seul. En essai, le fichier .version.local (a la racine du
// projet, ignore par git) simule une mise a jour sans redemarrer.
const VERSION_ECRANS = crypto.createHash("sha1")
  .update(["kds.html", "service.html", "print-server.js"].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n"))
  .digest("hex").slice(0, 12);
app.get("/version", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  let essai = "";
  if (DRY_RUN) {
    try { essai = fs.readFileSync(path.join(__dirname, "..", ".version.local"), "utf8").trim(); } catch { /* pas de demonstration */ }
  }
  res.json({ version: essai ? `${VERSION_ECRANS}-${essai}` : VERSION_ECRANS });
});

// Ecrans de poste : la meme page que l'ecran cuisine, filtree d'apres l'adresse
for (const poste of ["/cuisine", "/desserts", "/bar"]) {
  app.get(poste, (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.sendFile(path.join(__dirname, "kds.html"));
  });
}

app.get("/service", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "service.html"));
});

// ----- Ecran client (vue client de la caisse) -----
// Un ecran tourne vers le client : des videos quand personne ne l'utilise,
// l'addition de la table des que la caisse l'ouvre, et en addition separee
// seulement ce que la personne est en train de payer. La caisse envoie l'etat
// (POST /ecran-client), le serveur le garde et le diffuse a l'ecran (WebSocket).
const DOSSIER_VIDEOS = path.join(__dirname, "videos");
let etatEcranClient = { etat: "repos" };

app.get("/client", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "client.html"));
});
app.get("/ecran-client", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(etatEcranClient);
});
app.post("/ecran-client", (req, res) => {
  const b = req.body || {};
  etatEcranClient = b.etat === "addition" ? { ...b, depuis: Date.now() } : { etat: "repos", depuis: Date.now() };
  broadcast({ type: "ecran_client", ...etatEcranClient });
  res.json({ success: true });
});
// Videos diffusees au repos : tous les .mp4 / .webm / .mov du dossier
// server/videos (ordre alphabetique), puis les liens YouTube du fichier
// server/videos/youtube.txt (un lien par ligne, # pour un commentaire),
// lus par le lecteur officiel de YouTube : rien n'est telecharge.
function idYoutube(lien) {
  const m = String(lien).match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/) || String(lien).match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}
app.get("/videos-client", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  let fichiers = [];
  let youtube = [];
  try {
    fichiers = fs.readdirSync(DOSSIER_VIDEOS).filter((f) => /\.(mp4|webm|mov|m4v)$/i.test(f)).sort();
  } catch { /* pas encore de dossier : l'ecran affiche l'accueil */ }
  try {
    youtube = fs.readFileSync(path.join(DOSSIER_VIDEOS, "youtube.txt"), "utf8").split("\n")
      .map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map(idYoutube).filter(Boolean);
  } catch { /* pas de liens YouTube */ }
  res.json({ videos: fichiers.map((f) => `/videos/${encodeURIComponent(f)}`), youtube });
});
app.use("/videos", express.static(DOSSIER_VIDEOS, { maxAge: "1h" }));

// Route GET /orders → liste les commandes actives
app.get("/orders", (req, res) => {
  res.json([...activeOrders.values()]);
});

// Route PUT /order/:id → modifie et réimprime une commande
// Ordre neutre des articles : on compare le CONTENU d'un poste, pas l'ordre du
// panier (un article retire puis remis, un menu avant une boisson...)
function cleArticle(i) {
  const cle = [i.category, i.poste, i.name, i.qty, i.piment, i.formulaChoices];
  // Note et allergie seulement si presentes : un article sans note garde sa cle
  if (i.note || i.allergie) cle.push(i.note || "", i.allergie || "");
  return JSON.stringify(cle);
}
function ordreNeutre(items) {
  return [...(items || [])].sort((a, b) => (cleArticle(a) < cleArticle(b) ? -1 : cleArticle(a) > cleArticle(b) ? 1 : 0));
}
// Signature d'une section de l'ecran cuisine, pour savoir si elle a change
// (une note ou une allergie ajoutee, changee ou retiree la remet « a faire »)
function signatureGroupe(g) {
  return JSON.stringify((g.items || []).map((i) => {
    const sig = [normName(i.name), i.qty, i.piment || null, i.detail || ""];
    if (i.note || i.allergie) sig.push(normName(i.note), normName(i.allergie));
    return JSON.stringify(sig);
  }).sort());
}

app.put("/order/:id", async (req, res) => {
  try {
    const orderId = decodeURIComponent(req.params.id);
    const b = req.body || {};
    const { order, tableNumber, date } = b;
    let existing = activeOrders.get(orderId);
    // La cuisine a tout marque pret : le serveur a oublie la commande. La caisse
    // envoie alors la version d'avant (« avant ») et on compare quand meme :
    // sans cela les trois tickets ressortaient comme une nouvelle commande.
    const reconstituee = !existing && Array.isArray(b.avant?.items);
    if (reconstituee) {
      const av = b.avant;
      existing = {
        id: orderId, items: av.items, orderNum: av.orderNum ?? b.orderNum,
        tableNumber: av.tableNumber ?? tableNumber, date: av.dateOrigine || date, dateOrigine: av.dateOrigine || date,
        receivedAt: Date.now(), orderType: b.orderType, emporterNum: b.emporterNum,
        clientName: av.clientName, clientPhone: av.clientPhone, clientPickupTime: av.clientPickupTime,
        catStatus: {},
      };
    }
    if (!existing) return res.status(404).json({ error: "Commande introuvable" });
    if (!Array.isArray(order)) return res.status(400).json({ error: "Donnees manquantes" });

    // Le numero de commande reste celui du premier envoi : tous les papiers
    // d'une table portent le meme
    const orderNum = existing.orderNum ?? b.orderNum;
    const common = { tableNumber, orderNum, date };
    const emporter = existing.orderType === "emporter";
    // A emporter : l'heure de retrait, le nom et le telephone peuvent changer
    // pendant la modification ; ils sortent a jour (et l'ancien papier, compare
    // avec l'ancien en-tete, ressort si seule l'heure a change)
    const enTete = (c) => (emporter ? {
      orderType: "emporter", emporterNum: existing.emporterNum,
      clientName: c.clientName, clientPhone: c.clientPhone, clientPickupTime: c.clientPickupTime,
    } : {});
    const ancien = enTete(existing);
    const nouveau = enTete({
      clientName: b.clientName ?? existing.clientName,
      clientPhone: b.clientPhone ?? existing.clientPhone,
      clientPickupTime: b.clientPickupTime ?? existing.clientPickupTime,
    });

    // Le restaurant echange le papier en cuisine : on reimprime le ticket
    // complet, mais seulement pour les postes dont le contenu a change
    // (articles, table ou en-tete a emporter). Comparaison a date identique et
    // dans un ordre neutre ; le ticket imprime garde l'ordre du panier.
    const info = { ...common, ...nouveau };
    const avant = ticketsDeCommande(ordreNeutre(existing.items), { ...common, tableNumber: existing.tableNumber, ...ancien }, emporter);
    const compare = ticketsDeCommande(ordreNeutre(order), info, emporter);
    // « (MODIF) » dans le titre : le papier remplace le precedent, la cuisine ne
    // prepare pas une deuxieme fois (comme les anciens tickets « CUISINE (MODIF) »)
    // La version d'avant marque « ^ NOUVEAU » les notes et allergies ajoutees
    const apres = ticketsDeCommande(order, info, emporter, " (MODIF)", existing.items);
    const POSTES = emporter ? ["COMMANDE"] : ["CUISINE", "DESSERTS", "BAR"];
    // Seuls les postes reellement touches ressortent : modifier un dessert ne
    // doit pas renvoyer la cuisine et le bar refaire un ticket identique.
    // Celui qui sort est complet pour son poste — on echange l'ancien.
    const tickets = apres.map((t, k) => {
      if (t && compare[k] !== avant[k]) return t;                    // contenu change
      if (!t && avant[k]) return ticketAnnulation(`${POSTES[k]} (MODIF)`, info);  // poste vide
      return "";                                                     // inchange
    });
    // Pas de ticket SERVICE ici : l'addition s'imprime manuellement en fin de service

    const printable = tickets.filter(Boolean);
    if (printable.length > 0) await sendToPrinter(printable.join(""));

    // Ecran cuisine : une section dont le contenu change repart « a faire »,
    // les autres gardent leur etat (pretes si la cuisine avait tout termine)
    const groups = buildGroups(order);
    const groupesAvant = buildGroups(existing.items || []);
    const avantParCat = new Map(groupesAvant.map((g) => [g.cat, signatureGroupe(g)]));
    const catStatus = {};
    if (emporter) {
      // A emporter : une seule section ; elle repart « a faire » si le contenu
      // ou l'en-tete (heure, nom) a change
      const inchange = JSON.stringify(groupesAvant.map(signatureGroupe)) === JSON.stringify(groups.map(signatureGroupe))
        && JSON.stringify(ancien) === JSON.stringify(nouveau);
      catStatus["A emporter"] = inchange ? (existing.catStatus?.["A emporter"] || (reconstituee ? "delivered" : "waiting")) : "waiting";
    } else {
      groups.forEach((g) => {
        const inchange = avantParCat.get(g.cat) === signatureGroupe(g);
        catStatus[g.cat] = inchange ? (existing.catStatus?.[g.cat] || (reconstituee ? "delivered" : "waiting")) : "waiting";
      });
    }

    // Les chronos d'une section remise « a faire » repartiront de son prochain
    // appel (au bar, de la prochaine preparation) ; ceux d'une section retiree partent
    const catCalledAt = { ...(existing.catCalledAt || {}) };
    const catReadyAt = { ...(existing.catReadyAt || {}) };
    for (const t of [catCalledAt, catReadyAt]) {
      for (const cat of Object.keys(t)) if (!catStatus[cat] || catStatus[cat] === "waiting") delete t[cat];
    }

    const updatedOrder = { ...existing, ...nouveau, items: order, tableNumber, orderNum, date,
                           dateOrigine: existing.dateOrigine || existing.date, catStatus, groupes: groups,
                           catCalledAt, catReadyAt };
    // Tout ce qui reste a deja ete servi (la modification a retire le reste) :
    // la commande est terminee, comme apres la derniere livraison
    const statuts = Object.values(catStatus);
    if (statuts.length > 0 && statuts.every((st) => st === "delivered")) {
      activeOrders.delete(orderId);
      saveOrders(activeOrders);
      broadcast({ type: "order_ready", orderId });
      console.log(`Commande servie et terminee — Table ${tableNumber} #${orderNum} (apres modification)`);
    } else {
      activeOrders.set(orderId, updatedOrder);
      saveOrders(activeOrders);
      broadcast({ type: "update_order", order: updatedOrder });
    }

    console.log(`Modification Table ${tableNumber} #${orderNum}${reconstituee ? " (commande reconstituee)" : ""} : ${printable.length} ticket(s)`);
    // la caisse dit au serveur de salle combien de tickets sont sortis (0 = rien de change)
    res.json({ success: true, tickets: printable.length });
  } catch (err) {
    console.error("Erreur modification:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Route POST /order/:id/reprint-tickets → ressort les tickets de production
// (CUISINE / DESSERTS / BAR, ou COMMANDE a emporter) d'une commande deja
// envoyee, quand un papier a ete jete ou perdu. Complets et a jour (les
// modifications comprises), marques DUPLICATA. « postes » choisit lesquels ;
// « apercu » renvoie seulement les postes qui ont quelque chose a imprimer.
app.post("/order/:id/reprint-tickets", async (req, res) => {
  try {
    const orderId = decodeURIComponent(req.params.id);
    const b = req.body || {};
    const connue = activeOrders.get(orderId);
    // Comme pour l'addition, la caisse envoie sa copie : le serveur oublie la
    // commande des que la cuisine a tout marque pret.
    const cmd = b.order ? {
      items: b.order,
      tableNumber: b.tableNumber,
      orderNum: connue?.orderNum ?? b.orderNum,
      date: connue?.dateOrigine || b.dateOrigine || connue?.date || b.date,
      orderType: b.orderType,
      emporterNum: b.emporterNum,
      clientName: b.clientName,
      clientPhone: b.clientPhone,
      clientPickupTime: b.clientPickupTime,
    } : connue && { ...connue, date: connue.dateOrigine || connue.date };
    if (!cmd || !Array.isArray(cmd.items) || !cmd.items.length) {
      return res.status(404).json({ error: "Commande introuvable" });
    }
    const emporter = cmd.orderType === "emporter";
    const info = {
      tableNumber: cmd.tableNumber, orderNum: cmd.orderNum, date: cmd.date,
      ...(emporter ? { orderType: "emporter", emporterNum: cmd.emporterNum, clientName: cmd.clientName,
                       clientPhone: cmd.clientPhone, clientPickupTime: cmd.clientPickupTime } : {}),
      // un ticket qui n'etait jamais sorti n'est pas un duplicata
      duplicata: b.duplicata !== false,
    };
    const NOMS = emporter ? ["COMMANDE"] : ["CUISINE", "DESSERTS", "BAR"];
    const tickets = ticketsDeCommande(cmd.items, info, emporter);
    const disponibles = NOMS.filter((n, k) => tickets[k]);
    if (b.apercu) return res.json({ success: true, postes: disponibles, connue: Boolean(connue) });
    const voulus = Array.isArray(b.postes) && b.postes.length ? b.postes : disponibles;
    const choisis = NOMS.map((n, k) => (voulus.includes(n) && tickets[k] ? tickets[k] : "")).filter(Boolean);
    if (!choisis.length) return res.status(400).json({ error: "Rien a imprimer pour ce poste", postes: disponibles });
    await sendToPrinter(choisis.join(""));
    const imprimes = NOMS.filter((n, k) => voulus.includes(n) && tickets[k]);
    console.log(`Tickets ressortis (${imprimes.join(", ")}) — ${emporter ? `Emporter #${cmd.emporterNum}` : `Table ${cmd.tableNumber}`} #${cmd.orderNum}`);
    res.json({ success: true, tickets: choisis.length, postes: imprimes });
  } catch (err) {
    console.error("Erreur reimpression tickets:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Route POST /order/:id/reprint-bill → réimprime l'addition
app.post("/order/:id/reprint-bill", async (req, res) => {
  try {
    const orderId = decodeURIComponent(req.params.id);
    const b = req.body || {};
    // La caisse envoie la commande avec sa demande : le serveur d'impression
    // l'a souvent deja oubliee, puisqu'il la retire des que la cuisine a tout
    // marque pret — c'est justement le moment ou l'on reclame l'addition.
    const order = b.order ? {
      items: b.order,
      tableNumber: b.tableNumber,
      orderNum: b.orderNum,
      date: b.date,
      orderType: b.orderType,
      emporterNum: b.emporterNum,
      clientName: b.clientName,
      clientPhone: b.clientPhone,
      clientPickupTime: b.clientPickupTime,
    } : activeOrders.get(orderId);
    if (!order || !order.items) return res.status(404).json({ error: "Commande introuvable" });
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
      remise: b.remise,
      sansDetail: b.sansDetail === true,
      nbRepas: b.nbRepas,
      duplicata: b.duplicata === true,
    });
    await sendToPrinter(ticket);
    console.log(`Réimpression addition — Table ${order.tableNumber} #${order.orderNum}`
      + (b.remise ? ` — remise ${libelleRemise(b.remise)}` : ""));
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
    .replace(/[çÇ]/g, "c")
    // L'imprimante n'est pas en latin1 : guillemets « », apostrophe ’ de
    // l'iPad et tirets sortaient en caracteres parasites (½ ╗) sur l'addition.
    .replace(/[«»“”„]/g, '"')
    .replace(/[‘’‚′`]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/€/g, "EUR")
    .replace(/[\u00a0\u202f]/g, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "?");
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

// ----- Notes et allergies d'un article -----
// La caisse pose « note » (« Sans oignon, Sauce a part ») et « allergie »
// (« Arachide, Lait ») sur une ligne simple, ou sur le choix concerne d'un
// menu. Absentes d'une commande sans note : tickets et ecrans ne bougent pas.
function texteLibre(v) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}
// « Sans oignon, Sauce a part » → ["Sans oignon", "Sauce a part"]
function segmentsDe(texte) {
  return texteLibre(texte).split(/\s*,\s*/).filter(Boolean);
}
// Ajoute des segments sans doublon (compares sans casse ni accent)
function ajouterSegments(liste, segments) {
  for (const s of segments) if (!liste.some((x) => normName(x) === normName(s))) liste.push(s);
  return liste;
}
// Note d'un article de production : la sienne, puis celles de ses choix
// (formule gardee entiere, precisions rattachees). Plusieurs choix sur la
// ligne (« Vanille / Mangue ») : la note dit lequel elle vise.
function noteDe(article) {
  const segs = ajouterSegments([], segmentsDe(article?.note));
  const choix = article?.formulaChoices || [];
  if (choix.length) {
    const montres = choixImprimables(article);
    const nommer = montres.length > 1;
    for (const c of choix) {
      const prefixe = nommer && montres.includes(c) ? `${texteLibre(c.itemName)} : ` : "";
      ajouterSegments(segs, segmentsDe(c.note).map((s) => prefixe + s));
    }
  }
  return segs.join(", ");
}
// Allergie d'un article : la sienne et celles de ses choix, sans doublon
function allergieDe(article) {
  const segs = ajouterSegments([], segmentsDe(article?.allergie));
  for (const c of article?.formulaChoices || []) ajouterSegments(segs, segmentsDe(c.allergie));
  return segs.join(", ");
}
// Cle de regroupement : deux memes plats aux notes differentes restent deux
// lignes (vide sans note : les regroupements d'aujourd'hui ne changent pas)
function cleNotes(article) {
  const n = noteDe(article), a = allergieDe(article);
  return n || a ? normName(n) + "|" + normName(a) : "";
}

// Decoupe un texte entre deux mots pour tenir dans « largeur » colonnes ;
// un mot plus long que la ligne est coupe net
function couperMots(texte, largeur) {
  const lignes = [];
  let courante = "";
  for (let mot of texte.split(" ").filter(Boolean)) {
    while (mot.length > largeur) {
      if (courante) { lignes.push(courante); courante = ""; }
      lignes.push(mot.slice(0, largeur));
      mot = mot.slice(largeur);
    }
    if (!mot) continue;
    if (!courante) courante = mot;
    else if (courante.length + 1 + mot.length <= largeur) courante += " " + mot;
    else { lignes.push(courante); courante = mot; }
  }
  if (courante) lignes.push(courante);
  return lignes;
}
// « > SANS OIGNON » en majuscules ; la suite d'une note longue est decalee
// sous le texte, jamais sous le chevron
function lignesNote(segment, largeur) {
  return couperMots(sanitize(segment).toUpperCase(), largeur - 4).map((l, k) => (k ? "    " : "  > ") + l);
}
// « !! ALLERGIE ARACHIDE » sur une ligne ; trop long : « !! ALLERGIE : » puis
// un allergene par ligne, decale. Chaque bloc sait quels allergenes il porte
// (pour le repere « ^ NOUVEAU »).
function blocsAllergie(allergenes, largeur) {
  const maj = allergenes.map((s) => sanitize(s).toUpperCase());
  const enLigne = "!! ALLERGIE " + maj.join(", ");
  if (enLigne.length <= largeur) return [{ lignes: [enLigne], allergenes }];
  return [{ lignes: ["!! ALLERGIE :"], allergenes: [] },
    ...maj.map((s, k) => ({ lignes: couperMots(s, largeur - 4).map((l) => "    " + l), allergenes: [allergenes[k]] }))];
}
function repereNouveau() {
  return CMD.BOLD_ON + "    ^ NOUVEAU\n" + CMD.BOLD_OFF;
}
// Sous la ligne d'un article, sur les tickets de production : la note a la
// taille de l'article, l'allergie en blanc sur noir sur toute la largeur.
// « estNouveau(type, segment) » repere ce qui n'etait pas sur le ticket d'avant.
function lignesNoteAllergie(article, estNouveau) {
  let b = "";
  for (const seg of segmentsDe(noteDe(article))) {
    b += CMD.DOUBLE_ON + CMD.BOLD_ON;
    b += lignesNote(seg, WIDTH_DOUBLE).map((l) => l + "\n").join("");
    b += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
    if (estNouveau && estNouveau("note", seg)) b += repereNouveau();
  }
  const allergenes = segmentsDe(allergieDe(article));
  for (const bloc of allergenes.length ? blocsAllergie(allergenes, WIDTH_DOUBLE) : []) {
    b += CMD.REVERSE_ON + CMD.DOUBLE_ON + CMD.BOLD_ON;
    b += bloc.lignes.map((l) => l.padEnd(WIDTH_DOUBLE) + "\n").join("");
    b += CMD.BOLD_OFF + CMD.DOUBLE_OFF + CMD.REVERSE_OFF;
    if (estNouveau && bloc.allergenes.some((s) => estNouveau("allergie", s))) b += repereNouveau();
  }
  return b;
}

// Garde-fou : chaque allergie recue doit sortir sous un article d'un ticket
// de production. Allergenes recus : ceux des lignes et de leurs choix, sans
// doublon (compares sans casse ni accent).
function allergenesRecus(order) {
  const segs = [];
  for (const ligne of order || []) {
    for (const src of [ligne, ...(ligne?.formulaChoices || [])]) ajouterSegments(segs, segmentsDe(allergieDe(src)));
  }
  return segs;
}
// En tete du ticket : bande « ALLERGIE A VERIFIER » puis les allergenes qui
// ne sont sortis sous aucun article, un par ligne, en double taille
function blocAllergieAVerifier(allergenes) {
  let b = bandeNoire("Allergie a verifier");
  b += CMD.DOUBLE_ON + CMD.BOLD_ON;
  for (const s of allergenes) b += couperMots(sanitize(s).toUpperCase(), WIDTH_DOUBLE).map((l) => l + "\n").join("");
  b += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
  return b + line("-");
}

// Repere « ^ NOUVEAU » d'un ticket (MODIF). Un meme article (poste, nom,
// piment, choix) : une note ou un allergene qui concerne plus d'assiettes
// qu'avant est nouveau sur la ligne qui a gagne des assiettes — note ajoutee
// apres l'envoi, ou plat ajoute avec sa note. Retiree ou inchangee : rien.
function identiteArticle(a) {
  return [posteAdmin(a) || CAT_MERGE_SHARED[a.category] || a.category || "Autres",
          normName(nomAffiche(a)), pimentMark(pimentLigne(a)), formulaSig(a)].join("\n");
}
function inventaireNotes(items) {
  const lignes = new Map(), segments = new Map();
  const compter = (m, k, q) => m.set(k, (m.get(k) || 0) + (Number(q) || 0));
  for (const a of articlesDeProduction(items || [])) {
    const id = identiteArticle(a);
    compter(lignes, id + "\n" + cleNotes(a), a.qty);
    for (const s of segmentsDe(noteDe(a))) compter(segments, `${id}\nnote\n${normName(s)}`, a.qty);
    for (const s of segmentsDe(allergieDe(a))) compter(segments, `${id}\nallergie\n${normName(s)}`, a.qty);
  }
  return { lignes, segments };
}
function comparerNotes(itemsAvant, itemsApres) {
  const avant = inventaireNotes(itemsAvant), apres = inventaireNotes(itemsApres);
  return (article) => {
    const id = identiteArticle(article), ligne = id + "\n" + cleNotes(article);
    const gagne = (apres.lignes.get(ligne) || 0) > (avant.lignes.get(ligne) || 0);
    return (type, seg) => {
      const cle = `${id}\n${type}\n${normName(seg)}`;
      return gagne && (apres.segments.get(cle) || 0) > (avant.segments.get(cle) || 0);
    };
  };
}

// Deux natures de formule :
//  - formule-MENU (Menu Midi = entree + plat + dessert) : chaque choix part
//    vers un poste different, le nom du menu n'interesse pas la cuisine ;
//  - formule-VARIANTE (Sirop parfum fraise, Lassi mangue, Kir cassis) : le
//    produit c'est l'article lui-meme, le choix n'est qu'une declinaison.
// On n'eclate que la premiere : sinon le bar recoit "1x Mangue" sans savoir
// qu'il s'agit d'un lassi.
// Une question de suite part au poste de la question qui l'a declenchee : on
// remonte jusqu'a l'etape d'origine. Son libelle peut alors etre en mots
// simples (« Quel parfum ? ») sans qu'il faille l'ajouter a la table — c'est
// ce qui avait oblige a creer « parfum kir » et « parfum kulfi ».
function posteDuChoix(choice, choices) {
  let c = choice;
  for (let garde = 0; garde < 10 && (c.remplaceParent || c.sousChoixDe); garde++) {
    const parentLabel = c.remplaceParent || c.sousChoixDe;
    const parent = (choices || []).find((x) => x.label === parentLabel);
    if (!parent) return mapFormulaLabelShared(parentLabel);
    c = parent;
  }
  return mapFormulaLabelShared(c.label);
}

function isMenuFormula(item) {
  const choices = item.formulaChoices || [];
  if (choices.length === 0) return false;
  const own = posteAdmin(item) || CAT_MERGE_SHARED[item.category] || item.category;
  const cats = choices.map((c) => posteDuChoix(c, choices));
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
// Si ce choix a lui-meme ete remplace par un detail (« Jus de fruits » cede
// a « Jus orange »), c'est le detail qui donne son nom a la ligne.
function choixTitre(choices) {
  let c = (choices || []).find((x) => x.remplaceNom);
  for (let garde = 0; c && garde < 10; garde++) {
    const detail = choices.find((x) => x.remplaceParent === c.label);
    if (!detail) break;
    c = detail;
  }
  return c || null;
}
function nomAffiche(item) {
  const c = choixTitre(item.formulaChoices);
  return c ? c.itemName : item.name;
}
// Le piment demande sur le choix qui donne le nom n'est imprime nulle part
// ailleurs : la ligne principale le reprend.
function pimentLigne(item) {
  if (pimentMark(item.piment)) return item.piment;
  return choixTitre(item.formulaChoices)?.piment || null;
}

// Choix a imprimer : on ecarte ceux qui ont remplace le nom ou leur parent
function choixImprimables(item) {
  const choices = item.formulaChoices || [];
  const remplaces = new Set(choices.map((x) => x.remplaceParent).filter(Boolean));
  const titre = choixTitre(choices);
  return choices.filter((x) => !x.remplaceNom && !remplaces.has(x.label) && x !== titre);
}

// Choix generiques qu'un choix remplace, en remontant (« Jus de fruits »)
function choixRemplaces(choice, choices) {
  const res = [];
  let c = choice;
  for (let garde = 0; garde < 10 && c.remplaceParent; garde++) {
    const parent = (choices || []).find((x) => x.label === c.remplaceParent);
    if (!parent) break;
    res.push(parent);
    c = parent;
  }
  return res;
}

// Articles tels que les postes les preparent : les formules-MENU eclatees
// poste par poste, les formules-VARIANTE gardees entieres. Sert aux tickets
// de production ET aux ecrans cuisine/service : les sections affichees sont
// ainsi exactement celles que le serveur suit (catStatus).
function articlesDeProduction(order) {
  const res = [];
  for (const item of order) {
    if (item.formulaChoices && item.formulaChoices.length > 0) {
      if (isMenuFormula(item)) {
        // Un choix generique remplace par un sous-choix ne part pas en
        // production : le bar recevrait « Jus de fruits » ET « Jus mangue ».
        const remplaces = new Set(item.formulaChoices.map((c) => c.remplaceParent).filter(Boolean));
        for (const choice of item.formulaChoices) {
          if (remplaces.has(choice.label)) continue;
          if (choice.sousChoixDe) continue;   // sort sous son parent, pas seul
          const article = { name: choice.itemName, category: posteDuChoix(choice, item.formulaChoices), qty: item.qty, piment: choice.piment || null };
          // La note et l'allergie du choix partent avec lui vers son poste ;
          // celles d'un choix generique remplace (« Jus de fruits » cede a
          // « Jus orange ») aussi, et par prudence celles de la ligne du menu.
          const sources = [item, ...choixRemplaces(choice, item.formulaChoices), choice];
          const note = ajouterSegments([], sources.flatMap((s) => segmentsDe(s.note))).join(", ");
          const allergie = ajouterSegments([], sources.flatMap((s) => segmentsDe(s.allergie))).join(", ");
          if (note) article.note = note;
          if (allergie) article.allergie = allergie;
          // Les precisions rattachees (boules d'une coupe) suivent leur
          // article : imprimees a part, on ne saurait plus a quelle coupe
          // elles appartiennent quand il y en a plusieurs.
          const rattaches = item.formulaChoices.filter((c) => c.sousChoixDe === choice.label);
          if (rattaches.length > 0) article.formulaChoices = rattaches;
          res.push(article);
        }
      } else {
        res.push({ ...item });
      }
    } else if (item.isFormula && item.formulaSteps?.length > 0) {
      // Formule sans choix : afficher le nom + les étapes attendues
      const stepLabels = item.formulaSteps.map(s => s.label).join(" / ");
      res.push({ ...item, name: `${item.name}  [? ${stepLabels}]` });
    } else {
      res.push({ ...item });
    }
  }
  return res;
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
    // supplement paye avec ce choix (inclus dans le prix de la ligne)
    const sup = Number(c.supplement) > 0 ? `  +${Number(c.supplement).toFixed(2)}` : "";
    b += `${indent}> ${sanitize(c.label)}: ${sanitize(c.itemName)}${cm ? "  " + cm : ""}${sup}\n`;
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

function formatTicket({ title, order, tableNumber, orderNum, date, showTotal, orderType, emporterNum, clientName, clientPhone, clientPickupTime, catFilter, remise , sansDetail = false, nbRepas, duplicata = false, estNouveau = null,
                      allergenesImprimes = null, allergiesAVerifier = null}) {
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
    if (duplicata) buf += "DUPLICATA\n";
    buf += CMD.BOLD_OFF;
  } else {
    // Ticket production : titre + numero en gros.
    // A emporter, on affiche la numerotation du jour (JJ-N) et non le
    // numero interne, pour ne pas avoir deux numeros concurrents.
    const ticketNum = orderType === "emporter" ? emporterNum : orderNum;
    buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
    buf += `${title} #${ticketNum}\n`;
    // Ticket ressorti (papier perdu) : la cuisine sait que ce n'est pas une
    // nouvelle commande a preparer une deuxieme fois
    if (duplicata) buf += "DUPLICATA\n";
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
  let itemsToGroup = showTotal ? order.map((i) => ({ ...i })) : articlesDeProduction(order);

  // Ordre de production en cuisine : naans, entrees, plats, desserts
  // (Biryani fusionné dans Plats). Les boissons ferment le ticket.
  const CAT_ORDER = ["Naans", "Entrees", "Plats", "Desserts", "Menu Midi",
                     "Boissons", "Apéritifs", "Aperitifs", "Vins", "Vin", "Rosé", "Rose", "Bières", "Bieres", "Bar"];
  const CAT_MERGE = { "Biryani": "Plats", "Entrées": "Entrees", "Entrees": "Entrees" };
  const mergedCat = (item) => posteAdmin(item) || CAT_MERGE[item.category] || item.category || "Autres";

  // Filtre de catégorie appliqué APRES eclatement des formules
  // (permet de sortir le dessert d'un menu sur le ticket desserts)
  if (catFilter) itemsToGroup = itemsToGroup.filter((i) => catFilter(mergedCat(i)));
  // Sans article, pas de ticket ; sauf s'il doit porter le garde-fou allergie
  // (aucun poste n'a rien recu : la cuisine doit quand meme le savoir)
  if (itemsToGroup.length === 0 && !(allergiesAVerifier && allergiesAVerifier.length)) return "";

  const nbArticles = itemsToGroup.reduce((s, i) => s + i.qty, 0);

  const seenCats = {};
  for (const item of itemsToGroup) {
    const cat = mergedCat(item);
    if (!seenCats[cat]) seenCats[cat] = [];
    // Regroupe sur le marqueur affiche : deux lignes identiques a l'impression
    // fusionnent, mais un plat avec piment reste separe du meme plat sans piment.
    // Sur une addition, deux articles de meme nom mais de prix differents
    // (deux « Supplement » hors carte) ne doivent pas fusionner : les lignes
    // ne sommeraient plus au total imprime juste en dessous.
    const existing = seenCats[cat].find(x => normName(nomAffiche(x)) === normName(nomAffiche(item))
      && pimentMark(pimentLigne(x)) === pimentMark(pimentLigne(item))
      && formulaSig(x) === formulaSig(item)
      && (!showTotal || x.price === item.price)
      // En production, une note ou une allergie fait une ligne a part ;
      // l'addition, elle, ne change pas
      && (showTotal || cleNotes(x) === cleNotes(item)));
    if (existing) existing.qty += item.qty;
    else seenCats[cat].push(item);
  }
  const sortedCats = [...CAT_ORDER.filter(c => seenCats[c]), ...Object.keys(seenCats).filter(c => !CAT_ORDER.includes(c))];
  const groups = sortedCats.map(cat => ({ cat, items: seenCats[cat] }));

  // Addition sans detail : le client veut un justificatif, pas la liste de ce
  // qu'il a mange. On ne garde que le nombre de repas et le total.
  const groupesAffiches = (showTotal && sansDetail) ? [] : groups;
  if (showTotal && sansDetail) {
    buf += CMD.CENTER + CMD.DOUBLE_ON + CMD.BOLD_ON;
    // Le nombre de repas est saisi en caisse : un cafe n'est pas un repas,
    // le compte des articles donnerait un chiffre faux.
    const n = Number.isFinite(Number(nbRepas)) && Number(nbRepas) > 0 ? Number(nbRepas) : nbArticles;
    buf += `${n} repas\n`;
    buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF + CMD.LEFT;
    buf += "\n";
  }

  // Une allergie recue n'est sortie sur aucun ticket : signalee en tout premier
  if (!showTotal && allergiesAVerifier && allergiesAVerifier.length) buf += blocAllergieAVerifier(allergiesAVerifier);

  // Un article de CE ticket porte une allergie : grande bande en tete, avant
  // la premiere categorie, vue avant meme de lire le detail
  if (!showTotal && itemsToGroup.some((i) => allergieDe(i))) buf += bandeNoire("! ALLERGIE !", "quad");

  for (const group of groupesAffiches) {
    // Bande noire de categorie — tickets de production (cuisine / desserts / bar)
    if (!showTotal) buf += bandeNoire(group.cat);

    for (const item of group.items) {
      if (showTotal) {
        const totalStr = `${(item.price * item.qty).toFixed(2)} EUR`;
        const mark = pimentMark(pimentLigne(item));
        buf += CMD.BOLD_ON;
        buf += pad(`${item.qty}x ${sanitize(nomAffiche(item))}${mark ? " " + mark : ""}`, totalStr, WIDTH);
        buf += CMD.BOLD_OFF;
        buf += formulaLines(item);
        buf += `   ${item.price.toFixed(2)} EUR/u\n`;
        buf += ESC + "J\x06";
      } else {
        buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
        buf += itemLine(`${item.qty}x ${sanitize(nomAffiche(item))}`, pimentMark(pimentLigne(item)));
        buf += formulaLineCompacte(item);
        buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
        buf += lignesNoteAllergie(item, estNouveau && estNouveau(item));
        // Allergenes reellement imprimes, pour le garde-fou de ticketsDeCommande
        if (allergenesImprimes) for (const a of segmentsDe(allergieDe(item))) allergenesImprimes.add(normName(a));
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
    const montant = montantRemise(total, remise);
    buf += CMD.BOLD_ON;
    buf += CMD.DOUBLE_ON;
    buf += pad("TOTAL", `${total.toFixed(2)} EUR`, WIDTH_DOUBLE);
    buf += CMD.DOUBLE_OFF;
    buf += CMD.BOLD_OFF;
    if (montant > 0) {
      buf += CMD.BOLD_ON;
      buf += pad(`REMISE ${libelleRemise(remise)}`, `-${montant.toFixed(2)} EUR`, WIDTH);
      buf += CMD.BOLD_OFF;
      buf += line("-");
      buf += CMD.BOLD_ON + CMD.DOUBLE_ON;
      buf += pad("A PAYER", `${(total - montant).toFixed(2)} EUR`, WIDTH_DOUBLE);
      buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
    }
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
// Remise appliquee a une addition : { type: "pourcent"|"euro", valeur: n }
function montantRemise(total, remise) {
  if (!remise || !remise.valeur) return 0;
  const v = Number(remise.valeur);
  if (!Number.isFinite(v) || v <= 0) return 0;
  // Calcul en centimes entiers (le demi-centime s'arrondit toujours vers le
  // haut : 15 % de 8,50 € = 1,28 €), jamais negatif ni superieur au total.
  // ⚠ Meme formule dans la caisse (src/App.jsx, fenetre Addition).
  const cents = Math.round(total * 100);
  const r = remise.type === "euro" ? Math.round(v * 100) : Math.round(cents * v / 100);
  return Math.min(Math.max(r, 0), cents) / 100;
}
function libelleRemise(remise) {
  if (!remise) return "";
  return remise.type === "euro" ? `${Number(remise.valeur).toFixed(2)} EUR` : `${Number(remise.valeur)}%`;
}

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
  b += CMD.BOLD_ON + "Non cumulable\n" + CMD.BOLD_OFF;
  b += CMD.BOLD_ON + "A presenter avec le ticket entier\n" + CMD.BOLD_OFF;
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
        buf += itemLine(`${item.qty}x ${sanitize(nomAffiche(item))}`, pimentMark(pimentLigne(item)));
        buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
        buf += CMD.BOLD_ON + formulaLines(item) + CMD.BOLD_OFF;
      }
    }
    if (removed.length > 0) {
      if (added.length > 0) buf += line("=");   // separe nettement les deux blocs
      buf += bandeNoire("Annules");
      for (const item of removed) {
        buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
        buf += itemLine(`${item.qty}x ${sanitize(nomAffiche(item))}`, pimentMark(pimentLigne(item)));
        buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
        buf += formulaLines(item);
      }
    }
    buf += line("=");
  }

  // ── Section COMMANDE COMPLÈTE ──
  buf += bandeNoire("Commande complete");

  for (const item of newItems) {
    const mark = pimentMark(pimentLigne(item));
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
  if (DRY_RUN) {
    console.log("\n" + "=".repeat(52));
    console.log("TICKET (mode essai — non imprime)");
    console.log("=".repeat(52));
    console.log(apercuTicket(data));
    console.log("=".repeat(52) + "\n");
    return Promise.resolve();
  }
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
      // Supprimer si tout a ete servi (une table prete mais pas encore servie
      // reste a l'ecran service, jusqu'a « Confirmer livraison »)
      if (o.catStatus) {
        const statuses = Object.values(o.catStatus);
        if (statuses.length > 0 && statuses.every(s => s === "delivered")) return false;
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


// Ticket PRET : la note en clair, l'allergie en blanc sur noir, pour que la
// salle porte la bonne assiette a la bonne personne. Les articles viennent de
// l'ecran cuisine (sections du serveur), note et allergie deja reunies.
function lignesNotePret(item) {
  let b = "";
  for (const seg of segmentsDe(item.note)) b += lignesNote(seg, WIDTH).map((l) => l + "\n").join("");
  const allergenes = segmentsDe(item.allergie);
  if (allergenes.length) {
    b += CMD.REVERSE_ON + CMD.DOUBLE_H + CMD.BOLD_ON;
    for (const bloc of blocsAllergie(allergenes, WIDTH)) b += bloc.lignes.map((l) => l.padEnd(WIDTH) + "\n").join("");
    b += CMD.BOLD_OFF + CMD.DOUBLE_OFF + CMD.REVERSE_OFF;
  }
  return b;
}

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
    buf += lignesNotePret(item);
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
const CAT_ORDER_SHARED = ["Naans", "Entrees", "Plats", "Desserts", "Boissons", "Vins", "Vin", "Rosé", "Apéritifs", "Menu Midi", "Menu Rajasthan", "Menu Taj Mahal"];
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
  // Libelle volontairement specifique : un simple "parfum" ferait passer
  // le Kulfi (etape "Parfum") pour un menu et l'enverrait au bar.
  "parfum kir": "Boissons",
  "parfum kulfi": "Desserts",
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
  const cles = new Map();   // ligne affichee → cle de sa note et de son allergie
  // Memes articles que sur les tickets de production : les questions de
  // suite restent avec leur plat au lieu de former des sections fantomes
  // que personne ne pouvait appeler ni valider sur le KDS.
  for (const article of articlesDeProduction(items)) {
    const cat = posteAdmin(article) || CAT_MERGE_SHARED[article.category] || article.category || "Autres";
    if (!seen[cat]) seen[cat] = [];
    const nom = nomAffiche(article);
    const piment = pimentLigne(article) || null;
    // Deux memes plats aux notes differentes restent deux lignes a l'ecran
    const cle = cleNotes(article);
    const existing = seen[cat].find(x => normName(x.name) === normName(nom)
      && (x.piment || null) === piment
      && formulaSig(x) === formulaSig(article)
      && cles.get(x) === cle);
    if (existing) { existing.qty += article.qty; continue; }
    // Precision lisible telle qu'imprimee : « Vanille / Mangue », « Riz »
    const detail = choixImprimables(article)
      .map((c) => c.itemName + (pimentMark(c.piment) ? " " + pimentMark(c.piment) : "")).join(" / ");
    const ligne = { ...article, name: nom, piment, ...(detail ? { detail } : {}) };
    // Note et allergie reunies (celles des choix comprises), absentes si vides
    const note = noteDe(article), allergie = allergieDe(article);
    delete ligne.note; delete ligne.allergie;
    if (note) ligne.note = note;
    if (allergie) ligne.allergie = allergie;
    cles.set(ligne, cle);
    seen[cat].push(ligne);
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
  activeOrders.forEach((order) => {
    ws.send(JSON.stringify({ type: "new_order", order }));
  });
  // Fin de l'envoi complet : un ecran qui se reconnecte retire ce qui a ete
  // termine ou supprime pendant la coupure
  ws.send(JSON.stringify({ type: "etat_complet", ids: [...activeOrders.keys()] }));

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
          // prepare sans appel du service (bar) : l'heure de depart est gardee,
          // les chronos des ecrans ne repartent pas de zero a chaque rechargement
          if (!order.catCalledAt) order.catCalledAt = {};
          if (!order.catCalledAt[msg.catName]) order.catCalledAt[msg.catName] = Date.now();
          saveOrders(activeOrders);
          broadcast({ type: "cat_status", orderId: msg.orderId, catName: msg.catName, status: "in_progress", calledAt: order.catCalledAt[msg.catName] });
          console.log(`Cuisine en cours ${msg.catName} — Table ${order.tableNumber}`);
        }
      }

      // Cuisine → prêt → imprime ticket
      if (msg.type === "cat_ready") {
        const order = activeOrders.get(msg.orderId);
        // Deja prete ou servie (deux ecrans montrent la meme section, double
        // appui) : pas de second ticket PRET
        const deja = ["done", "delivered"].includes(order?.catStatus?.[msg.catName]);
        if (order && order.catStatus && !deja) {
          order.catStatus[msg.catName] = "done";
          if (!order.catReadyAt) order.catReadyAt = {};
          order.catReadyAt[msg.catName] = Date.now();
          saveOrders(activeOrders);
          broadcast({ type: "cat_status", orderId: msg.orderId, catName: msg.catName, status: "done", readyAt: order.catReadyAt[msg.catName] });
        }
        // Le ticket PRET ne sort que pour une commande connue, avec ses articles
        if (order && !deja && Array.isArray(msg.items)) try {
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
          // Tout est servi : la commande est terminee et quitte les ecrans. Avant,
          // l'ecran cuisine la terminait 3 s apres le dernier plat pret, et la
          // table disparaissait de l'ecran service avant « Confirmer livraison ».
          if (Object.values(order.catStatus).every((st) => st === "delivered")) {
            activeOrders.delete(msg.orderId);
            saveOrders(activeOrders);
            broadcast({ type: "order_ready", orderId: msg.orderId });
            console.log(`Commande servie et terminee — Table ${order.tableNumber} #${order.orderNum}`);
          }
        }
      }

      // Toutes catégories prêtes → supprimer la commande du serveur
      if (msg.type === "order_ready") {
        const order = activeOrders.get(msg.orderId);
        // Un ecran reste sur une ancienne version, ou une modification arrivee
        // pendant les 3 s de la carte verte : la commande a encore a faire en
        // cuisine, on ne la termine pas et on la renvoie aux ecrans.
        const resteAFaire = order && Object.entries(order.catStatus || {})
          .some(([cat, st]) => !BAR_CATEGORIES.has(cat) && st !== "done" && st !== "delivered");
        if (resteAFaire) {
          console.log(`Fin refusee — Table ${order.tableNumber} #${order.orderNum} : il reste a faire en cuisine`);
          ws.send(JSON.stringify({ type: "update_order", order }));
          return;
        }
        // Les ecrans ne terminent plus une commande : elle reste a l'ecran
        // service jusqu'a ce que chaque livraison soit confirmee (voir
        // cat_delivered) ou jusqu'a la cloture. Un ecran reste sur une ancienne
        // version qui le demande encore est ignore (sans renvoi : pas de boucle).
        if (order && Object.values(order.catStatus || {}).some((st) => st !== "delivered")) {
          console.log(`Fin ignoree — Table ${order.tableNumber} #${order.orderNum} : livraison a confirmer par le service`);
          return;
        }
        broadcast({ type: "order_ready", orderId: msg.orderId });
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
// « precedent » (modification) : la version d'avant, pour le repere « ^ NOUVEAU ».
function ticketsDeCommande(order, common, isEmporter, suffixe = "", precedent = null) {
  const estNouveau = precedent ? comparerNotes(precedent, order) : null;
  // A emporter : cuisine, desserts et bar sur un SEUL ticket,
  // separes par les bandes noires de categorie.
  // Sur place, la commande entiere est passee aux trois tickets : c'est le
  // filtre, applique APRES eclatement des formules, qui aiguille chaque
  // article. Trier sur la categorie de l'article laisserait l'aperitif d'un
  // menu (categorie « Menu ») partir en cuisine au lieu du bar.
  const estBar = (c) => BAR_CATEGORIES.has(c);
  const postes = isEmporter ? [{ title: "COMMANDE" }] : [
    { title: "CUISINE", catFilter: (c) => !estBar(c) && c !== "Desserts" },
    { title: "DESSERTS", catFilter: (c) => c === "Desserts" },
    { title: "BAR", catFilter: estBar },
  ];
  const imprimes = new Set();
  const ticket = (p, allergiesAVerifier = null) => formatTicket({ title: p.title + suffixe, order, showTotal: false, estNouveau,
    catFilter: p.catFilter, allergenesImprimes: imprimes, allergiesAVerifier, ...common });
  const tickets = postes.map((p) => ticket(p));
  // Garde-fou allergie : un allergene recu qui n'est sorti sous aucun article
  // part en tete du ticket CUISINE (COMMANDE a emporter) ; CUISINE vide : sur
  // le premier ticket non vide. Tout est sorti : les tickets ne changent pas.
  const manquants = allergenesRecus(order).filter((a) => !imprimes.has(normName(a)));
  if (manquants.length) {
    const k = tickets[0] ? 0 : Math.max(0, tickets.findIndex(Boolean));
    tickets[k] = ticket(postes[k], manquants);
  }
  return tickets;
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

    const boissons = order.filter((i) => estBarArticle(i));
    const cuisine = order.filter((i) => !estBarArticle(i));
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
    // Sections calculees ici une fois pour toutes : le KDS et l'ecran service
    // les affichent telles quelles (memes noms que catStatus).
    const groupes = buildGroups(cuisineAll);
    if (isEmporter) {
      catStatus = { "A emporter": "waiting" };
    } else {
      catStatus = {};
      groupes.forEach(g => { catStatus[g.cat] = "waiting"; });
    }
    // Les articles gardent l'ordre du panier : c'est la reference des
    // modifications et des tickets ressortis
    const orderData = {
      id: orderId, orderNum, tableNumber: effectiveTable, date, dateOrigine: date,
      items: order, receivedAt: Date.now(), catStatus, groupes,
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
