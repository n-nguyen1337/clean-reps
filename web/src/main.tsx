import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AccountProvider } from "./cloud/account";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<AccountProvider><App /></AccountProvider>);
