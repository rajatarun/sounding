/**
 * main.jsx — entry point.
 *
 * Pulls in the Tantu design system — tokens, components, motion — before
 * mounting the app. Not its typefaces; see below. CLAUDE.md has how this
 * fits together with the game engine underneath it.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@weaveaijs/tantu/styles.css';
// Tantu's three faces are an optional brand layer and are deliberately not
// imported. They are aiweave's house voice — unicase, 88 codepoints, drawn
// from a textile programme — and this game is about listening. Dropping them
// is a supported configuration, not a fork: the system names no typeface and
// its own tests enforce that. See CLAUDE.md.
// import '@weaveaijs/tantu/fonts.css';
import './styles/game.css';

import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
