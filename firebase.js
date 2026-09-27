import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const configured =
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.includes("PASTE_") &&
  firebaseConfig.projectId &&
  !firebaseConfig.projectId.includes("PASTE_") &&
  firebaseConfig.appId &&
  !firebaseConfig.appId.includes("PASTE_");

let app = null;
let auth = null;
let db = null;

if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

function ledgerRef(uid) {
  return doc(db, "users", uid, "ledger", "main");
}

export function isFirebaseConfigured() {
  return configured;
}

export function onUserChanged(callback) {
  if (!configured) return () => {};
  return onAuthStateChanged(auth, callback);
}

export async function finishRedirectLogin() {
  if (!configured) return null;
  try {
    return await getRedirectResult(auth);
  } catch (error) {
    console.error("Firebase redirect sign-in error:", error);
    return null;
  }
}

export async function signInGoogle() {
  if (!configured) {
    throw new Error("Firebase is not configured yet.");
  }

  const provider = new GoogleAuthProvider();

  // Redirect is more reliable on phones; popup is convenient on desktop.
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile) {
    await signInWithRedirect(auth, provider);
    return null;
  }

  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutGoogle() {
  if (!configured) return;
  await signOut(auth);
}

export async function loadCloudState(uid) {
  if (!configured) return null;

  const snap = await getDoc(ledgerRef(uid));
  if (!snap.exists()) return null;

  const data = snap.data();
  return data.state || null;
}

export async function saveCloudState(uid, state) {
  if (!configured) return;

  // Store a complete application snapshot in one document for this prototype.
  // This keeps the existing application logic simple while moving persistence
  // to the user's cloud account.
  await setDoc(
    ledgerRef(uid),
    {
      state,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}
