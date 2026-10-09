import { useEffect, useState } from 'react';
import { api, apiUpload } from '../../api.js';
import { useToast } from '../../hooks.jsx';
import CodeRunner from '../../components/CodeRunner.jsx';
import Icon from '../../components/Icon.jsx';
import { Button, Card } from '../../components/ui.jsx';

const draftKey = (id) => `code.draft.${id}`;

export function TestResults({ results }) {
  if (!results?.length) return null;
  return (
    <div className="test-results">
      {results.map((r, i) => (
        <div key={i} className={`test-row ${r.passed ? 'ok' : 'bad'}`}>
          <b className="small">{r.passed ? '✓' : '✕'} {i + 1}-misol{r.hidden ? ' (yashirin)' : ''}</b>
          {!r.hidden && !r.passed && (
            <div className="small test-diff">
              {r.input !== null && r.input !== '' && <p><span className="muted">Kirish:</span> <code>{r.input}</code></p>}
              <p><span className="muted">Kutilgan:</span> <code>{r.expected}</code></p>
              <p><span className="muted">Chiqdi:</span> <code>{r.got || '(hech narsa)'}</code></p>
            </div>
          )}
          {r.error && <p className="small warn-text">{r.error}</p>}
        </div>
      ))}
    </div>
  );
}

/** O'quvchi uchun kod vazifasi: misollar, IDE (Run), Tekshirish va Topshirish. */
export default function CodeTask({ assignment, onSubmitted }) {
  const toast = useToast();
  const a = assignment;
  const [code, setCode] = useState(() => {
    try { return localStorage.getItem(draftKey(a.id)) ?? a.submission?.text ?? a.starter_code ?? ''; } catch { return a.starter_code ?? ''; }
  });
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const canSubmit = a.status !== 'graded';
  const isHtml = a.language === 'html';

  useEffect(() => { try { localStorage.setItem(draftKey(a.id), code); } catch { /* */ } }, [code, a.id]);

  async function runChecks() {
    setChecking(true);
    try {
      setCheck(await api(`/student/assignments/${a.id}/check`, { method: 'POST', body: { code } }));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('text', code);
      form.append('is_code', 'true');
      const updated = await apiUpload(`/student/assignments/${a.id}/submit`, form);
      toast('Kod topshirildi. Misollar tekshirildi, AI izohi tez orada chiqadi');
      try { localStorage.removeItem(draftKey(a.id)); } catch { /* */ }
      onSubmitted(updated);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {(a.expected || a.examples.length > 0) && (
        <Card>
          {a.expected && <p className="small"><b>Nima chiqishi kerak:</b> {a.expected}</p>}
          {a.examples.map((ex, i) => (
            <div key={i} className="example">
              <span className="muted small">{i + 1}-misol</span>
              <div className="row example-io">
                <div className="grow"><span className="muted small">Kirish</span><pre className="mini-pre">{ex.input || '(bo\'sh)'}</pre></div>
                <div className="grow"><span className="muted small">Natija</span><pre className="mini-pre">{ex.output}</pre></div>
              </div>
            </div>
          ))}
          {a.hidden_tests > 0 && <p className="muted small">Yana {a.hidden_tests} ta yashirin misol topshirganingizda tekshiriladi.</p>}
        </Card>
      )}

      <CodeRunner language={a.language} code={code} onCode={setCode} readOnly={!canSubmit}
        extraActions={canSubmit && a.starter_code ? (
          <button type="button" className="ide-link" onClick={() => setCode(a.starter_code)}>Boshidan</button>
        ) : null} />

      {canSubmit && (
        <div className="row">
          {!isHtml && a.examples.length > 0 && (
            <Button variant="outline" onClick={runChecks} loading={checking} disabled={!code.trim()}>✓ Tekshirish</Button>
          )}
          <Button onClick={submit} loading={busy} disabled={!code.trim()}>{a.submission ? 'Qayta topshirish' : 'Topshirish'}</Button>
        </div>
      )}
      {check && (
        <Card>
          <div className="kv"><b>Misollar: {check.passed} / {check.total} o'tdi</b>{check.passed === check.total && check.total > 0 && <span>🎉</span>}</div>
          <TestResults results={check.results} />
          {check.hidden > 0 && <p className="muted small">Yana {check.hidden} ta yashirin misol topshirganda tekshiriladi.</p>}
        </Card>
      )}
      {a.submission?.tests_total ? (
        <p className="small center"><Icon name="checksq" size={16} /> Topshirilgan kod: {a.submission.tests_passed} / {a.submission.tests_total} misol o'tgan</p>
      ) : null}
    </>
  );
}
