import { useState, useMemo, useEffect } from "react";
import defaultMenu from "./data/menu";
import Ticket from "./components/Ticket";
import MenuSettings from "./components/MenuSettings";
import PasswordGate, { isAppUnlocked, unlockApp, getDefaultPasswords } from "./components/PasswordGate";
import "./App.css";

const GET_MENU_URL = "https://punjab-restaurant.vercel.app/api/get-menu";

// Pastel Apple colors par sous-catégorie
const SUBCAT_COLORS = {
  "Grillades":       { bg: "rgba(255,149,0,0.12)",   active: "rgba(255,149,0,0.22)",   text: "#b36200", border: "rgba(255,149,0,0.4)"   },
  "Salade / Soupe":  { bg: "rgba(52,199,89,0.10)",   active: "rgba(52,199,89,0.22)",   text: "#1e7a3a", border: "rgba(52,199,89,0.4)"    },
  "Beignets":        { bg: "rgba(255,214,10,0.12)",   active: "rgba(255,214,10,0.25)",  text: "#8a6800", border: "rgba(255,214,10,0.5)"   },
  "Naans":           { bg: "rgba(175,82,222,0.10)",   active: "rgba(175,82,222,0.22)",  text: "#7a38bb", border: "rgba(175,82,222,0.4)"   },
  "Poulet":          { bg: "rgba(255,149,0,0.10)",    active: "rgba(255,149,0,0.22)",   text: "#b36200", border: "rgba(255,149,0,0.4)"    },
  "Agneau":          { bg: "rgba(255,59,48,0.08)",    active: "rgba(255,59,48,0.18)",   text: "#c0271e", border: "rgba(255,59,48,0.35)"   },
  "Boeuf":           { bg: "rgba(94,92,230,0.10)",    active: "rgba(94,92,230,0.22)",   text: "#3c3aaa", border: "rgba(94,92,230,0.4)"    },
  "Poisson":         { bg: "rgba(10,132,255,0.10)",   active: "rgba(10,132,255,0.22)",  text: "#005bcc", border: "rgba(10,132,255,0.4)"   },
  "Végétarien":      { bg: "rgba(0,199,190,0.10)",    active: "rgba(0,199,190,0.22)",   text: "#007a74", border: "rgba(0,199,190,0.4)"    },
  "Riz":             { bg: "rgba(255,204,0,0.12)",    active: "rgba(255,204,0,0.25)",   text: "#806000", border: "rgba(255,204,0,0.45)"   },
  "Entrée":          { bg: "rgba(255,45,85,0.08)",    active: "rgba(255,45,85,0.18)",   text: "#c0003a", border: "rgba(255,45,85,0.35)"   },
};
const SAVE_API_URL = "https://punjab-restaurant.vercel.app/api/save-menu";

function getCachedMenu() {
  try {
    const saved = localStorage.getItem("punjab_menu_github");
    return saved ? JSON.parse(saved) : defaultMenu;
  } catch {
    return defaultMenu;
  }
}

