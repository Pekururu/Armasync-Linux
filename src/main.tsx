import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./kalmui/tokens.css";
import "./kalmui/bundle.css";
import "./kalmui/bundle.js";
import "./app.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
