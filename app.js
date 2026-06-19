const appState = {
    audioContext: null,
    brownNoiseNode: null,
    filterNode: null,
    analyserNode: null,
    gainNode: null,
    isPlaying: false,
    currentPhase: '',
    manualPhaseIndex: -1,
    sleepTimerId: null,
    fadeDuration: 10,
    pomoTimerId: null,
    pomoIsActive: false,
    pomoCurrentMode: 'work',
    pomoTimeRemaining: 0,
    pomoCycleCount: 1,
    activeExercise: null
};

const CIRCADIAN_PHASES = [
    { name: 'Sleep', startHour: 22, endHour: 5, bgColor: '#020204', color: '#5b83b3', frequency: 120 },
    { name: 'Wake Up', startHour: 5, endHour: 9, bgColor: '#060604', color: '#dfb15b', frequency: 280 },
    { name: 'Focus', startHour: 9, endHour: 17, bgColor: '#030303', color: '#ffffff', frequency: 500 },
    { name: 'Relax', startHour: 17, endHour: 22, bgColor: '#050406', color: '#d9815b', frequency: 220 }
];

function applyPhaseData(phase) {
    appState.currentPhase = phase.name;
    document.getElementById('current-state').textContent = phase.name;
    document.documentElement.style.setProperty('--bg-color', phase.bgColor);
    document.documentElement.style.setProperty('--accent-color', phase.color);
    document.getElementById('frequency-readout').textContent = `${phase.frequency.toFixed(2)} Hz`;
    
    if (appState.filterNode) {
        appState.filterNode.frequency.setValueAtTime(phase.frequency, appState.audioContext.currentTime);
    }

    const pomoUI = document.getElementById('pomo-module-container');
    if (phase.name === 'Focus') {
        pomoUI.style.display = 'flex';
    } else {
        pomoUI.style.display = 'none';
        if (appState.pomoIsActive) resetPomodoroEngine();
    }
}

function updateCircadianClock() {
    const now = new Date();
    document.getElementById('timer-display').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    if (appState.manualPhaseIndex === -1) {
        const currentHour = now.getHours();
        const activePhase = CIRCADIAN_PHASES.find(p => p.startHour > p.endHour ? (currentHour >= p.startHour || currentHour < p.endHour) : (currentHour >= p.startHour && currentHour < p.endHour));
        
        if (activePhase && appState.currentPhase !== activePhase.name) {
            applyPhaseData(activePhase);
        }
    }
}

let touchStartX = 0;
const gestureZone = document.getElementById('gesture-zone');

gestureZone.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

gestureZone.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    handleSwipeGesture(touchStartX, touchEndX);
}, { passive: true });

function handleSwipeGesture(start, end) {
    const swipeDistance = end - start;
    const threshold = 60;

    if (Math.abs(swipeDistance) < threshold) return;

    if (appState.manualPhaseIndex === -1) {
        appState.manualPhaseIndex = CIRCADIAN_PHASES.findIndex(p => p.name === appState.currentPhase);
    }

    if (swipeDistance < 0) {
        appState.manualPhaseIndex = (appState.manualPhaseIndex + 1) % CIRCADIAN_PHASES.length;
    } else {
        appState.manualPhaseIndex = (appState.manualPhaseIndex - 1 + CIRCADIAN_PHASES.length) % CIRCADIAN_PHASES.length;
    }

    applyPhaseData(CIRCADIAN_PHASES[appState.manualPhaseIndex]);
}

