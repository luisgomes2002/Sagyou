/* agente-1: teste concorrência */
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { CloseLifecycle } from './components/layout/CloseLifecycle'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <CloseLifecycle />
  </StrictMode>
)
