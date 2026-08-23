import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SettingsApp from './SettingsApp'
import './settings.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>
)
