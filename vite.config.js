import fs from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Version de la caisse : un numéro par construction (donc par mise en ligne).
// Il est gravé dans la page et publié dans /version.json : une caisse restée
// ouverte sur l'ancienne version voit la différence et affiche « Nouvelle mise
// à jour » (src/components/MiseAJour.jsx). Elle ne recharge jamais seule.
const VERSION = String(Date.now())

function versionCaisse() {
  return {
    name: 'punjab-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION }) })
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
  define: { 'import.meta.env.VITE_PUNJAB_VERSION': JSON.stringify(VERSION) },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: 'all',
  },
})
