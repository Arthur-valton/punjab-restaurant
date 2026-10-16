import { useState, useEffect, useCallback } from "react";

// Où en est une barre qui défile à l'horizontale : [arrivée au bout, au début].
// Sert à n'afficher le dégradé « il y a encore des onglets » que du côté où
// il en reste.
export default function useAuBout(ref, deps = []) {
  const [bords, setBords] = useState([true, true]);
  const mesurer = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const auBout = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    const auDebut = el.scrollLeft <= 1;
    setBords((b) => (b[0] === auBout && b[1] === auDebut ? b : [auBout, auDebut]));
  }, [ref]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    mesurer();
    el.addEventListener("scroll", mesurer, { passive: true });
    window.addEventListener("resize", mesurer);
    return () => {
      el.removeEventListener("scroll", mesurer);
      window.removeEventListener("resize", mesurer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesurer, ...deps]);
  return bords;
}
