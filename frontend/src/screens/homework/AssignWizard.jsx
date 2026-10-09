import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, apiUpload } from '../../api.js';
import { toLocalInput } from '../../dates.js';
import { useToast } from '../../hooks.jsx';
import CodeRunner, { LANGUAGE_NAMES } from '../../components/CodeRunner.jsx';
import Icon from '../../components/Icon.jsx';
import {
  BottomBar, Button, Card, Chip, Content, Field, Header, Select, useTelegramBack,
} from '../../components/ui.jsx';

const TYPES = [
  { key: 'text', label: 'Uy vazifasi', hint: 'Matn, rasm yoki fayl bilan javob' },
  { key: 'code', label: 'Kod yozish', hint: "Ilova ichidagi muharrirda, Run va avtomatik tekshiruv bilan" },
  { key: 'test', label: 'Test', hint: 'Variantli va qisqa javobli savollar' },
];

function dueIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + (days || 2));
  d.setHours(18, 0, 0, 0);
  return toLocalInput(d);
}

function TestCases({ cases, onChange }) {
  const set = (i, patch) => onChange(cases.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="stack">
      {cases.map((c, i) => (
        <div key={i} className="case">
          <div className="kv small">
            <b>{i + 1}-misol {c.hidden ? '(yashirin)' : ''}</b>
            <div className="row">
              <button type="button" className="link-btn" onClick={() => set(i, { hidden: !c.hidden })}>
                {c.hidden ? 'Ochiq qilish' : 'Yashirish'}
              </button>
              <button type="button" className="icon-btn icon-btn-danger" aria-label="O'chirish" onClick={() => onChange(cases.filter((_, j) => j !== i))}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          </div>
          <div className="row">
            <label className="field"><span className="field-label">Kirish (stdin)</span>
              <textarea className="code-input" rows={2} value={c.input} onChange={(e) => set(i, { input: e.target.value })} /></label>
            <label className="field"><span className="field-label">Kutilgan natija</span>
              <textarea className="code-input" rows={2} value={c.output} onChange={(e) => set(i, { output: e.target.value })} /></label>
          </div>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...cases, { input: '', output: '', hidden: false }])}>+ Misol qo'shish</button>
      <p className="muted small">Ochiq misollarni o'quvchi ko'radi va «Tekshirish» bilan sinaydi. Yashirinlari faqat topshirganda tekshiriladi.</p>
    </div>
  );
}

