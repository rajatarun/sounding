/**
 * main.jsx — entry point.
 *
 * Pulls in the Tantu design system (tokens, components, and — opt-in — its
 * three custom typefaces) before mounting the app. See CLAUDE.md for how
 * this fits together with the game engine underneath it.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@weaveaijs/tantu/styles.css';
import '@weaveaijs/tantu/fonts.css';
import './styles/game.css';

import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
