import { useEffect, useRef, useState } from 'react';
import { TantuButton, TantuCard, TantuInput, TantuNotice, TantuDialog } from '@weaveaijs/tantu';

import {
  submitAddress, submitCode, requestAnotherCode,
  signOutThisDevice, signOutAllDevices, deleteThisAccount, isSignedIn,
} from '../account/session.js';
import { hasUnsyncedChanges } from '../account/mirror.js';
import { deleteProgress } from '../account/sync.js';
import { idToken } from '../account/session.js';

/**
 * The account screen — the one part of SOUNDING that is plumbing.
 *
 * Three decisions here are deliberate and easy to undo by accident.
 *
 * **It does not look like the game.** No Force signature, no orb, no dye front
 * on submit. A dye front blooming on a *failed* sign-in reads as a reward for
 * failing, and more generally this is a different system — an identity
 * provider is not in the cave, and dressing it as though it were is the cheap
 * move. Reading as separate is correct.
 *
 * **The copy is plain.** "Sign in", "Email", "Verification code", "That code
 * has expired." No invented synonyms, and no in-world vocabulary: this is the
 * one screen that must be unambiguous about what pressing a button will do,
 * and a player who cannot tell *expired* from *wrong* is locked out of the
 * product. "Seeker" appears once, on the way back to the game, and nowhere on
 * the form. See infra/UI-STATES.md § Copy.
 *
 * **One field, one button.** There is no sign-up-versus-sign-in choice, here
 * or in session.js. Surfacing which branch was taken would answer "does this
 * person play this game?" for anyone who can type an address.
 */

/**
 * The code field takes anything between the two lengths Cognito actually
 * sends — six for a sign-up confirmation, eight for an EMAIL_OTP challenge —
 * and never advertises which one it expects. See the note at the field.
 */
const CODE_MIN = 6;
const CODE_MAX = 8;

/** Every failure the client can hand back, in the player's words. */
const MESSAGE = {
  'address-rejected': "That doesn't look like an email address.",
  'code-rejected': 'That code was not right.',
  'code-expired': 'That code has expired. Ask for another.',
  'rate-limited': 'Too many attempts. Wait a few minutes before trying again.',
  'delivery-failed': "The code couldn't be sent to that address. Try a different one.",
  offline: "Couldn't reach the network. Your progress on this device is safe.",
  'service-down': 'The sign-in service is having trouble. This is not your fault — try later.',
  'session-expired': 'You were signed out. Your progress on this device is untouched.',
  unknown: 'Something went wrong. You can try again, or keep playing without an account.',
};

/** Which of those get `critical` — the tone that announces itself. */
const CRITICAL = new Set(['offline', 'service-down', 'delivery-failed', 'unknown']);
const toneFor = (state) => (CRITICAL.has(state) ? 'critical' : state === 'rate-limited' ? 'caution' : 'info');

