/**
 * Prompt 4 DONE TEST (no browser): generate a shot list, click "Crane up" and
 * "85mm" on card 2, the prompt preview updates; after a "reload" (fresh store
 * state + localStorage rehydration) the edits are still there.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shotToPrompt } from "../lib/shot";
import { mockShotList } from "../lib/shotList";
import { Editor } from "../src/components/Editor";
import { INITIAL_DATA, STORAGE_KEY, useEditor } from "../src/store/editorStore";

const LOGLINE = "A retired robot opens a noodle shop on Mars";

function mockApi() {
  const list = mockShotList(LOGLINE, "16:9");
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith("/regenerate")
        ? { provider: "mock", action: "A brand new rewritten action.", replacements: [] }
        : { provider: "mock", ...list, aspect: "16:9" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return { list, fetchMock };
}

/** Simulate a page reload: wipe in-memory state, keep localStorage. */
async function reload() {
  cleanup();
  // persist() also writes on setState, so restore the saved snapshot after the reset.
  const saved = localStorage.getItem(STORAGE_KEY);
  useEditor.setState({ ...INITIAL_DATA, status: "idle", error: null, regenerating: {} });
  if (saved) localStorage.setItem(STORAGE_KEY, saved);
  expect(useEditor.getState().shots).toHaveLength(0);
  expect(useEditor.getState().aspect).toBe(INITIAL_DATA.aspect);
}

beforeEach(() => {
  localStorage.clear();
  useEditor.setState({ ...INITIAL_DATA, status: "idle", error: null, regenerating: {} });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = (n: number) => screen.getByRole("group", { name: `Shot ${n}` });
const preview = (n: number) => within(card(n)).getByLabelText(`Shot ${n} prompt preview`).textContent ?? "";

describe("Editor DONE TEST", () => {
  it("Crane up + 85mm on card 2 updates the prompt and survives reload", async () => {
    const { fetchMock } = mockApi();
    render(<Editor />);

    fireEvent.change(screen.getByLabelText(/one sentence/i), { target: { value: LOGLINE } });
    fireEvent.click(screen.getByRole("button", { name: "Write my shots" }));
    await waitFor(() => expect(screen.getAllByRole("group", { name: /^Shot \d$/ })).toHaveLength(5));
    expect(fetchMock).toHaveBeenCalledWith("/api/shotlist", expect.objectContaining({ method: "POST" }));
    expect(screen.getByText(/written by: mock/)).toBeTruthy();

    const before = preview(2);
    expect(before).not.toContain("cranes up");
    expect(before).not.toContain("85mm");

    fireEvent.click(within(card(2)).getByRole("button", { name: /^crane up$/i }));
    fireEvent.click(within(card(2)).getByRole("button", { name: /^85mm lens/i }));

    const after = preview(2);
    expect(after).not.toBe(before);
    expect(after).toContain("camera cranes up");
    expect(after).toContain("85mm portrait lens");
    expect(after).toBe(shotToPrompt(useEditor.getState().shots[1]));
    expect(within(card(2)).getByRole("button", { name: /^crane up$/i }).getAttribute("aria-pressed")).toBe("true");
    // Card 1 untouched
    expect(preview(1)).not.toContain("cranes up");

    // Persisted to localStorage
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(saved.state.shots[1]).toMatchObject({ cameraMove: "crane up", lens: "85mm" });

    // "Reload": fresh state, then the Editor rehydrates from localStorage on mount
    await reload();
    await act(async () => {
      render(<Editor />);
    });
    await waitFor(() => expect(screen.getAllByRole("group", { name: /^Shot \d$/ })).toHaveLength(5));
    expect(preview(2)).toBe(after);
    expect(within(card(2)).getByRole("button", { name: /^85mm lens/i }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText(/one sentence/i) as HTMLInputElement).value).toBe(LOGLINE);
  });

  it("add (max 6), delete, reorder, and regenerate shot text", async () => {
    mockApi();
    render(<Editor />);
    fireEvent.change(screen.getByLabelText(/one sentence/i), { target: { value: LOGLINE } });
    fireEvent.click(screen.getByRole("button", { name: "Write my shots" }));
    await waitFor(() => expect(screen.getAllByRole("group", { name: /^Shot \d$/ })).toHaveLength(5));

    fireEvent.click(screen.getByRole("button", { name: /add shot/i }));
    expect(screen.getAllByRole("group", { name: /^Shot \d$/ })).toHaveLength(6);
    expect(screen.queryByRole("button", { name: /add shot/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete shot 6" }));
    expect(screen.getAllByRole("group", { name: /^Shot \d$/ })).toHaveLength(5);

    const firstAction = useEditor.getState().shots[0].action;
    fireEvent.click(screen.getByRole("button", { name: "Move shot 1 right" }));
    expect(useEditor.getState().shots[1].action).toBe(firstAction);

    fireEvent.click(within(card(3)).getByRole("button", { name: /regenerate this shot/i }));
    await waitFor(() => expect(useEditor.getState().shots[2].action).toBe("A brand new rewritten action."));
  });

  it("aspect toggle and title edits persist", async () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("radio", { name: /9:16/ }));
    expect(useEditor.getState().aspect).toBe("9:16");
    await reload();
    await act(async () => {
      render(<Editor />);
    });
    expect(screen.getByRole("radio", { name: /9:16/ }).getAttribute("aria-checked")).toBe("true");
  });
});
