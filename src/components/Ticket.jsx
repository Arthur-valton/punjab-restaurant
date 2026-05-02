import React, { useState, useRef } from "react";

function getPrintUrl() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.")) {
    return `http://${host}:3001`;
  }
  const saved = localStorage.getItem("punjab_print_url");
  if (saved) return saved.replace(/\/+$/, "");
  return "https://print.restaurant-dev.fr";
}

export default function Ticket({ order, tableNumber, onNewOrder, editingOrderId }) {
  const [printStatus, setPrintStatus] = useState(null); // null | "printing" | "ok" | "error"
  const [printMsg, setPrintMsg] = useState("");
  const now = useRef(new Date());
  const orderNum = useRef(Math.floor(Math.random() * 9000) + 1000);

  const date = now.current.toLocaleDateString("fr-FR");
  const time = now.current.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr = `${date} ${time}`;

  const total = order.reduce((s, i) => s + i.price * i.qty, 0);

  // Grouper par poste pour l'affichage
  const boissons = order.filter((i) => i.category === "Boissons");
  const cuisine = order.filter((i) => i.category !== "Boissons");

  async function handlePrint() {
    setPrintStatus("printing");
    setPrintMsg("");
    try {
      const base = getPrintUrl();
      const url = editingOrderId
        ? `${base}/order/${encodeURIComponent(editingOrderId)}`
        : `${base}/print-all`;
      const method = editingOrderId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order,
          tableNumber,
          orderNum: orderNum.current,
          date: dateStr,
        }),
      });

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
      case "printing":
        return "Impression...";
      case "ok":
        return `Imprime ! (${printMsg})`;
      case "error":
        return "Erreur !";
      default:
        return "Imprimer";
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
          <p>
            <strong>Commande:</strong> #{orderNum.current}
          </p>
          <p>
            <strong>Table:</strong> {tableNumber}
          </p>
          <p>
            <strong>Date:</strong> {dateStr}
          </p>
        </div>

        <div className="ticket-sep" />

        {/* Section Cuisine */}
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

        {/* Section Bar */}
        {boissons.length > 0 && (
          <>
            <p className="ticket-section-title">BAR</p>
            <table className="ticket-items">
              <tbody>
                {boissons.map((item) => (
                  <tr key={item.cartId || item.id}>
                    <td className="c">
                      <strong>{item.qty}x</strong>
                    </td>
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
        <p className="ticket-footer">
          {order.reduce((s, i) => s + i.qty, 0)} article(s)
        </p>
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