export function AccountScreen({ onClose, onProgressChanged }) {
  const [phase, setPhase] = useState(() => (isSignedIn() ? 'signed-in' : 'address'));
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [destination, setDestination] = useState(null);
  const [busy, setBusy] = useState(null);
  const [failure, setFailure] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const codeRef = useRef(null);

  // The code field is where a mistyped digit is corrected, so it takes focus
  // when it appears and again whenever a wrong code clears it.
  useEffect(() => { if (phase === 'code') codeRef.current?.focus(); }, [phase, fieldError]);

  function settle(result, { onOk }) {
    setBusy(null);
    if (result.ok) { setFailure(null); setFieldError(null); onOk(result); return; }
    // A field-level problem belongs on the field; everything else is the
    // attempt as a whole and gets the notice.
    if (result.state === 'address-rejected' || result.state === 'code-rejected') {
      setFieldError(MESSAGE[result.state]);
      setFailure(null);
      if (result.state === 'code-rejected') setCode('');
    } else {
      setFieldError(null);
      setFailure(result.state);
    }
  }

  async function onSubmitAddress(e) {
    e.preventDefault();
    setBusy('address');
    settle(await submitAddress(email.trim()), {
      onOk: (r) => { setDestination(r.destination); setPhase('code'); },
    });
  }

  async function onSubmitCode(e) {
    e.preventDefault();
    setBusy('code');
    settle(await submitCode(code.trim()), {
      onOk: async (r) => {
        // A confirmed sign-up sends a second code rather than a session.
        if (r.state === 'awaiting-code') { setDestination(r.destination); setCode(''); return; }
        setPhase('signed-in');
        await onProgressChanged();
      },
    });
  }

  async function onResend() {
    setBusy('resend');
    settle(await requestAnotherCode(), { onOk: (r) => { if (r.destination) setDestination(r.destination); } });
  }

  async function onDelete() {
    setBusy('delete');
    // Order matters and the dialog is persistent because of it: the row is
    // keyed to a subject nothing can authenticate as once the account is gone,
    // so deleting the account first would strand it forever.
    await deleteProgress(idToken());
    const r = await deleteThisAccount();
    setConfirmDelete(false);
    settle(r, { onOk: () => setPhase('address') });
  }

  const notice = failure && (
    <TantuNotice tone={toneFor(failure)}>{MESSAGE[failure] || MESSAGE.unknown}</TantuNotice>
  );

  return (
    <div className="snd-screen snd-screen-centered snd-account">
      <TantuCard warpSpan={6} reliefLevel="kanthi" talimCode="ACCOUNT">
        {phase === 'address' && (
          <form onSubmit={onSubmitAddress}>
            <div className="snd-brief-label">Sign in</div>
            <TantuNotice tone="info">
              An account is optional. It carries your place in the game to another
              device — nothing else. Everything works without one.
            </TantuNotice>
            <TantuInput
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              error={fieldError || undefined}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy === 'address'}
              mechanical={false}
              audio={false}
              required
            />
            {notice}
            <div className="snd-btnrow">
              <TantuButton type="submit" variant="secondary" bleed={false} disabled={busy === 'address'}>
                {busy === 'address' ? 'Sending…' : 'Send a code'}
              </TantuButton>
              <TantuButton type="button" variant="ghost" bleed={false} onClick={onClose}>
                Back
              </TantuButton>
            </div>
            {/* TantuButton has no busy prop and sets no aria-busy, so the
                pending state is announced here instead. See UI-STATES.md. */}
            <div className="tantu-visually-hidden" role="status" aria-live="polite">
              {busy === 'address' ? 'Sending a code' : ''}
            </div>
          </form>
        )}

        {phase === 'code' && (
          <form onSubmit={onSubmitCode}>
            <div className="snd-brief-label">Enter the code</div>
            <TantuInput
              ref={codeRef}
              label="Verification code"
              /* The masked destination, never the address the player typed: on
                 a phone in a public place, re-displaying it turns a glance
                 over the shoulder into a disclosure. */
              hint={destination ? `Sent to ${destination}` : undefined}
              inputMode="numeric"
              autoComplete="one-time-code"
              /* No fixed length, and that is not laziness — it is the same
                 rule that keeps the two branches indistinguishable.
                 ConfirmSignUp sends six digits; the EMAIL_OTP challenge sends
                 eight. A field sized to one of them tells the player which
                 branch they are on, which is to say whether that address
                 already had an account — the exact question this flow refuses
                 to answer. So it accepts either, and the service decides.

                 It was capped at six, which silently truncated an eight-digit
                 code to its first six and then rejected it as wrong. */
              maxLength={CODE_MAX}
              value={code}
              error={fieldError || undefined}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              disabled={busy === 'code'}
              mechanical={false}
              /* A game built on near-inaudible cues should not click at the
                 player while they type a credential. */
              audio={false}
              required
            />
            {notice}
            <div className="snd-btnrow">
              <TantuButton type="submit" variant="secondary" bleed={false} disabled={busy === 'code' || code.length < CODE_MIN}>
                {busy === 'code' ? 'Checking…' : 'Continue'}
              </TantuButton>
              <TantuButton
                type="button"
                variant="ghost"
                bleed={false}
                /* Enabled even while the code is being checked, and especially
                   after `code-expired`: there is no way forward without it. */
                disabled={busy === 'resend' || failure === 'rate-limited'}
                onClick={onResend}
              >
                {busy === 'resend' ? 'Sending…' : 'Send another code'}
              </TantuButton>
            </div>
            <div className="snd-btnrow">
              <TantuButton type="button" variant="ghost" bleed={false} onClick={() => { setPhase('address'); setCode(''); setFailure(null); setFieldError(null); }}>
                Use a different address
              </TantuButton>
            </div>
            <div className="tantu-visually-hidden" role="status" aria-live="polite">
              {busy === 'code' ? 'Checking the code' : busy === 'resend' ? 'Sending another code' : ''}
            </div>
          </form>
        )}

        {phase === 'signed-in' && (
          <>
            <div className="snd-brief-label">Signed in</div>
            <TantuNotice tone="info">
              Your place in the game is carried to any device you sign in on.
            </TantuNotice>
            {/* A resting fact, never a spinner and never during play. */}
            {hasUnsyncedChanges() && (
              <TantuNotice tone="caution">
                This device has progress that hasn&apos;t reached your account yet.
                It will try again next time.
              </TantuNotice>
            )}
            {notice}
            <div className="snd-btnrow">
              <TantuButton variant="secondary" bleed={false} onClick={onClose}>Back to the game</TantuButton>
              <TantuButton variant="ghost" bleed={false} onClick={async () => { await signOutThisDevice(); setPhase('address'); }}>
                Sign out
              </TantuButton>
            </div>
            <div className="snd-btnrow">
              <TantuButton variant="ghost" bleed={false} onClick={async () => { setBusy('signout'); await signOutAllDevices(); setBusy(null); setPhase('address'); }}>
                Sign out everywhere
              </TantuButton>
              <TantuButton variant="ghost" bleed={false} onClick={() => setConfirmDelete(true)}>
                Delete account
              </TantuButton>
            </div>
          </>
        )}
      </TantuCard>

      <TantuDialog
        open={confirmDelete}
        persistent
        title="Delete your account?"
        onClose={() => setConfirmDelete(false)}
      >
        <p>
          This removes your account and the copy of your progress held with it.
          It cannot be undone.
        </p>
        <p>
          <b>Your progress on this device is kept</b>, and the game will carry on
          exactly where you left it. Deleting an account does not delete the game.
        </p>
        <p className="snd-account-fineprint">
          Sign-in attempts stay in this account&apos;s own AWS audit log for up to
          90 days. That is outside what this game can erase.
        </p>
        <div className="snd-btnrow">
          <TantuButton variant="secondary" bleed={false} disabled={busy === 'delete'} onClick={onDelete}>
            {busy === 'delete' ? 'Deleting…' : 'Delete it'}
          </TantuButton>
          <TantuButton variant="ghost" bleed={false} disabled={busy === 'delete'} onClick={() => setConfirmDelete(false)}>
            Keep it
          </TantuButton>
        </div>
      </TantuDialog>
    </div>
  );
}
