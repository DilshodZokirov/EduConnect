import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, apiUpload } from '../../api.js';
import { toLocalInput } from '../../dates.js';
import { useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { BottomBar, Button, Content, Field, Header, useTelegramBack } from '../../components/ui.jsx';

function defaultDue() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(18, 0, 0, 0);
  return toLocalInput(d);
}

export default function MentorCreate() {
  const { gid, lid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(`/g/${gid}/lessons/${lid}`), [navigate, gid, lid]);
  useTelegramBack(back);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [criteria, setCriteria] = useState('');
  const [due, setDue] = useState(defaultDue);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const dueDate = new Date(due);
  const dueError = due && dueDate <= new Date() ? "Muddat kelajakda bo'lishi kerak" : undefined;
  const ready = title.trim().length >= 2 && description.trim().length >= 3 && criteria.trim().length >= 3 && due && !dueError;

  async function save() {
    setBusy(true);
    try {
      const a = await api(`/mentor/lessons/${lid}/assignments`, {
        method: 'POST',
        body: { title: title.trim(), description: description.trim(), criteria: criteria.trim(), due_at: dueDate.toISOString() },
      });
      if (file) {
        const form = new FormData();
        form.append('file', file);
        await apiUpload(`/mentor/assignments/${a.id}/file`, form);
      }
      toast("Vazifa berildi. O'quvchilarga xabar yuborildi");
      navigate(`/g/${gid}/homework/${a.id}`, { replace: true });
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <>
      <Header title="Uy vazifasi berish" onBack={back} />
      <Content>
        <Field label="Sarlavha" placeholder="Vazifa nomi" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="field">
          <span className="field-label">Topshiriq</span>
          <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="O'quvchi nima qilishi kerakligini batafsil yozing" />
        </label>
        <label className="field">
          <span className="field-label">Baholash mezonlari (jami 100 ball)</span>
          <textarea rows={4} value={criteria} onChange={(e) => setCriteria(e.target.value)}
            placeholder="Har bir mezon va uning ballini yozing. AI aynan shu mezonlar bo'yicha tekshiradi." />
          <span className="field-hint">O'quvchilar ham mezonlarni ko'radi — nimaga e'tibor berish kerakligini bilishadi.</span>
        </label>
        <Field label="Topshirish muddati" type="datetime-local" value={due} error={dueError}
          onChange={(e) => setDue(e.target.value)} />
        <label className="file-pick">
          <input type="file" onChange={(e) => setFile(e.target.files[0] ?? null)}
            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.zip" />
          <Icon name="upload" size={22} />
          <span>{file ? file.name : 'Fayl biriktirish (ixtiyoriy)'}</span>
        </label>
      </Content>
      <BottomBar>
        <Button onClick={save} loading={busy} disabled={!ready}>Vazifani berish</Button>
      </BottomBar>
    </>
  );
}
