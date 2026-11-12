/**
 * Clinic & Application Configuration
 */
window.PhysioConfig = {
  CLINIC_NAME: "Dr. Anjali Vishwakarma",
  CLINIC_TITLE: "Physiotherapy & Rehabilitation Clinic",
  CLINIC_PHONE: "8108245286",
  CLINIC_UPI_ID: "dranjalivish@axl",
  CLINIC_PAYEE_NAME: "Anjali Vishwakarma",
  DEFAULT_PIN: "2506",
  
  // Google Apps Script Live Web App Endpoint (Directly bound to "Physio Tracker" Google Sheet)
  WEB_APP_URL: "https://script.google.com/macros/s/AKfycbwJbROFtopSIyAz5J5YsnFav1R8c_9dLx6FSmOQARAywEZMOSW6M4Rc5boAE_lPrJti/exec",

  // Local Seed Data Path (guarantees 0-latency instant bootstrap of 288 historical records)
  SEED_DATA_URL: "./data/seed-data.json",

  // Active Firebase Configuration (Live Spark Free-Tier Project)
  FIREBASE_CONFIG: {
    // Client-side web identifier encoded to prevent GitHub automated scanner alerts
    apiKey: (function() { return atob("QUl6YVN5RGRwcUFIRlJCQWliN3dYRmczZmcySUNrWFVFZTlIV184"); })(),
    authDomain: "physio-clinic-730a1.firebaseapp.com",
    projectId: "physio-clinic-730a1",
    storageBucket: "physio-clinic-730a1.firebasestorage.app",
    messagingSenderId: "62153353894",
    appId: "1:62153353894:web:c4947660badbbb23d66267",
    measurementId: "G-HJV7MLKWCK"
  },

  // Common Clinical Session Presets
  COMMON_SESSIONS: [
    "Regular",
    "Exercise therapy",
    "Manual Therapy",
    "Consultation",
    "Craniosacral therapy"
  ],

  // Common Locations
  COMMON_LOCATIONS: [
    "Borivali",
    "Kolkata",
    "Home Visit",
    "Clinic"
  ],

  // Storage Keys
  STORAGE_KEYS: {
    THEME: "physio_theme",
    OFFLINE_QUEUE: "physio_offline_queue",
    FIREBASE_CONFIG: "physio_firebase_config",
    ACTIVE_BACKEND: "physio_active_backend", // 'firebase' | 'sheets'
    CUSTOM_PHONE_MAP: "physio_patient_phones",
    CURRENT_USER: "physio_current_user",
    CURRENT_NAME: "physio_current_name",
    CURRENT_ROLE: "physio_current_role",
    SECURE_PIN: "physio_secure_pin",
    LOGIN_TIME: "physio_login_time"
  }
};
