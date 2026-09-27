# Customer Billing & Ledger + Firebase Cloud Storage

## What this version does

The website keeps a local browser copy and, after Google sign-in, also stores the main application state in Cloud Firestore under:

`users/{YOUR_FIREBASE_AUTH_UID}/ledger/main`

The browser is not the permanent source after cloud sync.

Tracked information includes:
- Customers, purchases and customer payments
- Suppliers, stock purchases and supplier payments
- Labourers, daily labour work and labour payments
- Edit/delete changes across the ledgers
- Export/import JSON backup

## Important: Firebase setup is required once

This project cannot create a Firebase project inside your Google account automatically. You must create the project in the Firebase Console.

### 1. Create Firebase project

Open Firebase Console:
https://console.firebase.google.com/

Create a new project.

### 2. Create a Web App

Inside the project:
- Add app -> Web
- Register the web app
- Copy the Firebase configuration object.

Open `firebase-config.js` and replace the placeholders with your values.

Do NOT put a Firebase Admin SDK service-account private key into this file.

### 3. Enable Google login

Firebase Console:
Authentication -> Sign-in method -> Google -> Enable.

### 4. Create Firestore Database

Firebase Console:
Firestore Database -> Create database.

Use the production/locked approach and then deploy the supplied `firestore.rules`, or paste the contents of `firestore.rules` into the Firestore Rules tab.

The supplied rules allow each signed-in user to read/write only their own `/users/{uid}/ledger/main` document.

### 5. Authorize your website domain

For GitHub Pages, add your domain under:
Authentication -> Settings -> Authorized domains

For example:
`yourusername.github.io`

If you use Firebase Hosting, add the Firebase Hosting domain as an authorized domain too.

### 6. Run/deploy

You can keep the frontend on GitHub Pages after adding the Firebase configuration.

Or use Firebase Hosting. If using Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting firestore
firebase deploy
```

## Data migration from the old website

If you already have data in the previous localStorage version:

1. Open the old website.
2. Dashboard -> Export Backup.
3. Keep the JSON backup safe.
4. Configure Firebase in this version.
5. Sign in with the same Google account.
6. Import your backup if needed.

When signed in, each normal add/edit/delete/save operation syncs the current application snapshot to Firestore.

## Storage model note

This version stores the whole application's JSON-like state in one Firestore document for simplicity and compatibility with the existing frontend.

For a larger production deployment, the next architecture should split customers, suppliers, labour, transactions and payments into separate Firestore collections/documents.

## Firebase project linked

This package contains the Web App configuration for the `My-Business` Firebase project.

Before cloud login works, finish these settings in Firebase Console:
1. Authentication -> Sign-in method -> Google -> Enabled.
2. Firestore Database -> Rules -> publish the supplied `firestore.rules`.
3. Authentication -> Settings -> Authorized domains -> add the domain where the site will run (for example `yourusername.github.io`).

Use this package instead of the previous local-only ZIP.

## Data behavior

The app keeps a browser copy and, after Google Sign-In, syncs the main ledger state to Firestore under the signed-in user's account. A new device can load the cloud copy after signing in. If both local and cloud copies exist, the app asks which copy to keep before replacing either one.

## Run/deploy

For the Firebase-connected version, serve the site from a web origin. Do not rely on double-clicking `index.html` for final use. GitHub Pages, Firebase Hosting, or a local server such as VS Code Live Server are appropriate.

## Data model note

This is still a prototype storage model using one Firestore document per user. For a large production deployment, split customers, suppliers, labour, purchases, and payments into separate Firestore documents/collections.
