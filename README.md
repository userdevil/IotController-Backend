# IoT Controller — Node.js & MongoDB Backend

A high-performance backend server and web studio for industrial IoT controllers based on the Renesas RL78/G13 hardware platform.

Built with **Node.js (ESM)**, **Express**, and **MongoDB (Mongoose)**.

---

## ⚡ Features

- **Device Provisioning & Registration (`POST /api/register`)**: Device registers via `IMIENumber` and receives `$SysID=<8-char hex>#`.
- **System Configuration (`POST /api/system-config`)**: Serves operational intervals (acquisition/transmission) and backend routes.
- **DAQ Parameter Configuration (`POST /api/param-config`)**: Formats 30-character compact parameter strings with Modbus RTU hex packets into device EEPROM.
- **Telemetry Ingestion (`POST /api/data`)**: Ingests `DATA000` hex payloads containing 26-byte wire headers and IEEE-754 Little-Endian float parameters with sentinel detection (`-2222.0` = TIMEOUT, `-3333.0` = COMM_ERROR). Responds with `>$IST=YYYYMMDDHHmmss#` for RTC clock sync.
- **Relay Modules & MQTT Control (`POST /api/relay-config`)**: Configures external Modbus RTU 8-channel relay boards (0 to 16 modules) and Quectel cellular modem MQTT 3.1.1 credentials.
- **⚡ Web Configuration Studio**: Interactive dashboard served at `http://localhost:8080/` with:
  - Real-time **Modbus RTU CRC-16 (Polynomial `0xA001`)** calculator
  - Live preview of the 30-character Renesas RL78 compact wire string
  - Device management and intervals editor
  - Live telemetry monitor
- **Postman Collections**: Ready-to-import Postman Collection v2.1 and Environment in `postman/`.

---

## 🚀 Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v20 or higher
- [MongoDB](https://www.mongodb.com/) (running locally or in Docker)

### 2. Installation
```bash
git clone https://github.com/userdevil/IotController-Backend.git
cd IotController-Backend
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env` and verify your MongoDB URI:
```bash
cp .env.example .env
```
Example `.env`:
```env
PORT=8080
MONGODB_URI=mongodb://127.0.0.1:27017/iot_controller
DEFAULT_SERVER_ADD=localhost
DEFAULT_SERVER_PORT=8080
DEFAULT_SERVER_PATH=/
```

### 4. Database Schema Initialization
Run database initialization to create the required collections and indexes:
```bash
npm run db:init
```

### 5. Start Server
```bash
# Production mode
npm start

# Development mode (live reload with nodemon)
npm run dev
```

The server will listen at `http://localhost:8080`.
Open `http://localhost:8080` in your browser to access the Web Studio.

---

## 🧪 Testing

Run the automated test suite (unit tests for binary codecs, Modbus CRC16, and HTTP endpoints):
```bash
npm test
```

---

## 📡 API Endpoints Summary

### Firmware Endpoints

| Endpoint | Method | Content-Type | Description |
|---|---|---|---|
| `/api/register` | `POST` | `application/x-www-form-urlencoded` | Device registration (`IMIENumber`) $\to$ `$SysID=5E0D0000#` |
| `/api/system-config` | `POST` | `application/json` | Operational intervals & endpoints (`SERVER_DETAILS`) |
| `/api/param-config` | `POST` | `application/json` | DAQ parameter download (`PARA_CONFIG`) |
| `/api/data` | `POST` | `application/x-www-form-urlencoded` | Telemetry upload (`DATA000`) $\to$ `Packet Inserted >$IST=...#` |
| `/api/relay-config` | `POST` | `application/json` | External relay modules & MQTT config (`RELAY_MODULE_CONFIG`) |

### Management REST APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/manage/devices` | `GET` / `POST` | List or create/update devices |
| `/api/manage/devices/:systemId` | `GET` | Get single device details |
| `/api/manage/devices/:systemId/parameters` | `GET` / `POST` | List or save DAQ & Modbus parameters |
| `/api/manage/devices/:systemId/parameters/:idx` | `DELETE` | Delete a parameter |
| `/api/manage/devices/:systemId/relays` | `GET` / `POST` | List or replace relay modules |
| `/api/manage/devices/:systemId/telemetry` | `GET` | Query latest telemetry records and values |
| `/api/manage/modbus/crc` | `POST` | Calculate Modbus RTU frame & CRC16 |
| `/health` | `GET` | Backend health check |

---

## 📬 Postman Setup

Directly importable files are in the `postman/` directory:
1. `postman/IoT_Controller_Backend.postman_collection.json`
2. `postman/IoT_Controller_Local.postman_environment.json`

See [`postman/README.md`](postman/README.md) for step-by-step instructions.

---

## 📄 License
ISC
