import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  const [status, setStatus] = useState("Checking API connection…");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Health check failed");
        setStatus("API connected.");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("API unavailable.");
      });

    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Vamp</h1>
      <p>A shared musical experiment. Coming soon.</p>
      <p role="status">{status}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
