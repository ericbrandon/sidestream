import React from "react";
import ReactDOM from "react-dom/client";
import katex from "katex";
import "katex/contrib/mhchem"; // Chemical equation support (\ce{})
import App from "./App";
import "./index.css";

// Make katex available globally for mhchem extension
(window as unknown as { katex: typeof katex }).katex = katex;

// Disable default right-click context menu (prevents "Reload" and "Inspect Element")
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
