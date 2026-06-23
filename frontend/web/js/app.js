// Import Yjs from ESM
import * as Y from 'https://esm.sh/yjs@13.6.20';

let editor = null;
let doc = null;
let yText = null;
let ws = null;
let pingInterval = null;
let lastPingTime = 0;
let latency = 0;

// Validation functions
function validateUsername(name) {
    if (!name) return 'Anonymous';
    const trimmed = name.trim();
    if (trimmed.length === 0) return 'Anonymous';
    return trimmed.substring(0, 20);
}

function validateRoomCode(code) {
    if (!code) {
        return { valid: false, reason: "Room code cannot be empty" };
    }
    const trimmed = code.trim();
    if (trimmed.length === 0) {
        return { valid: false, reason: "Room code cannot be only whitespace" };
    }
    if (trimmed.length < 3 || trimmed.length > 20) {
        return { valid: false, reason: "Room code must be between 3 and 20 characters" };
    }
    const regex = /^[a-zA-Z0-9-_]+$/;
    if (!regex.test(trimmed)) {
        return { valid: false, reason: "Room code can only contain alphanumeric characters, dashes, and underscores" };
    }
    return { valid: true, code: trimmed };
}

// State management
let currentRoomId = null;
let myColor = '#39ff14';
let myClientId = null;
let username = validateUsername(sessionStorage.getItem('zerohub_username'));
sessionStorage.setItem('zerohub_username', username);
document.getElementById('usernameInput').value = username;

let isReconnecting = false;
let reconnectTimeout = null;
let joinTimeout = null;
let isRoomActionPending = false;

function setRoomActionState(pending) {
    isRoomActionPending = pending;
    const createBtn = document.getElementById('createRoomBtn');
    const joinBtn = document.getElementById('joinRoomBtn');
    const roomInput = document.getElementById('roomInput');

    if (pending) {
        if (createBtn) createBtn.disabled = true;
        if (joinBtn) joinBtn.disabled = true;
        if (roomInput) roomInput.disabled = true;
        if (createBtn) createBtn.textContent = 'CREATING...';
        if (joinBtn) joinBtn.textContent = 'JOINING...';
    } else {
        if (createBtn) createBtn.disabled = false;
        if (joinBtn) joinBtn.disabled = false;
        if (roomInput) roomInput.disabled = false;
        if (createBtn) createBtn.textContent = 'CREATE ROOM';
        if (joinBtn) joinBtn.textContent = 'JOIN';
    }
}


// Remote collaborator mappings & states
let remoteCursors = {}; // clientId -> { line, column, username, color, decorationId }
let remoteSelections = {}; // clientId -> { startLine, startCol, endLine, endCol, decorationId }
let typingTimeouts = {}; // clientId -> timeoutId
let yjsToWsClientId = {}; // yjsClientId -> wsClientId
let lastActivityTimes = {}; // clientId -> timestamp
let currentCollaborators = [];
let previousCollaboratorIds = new Set();
let remoteUpdate = false;

// Firebase SDK Integration (used ONLY for metadata, active users & room discovery)
let firebaseApp = null;
let firebaseDB = null;
let useFirebase = false;

function sanitizeFirebaseKey(key) {
    if (!key) return '';
    return key.replace(/[\.\#\$\[\]\/]/g, '_');
}

async function initFirebase() {
    try {
        const { initializeApp } = await import("https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js");
        const { getDatabase, ref, set, onValue, onDisconnect } = await import("https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js");

        let firebaseConfig;
        try {
            const configModule = await import('./firebase-config.js');
            firebaseConfig = configModule.firebaseConfig;
        } catch (e) {
            console.warn("Could not import firebase-config.js directly (possibly file:// CORS restriction). Using inline fallback credentials.");
            firebaseConfig = {
                apiKey: "AIzaSyDD5AtXU82CpLZsC16GGrc7pJA-4RXU2UM",
                authDomain: "zerohub-dedd7.firebaseapp.com",
                projectId: "zerohub-dedd7",
                storageBucket: "zerohub-dedd7.firebasestorage.app",
                messagingSenderId: "456434218038",
                appId: "1:456434218038:web:c35e0db92248453289d497",
                measurementId: "G-7YYHG2E5Z1",
                databaseURL: "https://zerohub-dedd7-default-rtdb.asia-southeast1.firebasedatabase.app/"
            };
        }

        firebaseApp = initializeApp(firebaseConfig);
        firebaseDB = getDatabase(firebaseApp);
        useFirebase = true;
        logActivity("SYS", "Connected to live registry");

        // Listen to active rooms on Firebase
        const roomsRef = ref(firebaseDB, 'active_rooms');
        onValue(roomsRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();

                // Clean up any empty rooms from RTDB after safety age window
                import("https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js").then(({ ref, remove }) => {
                    Object.keys(data).forEach(roomId => {
                        const age = Date.now() - (data[roomId].createdAt || 0);
                        if ((!data[roomId].users || Object.keys(data[roomId].users).length === 0) && age > 8000) {
                            const roomRef = ref(firebaseDB, `active_rooms/${roomId}`);
                            remove(roomRef).catch(() => { });
                            delete data[roomId];
                        }
                    });
                    renderFirebaseRooms(data);
                }).catch(() => {
                    renderFirebaseRooms(data);
                });
            } else {
                renderFirebaseRooms({});
            }
        });
    } catch (e) {
        console.warn("Firebase failed to load (offline). Fallback to simulated database.", e);
    }
}

