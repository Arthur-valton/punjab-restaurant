import React from "react";

const ORDERS_API_URL = "https://punjab-restaurant.vercel.app/api/orders";

function getPrintUrl() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.")) {
    return `http://${host}:3001`;
  }
  const saved = localStorage.getItem("punjab_print_url");
  if (saved) return saved.replace(/\/+$/, "");
  return "https://print.restaurant-dev.fr";
}

export default function Ticket({ order, tableNumber, orderNum, orderId, onNewOrder, editingOrderId }) {
  const [printStatus, setPrintStatus] = React.useState(null);
  const [printMsg, setPrintMsg] = React.useState("");

  const now = new Date();
  const date = now.toLocaleDateString("fr-FR");
  const time = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const dateStr = `${date} ${time}`;

  const total = order.reduce((s, i) => s + i.price * i.qty, 0);

  const boissons = order.filter((i) => i.category === "Boissons");
  const cuisine = order.filter((i) => i.category !== "Boissons");

  async function handlePrint() {
    setPrintStatus("printing");
    setPrintMsg("");
    try {
      const base = getPrintUrl();
      const body = { order, tableNumber, orderNum, date: dateStr, orderId };

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

      setPrintStatus("ok");
      setPrintMsg(editingOrderId ? "Modifié !" : `${data.tickets} ticket(s)`);
      setTimeout(() => setPrintStatus(null), 2500);
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
      case "ok": return `Imprimé ! (${printMsg})`;
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
          <p className="ticket-legal">APE : 5610A — TVA : FR12943727065</p>
        </div>

        <div className="ticket-sep" />

        <div className="ticket-info">
          <p><strong>Commande:</strong> #{orderNum}</p>
          <p><strong>Table:</strong> {tableNumber}</p>
          <p><strong>Date:</strong> {dateStr}</p>
        </div>

        <div className="ticket-sep" />

        {cuisine.length > 0 && (
          <>
            <p className="ticket-section-title">CUISINE</p>
            <table className="ticket-items">
              <tbody>
                {cuisine.map((item) => (
                  <React.Fragment key={item.cartId || item.id}>
                    <tr>
                      <td className="c"><strong>{item.qty}x</strong></td>
                      <td className="l">
                        {item.name}
                        {item.piment && <span className="ticket-piment">{"🌶️".repeat(item.piment)}</span>}
                      </td>
                      <td className="r">{(item.price * item.qty).toFixed(2)} &euro;</td>
                    </tr>
                    {item.formulaChoices && item.formulaChoices.map((choice, ci) => (
                      <tr key={`fc-${ci}`}>
                        <td className="c"></td>
                        <td className="l ticket-formula-choice">
                          ↳ {choice.label} : {choice.itemName}
                          {choice.piment > 1 && <span className="ticket-piment">{"🌶️".repeat(choice.piment)}</span>}
                        </td>
                        <td className="r"></td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </>
        )}

        {boissons.length > 0 && (
          <>
            <p className="ticket-section-title">BAR</p>
            <table className="ticket-items">
              <tbody>
                {boissons.map((item) => (
                  <tr key={item.cartId || item.id}>
                    <td className="c"><strong>{item.qty}x</strong></td>
                    <td className="l">{item.name}</td>
                    <td className="r">{(item.price * item.qty).toFixed(2)} &euro;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="ticket-sep" />
        <div className="ticket-total">
          <span>TOTAL</span>
          <span>{total.toFixed(2)} &euro;</span>
        </div>

        <div className="ticket-sep" />
        <p className="ticket-footer">{order.reduce((s, i) => s + i.qty, 0)} article(s)</p>
      </div>

      <div className="ticket-nav no-print">
        <button
          className={getPrintClass()}
          onClick={handlePrint}
          disabled={printStatus === "printing"}
        >
          {getPrintLabel()}
        </button>
        <button className="btn-new" onClick={onNewOrder}>
          Nouveau
        </button>
      </div>
    </div>
  );
}
