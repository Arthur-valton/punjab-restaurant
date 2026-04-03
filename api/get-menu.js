// Vercel serverless function — lit menu.json depuis GitHub API (sans cache CDN)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const token = process.env.GITHUB_TOKEN;
  const OWNER = "Arthur-valton";
  const REPO = "punjab-restaurant";
  const PATH = "public/menu.json";

  try {
    const headers = {
      Accept: "application/vnd.github.v3+json",
    };
    if (token) headers.Authorization = `token ${token}`;

    const getRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`,
      { headers }
    );

    if (!getRes.ok) throw new Error(`GitHub GET failed: ${getRes.status}`);

    const fileData = await getRes.json();
    const content = JSON.parse(
      Buffer.from(fileData.content, "base64").toString("utf-8")
    );

    res.status(200).json(content);
  } catch (err) {
    console.error("get-menu error:", err);
    res.status(500).json({ error: err.message });
  }
}
