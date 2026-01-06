require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  Routes,
  REST
} = require("discord.js");

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || "https://torr.baby/api/callback";
const BOT_TOKEN = process.env.BOT_TOKEN;

// Debug: Log OAuth config on startup
console.log("=== OAUTH CONFIG ===");
console.log("CLIENT_ID:", CLIENT_ID);
console.log("CLIENT_SECRET:", CLIENT_SECRET ? "SET" : "NOT SET");
console.log("REDIRECT_URI:", REDIRECT_URI);
console.log("BOT_TOKEN:", BOT_TOKEN ? "SET" : "NOT SET");
console.log("===================");

// --- Express Middlewares ---
app.use(
  session({
    secret: process.env.SESSION_SECRET || "super_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static files from html and css folders
app.use(express.static(path.join(__dirname, "html")));
app.use("/css", express.static(path.join(__dirname, "css")));

// --- Routes ---

// Home
app.get("/", (req, res) => {
  if (req.session.user) {
    res.sendFile(path.join(__dirname, "html", "dashboard.html"));
  } else {
    res.redirect("/login");
  }
});

// Login - redirects to Discord OAuth2
app.get("/login", (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&scope=identify`;

  console.log("Discord login URL:", url);
  res.redirect(url);
});

// OAuth2 callback
app.get("/api/callback", async (req, res) => {
  const code = req.query.code;
  console.log("=== CALLBACK DEBUG ===");
  console.log("Code received:", code ? "YES" : "NO");
  
  if (!code) return res.send("No code provided.");

  try {
    console.log("Exchanging code for token...");
    const tokenResponse = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        scope: "identify"
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const access_token = tokenResponse.data.access_token;
    console.log("Token received:", access_token ? "YES" : "NO");

    console.log("Fetching user data...");
    const userResponse = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    console.log("User data:", userResponse.data);
    req.session.user = userResponse.data;
    
    console.log("Session user set:", req.session.user);
    console.log("Redirecting to /");
    console.log("===================");
    
    res.redirect("/");
  } catch (err) {
    console.error("=== ERROR ===");
    console.error(err.response?.data || err.message);
    console.error("=============");
    res.send("Error logging in with Discord.");
  }
});

// Get current logged-in user (for frontend)
app.get("/api/user", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }
  res.json(req.session.user);
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// Status update endpoint (for bot)
app.post("/api/status", (req, res) => {
  const { userId, status } = req.body;
  console.log(`Status update: ${userId} → ${status}`);
  // Add your status storage logic here (database, etc.)
  res.json({ success: true });
});

// --- Start Express Server ---
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// --- Discord Bot Setup ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.User, Partials.GuildMember]
});

const activeTickets = new Map();

// Bot ready
client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Initialize user statuses
  for (const guild of client.guilds.cache.values()) {
    const members = await guild.members.fetch({ withPresences: true });
    members.forEach((member) => {
      const status = member.presence?.status || "offline";
      axios.post("https://torr.baby/api/status", {
        userId: member.id,
        status
      }).catch(() => {});
    });
  }

  // Register slash commands
  const commands = [
    { name: "modmail", description: "Open a modmail ticket" },
    { name: "close", description: "Close a ticket" }
  ];

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log("Commands registered.");
});

// Update statuses on presence change
client.on("presenceUpdate", (oldP, newP) => {
  if (!newP || !newP.user) return;
  const status = newP.status || "offline";
  axios.post("https://torr.baby/api/status", {
    userId: newP.user.id,
    status
  }).catch(() => {});
  console.log(`${newP.user.tag} → ${status}`);
});

// Modmail ticket system
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "modmail") {
    if (activeTickets.has(interaction.user.id))
      return interaction.reply({ content: "You already have an open ticket.", ephemeral: true });

    const guild = interaction.guild;
    const adminRole = guild.roles.cache.find(r =>
      r.permissions.has(PermissionsBitField.Flags.Administrator)
    );

    if (!adminRole)
      return interaction.reply({ content: "No admin role found.", ephemeral: true });

    const channel = await guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        },
        {
          id: adminRole.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages
          ]
        },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages
          ]
        }
      ]
    });

    activeTickets.set(interaction.user.id, channel.id);
    await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
    await channel.send(`${interaction.user} created a ticket.`);
  }

  if (interaction.commandName === "close") {
    const userTicket = activeTickets.get(interaction.user.id);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
    let channelToClose = null;

    if (userTicket && interaction.channel.id === userTicket)
      channelToClose = interaction.channel;
    else if (isAdmin && interaction.channel.name.startsWith("ticket-"))
      channelToClose = interaction.channel;

    if (!channelToClose)
      return interaction.reply({ content: "You cannot close this ticket.", ephemeral: true });

    activeTickets.delete(interaction.user.id);
    await interaction.reply("Closing ticket...");
    setTimeout(() => channelToClose.delete().catch(() => {}), 3000);
  }
});

// Login bot
client.login(BOT_TOKEN);