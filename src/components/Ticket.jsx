import React, { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { posteArticle, posteDuChoix, estMenuEclate, ticketDuPoste } from "./postes";
import { texteAllergie, allergieDeLigne } from "./notes";

const ORDERS_API_URL = "https://punjab-restaurant.vercel.app/api/orders";

// Niveaux de piment : 1 = recette normale (rien), 2 = +, 3 = ++, 4 = +++
// ⚠ Même règle que choixTitre dans App.jsx et server/print-server.js
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
function pimentLigne(item) {
  if (pimentMark(item.piment)) return item.piment;
  return choixTitre(item.formulaChoices)?.piment || null;
}
function choixVisibles(item) {
  const choices = item.formulaChoices || [];
  const remplaces = new Set(choices.map((c) => c.remplaceParent).filter(Boolean));
  const titre = choixTitre(choices);
  return choices.filter((c) => !c.remplaceNom && !remplaces.has(c.label) && c !== titre);
}

function pimentMark(level) {
  return ({ 2: "+", 3: "++", 4: "+++" })[level] || "";
}

// Note et allergie sous l'article, là où les sortira le ticket du poste ;
// l'allergie en blanc sur noir, comme sur le papier
function RangNote({ note, allergie }) {
  if (!note && !allergie) return null;
  return (
    <tr>
      <td className="c"></td>
      <td className="l ticket-note-cellule">
        {note && <span className="ticket-note">› {note}</span>}
        {allergie && <span className="ticket-allergie">⚠ {texteAllergie(allergie).toUpperCase()}</span>}
      </td>
      <td className="r"></td>
    </tr>
  );
}

function getPrintUrl() {
  const host = window.location.hostname;
  // En essai (npm run dev), jamais l'imprimante du restaurant, quelle que
  // soit l'adresse utilisee pour ouvrir l'app (IP Tailscale, nom .local).
  if (import.meta.env.DEV || host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.")) {
    return `http://${host}:3001`;
  }
  const saved = localStorage.getItem("punjab_print_url");
  if (saved) return saved.replace(/\/+$/, "");
  return "https://print.restaurant-dev.fr";
}

export default function Ticket({ order, tableNumber, orderNum, orderId, orderType, emporterNum, clientName, clientPhone, clientPickupTime, onNewOrder, editingOrderId, onPrintSuccess, autoPrint, envoi, dateEnvoi, dateOrigine, avant }) {
  const [printStatus, setPrintStatus] = React.useState(null);
  const [printMsg, setPrintMsg] = React.useState("");

  const now = new Date();
  const date = now.toLocaleDateString("fr-FR");
  const time = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  // date du premier envoi (ou de la modification), fixée par la caisse
  const dateStr = dateEnvoi || `${date} ${time}`;

  const total = order.reduce((s, i) => s + i.price * i.qty, 0);

  // Même découpage que les tickets imprimés : CUISINE, DESSERTS, BAR. La ligne
  // d'un menu (avec son prix) reste à sa place ; ses choix qui partent à un
  // autre poste s'y affichent, sans prix, avec le nom du menu.
  const sections = { CUISINE: [], DESSERTS: [], BAR: [] };
  for (const item of order) {
    const propre = ticketDuPoste(posteArticle(item));
    if (!estMenuEclate(item)) { sections[propre].push({ item, choix: choixVisibles(item) }); continue; }
    const ch = item.formulaChoices;
    const remplaces = new Set(ch.map((c) => c.remplaceParent).filter(Boolean));
    sections[propre].push({ item, choix: choixVisibles(item).filter((c) => ticketDuPoste(posteDuChoix(c, ch)) === propre) });
    for (const c of ch) {
      if (remplaces.has(c.label) || c.sousChoixDe) continue;
      const t = ticketDuPoste(posteDuChoix(c, ch));
      if (t === propre) continue;
      const precisions = ch.filter((s) => s.sousChoixDe === c.label).map((s) => s.itemName);
      sections[t].push({ item, depuisMenu: c, precisions });
    }
  }

  // Articles formule sans choix : avertissement non-bloquant
  const missingFormula = order.filter(
    (i) => i.isFormula && i.formulaSteps?.length > 0 && (!i.formulaChoices || i.formulaChoices.length === 0)
  );

  // Impression automatique : quand la table est deja connue, la pause ou la
  // completion d'une commande doit sortir le ticket sans confirmation.
  // Le garde-fou porte sur le numero de commande : sans cela, le composant
  // restant monte d'une impression a l'autre, la seconde ne partait jamais.
  const dernierImprime = useRef(null);
  useEffect(() => {
    if (!autoPrint || dernierImprime.current === envoi) return;
    dernierImprime.current = envoi;
    handlePrint();
  }, [autoPrint, envoi]);

  async function handlePrint() {
    setPrintStatus("printing");
    setPrintMsg("");
    try {
      const base = getPrintUrl();
      const body = { order, tableNumber, orderNum, date: dateStr, dateOrigine, orderId, orderType, emporterNum, clientName, clientPhone, clientPickupTime,
                     ...(avant ? { avant } : {}) };

      let res;
      if (editingOrderId) {
        res = await fetch(`${base}/order/${encodeURIComponent(editingOrderId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        // Si le ThinkCentre ne connaît pas cet orderId, fallback vers print-all
        if (res.status === 404) {
          res = await fetch(`${base}/print-all`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        }
      } else {
        res = await fetch(`${base}/print-all`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur impression");

      // Remonter l'orderId TC pour que App.jsx puisse l'utiliser pour la clôture KDS
      if (onPrintSuccess) onPrintSuccess(data.orderId || null);

      setPrintStatus("ok");
      // modification : le serveur dit combien de tickets sont sortis (0 = rien de changé)
      setPrintMsg(editingOrderId && data.tickets === 0 ? "rien"
        : data.tickets != null ? `${data.tickets} ticket(s)` : "Modifié !");
      // pas de réarmement : un 2e appui réimprimait tout sans DUPLICATA ;
      // ressortir un ticket passe par « En cours > Tickets »
    } catch (err) {
      console.error("Print error:", err);
      setPrintStatus("error");
      setPrintMsg(err.message);
      setTimeout(() => setPrintStatus(null), 3000);
    }
  }

  function getPrintLabel() {
    switch (printStatus) {
      case "printing": return "Impression...";
      case "ok": return printMsg === "rien" ? "Rien de changé pour la cuisine" : `Imprimé ! (${printMsg})`;
      case "error": return "Erreur !";
      default: return "Imprimer";
    }
  }

  function getPrintClass() {
    if (printStatus === "ok") return "btn-print btn-print-ok";
    if (printStatus === "error") return "btn-print btn-print-error";
    return "btn-print";
  }

  return (
    <div className="ticket-overlay">
      <div className="ticket" id="ticket">
        <div className="ticket-header">
          <h2>PUNJAB</h2>
          <p className="ticket-legal">3 RUE RENE D'ANJOU</p>
          <p className="ticket-legal">53200 CHÂTEAU-GONTIER-SUR-MAYENNE</p>
          <p className="ticket-legal">SIRET : 94372706500014</p>
          <p className="ticket-legal">APE : 5610A · TVA : FR12943727065</p>
        </div>

        <div className="ticket-sep" />

        <div className="ticket-info">
          <p><strong>Commande:</strong> #{orderNum}</p>
          {orderType === "emporter"
            ? <p><strong>À EMPORTER:</strong> #{emporterNum}</p>
            : <p><strong>Table:</strong> {tableNumber}</p>
          }
          {orderType === "emporter" && clientName && <p><strong>Nom:</strong> {clientName}</p>}
          {orderType === "emporter" && clientPhone && <p><strong>Tél:</strong> {clientPhone}</p>}
          {orderType === "emporter" && clientPickupTime && <p><strong>Retrait:</strong> {clientPickupTime}</p>}
          <p><strong>Date:</strong> {dateStr}</p>
        </div>

        <div className="ticket-sep" />

        {["CUISINE", "DESSERTS", "BAR"].map((titre) => sections[titre].length > 0 && (
          <React.Fragment key={titre}>
            {/* comme la bande « ! ALLERGIE ! » en tête du ticket de ce poste */}
            {sections[titre].some((e) => (e.depuisMenu ? e.depuisMenu.allergie : allergieDeLigne(e.item))) && (
              <p className="ticket-bande-allergie">! ALLERGIE !</p>
            )}
            <p className="ticket-section-title">{titre}</p>
            <table className="ticket-items">
              <tbody>
                {sections[titre].map(({ item, choix, depuisMenu, precisions }, li) => depuisMenu ? (
                  <React.Fragment key={`m-${li}`}>
                    <tr>
                      <td className="c"><strong>{item.qty}x</strong></td>
                      <td className="l">
                        {depuisMenu.itemName}
                        {pimentMark(depuisMenu.piment) && <span className="ticket-piment">{pimentMark(depuisMenu.piment)}</span>}
                        {precisions.length > 0 && <span className="ticket-formula-choice"> {precisions.join(" / ")}</span>}
                        <span className="ticket-menu-de"> ({nomAffiche(item)})</span>
                      </td>
                      <td className="r"></td>
                    </tr>
                    <RangNote note={depuisMenu.note} allergie={depuisMenu.allergie} />
                  </React.Fragment>
                ) : (
                  <React.Fragment key={item.cartId || item.id || li}>
                    <tr>
                      <td className="c"><strong>{item.qty}x</strong></td>
                      <td className="l">
                        {nomAffiche(item)}
                        {pimentMark(pimentLigne(item)) && <span className="ticket-piment">{pimentMark(pimentLigne(item))}</span>}
                      </td>
                      <td className="r">{(item.price * item.qty).toFixed(2)} &euro;</td>
                    </tr>
                    {/* note de l'article, ou du choix d'une formule qui n'a pas sa propre ligne */}
                    <RangNote note={item.note} />
                    {(item.formulaChoices || [])
                      .filter((c) => c.note && !choixVisibles(item).includes(c)
                        && (!estMenuEclate(item) || ticketDuPoste(posteDuChoix(c, item.formulaChoices)) === titre))
                      .map((c, ci) => <RangNote key={`nt-${ci}`} note={c.note} />)}
                    {choix.map((choice, ci) => (
                      <React.Fragment key={`fc-${ci}`}>
                        <tr>
                          <td className="c"></td>
                          <td className="l ticket-formula-choice">
                            ↳ {choice.label} : {choice.itemName}
                            {pimentMark(choice.piment) && <span className="ticket-piment">{pimentMark(choice.piment)}</span>}
                            {choice.supplement > 0 && <span> +{Number(choice.supplement).toFixed(2)} €</span>}
                          </td>
                          <td className="r"></td>
                        </tr>
                        <RangNote note={choice.note} />
                      </React.Fragment>
                    ))}
                    <RangNote allergie={allergieDeLigne(item)} />
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </React.Fragment>
        ))}

        <div className="ticket-sep" />
        <div className="ticket-total">
          <span>TOTAL</span>
          <span>{total.toFixed(2)} &euro;</span>
        </div>

        <div className="ticket-sep" />
        <p className="ticket-footer">{order.reduce((s, i) => s + i.qty, 0)} article(s)</p>
      </div>

      <div className="ticket-nav no-print">
        {missingFormula.length > 0 && (
          <div className="ticket-formula-warning">
            <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" /> {missingFormula.map(i => i.name).join(", ")} : détails formule manquants. Les choix n'apparaîtront pas sur le ticket cuisine
          </div>
        )}
        <div className="ticket-buttons">
          <button
            className={getPrintClass()}
            onClick={handlePrint}
            disabled={printStatus === "printing" || printStatus === "ok"}
          >
            {getPrintLabel()}
          </button>
          <button className="btn-new" onClick={onNewOrder}>
            Nouveau
          </button>
        </div>
      </div>
    </div>
  );
}
