import {PitchTracker} from './pitch.js';
import {PitchVisualizer} from './visualizer.js';
import {formatCents, formatFrequency, frequencyToNoteData} from './note.js';

const ENABLE_DEBUG_LOGS = false;
const debugLog = (...args) => {
  if (ENABLE_DEBUG_LOGS) {
    console.debug("[App]", ...args);
  }
};

const startButton = document.getElementById("start-button");
const statusMessage = document.getElementById("status-message");
const frequencyLabel = document.getElementById("frequency");
const noteLabel = document.getElementById("note");
const centsLabel = document.getElementById("cents");
const canvas = document.getElementById("pitch-canvas");

const tracker = new PitchTracker();
const visualizer = new PitchVisualizer(canvas);

const MIN_VALID_FREQ = 110; // A2
const MAX_VALID_FREQ = 1660; // G6
const MAX_JUMP_HZ = 160;
const MAX_GAP_MS = 200;

const UPDATE_INTERVAL_MS = 20;
const MISS_THRESHOLD = 4; // number of polling misses (~400 ms) before clearing UI

let pollTimer = null;
let isRunning = false;
let isInitializing = false;
let missCounter = 0;
let lastNoPitchLog = 0;
let lastDetectionLog = 0;
let lastDetectionTime = 0;
let lastFrequency = null;

startButton.addEventListener("click", async () => {
  debugLog("Start button pressed.", { isRunning, isInitializing });
  if (isInitializing) {
    return;
  }

  if (!isRunning) {
    await startListening();
  } else {
    stopListening();
  }
});

async function startListening() {
  debugLog("Beginning microphone start sequence.");
  isInitializing = true;
  setStatus("Requesting microphone access…");
  startButton.disabled = true;
  startButton.textContent = "Starting…";
  lastDetectionTime = 0;
  lastFrequency = null;

  try {
    await tracker.start();
    visualizer.start();
    visualizer.resize();
    debugLog("Microphone capture started.");
    startPolling();
    isRunning = true;
    setStatus("Listening… play a sustained violin note.");
    startButton.textContent = "Stop Listening";
  } catch (error) {
    console.error(error);
    debugLog("Error starting microphone.", error);
    setStatus(error.message || "Unable to start microphone input.");
    startButton.textContent = "Start Listening";
  } finally {
    startButton.disabled = false;
    isInitializing = false;
  }
}

function stopListening() {
  debugLog("Stopping microphone capture.");
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  tracker.stop();
  visualizer.stop();
  visualizer.clear();
  resetReadouts();

  isRunning = false;
  missCounter = 0;
  lastDetectionTime = 0;
  lastFrequency = null;
  setStatus("Microphone stopped.");
  startButton.textContent = "Start Listening";
  startButton.disabled = false;
}

function startPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  missCounter = 0;
  // Poll the analyser at ~50 Hz to keep latency low while still allowing enough processing time.
  pollTimer = setInterval(() => {
    const timestamp = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const estimation = tracker.getPitch();

    if (!estimation || !estimation.frequency || !Number.isFinite(estimation.frequency)) {
      missCounter++;
      if (timestamp - lastNoPitchLog > 500) {
        debugLog("No pitch detected on this tick.", {
          missCounter,
        });
        lastNoPitchLog = timestamp;
      }
      if (missCounter === MISS_THRESHOLD) {
        setStatus("Listening… play a clear tone.");
        resetReadouts();
      }
      return;
    }

    missCounter = 0;

    let frequency = estimation.frequency;
    if (frequency <= 0) {
      return;
    }

    // Clamp to a plausible frequency range and discard improbable jumps.
    frequency = Math.min(Math.max(frequency, MIN_VALID_FREQ), MAX_VALID_FREQ);

    const timeSinceLast = timestamp - lastDetectionTime;
    if (lastDetectionTime !== 0 && timeSinceLast < MAX_GAP_MS && lastFrequency !== null) {
      const jump = Math.abs(frequency - lastFrequency);
      if (jump > MAX_JUMP_HZ) {
        return;
      }
    }

    lastDetectionTime = timestamp;
    lastFrequency = frequency;

    const noteData = frequencyToNoteData(frequency);
    if (!noteData) {
      return;
    }

    renderReadouts(noteData);
    if (timestamp - lastDetectionLog > 500) {
      debugLog("Pitch detected.", {
        frequency: noteData.frequency,
        cents: noteData.cents,
        note: noteData.noteName,
        probability: estimation.probability,
      });
      lastDetectionLog = timestamp;
    }
    const noteIndex = (noteData.nearestMidi + 1200) % 12;
    visualizer.update({
      frequency: noteData.frequency,
      cents: noteData.cents,
      noteIndex,
    });
  }, UPDATE_INTERVAL_MS);
}

function renderReadouts(noteData) {
  frequencyLabel.textContent = formatFrequency(noteData.frequency);
  noteLabel.textContent = noteData.noteName;
  centsLabel.textContent = formatCents(noteData.cents);
  centsLabel.style.color = colorForCents(noteData.cents);
  // Clearing the status lets the performer know we have a confident detection.
  setStatus("");
}

function resetReadouts() {
  frequencyLabel.textContent = "— Hz";
  noteLabel.textContent = "—";
  centsLabel.textContent = "— ¢";
  centsLabel.style.color = "";
}

function setStatus(message) {
  statusMessage.textContent = message || "";
}

function colorForCents(cents) {
  const deviation = Math.abs(cents);
  if (!Number.isFinite(deviation) || deviation <= 0.5) {
    return "#ffffff";
  }

  const ratio = Math.min(deviation, 50) / 50;
  const channel = Math.round(255 * (1 - ratio));

  if (cents > 0) {
    return `rgb(255, ${channel}, ${channel})`;
  }

  return `rgb(${channel}, ${channel}, 255)`;
}

window.addEventListener("beforeunload", () => {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  tracker.stop();
  visualizer.destroy();
});
