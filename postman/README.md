# Postman Collection & Environment Setup

This directory contains ready-to-import Postman files for testing and interacting with the **IoT Controller Backend**.

## Included Files

1. **`IoT_Controller_Backend.postman_collection.json`** — Complete API collection (v2.1.0) containing:
   - **Hardware Firmware Endpoints**:
     - `Phase 1: Device Registration` (`POST /api/register`) *(automatically extracts and saves `wire_system_id` & `config_system_id`)*
     - `Phase 2: System Configuration` (`POST /api/system-config`)
     - `Phase 3: DAQ Parameter Configuration` (`POST /api/param-config`)
     - `Phase 4: Telemetry Data Upload` (`POST /api/data`)
     - `Phase 5: Relay Modules Configuration` (`POST /api/relay-config`)
   - **Management REST APIs**:
     - List / Get / Create / Update Devices
     - List / Save / Delete DAQ & Modbus Parameters
     - Get / Save Modbus RTU Relay Modules
     - Get Live Telemetry Records
     - Modbus RTU CRC16 Calculator
   - **Health Check**:
     - `Service Health Check` (`GET /health`)

2. **`IoT_Controller_Local.postman_environment.json`** — Pre-configured environment variables:
   - `base_url`: `http://localhost:8080`
   - `imei`: `865510081833552`
   - `wire_system_id`: `5E0D0000`
   - `config_system_id`: `00000D5E`

---

## How to Import into Postman

1. Open **Postman**.
2. Click the **Import** button in the top-left corner (or press `Ctrl+O` / `Cmd+O`).
3. Drag & drop or select both files:
   - `postman/IoT_Controller_Backend.postman_collection.json`
   - `postman/IoT_Controller_Local.postman_environment.json`
4. In the top-right environment selector in Postman, choose **`IoT Controller - Local`**.

---

## Recommended Testing Sequence

1. **Health Check**:
   - Send `GET /health` to verify the server is running.
2. **Phase 1: Device Registration**:
   - Send `POST /api/register`.
   - The test script will automatically capture the returned `$SysID=...#`, set `wire_system_id` and calculate the `config_system_id` into your Postman environment.
3. **Phase 2: System Configuration**:
   - Send `POST /api/system-config` to verify the controller operational intervals.
4. **Phase 3: DAQ Parameter Configuration**:
   - Send `POST /api/param-config` to verify the compact parameter strings.
5. **Phase 4: Telemetry Data Upload**:
   - Send `POST /api/data` to upload the sample telemetry hex payload and verify the `>$IST=YYYYMMDDHHmmss#` response.
6. **Phase 5: Relay Modules Configuration**:
   - Send `POST /api/relay-config` to verify MQTT and Modbus RTU relay modules.
