import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConfirmProvider } from "./components/confirm-dialog";
import { SecurityGate } from "./features/security/security-gate";
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
