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
let iceCandidateQueue = []; // Queue for observer
let iceCandidateQueues = {}; // targetId -> [] Queue for transmitter

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
            console.log(`[WebRTC] Creando conexión para nuevo observador: ${observerId}`);
            const pc = new RTCPeerConnection(configuration);
            peerConnections[observerId] = pc;
            iceCandidateQueues[observerId] = [];

            pc.oniceconnectionstatechange = () => {
                console.log(`[WebRTC - ICE State] Transmisor hacia ${observerId}:`, pc.iceConnectionState);
            };

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log(`[WebRTC] Transmisor generó candidato ICE para ${observerId}`);
                    socket.emit('candidate', { target: observerId, candidate: event.candidate });
                }
            };

            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });

            console.log(`[WebRTC] Creando Oferta para ${observerId}`);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            console.log(`[WebRTC] Oferta enviada a ${observerId}`);
            socket.emit('offer', { target: observerId, offer: offer });
            
            // Re-enviar el blur actual al nuevo observador
            socket.emit('updateBlur', blurSlider.value);
        } catch (e) {
            console.error('[WebRTC Error] Error al crear oferta para nuevo observador:', e);
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
    
    iceCandidateQueue = [];
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.oniceconnectionstatechange = () => {
        console.log(`[WebRTC - ICE State] Observador hacia transmisor:`, peerConnection.iceConnectionState);
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`[WebRTC] Observador generó candidato ICE para transmisor`);
            socket.emit('candidate', { target: transmitterId, candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        console.log(`[WebRTC] ¡Track de video/audio recibido en el observador!`);
        if (myRole === 'observer') {
            waitingMessage.classList.add('hidden');
            mainVideo.srcObject = event.streams[0];
            mainVideo.play()
                .then(() => console.log(`[WebRTC] Reproducción automática iniciada con éxito.`))
                .catch(e => console.error('[WebRTC Error] Autoplay bloqueado o en proceso:', e));
        }
    };
}

socket.on('offer', async (data) => {
    if (myRole === 'observer') {
        const transmitterId = data.senderId;
        console.log(`[WebRTC] Oferta recibida del transmisor: ${transmitterId}`);
        initPeerConnection(transmitterId);
        
        try {
            console.log(`[WebRTC] Procesando Oferta (setRemoteDescription)...`);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            console.log(`[WebRTC] Creando Respuesta (Answer)...`);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            console.log(`[WebRTC] Enviando Respuesta al transmisor`);
            socket.emit('answer', { target: transmitterId, answer: answer });

            // Procesar candidatos encolados
            console.log(`[WebRTC] Procesando ${iceCandidateQueue.length} candidatos ICE encolados...`);
            for (let candidate of iceCandidateQueue) {
                await peerConnection.addIceCandidate(candidate);
            }
            iceCandidateQueue = [];
        } catch (e) {
            console.error('[WebRTC Error] Error al procesar oferta:', e);
        }
    }
});

socket.on('answer', async (data) => {
    if (myRole === 'transmitter') {
        const observerId = data.senderId;
        console.log(`[WebRTC] Respuesta recibida del observador: ${observerId}`);
        const pc = peerConnections[observerId];
        
        if (pc && pc.signalingState !== 'stable') {
            try {
                console.log(`[WebRTC] Procesando Respuesta para ${observerId} (setRemoteDescription)...`);
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

                // Procesar candidatos encolados
                const queue = iceCandidateQueues[observerId] || [];
                console.log(`[WebRTC] Procesando ${queue.length} candidatos ICE encolados de ${observerId}...`);
                for (let candidate of queue) {
                    await pc.addIceCandidate(candidate);
                }
                iceCandidateQueues[observerId] = [];
            } catch (e) {
                console.error('[WebRTC Error] Error al procesar respuesta del observador:', e);
            }
        }
    }
});

socket.on('candidate', async (data) => {
    try {
        const candidate = new RTCIceCandidate(data.candidate);
        
        if (myRole === 'transmitter') {
            const observerId = data.senderId;
            console.log(`[WebRTC] Candidato ICE recibido de observador ${observerId}`);
            const pc = peerConnections[observerId];
            if (pc) {
                if (pc.remoteDescription && pc.remoteDescription.type) {
                    await pc.addIceCandidate(candidate);
                } else {
                    console.log(`[WebRTC] Encolando candidato ICE de ${observerId}`);
                    if (!iceCandidateQueues[observerId]) iceCandidateQueues[observerId] = [];
                    iceCandidateQueues[observerId].push(candidate);
                }
            }
        } else if (myRole === 'observer') {
            console.log(`[WebRTC] Candidato ICE recibido del transmisor`);
            if (peerConnection) {
                if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
                    await peerConnection.addIceCandidate(candidate);
                } else {
                    console.log(`[WebRTC] Encolando candidato ICE del transmisor`);
                    iceCandidateQueue.push(candidate);
                }
            }
        }
    } catch (e) {
        console.error('[WebRTC Error] Error agregando candidato ICE:', e);
    }
});
