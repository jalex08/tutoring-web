// The admin's JSON editor: CodeMirror 6 with JSON highlighting, line numbers, undo, search and
// bracket matching. Bundled by scripts/codemirror/build.js into admin/ui/codemirror.js (one file the
// admin serves itself: its CSP allows only its own scripts). Used by admin/ui/config-editor.js only.
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { json } from "@codemirror/lang-json";

function create(parent, text, onChange) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), foldGutter(), history(), drawSelection(), indentOnInput(),
        bracketMatching(), highlightActiveLine(), highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }), json(),
        EditorState.tabSize.of(2), EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ "aria-label": "Config JSON", spellcheck: "false" }),
        EditorView.updateListener.of((u) => { if (u.docChanged && onChange) onChange(); }),
      ],
    }),
  });
  return {
    view,
    getText: () => view.state.doc.toString(),
    setText(t) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } }); },
    gotoLine(n) {
      const line = view.state.doc.line(Math.max(1, Math.min(n || 1, view.state.doc.lines)));
      view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
      view.focus();
    },
  };
}

window.JDTCodeMirror = { create };
