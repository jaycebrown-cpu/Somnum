// --- 1. GLOBAL ENGINE STATE ---
const appState = {
    audioContext: null,
    brownNoiseNode: null,
    filterNode: null,
    analyserNode: null,
    gainNode: null,
    isPlaying: false,
    currentPhase: '',
    manualPhaseIndex: -1,
    
    // Sleep Timer Configuration
    sleepTimerId: null,
    fadeDuration: 10,
    
    // Pomodoro Engine State
    pomoTimerId: null,
    pomoIsActive: false,
    pomoCurrentMode: 'work', // 'work' or 'break'
    pomoTimeRemaining: 0,
    pomoCycleCount: 1,

    // Guided Exercises State
    activeExercise: null, // 'breathe', 'meditate', 'attention', or null
    orbitSystem: null     // Solar tracking engine calculations
};

// Endel-style chronological configurations
const CIRCADIAN_PHASES = [
    { name: 'Sleep', startHour: 22, endHour: 5, bgColor: '#020204', color: '#5b83b3', frequency: 120 },
    { name: 'Wake Up', startHour: 5, endHour: 9, bgColor: '#060604', color: '#dfb15b', frequency: 280 },
    { name: 'Focus', startHour: 9, endHour: 17, bgColor: '#030303', color: '#ffffff', frequency: 500 },
    { name: 'Relax', startHour: 17, endHour: 22, bgColor: '#050406', color: '#d9815b', frequency: 220 }
];

// --- 2. TEMPORAL THEME ROUTER ---
function applyPhaseData(phase) {
    appState.currentPhase = phase.name;
    document.getElementById('current-state').textContent = phase.name;
    document.documentElement.style.setProperty('--bg-color', phase.bgColor);
    document.documentElement.style.setProperty('--accent-color', phase.color);
    document.getElementById('frequency-readout').textContent = `${phase.frequency.toFixed(2)} Hz`;
    
    if (appState.filterNode) {
        appState.filterNode.frequency.setValueAtTime(phase.frequency, appState.audioContext.currentTime);
    }

    // Dynamic visibility check for the Pomodoro engine panel
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
    
    // Update display if a target timer isn't actively hijacking the dashboard clock text
    if (appState.sleepTimerId === null && appState.pomoIsActive === false) {
        document.getElementById('timer-display').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }

    if (appState.manualPhaseIndex === -1) {
        const currentHour = now.getHours();
        const activePhase = CIRCADIAN_PHASES.find(p => p.startHour > p.endHour ? (currentHour >= p.startHour || currentHour < p.endHour) : (currentHour >= p.startHour && currentHour < p.endHour));
        
        if (activePhase && appState.currentPhase !== activePhase.name) {
            applyPhaseData(activePhase);
        }
    }
}

// --- 3. TOUCH-SWIPE ENGINE ---
let touchStartX = 0;
const gestureZone = document.getElementById('gesture-zone');

gestureZone.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches.screenX;
}, { passive: true });

gestureZone.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches.screenX;
    const swipeDistance = touchEndX - touchStartX;
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
}, { passive: true });

// --- 4. PROCEDURAL AUDIO LAYER ---
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

    // Audio Graph Link Mapping: Source -> Filter -> Gain -> Analyser -> Speakers
    appState.brownNoiseNode.connect(appState.filterNode);
    appState.filterNode.connect(appState.gainNode);
    appState.gainNode.connect(appState.analyserNode);
    appState.analyserNode.connect(appState.audioContext.destination);
    
    appState.brownNoiseNode.start(0);
    
    const activeTarget = appState.manualPhaseIndex !== -1 ? CIRCADIAN_PHASES[appState.manualPhaseIndex] : CIRCADIAN_PHASES.find(p => p.name === appState.currentPhase);
    if (activeTarget) applyPhaseData(activeTarget);
}

// --- 5. VISUALIZER & KINETIC ANIMATIONS ---
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

    // A: Guided Exercise Override - Breathwork Mode
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

    // B: Guided Exercise Override - Attention Training Mode (Cosmic Solar Engine)
    if (appState.activeExercise === 'attention') {
        if (!appState.orbitSystem) {
            appState.orbitSystem = { activeRing: 0, currentAngle: 0, lifetimeRemaining: 180, dotSize: 0, rings: [50, 90, 130] };
        }
        const sys = appState.orbitSystem;

        ctx.beginPath();
        ctx.arc(centerX, centerY, 8 + Math.sin(time * 3) * 1.5, 0, 2 * Math.PI);
        ctx.fillStyle = accentColor;
        ctx.globalAlpha = 0.15;
        ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1;
        ctx.strokeStyle = accentColor;
        ctx.stroke();

        sys.rings.forEach((radius, idx) => {
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = (idx === sys.activeRing) ? 0.8 : 0.2;
            ctx.globalAlpha = (idx === sys.activeRing) ? 0.3 : 0.08;
            ctx.stroke();
        });
        ctx.globalAlpha = 1.0;

        sys.currentAngle += 0.015 * (3 / (sys.activeRing + 1));
        sys.lifetimeRemaining--;

        if (sys.lifetimeRemaining > 150) sys.dotSize = (180 - sys.lifetimeRemaining) / 3;
        else if (sys.lifetimeRemaining < 30) sys.dotSize = sys.lifetimeRemaining / 3;
        else sys.dotSize = 10;

        const activeRadius = sys.rings[sys.activeRing];
        const dotX = centerX + Math.cos(sys.currentAngle) * activeRadius;
        const dotY = centerY + Math.sin(sys.currentAngle) * activeRadius;

        if (sys.dotSize > 0) {
            ctx.beginPath();
            ctx.arc(dotX, dotY, sys.dotSize / 2, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 15;
            ctx.shadowColor = accentColor;
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.beginPath();
            ctx.arc(dotX, dotY, sys.dotSize, 0, 2 * Math.PI);
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        if (sys.lifetimeRemaining <= 0) {
            let nextRing = Math.floor(Math.random() * 3);
            if (nextRing === sys.activeRing) nextRing = (nextRing + 1) % 3;
            sys.activeRing = nextRing;
            sys.lifetimeRemaining = 150 + Math.random() * 90;
            sys.currentAngle = Math.random() * Math.PI * 2; 
        }
        return;
    }

    // C: Native Framework Real-time Audio-Reactive Fluid Vector Processing
    for (let layer = 0; layer < 3; layer++) {
        ctx.beginPath();
        const baseRadius = 95 + (layer * 15);
        
        for (let i = 0; i <= 120; i++) {
            const angle = (i / 120) * Math.PI * 2;
            const dataIndex = i % bufferLength;
            const audioIntensity = dataArray[dataIndex] / 255;
            
            const waveOffset = Math.sin(angle * 6 + time * (layer + 1)) * 4;