function publishRoomToFirebase(roomId) {
    if (!useFirebase || !firebaseDB) return;
    import("https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js").then(({ ref, update }) => {
        const roomRef = ref(firebaseDB, `active_rooms/${roomId}`);
        update(roomRef, {
            roomId: roomId,
            createdAt: Date.now(),
            language: document.getElementById('languageSelect').value
        }).catch(err => {
            console.warn("Firebase room registry update skipped:", err.message);
        });
    }).catch(err => {
        console.warn("Firebase database module unavailable");
    });
}

function registerFirebaseUser(roomId, clientId, userName, userColor) {
    if (!useFirebase || !firebaseDB) return;
    const activeName = userName || 'Anonymous';
    const cleanClientId = sanitizeFirebaseKey(clientId);
    import("https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js").then(({ ref, set, onDisconnect }) => {
        const userRef = ref(firebaseDB, `active_rooms/${roomId}/users/${cleanClientId}`);
        set(userRef, {
            username: activeName,
            color: userColor,
            joinedAt: Date.now()
        }).then(() => {
            onDisconnect(userRef).remove().catch(() => { });
        }).catch(err => {
            console.warn("Firebase user registration skipped:", err.message);
        });
    }).catch(err => {
        console.warn("Firebase database module unavailable");
    });
}

function unregisterFirebaseUser(roomId, clientId) {
    if (!useFirebase || !firebaseDB || !roomId || !clientId) return;
    const cleanClientId = sanitizeFirebaseKey(clientId);
    import("https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js").then(({ ref, remove }) => {
        const userRef = ref(firebaseDB, `active_rooms/${roomId}/users/${cleanClientId}`);
        remove(userRef).catch(err => {
            console.warn("Firebase user cleanup skipped:", err.message);
        });
    }).catch(err => {
        console.warn("Firebase database module unavailable");
    });
}

function renderFirebaseRooms(roomsData) {
    const container = document.getElementById('discoveryList');
    if (!container) return;
    container.innerHTML = '';
    const roomIds = Object.keys(roomsData);

    if (roomIds.length === 0) {
        container.innerHTML = '<div class="no-rooms-fallback">No active rooms found</div>';
        return;
    }

    roomIds.forEach(roomId => {
        const item = document.createElement('div');
        item.className = 'discovery-item';

        const count = roomsData[roomId].users ? Object.keys(roomsData[roomId].users).length : 0;

        item.innerHTML = `
            <div>
                <div class="discovery-item-title"># ${roomId}</div>
                <div class="discovery-item-subtitle">Lang: ${(roomsData[roomId].language || 'javascript').toUpperCase()} // Users: ${count}</div>
            </div>
            <button class="btn-clean discovery-item-connect-btn" data-room-id="${roomId}">Connect</button>
        `;
        container.appendChild(item);
    });
}

// Mock Local fallback database (for offline usage)
let mockActiveRooms = {};
try {
    mockActiveRooms = JSON.parse(localStorage.getItem('zerohub_rooms') || '{}');
} catch (e) {
    mockActiveRooms = {};
}
initFirebase();

// Initialize Monaco require path
require.config({
    paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs' }
});

