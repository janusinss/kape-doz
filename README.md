# KAPE DOZ (Café Dos) Point-of-Sale & Café Management System

Kape Doz is an offline-first, multi-role café management and Point-of-Sale (POS) system engineered for high-throughput specialty coffee shops. It pairs a resilient local Hub server with a high-performance Flutter staff mobile/tablet app and a React + Vite administrative portal.

---

## Architecture Overview

```
kape-doz/
├── admin/               # React 19 + TypeScript + Vite + Tailwind CSS Admin Portal
├── mobile/              # Flutter (Android / iOS / Web) Staff App (Cashier, Barista, Sign-in)
├── services/            # Node.js + Express + TypeScript Local Hub Server (SQLite, WebSockets)
├── contracts/           # Shared TypeScript interfaces, contracts, and schema definitions
├── artifacts/           # Pre-built releases, including the latest Android debug APK
├── docs/                # Architecture records, API specifications, and flow guides
├── wireframes/          # High-fidelity UI layouts, diagrams, and design variations
├── WIREFRAME + FLOW/    # Original handoff specifications, user flows, and acceptance criteria
├── DESIGN.md            # Design system tokens, color palettes, and component guidelines
├── PRODUCT.md           # Product requirements, operational workflows, and feature matrix
└── BACKEND_ARCHITECTURE.md # Backend persistence, replication, and offline recovery architecture
```

---

## Core Components

### 1. Staff Mobile & Tablet App (`mobile/`)
- **Cashier Register**: Rapid order builder, modifier customization, split tenders, offline order queues.
- **Barista Station**: Real-time drink ticket dispatch, prep timers, bump bar workflow.
- **Waste & Dial-in**: Daily espresso calibration logs, grinder adjustment tracking, discarded batch logs.
- **Sign-in & Pairing**: Split layout with barista hero showcase, quick PIN access, and dynamic pairing codes.
- **Distribution**: Pre-compiled debug APK available at [`artifacts/KAPE-DOZ-Staff-Sign-In-debug.apk`](artifacts/KAPE-DOZ-Staff-Sign-In-debug.apk).

### 2. Admin Management Portal (`admin/`)
- **Dashboard & Sales**: Revenue velocity, category breakdown, ingredient margin analysis.
- **Inventory & Recipes**: Bill of Materials (BOM) cost calculations, stock alerts, unit conversions.
- **CRM & Customers**: Customer purchase history, loyalty rewards, store credits.
- **Device Management**: Local Hub discovery, printer pairing, shift review, and manager overrides.
- **Authentication**: High-converting split sign-in experience with visual coffee hero, remember-me support, and hub connectivity alerts.

### 3. Local Hub Service (`services/`)
- **Offline-First Sync**: Local SQLite database with transactional integrity and auto-recovery.
- **Real-Time Broadcasts**: WebSockets for order ticket progression between Cashier and Barista stations.
- **Pairing Engine**: Secure, rotating 8-character pairing codes for staff devices.

---

## Quickstart

### Prerequisites
- Node.js 18+ & npm
- Flutter SDK 3.24+ with Android SDK (for mobile development)

### 1. Start the Local Hub Service
```bash
cd services
npm install
npm run dev
# Running on http://127.0.0.1:4000
```

### 2. Start the Admin Portal
```bash
cd admin
npm install
npm run dev
# Running on http://127.0.0.1:5173
```
- **Default Credentials**: `admin` / `admin123`

### 3. Run the Staff Mobile App
```bash
cd mobile
flutter pub get
flutter run -d chrome     # Run in browser
# OR
flutter run -d <android-device>
```

---

## Releases & APK Artifacts

The latest compiled staff Android package is committed and tracked in the repository:
- **Location**: [`artifacts/KAPE-DOZ-Staff-Sign-In-debug.apk`](artifacts/KAPE-DOZ-Staff-Sign-In-debug.apk)
- **Target Platform**: Android (API 21+)
- **Features**: Complete staff sign-in redesign, cashier workflow, barista station, waste logging, and offline synchronization.
