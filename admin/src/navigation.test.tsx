// @vitest-environment jsdom
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { blankSolution } from "../../src/domain";
import type { AdminRequestDetail } from "../../src/review";
import { adminText } from "./i18n";

declare const jsdom: { window: { localStorage: Storage } };
const fetchMock = vi.fn<typeof fetch>();
const clients: QueryClient[] = [];
const createdAt = "2026-01-01T00:00:00Z";
function detail(id: string): AdminRequestDetail {
  return { id, status: "Submitted", createdAt, updatedAt: createdAt, archivedAt: null,
    input: { a: { ...blankSolution, name: `${id} detail` }, b: blankSolution, conditions: "" },
    images: [], evidence: [], history: [], run: null, report: null, review: null,
    approvedResult: null, canRetry: false };
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("localStorage", jsdom.window.localStorage);
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (path) => {
    const url = String(path);
    if (url === "/api/admin/session") return Response.json({ reviewer: { login: "admin" }, csrfToken: "token" });
    if (url.includes("?")) return Response.json({ requests: ["first", "second"].map((id) => ({
      id, nameA: `${id} chemical`, nameB: "Water", status: "Submitted", createdAt,
    })), next: null });
    return Response.json(detail(url.split("/").at(-1)!));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Navigation() {
  const navigate = useNavigate();
  return <nav aria-label="Test navigation">
    <Link to="/requests/first">Open first</Link><Link to="/requests/second">Open second</Link>
    <Link to="/reviews/first">Review first</Link>
    <button onClick={() => void navigate(-1)}>History back</button>
    <button onClick={() => void navigate(1)}>History forward</button>
  </nav>;
}
function mount(path = "/") {
  const client = new QueryClient();
  clients.push(client);
  render(<StrictMode><QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <Navigation /><App />
  </MemoryRouter></QueryClientProvider></StrictMode>);
}

function mockManagement() {
  const records = new Map([["first", detail("first")], ["second", detail("second")]]);
  const changes: { action: string; ids: string[] }[] = [];
  const fallback = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (path, options) => {
    const url = new URL(String(path), "https://admin.example");
    if (url.pathname === "/api/admin/requests/manage") {
      expect(options?.method).toBe("POST");
      expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe("token");
      const change = JSON.parse(String(options?.body)) as typeof changes[number];
      changes.push(change);
      for (const id of change.ids) {
        if (change.action === "delete") records.delete(id);
        else records.get(id)!.archivedAt = change.action === "archive" ? createdAt : null;
      }
      return Response.json({ changed: change.ids.length });
    }
    if (url.pathname === "/api/admin/requests") {
      const archived = url.searchParams.has("archived");
      return Response.json({ requests: Array.from(records.values()).filter((record) => Boolean(record.archivedAt) === archived)
        .map(({ id, createdAt: time }) => ({ id, createdAt: time, nameA: `${id} chemical`, nameB: "Water", status: "Submitted" })), next: null });
    }
    if (url.pathname.startsWith("/api/admin/requests/")) {
      const record = records.get(url.pathname.split("/").at(-1)!);
      return record ? Response.json(record) : Response.json({}, { status: 404 });
    }
    return fallback(path, options);
  });
  return changes;
}

it("archives a selected record and restores it from the archived view", async () => {
  const changes = mockManagement();
  mount();
  await screen.findByRole("link", { name: /first chemical/ });
  fireEvent.click(screen.getByRole("button", { name: "Manage records" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select request first" }));
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  await waitFor(() => expect(screen.queryByRole("link", { name: /first chemical/ })).toBeNull());
  await screen.findByRole("link", { name: /second chemical/ });
  fireEvent.click(screen.getByRole("button", { name: "Archived requests" }));
  await screen.findByRole("link", { name: /first chemical/ });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select request first" }));
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await screen.findByText("No requests match this filter.");
  fireEvent.click(screen.getByRole("button", { name: "Active requests" }));
  await screen.findByRole("link", { name: /first chemical/ });
  expect(changes).toEqual([{ action: "archive", ids: ["first"] }, { action: "restore", ids: ["first"] }]);
});

it("confirms bulk deletion and never sends a delete on cancel", async () => {
  const changes = mockManagement();
  mount();
  await screen.findByRole("link", { name: /first chemical/ });
  fireEvent.click(screen.getByRole("button", { name: "Manage records" }));
  for (const id of ["first", "second"]) fireEvent.click(screen.getByRole("checkbox", { name: `Select request ${id}` }));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  let dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByText(/Records to delete: 2/)).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(changes).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  dialog = within(await screen.findByRole("dialog"));
  fireEvent.click(dialog.getByRole("button", { name: "Delete permanently" }));
  await screen.findByText("No requests match this filter.");
  expect(changes).toEqual([{ action: "delete", ids: ["first", "second"] }]);
});

it("deletes only the open request from its details and returns to the queue", async () => {
  const changes = mockManagement();
  mount("/requests/first");
  await screen.findByText("first detail");
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.click(dialog.getByRole("button", { name: "Delete permanently" }));
  await screen.findByRole("link", { name: /second chemical/ });
  expect(screen.queryByRole("link", { name: /first chemical/ })).toBeNull();
  expect(changes).toEqual([{ action: "delete", ids: ["first"] }]);
});
it("opens a review by clicking the actual queue link without reloading", async () => {
  const pending = deferred();
  const fallback = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((path, options) => String(path).endsWith("/first")
    ? pending.promise.then((response) => response.clone()) : fallback(path, options));
  mount();
  fireEvent.click(await screen.findByRole("link", { name: /first chemical/ }));
  expect(await screen.findByRole("heading", { name: "Review request" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Loading");
  await act(async () => { pending.resolve(Response.json(detail("first"))); });
  expect(await screen.findByText("first detail")).toBeTruthy();
});
it.each(["/requests/first", "/reviews/first"])("loads the direct detail URL %s", async (path) => {
  mount(path);
  expect(await screen.findByText("first detail")).toBeTruthy();
});
it("opens the review alias through client navigation", async () => {
  mount();
  await screen.findByRole("link", { name: /first chemical/ });
  fireEvent.click(screen.getByRole("link", { name: "Review first" }));
  expect(await screen.findByText("first detail")).toBeTruthy();
});
it("preserves Arabic and RTL during detail navigation", async () => {
  localStorage.setItem("aetheris.lang", "ar");
  mount();
  fireEvent.click(await screen.findByRole("link", { name: /first chemical/ }));
  expect(await screen.findByText("first detail")).toBeTruthy();
  expect(screen.getByRole("heading", { name: adminText("adminRequest", "ar") })).toBeTruthy();
  expect(document.documentElement.dir).toBe("rtl");
});
it("navigates between reviews and through browser history", async () => {
  mount();
  fireEvent.click(await screen.findByRole("link", { name: /first chemical/ }));
  expect(await screen.findByText("first detail")).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Open second" }));
  expect(await screen.findByText("second detail")).toBeTruthy();
  expect(screen.queryByText("first detail")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "History back" }));
  expect(await screen.findByText("first detail")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "History back" }));
  expect(await screen.findByRole("link", { name: /first chemical/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "History forward" }));
  expect(await screen.findByText("first detail")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "History forward" }));
  expect(await screen.findByText("second detail")).toBeTruthy();
});
it("opens reviews and restores the queue when scrollTo returns a promise", async () => {
  const scrollTo = vi.mocked(window.scrollTo).mockImplementation(() => Promise.resolve());
  mount();
  fireEvent.click(await screen.findByRole("link", { name: /first chemical/ }));
  expect(await screen.findByText("first detail")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "History back" }));
  expect(await screen.findByRole("link", { name: /first chemical/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "History forward" }));
  expect(await screen.findByText("first detail")).toBeTruthy();
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
});
it("cancels the abandoned review and ignores its late response", async () => {
  const pending = deferred();
  const signals: AbortSignal[] = [];
  const fallback = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((path, options) => {
    if (String(path).endsWith("/first")) {
      signals.push(options!.signal!);
      // Deliberately resolve even after cancellation to exercise stale responses.
      return pending.promise.then((response) => response.clone());
    }
    return fallback(path, options);
  });
  mount();
  fireEvent.click(await screen.findByRole("link", { name: /first chemical/ }));
  await waitFor(() => expect(signals.length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole("link", { name: "Open second" }));
  expect(await screen.findByText("second detail")).toBeTruthy();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  await act(async () => { pending.resolve(Response.json(detail("first"))); });
  expect(screen.queryByText("first detail")).toBeNull();
  expect(screen.getByText("second detail")).toBeTruthy();
});
it.each(["http", "network"])("shows a retryable %s failure during navigation", async (failure) => {
  let allowSuccess = false;
  const fallback = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((path, options) => {
    if (String(path).endsWith("/first") && !allowSuccess) {
      return failure === "http" ? Promise.resolve(Response.json({}, { status: 500 }))
        : Promise.reject(new TypeError("Failed to fetch"));
    }
    return fallback(path, options);
  });
  mount();
  fireEvent.click(await screen.findByRole("link", { name: /first chemical/ }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/Unable|load|request/i);
  allowSuccess = true;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("first detail")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
