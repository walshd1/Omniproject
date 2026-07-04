import { createRoot } from "react-dom/client";
import App from "./App";
// Self-hosted (no Google Fonts request — see index.html for the CSP/privacy rationale).
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/jetbrains-mono/800.css";
import "./index.css";
import { registerServiceWorker } from "./lib/pwa";
import { installCsrf } from "./lib/csrf";

// Attach the CSRF double-submit token to same-origin mutations before anything fetches.
installCsrf();

createRoot(document.getElementById("root")!).render(<App />);

// Install the app-shell service worker (prod only; shell assets cached, never API).
registerServiceWorker(import.meta.env.BASE_URL);
