<div align="center">

# ⚡ ZeroHub

### Real-Time Collaborative Code Editor Powered by Erlang

[![Erlang](https://img.shields.io/badge/Erlang-OTP%2026-red?style=for-the-badge&logo=erlang)](https://www.erlang.org/)
[![Monaco](https://img.shields.io/badge/Monaco-Editor-blue?style=for-the-badge)](https://microsoft.github.io/monaco-editor/)
[![Yjs](https://img.shields.io/badge/Yjs-CRDT-orange?style=for-the-badge)](https://yjs.dev/)
[![Firebase](https://img.shields.io/badge/Firebase-Realtime%20Database-yellow?style=for-the-badge&logo=firebase)](https://firebase.google.com/)
[![WebSocket](https://img.shields.io/badge/WebSocket-Realtime-green?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)

**A lightweight collaborative coding platform built using an unconventional stack focused on concurrency, realtime synchronization, and distributed systems.**

🌐 Live Demo: https://zero-hub-three.vercel.app

</div>

---

## Overview

ZeroHub is a real-time collaborative code editor that enables multiple users to join a shared workspace and edit code simultaneously.

Built for the **Stack Unknown Hackathon**, the project intentionally avoids conventional backend technologies such as Node.js and instead leverages Erlang's actor-based concurrency model for realtime communication.

---

## Features

- Real-time collaborative editing
- Multi-user synchronization
- Room-based collaboration
- Live user presence
- Typing indicators
- Shared cursor tracking
- Firebase-powered room discovery
- Mobile and desktop support
- WebSocket communication
- Dark developer-focused interface
- Automatic room sharing

---

## Tech Stack

### Frontend

- HTML5
- CSS3
- JavaScript
- Monaco Editor
- Yjs CRDT

### Backend

- Erlang/OTP
- Cowboy WebSocket Server

### Infrastructure

- Firebase Realtime Database
- Vercel
- Render

---

## Architecture

```text
                    ┌────────────────┐
                    │ Monaco Editor  │
                    └───────┬────────┘
                            │
                            ▼
                    ┌────────────────┐
                    │      Yjs       │
                    │     CRDT       │
                    └───────┬────────┘
                            │
                            ▼
                    ┌────────────────┐
                    │   WebSocket    │
                    └───────┬────────┘
                            │
                            ▼
                    ┌────────────────┐
                    │ Erlang Cowboy  │
                    │    Backend     │
                    └───────┬────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
      ┌─────────────────┐    ┌─────────────────┐
      │ Presence System │    │ Room Management │
      └─────────────────┘    └─────────────────┘
                            │
                            ▼
                ┌─────────────────────┐
                │ Firebase RTDB       │
                │ Room Discovery      │
                └─────────────────────┘
```

---

## Repository Structure

```text
ZeroHub
│
├── backend
│   └── zerohub_backend
│       ├── src
│       │   ├── ws_handler.erl
│       │   ├── room_manager.erl
│       │   ├── client_registry.erl
│       │   ├── simple_json.erl
│       │   └── zerohub_backend_app.erl
│       │
│       ├── rebar.config
│       └── Dockerfile
│
├── frontend
│   └── web
│       ├── index.html
│       ├── app.js
│       ├── styles.css
│       └── firebase-config.js
│
├── docs
│
└── README.md
```

---

## Running Locally

### Backend

```bash
cd backend/zerohub_backend

rebar3 compile
rebar3 shell
```

Backend starts on:

```text
ws://localhost:8080/ws
```

---

### Frontend

```bash
cd frontend/web

python3 -m http.server 8000
```

Open:

```text
http://localhost:8000
```

---

## Deployment

### Frontend

Hosted on:

- Vercel

### Backend

Hosted on:

- Render

### Database

- Firebase Realtime Database

---

## Why Erlang?

Most collaborative editors use:

```text
React + Node.js + Socket.io
```

ZeroHub instead uses:

```text
Erlang + Cowboy + Yjs + Firebase
```

to explore:

- Actor-based concurrency
- Fault-tolerant systems
- Lightweight process communication
- Scalable realtime collaboration

---

## Challenges Solved

- Realtime synchronization
- Concurrent user handling
- WebSocket room management
- Presence tracking
- Cursor sharing
- Mobile-to-desktop collaboration
- Cross-network communication
- Firebase room discovery integration

---

## Future Roadmap

- Persistent document storage
- Multi-file projects
- Project explorer
- Room permissions
- Collaborative terminal
- Syntax-aware presence
- Deployment automation

---

## Team

### Rohith Kanna GV

Backend Engineering • Erlang • WebSockets • Firebase Integration

### Team Member

Frontend Engineering • Monaco Editor • Yjs Integration • UI Development

---

## License

MIT License

---

<div align="center">

Built with Erlang, Yjs and Monaco Editor ⚡

</div>