/** "Topshiriq berish": turini tanlash → qisqa tavsif → AI qoralamasi → tahrirlash → e'lon qilish. */
export default function AssignWizard() {
  const { gid, lid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(`/g/${gid}/lessons/${lid}`), [navigate, gid, lid]);
  useTelegramBack(back);

  const [kind, setKind] = useState('text');
  const [brief, setBrief] = useState('');
  const [expectedBrief, setExpectedBrief] = useState('');
  const [requirements, setRequirements] = useState('');
  const [language, setLanguage] = useState('python');
  const [questionCount, setQuestionCount] = useState(10);
  const [drafting, setDrafting] = useState(false);
  const [step, setStep] = useState(1);
  const [tips, setTips] = useState([]);
  const [minutes, setMinutes] = useState(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [criteria, setCriteria] = useState('');
  const [expected, setExpected] = useState('');
  const [starter, setStarter] = useState('');
  const [cases, setCases] = useState([]);
  const [due, setDue] = useState(dueIn(2));
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  async function askAI() {
    setDrafting(true);
    try {
      const d = await api('/mentor/ai/draft', {
        method: 'POST',
        body: { kind, brief: brief.trim(), expected: expectedBrief.trim() || null, requirements: requirements.trim() || null,
          language: kind === 'code' ? language : null, question_count: questionCount },
      });
      if (kind === 'test') {
        navigate(`/g/${gid}/tests/new`, { state: { draft: d, lessonId: Number(lid) } });
        return;
      }
      setTitle(d.title); setDescription(d.description); setCriteria(d.criteria); setExpected(d.expected ?? expectedBrief);
      setStarter(d.starter_code ?? ''); setCases(d.test_cases ?? []);
      setDue(dueIn(d.suggested_days)); setMinutes(d.suggested_minutes); setTips(d.tips ?? []);
      setStep(2);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setDrafting(false);
    }
  }

  function manual() {
    if (kind === 'test') { navigate(`/g/${gid}/tests/new`, { state: { lessonId: Number(lid) } }); return; }
    setDescription(brief); setExpected(expectedBrief);
    setCriteria(requirements ? `Talablar:\n${requirements}` : '');
    setStep(2);
  }

  async function publish() {
    setBusy(true);
    try {
      const a = await api(`/mentor/lessons/${lid}/assignments`, {
        method: 'POST',
        body: {
          title: title.trim(), description: description.trim(), criteria: criteria.trim(), due_at: new Date(due).toISOString(),
          kind, language: kind === 'code' ? language : null, starter_code: kind === 'code' ? starter : null,
          expected: expected.trim() || null,
          test_cases: kind === 'code' && language !== 'html' ? cases.filter((c) => c.output.trim()) : [],
        },
      });
      if (file) {
        const form = new FormData();
        form.append('file', file);
        await apiUpload(`/mentor/assignments/${a.id}/file`, form);
      }
      toast("Topshiriq e'lon qilindi. O'quvchilarga xabar yuborildi");
      navigate(`/g/${gid}/homework/${a.id}`, { replace: true });
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  const dueError = due && new Date(due) <= new Date() ? "Muddat kelajakda bo'lishi kerak" : undefined;
  const ready = title.trim().length >= 2 && description.trim().length >= 3 && criteria.trim().length >= 3 && !dueError;

  if (step === 1) {
    return (
      <>
        <Header title="Topshiriq berish" onBack={back} />
        <Content>
          <div className="type-grid">
            {TYPES.map((t) => (
              <button key={t.key} type="button" className={`type-card ${kind === t.key ? 'on' : ''}`} onClick={() => setKind(t.key)}>
                <b>{t.label}</b><span className="muted small">{t.hint}</span>
              </button>
            ))}
          </div>
          {kind === 'code' && (
            <Select label="Dasturlash tili" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {Object.entries(LANGUAGE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
          <label className="field">
            <span className="field-label">Topshiriq nima haqida</span>
            <textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)}
              placeholder="O'z so'zlaringiz bilan qisqacha yozing" />
          </label>
          {kind !== 'test' && (
            <label className="field">
              <span className="field-label">Nima chiqishi kerak (ixtiyoriy)</span>
              <textarea rows={2} value={expectedBrief} onChange={(e) => setExpectedBrief(e.target.value)}
                placeholder={kind === 'code' ? 'Masalan: qanday kirish berilsa, qanday natija chiqishi kerak' : 'Kutilgan natija'} />
            </label>
          )}
          <label className="field">
            <span className="field-label">{kind === 'test' ? "Qo'shimcha talablar (ixtiyoriy)" : 'Talablar (ixtiyoriy)'}</span>
            <textarea rows={2} value={requirements} onChange={(e) => setRequirements(e.target.value)}
              placeholder={kind === 'test' ? "Qiyinlik darajasi, qaysi mavzular" : 'Nimalardan foydalanish kerak yoki mumkin emas'} />
          </label>
          {kind === 'test' && (
            <Field label="Savollar soni" type="number" min={1} max={30} value={questionCount}
              onChange={(e) => setQuestionCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
          )}
          <p className="muted small">AI to'liq matn, baholash mezonlari, muddat{kind === 'code' ? ', boshlang\'ich kod va tekshiruv misollari' : kind === 'test' ? ' va savollar' : ''} qoralamasini tayyorlaydi. Siz tahrirlab, keyin e'lon qilasiz.</p>
        </Content>
        <BottomBar>
          <Button onClick={askAI} loading={drafting} disabled={brief.trim().length < 5}>
            <Icon name="sparkle" size={18} />&nbsp;AI yordamida tayyorlash
          </Button>
          <button type="button" className="link-btn" onClick={manual} disabled={drafting}>O'zim yozaman</button>
        </BottomBar>
      </>
    );
  }

  return (
    <>
      <Header title={kind === 'code' ? 'Kod vazifasi' : 'Uy vazifasi'} onBack={() => setStep(1)} />
      <Content>
        {(tips.length > 0 || minutes) && (
          <div className="ai-box">
            <p className="small"><Icon name="sparkle" size={16} /> <b>AI maslahatlari</b></p>
            {minutes && <p className="small">Taxminiy bajarish vaqti: <b>{minutes} daqiqa</b></p>}
            {tips.map((t, i) => <p key={i} className="small">• {t}</p>)}
          </div>
        )}
        <Field label="Sarlavha" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="field"><span className="field-label">Topshiriq matni</span>
          <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="field"><span className="field-label">Nima chiqishi kerak</span>
          <textarea rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} /></label>
        <label className="field"><span className="field-label">Baholash mezonlari (jami 100 ball)</span>
          <textarea rows={4} value={criteria} onChange={(e) => setCriteria(e.target.value)} /></label>
        <Field label="Topshirish muddati" type="datetime-local" value={due} error={dueError} onChange={(e) => setDue(e.target.value)} />

        {kind === 'code' && (
          <>
            <h2 className="section-title">Boshlang'ich kod ({LANGUAGE_NAMES[language]})</h2>
            <p className="muted small">O'quvchi muharrirni shu kod bilan ochadi. Run bilan sinab ko'rishingiz mumkin.</p>
            <CodeRunner language={language} code={starter} onCode={setStarter} />
            {language !== 'html' && (
              <>
                <h2 className="section-title">Tekshiruv misollari</h2>
                <TestCases cases={cases} onChange={setCases} />
              </>
            )}
          </>
        )}
        {kind === 'text' && (
          <label className="file-pick">
            <input type="file" onChange={(e) => setFile(e.target.files[0] ?? null)} />
            <Icon name="upload" size={22} /><span>{file ? file.name : 'Fayl biriktirish (ixtiyoriy)'}</span>
          </label>
        )}
      </Content>
      <BottomBar>
        <Button onClick={publish} loading={busy} disabled={!ready}>E'lon qilish</Button>
      </BottomBar>
    </>
  );
}
