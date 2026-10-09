import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { indentUnit, StreamLanguage } from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { csharp } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';

const LANG = {
  python: () => python(),
  javascript: () => javascript(),
  cpp: () => cpp(),
  c: () => cpp(),
  java: () => java(),
  csharp: () => StreamLanguage.define(csharp),
  go: () => StreamLanguage.define(go),
  php: () => php({ plain: true }),
  html: () => html(),
};

const theme = EditorView.theme({
  '&': { fontSize: '14px', border: '1px solid var(--input-line)', borderRadius: '12px', overflow: 'hidden' },
  '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', minHeight: '220px', maxHeight: '60vh' },
  '.cm-gutters': { background: '#f4f5f7', border: 'none' },
  '&.cm-focused': { outline: '2px solid var(--brand)' },
});

/** Kod muharriri (CodeMirror): qator raqamlari, rangli sintaksis, avtomatik surilish. */
export default function CodeEditor({ value, onChange, language, readOnly = false }) {
  const host = useRef(null);
  const view = useRef(null);
  const langSlot = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value ?? '',
        extensions: [
          basicSetup, theme, indentUnit.of('    '),
          langSlot.current.of((LANG[language] ?? LANG.python)()),
          EditorState.readOnly.of(readOnly),
          EditorView.updateListener.of((u) => { if (u.docChanged) onChangeRef.current?.(u.state.doc.toString()); }),
        ],
      }),
    });
    return () => view.current?.destroy();
  }, [readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    view.current?.dispatch({ effects: langSlot.current.reconfigure((LANG[language] ?? LANG.python)()) });
  }, [language]);

  // Tashqaridan qiymat o'zgarsa (masalan, boshlang'ich kodni tiklash)
  useEffect(() => {
    const v = view.current;
    if (v && value !== undefined && value !== v.state.doc.toString()) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="code-editor" />;
}
