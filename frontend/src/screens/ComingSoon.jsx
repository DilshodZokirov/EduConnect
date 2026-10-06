import Icon from '../components/Icon.jsx';
import { Content, Header } from '../components/ui.jsx';

export default function ComingSoon({ title, step }) {
  return (
    <>
      <Header title={title} />
      <Content className="content-roomy">
        <div className="intro center intro-tall">
          <div className="status-circle"><Icon name="tools" size={40} /></div>
          <h1 className="title-lg">{title}</h1>
          <p className="muted narrow">Bu bo'lim {step}-bosqichda qo'shiladi.</p>
        </div>
      </Content>
    </>
  );
}
