const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (error) {
    console.error("Erro Firebase:", error);
  }
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const snapshot = await db.collection('predictions').orderBy('createdAt', 'desc').limit(50).get();
    const predictions = [];
    snapshot.forEach(doc => {
      predictions.push({ id: doc.id, ...doc.data() });
    });
    return res.status(200).json({ success: true, predictions });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
