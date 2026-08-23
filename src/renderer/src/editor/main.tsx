import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Editor from './Editor'
import './editor.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Editor />
  </StrictMode>
)
