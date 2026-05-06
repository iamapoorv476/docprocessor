import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useState, createContext, useContext, useCallback } from 'react'
import Dashboard from './pages/Dashboard'
import Upload from './pages/Upload'
import DocumentDetail from './pages/DocumentDetail'


type ToastType = 'success' | 'error' | 'info'
interface Toast { id: number; message: string; type: ToastType }
interface ToastCtx { show: (msg: string, type?: ToastType) => void }

export const ToastContext = createContext<ToastCtx>({ show: () => {} })
export const useToast = () => useContext(ToastContext)

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}


function Header() {
  const navigate = useNavigate()
  const loc = useLocation()
  const active = (path: string) => loc.pathname === path ? 'nav-btn active' : 'nav-btn'

  return (
    <header className="app-header">
      <div className="app-logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
        <span className="app-logo-dot" />
        DOCPROCESSOR
      </div>
      <nav className="app-nav">
        <button className={active('/')} onClick={() => navigate('/')}>Dashboard</button>
        <button className={active('/upload')} onClick={() => navigate('/upload')}>Upload</button>
      </nav>
    </header>
  )
}


export default function App() {
  return (
    <ToastProvider>
      <div className="app">
        <Header />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/documents/:id" element={<DocumentDetail />} />
          </Routes>
        </main>
      </div>
    </ToastProvider>
  )
}
