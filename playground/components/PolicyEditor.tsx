"use client";

import { yaml } from "@codemirror/lang-yaml";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import type { PolicyError } from "depbot-policy";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { toDiagnostics } from "@/lib/diagnostics";
import { transparentEditor } from "@/lib/editorTheme";

export interface PolicyEditorHandle {
  /** Selects a range, scrolls it into view, and focuses the editor. */
  reveal(start: number, end: number): void;
}

interface PolicyEditorProps {
  value: string;
  onChange: (value: string) => void;
  errors: readonly PolicyError[];
  dark: boolean;
  ref?: Ref<PolicyEditorHandle>;
}

const extensions = [
  yaml(),
  lintGutter(),
  transparentEditor,
  EditorView.contentAttributes.of({ "aria-label": "Policy file" }),
];

export function PolicyEditor({ value, onChange, errors, dark, ref }: PolicyEditorProps) {
  const editor = useRef<ReactCodeMirrorRef>(null);

  useImperativeHandle(ref, () => ({
    reveal(start, end) {
      const view = editor.current?.view;
      if (view === undefined) return;
      const length = view.state.doc.length;
      view.dispatch({
        selection: EditorSelection.single(Math.min(start, length), Math.min(end, length)),
        scrollIntoView: true,
      });
      view.focus();
    },
  }));

  useEffect(() => {
    const view = editor.current?.view;
    if (view === undefined) return;
    view.dispatch(setDiagnostics(view.state, toDiagnostics(errors, view.state.doc.length)));
  }, [errors]);

  return (
    <CodeMirror
      ref={editor}
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={dark ? "dark" : "light"}
      height="100%"
      className="h-full text-sm"
      basicSetup={{ foldGutter: false, highlightActiveLine: false }}
    />
  );
}
