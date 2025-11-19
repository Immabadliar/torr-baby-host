export default async function handler(req, res) {
  if (req.method !== "POST") 
    return res.status(405).json({ error: "Method not allowed" });

  global.userStatusStore = global.userStatusStore || {};

  const { userId, status } = req.body;

  if (!userId || !status) 
    return res.status(400).json({ error: "Missing fields" });

  global.userStatusStore[userId] = {
    status,
    updated: Date.now()
  };

  return res.status(200).json({ success: true });
}
