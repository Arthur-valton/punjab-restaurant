import { useState } from "react";
import { getDefaultPasswords, savePasswords, lockApp } from "./PasswordGate";

export default function MenuSettings({ menuData, onUpdate, onClose, saveStatus }) {
  const [activeTab, setActiveTab] = useState("menu"); // "menu" | "reglages"
  const [activeCategory, setActiveCategory] = useState(menuData[0].category);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newSubcat, setNewSubcat] = useState("");
  const [newItemType, setNewItemType] = useState("article"); // "article" | "menu"
  const [newFormulaSteps, setNewFormulaSteps] = useState([]);
  const [newStepInputs, setNewStepInputs] = useState({}); // { [stepIndex]: string }
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [printUrl, setPrintUrl] = useState(
    () => localStorage.getItem("punjab_print_url") || ""
  );
  const [urlSaveStatus, setUrlSaveStatus] = useState(null); // null | "saving" | "ok" | "error"

  const pwds = getDefaultPasswords();
  const [appPwd, setAppPwd] = useState(pwds.app);
  const [settingsPwd, setSettingsPwd] = useState(pwds.settings);
  const [pwdSaved, setPwdSaved] = useState(false);

  // Charger l'URL depuis GitHub au montage
  useState(() => {
    fetch("https://punjab-restaurant.vercel.app/api/get-config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.printUrl) {
          setPrintUrl(cfg.printUrl);
          localStorage.setItem("punjab_print_url", cfg.printUrl);
        }
      })
      .catch(() => {});
  });

  async function savePrintUrl(val) {
    const trimmed = val.trim();
    localStorage.setItem("punjab_print_url", trimmed);
    setPrintUrl(trimmed);
    setUrlSaveStatus("saving");
    try {
      const res = await fetch("https://punjab-restaurant.vercel.app/api/save-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printUrl: trimmed }),
      });
      if (!res.ok) throw new Error();
      setUrlSaveStatus("ok");
      setTimeout(() => setUrlSaveStatus(null), 2500);
    } catch {
      setUrlSaveStatus("error");
      setTimeout(() => setUrlSaveStatus(null), 4000);
    }
  }

  function handleSavePasswords() {
    savePasswords({ app: appPwd, settings: settingsPwd });
    setPwdSaved(true);
    setTimeout(() => setPwdSaved(false), 2000);
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
    } else if (field === "piment") {
      onUpdate(menuData.map((s) => ({ ...s, items: s.items.map((i) => i.id === itemId ? { ...i, piment: value } : i) })));
    } else if (field === "isFormula") {
      onUpdate(menuData.map((s) => ({ ...s, items: s.items.map((i) => i.id === itemId ? { ...i, isFormula: value } : i) })));
    } else if (field === "formulaSteps") {
      onUpdate(menuData.map((s) => ({ ...s, items: s.items.map((i) => i.id === itemId ? { ...i, formulaSteps: value || undefined } : i) })));
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
    if (newItemType === "menu" && newFormulaSteps.length > 0) {
      newItem.isFormula = true;
      newItem.formulaSteps = newFormulaSteps;
    }
    onUpdate(menuData.map((s) => s.category === activeCategory ? { ...s, items: [...s.items, newItem] } : s));
    setNewName("");
    setNewPrice("");
    setNewSubcat("");
    setNewFormulaSteps([]);
    setNewStepInputs({});
    setNewItemType("article");
  }

  const STEP_LABELS_NEW = ["Entrée", "Plat", "Dessert", "Naan", "Boisson", "Supplément"];

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

  const allMenuItems = menuData.flatMap((s) => s.items);

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
          <div className="settings-main-tabs">
            <button
              className={`settings-main-tab ${activeTab === "menu" ? "active" : ""}`}
              onClick={() => setActiveTab("menu")}
            >
              Menu
            </button>
            <button
              className={`settings-main-tab ${activeTab === "reglages" ? "active" : ""}`}
              onClick={() => setActiveTab("reglages")}
            >
              Réglages
            </button>
          </div>
          <div className="settings-header-right">
            {saveStatus === "saving" && <span className="save-status save-status--saving">Sauvegarde…</span>}
            {saveStatus === "ok" && <span className="save-status save-status--ok">✓ Sauvegardé</span>}
            {saveStatus === "error" && <span className="save-status save-status--error">✗ Erreur réseau</span>}
            <button className="settings-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* ── ONGLET RÉGLAGES ── */}
        {activeTab === "reglages" && (
          <div className="settings-reglages">
            <div className="settings-reglages-section">
              <div className="settings-reglages-title">🖨 Serveur d'impression</div>
              <input
                className="settings-print-url-input"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                placeholder={`Auto (${window.location.hostname}:3001)`}
                value={printUrl}
                onChange={(e) => setPrintUrl(e.target.value)}
              />
              <span className="settings-print-url-hint">Ex : http://192.168.1.62:3001</span>
              <button className="settings-pwd-save" onClick={() => savePrintUrl(printUrl)}>
                {urlSaveStatus === "saving" ? "Sauvegarde…" : urlSaveStatus === "ok" ? "✓ Enregistré" : urlSaveStatus === "error" ? "✗ Erreur" : "Enregistrer l'URL"}
              </button>
            </div>

            <div className="settings-reglages-section">
              <div className="settings-reglages-title">🔒 Mots de passe</div>
              <div className="settings-pwd-row">
                <span className="settings-pwd-label">Application</span>
                <input
                  className="settings-print-url-input"
                  type="password"
                  value={appPwd}
                  onChange={(e) => setAppPwd(e.target.value)}
                  placeholder="Mot de passe app"
                />
              </div>
              <div className="settings-pwd-row">
                <span className="settings-pwd-label">Paramètres</span>
                <input
                  className="settings-print-url-input"
                  type="password"
                  value={settingsPwd}
                  onChange={(e) => setSettingsPwd(e.target.value)}
                  placeholder="Mot de passe paramètres"
                />
              </div>
              <button className="settings-pwd-save" onClick={handleSavePasswords}>
                {pwdSaved ? "✓ Enregistré" : "Enregistrer les mots de passe"}
              </button>
              <button className="settings-pwd-lock" onClick={() => { lockApp(); window.location.reload(); }}>
                Verrouiller l'application
              </button>
            </div>
          </div>
        )}

        {/* ── ONGLET MENU ── */}
        {activeTab === "menu" && (<>
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
                  <ItemRow key={item.id} item={item} onUpdate={updateField} onDelete={deleteItem} showSubcat allMenuItems={allMenuItems} />
                ))}
              </div>
            ))
          ) : (
            section?.items.map((item) => (
              <ItemRow key={item.id} item={item} onUpdate={updateField} onDelete={deleteItem} showSubcat allMenuItems={allMenuItems} />
            ))
          )}

          <div className="settings-new-item-form">
            {/* Ligne 1 : toggle Article / Menu */}
            <div className="settings-new-type-toggle">
              <button
                className={`settings-new-type-btn ${newItemType === "article" ? "active" : ""}`}
                onClick={() => setNewItemType("article")}
              >Article</button>
              <button
                className={`settings-new-type-btn ${newItemType === "menu" ? "active" : ""}`}
                onClick={() => setNewItemType("menu")}
              >🍽️ Menu</button>
            </div>

            {/* Ligne 2 : nom + prix + bouton + */}
            <div className="settings-new-main-row">
              <input
                className="settings-add-name"
                type="text"
                placeholder="Nom"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
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
              >+</button>
            </div>

            {/* Ligne 3 : sous-catégorie (article) ou étapes (menu) */}
            {newItemType === "article" && (
              <>
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
              </>
            )}

            {newItemType === "menu" && (
              <div className="settings-new-steps">
                {newFormulaSteps.map((step, i) => (
                  <div key={i} className="settings-formula-step-block">
                    <div className="settings-formula-step-header">
                      <select
                        className="settings-formula-select"
                        value={step.label}
                        onChange={(e) => setNewFormulaSteps(newFormulaSteps.map((s, idx) => idx === i ? { ...s, label: e.target.value } : s))}
                      >
                        {STEP_LABELS_NEW.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <button className="settings-formula-remove" onClick={() => {
                        setNewFormulaSteps(newFormulaSteps.filter((_, idx) => idx !== i));
                        setNewStepInputs(prev => { const n = {...prev}; delete n[i]; return n; });
                      }}>✕</button>
                    </div>
                    <div className="settings-formula-articles">
                      {(step.articles || []).map((article, ai) => {
                        const name = typeof article === "string" ? article : article.name;
                        const hasPiment = typeof article === "string" ? false : article.piment;
                        return (
                          <span key={ai} className={`formula-article-chip ${hasPiment ? "piment" : ""}`}>
                            {name}
                            <button
                              className={`formula-chip-piment ${hasPiment ? "active" : ""}`}
                              onClick={() => setNewFormulaSteps(newFormulaSteps.map((s, idx) => idx === i ? {
                                ...s,
                                articles: s.articles.map((a, aii) => aii === ai ? { ...a, piment: !a.piment } : a)
                              } : s))}
                              title="Piment"
                            >🌶️</button>
                            <button onClick={() => setNewFormulaSteps(newFormulaSteps.map((s, idx) => idx === i ? { ...s, articles: s.articles.filter((_, aii) => aii !== ai) } : s))}>✕</button>
                          </span>
                        );
                      })}
                      <div className="settings-formula-article-add">
                        <input
                          className="settings-formula-article-input"
                          type="text"
                          placeholder="Nom de l'article..."
                          value={newStepInputs[i] || ""}
                          onChange={(e) => setNewStepInputs({...newStepInputs, [i]: e.target.value})}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (newStepInputs[i] || "").trim()) {
                              setNewFormulaSteps(newFormulaSteps.map((s, idx) => idx === i ? { ...s, articles: [...(s.articles || []), { name: newStepInputs[i].trim(), piment: false }] } : s));
                              setNewStepInputs({...newStepInputs, [i]: ""});
                            }
                          }}
                        />
                        <button
                          className="settings-formula-article-add-btn"
                          disabled={!(newStepInputs[i] || "").trim()}
                          onClick={() => {
                            setNewFormulaSteps(newFormulaSteps.map((s, idx) => idx === i ? { ...s, articles: [...(s.articles || []), { name: newStepInputs[i].trim(), piment: false }] } : s));
                            setNewStepInputs({...newStepInputs, [i]: ""});
                          }}
                        >+</button>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  className="settings-formula-add"
                  onClick={() => setNewFormulaSteps([...newFormulaSteps, { label: "Plat", articles: [] }])}
                >+ Ajouter une étape</button>
              </div>
            )}
          </div>
        </div>
        </>)}
      </div>
    </div>
  );
}

