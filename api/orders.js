const OWNER = "Arthur-valton";
const REPO = "punjab-restaurant";
const PATH = "public/active-orders-live.json";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

async function readOrders(token) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (r.status === 404) return { orders: [], sha: null };
  if (!r.ok) throw new Error(`GitHub GET ${r.status}`);
  const file = await r.json();
  const orders = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8"));
  return { orders: Array.isArray(orders) ? orders : [], sha: file.sha };
}

async function writeOrders(token, orders, sha, message) {
  const content = Buffer.from(JSON.stringify(orders)).toString("base64");
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, content, ...(sha && { sha }) }),
  });
  if (!r.ok) throw new Error(`GitHub PUT ${r.status}`);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN missing" });

  // GET — liste les commandes actives (< 12h)
  if (req.method === "GET") {
    try {
      const { orders } = await readOrders(token);
      const cutoff = Date.now() - 12 * 3600 * 1000;
      return res.status(200).json(orders.filter((o) => !o.receivedAt || o.receivedAt > cutoff));
    } catch {
      return res.status(200).json([]);
    }
  }

  // POST — action: "save" | "delete"
  if (req.method === "POST") {
    try {
      const { action, order } = req.body;
      if (!action || !order?.id) return res.status(400).json({ error: "action et order.id requis" });

      const { orders, sha } = await readOrders(token);

      let updated;
      if (action === "save") {
        const idx = orders.findIndex((o) => o.id === order.id);
        updated = idx >= 0 ? orders.map((o, i) => (i === idx ? order : o)) : [...orders, order];
      } else if (action === "delete") {
        updated = orders.filter((o) => o.id !== order.id);
      } else {
        return res.status(400).json({ error: "action invalide" });
      }

      await writeOrders(token, updated, sha, action === "save" ? "Update active orders" : "Close order");
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
