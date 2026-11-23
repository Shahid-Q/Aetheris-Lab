import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CacheProvider } from "@emotion/react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import { ThemeProvider } from "@mui/material/styles";
import { TextContext } from "../../src/text";
import { createLabTheme, ltrCache, rtlCache } from "../../src/theme";
import { Icon, Notice } from "../../src/ui";
import ReviewWorkspace from "./ReviewWorkspace";
import { AdminError, adminSession, adminSignIn, adminSignOut, sessionQueryKey } from "./api";
import { adminText, type AdminTextKey } from "./i18n";
import { AdminTextContext, useAdminText } from "./text";

const systemColor = "(prefers-color-scheme: dark)";

function subscribeColor(callback: () => void) {
  const media = matchMedia(systemColor);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function isSystemDark() {
  return matchMedia(systemColor).matches;
}

function preference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Appearance preferences are optional.
  }
}

function Login() {
  const t = useAdminText();
  const client = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AdminTextKey | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const password = new FormData(form).get("password");
    if (typeof password !== "string" || !password) return;

    form.reset();
    setSubmitting(true);
    setFailure(null);
    try {
      const session = await adminSignIn(password);
      await client.cancelQueries({ queryKey: sessionQueryKey });
      client.setQueryData(sessionQueryKey, session);
    } catch (error) {
      if (error instanceof AdminError && error.status === 429) setFailure("signInRateLimited");
      else if (error instanceof AdminError && [400, 401].includes(error.status)) setFailure("signInFailed");
      else setFailure("adminUnavailable");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel admin-login" aria-labelledby="reviewer-sign-in">
      <h1 id="reviewer-sign-in">{t("signInTitle")}</h1>
      <p className="muted">{t("signInDescription")}</p>
      <form method="post" action="/api/admin/auth/login" className="admin-form" onSubmit={submit}>
        <TextField fullWidth required type="password" name="password" autoComplete="current-password"
          label={t("adminPassword")} disabled={submitting} slotProps={{ htmlInput: { maxLength: 128 } }} />
        {failure && <Notice kind="error">{t(failure)}</Notice>}
        <div>
          <Button type="submit" variant="contained" disabled={submitting}>
            {t(submitting ? "loading" : "adminSignIn")}
          </Button>
        </div>
      </form>
    </section>
  );
}

export default function App() {
  const [language, setLanguage] = useState(() => preference("aetheris.lang") === "ar" ? "ar" : "en");
  const [theme, setTheme] = useState(() => preference("aetheris.theme"));
  const systemDark = useSyncExternalStore(subscribeColor, isSystemDark);
  const mode = theme === "dark" || (theme !== "light" && systemDark) ? "dark" : "light";
  const rtl = language === "ar";
  const materialTheme = useMemo(() => createLabTheme(mode, rtl ? "rtl" : "ltr"), [mode, rtl]);
  const t = (key: AdminTextKey) => adminText(key, language);
  const { pathname } = useLocation();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => adminSession(signal),
    refetchInterval: (query) => query.state.status === "success" ? 60_000 : false,
    retry: false,
    gcTime: 0,
  });
  const signOut = useMutation({
    mutationFn: adminSignOut,
    gcTime: 0,
    async onSuccess() {
      await client.cancelQueries({ queryKey: sessionQueryKey });
      client.setQueryData(sessionQueryKey, null);
    },
    onError(error) {
      if (error instanceof AdminError && error.status === 403) {
        void client.invalidateQueries({ queryKey: sessionQueryKey });
      }
    },
  });
  const activeSession = session.isError ? null : session.data;
  const apiUnavailable = session.error instanceof AdminError && session.error.status === 404;

  useEffect(() => {
    if (!activeSession) client.removeQueries({ queryKey: ["admin"] });
  }, [client, activeSession]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.documentElement.dataset.theme = mode;
    storePreference("aetheris.lang", language);
    if (theme) storePreference("aetheris.theme", theme);
  }, [language, rtl, mode, theme]);

  useEffect(() => {
    // Some browsers return a promise from scrollTo, which is not an effect cleanup.
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <CacheProvider value={rtl ? rtlCache : ltrCache}>
      <ThemeProvider theme={materialTheme}>
        <TextContext value={t}>
          <AdminTextContext value={t}>
            <div className="admin-shell">
              <header className="admin-header">
                <Link to="/" className="admin-brand">
                  <span className="brand-symbol"><Icon name="science" /></span>
                  {t("admin")}
                </Link>
                <nav className="admin-controls" aria-label={t("dashboardNav")}>
                  {activeSession && <bdi className="admin-account">{t("adminRole")}</bdi>}
                  <IconButton
                    aria-label={t(mode === "dark" ? "switchToLight" : "switchToDark")}
                    onClick={() => setTheme(mode === "dark" ? "light" : "dark")}
                  >
                    <Icon name={mode === "dark" ? "light_mode" : "dark_mode"} />
                  </IconButton>
                  <button
                    type="button"
                    className="language-button"
                    aria-label={t("language")}
                    onClick={() => setLanguage(rtl ? "en" : "ar")}
                  >
                    <span lang={rtl ? "en" : "ar"}>{rtl ? "English" : "العربية"}</span>
                  </button>
                  {activeSession && (
                    <Button variant="outlined" disabled={signOut.isPending}
                      onClick={() => signOut.mutate(activeSession.csrfToken)}>
                      {t("signOut")}
                    </Button>
                  )}
                </nav>
              </header>
              <main className="admin-main" id="main">
                {session.isPending ? (
                  <div className="page" role="status">{t("loading")}</div>
                ) : session.isError ? (
                  <div className="page">
                    <Notice kind="error">{t(apiUnavailable ? "adminNotEnabled" : "adminUnavailable")}</Notice>
                    {!apiUnavailable && (
                      <div><Button onClick={() => void session.refetch()}>{t("retry")}</Button></div>
                    )}
                  </div>
                ) : activeSession ? (
                  <>
                    {signOut.isError && signOut.variables === activeSession.csrfToken && <div className="admin-session-error">
                      <Notice kind="error">{t("signOutFailed")}</Notice>
                    </div>}
                    <Routes>
                      <Route path="/" element={<ReviewWorkspace csrfToken={activeSession.csrfToken} />} />
                      <Route path="/requests/:id" element={<ReviewWorkspace csrfToken={activeSession.csrfToken} />} />
                      <Route path="/reviews/:id" element={<ReviewWorkspace csrfToken={activeSession.csrfToken} />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </>
                ) : <Login />}
              </main>
            </div>
          </AdminTextContext>
        </TextContext>
      </ThemeProvider>
    </CacheProvider>
  );
}
