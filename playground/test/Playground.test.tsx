import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useImperativeHandle, useRef, type Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Playground } from "@/components/Playground";
import type { PolicyEditorHandle } from "@/components/PolicyEditor";
import { presets } from "@/lib/presets";
import { readSharedPolicy, shareUrl } from "@/lib/share";

// CodeMirror needs real layout, which jsdom lacks, so tests swap the two thin wrappers
// around it for plain elements with the same contract.
vi.mock("@/components/PolicyEditor", () => ({
  PolicyEditor: function MockPolicyEditor(props: {
    value: string;
    onChange: (value: string) => void;
    ref?: Ref<PolicyEditorHandle>;
  }) {
    const textarea = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(props.ref, () => ({
      reveal(start, end) {
        textarea.current?.focus();
        textarea.current?.setSelectionRange(start, end);
      },
    }));
    return (
      <textarea
        ref={textarea}
        aria-label="Policy file"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  },
}));

vi.mock("@/components/CodeViewer", () => ({
  CodeViewer: ({ value, label }: { value: string; label: string }) => (
    <pre aria-label={label}>{value}</pre>
  ),
}));

const editor = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Policy file" });
const output = (path: string) => screen.getByLabelText(path);

async function replacePolicy(user: ReturnType<typeof userEvent.setup>, source: string) {
  await user.clear(editor());
  // `{` and `[` are special in user-event's syntax, so paste instead of typing.
  editor().focus();
  await user.paste(source);
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("Playground", () => {
  it("shows the generated dependabot.yml for the default example", () => {
    render(<Playground />);

    expect(screen.getByText("Valid policy")).toBeInTheDocument();
    expect(output(".github/dependabot.yml")).toHaveTextContent("package-ecosystem: npm");
  });

  it("lists errors and keeps the last valid output while the policy is broken", async () => {
    const user = userEvent.setup();
    render(<Playground />);

    await replacePolicy(user, "version: 1\necosystems: [{ type: yarn, directory: / }]\n");

    expect(await screen.findByText("1 error")).toBeInTheDocument();
    const errors = screen.getByRole("list", { name: "Errors" });
    expect(within(errors).getByText("ecosystems[0].type")).toBeInTheDocument();
    expect(screen.getByText(/Showing output from the last valid version/)).toBeInTheDocument();
    expect(output(".github/dependabot.yml")).toHaveTextContent("dependency-name: react");
  });

  it("updates the output once the policy is fixed", async () => {
    const user = userEvent.setup();
    render(<Playground />);

    await replacePolicy(user, "version: 1\necosystems: [{ type: yarn, directory: / }]\n");
    await screen.findByText("1 error");
    await replacePolicy(user, "version: 1\necosystems: [{ type: pip, directory: /api }]\n");

    expect(await screen.findByText("Valid policy")).toBeInTheDocument();
    expect(screen.queryByText(/last valid version/)).not.toBeInTheDocument();
    expect(output(".github/dependabot.yml")).toHaveTextContent("package-ecosystem: pip");
  });

  it("selects the error's source when an error is clicked", async () => {
    const user = userEvent.setup();
    render(<Playground />);
    const source = "version: 1\necosystems: [{ type: npm, directory: / }]\nautoMerge: { updateTypes: [major] }\n";

    await replacePolicy(user, source);
    await user.click(await screen.findByRole("button", { name: /Major updates are never/ }));

    const { selectionStart, selectionEnd } = editor();
    expect(source.slice(selectionStart, selectionEnd)).toBe("major");
  });

  it("switches between generated files with clicks and arrow keys", async () => {
    const user = userEvent.setup();
    render(<Playground />);

    await user.click(screen.getByRole("tab", { name: "dependabot-auto-merge.yml" }));
    expect(output(".github/workflows/dependabot-auto-merge.yml")).toHaveTextContent(
      "gh pr merge --auto --squash",
    );

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "dependabot.yml" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "dependabot.yml" })).toHaveFocus();
  });

  it("loads a preset and marks hand edits as the user's own policy", async () => {
    const user = userEvent.setup();
    render(<Playground />);

    await user.selectOptions(screen.getByLabelText("Start from"), "Minimal");
    expect(editor()).toHaveValue(presets.find((preset) => preset.id === "minimal")!.source);

    await user.type(editor(), "#");
    expect(screen.getByLabelText("Start from")).toHaveDisplayValue("Your policy");
  });

  it("copies a share link that contains the policy", async () => {
    const user = userEvent.setup();
    render(<Playground />);

    await user.click(screen.getByRole("button", { name: "Share link" }));

    const copied = await navigator.clipboard.readText();
    expect(readSharedPolicy(new URL(copied).hash)).toBe(editor().value);
    expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument();
  });

  it("opens the policy from a share link", () => {
    const shared = "version: 1\necosystems: [{ type: cargo, directory: / }]\n";
    window.history.replaceState(null, "", shareUrl(window.location.href, shared));

    render(<Playground />);

    expect(editor()).toHaveValue(shared);
    expect(screen.getByLabelText("Start from")).toHaveDisplayValue("Your policy");
  });
});