function initAudio() {
    appState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const bufferSize = 2 * appState.audioContext.sampleRate;
    const noiseBuffer = appState.audioContext.createBuffer(1, bufferSize, appState.audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5;
    }

    appState.brownNoiseNode = appState.audioContext.createBufferSource();
    appState.brownNoiseNode.buffer = noiseBuffer;
    appState.brownNoiseNode.loop = true;

    appState.filterNode = appState.audioContext.createBiquadFilter();
    appState.filterNode.type = 'lowpass';

    appState.analyserNode = appState.audioContext.createAnalyser();
    appState.analyserNode.fftSize = 64;

    appState.gainNode = appState.audioContext.createGain();
    appState.gainNode.gain.setValueAtTime(1.0, appState.audioContext.currentTime);

    appState.brownNoiseNode.connect(appState.filterNode);
    appState.filterNode.connect(appState.gainNode);
    appState.gainNode.connect(appState.analyserNode);
    appState.analyserNode.connect(appState.audioContext.destination);
    
    appState.brownNoiseNode.start(0);
    
    const targetPhase = appState.manualPhaseIndex !== -1 ? CIRCADIAN_PHASES[appState.manualPhaseIndex] : CIRCADIAN_PHASES.find(p => p.name === appState.currentPhase);
    if (targetPhase) applyPhaseData(targetPhase);
}

const canvas = document.getElementById('sound-visualizer');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 380 * dpr;
    canvas.height = 380 * dpr;
    ctx.scale(dpr, dpr);
}
resizeCanvas();

