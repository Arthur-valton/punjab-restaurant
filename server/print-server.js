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

// IP imprimante selon le réseau WiFi ou la plage IP locale
const PRINTER_IPS = {
  "popina-new-punjab": "192.168.110.21",
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

    const boissons = order.filter((i) => i.category === "Boissons");
    const cuisine = order.filter((i) => i.category !== "Boissons");
    const cuisineAll = [...cuisine, ...boissons];
    const common = { tableNumber, orderNum, date };

    const oldItems = existing.items || [];
    const tickets = [];
    if (cuisineAll.length > 0) {
      tickets.push(formatModifTicket({ title: "CUISINE (MODIF)", oldItems, newItems: cuisineAll, showTotal: false, ...common }));
    }
    tickets.push(formatModifTicket({ title: "SERVICE (MODIF)", oldItems, newItems: order, showTotal: true, ...common }));

    await sendToPrinter(tickets.join(""));

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
  FEED: ESC + "d\x03",
  CUT: GS + "V\x00",
  PARTIAL_CUT: GS + "V\x01",
};

function line(char = "-", width = WIDTH) {
  return char.repeat(width) + "\n";
}

function pad(left, right, width = WIDTH, fill = " ") {
  const space = width - left.length - right.length;
  return left + fill.repeat(Math.max(1, space)) + right + "\n";
}

