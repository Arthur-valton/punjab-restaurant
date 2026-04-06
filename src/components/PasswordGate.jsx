import { useState, useEffect, useRef } from "react";

const DAYS_15 = 15 * 24 * 60 * 60 * 1000;
const APP_UNLOCK_KEY = "punjab_app_unlocked_until";
const APP_PWD_KEY = "punjab_app_password";
const SETTINGS_PWD_KEY = "punjab_settings_password";

export function getDefaultPasswords() {
  return {
    app: localStorage.getItem(APP_PWD_KEY) || "Punjab2025",
    settings: localStorage.getItem(SETTINGS_PWD_KEY) || "Punjab2025",
  };
}

export function savePasswords({ app, settings }) {
  localStorage.setItem(APP_PWD_KEY, app);
  localStorage.setItem(SETTINGS_PWD_KEY, settings);
}

export function isAppUnlocked() {
  const until = localStorage.getItem(APP_UNLOCK_KEY);
  if (!until) return false;
  return Date.now() < parseInt(until, 10);
}

export function unlockApp() {
  localStorage.setItem(APP_UNLOCK_KEY, String(Date.now() + DAYS_15));
}

export function lockApp() {
  localStorage.removeItem(APP_UNLOCK_KEY);
}

export default function PasswordGate({ title, onSuccess, onCancel }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    // Auto-focus so the keyboard opens on mobile
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    if (!value) return;
    const correct = onSuccess(value);
    if (correct === false) {
      setShake(true);
      setError(true);
      setValue("");
      setTimeout(() => setShake(false), 500);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  return (
    <div className="pwgate-overlay">
      <form className={`pwgate ${shake ? "pwgate-shake" : ""}`} onSubmit={handleSubmit}>
        <div className="pwgate-title">{title}</div>
        <div className="pwgate-subtitle">Entrez le mot de passe</div>

        <input
          ref={inputRef}
          className={`pwgate-input ${error ? "pwgate-input--error" : ""}`}
          type="password"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
          placeholder="••••"
          autoComplete="off"
        />

        {error && <div className="pwgate-error">Mot de passe incorrect</div>}

        <button className="pwgate-confirm" type="submit" disabled={!value}>
          Valider
        </button>

        {onCancel && (
          <button className="pwgate-cancel" type="button" onClick={onCancel}>
            Annuler
          </button>
        )}
      </form>
    </div>
  );
}