// Setup Monaco and trigger startup
require(['vs/editor/editor.main'], function () {
    // Define Hacker Green Theme
    monaco.editor.defineTheme('hackerTheme', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: '', foreground: 'a0ffa0', background: '0a0a0a' },
            { token: 'comment', foreground: '008800', fontStyle: 'italic' },
            { token: 'keyword', foreground: '39ff14', fontStyle: 'bold' },
            { token: 'string', foreground: '88c088' },
            { token: 'number', foreground: '00ff88' },
            { token: 'regexp', foreground: 'ff00ff' },
            { token: 'type', foreground: '00ffff' }
        ],
        colors: {
            'editor.background': '#0a0a0a',
            'editor.foreground': '#e5e5e5',
            'editor.lineHighlightBackground': '#111111',
            'editorCursor.foreground': '#39ff14',
            'editor.selectionBackground': '#1b3f1b',
            'editorLineNumber.foreground': '#2a2a2a',
            'editorLineNumber.activeForeground': '#39ff14',
            'editorWidget.background': '#111111',
            'editorWidget.border': '#222222'
        }
    });

    // Create Monaco Editor
    editor = monaco.editor.create(document.getElementById('editor'), {
        value: '// Start collaborating in style...\n\n',
        language: 'javascript',
        theme: 'hackerTheme',
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "'Fira Code', monospace",
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        minimap: { enabled: false }
    });

    // Update line/column position in status bar
    editor.onDidChangeCursorPosition(e => {
        document.getElementById('sbPosition').textContent = `LN ${e.position.lineNumber}, COL ${e.position.column}`;
        sendCursorPosition(e.position.lineNumber, e.position.column);
    });

    // Initialize Yjs
    doc = new Y.Doc();
    yText = doc.getText('monaco');

    // Sync Yjs doc with Monaco editor content manually
    yText.observe(event => {
        if (remoteUpdate || !editor) return;
        remoteUpdate = true;
        const currentVal = editor.getValue();
        const yjsVal = yText.toString();
        if (currentVal !== yjsVal) {
            const state = editor.saveViewState();
            editor.setValue(yjsVal);
            if (state) editor.restoreViewState(state);
        }
        remoteUpdate = false;
    });

    editor.onDidChangeModelContent(event => {
        if (remoteUpdate) return;
        remoteUpdate = true;

        // Push full contents to Yjs document to keep simple and robust
        const text = editor.getValue();
        doc.transact(() => {
            yText.delete(0, yText.length);
            yText.insert(0, text);
        }, 'local');

        remoteUpdate = false;
    });

    // Handle document updates
    doc.on('update', (update, origin) => {
        if (origin !== 'remote') {
            try {
                const base64Update = uint8ArrayToBase64(update);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'yjs_update',
                        update: base64Update
                    }));
                }
            } catch (e) {
                console.error("Yjs update dispatch error:", e);
            }
        }
    });

    // Connect to WebSocket Server
    connectWebSocket();
    setupUIHandlers();
    autoJoinFromURL();
});

// WebSocket Connection
function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return;
    }

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    const statusDot = document.getElementById('statusDot');
    const sbConnection = document.getElementById('sbConnection');

    if (isReconnecting) {
        if (statusDot) statusDot.className = 'status-dot connecting';
        if (sbConnection) sbConnection.textContent = 'RECONNECTING';
    } else {
        if (statusDot) statusDot.className = 'status-dot connecting';
        if (sbConnection) sbConnection.textContent = 'CONNECTING';
    }

    try {
        let WS_URL;

        const host = window.location.hostname;

        if (
            host === "localhost" ||
            host === "127.0.0.1" ||
            host.startsWith("192.168.") ||
            host.startsWith("10.")
        ) {
            WS_URL = `ws://${host}:8080/ws`;
        } else {
            WS_URL = "wss://zerohub-backend.onrender.com/ws";
        }

        console.log("Connecting to:", WS_URL);

        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            isReconnecting = false;
            if (statusDot) {
                statusDot.className = 'status-dot connected';
            }
            if (sbConnection) sbConnection.textContent = 'CONNECTED';
            logActivity('SYS', 'Connected to session router');

            // Start ping diagnostic interval
            if (pingInterval) clearInterval(pingInterval);
            pingInterval = setInterval(sendPing, 4000);

            // Re-join room if we had one
            if (currentRoomId) {
                const validation = validateRoomCode(currentRoomId);
                if (validation.valid) {
                    joinRoom(validation.code);
                }
            }

            // Initialize Firebase Discovery mock
            refreshDiscoveryList();
        };

        ws.onclose = () => {
            if (statusDot) {
                statusDot.className = 'status-dot disconnected';
            }
            if (sbConnection) sbConnection.textContent = 'DISCONNECTED';
            logActivity('SYS', 'Server offline. Reconnecting...');
            clearInterval(pingInterval);
            const latencyDiag = document.getElementById('diagnosticLatency');
            if (latencyDiag) latencyDiag.textContent = '(--ms)';

            isReconnecting = true;
            if (!reconnectTimeout) {
                reconnectTimeout = setTimeout(connectWebSocket, 3000);
            }
        };

        ws.onerror = (err) => {
            console.warn("WebSocket connection error:", err);
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleWebSocketMessage(msg);
            } catch (e) {
                console.error('Error handling ws raw frame:', e);
            }
        };
    } catch (err) {
        console.error("Failed to initialize WebSocket connection:", err);
        if (statusDot) {
            statusDot.className = 'status-dot disconnected';
        }
        if (sbConnection) sbConnection.textContent = 'DISCONNECTED';
        isReconnecting = true;
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(connectWebSocket, 3000);
        }
    }
}

