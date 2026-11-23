// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankSolution } from "./domain";
import { en } from "./i18n";
import Analysis from "./pages/Analysis";
import Receipt from "./pages/Receipt";
import Requests from "./pages/Requests";
import { saveReceipt } from "./services/receipts";
import { TextContext } from "./text";

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 15000 });

const id = "7f8cc568-039d-4ba3-97b4-709444133fad";
const token = "a".repeat(64);
const receiptPath = "/requests/" + id + "/receipt";
const storageKey = "aetheris.receipt.v1." + id;
const receipt = {
  id,
  status: "Submitted",
  createdAt: "2026-11-20T12:00:00.000Z",
  updatedAt: "2026-11-20T12:00:00.000Z",
} as const;
const fetchMock = vi.fn<typeof fetch>();

function Location() {
  const { pathname, search, hash } = useLocation();
  return <output aria-label="Current URL">{pathname + search + hash}</output>;
}

function mount(path = "/analysis") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TextContext value={(key) => en[key]}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Location />
          <Routes>
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/requests/:id/receipt" element={<Receipt />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TextContext>,
  );
}

function enterSolution(letter: "A" | "B", name: string) {
  const card = screen
    .getByRole("heading", { name: "Solution " + letter })
    .closest("section")!;
  fireEvent.click(within(card).getByRole("button", { name: en.manual }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: en.name }), {
    target: { value: name },
  });
  return dialog;
}

function fillRequest() {
  for (const letter of ["A", "B"] as const) {
    const dialog = enterSolution(letter, "Sample " + letter);
    fireEvent.click(within(dialog).getByRole("button", { name: en.confirm }));
  }
  fireEvent.change(screen.getByRole("textbox", { name: en.conditions }), {
    target: { value: "Room temperature" },
  });
  return screen.getByRole("button", { name: en.submitRequest });
}

function createMockStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createMockStorage());
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("real submission", () => {
  it("posts the exact form contract once for two rapid clicks and tracks the returned receipt", async () => {
    let respond!: (response: Response) => void;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json(receipt));
    mount();
    const submit = fillRequest();

    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, request] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/requests");
    expect(request).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(request?.body as string)).toEqual({
      a: { ...blankSolution, name: "Sample A" },
      b: { ...blankSolution, name: "Sample B" },
      conditions: "Room temperature",
    });
    expect(
      (screen.getByRole("button", { name: en.submitting }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    respond(
      Response.json({ ...receipt, trackingToken: token }, { status: 201 }),
    );
    expect(
      await screen.findByRole("heading", { name: en.receipt }),
    ).toBeTruthy();
    expect(screen.getByText(id)).toBeTruthy();
    expect(screen.getByText(en.submitted)).toBeTruthy();
    expect(
      screen
        .getByText(new Date(receipt.createdAt).toLocaleString())
        .closest("time")?.dateTime,
    ).toBe(receipt.createdAt);
    expect(screen.getByRole("heading", { name: en.noVerdict })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/requests/" + id,
      expect.objectContaining({
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
        redirect: "error",
      }),
    ]);
    expect(
      JSON.parse(localStorage.getItem(storageKey) ?? "").trackingToken,
    ).toBe(token);
    expect(screen.getByLabelText("Current URL").textContent).toBe(receiptPath);
    expect(document.body.textContent).not.toContain(token);
  });

  it("rejects invalid input in the dialog and shows a safe error for server validation failures", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: token }, { status: 400 }),
    );
    mount();
    const dialog = enterSolution("A", "Sample A");
    const quantity = within(dialog).getByRole("textbox", { name: en.quantity });
    fireEvent.change(quantity, { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: en.confirm }));
    expect(screen.getByText("Choose a quantity unit.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: en.cancel }));
    fireEvent.click(fillRequest());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(en.submissionInvalid);
    expect(alert.textContent).not.toContain(token);
    expect(document.body.textContent).not.toContain(token);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it.each(["network", "unavailable"] as const)(
    "requires explicit confirmation to retry an unconfirmed %s failure",
    async (failure) => {
      if (failure === "network")
        fetchMock.mockRejectedValueOnce(new Error(token));
      else
        fetchMock.mockResolvedValueOnce(
          Response.json({ error: token }, { status: 503 }),
        );
      fetchMock
        .mockResolvedValueOnce(
          Response.json({ ...receipt, trackingToken: token }, { status: 201 }),
        )
        .mockResolvedValueOnce(Response.json(receipt));
      mount();
      fireEvent.click(fillRequest());

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(en.submissionUnconfirmed);
      expect(alert.textContent).not.toContain(token);
      expect(
        (
          screen.getByRole("textbox", {
            name: en.conditions,
          }) as HTMLTextAreaElement
        ).value,
      ).toBe("Room temperature");
      fireEvent.click(screen.getByRole("button", { name: en.retry }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: en.submitAgain,
        }),
      );
      expect(
        await screen.findByRole("heading", { name: en.receipt }),
      ).toBeTruthy();
    },
  );

  it("blocks retry during Retry-After and waits for an intentional click", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "Retry-After": "1" } }),
    );
    mount();
    const submit = fillRequest();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await act(async () => {
      fireEvent.click(submit);
    });

    expect(screen.getByRole("alert").textContent).toContain(en.rateLimited);
    const retry = screen.getByRole("button", {
      name: en.retry,
    }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText(en.retryAvailable)).toBeTruthy();
    expect(retry.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("receipt tracking", () => {
  it("shows current progress and reveals a result only after approved tracking data arrives", async () => {
    const result = {
      classification: "Insufficient information",
      conditions: "Reviewed conditions",
      hazards: [], incompatibilities: [], storage: "Not assessed", container: "Not assessed",
      limitations: ["No matching formulation data"],
      sources: [{ title: "Scientific reference", url: "https://www.cdc.gov/niosh/npg/npg.html" }],
      reviewedAt: receipt.updatedAt,
    };
    saveReceipt({ ...receipt, trackingToken: token });
    fetchMock.mockResolvedValueOnce(Response.json({ ...receipt, status: "Pending Review", result }))
      .mockResolvedValueOnce(Response.json({ ...receipt, status: "Approved", result }));
    mount(receiptPath);
    expect(await screen.findByText(en.pendingReviewStatus)).toBeTruthy();
    expect(screen.getByText(en.noVerdict)).toBeTruthy();
    expect(screen.queryByText(result.conditions)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: en.refreshReceipt }));
    expect(await screen.findByRole("heading", { name: en.insufficientResult })).toBeTruthy();
    expect(screen.getByText(result.conditions)).toBeTruthy();
    expect(screen.queryByText(en.noVerdict)).toBeNull();
    const storedReceipt = localStorage.getItem(storageKey);

    expect(storedReceipt).not.toBeNull();
    expect(storedReceipt).not.toContain(result.conditions);
    expect(storedReceipt).not.toContain(result.sources[0].title);
    expect(document.body.textContent).not.toContain(token);
  });

  it("uses the saved token after remount and removes it on confirmation", async () => {
    saveReceipt({ ...receipt, trackingToken: token });
    fetchMock.mockResolvedValue(Response.json(receipt));
    mount(receiptPath);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Authorization: "Bearer " + token,
    });
    fireEvent.click(screen.getByRole("button", { name: en.forgetReceipt }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: en.remove,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: en.requests }),
    ).toBeTruthy();
    expect(localStorage.getItem(storageKey)).toBeNull();
    cleanup();
    mount(receiptPath);
    expect((await screen.findByRole("alert")).textContent).toContain(
      en.receiptMissing,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles an invalid bearer token using the same message as a missing receipt", async () => {
    saveReceipt({ ...receipt, trackingToken: token });
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "NOT_FOUND" }, { status: 404 }),
    );
    mount(receiptPath);
    expect((await screen.findByRole("alert")).textContent).toContain(
      en.receiptMissing,
    );
    expect(screen.queryByText(en.submitted)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])(
    "does not reveal receipt data when access is denied (%i)",
    async (status) => {
      saveReceipt({ ...receipt, trackingToken: token });

      fetchMock.mockResolvedValueOnce(
        Response.json(
          { error: "ACCESS_DENIED" },
          { status },
        ),
      );

      mount(receiptPath);

      const alert = await screen.findByRole("alert");

      expect(alert.textContent).toContain(en.receiptMissing);
      expect(screen.queryByText(en.submitted)).toBeNull();
      expect(document.body.textContent).not.toContain(token);
    },
  );

  it("can track and remove a receipt in the tab when persistent storage fails", async () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    saveReceipt({ ...receipt, trackingToken: token });
    fetchMock.mockResolvedValueOnce(Response.json(receipt));
    mount(receiptPath);
    expect(await screen.findByText(en.receiptTemporary)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: en.forgetReceipt }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: en.remove,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: en.requests }),
    ).toBeTruthy();
  });
});