function App() {
  const [menuData, setMenuData] = useState(getCachedMenu);

  // Fetch latest menu from GitHub on every load
  useEffect(() => {
    // Chargement menu
    fetch(GET_MENU_URL)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setMenuData(data);
          localStorage.setItem("punjab_menu_github", JSON.stringify(data));
        }
      })
      .catch(() => {});

    // Chargement config (printUrl)
    fetch("https://punjab-restaurant.vercel.app/api/get-config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.printUrl) localStorage.setItem("punjab_print_url", cfg.printUrl);
      })
      .catch(() => {});
  }, []);
  const [orderItems, setOrderItems] = useState([]);
  const [tableNumber, setTableNumber] = useState("");
  const [activeCategory, setActiveCategory] = useState(() => getCachedMenu()[0].category);
  const [cartOpen, setCartOpen] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [ticketData, setTicketData] = useState(null);
  const [showNumpad, setShowNumpad] = useState(false);
  const [numpadValue, setNumpadValue] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [activeSubcategory, setActiveSubcategory] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "ok" | "error"
  const autoLogin = new URLSearchParams(window.location.search).get("autoLogin") === "1";
  const [appUnlocked, setAppUnlocked] = useState(isAppUnlocked || autoLogin);
  const [showSettingsPwd, setShowSettingsPwd] = useState(false);

  async function updateMenu(newMenu) {
    setMenuData(newMenu);
    localStorage.setItem("punjab_menu_github", JSON.stringify(newMenu));
    setSaveStatus("saving");
    try {
      const res = await fetch(SAVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMenu),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setSaveStatus("ok");
      setTimeout(() => setSaveStatus(null), 2500);
    } catch (err) {
      console.error("Failed to save menu to GitHub:", err);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 4000);
    }
  }

  function openNumpad() {
    setNumpadValue(tableNumber);
    setShowNumpad(true);
  }

  function handleNumpadKey(key) {
    if (key === "del") {
      setNumpadValue((v) => v.slice(0, -1));
    } else {
      setNumpadValue((v) => {
        if (v.length >= 3) return v;
        return v + key;
      });
    }
  }

  function confirmNumpad() {
    setTableNumber(numpadValue);
    setShowNumpad(false);
  }

  const activeItems = useMemo(
    () => menuData.find((s) => s.category === activeCategory)?.items || [],
    [activeCategory, menuData]
  );

  const subcategories = useMemo(
    () => [...new Set(activeItems.filter((i) => i.subcategory).map((i) => i.subcategory))],
    [activeItems]
  );

  const visibleItems = useMemo(
    () => activeSubcategory ? activeItems.filter((i) => i.subcategory === activeSubcategory) : activeItems,
    [activeItems, activeSubcategory]
  );

  const totalQty = orderItems.reduce((s, i) => s + i.qty, 0);
  const totalPrice = orderItems.reduce((s, i) => s + i.price * i.qty, 0);

  function addItem(item) {
    setOrderItems((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) return prev.map((i) => i.id === item.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { ...item, qty: 1 }];
    });
  }

  function updateQty(id, qty) {
    if (qty < 1) return removeItem(id);
    setOrderItems((prev) => prev.map((i) => (i.id === id ? { ...i, qty } : i)));
  }

  function removeItem(id) {
    setOrderItems((prev) => prev.filter((i) => i.id !== id));
  }

  function getItemQty(id) {
    return orderItems.find((i) => i.id === id)?.qty || 0;
  }

  function validateOrder() {
    if (!tableNumber) {
      openNumpad();
      return;
    }
    setTicketData({ items: [...orderItems], table: tableNumber });
    setShowTicket(true);
    setCartOpen(false);
  }

  function newOrder() {
    setOrderItems([]);
    setTableNumber("");
    setShowTicket(false);
    setTicketData(null);
  }

  // App-level password gate
  if (!appUnlocked) {
    return (
      <PasswordGate
        title="Punjab Restaurant"
        onSuccess={(pwd) => {
          if (pwd === getDefaultPasswords().app) {
            unlockApp();
            setAppUnlocked(true);
            return true;
          }
          return false;
        }}
      />
    );
  }

  const cartContent = (
    <>
      {orderItems.length > 0 ? (
        <>
          <div className="cart-detail cart-detail--always">
            {orderItems.map((item) => (
              <div key={item.id} className="cart-item">
                <span className="cart-item-name">{item.name}</span>
                <div className="cart-item-controls">
                  <button
                    className={`qty-btn ${item.qty === 1 ? "delete" : ""}`}
                    onClick={() => updateQty(item.id, item.qty - 1)}
                  >
                    {item.qty === 1 ? "✕" : "−"}
                  </button>
                  <span className="cart-item-qty">{item.qty}</span>
                  <button className="qty-btn" onClick={() => updateQty(item.id, item.qty + 1)}>+</button>
                </div>
                <span className="cart-item-subtotal">{(item.price * item.qty).toFixed(2)} &euro;</span>
              </div>
            ))}
            <div className="cart-detail-actions">
              <button className="btn-clear" onClick={() => setOrderItems([])}>Vider</button>
            </div>
          </div>
          <div className="cart-bottom">
            <button className="btn-validate-big" onClick={validateOrder}>
              <span className="btn-validate-label">{tableNumber ? "Valider" : "Entrez la table"}</span>
              <span className="btn-validate-price">{totalPrice.toFixed(2)} &euro;</span>
            </button>
          </div>
        </>
      ) : (
        <div className="cart-empty-sidebar">
          <span>🛒</span>
          <p>Panier vide</p>
        </div>
      )}
    </>
  );

  return (
    <div className="app">

      {/* ── MAIN COLUMN ── */}
      <div className="app-main">

        <header className="app-header">
          <h1>PUNJAB</h1>
          <div className="header-right">
            <button className="settings-btn" onClick={() => setShowSettingsPwd(true)}>⚙</button>
            <button className="table-btn" onClick={openNumpad}>
              <span className="table-btn-label">Table</span>
              <span className="table-btn-value">{tableNumber || "--"}</span>
            </button>
          </div>
        </header>

        <div className="category-tabs">
          {menuData.map((section) => (
            <button
              key={section.category}
              className={`category-tab ${activeCategory === section.category ? "active" : ""}`}
              onClick={() => { setActiveCategory(section.category); setActiveSubcategory(null); }}
            >
              {section.category}
            </button>
          ))}
        </div>

        {subcategories.length > 0 && (
          <div className="subcategory-tabs">
            <button className={`subcategory-tab ${!activeSubcategory ? "active" : ""}`} onClick={() => setActiveSubcategory(null)}>Tous</button>
            {subcategories.map((sub) => {
              const c = SUBCAT_COLORS[sub];
              const isActive = activeSubcategory === sub;
              return (
                <button
                  key={sub}
                  className="subcategory-tab"
                  onClick={() => setActiveSubcategory(sub)}
                  style={c ? {
                    background: isActive ? c.active : c.bg,
                    borderColor: isActive ? c.border : "transparent",
                    color: c.text,
                    fontWeight: isActive ? 700 : 500,
                  } : undefined}
                >
                  {sub}
                </button>
              );
            })}
          </div>
        )}

        <div className="menu-grid">
          <div className="menu-grid-items">
            {visibleItems.map((item) => {
              const qty = getItemQty(item.id);
              const c = item.subcategory ? SUBCAT_COLORS[item.subcategory] : null;
              return (
                <button
                  key={item.id}
                  className="menu-btn"
                  onClick={() => addItem(item)}
                  style={c ? { borderColor: c.border, background: c.bg } : undefined}
                >
                  {qty > 0 && <span className="menu-btn-badge">{qty}</span>}
                  <span className="menu-btn-name">{item.name}</span>
                  <span className="menu-btn-price" style={c ? { color: c.text } : undefined}>
                    {item.price.toFixed(2)} &euro;
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Cart bar — mobile only */}
        {orderItems.length > 0 && (
          <div className="cart-bar">
            {cartOpen && (
              <div className="cart-detail">
                {orderItems.map((item) => (
                  <div key={item.id} className="cart-item">
                    <span className="cart-item-name">{item.name}</span>
                    <div className="cart-item-controls">
                      <button className={`qty-btn ${item.qty === 1 ? "delete" : ""}`} onClick={() => updateQty(item.id, item.qty - 1)}>
                        {item.qty === 1 ? "✕" : "−"}
                      </button>
                      <span className="cart-item-qty">{item.qty}</span>
                      <button className="qty-btn" onClick={() => updateQty(item.id, item.qty + 1)}>+</button>
                    </div>
                    <span className="cart-item-subtotal">{(item.price * item.qty).toFixed(2)} &euro;</span>
                  </div>
                ))}
                <div className="cart-detail-actions">
                  <button className="btn-clear" onClick={() => { setOrderItems([]); setCartOpen(false); }}>Vider</button>
                </div>
              </div>
            )}
            <div className="cart-bottom">
              <button className="cart-expand" onClick={() => setCartOpen(!cartOpen)}>
                <span className="cart-count">{totalQty}</span>
                <span className="cart-expand-arrow">{cartOpen ? "▼" : "▲"}</span>
              </button>
              <button className="btn-validate-big" onClick={validateOrder}>
                <span className="btn-validate-label">{tableNumber ? "Valider" : "Entrez la table"}</span>
                <span className="btn-validate-price">{totalPrice.toFixed(2)} &euro;</span>
              </button>
            </div>
          </div>
        )}
      </div>{/* end app-main */}

      {/* ── SIDEBAR — desktop only ── */}
      <div className="app-sidebar">
        <div className="sidebar-header">
          <span>Commande{tableNumber ? ` — Table ${tableNumber}` : ""}</span>
          {totalQty > 0 && <span className="sidebar-count">{totalQty}</span>}
        </div>
        {cartContent}
      </div>

      {/* Numpad overlay */}
      {showNumpad && (
        <div className="numpad-overlay" onClick={() => setShowNumpad(false)}>
          <div className="numpad" onClick={(e) => e.stopPropagation()}>
            <div className="numpad-display">
              <span className="numpad-display-label">Table N°</span>
              <span className="numpad-display-value">{numpadValue || "--"}</span>
            </div>
            <div className="numpad-grid">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button key={n} className="numpad-key" onClick={() => handleNumpadKey(String(n))}>{n}</button>
              ))}
              <button className="numpad-key numpad-key-del" onClick={() => handleNumpadKey("del")}>⌫</button>
              <button className="numpad-key" onClick={() => handleNumpadKey("0")}>0</button>
              <button className="numpad-key numpad-key-ok" onClick={confirmNumpad} disabled={!numpadValue}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings password prompt */}
      {showSettingsPwd && (
        <PasswordGate
          title="Paramètres — mot de passe"
          onSuccess={(pwd) => {
            if (pwd === getDefaultPasswords().settings) {
              setShowSettingsPwd(false);
              setShowSettings(true);
              return true;
            }
            return false;
          }}
          onCancel={() => setShowSettingsPwd(false)}
        />
      )}

      {/* Settings overlay */}
      {showSettings && (
        <MenuSettings menuData={menuData} onUpdate={updateMenu} onClose={() => setShowSettings(false)} saveStatus={saveStatus} />
      )}

      {/* Ticket overlay */}
      {showTicket && ticketData && (
        <Ticket order={ticketData.items} tableNumber={ticketData.table} onNewOrder={newOrder} />
      )}
    </div>
  );
}

export default App;
