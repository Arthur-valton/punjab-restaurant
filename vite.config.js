import fs from 'node:fs'
import crypto from 'node:crypto'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Version de la caisse : l'empreinte du code construit (les fichiers JS et CSS
// portent déjà l'empreinte de leur contenu). Elle ne change donc que quand le
// code change : les commandes enregistrées sur GitHub relancent une
// construction Vercel, mais le code et la version restent les mêmes.
// Publiée dans /version.json : une caisse restée ouverte sur l'ancien code
// affiche « Nouvelle mise à jour » (src/components/MiseAJour.jsx). Elle ne
// recharge jamais seule.
function versionCaisse() {
  return {
    name: 'punjab-version',
    generateBundle(_options, bundle) {
      const code = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f)).sort().join('|')
      const version = crypto.createHash('sha1').update(code).digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) })
    },
    // En développement, /version.json lit le fichier .version.local (ignoré
    // par git) : en changer le contenu simule une mise en ligne.
    configureServer(server) {
      server.middlewares.use('/version.json', (req, res) => {
        let version = 'dev'
        try { version = fs.readFileSync(new URL('./.version.local', import.meta.url), 'utf8').trim() || 'dev' } catch { /* pas de démonstration en cours */ }
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify({ version }))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionCaisse()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: 'all',
  },
})
