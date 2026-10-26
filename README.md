# Trainee Hostel Management System — Production MongoDB Atlas Integration

A full-stack Trainee Hostel Management System with a **React 18 + Vite** frontend and an **Express.js + Mongoose 8** backend integrated with **MongoDB Atlas**.

---

## 1. Architecture Overview

```
trainee-hostel-react/
├── backend/
│   ├── config/
│   │   └── db.js               # MongoDB Atlas connection pooling, credential masking & events
│   ├── middleware/
│   │   └── auth.js             # Bearer JWT verification, Super Admin guard & Reports role guard
│   ├── models/
│   │   ├── User.js             # Staff users (username, passwordHash, unique email & mobile)
│   │   ├── Role.js             # Roles & page permissions matrix
│   │   ├── Config.js           # Singleton branding, themes & dynamic custom fields
│   │   ├── Hostel.js           # Hostels and room bed capacities
│   │   ├── Trainee.js          # Master trainee profiles & QR identifiers
│   │   ├── Attendance.js       # Daily shift attendance records (unique compound index)
│   │   ├── Leave.js            # Leave requests and approval tracking
│   │   ├── OutingVacate.js     # Outing, temporary vacate, and permanent vacate records
│   │   ├── Resignation.js      # Resignation and exit logs
│   │   ├── Remark.js           # Complaints and conduct remarks
│   │   ├── RoomHistory.js      # Room allocation audit trail
│   │   ├── DailySummary.js     # Shift headcounts by date
│   │   ├── Meta.js             # Revision counter for optimistic multi-client sync
│   │   └── Otp.js              # Password recovery OTP codes (MongoDB TTL index)
│   ├── routes/
│   │   ├── auth.js             # Login, password change, OTP send & verification
│   │   ├── publicRoutes.js     # Unauthenticated public config and trainee QR registration
│   │   ├── users.js            # Super Admin staff user CRUD with email/mobile validation
│   │   ├── state.js            # Multi-device state polling & natural-key bulkWrite upserts
│   │   └── reports.js          # Server-authorized reports API (blocks unauthorized roles)
│   ├── utils/
│   │   ├── dates.js            # Date formatting and prefixed ID generators (HST-xxxx, QR-xxxxx)
│   │   └── summary.js          # Living days, working days, and headcount business rules
│   ├── defaults.js             # Default configuration and role definitions
│   ├── seed.js                 # Initial database seeder
│   ├── create-admin.js         # Super Admin CLI generation & password reset script
│   ├── server.js               # Express application entry point with graceful shutdown
│   ├── verify.js               # 14-step automated API verification test suite
│   ├── .env.example            # Environment variables template
│   └── package.json
│
├── frontend/
│   ├── src/                    # React components, custom theme engine & store
│   ├── index.html
│   ├── vite.config.js          # Reverse proxy for /api -> http://localhost:5000
│   ├── .env.example
│   └── package.json
│
├── .gitignore                  # Prevents secrets (.env) and node_modules from being tracked
└── README.md
```

---

## 2. Step-by-Step MongoDB Atlas Setup Guide

Follow these steps to create your production cloud database on MongoDB Atlas:

### Step 1: Create a MongoDB Atlas Account & Cluster
1. Navigate to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and register or sign in.
2. Click **Create** or **Build a Database**.
3. Select the **M0 Free Tier** (Shared), pick your preferred cloud provider (AWS, GCP, or Azure), and select the closest region to your users.
4. Name your cluster (e.g., `Cluster0`) and click **Create Deployment**.

### Step 2: Create a Database User
1. In the **Security** menu on the left sidebar, click **Database Access**.
2. Click **Add New Database User**.
3. Choose **Password** authentication.
4. Enter a username (e.g. `hostel_admin`).
5. Set or autogenerate a secure password (avoid special characters like `@`, `/`, or `:` inside the password string to prevent URI encoding issues, or URL-encode them).
6. Under **Database User Privileges**, select **Read and write to any database** (or assign built-in role `readWrite@trainee-hostel`).
7. Click **Add User**.

### Step 3: Configure Network Access (IP Allowlist)
1. In the left sidebar, click **Network Access**.
2. Click **Add IP Address**.
3. For development or cloud deployments (Render, Railway, Vercel), click **Allow Access from Anywhere** (`0.0.0.0/0`) or specify your static server IP address.
4. Click **Confirm**.

