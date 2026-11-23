import { createTheme } from "@mui/material/styles";
import createCache from "@emotion/cache";
import rtlPlugin from "@mui/stylis-plugin-rtl";
import { prefixer } from "stylis";

export const ltrCache = createCache({ key: "aetheris" });
export const rtlCache = createCache({
  key: "aetheris-rtl",
  stylisPlugins: [prefixer, rtlPlugin],
});

export function createLabTheme(
  mode: "light" | "dark",
  direction: "ltr" | "rtl",
) {
  const dark = mode === "dark";
  return createTheme({
    direction,
    palette: {
      mode,
      primary: { main: dark ? "#7ab0ff" : "#0b57d0" },
      secondary: { main: dark ? "#38d9c0" : "#0d9488" },
      success: { main: dark ? "#4ade80" : "#15803d" },
      warning: { main: dark ? "#fbbf24" : "#b45309" },
      error: { main: dark ? "#f2b8b5" : "#b3261e" },
      info: { main: dark ? "#7ab0ff" : "#0369a1" },
      background: {
        default: dark ? "#0f1218" : "#f4f7fb",
        paper: dark ? "#171c26" : "#ffffff",
      },
      text: {
        primary: dark ? "#eef2f7" : "#18202c",
        secondary: dark ? "#a7b3c6" : "#525d6e",
      },
      divider: dark ? "#2a3344" : "#dce3ee",
    },
    typography: {
      fontFamily: '"Aetheris Samsung", "Tajawal", "IBM Plex Sans Arabic", sans-serif',
      fontSize: 14,
      h1: { fontWeight: 400 },
      h2: { fontWeight: 400 },
      button: { textTransform: "none", fontWeight: 500, letterSpacing: 0 },
    },
    shape: { borderRadius: 16 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 9999,
            minHeight: 44,
            padding: "10px 22px",
            fontSize: 14,
          },
          outlined: { borderColor: dark ? "#3f4b61" : "#b8c4d4" },
          text: { padding: "10px 18px" },
          contained: {
            backgroundColor: dark ? "#7ab0ff" : "#0b57d0",
            color: dark ? "#071b38" : "#ffffff",
            "&:hover": { backgroundColor: dark ? "#93c0ff" : "#0848b3" },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { color: dark ? "#a7b3c6" : "#525d6e", width: 44, height: 44 },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 9, height: 36, fontWeight: 500, fontSize: 14 },
          outlined: { borderColor: dark ? "#3f4b61" : "#b8c4d4" },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 12, fontSize: 16 },
          notchedOutline: { borderColor: dark ? "#3f4b61" : "#b8c4d4" },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 28,
            backgroundImage: "none",
            maxHeight: "calc(100dvh - 48px)",
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 28,
            gap: 14,
            minHeight: 52,
            padding: "12px 22px",
            fontSize: 14,
            fontWeight: 500,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: { borderRadius: 8, fontSize: 12 } },
      },
    },
  });
}