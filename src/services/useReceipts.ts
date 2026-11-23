import { useSyncExternalStore } from "react";
import { getReceiptSnapshot, subscribeToReceipts } from "./receipts";

export function useReceipts() {
  return useSyncExternalStore(subscribeToReceipts, getReceiptSnapshot);
}
