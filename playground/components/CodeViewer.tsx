"use client";

import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { transparentEditor } from "@/lib/editorTheme";

interface CodeViewerProps {
  value: string;
  label: string;
  dark: boolean;
}

/** Read-only, syntax-highlighted YAML. */
export function CodeViewer({ value, label, dark }: CodeViewerProps) {
  const extensions = useMemo(
    () => [
      yaml(),
      EditorView.lineWrapping,
      transparentEditor,
      EditorView.contentAttributes.of({ "aria-label": label }),
    ],
    [label],
  );

  return (
    <CodeMirror
      value={value}
      extensions={extensions}
      theme={dark ? "dark" : "light"}
      editable={false}
      readOnly
      height="100%"
      className="h-full text-sm"
      basicSetup={{ foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
    />
  );
}