function sendPing() {
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            lastPingTime = performance.now();
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    } catch (e) {
        console.warn("Ping send failed:", e);
    }
}

function handleWebSocketMessage(msg) {
    if (msg.type === 'pong') {
        latency = Math.round(performance.now() - lastPingTime);
        const latencyDiag = document.getElementById('diagnosticLatency');
        if (latencyDiag) latencyDiag.textContent = `(${latency}ms)`;
        return;
    }

    switch (msg.type) {
        case 'joined':
            if (joinTimeout) {
                clearTimeout(joinTimeout);
                joinTimeout = null;
            }
            setRoomActionState(false);

            // Clear editor content and reset Yjs doc on switching rooms
            if (currentRoomId && currentRoomId !== msg.roomId) {
                unregisterFirebaseUser(currentRoomId, myClientId);
                if (editor && yText) {
                    remoteUpdate = true;
                    yText.delete(0, yText.length);
                    editor.setValue('');
                    remoteUpdate = false;
                }
            }

            myColor = msg.color;
            myClientId = msg.clientId;
            currentRoomId = msg.roomId;

            // Display Room
            const codeDisplay = document.getElementById('roomCodeDisplay');
            if (codeDisplay) codeDisplay.textContent = currentRoomId;
            const sbRoom = document.getElementById('sbRoom');
            if (sbRoom) sbRoom.textContent = `ROOM: ${currentRoomId}`;
            const copyBtn = document.getElementById('copyRoomBtn');
            if (copyBtn) copyBtn.style.display = 'block';

            // Update URL
            try {
                const url = new URL(window.location);
                url.searchParams.set('room', currentRoomId);
                window.history.pushState({}, '', url);
            } catch (e) {
                console.warn("Could not update URL parameter:", e);
            }

            logActivity('ROOM', `Joined room ${currentRoomId}`);

            // Update Discovery fallback state
            addMockDiscoveryRoom(currentRoomId);
            publishRoomToFirebase(currentRoomId);
            registerFirebaseUser(currentRoomId, myClientId, username, myColor);
            break;

        case 'yjs_init':
            if (msg.updates && msg.updates.length > 0) {
                logActivity('YJS', `Syncing document state (${msg.updates.length} updates)...`);
                try {
                    doc.transact(() => {
                        msg.updates.forEach(u => {
                            const update = base64ToUint8Array(u);
                            Y.applyUpdate(doc, update, 'remote');
                        });
                    }, 'remote');
                } catch (e) {
                    console.error("Yjs init apply failed:", e);
                }
            }
            break;

        case 'yjs_update':
            try {
                const update = base64ToUint8Array(msg.update);
                try {
                    const decoded = Y.decodeUpdate(update);
                    if (decoded && decoded.structs && decoded.structs.length > 0) {
                        const senderYjsId = decoded.structs[0].id.client;
                        const wsId = yjsToWsClientId[senderYjsId];
                        if (wsId && wsId !== myClientId) {
                            showTypingIndicator(wsId);
                            lastActivityTimes[wsId] = Date.now();
                        }
                    }
                } catch (e) {
                    console.warn("Failed to decode update for typing indicator:", e);
                }
                Y.applyUpdate(doc, update, 'remote');
            } catch (e) {
                console.error("Failed to apply yjs update:", e);
            }
            break;

        case 'presence_list':
            currentCollaborators = msg.users;
            updateCollaborators(currentCollaborators);
            break;

        case 'cursor':
            lastActivityTimes[msg.clientId] = Date.now();
            handleRemoteCursor(msg);
            break;
    }
}

