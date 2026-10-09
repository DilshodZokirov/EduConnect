import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, tg } from '../../api.js';
import { confirmDialog, useApi, useToast } from '../../hooks.jsx';
import {
  finishRecording, openPip, pauseRecording, pipSupported, resetRecording, resumeRecording, startRecording,
  useRecording,
} from '../../recordingStore.js';
import { expiryLabel, formatDuration, formatSize, openExternal } from '../../materials.js';
import { insideTelegram, recordingSupport } from '../../recorder.js';
import Icon from '../../components/Icon.jsx';
import {
  Button, Card, CheckRow, Content, ErrorBox, Header, Loading, Pill, useTelegramBack,
} from '../../components/ui.jsx';

const LEVEL_BARS = 16;

/** Telefon yoki ekranni yozib bo'lmaydigan oyna: tushuntirish va boshqa yo'llar. */
function Unsupported({ lesson, phone, reason, onUploadInstead }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState(false);

  async function sendToDesktop() {
    setBusy('send');
    try {
      await api(`/mentor/lessons/${lesson.id}/record/send`, { method: 'POST' });
      setSent(true);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function openInBrowser() {
    setBusy('browser');
    try {
      const { url } = await api(`/mentor/lessons/${lesson.id}/record/browser`, { method: 'POST' });
      openExternal(url);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  if (phone) {
    return (
      <Content className="content-roomy">
        <div className="intro center">
          <div className="status-circle warn"><Icon name="video" size={40} /></div>
          <h1 className="title-lg center">Dars yozish faqat kompyuterda ishlaydi</h1>
          <p className="muted narrow center">
            Telefon ekranni yozishga ruxsat bermaydi. Darsni kompyuterdagi Telegram yoki Chrome brauzeri orqali yozing.
          </p>
        </div>
        {sent ? (
          <Card>
            <div className="row" style={{ gap: 12 }}>
              <span className="status-circle small-circle"><Icon name="check" size={22} /></span>
              <div className="grow">
                <b>Xabar yuborildi</b>
                <p className="muted small">Kompyuterdagi Telegram'da EduConnect botini oching va «Darsni yozish» tugmasini bosing.</p>
              </div>
            </div>
          </Card>
        ) : (
          <Card>
            <b>Kompyuterga qanday o'tiladi</b>
            <p className="muted small">
              Pastdagi tugmani bossangiz, bot sizga «Darsni yozish» tugmali xabar yuboradi. Telegram hamma qurilmada bir xil —
              xabar kompyuteringizda ham paydo bo'ladi.
            </p>
            <Button onClick={sendToDesktop} loading={busy === 'send'}>Kompyuterga yuborish</Button>
          </Card>
        )}
        <Button variant="outline" onClick={onUploadInstead}>Tayyor videoni yuklash</Button>
        <p className="muted small center">Darsni boshqa dastur bilan yozib olgan bo'lsangiz, videoni shu yerdan yuklashingiz mumkin.</p>
      </Content>
    );
  }

  return (
    <Content className="content-roomy">
      <div className="intro center">
        <div className="status-circle warn"><Icon name="video" size={40} /></div>
        <h1 className="title-lg center">Bu oynada ekranni yozib bo'lmaydi</h1>
        <p className="muted narrow center">
          {reason || "Telegram ilovasining bu versiyasi ekranni yozishga ruxsat bermaydi."} Darsni Chrome brauzerida
          yozing — havola faqat siz uchun va 10 daqiqa amal qiladi.
        </p>
      </div>
      <Button onClick={openInBrowser} loading={busy === 'browser'}>Brauzerda ochish</Button>
      <Button variant="outline" onClick={onUploadInstead}>Tayyor videoni yuklash</Button>
    </Content>
  );
}

/** Telegram oynasida ekran ulashish ishlamasa — Chrome'da ochish. */
function BrowserFallback({ lesson }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const { url } = await api(`/mentor/lessons/${lesson.id}/record/browser`, { method: 'POST' });
      openExternal(url);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <b>Telegram'da ishlamayaptimi?</b>
      <p className="muted small">Darsni Chrome brauzerida yozing. Havola faqat siz uchun va 10 daqiqa amal qiladi.</p>
      <Button variant="outline" onClick={open} loading={busy}>Brauzerda ochish</Button>
    </Card>
  );
}

function Setup({ lesson, group, onStart, starting, error }) {
  const [mic, setMic] = useState(true);
  const [sysAudio, setSysAudio] = useState(false);
  return (
    <Content>
      <div className="hero-card">
        <p className="hero-label">{group?.name ?? ''}</p>
        <h2 className="hero-title">Ekrandan dars yozish</h2>
        <p className="hero-sub">«{lesson.title}» — ekran va ovozingiz yoziladi. Tugatgach video o'zi siqiladi va o'quvchilarga yuboriladi.</p>
      </div>

      <h2 className="section-title">Nimalar yoziladi</h2>
      <Card className="card-flush">
        <CheckRow checked onChange={() => {}} title="Butun ekran"
          sub="Prezentatsiya, brauzer, kod muharriri — qaysi dasturga o'tsangiz ham hammasi yoziladi" />
        <CheckRow checked={mic} onChange={setMic} title="Mikrofon" sub="Ovozingiz aniq eshitiladi (shovqin kamaytiriladi)" />
        <CheckRow checked={sysAudio} onChange={setSysAudio} title="Kompyuter ovozi"
          sub="Darsda video yoki audio qo'ysangiz. Chrome'da «ovozni ham ulashish» belgisini qo'ying" />
      </Card>

      <Card>
        <div className="kv"><span className="muted">Sifat</span><b>1080p gacha · 15 kadr/s</b></div>
        <div className="divider" />
        <div className="kv"><span className="muted">1,5 soatlik dars</span><b>≈ 150–250 MB</b></div>
        <div className="divider" />
        <div className="kv"><span className="muted">Saqlanadi</span><Pill tone="warn">7 kun</Pill></div>
      </Card>

      <Card className="card-info">
        <b>Qanday ishlaydi</b>
        <ol className="rec-howto">
          <li>«Yozishni boshlash»ni bosing va oynadan <b>«Butun ekran» (Entire screen)</b>ni tanlang.</li>
          <li>Prezentatsiyani oching, boshqa dasturlarga bemalol o'ting — yozuv to'xtamaydi.</li>
          <li>Pauza va tugatish — kichik suzuvchi panelda yoki shu ilovada.</li>
        </ol>
      </Card>

      {error?.code === 'not-monitor' ? (
        <Card className="card-warn">
          <b>Butun ekran tanlanmadi</b>
          <p className="muted small">
            Siz faqat bitta oyna yoki brauzer varag'ini tanladingiz. Boshqa dasturga (masalan, prezentatsiyaga) o'tsangiz, u yozilmaydi.
          </p>
          <Button onClick={() => onStart({ mic, sysAudio })} loading={starting}>Qayta tanlash — butun ekran</Button>
          <Button variant="outline" onClick={() => onStart({ mic, sysAudio, allowWindow: true })} disabled={starting}>
            Faqat shu oynani yozish
          </Button>
        </Card>
      ) : error && <ErrorBox text={error.message} />}
      <p className="muted small center">Pauza vaqtida hech narsa yozilmaydi. Yozuv yozilayotgan paytda yuklanib boradi.</p>
      <button type="button" className="btn btn-primary btn-icon btn-rec" disabled={starting}
        onClick={() => onStart({ mic, sysAudio })}>
        {starting ? <span className="spinner" aria-label="Yuklanmoqda" /> : <><span className="rec-dot rec-dot-white" /> Yozishni boshlash</>}
      </button>
    </Content>
  );
}

function Live({ lesson, state, onPause, onResume, onStop, onPip, pipOpen }) {
  const bars = Array.from({ length: LEVEL_BARS }, (_, i) => {
    const wave = 0.55 + 0.45 * Math.sin((i / LEVEL_BARS) * Math.PI);
    return Math.max(3, Math.round(state.level * wave * 28));
  });
  return (
    <Content>
      <div className={`hero-card rec-hero ${state.paused ? 'is-paused' : ''}`}>
        <p className="rec-label">
          {state.paused ? <><Icon name="clock" size={14} /> PAUZA</> : <><span className="rec-dot" /> YOZILMOQDA</>}
        </p>
        <div className="rec-time">{formatDuration(Math.floor(state.elapsedMs / 1000)) || '0:00'}</div>
        <p className="hero-sub center">{lesson.title}</p>
        {state.hasMic && (
          <div className="rec-level" aria-hidden="true">
            {bars.map((h, i) => <i key={i} style={{ height: h }} />)}
          </div>
        )}
        <p className="hero-sub small center">{state.hasMic ? (state.paused ? 'Mikrofon kutmoqda' : 'Mikrofon ishlayapti') : 'Mikrofonsiz yozilmoqda'}</p>
      </div>

      <div className="rec-controls">
        {state.paused ? (
          <button type="button" className="rec-round rec-resume" onClick={onResume} aria-label="Davom ettirish">
            <Icon name="play" size={28} /><b>Davom etish</b>
          </button>
        ) : (
          <button type="button" className="rec-round rec-pause" onClick={onPause} aria-label="Pauza">
            <Icon name="pause" size={28} /><b>Pauza</b>
          </button>
        )}
        <button type="button" className="rec-round rec-stop" onClick={onStop} aria-label="Tugatish">
          <Icon name="stop" size={26} /><b>Tugatish</b>
        </button>
      </div>

      {state.offline && (
        <p className="error-box">Internet uzildi — yozish davom etmoqda. Aloqa tiklanishi bilan yuklash davom etadi.</p>
      )}

      <Card>
        <div className="kv"><span className="muted">Yozildi</span><b>{formatSize(state.recordedBytes) || '0 KB'}</b></div>
        <div className="divider" />
        <div className="kv"><span className="muted">Serverga yuklandi</span><b>{formatSize(state.uploadedBytes) || '0 KB'}</b></div>
        <div className="divider" />
        <div className="kv"><span className="muted">Pauzalar</span>
          <b>{state.pauses ? `${state.pauses} marta · ${Math.round(state.pausedMs / 60000)} daq` : "yo'q"}</b></div>
      </Card>
      {pipSupported() && !pipOpen && (
        <Card>
          <b>Suzuvchi panel</b>
          <p className="muted small">Kichik oyna har doim boshqa oynalar ustida turadi: prezentatsiya ko'rsatayotganda ham vaqt, pauza va tugatish ko'rinib turadi.</p>
          <Button variant="outline" onClick={onPip}>Suzuvchi panelni ochish</Button>
        </Card>
      )}
      {pipOpen && <p className="muted small center">Suzuvchi panel ochiq — uni ekranning bir burchagiga surib qo'ying.</p>}
      <p className="muted small center">
        Ilovaning boshqa bo'limlariga ham o'tishingiz mumkin — yozuv to'xtamaydi, tepada qizil panel ko'rinib turadi.
        Faqat Telegram yoki brauzer oynasini yopmang.
      </p>
    </Content>
  );
}

function Step({ state, title, sub }) {
  return (
    <div className="rec-step">
      <span className={`rec-step-dot ${state}`}>{state === 'done' ? <Icon name="check" size={14} /> : state === 'now' ? '…' : ''}</span>
      <div><b>{title}</b><p className="muted small">{sub}</p></div>
    </div>
  );
}

function Finishing({ state, duration }) {
  const pct = state.recordedBytes ? Math.min(100, Math.round((state.uploadedBytes / state.recordedBytes) * 100)) : 100;
  return (
    <Content className="content-roomy">
      <div className="intro center">
        <div className="status-circle"><Icon name="upload" size={38} /></div>
        <h1 className="title-lg">Yozuv yuklanmoqda</h1>
        <p className="muted narrow center">{duration} yozildi. Qolgan qismi serverga yuklanmoqda — ilovani yopmang.</p>
      </div>
      <Card>
        <div className="kv"><b>Yuklanmoqda</b><b>{pct}%</b></div>
        <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
        <p className="muted small">{formatSize(state.uploadedBytes)} / {formatSize(state.recordedBytes)}</p>
        {state.offline && <p className="error-box">Internet uzildi. Aloqa tiklanishi bilan yuklash davom etadi.</p>}
      </Card>
    </Content>
  );
}

function Done({ material, duration, onBack }) {
  return (
    <Content className="content-roomy">
      <div className="intro center">
        <div className="status-circle"><Icon name="check" size={40} /></div>
        <h1 className="title-lg">Yozuv tayyorlanmoqda</h1>
        <p className="muted narrow center">{duration} yozildi va serverga yuklandi. Endi u siqiladi — bu biroz vaqt oladi.</p>
      </div>
      <Card>
        <Step state="done" title="Yozib olindi" sub={`${duration} · ekran va ovoz`} />
        <Step state="done" title="Serverga yuklandi" sub="Bo'laklab, yozish davomida" />
        <Step state="now" title="Siqish" sub="Hajm 2–3 baravar kichrayadi, ovoz tekislanadi" />
        <Step state="todo" title="O'quvchilarga yuborish" sub="Darsga biriktiriladi, botda xabar keladi" />
      </Card>
      {material?.expires_at && (
        <p className="muted small center">Video {expiryLabel(material)} saqlanadi, keyin avtomatik o'chiriladi.</p>
      )}
      <Button onClick={onBack}>Darsga qaytish</Button>
    </Content>
  );
}

export default function Record() {
  const { gid, lid } = useParams();
  const navigate = useNavigate();
  const lessons = useApi(`/mentor/groups/${gid}/lessons`);
  const groups = useApi('/mentor/groups');
  const lesson = lessons.data?.find((l) => String(l.id) === lid);
  const group = groups.data?.find((g) => String(g.id) === gid);
  const rec = useRecording();
  const [unsupportedReason, setUnsupportedReason] = useState('');
  const support = recordingSupport();

  // Boshqa darsning yozuvi ketayotgan bo'lsa — o'sha yozuv sahifasiga
  const otherActive = rec.phase !== 'idle' && rec.phase !== 'done' && (String(rec.gid) !== gid || String(rec.lid) !== lid);
  useEffect(() => {
    if (otherActive) navigate(`/g/${rec.gid}/lessons/${rec.lid}/record`, { replace: true });
  }, [otherActive, navigate, rec.gid, rec.lid]);
  // Yangi yozuv uchun eski "tayyor" holatini tozalaymiz
  useEffect(() => {
    if (rec.phase === 'done' && (String(rec.gid) !== gid || String(rec.lid) !== lid)) resetRecording();
  }, [rec.phase, rec.gid, rec.lid, gid, lid]);
  useEffect(() => {
    if (rec.error?.code === 'unsupported' && insideTelegram()) setUnsupportedReason('Bu Telegram oynasi ekranni ulashishga ruxsat bermadi.');
  }, [rec.error]);

  const toLesson = useCallback(() => navigate(`/g/${gid}/lessons/${lid}`), [navigate, gid, lid]);
  useTelegramBack(toLesson); // yozuv davomida ham boshqa sahifalarga o'tish mumkin

  async function start(opts) {
    await startRecording({ gid, lid: lesson.id, lessonTitle: lesson.title, mic: opts.mic, systemAudio: opts.sysAudio, allowWindow: !!opts.allowWindow });
  }

  async function stop() {
    if (!(await confirmDialog("Yozuv tugatilsinmi? Video saqlanadi va o'quvchilarga yuboriladi."))) return;
    finishRecording();
  }

  if ((lessons.loading && !lessons.data) || (groups.loading && !groups.data)) {
    return <><Header title="Dars yozuvi" onBack={toLesson} /><Loading /></>;
  }
  if (!lesson) {
    return <><Header title="Dars yozuvi" onBack={toLesson} /><Content><ErrorBox text={lessons.error ?? 'Dars topilmadi'} /></Content></>;
  }

  const phase = rec.phase === 'done' && String(rec.lid) !== lid ? 'idle' : rec.phase;
  const idle = phase === 'idle' || phase === 'starting';
  const showUnsupported = idle && (!support.supported || !!unsupportedReason);
  const errorText = rec.error && rec.error.code !== 'unsupported' ? rec.error : null;
  const screenError = rec.error?.code === 'screen-denied'
    ? { code: 'screen-denied', message: insideTelegram()
      ? "Ekranni ulashishga ruxsat berilmadi. Qayta urinib ko'ring yoki pastdagi «Brauzerda ochish» yo'lidan foydalaning."
      : "Ekranni ulashishga ruxsat berilmadi. «Yozishni boshlash»ni bosib, «Butun ekran»ni tanlang." }
    : rec.error?.code === 'mic-denied'
      ? { code: 'mic-denied', message: "Mikrofonga ruxsat berilmadi. Brauzer sozlamalarida ruxsat bering yoki «Mikrofon» belgisini olib tashlang." }
      : errorText;

  return (
    <>
      <Header title="Dars yozuvi" onBack={toLesson} />
      {showUnsupported && (
        <Unsupported lesson={lesson} phone={support.phone} reason={unsupportedReason} onUploadInstead={toLesson} />
      )}
      {!showUnsupported && idle && (
        <>
          <Setup lesson={lesson} group={group} onStart={start} starting={phase === 'starting'} error={screenError} />
          {screenError && screenError.code !== 'not-monitor' && insideTelegram() && <Content><BrowserFallback lesson={lesson} /></Content>}
        </>
      )}
      {phase === 'live' && rec.stats && (
        <Live lesson={lesson} state={rec.stats} onPause={pauseRecording} onResume={resumeRecording} onStop={stop}
          onPip={openPip} pipOpen={rec.pipOpen} />
      )}
      {phase === 'finishing' && rec.stats && <Finishing state={rec.stats} duration={rec.duration} />}
      {phase === 'done' && <Done material={rec.material} duration={rec.duration} onBack={() => { resetRecording(); toLesson(); }} />}
    </>
  );
}

