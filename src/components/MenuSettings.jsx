import { useState, useMemo } from "react";
import { getDefaultPasswords, savePasswords, lockApp } from "./PasswordGate";

const STEP_LABELS = ["Entrée", "Plat", "Dessert", "Naan", "Boisson", "Supplément"];

export default function MenuSettings({ menuData, onUpdate, onClose, saveStatus }) {
  const [activeTab, setActiveTab]           = useState("menu");
  const [activeCategory, setActiveCategory] = useState(menuData[0]?.category || "");
  const [searchQuery, setSearchQuery]       = useState("");
  const [editingItem, setEditingItem]       = useState(null);
  const [showAddSheet, setShowAddSheet]     = useState(false);
  const [deleteTarget, setDeleteTarget]     = useState(null);
  const [showAddCat, setShowAddCat]         = useState(false);
  const [newCatName, setNewCatName]         = useState("");
  const [showReorder, setShowReorder]       = useState(false);
  const [reorderList, setReorderList]       = useState([]);
  const [dragOverIdx, setDragOverIdx]       = useState(null);

  // Form ajout
  const [newName, setNewName]                   = useState("");
  const [newPrice, setNewPrice]                 = useState("");
  const [newSubcat, setNewSubcat]               = useState("");
  const [newPiment, setNewPiment]               = useState(false);
  const [newItemType, setNewItemType]           = useState("article");
  const [newFormulaSteps, setNewFormulaSteps]   = useState([]);
  const [newStepInputs, setNewStepInputs]       = useState({});

  // Réglages
  const [printUrl, setPrintUrl]       = useState(() => localStorage.getItem("punjab_print_url") || "");
  const [urlStatus, setUrlStatus]     = useState(null);
  const pwds = getDefaultPasswords();
  const [appPwd, setAppPwd]           = useState(pwds.app);
  const [settPwd, setSettPwd]         = useState(pwds.settings);
  const [pwdSaved, setPwdSaved]       = useState(false);
  const [showAppPwd, setShowAppPwd]   = useState(false);
  const [showSettPwd, setShowSettPwd] = useState(false);

  const section = menuData.find(s => s.category === activeCategory);

  const subcategories = useMemo(() =>
    [...new Set(section?.items.filter(i => i.subcategory).map(i => i.subcategory) || [])],
    [section]
  );

  const filteredItems = useMemo(() => {
    const items = section?.items || [];
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(q));
  }, [section, searchQuery]);

  const grouped = useMemo(() => {
    const result = {};
    for (const item of filteredItems) {
      const key = item.subcategory || "__none__";
      if (!result[key]) result[key] = [];
      result[key].push(item);
    }
    return result;
  }, [filteredItems]);

  /* ── Helpers ── */
  function applyUpdate(updater) {
    onUpdate(menuData.map(s => ({ ...s, items: s.items.map(updater) })));
  }

  function saveEditingItem() {
    if (!editingItem) return;
    const price = parseFloat(String(editingItem.price).replace(",", "."));
    if (!editingItem.name?.trim() || isNaN(price)) return;
    onUpdate(menuData.map(s => ({
      ...s,
      items: s.items.map(i => i.id === editingItem.id ? {
        ...i,
        name: editingItem.name.trim(),
        price,
        subcategory: editingItem.subcategory?.trim() || undefined,
        piment: editingItem.piment || false,
        isFormula: editingItem.isFormula || false,
        formulaSteps: editingItem.formulaSteps || undefined,
      } : i),
    })));
    setEditingItem(null);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.type === "category") {
      const newMenu = menuData.filter(s => s.category !== deleteTarget.name);
      onUpdate(newMenu);
      setActiveCategory(newMenu[0]?.category || "");
    } else {
      onUpdate(menuData.map(s => ({ ...s, items: s.items.filter(i => i.id !== deleteTarget.id) })));
      setEditingItem(null);
    }
    setDeleteTarget(null);
  }

  function addItem() {
    if (!newName.trim() || !newPrice) return;
    const price = parseFloat(newPrice.replace(",", "."));
    if (isNaN(price) || price < 0) return;
    const allIds = menuData.flatMap(s => s.items.map(i => i.id));
    const newId = Math.max(...allIds, 0) + 1;
    const item = { id: newId, name: newName.trim(), price, category: activeCategory };
    if (newSubcat.trim()) item.subcategory = newSubcat.trim();
    if (newPiment) item.piment = true;
    if (newItemType === "menu" && newFormulaSteps.length > 0) {
      item.isFormula = true;
      item.formulaSteps = newFormulaSteps;
    }
    onUpdate(menuData.map(s => s.category === activeCategory ? { ...s, items: [...s.items, item] } : s));
    setNewName(""); setNewPrice(""); setNewSubcat(""); setNewPiment(false);
    setNewItemType("article"); setNewFormulaSteps([]); setNewStepInputs({});
    setShowAddSheet(false);
  }

  function addCategory() {
    const name = newCatName.trim();
    if (!name || menuData.find(s => s.category === name)) return;
    onUpdate([...menuData, { category: name, items: [] }]);
    setActiveCategory(name);
    setNewCatName(""); setShowAddCat(false);
  }

  function openReorder() {
    setReorderList(menuData.map(s => s.category));
    setShowReorder(true);
  }

  function moveCategory(idx, dir) {
    const list = [...reorderList];
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    setReorderList(list);
  }

  function confirmReorder() {
    const reordered = reorderList.map(cat => menuData.find(s => s.category === cat)).filter(Boolean);
    onUpdate(reordered);
    setShowReorder(false);
  }

  // Drag & drop handlers
  function onDragStart(e, idx) { e.dataTransfer.setData("idx", idx); }
  function onDragOver(e, idx)  { e.preventDefault(); setDragOverIdx(idx); }
  function onDrop(e, idx) {
    const from = parseInt(e.dataTransfer.getData("idx"));
    if (from === idx) { setDragOverIdx(null); return; }
    const list = [...reorderList];
    const [moved] = list.splice(from, 1);
    list.splice(idx, 0, moved);
    setReorderList(list);
    setDragOverIdx(null);
  }

  async function savePrintUrl() {
    const val = printUrl.trim();
    localStorage.setItem("punjab_print_url", val);
    setUrlStatus("saving");
    try {
      const res = await fetch("https://punjab-restaurant.vercel.app/api/save-config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printUrl: val }),
      });
      if (!res.ok) throw new Error();
      setUrlStatus("ok"); setTimeout(() => setUrlStatus(null), 2500);
    } catch { setUrlStatus("error"); setTimeout(() => setUrlStatus(null), 4000); }
  }

  function handleSavePasswords() {
    savePasswords({ app: appPwd, settings: settPwd });
    setPwdSaved(true); setTimeout(() => setPwdSaved(false), 2000);
  }

  /* ── Formula helpers (edition) ── */
  function editStepLabel(i, val) {
    const steps = (editingItem.formulaSteps || []).map((s, idx) => idx === i ? { ...s, label: val } : s);
    setEditingItem({ ...editingItem, formulaSteps: steps });
  }
  function editAddArticle(i, name) {
    const steps = (editingItem.formulaSteps || []).map((s, idx) =>
      idx === i ? { ...s, articles: [...(s.articles || []), { name, piment: false }] } : s
    );
    setEditingItem({ ...editingItem, formulaSteps: steps });
  }
  function editTogglePiment(i, ai) {
    const steps = (editingItem.formulaSteps || []).map((s, si) =>
      si === i ? { ...s, articles: (s.articles || []).map((a, aii) => aii === ai ? { ...a, piment: !a.piment } : a) } : s
    );
    setEditingItem({ ...editingItem, formulaSteps: steps });
  }
  function editRemoveArticle(i, ai) {
    const steps = (editingItem.formulaSteps || []).map((s, si) =>
      si === i ? { ...s, articles: (s.articles || []).filter((_, aii) => aii !== ai) } : s
    );
    setEditingItem({ ...editingItem, formulaSteps: steps });
  }
  function editArticlePrice(i, ai, val) {
    const steps = (editingItem.formulaSteps || []).map((s, si) =>
      si === i
        ? { ...s, articles: s.articles.map((a, k) => {
              if (k !== ai) return a;
              const base = typeof a === "string" ? { name: a } : { ...a };
              if (val === "") delete base.price;
              else base.price = parseFloat(val);
              return base;
            }) }
        : s
    );
    setEditingItem({ ...editingItem, formulaSteps: steps });
  }
  function editToggleRemplaceNom(i) {
    const steps = (editingItem.formulaSteps || []).map((s, si) =>
      si === i ? { ...s, remplaceNom: !s.remplaceNom } : s
    );
    setEditingItem({ ...editingItem, formulaSteps: steps });
  }
  function editRemoveStep(i) {
    const steps = (editingItem.formulaSteps || []).filter((_, si) => si !== i);
    setEditingItem({ ...editingItem, formulaSteps: steps.length ? steps : undefined, isFormula: steps.length > 0 });
  }

  const [editStepInputs, setEditStepInputs] = useState({});

  /* ═══════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════ */
  return (
    <div className="ap-overlay">
      <div className="ap-panel">

        {/* ── Header ── */}
        <div className="ap-header">
          <div className="ap-header-left">
            {saveStatus === "saving" && <span className="ap-save saving">Sauvegarde…</span>}
            {saveStatus === "ok"      && <span className="ap-save ok">✓ Sauvegardé</span>}
            {saveStatus === "error"   && <span className="ap-save error">✗ Erreur</span>}
          </div>
          <div className="ap-segmented">
            <button className={`ap-seg ${activeTab === "menu" ? "active" : ""}`} onClick={() => setActiveTab("menu")}>Menu</button>
            <button className={`ap-seg ${activeTab === "reglages" ? "active" : ""}`} onClick={() => setActiveTab("reglages")}>Réglages</button>
          </div>
          <button className="ap-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* ══════════════════════════════
            ONGLET MENU
        ══════════════════════════════ */}
        {activeTab === "menu" && (
          <div className="ap-tab-content">

            {/* Catégories */}
            <div className="ap-cats-row">
              {menuData.map(s => (
                <button key={s.category}
                  className={`ap-cat-pill ${activeCategory === s.category ? "active" : ""}`}
                  onClick={() => { setActiveCategory(s.category); setSearchQuery(""); }}>
                  {s.category}
                  <span className="ap-cat-count">{s.items.length}</span>
                </button>
              ))}
              <button className="ap-cat-pill ap-cat-new" onClick={() => setShowAddCat(v => !v)}>+ Cat.</button>
              <button className="ap-cat-pill ap-cat-reorder" onClick={openReorder} title="Réorganiser">↕</button>
            </div>

            {showAddCat && (
              <div className="ap-inline-row">
                <input className="ap-inline-input" placeholder="Nom de la catégorie…"
                  value={newCatName} onChange={e => setNewCatName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addCategory()} autoFocus />
                <button className="ap-inline-btn" onClick={addCategory}>Ajouter</button>
              </div>
            )}

            {/* Search */}
            <div className="ap-search-wrap">
              <span className="ap-search-icon">🔍</span>
              <input className="ap-search-input" placeholder="Rechercher un article…"
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              {searchQuery && (
                <button className="ap-search-clear" onClick={() => setSearchQuery("")}>✕</button>
              )}
            </div>

            {/* Liste articles */}
            <div className="ap-list-area">
              {Object.keys(grouped).length === 0 && (
                <div className="ap-empty-state">
                  {searchQuery ? "Aucun résultat pour « " + searchQuery + " »" : "Aucun article dans cette catégorie"}
                </div>
              )}

              {Object.entries(grouped).map(([subcat, items]) => (
                <div key={subcat} className="ap-group">
                  {subcat !== "__none__" && (
                    <div className="ap-group-label">{subcat.toUpperCase()}</div>
                  )}
                  <div className="ap-card">
                    {items.map((item, idx) => (
                      <div key={item.id}>
                        <button className="ap-item-row" onClick={() => { setEditingItem({ ...item }); setEditStepInputs({}); }}>
                          <div className="ap-item-left">
                            {item.isFormula && <span className="ap-badge ap-badge--menu">Menu</span>}
                            {item.piment    && <span className="ap-badge ap-badge--piment">🌶️</span>}
                            <span className="ap-item-name">{item.name}</span>
                          </div>
                          <div className="ap-item-right">
                            <span className="ap-item-price">{item.price.toFixed(2)} €</span>
                            <span className="ap-chevron">›</span>
                          </div>
                        </button>
                        {idx < items.length - 1 && <div className="ap-row-sep" />}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {!searchQuery && menuData.length > 1 && (
                <button className="ap-delete-cat-btn"
                  onClick={() => setDeleteTarget({ type: "category", name: activeCategory })}>
                  Supprimer la catégorie « {activeCategory} »
                </button>
              )}
            </div>

            {/* FAB */}
            <button className="ap-fab" onClick={() => setShowAddSheet(true)}>＋</button>
          </div>
        )}

        {/* ══════════════════════════════
            ONGLET RÉGLAGES
        ══════════════════════════════ */}
        {activeTab === "reglages" && (
          <div className="ap-tab-content ap-settings-content">

            <div className="ap-settings-group">
              <div className="ap-settings-label">SERVEUR D'IMPRESSION</div>
              <div className="ap-card">
                <div className="ap-settings-row">
                  <span className="ap-row-label">🖨️ URL</span>
                  <input className="ap-row-input" type="url" inputMode="url" autoCapitalize="none"
                    placeholder={`Auto (local:3001)`} value={printUrl}
                    onChange={e => setPrintUrl(e.target.value)} />
                </div>
                <div className="ap-row-sep" />
                <div className="ap-settings-row ap-settings-row--hint">
                  <span className="ap-hint-text">Ex : http://192.168.1.62:3001</span>
                  <button className="ap-pill-btn" onClick={savePrintUrl}>
                    {urlStatus === "saving" ? "…" : urlStatus === "ok" ? "✓ OK" : urlStatus === "error" ? "✗ Erreur" : "Enregistrer"}
                  </button>
                </div>
              </div>
            </div>

            <div className="ap-settings-group">
              <div className="ap-settings-label">MOTS DE PASSE</div>
              <div className="ap-card">
                <div className="ap-settings-row">
                  <span className="ap-row-label">Application</span>
                  <div className="ap-pwd-row">
                    <input className="ap-row-input" type={showAppPwd ? "text" : "password"}
                      value={appPwd} onChange={e => setAppPwd(e.target.value)} placeholder="Mot de passe" />
                    <button className="ap-eye-btn" onClick={() => setShowAppPwd(v => !v)}>
                      {showAppPwd ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
                <div className="ap-row-sep" />
                <div className="ap-settings-row">
                  <span className="ap-row-label">Paramètres</span>
                  <div className="ap-pwd-row">
                    <input className="ap-row-input" type={showSettPwd ? "text" : "password"}
                      value={settPwd} onChange={e => setSettPwd(e.target.value)} placeholder="Mot de passe" />
                    <button className="ap-eye-btn" onClick={() => setShowSettPwd(v => !v)}>
                      {showSettPwd ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
                <div className="ap-row-sep" />
                <div className="ap-settings-row ap-settings-row--center">
                  <button className="ap-pill-btn" onClick={handleSavePasswords}>
                    {pwdSaved ? "✓ Enregistré" : "Enregistrer"}
                  </button>
                </div>
              </div>
            </div>

            <div className="ap-settings-group">
              <div className="ap-card">
                <button className="ap-settings-row ap-row-destructive"
                  onClick={() => { lockApp(); window.location.reload(); }}>
                  Verrouiller l'application
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════
          BOTTOM SHEET — ÉDITION
      ══════════════════════════════ */}
      {editingItem && (
        <div className="ap-backdrop" onClick={() => setEditingItem(null)}>
          <div className="ap-sheet" onClick={e => e.stopPropagation()}>
            <div className="ap-sheet-handle" />
            <div className="ap-sheet-title">Modifier</div>

            <div className="ap-sheet-scroll">
              <div className="ap-card ap-sheet-card">
                {/* Nom */}
                <div className="ap-settings-row">
                  <span className="ap-row-label">Nom</span>
                  <input className="ap-row-input" type="text" value={editingItem.name}
                    onChange={e => setEditingItem({ ...editingItem, name: e.target.value })} />
                </div>
                <div className="ap-row-sep" />
                {/* Prix */}
                <div className="ap-settings-row">
                  <span className="ap-row-label">Prix</span>
                  <div className="ap-price-row">
                    <input className="ap-row-input ap-row-input--price" type="number" step="0.5" min="0"
                      value={editingItem.price}
                      onChange={e => setEditingItem({ ...editingItem, price: e.target.value })} />
                    <span className="ap-price-unit">€</span>
                  </div>
                </div>
                <div className="ap-row-sep" />
                {/* Sous-catégorie */}
                <div className="ap-settings-row">
                  <span className="ap-row-label">Sous-cat.</span>
                  <input className="ap-row-input" type="text" placeholder="Optionnel"
                    value={editingItem.subcategory || ""}
                    onChange={e => setEditingItem({ ...editingItem, subcategory: e.target.value })}
                    list="edit-subcats" />
                  <datalist id="edit-subcats">
                    {subcategories.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div className="ap-row-sep" />
                {/* Piment toggle */}
                <div className="ap-settings-row">
                  <span className="ap-row-label">🌶️ Piment</span>
                  <button
                    className={`ap-toggle ${editingItem.piment ? "on" : ""}`}
                    onClick={() => setEditingItem({ ...editingItem, piment: !editingItem.piment })}>
                    <span className="ap-toggle-thumb" />
                  </button>
                </div>
                <div className="ap-row-sep" />
                {/* Formule toggle */}
                <div className="ap-settings-row">
                  <span className="ap-row-label">🍽️ Menu / Formule</span>
                  <button
                    className={`ap-toggle ${editingItem.isFormula ? "on" : ""}`}
                    onClick={() => setEditingItem({ ...editingItem, isFormula: !editingItem.isFormula, formulaSteps: editingItem.isFormula ? undefined : [] })}>
                    <span className="ap-toggle-thumb" />
                  </button>
                </div>
              </div>

              {/* Étapes de formule */}
              {editingItem.isFormula && (
                <div className="ap-formula-section">
                  <div className="ap-settings-label">ÉTAPES DU MENU</div>
                  {(editingItem.formulaSteps || []).map((step, i) => (
                    <div key={i} className="ap-card ap-sheet-card ap-formula-block">
                      <div className="ap-settings-row">
                        <select className="ap-row-input" value={step.label} onChange={e => editStepLabel(i, e.target.value)}>
                          {STEP_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                        <button className="ap-remove-btn" onClick={() => editRemoveStep(i)}>✕</button>
                      </div>
                      <div className="ap-settings-row">
                        <span className="ap-row-label">Le choix remplace le nom</span>
                        <button
                          className={`ap-toggle ${step.remplaceNom ? "on" : ""}`}
                          onClick={() => editToggleRemplaceNom(i)}>
                          <span className="ap-toggle-thumb" />
                        </button>
                      </div>
                      <div className="ap-row-sep" />
                      <div className="ap-chips-wrap">
                        {(step.articles || []).map((a, ai) => {
                          const name = typeof a === "string" ? a : a.name;
                          const hasPiment = typeof a !== "string" && a.piment;
                          return (
                            <span key={ai} className={`formula-article-chip ${hasPiment ? "piment" : ""}`}>
                              {name}
                              <input
                                className="formula-chip-price"
                                type="number" step="0.5" min="0" placeholder="€"
                                value={typeof a === "string" || a.price == null ? "" : a.price}
                                onChange={e => editArticlePrice(i, ai, e.target.value)} />
                              <button className={`formula-chip-piment ${hasPiment ? "active" : ""}`} onClick={() => editTogglePiment(i, ai)}>🌶️</button>
                              <button onClick={() => editRemoveArticle(i, ai)}>✕</button>
                            </span>
                          );
                        })}
                        <div className="ap-chip-add-row">
                          <input className="ap-row-input" type="text" placeholder="Ajouter un article…"
                            value={editStepInputs[i] || ""}
                            onChange={e => setEditStepInputs({ ...editStepInputs, [i]: e.target.value })}
                            onKeyDown={e => {
                              if (e.key === "Enter" && (editStepInputs[i] || "").trim()) {
                                editAddArticle(i, editStepInputs[i].trim());
                                setEditStepInputs({ ...editStepInputs, [i]: "" });
                              }
                            }} />
                          <button className="ap-inline-btn" disabled={!(editStepInputs[i] || "").trim()}
                            onClick={() => { editAddArticle(i, editStepInputs[i].trim()); setEditStepInputs({ ...editStepInputs, [i]: "" }); }}>
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button className="ap-ghost-btn"
                    onClick={() => setEditingItem({ ...editingItem, formulaSteps: [...(editingItem.formulaSteps || []), { label: "Plat", articles: [] }] })}>
                    + Ajouter une étape
                  </button>
                </div>
              )}
            </div>

            <div className="ap-sheet-actions">
              <button className="ap-action-primary" onClick={saveEditingItem}>Enregistrer</button>
              <button className="ap-action-destructive" onClick={() => setDeleteTarget({ ...editingItem })}>Supprimer</button>
              <button className="ap-action-cancel" onClick={() => setEditingItem(null)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════
          BOTTOM SHEET — AJOUT
      ══════════════════════════════ */}
      {showAddSheet && (
        <div className="ap-backdrop" onClick={() => setShowAddSheet(false)}>
          <div className="ap-sheet" onClick={e => e.stopPropagation()}>
            <div className="ap-sheet-handle" />
            <div className="ap-sheet-title">Nouvel article — {activeCategory}</div>

            <div className="ap-sheet-scroll">
              {/* Type toggle */}
              <div className="ap-type-toggle">
                <button className={`ap-type-btn ${newItemType === "article" ? "active" : ""}`} onClick={() => setNewItemType("article")}>Article</button>
                <button className={`ap-type-btn ${newItemType === "menu" ? "active" : ""}`} onClick={() => setNewItemType("menu")}>🍽️ Menu</button>
              </div>

              <div className="ap-card ap-sheet-card">
                <div className="ap-settings-row">
                  <span className="ap-row-label">Nom</span>
                  <input className="ap-row-input" type="text" placeholder="Nom de l'article"
                    value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
                </div>
                <div className="ap-row-sep" />
                <div className="ap-settings-row">
                  <span className="ap-row-label">Prix</span>
                  <div className="ap-price-row">
                    <input className="ap-row-input ap-row-input--price" type="number" step="0.5" min="0"
                      placeholder="0.00" value={newPrice} onChange={e => setNewPrice(e.target.value)} />
                    <span className="ap-price-unit">€</span>
                  </div>
                </div>
                <div className="ap-row-sep" />
                <div className="ap-settings-row">
                  <span className="ap-row-label">Sous-cat.</span>
                  <input className="ap-row-input" type="text" placeholder="Optionnel"
                    value={newSubcat} onChange={e => setNewSubcat(e.target.value)} list="add-subcats" />
                  <datalist id="add-subcats">
                    {subcategories.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div className="ap-row-sep" />
                <div className="ap-settings-row">
                  <span className="ap-row-label">🌶️ Piment</span>
                  <button className={`ap-toggle ${newPiment ? "on" : ""}`} onClick={() => setNewPiment(v => !v)}>
                    <span className="ap-toggle-thumb" />
                  </button>
                </div>
              </div>

              {newItemType === "menu" && (
                <div className="ap-formula-section">
                  <div className="ap-settings-label">ÉTAPES DU MENU</div>
                  {newFormulaSteps.map((step, i) => (
                    <div key={i} className="ap-card ap-sheet-card ap-formula-block">
                      <div className="ap-settings-row">
                        <select className="ap-row-input" value={step.label}
                          onChange={e => setNewFormulaSteps(newFormulaSteps.map((s, idx) => idx === i ? { ...s, label: e.target.value } : s))}>
                          {STEP_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                        <button className="ap-remove-btn"
                          onClick={() => setNewFormulaSteps(newFormulaSteps.filter((_, idx) => idx !== i))}>✕</button>
                      </div>
                      <div className="ap-settings-row">
                        <span className="ap-row-label">Le choix remplace le nom</span>
                        <button
                          className={`ap-toggle ${step.remplaceNom ? "on" : ""}`}
                          onClick={() => setNewFormulaSteps(newFormulaSteps.map((s, si) =>
                            si === i ? { ...s, remplaceNom: !s.remplaceNom } : s
                          ))}>
                          <span className="ap-toggle-thumb" />
                        </button>
                      </div>
                      <div className="ap-row-sep" />
                      <div className="ap-chips-wrap">
                        {(step.articles || []).map((a, ai) => {
                          const name = typeof a === "string" ? a : a.name;
                          const hasPiment = typeof a !== "string" && a.piment;
                          return (
                            <span key={ai} className={`formula-article-chip ${hasPiment ? "piment" : ""}`}>
                              {name}
                              <input
                                className="formula-chip-price"
                                type="number" step="0.5" min="0" placeholder="€"
                                value={typeof a === "string" || a.price == null ? "" : a.price}
                                onChange={e => setNewFormulaSteps(newFormulaSteps.map((s, si) =>
                                  si === i ? { ...s, articles: s.articles.map((x, xi) => {
                                    if (xi !== ai) return x;
                                    const base = typeof x === "string" ? { name: x } : { ...x };
                                    if (e.target.value === "") delete base.price;
                                    else base.price = parseFloat(e.target.value);
                                    return base;
                                  }) } : s
                                ))} />
                              <button className={`formula-chip-piment ${hasPiment ? "active" : ""}`}
                                onClick={() => setNewFormulaSteps(newFormulaSteps.map((s, si) =>
                                  si === i ? { ...s, articles: s.articles.map((x, xi) => xi === ai ? { ...x, piment: !x.piment } : x) } : s
                                ))}>🌶️</button>
                              <button onClick={() => setNewFormulaSteps(newFormulaSteps.map((s, si) =>
                                si === i ? { ...s, articles: s.articles.filter((_, xi) => xi !== ai) } : s
                              ))}>✕</button>
                            </span>
                          );
                        })}
                        <div className="ap-chip-add-row">
                          <input className="ap-row-input" type="text" placeholder="Ajouter un article…"
                            value={newStepInputs[i] || ""}
                            onChange={e => setNewStepInputs({ ...newStepInputs, [i]: e.target.value })}
                            onKeyDown={e => {
                              if (e.key === "Enter" && (newStepInputs[i] || "").trim()) {
                                setNewFormulaSteps(newFormulaSteps.map((s, idx) => idx === i
                                  ? { ...s, articles: [...(s.articles || []), { name: newStepInputs[i].trim(), piment: false }] } : s));
                                setNewStepInputs({ ...newStepInputs, [i]: "" });
                              }
                            }} />
                          <button className="ap-inline-btn" disabled={!(newStepInputs[i] || "").trim()}
                            onClick={() => {
                              setNewFormulaSteps(newFormulaSteps.map((s, idx) => idx === i
                                ? { ...s, articles: [...(s.articles || []), { name: newStepInputs[i].trim(), piment: false }] } : s));
                              setNewStepInputs({ ...newStepInputs, [i]: "" });
                            }}>+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button className="ap-ghost-btn"
                    onClick={() => setNewFormulaSteps([...newFormulaSteps, { label: "Plat", articles: [] }])}>
                    + Ajouter une étape
                  </button>
                </div>
              )}
            </div>

            <div className="ap-sheet-actions">
              <button className="ap-action-primary" onClick={addItem} disabled={!newName.trim() || !newPrice}>
                Ajouter au menu
              </button>
              <button className="ap-action-cancel" onClick={() => setShowAddSheet(false)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════
          BOTTOM SHEET — RÉORGANISATION
      ══════════════════════════════ */}
      {showReorder && (
        <div className="ap-backdrop" onClick={() => setShowReorder(false)}>
          <div className="ap-sheet" onClick={e => e.stopPropagation()}>
            <div className="ap-sheet-handle" />
            <div className="ap-sheet-title">Ordre des catégories</div>

            <div className="ap-sheet-scroll">
              <div className="ap-settings-label" style={{ padding: "0 4px 6px" }}>
                Glissez ou utilisez ↑↓ pour réorganiser
              </div>
              <div className="ap-card ap-sheet-card">
                {reorderList.map((cat, idx) => (
                  <div key={cat}>
                    <div
                      className={`ap-reorder-row ${dragOverIdx === idx ? "drag-over" : ""}`}
                      draggable
                      onDragStart={e => onDragStart(e, idx)}
                      onDragOver={e => onDragOver(e, idx)}
                      onDrop={e => onDrop(e, idx)}
                      onDragLeave={() => setDragOverIdx(null)}
                    >
                      <span className="ap-reorder-handle">☰</span>
                      <span className="ap-reorder-name">{cat}</span>
                      <div className="ap-reorder-arrows">
                        <button
                          className="ap-reorder-arrow"
                          onClick={() => moveCategory(idx, -1)}
                          disabled={idx === 0}
                        >↑</button>
                        <button
                          className="ap-reorder-arrow"
                          onClick={() => moveCategory(idx, 1)}
                          disabled={idx === reorderList.length - 1}
                        >↓</button>
                      </div>
                    </div>
                    {idx < reorderList.length - 1 && <div className="ap-row-sep" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="ap-sheet-actions">
              <button className="ap-action-primary" onClick={confirmReorder}>Confirmer l'ordre</button>
              <button className="ap-action-cancel" onClick={() => setShowReorder(false)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════
          ACTION SHEET — SUPPRESSION
      ══════════════════════════════ */}
      {deleteTarget && (
        <div className="ap-backdrop ap-backdrop--dark" onClick={() => setDeleteTarget(null)}>
          <div className="ap-action-sheet" onClick={e => e.stopPropagation()}>
            <div className="ap-action-sheet-body">
              <div className="ap-action-sheet-title">
                {deleteTarget.type === "category"
                  ? `Supprimer la catégorie « ${deleteTarget.name} » ?`
                  : `Supprimer « ${deleteTarget.name} » ?`}
              </div>
              <div className="ap-action-sheet-sub">Cette action est irréversible.</div>
            </div>
            <button className="ap-action-sheet-btn ap-action-sheet-btn--destructive" onClick={confirmDelete}>
              Supprimer
            </button>
            <button className="ap-action-sheet-btn" onClick={() => setDeleteTarget(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