// Collaborator presence rendering
function updateCollaborators(users) {
    const list = document.getElementById('collabList');
    if (!list) return;
    list.innerHTML = '';

    // Check joins & leaves for toasts
    const currentIds = new Set(users.map(u => u.clientId));

    users.forEach(user => {
        if (!previousCollaboratorIds.has(user.clientId)) {
            if (myClientId && user.clientId !== myClientId) {
                showToast(`${user.username || 'Collaborator'} joined room`);
            }
        }
    });

    previousCollaboratorIds.forEach(id => {
        if (!currentIds.has(id)) {
            showToast(`Collaborator left room`);
        }
    });

    previousCollaboratorIds = currentIds;

    users.forEach(user => {
        const isSelf = user.clientId === myClientId;

        // Active vs Idle detection (30s threshold)
        let status = 'online';
        if (!isSelf) {
            const lastActive = lastActivityTimes[user.clientId] || 0;
            if (Date.now() - lastActive > 30000) {
                status = 'idle';
            }
        }

        const item = document.createElement('div');
        item.className = 'collab-item';

        const initial = user.username ? user.username.charAt(0).toUpperCase() : 'H';
        const statusColor = status === 'idle' ? '#ffa500' : user.color;
        const statusText = status === 'idle' ? 'Idle' : 'Online';

        item.innerHTML = `
            <div class="collab-info">
                <div class="collab-avatar" style="background-color: ${user.color}15; border: 1px solid ${user.color}; color: ${user.color};">
                    ${initial}
                </div>
                <div class="collab-details">
                    <span class="collab-name">${user.username || 'Anonymous'}${isSelf ? ' (You)' : ''}</span>
                    <span class="typing-indicator" id="typing-${user.clientId}">Typing...</span>
                </div>
            </div>
            <div class="collab-status-container">
                <span class="collab-status-text">${statusText}</span>
                <div class="online-indicator" style="background-color: ${statusColor};"></div>
            </div>
        `;
        list.appendChild(item);
    });

    document.getElementById('activeUserCount').textContent = `${users.length} ${users.length === 1 ? 'USER' : 'USERS'}`;
    document.getElementById('sbUsers').textContent = `USERS: ${users.length}`;
}

// Remote cursor rendering via Monaco decorations
function handleRemoteCursor(msg) {
    const clientId = msg.clientId;
    if (clientId === myClientId) return;

    // Save Yjs-to-WebSocket client ID mapping
    if (msg.position && msg.position.yjsClientId) {
        yjsToWsClientId[msg.position.yjsClientId] = clientId;
    }

    // Remove existing cursor decoration if any
    if (remoteCursors[clientId] && remoteCursors[clientId].decorationId) {
        editor.removeDecorations([remoteCursors[clientId].decorationId]);
    }

    // Render custom cursor decoration
    const cursorClassName = `collaborator-cursor-${clientId}`;

    // Dynamically insert cursor styling for this collaborator's color
    let styleEl = document.getElementById(`style-${clientId}`);
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = `style-${clientId}`;
        document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = `
        .${cursorClassName} {
            border-left: 2px solid ${msg.color} !important;
            position: absolute;
        }
        .${cursorClassName}::after {
            content: "${msg.username || 'Anonymous'}";
            position: absolute;
            top: -18px;
            left: 0;
            background: ${msg.color};
            color: #000;
            font-size: 9px;
            font-weight: bold;
            padding: 1px 4px;
            border-radius: 2px;
            white-space: nowrap;
            opacity: 0.8;
            pointer-events: none;
            transition: opacity 0.5s;
        }
    `;

    const range = new monaco.Range(
        msg.position.lineNumber,
        msg.position.column,
        msg.position.lineNumber,
        msg.position.column
    );

    const [decorId] = editor.deltaDecorations([], [
        {
            range: range,
            options: {
                className: cursorClassName,
                isWholeLine: false
            }
        }
    ]);

    remoteCursors[clientId] = {
        lineNumber: msg.position.lineNumber,
        column: msg.position.column,
        username: msg.username || 'Anonymous',
        color: msg.color,
        decorationId: decorId
    };

    // Fade out cursor name label after inactivity
    setTimeout(() => {
        if (styleEl) {
            styleEl.innerHTML = `
                .${cursorClassName} {
                    border-left: 2px solid ${msg.color} !important;
                    position: absolute;
                }
                .${cursorClassName}::after {
                    content: "${msg.username || 'Anonymous'}";
                    position: absolute;
                    top: -18px;
                    left: 0;
                    background: ${msg.color};
                    color: #000;
                    font-size: 9px;
                    font-weight: bold;
                    padding: 1px 4px;
                    border-radius: 2px;
                    white-space: nowrap;
                    opacity: 0;
                    pointer-events: none;
                }
            `;
        }
    }, 2500);
}

