import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { absoluteUrl, openExternal, openMaterial } from '../../materials.js';
import { Pill } from '../../components/ui.jsx';

/** Javob rasmlari: kichik ko'rinishlar, bosilsa to'liq ochiladi. */
export function SubmissionImages({ files }) {
  const [urls, setUrls] = useState({});
  useEffect(() => {
    let alive = true;
    files.forEach(async (f) => {
      try {
        const r = await api(`/homework/files/${f.id}/url`);
        if (alive) setUrls((u) => ({ ...u, [f.id]: absoluteUrl(r.url) }));
      } catch { /* */ }
    });
    return () => { alive = false; };
  }, [files]);
  if (!files.length) return null;
  return (
    <div className="thumbs">
      {files.map((f) => (
        <button key={f.id} type="button" className="thumb" onClick={() => urls[f.id] && openExternal(urls[f.id])}
          aria-label="Rasmni ochish">
          {urls[f.id] ? <img src={urls[f.id]} alt="Javob rasmi" /> : <span className="spinner" />}
        </button>
      ))}
    </div>
  );
}

export function AnswerText({ text, isCode }) {
  if (!text) return null;
  return isCode ? <pre className="code-block">{text}</pre> : <p className="answer-text">{text}</p>;
}

export function TaskFileButton({ assignmentId, fileName }) {
  if (!fileName) return null;
  return (
    <button type="button" className="mini-btn"
      onClick={async () => {
        const r = await api(`/homework/assignments/${assignmentId}/file/url`);
        openExternal(absoluteUrl(r.url));
      }}>
      📎 {fileName}
    </button>
  );
}

/** Mezonlar bo'yicha AI izohlari. withPoints=false bo'lsa — ballarsiz (o'quvchiga baho tasdiqlanguncha). */
export function CriteriaList({ items, withPoints = true }) {
  if (!items?.length) return null;
  return (
    <div className="criteria">
      {items.map((c, i) => (
        <div key={i} className="criteria-row">
          <div className="kv small">
            <b>{c.name}</b>
            {withPoints && c.points !== undefined && <span className="muted">{c.points} / {c.max}</span>}
          </div>
          {c.comment && <p className="muted small">{c.comment}</p>}
        </div>
      ))}
    </div>
  );
}

export const STUDENT_STATUS = {
  new: { text: 'Yangi', tone: 'blue' },
  submitted: { text: 'Topshirildi', tone: 'grey' },
  graded: { text: 'Baholandi', tone: 'blue' },
  overdue: { text: "Muddati o'tgan", tone: 'warn' },
};

export function ScorePill({ score }) {
  if (score === null || score === undefined) return null;
  const tone = score >= 80 ? 'blue' : score >= 60 ? 'grey' : 'warn';
  return <Pill tone={tone}>{score} / 100</Pill>;
}

export { openMaterial };