function drawVisualizer() {
    if (!appState.isPlaying) return;
    requestAnimationFrame(drawVisualizer);

    const bufferLength = appState.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    appState.analyserNode.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, 380, 380);
    const centerX = 380 / 2;
    const centerY = 380 / 2;
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
    const time = performance.now() * 0.001;

    if (appState.activeExercise === 'breathe') {
        const breathCycle = (Math.sin(time * (Math.PI / 4)) + 1) / 2;
        const radius = 60 + breathCycle * 65;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        document.getElementById('current-state').textContent = breathCycle > 0.5 ? "Inhale..." : "Exhale...";
        return;
    }

    // --- HIGH-FIDELITY ATTENTION TRACKING ENGINE: ORBITAL SOLAR SYSTEM ---
    if (appState.activeExercise === 'attention') {
        // 1. Maintain an internal tracker for the orbital mechanics directly on the state if uninitialized
        if (!appState.orbitSystem) {
            appState.orbitSystem = {
                activeRing: 0,             // 0 = Inner, 1 = Mid, 2 = Outer
                currentAngle: 0,           // Tracking angle offset
                lifetimeRemaining: 180,    // Duration the current dot stays lit (in frame steps)
                dotSize: 0,                // Visual expansion variable
                rings: [60, 95, 130]       // Pixel radii of the respective paths
            };
        }

        const sys = appState.orbitSystem;

        // 2. Render Central Stellar Core Anchor
        ctx.beginPath();
        ctx.arc(centerX, centerY, 8 + Math.sin(time * 3) * 1.5, 0, 2 * Math.PI);
        ctx.fillStyle = accentColor;
        ctx.globalAlpha = 0.15;
        ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1;
        ctx.strokeStyle = accentColor;
        ctx.stroke();

        // 3. Draw the 3 Fixed Orbital Pathway Geometry Trajectories
        sys.rings.forEach((radius, idx) => {
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = accentColor;
            // Differentiate active vs inactive pathways subtly
            ctx.lineWidth = (idx === sys.activeRing) ? 0.8 : 0.2;
            ctx.globalAlpha = (idx === sys.activeRing) ? 0.3 : 0.08;
            ctx.stroke();
        });
        ctx.globalAlpha = 1.0; // Reset canvas transparency global state

        // 4. Update the Active Orbital Mechanics
        // Each path has a distinct speed multiplier to enhance kinetic tracking complexity
        const operationalSpeed = 0.015 * (3 / (sys.activeRing + 1)); 
        sys.currentAngle += operationalSpeed;
        sys.lifetimeRemaining--;

        // Dynamic scale entry and collapse animations based on lifetime remaining
        if (sys.lifetimeRemaining > 150) {
            sys.dotSize = (180 - sys.lifetimeRemaining) / 3; // Fade scaling up
        } else if (sys.lifetimeRemaining < 30) {
            sys.dotSize = sys.lifetimeRemaining / 3;        // Fade scaling down
        } else {
            sys.dotSize = 10;                                // Target holding size
        }

        // 5. Compute Cartesian Coordinates for the Active Orbiting Satellite Dot
        const activeRadius = sys.rings[sys.activeRing];
        const dotX = centerX + Math.cos(sys.currentAngle) * activeRadius;
        const dotY = centerY + Math.sin(sys.currentAngle) * activeRadius;

        // 6. Draw the Trackable Target Dot with an Aesthetic Cosmic Core Aura
        if (sys.dotSize > 0) {
            // High-Contrast Central Target Node
            ctx.beginPath();
            ctx.arc(dotX, dotY, sys.dotSize / 2, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 15;
            ctx.shadowColor = accentColor;
            ctx.fill();
            ctx.shadowBlur = 0; // Instantly clean state context memory

            // Fluid Vector Ring Overlay Wrapper
            ctx.beginPath();
            ctx.arc(dotX, dotY, sys.dotSize, 0, 2 * Math.PI);
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // 7. Lifecycle Expiry Check: Seamlessly hand off tracking ignition parameters to another node
        if (sys.lifetimeRemaining <= 0) {
            // Select a brand new alternative ring path randomly
            let nextRing = Math.floor(Math.random() * 3);
            if (nextRing === sys.activeRing) nextRing = (nextRing + 1) % 3; // Enforce path variance
            
            sys.activeRing = nextRing;
            sys.lifetimeRemaining = 150 + Math.random() * 90; // Add chaotic cycle duration variance
            // Capture a random insertion angle relative to current time matrix to break repeating loops
            sys.currentAngle = Math.random() * Math.PI * 2; 
        }

        return; // Halt processing downward execution into standard reactive arrays
    }

    if (appState.activeExercise === 'attention') {
        const targetX = centerX + Math.sin(time * 1.5) * 35;
        const targetY = centerY + Math.cos(time * 2.2) * 35;
        for (let r = 1; r <= 3; r++) {
            ctx.beginPath();
            ctx.arc(targetX, targetY, r * 8, 0, 2 * Math.PI);
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 1 / r;
            ctx.stroke();
        }
        return;
    }

    for (let layer = 0; layer < 3; layer++) {
        ctx.beginPath();
        const baseRadius = 95 + (layer * 15);
        for (let i = 0; i <= 120; i++) {
            const angle = (i / 120) * Math.PI * 2;
            const dataIndex = i % bufferLength;
            const audioIntensity = dataArray[dataIndex] / 255;
            const waveOffset = Math.sin(angle * 6 + time * (layer + 1)) * 4;
            const audioOffset = audioIntensity * (12 + layer * 4);
            const totalRadius = baseRadius + waveOffset + audioOffset;
            const x = centerX + Math.cos(angle) * totalRadius;
            const y = centerY + Math.sin(angle) * totalRadius;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.5 / (layer + 1);
        ctx.globalAlpha = 0.6 / (layer + 1);
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
}

document.getElementById('intensity-slider').addEventListener('input', (e) => {
    if (appState.filterNode) {
        const targetHz = 80 + (1000 - 80) * (e.target.value / 100);
        appState.filterNode.frequency.setValueAtTime(targetHz, appState.audioContext.currentTime);
        document.getElementById('frequency-readout').textContent = `${targetHz.toFixed(2)} Hz`;
    }
});

document.getElementById('play-pause-btn').addEventListener('click', () => {
    if (!appState.audioContext) initAudio();
    const btn = document.getElementById('play-pause-btn');
    if (!appState.isPlaying) {
        appState.audioContext.resume();
        appState.isPlaying = true;
        btn.classList.add('playing');
        updateCircadianClock();
        drawVisualizer();
    } else {
        appState.audioContext.suspend();
        appState.isPlaying = false;
        btn.classList.remove('playing');
    }
});

function startSleepTimer(minutes) {
    clearInterval(appState.sleepTimerId);
    if (appState.gainNode) {
        appState.gainNode.gain.cancelScheduledValues(appState.audioContext.currentTime);
        appState.gainNode.gain.setValueAtTime(1.0, appState.audioContext.currentTime);
    }
    let totalSeconds = minutes * 60;
    document.getElementById('cancel-timer-btn').style.display = 'inline-block';
    appState.sleepTimerId = setInterval(() => {
        totalSeconds--;
        const displayMin = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const displaySec = (totalSeconds % 60).toString().padStart(2, '0');
        document.getElementById('timer-display').textContent = `${displayMin}:${displaySec}`;
        if (totalSeconds === appState.fadeDuration && appState.gainNode) {
            const now = appState.audioContext.currentTime;
            appState.gainNode.gain.setValueAtTime(1.0, now);
            appState.gainNode.gain.linearRampToValueAtTime(0.001, now + appState.fadeDuration);
        }
        if (totalSeconds <= 0) {
            clearActiveSleepTimer();
            document.getElementById('play-pause-btn').click();
        }
    }, 1000);
}

function clearActiveSleepTimer() {
    clearInterval(appState.sleepTimerId);
    appState.sleepTimerId = null;
    document.getElementById('cancel-timer-btn').style.display = 'none';
    document.querySelectorAll('.timer-opt-btn').forEach(b => b.classList.remove('active-timer'));
    updateCircadianClock();
    if (appState.gainNode) {
        appState.gainNode.gain.cancelScheduledValues(appState.audioContext.currentTime);
        appState.gainNode.gain.setValueAtTime(1.0, appState.audioContext.currentTime);
    }
}

document.querySelectorAll('.timer-opt-btn[data-minutes]').forEach(button => {
    button.addEventListener('click', (e) => {
        if (!appState.audioContext) document.getElementById('play-pause-btn').click();
        document.querySelectorAll('.timer-opt-btn').forEach(b => b.classList.remove('active-timer'));
        e.target.classList.add('active-timer');
        startSleepTimer(parseInt(e.target.getAttribute('data-minutes')));
    });
});

document.getElementById('cancel-timer-btn').addEventListener('click', clearActiveSleepTimer);

const pomoToggleBtn = document.getElementById('pomo-toggle-btn');
const pomoStatusText = document.getElementById('pomo-status-text');

pomoToggleBtn.addEventListener('click', () => {
    if (!appState.audioContext || !appState.isPlaying) {
        document.getElementById('play-pause-btn').click();
    }
    if (!appState.pomoIsActive) {
        appState.pomoIsActive = true;
        appState.pomoCurrentMode = 'work';
        appState.pomoTimeRemaining = 25 * 60;
        pomoToggleBtn.textContent = "Cancel Cycle";
        pomoToggleBtn.classList.add('pomo-active');
        if (appState.sleepTimerId) clearActiveSleepTimer();
        runPomodoroClockLoop();
    } else {
        resetPomodoroEngine();
    }
});

function runPomodoroClockLoop() {
    clearInterval(appState.pomoTimerId);
    updatePomoDisplayAndAudio();
    appState.pomoTimerId = setInterval(() => {
        appState.pomoTimeRemaining--;
        const displayMin = Math.floor(appState.pomoTimeRemaining / 60).toString().padStart(2, '0');
        const displaySec = (appState.pomoTimeRemaining % 60).toString().padStart(2, '0');
        document.getElementById('timer-display').textContent = `${displayMin}:${displaySec}`;
        if (appState.pomoTimeRemaining <= 0) triggerPomoIntervalSwitch();
    }, 1000);
}

function updatePomoDisplayAndAudio() {
    if (appState.pomoCurrentMode === 'work') {
        pomoStatusText.textContent = `Focusing (Session ${appState.pomoCycleCount}/4)`;
        document.getElementById('current-state').textContent = "Pomo Focus";
        document.documentElement.style.setProperty('--accent-color', '#ffffff');
        if (appState.filterNode) {
            appState.filterNode.frequency.setValueAtTime(550, appState.audioContext.currentTime);
            document.getElementById('frequency-readout').textContent = "550.00 Hz";
        }
    } else {
        pomoStatusText.textContent = "Rest Interval Active";
        document.getElementById('current-state').textContent = "Pomo Break";
        document.documentElement.style.setProperty('--accent-color', '#dfb15b');
        if (appState.filterNode) {
            appState.filterNode.frequency.setValueAtTime(160, appState.audioContext.currentTime);
            document.getElementById('frequency-readout').textContent = "160.00 Hz";
        }
    }
}

function triggerPomoIntervalSwitch() {
    if (appState.audioContext) {
        const osc = appState.audioContext.createOscillator();
        const oscGain = appState.audioContext.createGain();
        osc.connect(oscGain);
        oscGain.connect(appState.audioContext.destination);
        osc.frequency.setValueAtTime(440, appState.audioContext.currentTime);
        oscGain.gain.setValueAtTime(0.1, appState.audioContext.currentTime);
        oscGain.gain.exponentialRampToValueAtTime(0.001, appState.audioContext.currentTime + 0.4);
        osc.start();
        osc.stop(appState.audioContext.currentTime + 0.5);
    }
    if (appState.pomoCurrentMode === 'work') {
        appState.pomoCurrentMode = 'break';
        appState.pomoTimeRemaining = 5 * 60;
    } else {
        appState.pomoCurrentMode = 'work';
        appState.pomoTimeRemaining = 25 * 60;
        appState.pomoCycleCount = (appState.pomoCycleCount % 4) + 1;
    }
    runPomodoroClockLoop();
}

function resetPomodoroEngine() {
    clearInterval(appState.pomoTimerId);
    appState.pomoTimerId = null;
    appState.pomoIsActive = false;
    appState.pomoCycleCount = 1;
    pomoToggleBtn.textContent = "Start Focus Cycle";
    pomoToggleBtn.classList.remove('pomo-active');
    pomoStatusText.textContent = "Session 1/4";
    appState.currentPhase = '';
    updateCircadianClock();
}

document.querySelectorAll('.exercise-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!appState.audioContext || !appState.isPlaying) {
            document.getElementById('play-pause-btn').click();
        }
        const selectedType = e.target.getAttribute('data-type');
        if (appState.activeExercise === selectedType) {
            terminateActiveExercise();
        } else {
            activateExerciseWorkflow(selectedType, e.target);
        }
    });
});

