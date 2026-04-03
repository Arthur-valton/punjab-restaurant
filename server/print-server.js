import express from "express";
import cors from "cors";
import net from "net";

const app = express();
const PORT = 3001;
const PRINTER_IP = "192.168.110.21";
const PRINTER_PORT = 9100;

const WIDTH = 48;
// Largeur en mode double (moitie des caracteres)
const WIDTH_DOUBLE = 24;

app.use(cors());
app.use(express.json());

// ----- ESC/POS helpers -----
const ESC = "\x1B";
const GS = "\x1D";

const CMD = {
  INIT: ESC + "@",
  CENTER: ESC + "a\x01",
  LEFT: ESC + "a\x00",
  BOLD_ON: ESC + "E\x01",
  BOLD_OFF: ESC + "E\x00",
  DOUBLE_ON: GS + "!\x11",  // Double hauteur + largeur (x2)
  DOUBLE_H: GS + "!\x01",   // Double hauteur seulement
  QUAD: GS + "!\x33",       // Quadruple : x4 hauteur + x4 largeur
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

// ----- Formatage d'un ticket -----
function formatTicket({ title, order, tableNumber, orderNum, date, showTotal }) {
  let buf = "";

  buf += CMD.INIT;

  // En-tete
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

  // Infos commande
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

  // Articles
  for (const item of order) {
    if (showTotal) {
      // Ticket service : article + total, puis prix unitaire en dessous
      const totalStr = `${(item.price * item.qty).toFixed(2)} EUR`;
      buf += CMD.BOLD_ON;
      buf += pad(`${item.qty}x ${item.name}`, totalStr, WIDTH);
      buf += CMD.BOLD_OFF;
      buf += `   ${item.price.toFixed(2)} EUR/u\n`;
      buf += ESC + "J\x06";
    } else {
      // Ticket cuisine/bar : sans prix, avec espace entre chaque
      buf += CMD.DOUBLE_H;
      buf += CMD.BOLD_ON;
      buf += `${item.qty}x ${item.name}\n`;
      buf += CMD.BOLD_OFF;
      buf += CMD.DOUBLE_OFF;
      buf += ESC + "J\x0C"; // avance de 12 dots (~demi ligne)
    }
  }

  buf += line("=");

  // Total (ticket service uniquement)
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

// ----- Envoi TCP vers imprimante -----
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

// ----- Route POST /print-all : imprime 3 tickets -----
app.post("/print-all", async (req, res) => {
  try {
    const { order, tableNumber, orderNum, date } = req.body;

    if (!order || !tableNumber || !orderNum) {
      return res.status(400).json({ error: "Donnees manquantes" });
    }

    // Separer les articles par poste
    const boissons = order.filter((i) => i.category === "Boissons");
    const cuisine = order.filter((i) => i.category !== "Boissons");

    const common = { tableNumber, orderNum, date };
    const tickets = [];

    // Ticket CUISINE (plats + boissons en dessous) — seulement s'il y en a
    const cuisineAll = [...cuisine, ...boissons];
    if (cuisineAll.length > 0) {
      tickets.push(
        formatTicket({ title: "CUISINE", order: cuisineAll, showTotal: false, ...common })
      );
    }

    // 3) Ticket SERVICE (tout avec total)
    tickets.push(
      formatTicket({ title: "SERVICE", order, showTotal: true, ...common })
    );

    // Envoyer tous les tickets d'un coup
    const allData = tickets.join("");

    console.log(
      `Impression Table ${tableNumber} #${orderNum} : ${tickets.length} ticket(s) (${cuisine.length > 0 ? "cuisine+" : ""}service)`
    );

    await sendToPrinter(allData);

    res.json({
      success: true,
      message: `${tickets.length} ticket(s) imprime(s)`,
      tickets: tickets.length,
    });
  } catch (err) {
    console.error("Erreur impression:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- Route legacy POST /print (un seul ticket) -----
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

// ----- Test de connexion imprimante -----
app.get("/ping-printer", async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      const client = new net.Socket();
      const timeout = setTimeout(() => {
        client.destroy();
        reject(new Error("Timeout"));
      }, 3000);

      client.connect(PRINTER_PORT, PRINTER_IP, () => {
        clearTimeout(timeout);
        client.end();
        resolve();
      });

      client.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    res.json({ success: true, printer: `${PRINTER_IP}:${PRINTER_PORT}` });
  } catch {
    res.status(500).json({
      success: false,
      error: "Imprimante injoignable",
      printer: `${PRINTER_IP}:${PRINTER_PORT}`,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur d'impression sur http://0.0.0.0:${PORT}`);
  console.log(`Imprimante cible: ${PRINTER_IP}:${PRINTER_PORT}`);
});
