import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConfirmProvider } from "./components/confirm-dialog";
import { SecurityGate } from "./features/security/security-gate";
// Polices embarquées dans l'app : aucune requête réseau au lancement.
import "@fontsource/geist-sans/latin-400.css";
import "@fontsource/geist-sans/latin-500.css";
import "@fontsource/geist-sans/latin-600.css";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Élément #root introuvable");
}
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {/* Dialogues des écrans de sécurité (restauration). L'app a le sien, masqué avec elle. */}
    <ConfirmProvider>
      <SecurityGate>
        <App />
      </SecurityGate>
    </ConfirmProvider>
  </React.StrictMode>,
);