function ItemRow({ item, onUpdate, onDelete, showSubcat }) {
  const [showFormula, setShowFormula] = useState(false);
  const [stepInputs, setStepInputs] = useState({}); // { [stepIndex]: string }
  const STEP_LABELS = ["Entrée", "Plat", "Dessert", "Naan", "Boisson", "Supplément"];

  function addFormulaStep() {
    const steps = [...(item.formulaSteps || []), { label: "Plat", articles: [] }];
    onUpdate(item.id, "formulaSteps", steps);
  }

  function updateStepLabel(index, value) {
    const steps = (item.formulaSteps || []).map((s, i) => i === index ? { ...s, label: value } : s);
    onUpdate(item.id, "formulaSteps", steps);
  }

  function addArticleToStep(index, name) {
    const steps = (item.formulaSteps || []).map((s, i) =>
      i === index ? { ...s, articles: [...(s.articles || []), { name, piment: false }] } : s
    );
    onUpdate(item.id, "formulaSteps", steps);
  }

  function toggleArticlePiment(stepIndex, articleIndex) {
    const steps = (item.formulaSteps || []).map((s, i) =>
      i === stepIndex ? {
        ...s,
        articles: (s.articles || []).map((a, ai) =>
          ai === articleIndex ? { ...a, piment: !a.piment } : a
        )
      } : s
    );
    onUpdate(item.id, "formulaSteps", steps);
  }

  function removeArticleFromStep(index, articleIndex) {
    const steps = (item.formulaSteps || []).map((s, i) =>
      i === index ? { ...s, articles: (s.articles || []).filter((_, ai) => ai !== articleIndex) } : s
    );
    onUpdate(item.id, "formulaSteps", steps);
  }

  function removeStep(index) {
    const steps = (item.formulaSteps || []).filter((_, i) => i !== index);
    onUpdate(item.id, "formulaSteps", steps.length > 0 ? steps : null);
    if (steps.length === 0) onUpdate(item.id, "isFormula", false);
  }

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
          <button
            className={`settings-piment-toggle ${item.piment ? "active" : ""}`}
            onClick={() => onUpdate(item.id, "piment", !item.piment)}
            title="Option piment"
          >
            🌶️
          </button>
          <button
            className={`settings-piment-toggle ${item.isFormula ? "active" : ""}`}
            onClick={() => { onUpdate(item.id, "isFormula", !item.isFormula); setShowFormula(!item.isFormula); }}
            title="Menu/Formule"
          >
            🍽️
          </button>
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
      {item.isFormula && (
        <div className="settings-formula">
          <div className="settings-formula-header">
            <span>Étapes du menu</span>
            <button className="settings-formula-add" onClick={() => { addFormulaStep(); setShowFormula(true); }}>+ Ajouter étape</button>
          </div>
          {(item.formulaSteps || []).map((step, i) => (
            <div key={i} className="settings-formula-step-block">
              <div className="settings-formula-step-header">
                <select
                  className="settings-formula-select"
                  value={step.label}
                  onChange={(e) => updateStepLabel(i, e.target.value)}
                >
                  {STEP_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <button className="settings-formula-remove" onClick={() => removeStep(i)}>✕</button>
              </div>
              <div className="settings-formula-articles">
                {(step.articles || []).map((article, ai) => {
                  const name = typeof article === "string" ? article : article.name;
                  const hasPiment = typeof article === "string" ? false : article.piment;
                  return (
                    <span key={ai} className={`formula-article-chip ${hasPiment ? "piment" : ""}`}>
                      {name}
                      <button
                        className={`formula-chip-piment ${hasPiment ? "active" : ""}`}
                        onClick={() => toggleArticlePiment(i, ai)}
                        title="Piment"
                      >🌶️</button>
                      <button onClick={() => removeArticleFromStep(i, ai)}>✕</button>
                    </span>
                  );
                })}
                <div className="settings-formula-article-add">
                  <input
                    className="settings-formula-article-input"
                    type="text"
                    placeholder="Nom de l'article..."
                    value={stepInputs[i] || ""}
                    onChange={(e) => setStepInputs({...stepInputs, [i]: e.target.value})}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (stepInputs[i] || "").trim()) {
                        addArticleToStep(i, stepInputs[i].trim());
                        setStepInputs({...stepInputs, [i]: ""});
                      }
                    }}
                  />
                  <button
                    className="settings-formula-article-add-btn"
                    disabled={!(stepInputs[i] || "").trim()}
                    onClick={() => {
                      addArticleToStep(i, stepInputs[i].trim());
                      setStepInputs({...stepInputs, [i]: ""});
                    }}
                  >+</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
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
