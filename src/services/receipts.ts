
import {
  createdReceiptSchema,
  type CreatedReceipt,
} from "../domain";

const prefix = "aetheris.receipt.v1.";
const temporary = new Map<string, CreatedReceipt>();
const listeners = new Set<() => void>();

type SavedReceipt = Omit<CreatedReceipt, "trackingToken"> & {
  persistent: boolean;
};

interface ReceiptSnapshot {
  receipts: SavedReceipt[];
  storageUnavailable: boolean;
}

let snapshot: ReceiptSnapshot | undefined;

function readStoredReceipt(id: string) {
  const key = prefix + id;

  let raw: string | null;

  try {
    raw = localStorage.getItem(key);
  } catch {
    return undefined;
  }

  if (!raw) return undefined;

  try {
    const parsed = createdReceiptSchema.safeParse(
      JSON.parse(raw),
    );

    if (parsed.success && parsed.data.id === id) {
      return parsed.data;
    }
  } catch {
  }

  try {
    localStorage.removeItem(key);
  } catch {
  }

  return undefined;
}

function metadata(
  receipt: CreatedReceipt,
  persistent: boolean,
): SavedReceipt {
  const { id, status, createdAt, updatedAt } = receipt;

  return {
    id,
    status,
    createdAt,
    updatedAt,
    persistent,
  };
}

function readSnapshot(): ReceiptSnapshot {
  const receipts = new Map(
    [...temporary].map(([id, receipt]) => [
      id,
      metadata(receipt, false),
    ]),
  );

  let storageUnavailable = false;

  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);

      if (!key?.startsWith(prefix)) continue;

      const receipt = readStoredReceipt(
        key.slice(prefix.length),
      );

      if (receipt) {
        receipts.set(
          receipt.id,
          metadata(receipt, true),
        );
      }
    }
  } catch {
    storageUnavailable = true;
  }

  return {
    receipts: [...receipts.values()],
    storageUnavailable,
  };
}

function refresh() {
  snapshot = readSnapshot();
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key.startsWith(prefix)) {
    refresh();
  }
}

export function subscribeToReceipts(
  listener: () => void,
) {
  listeners.add(listener);

  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
    refresh();
  }

  return () => {
    listeners.delete(listener);

    if (!listeners.size) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function getReceiptSnapshot() {
  return (snapshot ??= readSnapshot());
}

export function saveReceipt(receipt: CreatedReceipt) {
  try {
    localStorage.setItem(
      prefix + receipt.id,
      JSON.stringify(receipt),
    );

    temporary.delete(receipt.id);
  } catch {
    temporary.set(receipt.id, receipt);
  }

  refresh();
}

export function getTrackingToken(id: string) {
  if (temporary.has(id)) {
    return temporary.get(id)?.trackingToken;
  }

  try {
    return readStoredReceipt(id)?.trackingToken;
  } catch {
    return undefined;
  }
}

export function forgetReceipt(id: string) {
  const deletedFromTemporary = temporary.delete(id);
  let removedFromStorage = false;

  try {
    localStorage.removeItem(prefix + id);
    removedFromStorage = true;
  } catch {
    removedFromStorage = false;
  }

  refresh();
  return deletedFromTemporary || removedFromStorage;
}