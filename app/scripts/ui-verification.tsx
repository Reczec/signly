// Development fixture only: no camera, model claim, or production build entry.
import { createRoot } from 'react-dom/client';
import { RecognitionResultCard } from '../src/ui/RecognitionResultCard';
import { WordBuilderPanel } from '../src/ui/WordBuilderPanel';
import { applyRecognitionResult, createWordBuilder } from '../src/ui/wordBuilder';
import '../src/index.css';
import '../src/App.css';

const labels = ['drink','help','yes','no','thank you','sad','cold','take','give','change','work','day','white',
  'water','name','good','bad','love','family','school','friend','time','again','slow','make','want','need',
  'know','think','see','play','home','night','get','put','walk','sit','stand','wait','call','feel','try',
  'stop','come','hold','write','read','open','close','big'];
const state = applyRecognitionResult(createWordBuilder(), { schemaVersion:1,sessionId:'ui-fixture',sequence:1,
  sign:'thank you',confidence:.94,stable:true,accepted:true,timestamp:0,state:'accepted',handsDetected:2,latencyMs:2,error:null });
createRoot(document.querySelector('#root')!).render(<div className="app-shell">
  <h1>Layoutprüfung</h1><p>Nur Testdarstellung: 50 Beispielwörter, keine Aussage über unterstützte Gebärden.</p>
  <div className="side-col">
    <RecognitionResultCard sign="thank you" confidence={.94} status="accepted" accepted />
    <WordBuilderPanel state={state} onBackspace={() => {}} onClear={() => {}} />
  </div>
  <section className="card strip-card"><h2>50 Beispielwörter</h2><ul className="sign-strip">
    {labels.map(label => <li key={label} className="sign-chip">{label}</li>)}
  </ul></section>
</div>);
