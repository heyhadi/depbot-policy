import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Playground } from "@/components/Playground";
import { explainFailure, generatePolicy } from "@/lib/generatePolicy";

vi.mock("@/lib/generatePolicy", () => ({
  generatePolicy: vi.fn(),
  explainFailure: vi.fn(async () => "The API key was rejected. Check it and try again."),
}));

// Same stand-ins as Playground.test.tsx: CodeMirror can't run in jsdom.
vi.mock("@/components/PolicyEditor", () => ({
  PolicyEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Policy file" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock("@/components/CodeViewer", () => ({
  CodeViewer: ({ value, label }: { value: string; label: string }) => <pre aria-label={label}>{value}</pre>,
}));

const written = "version: 1\necosystems:\n  - type: docker\n    directory: /\n    schedule: weekly\n";

// Block body on purpose: a function returned from beforeEach runs as cleanup after each test.
beforeEach(() => {
  vi.mocked(generatePolicy).mockReset();
});

async function openPanel() {
  const user = userEvent.setup();
  render(<Playground />);
  await user.click(screen.getByRole("button", { name: "Describe with AI" }));
  return user;
}

describe("Describe with AI", () => {
  it("is hidden until opened", async () => {
    render(<Playground />);

    const toggle = screen.getByRole("button", { name: "Describe with AI" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Describe your setup")).not.toBeInTheDocument();
  });

  it("needs a description and a key before it can run", async () => {
    const user = await openPanel();
    const submit = screen.getByRole("button", { name: "Write policy" });

    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Describe your setup"), "Docker only");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Anthropic API key"), "sk-ant-test");
    expect(submit).toBeEnabled();
  });

  it("keeps the key in a password field and out of browser storage", async () => {
    const user = await openPanel();
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    await user.type(screen.getByLabelText("Anthropic API key"), "sk-ant-secret");

    expect(screen.getByLabelText("Anthropic API key")).toHaveAttribute("type", "password");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("puts Claude's policy in the editor and shows its notes", async () => {
    vi.mocked(generatePolicy).mockResolvedValue({ source: written, errors: [], notes: ["Assumed a weekly schedule."] });
    const user = await openPanel();

    await user.type(screen.getByLabelText("Describe your setup"), "Docker only");
    await user.type(screen.getByLabelText("Anthropic API key"), "  sk-ant-test  ");
    await user.click(screen.getByRole("button", { name: "Write policy" }));

    expect(generatePolicy).toHaveBeenCalledWith("Docker only", "sk-ant-test", "claude-opus-5-5");
    expect(await screen.findByText(/Claude wrote the policy below/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Policy file" })).toHaveValue(written);
    expect(screen.getByRole("list", { name: "Claude's notes" })).toHaveTextContent("Assumed a weekly schedule.");
    expect(screen.getByLabelText("Start from")).toHaveDisplayValue("Your policy");
  });

  it("offers every model, defaults to Claude Opus 5.5, and shows the chosen one's cost", async () => {
    const user = await openPanel();
    const picker = screen.getByLabelText("Model");

    expect(picker).toHaveDisplayValue("Claude Opus 5.5");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(
      expect.arrayContaining(["Claude Opus 5.5", "Claude Sonnet 5.5", "Claude Haiku 5.5", "Claude Fable 5.1"]),
    );
    expect(screen.getByText(/about 3–5¢ per policy/)).toBeInTheDocument();

    await user.selectOptions(picker, "Claude Haiku 5.5");
    expect(screen.getByText(/well under 1¢ per policy/)).toBeInTheDocument();
  });

  it("generates with the chosen model", async () => {
    vi.mocked(generatePolicy).mockResolvedValue({ source: written, errors: [], notes: [] });
    const user = await openPanel();

    await user.selectOptions(screen.getByLabelText("Model"), "Claude Sonnet 5.5");
    await user.type(screen.getByLabelText("Describe your setup"), "Docker only");
    await user.type(screen.getByLabelText("Anthropic API key"), "sk-ant-test");
    await user.click(screen.getByRole("button", { name: "Write policy" }));

    expect(generatePolicy).toHaveBeenCalledWith("Docker only", "sk-ant-test", "claude-sonnet-5-5");
  });

  it("says when problems are left to fix by hand", async () => {
    vi.mocked(generatePolicy).mockResolvedValue({
      source: "version: 1\necosystems: []\n",
      errors: [{ path: "ecosystems", message: "Too small" }],
      notes: [],
    });
    const user = await openPanel();

    await user.type(screen.getByLabelText("Describe your setup"), "nothing");
    await user.type(screen.getByLabelText("Anthropic API key"), "sk-ant-test");
    await user.click(screen.getByRole("button", { name: "Write policy" }));

    expect(await screen.findByText(/still has 1 problem to fix by hand/)).toBeInTheDocument();
  });

  it("shows a readable error and leaves the editor alone when it fails", async () => {
    vi.mocked(generatePolicy).mockImplementation(async () => {
      throw new Error("401");
    });
    const user = await openPanel();
    const before = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Policy file" }).value;

    await user.type(screen.getByLabelText("Describe your setup"), "Docker only");
    await user.type(screen.getByLabelText("Anthropic API key"), "sk-ant-wrong");
    await user.click(screen.getByRole("button", { name: "Write policy" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The API key was rejected");
    expect(explainFailure).toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Policy file" })).toHaveValue(before);
  });
});
