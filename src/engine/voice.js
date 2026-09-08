/**
 * voice.js — the one spoken line SOUNDING ever says, and only once.
 *
 * The Web Speech API, not AudioEngine. This deliberately never touches the
 * Web Audio graph, the reference plane, `audio.bus`, or trial scaling, and it
 * must not: it is chrome speaking to a Seeker who has not yet entered the
 * world's own audio, not a cue inside it. Routing it through AudioEngine
 * would make it subject to the calibration reference and the "near-inaudible
 * misaligned" pillar, which would be absurd for a sentence meant to be heard
 * plainly, once, before any of that begins.
 *
 * Feature-detected and silent on failure. A Seeker whose browser has no
 * speech synthesis, or has denied it, or is running this in a test harness
 * with none installed, gets the woven text alone — which is why the words
 * themselves, not the voice, carry the message. See WovenWord.jsx.
 */
export function speakOnce(text) {
  const unavailable = { onEnd() {}, stop() {} };
  if (typeof window === 'undefined' || !window.speechSynthesis) return unavailable;
  try {
    window.speechSynthesis.cancel(); // never stack onto a stale utterance
    const u = new SpeechSynthesisUtterance(text);
    // Quiet and unhurried, matching the game's own register. This is the one
    // voice in a game built around near-silence; it should arrive like the
    // rest of this screen does, not announce itself like a notification.
    u.rate = 0.92;
    u.pitch = 1;
    u.volume = 0.8;
    window.speechSynthesis.speak(u);
    return {
      onEnd(fn) {
        u.addEventListener('end', fn);
        u.addEventListener('error', fn);
      },
      stop() { try { window.speechSynthesis.cancel(); } catch (e) { /* noop */ } },
    };
  } catch (e) {
    return unavailable;
  }
}
