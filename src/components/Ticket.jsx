import { useState, useRef } from "react";

function getPrintUrl() {
  const saved = localStorage.getItem("punjab_print_url");
  if (saved) return saved.replace(/\/+$/, "");
  return "https://print.restaurant-dev.fr";
}

export default function Ticket({ order, tableNumber, onNewOrder }) {
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
      const res = await fetch(`${getPrintUrl()}/print-all`, {
        method: "POST",
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
      setPrintMsg(`${data.tickets} ticket(s)`);
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
                  <tr key={item.id}>
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

        {/* Section Bar */}
        {boissons.length > 0 && (
          <>
            <p className="ticket-section-title">BAR</p>
            <table className="ticket-items">
              <tbody>
                {boissons.map((item) => (
                  <tr key={item.id}>
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
