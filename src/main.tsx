import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./app/App";
import { cloudEnabled, restoreCloudSession } from "./infrastructure/persistence/cloud";
import { repo } from "./infrastructure/persistence/LocalRepository";

if (cloudEnabled) {
  // Con Supabase, la identidad la decide su sesión (nunca un perfil demo guardado).
  repo.update(() => ({ currentUserId: undefined }));
  void restoreCloudSession().catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
