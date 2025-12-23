import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "@/lib/themes"; // Initialize theme system

createRoot(document.getElementById("root")!).render(<App />);

