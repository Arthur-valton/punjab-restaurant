export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN not configured" });

  const OWNER = "Arthur-valton";
  const REPO = "punjab-restaurant";
  const PATH = "public/config.json";
  const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;

  try {
    const headers = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    };

    const getRes = await fetch(API_URL, { headers });
    if (!getRes.ok) throw new Error(`GitHub GET failed: ${getRes.status}`);
    const fileData = await getRes.json();

    const content = Buffer.from(JSON.stringify(req.body, null, 2)).toString("base64");

    const putRes = await fetch(API_URL, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Update config via app", content, sha: fileData.sha }),
    });

    if (!putRes.ok) {
      const err = await putRes.json();
      throw new Error(err.message || `GitHub PUT failed: ${putRes.status}`);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
