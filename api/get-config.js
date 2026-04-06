export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const token = process.env.GITHUB_TOKEN;
  const OWNER = "Arthur-valton";
  const REPO = "punjab-restaurant";
  const PATH = "public/config.json";

  try {
    const headers = { Accept: "application/vnd.github.v3+json" };
    if (token) headers.Authorization = `token ${token}`;

    const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`, { headers });
    if (!r.ok) throw new Error(`GitHub GET failed: ${r.status}`);

    const file = await r.json();
    const content = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8"));
    res.status(200).json(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