### Step 4: Obtain Connection String
1. Return to the **Database Deployments** page and click **Connect**.
2. Select **Drivers** (Node.js).
3. Copy the SRV connection string:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Append your database name `trainee-hostel` before the query parameter:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxxx.mongodb.net/trainee-hostel?retryWrites=true&w=majority
   ```

---

## 3. Environment Configuration

### Backend (`backend/.env`)

Create a `.env` file inside the `backend/` directory by copying `.env.example`:

```bash
cd backend
cp .env.example .env
```

Configure the environment variables:

```env
# MongoDB Atlas Connection String (reads MONGODB_URI or MONGO_URI)
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.xxxxxx.mongodb.net/trainee-hostel?retryWrites=true&w=majority

# JWT Authentication Secret Key (use a strong random 32+ character string in production)
JWT_SECRET=super_secure_random_jwt_secret_key_2026

# Server Port
PORT=5000

# Client Application URL (for CORS)
CLIENT_ORIGIN=http://localhost:5173
```

> **Security Note**: Never commit `.env` files to Git. The project contains root and folder `.gitignore` files ensuring `.env` files and credentials are never tracked.

---

## 4. Default Credentials

The initial seed automatically sets up the following accounts with registered contacts:

| Role | Username | Password | Email | Mobile | Permissions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | `superadmin` | `superadmin123` | `superadmin@hostel.com` | `9876543210` | Full administrative control + Admin Console + Reports |
| **Warden** | `warden` | `warden123` | `warden@hostel.com` | `9876543211` | Operational modules (Attendance, Leave, Outing, Remarks). **Reports access denied.** |
| **Admin** *(Backup)* | `admin` | `admin123` | `admin@hostel.com` | `9876543212` | Backup Super Admin |

---

## 5. Quick Start (Development)

### Terminal 1: Backend
```bash
cd backend
npm install
npm run dev
```
*Backend will connect to MongoDB Atlas (or automatic embedded MongoDB fallback if offline) and start on `http://localhost:5000`.*

### Terminal 2: Frontend
```bash
cd frontend
npm install
npm run dev
```
*Frontend will compile and start on `http://localhost:5173` with reverse proxy to backend port 5000.*

---

## 6. Complete REST API Reference

### Authentication & Password Management
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/login` | Public (Rate-limited) | Authenticates username & password; returns 7-day Bearer JWT and user profile. |
| `POST` | `/api/me/password` | Authenticated | Updates the logged-in user's password using bcrypt verification. |
| `POST` | `/api/auth/forgot-password/send-otp` | Public (Rate-limited) | Sends a 6-digit OTP code to the user's registered Email or Mobile. |
| `POST` | `/api/auth/forgot-password/verify-otp` | Public (Rate-limited) | Verifies the OTP code and resets the user's password. |

### System State & Multi-Client Sync
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/rev` | Public | Returns current database revision counter `{ rev }`. Polled every 6s by clients. |
| `GET` | `/api/state` | Authenticated | Returns full application database state. Super Admin receives user list; Warden receives empty users array. |
| `PUT` | `/api/state` | Authenticated | Non-destructive `bulkWrite` upsert by natural keys (`traineeId`, `id`, `date`). Preserves rows added from other devices. |

### Staff Management
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/users` | Super Admin Only | Creates, edits, or deletes staff users. Enforces mandatory and unique Email / Mobile numbers. |

### Reports (Server-Side Enforced)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/reports` | Super Admin Only (Blocked for Warden) | Aggregates and returns report summaries. **Returns `403 Forbidden` if called by Warden.** |

