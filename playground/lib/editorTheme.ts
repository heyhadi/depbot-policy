import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Let the surrounding card's background show through, so the editors match the page in both themes.
// Highest precedence, or the built-in dark theme's background wins.
export const transparentEditor = Prec.highest(
  EditorView.theme({
    "&": { backgroundColor: "transparent" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRight: "1px solid rgb(127 127 127 / 0.15)",
    },
  }),
);
