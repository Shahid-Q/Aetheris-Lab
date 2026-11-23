import { createContext, useContext } from "react";
import { en, type TextKey } from "./i18n";
export const TextContext = createContext<(key: TextKey) => string>(
  (key) => en[key],
);
export const useText = () => useContext(TextContext);
