import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Overlay from './Overlay'
import './overlay.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Overlay />
  </StrictMode>
)
