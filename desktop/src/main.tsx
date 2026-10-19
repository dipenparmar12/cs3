import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './sources.css'
import './styles/profiles.css'
import './styles/ui.css'
import App from './App.tsx'
import { ExperienceModeProvider } from './utils/ExperienceModeContext'
import { ProfileRoot } from './components/profiles/ProfileRoot'

/**
 * The experience mode wraps everything, including `App` itself.
 *
 * It decides what the player, the source list and every error say, so a tree
 * mounted outside it would fall back to the context default and quietly show a
 * viewer the internals. Wrapping at the root is the only placement where that
 * cannot happen.
 *
 * Inside it, `ProfileRoot` mounts `App` once per viewer profile — see there.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ExperienceModeProvider>
      <ProfileRoot>
        <App />
      </ProfileRoot>
    </ExperienceModeProvider>
  </StrictMode>,
)
