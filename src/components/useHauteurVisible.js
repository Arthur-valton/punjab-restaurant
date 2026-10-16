import { useEffect } from "react";

// Sur iPhone et iPad, le clavier ne réduit pas la page : Safari la fait
// glisser et la barre « Enregistrer » sortait par le haut. On cale l'admin
// sur la partie réellement visible (--vv-h / --vv-top, lues par .adm et .fp)
// et on ramène au centre le champ touché quand le clavier est ouvert.
export default function useHauteurVisible() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const s = document.documentElement.style;
    const maj = () => {
      // On ne se cale sur la partie visible que clavier ouvert. Le reste du
      // temps, l'admin suit simplement la fenêtre (100 %) : une valeur restée
      // d'avant une rotation la rendait plus haute que l'écran, sans défilement.
      const zoom = Math.abs((vv.scale || 1) - 1) > 0.01;
      const clavier = vv.height < window.innerHeight - 100;
      if (zoom || !clavier) {
        s.removeProperty("--vv-h");
        s.removeProperty("--vv-top");
        return;
      }
      s.setProperty("--vv-h", `${vv.height}px`);
      s.setProperty("--vv-top", `${vv.offsetTop}px`);
    };
    const auFocus = (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLElement) || !el.matches("input, textarea")) return;
      setTimeout(() => {
        // clavier ouvert : la partie visible est nettement plus basse que la fenêtre
        if (vv.height < window.innerHeight - 120) el.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 300);
    };
    maj();
    vv.addEventListener("resize", maj);
    vv.addEventListener("scroll", maj);
    window.addEventListener("resize", maj);
    window.addEventListener("orientationchange", maj);
    document.addEventListener("focusin", auFocus);
    document.addEventListener("focusout", maj);
    return () => {
      vv.removeEventListener("resize", maj);
      vv.removeEventListener("scroll", maj);
      window.removeEventListener("resize", maj);
      window.removeEventListener("orientationchange", maj);
      document.removeEventListener("focusin", auFocus);
      document.removeEventListener("focusout", maj);
      s.removeProperty("--vv-h");
      s.removeProperty("--vv-top");
    };
  }, []);
}
