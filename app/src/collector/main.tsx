import { createRoot } from 'react-dom/client'
import './style.css'

createRoot(document.getElementById('root')!).render(
  <main>
    <p>Signly · Laptop A</p>
    <h1>Landmark Collector</h1>
    <p>Dieser separate Einstieg ist vorbereitet. Die Aufnahme ist noch nicht implementiert.</p>
    <p>Nächster Meilenstein: lokale Kamera, Handpunkte und fünf Landmark-Frames pro unabhängigem A/B/C-Hold.</p>
    <p>Es wurden keine Trainingsdaten aufgenommen und keine Buchstaben validiert.</p>
    <a href="/">Zurück zur App</a>
  </main>,
)
