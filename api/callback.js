export default function handler(req, res) {
  console.log("Callback received:", req.body);
  res.status(200).json({ ok: true });
}