function showTypingIndicator(clientId) {
    const el = document.getElementById(`typing-${clientId}`);
    if (!el) return;

    el.style.display = 'inline';

    if (typingTimeouts[clientId]) {
        clearTimeout(typingTimeouts[clientId]);
    }

    typingTimeouts[clientId] = setTimeout(() => {
        el.style.display = 'none';
    }, 2000);
}

function sendCursorPosition(line, col) {
    if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
        ws.send(JSON.stringify({
            type: 'cursor',
            position: {
                lineNumber: line,
                column: col,
                yjsClientId: doc.clientID
            }
        }));
    }
}

// Copy Text Utility with secure and fallback methods
function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    } else {
        return new Promise((resolve, reject) => {
            try {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.top = "0";
                textArea.style.left = "0";
                textArea.style.position = "fixed";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (successful) {
                    resolve();
                } else {
                    reject(new Error("fallback copy failed"));
                }
            } catch (err) {
                reject(err);
            }
        });
    }
}

// UI Event Handlers
function setupUIHandlers() {
    // Alias update
    const usernameInput = document.getElementById('usernameInput');
    if (usernameInput) {
        usernameInput.addEventListener('change', e => {
            const originalVal = e.target.value;
            const validated = validateUsername(originalVal);
            e.target.value = validated;
            username = validated;
            sessionStorage.setItem('zerohub_username', username);
            logActivity('SYS', `Alias set to ${username}`);
            if (currentRoomId) {
                const validation = validateRoomCode(currentRoomId);
                if (validation.valid) {
                    joinRoom(validation.code);
                }
            }
        });
    }

    // Create Room
    const createBtn = document.getElementById('createRoomBtn');
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            if (isRoomActionPending) return;
            const randCode = Math.floor(100000 + Math.random() * 900000).toString();
            joinRoom(randCode);
        });
    }

    // Join Room
    const joinBtn = document.getElementById('joinRoomBtn');
    if (joinBtn) {
        joinBtn.addEventListener('click', () => {
            if (isRoomActionPending) return;
            const roomInput = document.getElementById('roomInput');
            if (roomInput) {
                const code = roomInput.value.trim();
                joinRoom(code);
            }
        });
    }

    // Copy Link
    const copyBtn = document.getElementById('copyRoomBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            if (!currentRoomId) return;
            const shareURL = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
            copyTextToClipboard(shareURL).then(() => {
                showToast('Share URL copied to clipboard');
                logActivity('SYS', 'Copied room session URL');
            }).catch(err => {
                console.error("Copy failed: ", err);
                showToast('Failed to copy. Please manually copy the URL.');
            });
        });
    }

    // Language Select
    const langSelect = document.getElementById('languageSelect');
    if (langSelect) {
        langSelect.addEventListener('change', e => {
            const lang = e.target.value;
            if (editor) {
                const model = editor.getModel();
                monaco.editor.setModelLanguage(model, lang);
                const sbLanguage = document.getElementById('sbLanguage');
                if (sbLanguage) sbLanguage.textContent = lang.toUpperCase();
                logActivity('SYS', `Language switched to ${lang.toUpperCase()}`);
            }
        });
    }

    // Theme Select
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
        themeSelect.addEventListener('change', e => {
            const val = e.target.value;
            if (editor) {
                if (val === 'hacker') {
                    monaco.editor.setTheme('hackerTheme');
                    document.body.style.setProperty('--bg-main', '#0a0a0a');
                    document.body.style.setProperty('--bg-panel', '#111111');
                    document.body.style.setProperty('--bg-input', '#181818');
                    document.body.style.setProperty('--border-subtle', '#222222');
                } else {
                    monaco.editor.setTheme('vs-dark');
                    document.body.style.setProperty('--bg-main', '#1e1e1e');
                    document.body.style.setProperty('--bg-panel', '#252526');
                    document.body.style.setProperty('--bg-input', '#2d2d2d');
                    document.body.style.setProperty('--border-subtle', '#3c3c3c');
                }
            }
        });
    }

    // Discovery List Connect Click Delegation
    const discoveryList = document.getElementById('discoveryList');
    if (discoveryList) {
        discoveryList.addEventListener('click', e => {
            const btn = e.target.closest('.discovery-item-connect-btn');
            if (btn) {
                const roomId = btn.getAttribute('data-room-id');
                if (roomId) {
                    const roomInput = document.getElementById('roomInput');
                    if (roomInput) roomInput.value = roomId;
                    joinRoom(roomId);
                }
            }
        });
    }
}

