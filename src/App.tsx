import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useSyncExternalStore,
  lazy,
  Suspense,
} from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { en, ar, type TextKey } from "./i18n";
import { TextContext } from "./text";
import { Icon } from "./ui";
import Home from "./pages/Home";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider } from "@mui/material/styles";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import ListItemButton from "@mui/material/ListItemButton";
import { createLabTheme, ltrCache, rtlCache } from "./theme";
const Analysis = lazy(() => import("./pages/Analysis"));
const Library = lazy(() => import("./pages/Library"));
const ChemicalDetail = lazy(() => import("./pages/ChemicalDetail"));
const Requests = lazy(() => import("./pages/Requests"));
const RequestDetail = lazy(() => import("./pages/RequestDetail"));
const Receipt = lazy(() => import("./pages/Receipt"));
const About = lazy(() => import("./pages/About"));
const nav = [
  ["/", "home", "space_dashboard"],
  ["/analysis", "analysis", "science"],
  ["/library", "library", "dictionary"],
  ["/requests", "requests", "assignment"],
  ["/about", "about", "info"],
] as const;
function preference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function subscribeMobile(callback: () => void) {
  const media = matchMedia("(max-width: 640px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function isMobile() {
  return matchMedia("(max-width: 640px)").matches;
}
function subscribeColorScheme(callback: () => void) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function isSystemDark() {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}
export default function App() {
  const [lang, setLang] = useState<"en" | "ar">(() =>
    preference("aetheris.lang", "en") === "ar" ? "ar" : "en",
  );
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    const saved = preference("aetheris.theme", "system");
    return saved === "dark" || saved === "light" || saved === "system"
      ? saved
      : "system";
  });
  const systemDark = useSyncExternalStore(subscribeColorScheme, isSystemDark);
  const mode =
    theme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : theme === "dark"
        ? "dark"
        : "light";
  const materialTheme = useMemo(
    () => createLabTheme(mode, lang === "ar" ? "rtl" : "ltr"),
    [mode, lang],
  );
  const [menu, setMenu] = useState(false);
  const mobile = useSyncExternalStore(subscribeMobile, isMobile);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (menu && mobile)
      sidebar.current?.querySelector<HTMLAnchorElement>("nav a")?.focus();
  }, [menu, mobile]);
  const location = useLocation();
  const t = (key: TextKey) => (lang === "ar" ? (ar[key] ?? en[key]) : en[key]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem("aetheris.lang", lang);
    } catch {
      /* Browser storage may be blocked. */
    }
  }, [lang]);
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem("aetheris.theme", theme);
    } catch {
      /* Nonessential preference. */
    }
  }, [mode, theme]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <CacheProvider value={lang === "ar" ? rtlCache : ltrCache}>
      <ThemeProvider theme={materialTheme}>
        <TextContext value={t}>
          <MotionConfig reducedMotion="user">
            <div className="app-shell">
              <aside
                id="main-sidebar"
                ref={sidebar}
                className={`sidebar ${menu ? "open" : ""}`}
                inert={mobile && !menu ? true : undefined}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setMenu(false);
                }}
              >
                <Link to="/" className="brand">
                  <span className="brand-symbol">
                    <Icon name="science" />
                  </span>
                  <span>
                    Aetheris<span className="brand-lab"> Lab</span>
                  </span>
                </Link>

                <nav
                  aria-label="Main navigation"
                  onClick={() => setMenu(false)}
                >
                  {nav.map(([path, key, icon]) => (
                    <ListItemButton
                      component={NavLink}
                      aria-label={t(key)}
                      end={path === "/"}
                      to={path}
                      key={path}
                    >
                      <Icon name={icon} />
                      <span>{t(key)}</span>
                    </ListItemButton>
                  ))}
                </nav>
                <div className="sidebar-bottom">
                  <div className="local-indicator">
                    <span className="dot" />
                    {t("workspaceLabel")}
                  </div>
                </div>
              </aside>
              {menu && (
                <button
                  className="mobile-scrim"
                  aria-label={t("close")}
                  onClick={() => setMenu(false)}
                />
              )}
              <div className="main-shell" inert={mobile && menu ? true : undefined}>
                <header className="topbar">
                  <div className="breadcrumb">
                    <button
                      className="icon-button mobile-toggle"
                      aria-label={t("mobileMenu")}
                      aria-expanded={menu}
                      aria-controls="main-sidebar"
                      onClick={() => setMenu((v) => !v)}
                    >
                      <Icon name="menu" />
                    </button>
                    <span className="muted">{t("workspace")}</span>
                    <span className="breadcrumb-slash">/</span>
                    <strong>
                      {t(
                        nav.find(([p]) =>
                          p === "/"
                            ? location.pathname === "/"
                            : location.pathname === p ||
                            location.pathname.startsWith(`${p}/`),
                        )?.[1] ?? "home",
                      )}
                    </strong>
                  </div>
                  <div className="top-actions">
                    <Tooltip
                      title={t(
                        mode === "dark" ? "switchToLight" : "switchToDark",
                      )}
                      disableInteractive
                    >
                      <IconButton
                        aria-label={t(
                          mode === "dark" ? "switchToLight" : "switchToDark",
                        )}
                        onClick={() =>
                          setTheme(mode === "dark" ? "light" : "dark")
                        }
                      >
                        <Icon
                          name={mode === "dark" ? "light_mode" : "dark_mode"}
                        />
                      </IconButton>
                    </Tooltip>
                    <button
                      className="language-button"
                      onClick={() => setLang(lang === "en" ? "ar" : "en")}
                      aria-label={t("language")}
                    >
                      {lang === "en" ? "العربية" : "English"}
                    </button>
                  </div>
                </header>
                <main id="main">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={location.pathname}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: 0.25,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    >
                      <Suspense
                        fallback={
                          <div
                            className="page skeleton"
                            role="status"
                            aria-label={t("loading")}
                          />
                        }
                      >
                        <Routes>
                          <Route path="/" element={<Home />} />
                          <Route path="/analysis" element={<Analysis />} />
                          <Route path="/library" element={<Library />} />
                          <Route
                            path="/library/:id"
                            element={<ChemicalDetail />}
                          />
                          <Route path="/requests" element={<Requests />} />
                          <Route
                            path="/requests/:id"
                            element={<RequestDetail />}
                          />
                          <Route
                            path="/requests/:id/receipt"
                            element={<Receipt />}
                          />
                          <Route path="/about" element={<About />} />
                          <Route
                            path="*"
                            element={
                              <div className="empty-state">
                                <h1>404</h1>
                                <Link to="/">{t("home")}</Link>
                              </div>
                            }
                          />
                        </Routes>
                      </Suspense>
                    </motion.div>
                  </AnimatePresence>
                </main>
                <footer>
                  <span className="footer-brand">
                    <Icon name="science" /> Aetheris Lab
                  </span>
                  <span>{t("footer")}</span>
                  <span className="small">v0.1</span>
                </footer>
              </div>
            </div>
          </MotionConfig>
        </TextContext>
      </ThemeProvider>
    </CacheProvider>
  );
}