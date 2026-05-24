import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderFatalOverlay(title, detail = '', debug = '') {
  const root = document.getElementById('app')
  if (!root) return

  root.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#0f172a;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;">
      <div style="width:min(520px,100%);padding:28px;border-radius:24px;background:rgba(15,23,42,0.92);border:1px solid rgba(148,163,184,0.22);box-shadow:0 24px 64px rgba(2,6,23,0.45);">
        <div style="width:52px;height:52px;display:grid;place-items:center;border-radius:16px;background:linear-gradient(135deg,#0ea5e9,#14b8a6);font-weight:800;color:white;">V</div>
        <h1 style="margin:18px 0 10px;font-size:28px;line-height:1.05;letter-spacing:-0.04em;">${escapeHtml(title)}</h1>
        <p style="margin:0;color:#94a3b8;line-height:1.65;">${escapeHtml(detail || 'Velance hit an unexpected renderer problem. Reload the app to recover.')}</p>
        ${debug ? `<pre style="margin-top:16px;padding:14px;border-radius:14px;background:rgba(15,23,42,0.72);border:1px solid rgba(148,163,184,0.12);color:#cbd5e1;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;">${escapeHtml(debug)}</pre>` : ''}
        <button id="velance-reload" style="margin-top:20px;padding:12px 18px;border:none;border-radius:12px;background:linear-gradient(135deg,#0ea5e9,#14b8a6);color:white;font-weight:700;cursor:pointer;">Reload Velance</button>
      </div>
    </div>
  `

  document.getElementById('velance-reload')?.addEventListener('click', () => {
    window.location.reload()
  })
}

const app = createApp(App)
app.use(createPinia())
app.use(router)

app.config.errorHandler = (error, _instance, info) => {
  console.error('[Velance Renderer]', error, info)
  const message = error?.message || String(error || 'Unknown renderer error')
  const componentInfo = info ? `Context: ${info}` : ''
  renderFatalOverlay(
    'A screen failed to render',
    'Velance caught a renderer error and stopped this view from turning into a blank screen. Reload to continue.',
    [message, componentInfo].filter(Boolean).join('\n')
  )
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Velance Unhandled Rejection]', event.reason)
})

window.addEventListener('error', (event) => {
  console.error('[Velance Window Error]', event.error || event.message)
})

app.mount('#app')
