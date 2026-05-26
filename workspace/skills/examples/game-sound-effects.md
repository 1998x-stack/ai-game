---
name: game-sound-effects
description: Sound effects and audio using SoundManager utility — synthesized beeps, loaded audio, mute toggle
triggers: sound, audio, sfx, music, beep, sound effect, immersive, audio feedback
---

# Game Sound Effects

## When to Use
When the user requests sound effects, background music, audio feedback for game actions, or mentions "add sounds" / "make it more immersive."

## Core Patterns

### Initialize Sound Manager
```js
const sound = new SoundManager();

// Must be called on first user interaction (click/keypress)
// In your startGame() or on first click:
sound.init();
```

### Load and Play Sounds
```js
// Load from assets (embedded as base64 at build)
sound.load('jump', window.__ASSETS__['jump.wav']);
sound.load('coin', window.__ASSETS__['coin.wav']);
sound.load('hit', window.__ASSETS__['hit.wav']);

// Play with optional volume (0-1)
sound.play('jump', 0.7);
sound.play('coin', 0.5);
```

### Synthesized Beeps (No Asset Files Needed)
```js
// Quick beep — no asset loading required
sound.beep(440, 0.1, 0.3);  // 440Hz, 100ms, volume 0.3
sound.beep(880, 0.05, 0.5); // Higher pitch for collectibles

// Use for:
// - UI feedback: sound.beep(600, 0.05, 0.2)
// - Collecting items: sound.beep(880, 0.08, 0.4)
// - Taking damage: sound.beep(200, 0.15, 0.5)
// - Power-up: sound.beep(660, 0.1, 0.4)
```

### Mute Toggle
```js
// Add to input handling
if (input.justPressed('KeyM')) {
  sound.toggleMute();
}
```

## Gotchas

### 1. AudioContext Must Be Initialized on User Gesture
**Wrong:**
```js
const sound = new SoundManager();
sound.init();  // Browser blocks — AudioContext not allowed without gesture
```
**Correct:**
```js
const sound = new SoundManager();
// In startGame(), called after user clicks or presses a key:
function startGame() {
  sound.init();
  // ... rest of game init
}
```

### 2. Forgetting to Check if Sound is Ready
**Wrong:**
```js
sound.play('explosion');  // Silent if not initialized
```
**Correct:**
```js
if (sound.isReady()) {
  sound.play('explosion');
} else {
  sound.beep(200, 0.1, 0.5);  // Fallback beep
}
```

## Integration with Utils
- `SoundManager` — constructor(), init(), load(), play(), beep(), toggleMute(), setVolume()
- Use `beep(freq, duration, volume)` for synthesized sounds — no asset files needed
- Use `load()` + `play()` for real audio from `window.__ASSETS__`
- Call `init()` on first user interaction (inside startGame or input handler)

## Sound Design Quick Reference

| Game Event | beep() Frequency | Duration | Volume |
|-----------|------------------|----------|--------|
| UI click | 600 Hz | 0.05s | 0.2 |
| Collect item | 880 Hz | 0.08s | 0.4 |
| Jump | 440→880 Hz | 0.1s | 0.3 |
| Take damage | 200 Hz | 0.15s | 0.5 |
| Power-up | 660 Hz | 0.1s | 0.4 |
| Game over | 440→220 Hz | 0.3s | 0.5 |
| Level complete | 523, 659, 784 Hz | 0.1s each | 0.4 |
