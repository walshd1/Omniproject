import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "./lib/pwa";

createRoot(document.getElementById("root")!).render(<App />);

// Install the app-shell service worker (prod only; shell assets cached, never API).
registerServiceWorker(import.meta.env.BASE_URL);
