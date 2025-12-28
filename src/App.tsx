import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const App = () => {
  // For GitHub Pages root domain, basename is '/'
  // For subpath, change to '/VolleyBall' (must match vite.config.ts base path)
  const basename = '/'; // Change to '/VolleyBall' if using a subpath
  
  return (
    <>
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </>
  );
};

export default App;