function joinRoom(roomId) {
    const validation = validateRoomCode(roomId);
    if (!validation.valid) {
        showToast(validation.reason);
        return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        logActivity('ERR', 'No server connection. Retrying...');
        currentRoomId = validation.code;
        return;
    }

    setRoomActionState(true);
    if (joinTimeout) clearTimeout(joinTimeout);
    joinTimeout = setTimeout(() => {
        setRoomActionState(false);
        showToast("Join request timed out. Please try again.");
    }, 6000);

    const activeName = username || 'Anonymous';
    try {
        ws.send(JSON.stringify({
            type: 'join',
            roomId: validation.code,
            username: activeName
        }));
    } catch (e) {
        console.error("Error sending join request:", e);
        showToast("Failed to send join request. Please retry.");
        setRoomActionState(false);
    }
}

// Window beforeunload presence cleanup
window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (currentRoomId && myClientId) {
            unregisterFirebaseUser(currentRoomId, myClientId);
        }
        ws.close();
    }
});

// Periodic Idle Check (Every 5 seconds)
setInterval(() => {
    if (currentCollaborators.length > 0) {
        updateCollaborators(currentCollaborators);
    }
}, 5000);

function autoJoinFromURL() {
    try {
        const params = new URLSearchParams(window.location.search);
        const room = params.get('room');
        if (room) {
            const validation = validateRoomCode(room);
            if (validation.valid) {
                const roomInput = document.getElementById('roomInput');
                if (roomInput) roomInput.value = validation.code;
                setTimeout(() => joinRoom(validation.code), 500);
            } else {
                showToast(`Invalid room link: ${validation.reason}`);
                const url = new URL(window.location);
                url.searchParams.delete('room');
                window.history.replaceState({}, '', url);
            }
        }
    } catch (e) {
        console.warn("autoJoinFromURL failed:", e);
    }
}

// Activity Logging
function logActivity(cat, text) {
    console.log(`[${cat}] ${text}`);
    if (cat === 'ROOM' || cat === 'SYS' || cat === 'ERR') {
        showToast(`${cat}: ${text}`);
    }
}

function showToast(msg) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Firebase simulated room discovery local Fallbacks
function addMockDiscoveryRoom(roomId) {
    mockActiveRooms[roomId] = {
        name: `ROOM ${roomId}`,
        time: Date.now()
    };
    localStorage.setItem('zerohub_rooms', JSON.stringify(mockActiveRooms));
    refreshDiscoveryList();
}

function refreshDiscoveryList() {
    const container = document.getElementById('discoveryList');
    if (!container) return;
    container.innerHTML = '';

    const keys = Object.keys(mockActiveRooms);
    if (keys.length === 0) {
        container.innerHTML = '<div class="no-rooms-fallback">No active rooms found</div>';
        return;
    }

    keys.sort((a, b) => mockActiveRooms[b].time - mockActiveRooms[a].time).forEach(roomId => {
        const item = document.createElement('div');
        item.className = 'discovery-item';

        item.innerHTML = `
            <div>
                <div class="discovery-item-title"># ${roomId}</div>
                <div class="discovery-item-subtitle">Active room session</div>
            </div>
            <button class="btn-clean discovery-item-connect-btn" data-room-id="${roomId}">Connect</button>
        `;
        container.appendChild(item);
    });
}

// Yjs Binary Utils
function uint8ArrayToBase64(arr) {
    let binary = '';
    const len = arr.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(arr[i]);
    }
    return window.btoa(binary);
}

function base64ToUint8Array(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// Expose refresh list globally for buttons
window.refreshDiscoveryList = refreshDiscoveryList;
