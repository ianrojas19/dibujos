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
let peerConnections = {}; // targetId -> RTCPeerConnection (For transmitter)
let peerConnection = null; // Single RTCPeerConnection (For observer)

// STUN servers for WebRTC (public google stun server)
const configuration = {
    'iceServers': [
        { 'urls': 'stun:stun.l.google.com:19302' }
    ]
};

// --- ROLE SELECTION ---

function setLoading(btnId, isLoading) {
    const btn = document.getElementById(btnId);
    const text = document.getElementById(btnId.replace('btn-', 'text-'));
    const spin = document.getElementById(btnId.replace('btn-', 'spin-'));
    
    if (isLoading) {
        btn.disabled = true;
        btn.classList.add('opacity-75', 'cursor-not-allowed');
        text.textContent = 'Conectando...';
        spin.classList.remove('hidden');
    } else {
        btn.disabled = false;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
        text.textContent = btnId === 'btn-transmitter' ? '🎥 Soy Transmisor' : '👀 Soy Observador';
        spin.classList.add('hidden');
    }
}

btnTransmitter.addEventListener('click', () => {
    setLoading('btn-transmitter', true);
    socket.emit('joinAsTransmitter', (response) => {
        setLoading('btn-transmitter', false);
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
    setLoading('btn-observer', true);
    socket.emit('joinAsObserver', (response) => {
        setLoading('btn-observer', false);
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

// Cuando un nuevo observador se conecta, el transmisor debe generarle una oferta WebRTC exclusiva
socket.on('newObserverReady', async (observerId) => {
    if (myRole === 'transmitter' && localStream) {
        try {
            console.log("Creando conexión para nuevo observador:", observerId);
            const pc = new RTCPeerConnection(configuration);
            peerConnections[observerId] = pc;

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('candidate', { target: observerId, candidate: event.candidate });
                }
            };

            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            socket.emit('offer', { target: observerId, offer: offer });
            
            // Re-enviar el blur actual al nuevo observador
            socket.emit('updateBlur', blurSlider.value);
        } catch (e) {
            console.error('Error al crear oferta para nuevo observador:', e);
        }
    }
});

socket.on('transmitterReady', () => {
    if (myRole === 'observer') {
        socket.emit('observerReady');
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

        // No creamos conexiones genéricas, esperamos que los observadores llamen a newObserverReady.
        // Pero notificamos a la sala que ya estamos listos. (El servidor ya hizo un broadcast al hacer joinAsTransmitter,
        // pero por si acaso, lo manejamos vía el evento emitido por el server 'transmitterReady').

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

// --- WEBRTC LOGIC (OBSERVER) ---

function initPeerConnection(transmitterId) {
    if (peerConnection) {
        peerConnection.close();
    }
    
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('candidate', { target: transmitterId, candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        if (myRole === 'observer') {
            waitingMessage.classList.add('hidden');
            mainVideo.srcObject = event.streams[0];
        }
    };
}

socket.on('offer', async (data) => {
    if (myRole === 'observer') {
        const transmitterId = data.senderId;
        initPeerConnection(transmitterId);
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.emit('answer', { target: transmitterId, answer: answer });
    }
});

socket.on('answer', async (data) => {
    if (myRole === 'transmitter') {
        const observerId = data.senderId;
        const pc = peerConnections[observerId];
        if (pc && pc.signalingState !== 'stable') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    }
});

socket.on('candidate', async (data) => {
    try {
        if (myRole === 'transmitter') {
            const pc = peerConnections[data.senderId];
            if (pc) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } else if (myRole === 'observer') {
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        }
    } catch (e) {
        console.error('Error agregando candidato ICE', e);
    }
});
