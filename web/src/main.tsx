import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AccountProvider } from "./cloud/account";
// Inter ships with the app (latin subsets only), so no font request leaves for a CDN.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
// Barlow Condensed sets the large figures and the wordmark.
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700-italic.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<AccountProvider><App /></AccountProvider>);