### Public & Registration
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/public` | Public | Returns public theme, logo, and app branding for the login and self-registration screens. |
| `POST` | `/api/public/register` | Public (Rate-limited) | Self-registration endpoint creating a Trainee in `PENDING REVIEW` status with auto-generated `HST-xxxx` and `QR-xxxxx`. |
| `GET` | `/api/health` | Public | Health check endpoint returning server status, uptime, and timestamp. |

---

## 7. Role-Based Access Control & Security Matrix

### Server-Side Enforcement (Defense in Depth)

1. **Warden Reports Restriction**:
   - The `requireReports` middleware in `backend/middleware/auth.js` strictly inspects the incoming Bearer JWT.
   - If `user.roleId === 'warden'`, the server immediately rejects the request with HTTP **403 Forbidden** and the message:
     ```json
     { "error": "Access denied: Warden role is not authorized to access Reports." }
     ```
   - This restriction applies to direct URLs, manipulated client-side requests, and curl/Postman API calls.
2. **Super Admin Member Management**:
   - `POST /api/users` requires `requireSuper` middleware. Unauthorized roles receive **403 Forbidden**.
3. **Password Security**:
   - All passwords are encrypted with `bcrypt` (10 salt rounds). Plaintext passwords are never stored.
   - Password hashes are completely excluded from all API responses (`{ passwordHash: 0 }`).
4. **Credential Masking in Logs**:
   - The connection string sanitizer in `backend/config/db.js` strips username and password before logging to standard output.
5. **Rate Limiting & Headers**:
   - `helmet` applies security headers.
   - `express-rate-limit` prevents brute-force login attempts and spam registrations.

---

## 8. Automated Testing & Verification

The project includes an automated 14-step integration test suite (`backend/verify.js`):

```bash
cd backend
npm test
```

### Test Coverage Checklist:
- [x] **1.** Super Admin login (`superadmin` / `superadmin123`) & JWT generation.
- [x] **2.** Warden login (`warden` / `warden123`) & JWT generation.
- [x] **3.** Database revision tracking (`GET /api/rev`).
- [x] **4.** State data isolation (`GET /api/state` returns user list for Super Admin, empty array for Warden).
- [x] **5.** Public configuration retrieval (`GET /api/public`).
- [x] **6.** Trainee self-registration (`POST /api/public/register`) & duplicate prevention (409 Conflict).
- [x] **7.** Stale state update test: confirms registered trainees are not lost during client-side syncing.
- [x] **8.** Staff endpoint permission check (Warden calling `POST /api/users` blocked with 403 Forbidden).
- [x] **9.** Configuration tampering check (Warden cannot change app configuration).
- [x] **10.** Super Admin configuration update verification.
- [x] **11.** Password change verification (`POST /api/me/password`).
- [x] **12.** Staff member contact validation: blocks creation without Email/Mobile (400), blocks duplicate Email (409), blocks duplicate Mobile (409).
- [x] **13.** Forgot Password OTP verification: generates code, verifies 6-digit OTP, updates password, confirms login with new credentials.
- [x] **14.** **Server-Side Reports Authorization Guard**:
  - Unauthenticated request -> **401 Unauthorized**.
  - Super Admin request -> **200 OK** with complete report rows.
  - Warden request -> **403 Forbidden** (*"Access denied: Warden role is not authorized to access Reports."*).

---

## 9. Production Deployment Guide

### Option A: Monolithic Single-Server (Render, Railway, VPS)
In this mode, Express serves both the REST API and the compiled React SPA from `../frontend/dist`:

1. Build the frontend:
   ```bash
   cd frontend
   npm install
   npm run build
   ```
2. Start the backend:
   ```bash
   cd ../backend
   npm install --omit=dev
   npm start
   ```
3. Set environment variables on your host:
   - `NODE_ENV=production`
   - `MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxxxx.mongodb.net/trainee-hostel?retryWrites=true&w=majority`
   - `JWT_SECRET=<strong-random-key>`
   - `PORT=5000`

### Option B: Decoupled Deployment (Vercel Frontend + Render Backend)
1. **Backend**:
   - Deploy `backend/` to Render/Railway as a Web Service.
   - Add environment variables `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN=https://your-frontend.vercel.app`.
2. **Frontend**:
   - Deploy `frontend/` to Vercel/Netlify.
   - Set environment variable `VITE_API_URL=https://your-backend.onrender.com` in your Vercel project settings.

---

## 10. Database Backup & Production Recommendations

1. **Automated Cloud Backups**:
   - Enable MongoDB Atlas automated daily snapshots in the **Backup** tab of your Atlas cluster.
2. **Point-In-Time Restore (PITR)**:
   - For critical production workloads, enable PITR on Atlas (M10+ tier) to restore the database to any specific minute.
3. **Dedicated Database User**:
   - Create a dedicated application user with restricted privileges (`readWrite@trainee-hostel`) rather than an administrative Atlas user.
4. **Network Whitelisting**:
   - If hosting on a VPS or cloud service with static IPs, restrict Network Access to those specific IP addresses instead of `0.0.0.0/0`.
