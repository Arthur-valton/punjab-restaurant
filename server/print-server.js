import express from "express";
import cors from "cors";
import net from "net";
import http from "http";
import fs from "fs";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/kds-ws" });

const PORT = 3001;
const PRINTER_IP = "192.168.1.29";
const PRINTER_PORT = 9100;

const WIDTH = 48;
const WIDTH_DOUBLE = 24;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

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
      if (showTotal) {
        const totalStr = `${(item.price * item.qty).toFixed(2)} EUR`;
        buf += CMD.BOLD_ON;
        buf += pad(`${item.qty}x ${item.name}`, totalStr, WIDTH);
        buf += CMD.BOLD_OFF;
        buf += `   ${item.price.toFixed(2)} EUR/u\n`;
        buf += ESC + "J\x06";
      } else {
        buf += CMD.DOUBLE_H;
        buf += CMD.BOLD_ON;
        buf += `${item.qty}x ${item.name}\n`;
        buf += CMD.BOLD_OFF;
        buf += CMD.DOUBLE_OFF;
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
    return new Map(arr.map((o) => [o.id, o]));
  } catch {
    return new Map();
  }
}

function saveOrders(map) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify([...map.values()]), "utf8");
  } catch (err) {
    console.error("Erreur sauvegarde commandes:", err.message);
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

// ----- WebSocket KDS -----
function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

wss.on("connection", (ws) => {
  console.log("KDS connecté");
  // Envoyer toutes les commandes actives au nouveau client
  if (activeOrders.size > 0) {
    activeOrders.forEach((order) => {
      ws.send(JSON.stringify({ type: "new_order", order }));
    });
  }

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "cat_ready") {
        try {
          await sendToPrinter(formatPartialReadyTicket(msg));
          console.log(`Ticket ${msg.catName} PRÊT — Table ${msg.tableNumber} #${msg.orderNum}`);
        } catch (err) {
          console.error("Erreur impression ticket partiel:", err.message);
        }
      }
      if (msg.type === "order_ready") {
        broadcast({ type: "order_ready", orderId: msg.orderId });
        const order = activeOrders.get(msg.orderId);
        if (order) {
          activeOrders.delete(msg.orderId);
          saveOrders(activeOrders);
          console.log(`Commande terminée — Table ${order.tableNumber} #${order.orderNum}`);
        }
      }
    } catch {}
  });
  ws.on("close", () => console.log("KDS déconnecté"));
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
    const orderData = { id: orderId, orderNum, tableNumber, date, items: cuisineAll, receivedAt: Date.now() };
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur d'impression sur http://0.0.0.0:${PORT}`);
  console.log(`KDS disponible sur http://0.0.0.0:${PORT}/kds.html`);
  console.log(`Imprimante cible: ${PRINTER_IP}:${PRINTER_PORT}`);
});