function formatTicket({ title, order, tableNumber, orderNum, date, showTotal }) {
  let buf = "";
  buf += CMD.INIT;
  buf += CMD.CENTER;
  buf += CMD.DOUBLE_ON;
  buf += CMD.BOLD_ON;
  buf += "PUNJAB\n";
  buf += CMD.DOUBLE_OFF;
  buf += CMD.BOLD_OFF;
  if (showTotal) {
    buf += "3 RUE RENE D'ANJOU\n";
    buf += "53200 CHATEAU-GONTIER-SUR-MAYENNE\n";
    buf += "SIRET: 94372706500014\n";
    buf += "APE: 5610A - TVA: FR12943727065\n";
  }
  buf += "\n";
  buf += CMD.BOLD_ON;
  buf += `*** ${title} ***\n`;
  buf += CMD.BOLD_OFF;
  buf += CMD.LEFT;
  buf += line("=");
  buf += `Commande: #${orderNum}\n`;
  buf += CMD.CENTER;
  buf += CMD.BOLD_ON;
  buf += CMD.QUAD;
  buf += `TABLE ${tableNumber}\n`;
  buf += CMD.DOUBLE_OFF;
  buf += CMD.BOLD_OFF;
  buf += CMD.LEFT;
  buf += `Date: ${date}\n`;
  buf += line("=");

  // Grouper par catégorie avec ordre fixe (Biryani fusionné dans Plats)
  const CAT_ORDER = ["Entrees", "Plats", "Naans", "Desserts", "Menu Midi"];
  const CAT_MERGE = { "Biryani": "Plats" };
  const seenCats = {};
  for (const item of order) {
    const cat = CAT_MERGE[item.category] || item.category || "Autres";
    if (!seenCats[cat]) seenCats[cat] = [];
    seenCats[cat].push(item);
  }
  const sortedCats = [...CAT_ORDER.filter(c => seenCats[c]), ...Object.keys(seenCats).filter(c => !CAT_ORDER.includes(c))];
  const groups = sortedCats.map(cat => ({ cat, items: seenCats[cat] }));

  for (const group of groups) {
    // Séparateur de catégorie — ticket cuisine uniquement
    if (!showTotal && groups.length > 1) {
      buf += CMD.CENTER;
      buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
      buf += `${group.cat.toUpperCase()}\n`;
      buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
      buf += CMD.LEFT;
      buf += line("-");
    }

    for (const item of group.items) {
      const pimentSymbols = { 1: "PIMENT: Sans", 2: "PIMENT: ~~ Moyen ~~", 3: "PIMENT: !!! FORT !!!" };
      if (showTotal) {
        const totalStr = `${(item.price * item.qty).toFixed(2)} EUR`;
        buf += CMD.BOLD_ON;
        buf += pad(`${item.qty}x ${item.name}`, totalStr, WIDTH);
        buf += CMD.BOLD_OFF;
        if (item.piment && item.piment > 1) buf += `   ${pimentSymbols[item.piment]}\n`;
        if (item.formulaChoices) {
          for (const choice of item.formulaChoices) {
            const pimentTxt = choice.piment > 1 ? `  ${pimentSymbols[choice.piment]}` : "";
            buf += `   > ${choice.label}: ${choice.itemName}${pimentTxt}\n`;
          }
        }
        buf += `   ${item.price.toFixed(2)} EUR/u\n`;
        buf += ESC + "J\x06";
      } else {
        buf += CMD.DOUBLE_H + CMD.BOLD_ON;
        buf += `${item.qty}x ${item.name}\n`;
        buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
        if (item.piment && item.piment > 1) {
          buf += CMD.BOLD_ON;
          buf += `  ${pimentSymbols[item.piment]}\n`;
          buf += CMD.BOLD_OFF;
        }
        if (item.formulaChoices) {
          for (const choice of item.formulaChoices) {
            buf += CMD.BOLD_ON;
            buf += `  > ${choice.label}: ${choice.itemName}${choice.piment > 1 ? `  ${pimentSymbols[choice.piment]}` : ""}\n`;
            buf += CMD.BOLD_OFF;
          }
        }
        buf += ESC + "J\x0C";
      }
    }

    if (!showTotal && groups.length > 1) {
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
    const totalQty = order.reduce((s, i) => s + i.qty, 0);
    buf += CMD.CENTER;
    buf += `${totalQty} article(s)\n`;
  }

  buf += CMD.FEED;
  buf += CMD.PARTIAL_CUT;
  return buf;
}

function formatModifTicket({ title, oldItems, newItems, tableNumber, orderNum, date, showTotal }) {
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

  let buf = "";
  buf += CMD.INIT;
  buf += CMD.CENTER;
  buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
  buf += "PUNJAB\n";
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  buf += "\n";
  buf += CMD.BOLD_ON;
  buf += `*** ${title} ***\n`;
  buf += CMD.BOLD_OFF;
  buf += CMD.LEFT;
  buf += line("=");
  buf += `Commande: #${orderNum}\n`;
  buf += CMD.CENTER + CMD.BOLD_ON + CMD.QUAD;
  buf += `TABLE ${tableNumber}\n`;
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF + CMD.LEFT;
  buf += `Date: ${date}\n`;
  buf += line("=");

  // ── Section MODIFICATIONS ──
  if (added.length > 0 || removed.length > 0) {
    buf += CMD.CENTER + CMD.DOUBLE_ON + CMD.BOLD_ON;
    buf += "MODIFICATIONS\n";
    buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF + CMD.LEFT;
    buf += line("-");
    const ps = { 1: "PIMENT: Sans", 2: "PIMENT: ~~ Moyen ~~", 3: "PIMENT: !!! FORT !!!" };
    for (const item of added) {
      buf += CMD.DOUBLE_H + CMD.BOLD_ON;
      buf += `++ ${item.qty}x ${item.name}\n`;
      buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
      if (item.piment && item.piment > 1) {
        buf += CMD.BOLD_ON + `   ${ps[item.piment]}\n` + CMD.BOLD_OFF;
      }
      if (item.formulaChoices) {
        for (const choice of item.formulaChoices) {
          buf += CMD.BOLD_ON;
          buf += `   > ${choice.label}: ${choice.itemName}${choice.piment > 1 ? `  ${ps[choice.piment]}` : ""}\n`;
          buf += CMD.BOLD_OFF;
        }
      }
    }
    for (const item of removed) {
      buf += CMD.DOUBLE_H + CMD.BOLD_ON;
      buf += `-- ${item.qty}x ${item.name}\n`;
      buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
      if (item.formulaChoices) {
        for (const choice of item.formulaChoices) {
          buf += `   > ${choice.label}: ${choice.itemName}\n`;
        }
      }
    }
    buf += line("=");
  }

  // ── Section COMMANDE COMPLÈTE ──
  buf += CMD.CENTER + CMD.DOUBLE_ON + CMD.BOLD_ON;
  buf += "COMMANDE COMPLETE\n";
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF + CMD.LEFT;
  buf += line("-");

  for (const item of newItems) {
    if (showTotal) {
      const totalStr = `${(item.price * item.qty).toFixed(2)} EUR`;
      buf += CMD.BOLD_ON;
      buf += pad(`${item.qty}x ${item.name}`, totalStr, WIDTH);
      buf += CMD.BOLD_OFF;
      if (item.formulaChoices) {
        const ps = { 1: "PIMENT: Sans", 2: "PIMENT: ~~ Moyen ~~", 3: "PIMENT: !!! FORT !!!" };
        for (const choice of item.formulaChoices) {
          buf += `   > ${choice.label}: ${choice.itemName}${choice.piment > 1 ? `  ${ps[choice.piment]}` : ""}\n`;
        }
      }
      buf += `   ${item.price.toFixed(2)} EUR/u\n`;
    } else {
      buf += CMD.DOUBLE_H + CMD.BOLD_ON;
      buf += `${item.qty}x ${item.name}\n`;
      buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
      if (item.formulaChoices) {
        const ps = { 1: "PIMENT: Sans", 2: "PIMENT: ~~ Moyen ~~", 3: "PIMENT: !!! FORT !!!" };
        for (const choice of item.formulaChoices) {
          buf += CMD.BOLD_ON;
          buf += `  > ${choice.label}: ${choice.itemName}${choice.piment > 1 ? `  ${ps[choice.piment]}` : ""}\n`;
          buf += CMD.BOLD_OFF;
        }
      }
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

// ----- Ticket "PRÊT" -----
function formatReadyTicket({ tableNumber, orderNum, items, date }) {
  let buf = "";
  buf += CMD.INIT;
  buf += CMD.CENTER;
  buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
  buf += "PUNJAB\n";
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  buf += "\n";
  buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
  buf += "COMMANDE\n";
  buf += "PRETE !\n";
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  buf += CMD.LEFT;
  buf += line("=");
  buf += CMD.CENTER + CMD.BOLD_ON + CMD.QUAD;
  buf += `TABLE ${tableNumber}\n`;
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF + CMD.LEFT;
  buf += `Commande: #${orderNum}\n`;
  buf += `Date: ${date}\n`;
  buf += line("=");
  for (const item of items) {
    buf += CMD.DOUBLE_H + CMD.BOLD_ON;
    buf += `${item.qty}x ${item.name}\n`;
    buf += CMD.BOLD_OFF + CMD.DOUBLE_OFF;
    buf += ESC + "J\x0C";
  }
  buf += line("=");
  buf += CMD.CENTER;
  buf += "Plat(s) pret(s) a servir !\n";
  buf += CMD.FEED;
  buf += CMD.PARTIAL_CUT;
  return buf;
}

// ----- Ticket partiel "SECTION PRÊTE" -----
function formatPartialReadyTicket({ tableNumber, orderNum, catName, items }) {
  const date = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  let buf = "";
  buf += CMD.INIT;
  buf += CMD.CENTER;
  buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
  buf += "PUNJAB\n";
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  buf += "\n";
  buf += CMD.DOUBLE_ON + CMD.BOLD_ON;
  buf += `${catName.toUpperCase()}\n`;
  buf += "PRET !\n";
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  buf += CMD.LEFT;
  buf += line("=");
  buf += CMD.CENTER + CMD.BOLD_ON + CMD.QUAD;
  buf += `TABLE ${tableNumber}\n`;
  buf += CMD.DOUBLE_OFF + CMD.BOLD_OFF + CMD.LEFT;
  buf += `Commande: #${orderNum}\n`;
  buf += `Date: ${date}\n`;
  buf += line("=");
  for (const item of items) {
    buf += CMD.DOUBLE_H + CMD.BOLD_ON;
    buf += `${item.qty}x ${item.name}\n`;
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
const CAT_ORDER_SHARED = ["Entrees", "Plats", "Naans", "Desserts", "Boissons", "Menu Midi"];
const CAT_MERGE_SHARED = { "Biryani": "Plats" };

function buildGroups(items) {
  const seen = {};
  for (const item of items) {
    const cat = CAT_MERGE_SHARED[item.category] || item.category || "Autres";
    if (!seen[cat]) seen[cat] = [];
    seen[cat].push(item);
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
          await sendToPrinter(formatPartialReadyTicket(msg));
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
app.post("/print-all", async (req, res) => {
  try {
    const { order, tableNumber, orderNum, date } = req.body;

    if (!order || !tableNumber || !orderNum) {
      return res.status(400).json({ error: "Donnees manquantes" });
    }

    const boissons = order.filter((i) => i.category === "Boissons");
    const cuisine = order.filter((i) => i.category !== "Boissons");
    const common = { tableNumber, orderNum, date };
    const tickets = [];

    const cuisineAll = [...cuisine, ...boissons];
    if (cuisineAll.length > 0) {
      tickets.push(formatTicket({ title: "CUISINE", order: cuisineAll, showTotal: false, ...common }));
    }
    tickets.push(formatTicket({ title: "SERVICE", order, showTotal: true, ...common }));

    console.log(`Impression Table ${tableNumber} #${orderNum} : ${tickets.length} ticket(s)`);
    await sendToPrinter(tickets.join(""));

    // Broadcast au KDS + stockage en mémoire
    const orderId = `${orderNum}-${Date.now()}`;
    const groups = buildGroups(cuisineAll);
    const catStatus = {};
    groups.forEach(g => { catStatus[g.cat] = "waiting"; });
    const orderData = { id: orderId, orderNum, tableNumber, date, items: cuisineAll, receivedAt: Date.now(), catStatus };
    activeOrders.set(orderId, orderData);
    saveOrders(activeOrders);
    broadcast({ type: "new_order", order: orderData });

    res.json({ success: true, message: `${tickets.length} ticket(s) imprime(s)`, tickets: tickets.length });
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
