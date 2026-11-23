// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";

declare const jsdom: { window: { localStorage: Storage; FormData: typeof FormData } };

const fetchMock = vi.fn<typeof fetch>();
const password = "Test only: chosen reviewer password!";
const csrfToken = "b".repeat(64);

beforeEach(() => {
  vi.stubGlobal("localStorage", jsdom.window.localStorage);
  vi.stubGlobal("FormData", jsdom.window.FormData);
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><App /></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openLogin() {
  mount();
  return await screen.findByLabelText(/Password/) as HTMLInputElement;
}

it("opens the review queue after password login and signs out with the session's CSRF token", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: "UNAUTHORIZED" }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ reviewer: { login: "admin" }, csrfToken }))
    .mockResolvedValueOnce(Response.json({ requests: [], next: null }))
    .mockResolvedValueOnce(Response.json({ signedOut: true }));

  const input = await openLogin();
  expect(input.type).toBe("password");
  fireEvent.change(input, { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByText("No requests match this filter.")).toBeTruthy();
  const [loginPath, login] = fetchMock.mock.calls[1];
  expect(loginPath).toBe("/api/admin/auth/login");
  expect(login).toMatchObject({ method: "POST", credentials: "same-origin", redirect: "error" });
  expect(new Headers(login?.headers).get("Content-Type")).toBe("application/json");
  expect(login?.body).toBe(JSON.stringify({ password }));
  expect(Object.values(localStorage)).not.toContain(password);

  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect((await screen.findByLabelText(/Password/) as HTMLInputElement).value).toBe("");
  const [logoutPath, logout] = fetchMock.mock.calls[3];
  expect(logoutPath).toBe("/api/admin/auth/logout");
  expect(logout?.method).toBe("POST");
  expect(new Headers(logout?.headers).get("X-CSRF-Token")).toBe(csrfToken);
});

it.each([
  [401, "Check the password and try again."],
  [429, "Too many sign-in attempts. Wait before trying again."],
  [503, "Unable to reach the review workspace. Try again in a moment."],
])("shows a safe login error for HTTP %i", async (status, message) => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: "UNAUTHORIZED" }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ error: password }, { status }));

  const input = await openLogin();
  fireEvent.change(input, { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  expect((await screen.findByRole("alert")).textContent).toContain(message);
  expect(screen.getByRole("alert").textContent).not.toContain(password);
  expect(input.value).toBe("");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("identifies a static Pages deployment that responds to the session check with HTML", async () => {
  fetchMock.mockResolvedValueOnce(new Response("<!doctype html><title>Aetheris Admin</title>", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }));

  mount();
  expect((await screen.findByRole("alert")).textContent).toContain("Reviewer sign-in is unavailable on this deployment.");
  expect(screen.queryByLabelText(/Password/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});
