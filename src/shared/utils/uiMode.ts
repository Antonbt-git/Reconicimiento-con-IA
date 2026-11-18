// Modo del motor seleccionado en pantalla (para la etiqueta persistente de la cabecera).
import { useSyncExternalStore } from "react";
import type { EngineMode } from "../../core/domain/types";

let current: EngineMode | undefined;
const ls = new Set<() => void>();
export function setScreenEngineMode(m: EngineMode | undefined) {
  current = m;
  ls.forEach((l) => l());
}
export function useScreenEngineMode() {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => current,
  );
}
