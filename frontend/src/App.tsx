import { lazy, Suspense } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router";
import { api, withRetry } from "./api/client";
import { Loading, Notice } from "./components/common";
import { MetaContext, useAsync } from "./lib/hooks";
import AnalyzePage from "./pages/AnalyzePage";

// Pages with charts load on demand, so the first page appears quickly on phones.
const ExplorerPage = lazy(() => import("./pages/ExplorerPage"));
const DatasetsPage = lazy(() => import("./pages/DatasetsPage"));
const DatasetPage = lazy(() => import("./pages/DatasetPage"));
const DictionariesPage = lazy(() => import("./pages/DictionariesPage"));
const MethodPage = lazy(() => import("./pages/MethodPage"));

const NAV = [
  { to: "/", label: "Analyze a text", end: true },
  { to: "/un", label: "UN General Debate" },
  { to: "/datasets", label: "My datasets" },
  { to: "/dictionaries", label: "Dictionaries" },
  { to: "/method", label: "Method" },
];

export default function App() {
  const meta = useAsync(() => withRetry(() => api.meta()), []);
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="container">
          <NavLink to="/" className="brand">
            <img src="/favicon.svg" alt="" />
            <span className="brand-text">
              <span className="brand-name">Undertone Lab</span>
              <span className="brand-tag">Diplomatic language analyzer</span>
            </span>
          </NavLink>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="container">
        {meta.data ? (
          <MetaContext.Provider value={meta.data}>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<AnalyzePage />} />
                <Route path="/un" element={<ExplorerPage />} />
                <Route path="/datasets" element={<DatasetsPage />} />
                <Route path="/datasets/:id" element={<DatasetPage />} />
                <Route path="/dictionaries" element={<DictionariesPage />} />
                <Route path="/method" element={<MethodPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </MetaContext.Provider>
        ) : meta.error ? (
          <Notice kind="error" onRetry={meta.reload}>The app could not start: {meta.error}</Notice>
        ) : (
          <Loading />
        )}
      </main>
      <footer className="site-footer">
        <div className="container">
          <span>Built by Tuan Dung Nguyen</span>
          <span>UN data: Jankin, Baturo &amp; Dasandi (2024), <i>Journal of Peace Research</i></span>
          <a href="/api/docs">API documentation</a>
          <a href="https://github.com/dungnguyen0309/UndertoneLab">Source code</a>
          <span className="disclaimer">
            An independent research tool. Not affiliated with or endorsed by the United Nations.
          </span>
        </div>
      </footer>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <div className="card">
      <h1>Page not found</h1>
      <p>
        That address does not exist. <NavLink to="/">Go to the start page</NavLink>.
      </p>
    </div>
  );
}
