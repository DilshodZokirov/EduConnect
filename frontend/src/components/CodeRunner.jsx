import { useState } from 'react';
import { api } from '../api.js';
import CodeEditor from './CodeEditor.jsx';
import Icon from './Icon.jsx';

export const LANGUAGE_NAMES = {
  python: 'Python', javascript: 'JavaScript', cpp: 'C++', c: 'C', csharp: 'C#', java: 'Java', go: 'Go', php: 'PHP',
  html: 'HTML/CSS',
};

/** Ilova ichidagi IDE: muharrir, burchakda ▶ Run, kirish ma'lumoti va natija konsoli (HTML — jonli ko'rinish). */
export default function CodeRunner({ language, code, onCode, readOnly = false, extraActions = null }) {
  const [stdin, setStdin] = useState('');
  const [showStdin, setShowStdin] = useState(false);
  const [out, setOut] = useState(null);
  const [running, setRunning] = useState(false);
  const isHtml = language === 'html';

  async function run() {
    if (isHtml) { setOut({ html: code }); return; }
    setRunning(true);
    setOut(null);
    try {
      setOut(await api('/code/run', { method: 'POST', body: { language, code, stdin } }));
    } catch (e) {
      setOut({ error: e.message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="ide">
      <div className="ide-bar">
        <span className="ide-lang">{LANGUAGE_NAMES[language] ?? language}</span>
        {!isHtml && (
          <button type="button" className="ide-link" onClick={() => setShowStdin((v) => !v)}>
            {showStdin ? 'Kirishni yashirish' : "Kirish ma'lumoti"}
          </button>
        )}
        <span className="grow" />
        {extraActions}
        <button type="button" className="run-btn" onClick={run} disabled={running || !code?.trim()}>
          {running ? <span className="spinner" /> : <Icon name="play" size={16} />} Run
        </button>
      </div>
      <CodeEditor value={code} onChange={onCode} language={language} readOnly={readOnly} />
      {showStdin && (
        <textarea className="stdin" rows={3} value={stdin} onChange={(e) => setStdin(e.target.value)}
          placeholder="Dastur o'qiydigan ma'lumot (har qator — alohida kirish)" />
      )}
      {out && (out.html !== undefined ? (
        <iframe title="Natija" className="preview" sandbox="allow-scripts" srcDoc={out.html} />
      ) : (
        <div className="console" aria-live="polite">
          <div className="console-head">
            <span>Natija</span>
            {out.exit_code !== undefined && out.exit_code !== null && !out.error && <span className="muted">kod: {out.exit_code}</span>}
          </div>
          {out.error && <pre className="console-err">{out.error}</pre>}
          {out.compile_error && <pre className="console-err">Kompilyatsiya xatosi:{'\n'}{out.compile_error}</pre>}
          {out.timed_out && <pre className="console-err">Vaqt tugadi — dastur juda uzoq ishladi (cheksiz sikl bo'lishi mumkin)</pre>}
          {out.stdout && <pre>{out.stdout}</pre>}
          {out.stderr && <pre className="console-err">{out.stderr}</pre>}
          {!out.error && !out.compile_error && !out.stdout && !out.stderr && !out.timed_out && <pre className="muted">(hech narsa chiqmadi)</pre>}
        </div>
      ))}
    </div>
  );
}
