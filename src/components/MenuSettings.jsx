import { useState } from "react";

export default function MenuSettings({ menuData, onUpdate, onClose, saveStatus }) {
  const [activeCategory, setActiveCategory] = useState(menuData[0].category);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newSubcat, setNewSubcat] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [printUrl, setPrintUrl] = useState(
    () => localStorage.getItem("punjab_print_url") || ""
  );

  function savePrintUrl(val) {
    const trimmed = val.trim();
    if (trimmed) {
      localStorage.setItem("punjab_print_url", trimmed);
    } else {
      localStorage.removeItem("punjab_print_url");
    }
    setPrintUrl(trimmed);
  }

  const section = menuData.find((s) => s.category === activeCategory);
  const subcategories = [
    ...new Set(section?.items.filter((i) => i.subcategory).map((i) => i.subcategory) || []),
  ];

  function updateField(itemId, field, value) {
    if (field === "price") {
      const price = parseFloat(value.replace(",", "."));
      if (isNaN(price) || price < 0) return;
      onUpdate(menuData.map((s) => ({ ...s, items: s.items.map((i) => i.id === itemId ? { ...i, price } : i) })));
    } else if (field === "name") {
      if (!value.trim()) return;
      onUpdate(menuData.map((s) => ({ ...s, items: s.items.map((i) => i.id === itemId ? { ...i, name: value.trim() } : i) })));
    } else if (field === "subcategory") {
      onUpdate(menuData.map((s) => ({ ...s, items: s.items.map((i) => i.id === itemId ? { ...i, subcategory: value.trim() || undefined } : i) })));
    }
  }

  function deleteItem(itemId) {
    onUpdate(menuData.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== itemId) })));
  }

  function addItem() {
    if (!newName.trim() || !newPrice) return;
    const price = parseFloat(newPrice.replace(",", "."));
    if (isNaN(price) || price < 0) return;
    const allIds = menuData.flatMap((s) => s.items.map((i) => i.id));
    const newId = Math.max(...allIds, 0) + 1;
    const newItem = { id: newId, name: newName.trim(), price, category: activeCategory };
    if (newSubcat.trim()) newItem.subcategory = newSubcat.trim();
    onUpdate(menuData.map((s) => s.category === activeCategory ? { ...s, items: [...s.items, newItem] } : s));
    setNewName("");
    setNewPrice("");
    setNewSubcat("");
  }

  function addCategory() {
    if (!newCategoryName.trim()) return;
    if (menuData.find((s) => s.category === newCategoryName.trim())) return;
    const newMenu = [...menuData, { category: newCategoryName.trim(), items: [] }];
    onUpdate(newMenu);
    setActiveCategory(newCategoryName.trim());
    setNewCategoryName("");
    setShowAddCategory(false);
  }

  function deleteCategory(cat) {
    if (menuData.length <= 1) return;
    const newMenu = menuData.filter((s) => s.category !== cat);
    onUpdate(newMenu);
    setActiveCategory(newMenu[0].category);
  }

  const grouped = section?.items.reduce((acc, item) => {
    const key = item.subcategory || "__none__";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {}) || {};

  const hasSubcategories = subcategories.length > 0;

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Modifier le menu</h2>
          <div className="settings-header-right">
            {saveStatus === "saving" && <span className="save-status save-status--saving">Sauvegarde…</span>}
            {saveStatus === "ok" && <span className="save-status save-status--ok">✓ Sauvegardé</span>}
            {saveStatus === "error" && <span className="save-status save-status--error">✗ Erreur réseau</span>}
            <button className="settings-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="settings-tabs">
          <button
            className="settings-tab settings-tab-add"
            onClick={() => setShowAddCategory((v) => !v)}
          >
            +
          </button>
          {menuData.map((s) => (
            <button
              key={s.category}
              className={`settings-tab ${activeCategory === s.category ? "active" : ""}`}
              onClick={() => setActiveCategory(s.category)}
            >
              {s.category}
            </button>
          ))}
        </div>

        {showAddCategory && (
          <div className="settings-add-category-row">
            <input
              className="settings-add-category-input"
              type="text"
              placeholder="Nom de la catégorie"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
              autoFocus
            />
            <button
              className="settings-add-btn"
              onClick={addCategory}
              disabled={!newCategoryName.trim()}
            >
              ✓
            </button>
          </div>
        )}

        <div className="settings-print-url-section">
          <label className="settings-print-url-label">🖨 Serveur d'impression</label>
          <input
            className="settings-print-url-input"
            type="text"
            placeholder={`Auto (${window.location.hostname}:3001)`}
            value={printUrl}
            onChange={(e) => setPrintUrl(e.target.value)}
            onBlur={(e) => savePrintUrl(e.target.value)}
          />
          <span className="settings-print-url-hint">
            Ex : http://192.168.1.62:3001
          </span>
        </div>

        <div className="settings-items">
          <div className="settings-category-actions">
            <span className="settings-category-title">{activeCategory}</span>
            {menuData.length > 1 && (
              <button
                className="settings-delete-category"
                onClick={() => deleteCategory(activeCategory)}
              >
                Supprimer la catégorie
              </button>
            )}
          </div>

          {hasSubcategories ? (
            Object.entries(grouped).map(([subcat, items]) => (
              <div key={subcat}>
                {subcat !== "__none__" && (
                  <div className="settings-subcat-label">{subcat}</div>
                )}
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} onUpdate={updateField} onDelete={deleteItem} showSubcat />
                ))}
              </div>
            ))
          ) : (
            section?.items.map((item) => (
              <ItemRow key={item.id} item={item} onUpdate={updateField} onDelete={deleteItem} showSubcat />
            ))
          )}

          <div className="settings-add-row settings-add-row--tall">
            <div className="settings-add-fields">
              <input
                className="settings-add-name"
                type="text"
                placeholder="Nom de l'article"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                className="settings-add-subcat"
                type="text"
                placeholder="Sous-catégorie (optionnel)"
                value={newSubcat}
                onChange={(e) => setNewSubcat(e.target.value)}
                list="subcat-list"
              />
              <datalist id="subcat-list">
                {subcategories.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="settings-item-right">
              <input
                className="settings-price-input"
                type="number"
                step="0.5"
                min="0"
                placeholder="Prix"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
              />
              <span className="settings-price-unit">€</span>
              <button
                className="settings-add-btn"
                onClick={addItem}
                disabled={!newName.trim() || !newPrice}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item, onUpdate, onDelete, showSubcat }) {
  return (
    <div className="settings-item settings-item--col">
      <div className="settings-item-top">
        <input
          className="settings-item-name-input"
          type="text"
          defaultValue={item.name}
          onBlur={(e) => onUpdate(item.id, "name", e.target.value)}
        />
        <div className="settings-item-right">
          <input
            className="settings-price-input"
            type="number"
            step="0.5"
            min="0"
            defaultValue={item.price.toFixed(2)}
            onBlur={(e) => onUpdate(item.id, "price", e.target.value)}
          />
          <span className="settings-price-unit">€</span>
          <button className="settings-delete" onClick={() => onDelete(item.id)}>✕</button>
        </div>
      </div>
      {showSubcat && (
        <input
          className="settings-subcat-input"
          type="text"
          placeholder="Sous-catégorie (optionnel)"
          defaultValue={item.subcategory || ""}
          onBlur={(e) => onUpdate(item.id, "subcategory", e.target.value)}
        />
      )}
    </div>
  );
}
