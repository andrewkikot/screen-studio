import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Picker from './Picker'
import './picker.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Picker />
  </StrictMode>
)
