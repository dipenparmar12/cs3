import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './sources.css'
import App from './App.tsx'
import { ExperienceModeProvider } from './utils/ExperienceModeContext'

/**
 * The experience mode wraps everything, including `App` itself.
 *
 * It decides what the player, the source list and every error say, so a tree
 * mounted outside it would fall back to the context default and quietly show a
 * viewer the internals. Wrapping at the root is the only placement where that
 * cannot happen.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ExperienceModeProvider>
      <App />
    </ExperienceModeProvider>
  </StrictMode>,
)
