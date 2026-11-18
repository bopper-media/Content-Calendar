import "./app.css";
import { loadItems } from "./data/local-api";
import { createRoot } from "react-dom/client";
import { ContentView } from "@/components/content/ContentView";

/** The Sous app shell, minus the top bar and the rail: the canvas row and the
 *  main column the Content page normally renders into. */
function App() {
  return (
    <div className="flex flex-col app-shell" style={{ height: "100%", background: "var(--canvas)" }}>
      <div className="flex min-h-0" style={{ flex: 1, gap: 12, padding: "2px 12px 12px" }}>
        <main className="flex flex-col min-w-0" style={{ flex: 1, position: "relative", minHeight: 0, overflowY: "auto" }}>
          <ContentView initialItems={loadItems()} />
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
