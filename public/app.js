const socket = io();

// UI Elements
const roleSelection = document.getElementById('role-selection');
const videoContainer = document.getElementById('video-container');
const btnTransmitter = document.getElementById('btn-transmitter');
const btnObserver = document.getElementById('btn-observer');
const roleError = document.getElementById('role-error');
const mainVideo = document.getElementById('main-video');
const viewTitle = document.getElementById('view-title');
const waitingMessage = document.getElementById('waiting-message');
const transmitterControls = document.getElementById('transmitter-controls');
const blurSlider = document.getElementById('blur-slider');
const blurValueDisplay = document.getElementById('blur-value');
const statusBar = document.getElementById('status-bar');
const transmitterStatus = document.getElementById('transmitter-status');
const observerStatus = document.getElementById('observer-status');

// State
let myRole = null; // 'transmitter' | 'observer'
let localStream = null;
let peerConnection = null;

// STUN servers for WebRTC (public google stun server)
const configuration = {
    'iceServers': [
        { 'urls': 'stun:stun.l.google.com:19302' }
    ]
};

// --- ROLE SELECTION ---

btnTransmitter.addEventListener('click', () => {
    socket.emit('joinAsTransmitter', (response) => {
        if (response.success) {
            myRole = 'transmitter';
            showVideoInterface('🎥 Transmitiendo Dibujo');
            transmitterControls.classList.remove('hidden');
            startTransmission();
        } else {
            showError(response.message);
        }
    });
});

btnObserver.addEventListener('click', () => {
    socket.emit('joinAsObserver', (response) => {
        if (response.success) {
            myRole = 'observer';
            showVideoInterface('👀 Vista de Observador');
            if (!response.hasTransmitter) {
                waitingMessage.classList.remove('hidden');
            }
            initPeerConnection();
        }
    });
});

function showVideoInterface(title) {
    roleSelection.classList.add('hidden');
    videoContainer.classList.remove('hidden');
    videoContainer.classList.add('flex');
    statusBar.classList.remove('hidden');
    viewTitle.textContent = title;
}

function showError(msg) {
    roleError.textContent = msg;
    roleError.classList.remove('hidden');
    setTimeout(() => {
        roleError.classList.add('hidden');
    }, 3000);
}

// --- STATE UPDATES ---
socket.on('stateUpdate', (state) => {
    // Update top bar
    if (state.hasTransmitter) {
        transmitterStatus.textContent = 'Transmisor Activo';
        transmitterStatus.classList.replace('bg-red-100', 'bg-indigo-100');
        transmitterStatus.classList.replace('text-red-700', 'text-indigo-700');
    } else {
        transmitterStatus.textContent = 'Sin Transmisor';
        transmitterStatus.classList.replace('bg-indigo-100', 'bg-red-100');
        transmitterStatus.classList.replace('text-indigo-700', 'text-red-700');
    }
    observerStatus.textContent = `${state.observerCount} Observador${state.observerCount !== 1 ? 'es' : ''}`;
});

socket.on('transmitterDisconnected', () => {
    if (myRole === 'observer') {
        waitingMessage.classList.remove('hidden');
        mainVideo.srcObject = null;
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        initPeerConnection();
    }
});

// Cuando un nuevo observador se conecta, el transmisor debe regenerar la oferta WebRTC
socket.on('newObserverReady', async () => {
    if (myRole === 'transmitter' && peerConnection) {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('offer', offer);
            
            // Re-enviar el blur actual al nuevo observador
            socket.emit('updateBlur', blurSlider.value);
        } catch (e) {
            console.error('Error al crear oferta para nuevo observador:', e);
        }
    }
});

// --- TRANSMITTER LOGIC ---

async function startTransmission() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'environment' // Prefer rear camera on mobile
            }, 
            audio: false 
        });
        
        mainVideo.srcObject = localStream;
        mainVideo.muted = true; // Just to avoid any unwanted sounds

        initPeerConnection();
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Crear la primera oferta para los observadores actuales
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', offer);

    } catch (err) {
        console.error('Error accediendo a la cámara:', err);
        alert('No se pudo acceder a la cámara. Asegúrate de dar permisos y de estar navegando mediante HTTPS o localhost.');
    }
}

// --- BLUR CONTROL ---

blurSlider.addEventListener('input', (e) => {
    const blurVal = e.target.value;
    blurValueDisplay.textContent = `${blurVal}px`;
    socket.emit('updateBlur', blurVal);
});

socket.on('blurUpdate', (blurVal) => {
    console.log("Recibiendo actualización de blur:", blurVal);
    if (myRole === 'observer') {
        mainVideo.style.filter = `blur(${blurVal}px)`;
        mainVideo.style.webkitFilter = `blur(${blurVal}px)`;
    }
});

// --- WEBRTC LOGIC ---

function initPeerConnection() {
    if (peerConnection) {
        peerConnection.close();
    }
    
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('candidate', event.candidate);
        }
    };

    peerConnection.ontrack = (event) => {
        if (myRole === 'observer') {
            waitingMessage.classList.add('hidden');
            mainVideo.srcObject = event.streams[0];
        }
    };
}

socket.on('offer', async (offer) => {
    if (myRole === 'observer') {
        if (!peerConnection) initPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', answer);
    }
});

socket.on('answer', async (answer) => {
    if (myRole === 'transmitter') {
        // Solo aplicar si estamos en un estado donde esperamos answer
        if (peerConnection.signalingState !== 'stable') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
    }
});

socket.on('candidate', async (candidate) => {
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error agregando candidato ICE', e);
        }
    }
});
