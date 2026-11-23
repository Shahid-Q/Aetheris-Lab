import { createContext, useContext } from "react";
import { adminText, type AdminTextKey } from "./i18n";

export const AdminTextContext = createContext<(key: AdminTextKey) => string>(adminText);
export const useAdminText = () => useContext(AdminTextContext);