function activateExerciseWorkflow(type, targetButtonElement) {
    document.querySelectorAll('.exercise-btn').forEach(b => b.classList.remove('exercise-active'));
    if (appState.pomoIsActive) resetPomodoroEngine();
    if (appState.sleepTimerId) clearActiveSleepTimer();

    appState.activeExercise = type;
    targetButtonElement.classList.add('exercise-active');

    if (type === 'breathe') {
        document.documentElement.style.setProperty('--accent-color', '#a2d2ff');
        if (appState.filterNode) appState.filterNode.frequency.setValueAtTime(180, appState.audioContext.currentTime);
    } else if (type === 'meditate') {
        document.getElementById('current-state').textContent = "Meditate";
        document.documentElement.style.setProperty('--accent-color', '#bdb2ff');
        if (appState.filterNode) appState.filterNode.frequency.setValueAtTime(90, appState.audioContext.currentTime);
    } else if (type === 'attention') {
        document.getElementById('current-state').textContent = "Track Target";
        document.documentElement.style.setProperty('--accent-color', '#ffadad');
        if (appState.filterNode) appState.filterNode.frequency.setValueAtTime(650, appState.audioContext.currentTime);
    }
}

function terminateActiveExercise() {
    appState.activeExercise = null;
    appState.orbitSystem = null;
    document.querySelectorAll('.exercise-btn').forEach(b => b.classList.remove('exercise-active'));
    
    appState.currentPhase = '';
    updateCircadianClock();
}

setInterval(updateCircadianClock, 1000);
updateCircadianClock();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration skipped', err));
    });
}
