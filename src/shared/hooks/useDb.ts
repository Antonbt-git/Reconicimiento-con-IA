import { useSyncExternalStore } from "react";
import { repo, type DbState } from "../../infrastructure/persistence/LocalRepository";

/** Suscripción reactiva al repositorio local. */
export function useDb<T>(selector: (s: DbState) => T): T {
  return useSyncExternalStore(repo.subscribe, () => selector(repo.getState()));
}

export function useCurrentUser() {
  const users = useDb((s) => s.users);
  const id = useDb((s) => s.currentUserId);
  return users.find((u) => u.id === id);
}
