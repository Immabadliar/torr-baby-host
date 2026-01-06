async function getCurrentUser() {
  const res = await fetch("/api/user");

  if (!res.ok) {
    window.location.href = "/login";
    return null;
  }

  return await res.json();
}

async function getStatus(userId) {
  const res = await fetch(`/api/status/${userId}`);

  if (!res.ok) {
    return { status: "offline" };
  }

  return await res.json();
}

function statusClass(status) {
  if (!status) return "offline";

  const normalized = status.toLowerCase();

  if (normalized === "online") return "online";
  if (normalized === "idle") return "idle";
  if (normalized === "dnd" || normalized === "do_not_disturb") return "dnd";

  return "offline";
}

async function init() {
  const user = await getCurrentUser();
  if (!user) return;

  const usernameEl = document.getElementById("username");
  const avatarEl = document.getElementById("avatar");
  const dotEl = document.getElementById("statusDot");

  if (!usernameEl || !avatarEl || !dotEl) return;

  usernameEl.textContent = `${user.username}#${user.discriminator}`;
  avatarEl.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;

  const statusData = await getStatus(user.id);
  console.log("Raw status received:", statusData.status);

  dotEl.className = "status-dot " + statusClass(statusData.status);
}

init();
