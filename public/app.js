const state = {
  view: "library",
  u: localStorage.getItem("relief.u") || "",
  p: localStorage.getItem("relief.p") || "",
  albums: [],
  album: null,
  songs: [],
  queue: [],
  index: 0,
  error: "",
};

const $ = (id) => document.getElementById(id);

function authQuery() {
  const q = new URLSearchParams({ u: state.u, p: state.p, v: "1.16.1", c: "ReliefWeb", f: "json" });
  return q.toString();
}

async function rest(method, extra = {}) {
  const q = new URLSearchParams({ u: state.u, p: state.p, v: "1.16.1", c: "ReliefWeb", f: "json", ...extra });
  const res = await fetch(`/rest/${method}.view?${q}`);
  const data = await res.json();
  const body = data["subsonic-response"];
  if (!body || body.status !== "ok") throw new Error(body?.error?.message || "Request failed");
  return body;
}

function streamUrl(id) {
  return `/rest/stream.view?id=${encodeURIComponent(id)}&${authQuery()}`;
}
function coverUrl(id) {
  return `/rest/getCoverArt.view?id=${encodeURIComponent(id)}&${authQuery()}`;
}

function render() {
  $("who").textContent = state.u ? state.u : "Sign in";
  for (const b of document.querySelectorAll(".nav button")) {
    b.classList.toggle("active", b.dataset.view === state.view);
  }
  const main = $("main");
  if (!state.u && state.view !== "login") {
    state.view = "login";
  }
  if (state.view === "login") {
    main.innerHTML = `<section class="panel"><h1>Relief</h1><p class="muted">Sign in with a Subsonic user. Same credentials Tempus uses.</p>
      <label class="field"><span>Username</span><input id="u" value="${state.u}" autocomplete="username"></label>
      <label class="field"><span>Password</span><input id="pw" type="password" autocomplete="current-password"></label>
      <button class="primary" id="signin">Enter</button>
      <p class="err" id="err">${state.error}</p></section>`;
    $("signin").onclick = async () => {
      state.u = $("u").value.trim();
      state.p = $("pw").value;
      try {
        await rest("ping");
        localStorage.setItem("relief.u", state.u);
        localStorage.setItem("relief.p", state.p);
        state.view = "library";
        state.error = "";
        await loadAlbums();
      } catch (e) {
        state.error = e.message;
        render();
      }
    };
    return;
  }
  if (state.view === "signup") {
    window.location.href = "/signup.html";
  }
  if (state.view === "library") {
    main.innerHTML = `<h1>Library</h1><div class="grid" id="albums"></div>`;
    const g = $("albums");
    if (!state.albums.length) {
      g.innerHTML = `<p class="muted">No albums yet. Upload FLAC or MP3 from the Upload tab.</p>`;
    }
    for (const a of state.albums) {
      const b = document.createElement("button");
      b.className = "card";
      b.innerHTML = `<img alt="" src="${coverUrl(a.id)}"><div class="t">${a.name}</div><div class="s">${a.artist || ""}</div>`;
      b.onclick = () => openAlbum(a.id);
      g.appendChild(b);
    }
    return;
  }
  if (state.view === "album" && state.album) {
    main.innerHTML = `<button class="ghost" id="back">Library</button>
      <h1>${state.album.name}</h1><p class="muted">${state.album.artist || ""}</p>
      <div class="list" id="songs"></div>`;
    $("back").onclick = () => { state.view = "library"; render(); };
    const list = $("songs");
    (state.songs || []).forEach((s, i) => {
      const row = document.createElement("button");
      row.className = "row";
      row.innerHTML = `<span class="muted">${s.track || i + 1}</span><span>${s.title}</span><span class="muted">${fmtTime(s.duration)}</span>`;
      row.onclick = () => playQueue(state.songs, i);
      list.appendChild(row);
    });
    return;
  }
  if (state.view === "upload") {
    main.innerHTML = `<section class="panel"><h1>Upload</h1><p class="muted">FLAC or MP3, 100 MB max. Tags are read from the file.</p>
      <label class="field"><span>File</span><input id="file" type="file" accept=".flac,.mp3,audio/flac,audio/mpeg"></label>
      <button class="primary" id="send">Ingest</button>
      <p class="muted" id="upstatus"></p></section>`;
    $("send").onclick = async () => {
      const file = $("file").files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      $("upstatus").textContent = "Uploading…";
      const res = await fetch(`/api/ingest?${authQuery()}`, { method: "POST", body: fd });
      const data = await res.json();
      $("upstatus").textContent = data.ok ? "In library." : data.error || "Failed";
      if (data.ok) await loadAlbums();
    };
    return;
  }
  if (state.view === "setup") {
    main.innerHTML = `<section class="panel"><h1>First-run setup</h1>
      <p class="muted">Creates the two Subsonic/Navidrome users. Needs the Worker secret SETUP_SECRET. Only works once.</p>
      <label class="field"><span>SETUP_SECRET</span><input id="setup-secret" type="password" autocomplete="off"></label>
      <label class="field"><span>Admin username</span><input id="u1" autocomplete="username"></label>
      <label class="field"><span>Admin password</span><input id="p1" type="password"></label>
      <label class="field"><span>Second username (optional)</span><input id="u2"></label>
      <label class="field"><span>Second password</span><input id="p2" type="password"></label>
      <button class="primary" id="do-setup">Create users</button>
      <p class="err" id="setup-err"></p>
      <p class="muted" id="setup-ok"></p></section>`;
    $("do-setup").onclick = async () => {
      const users = [{ username: $("u1").value.trim(), password: $("p1").value, admin: true }];
      if ($("u2").value.trim()) users.push({ username: $("u2").value.trim(), password: $("p2").value });
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setupSecret: $("setup-secret").value, users }),
      });
      const data = await res.json();
      if (!data.ok) {
        $("setup-err").textContent = data.error || "Setup failed";
        $("setup-ok").textContent = "";
        return;
      }
      $("setup-err").textContent = "";
      $("setup-ok").textContent = "Users created. Sign in here and in Tempus / Feishin / DSub with those passwords. Save apiKey from the network response if you use key auth.";
      if (data.users?.[0]) {
        state.u = data.users[0].username;
        state.p = $("p1").value;
        localStorage.setItem("relief.u", state.u);
        localStorage.setItem("relief.p", state.p);
      }
    };
  }
}

async function loadAlbums() {
  const body = await rest("getAlbumList2", { type: "newest", size: "200" });
  state.albums = body.albumList2?.album || [];
  if (!Array.isArray(state.albums)) state.albums = state.albums ? [state.albums] : [];
  render();
}

async function openAlbum(id) {
  const body = await rest("getAlbum", { id });
  state.album = body.album;
  let songs = body.album?.song || [];
  if (!Array.isArray(songs)) songs = songs ? [songs] : [];
  state.songs = songs;
  state.view = "album";
  render();
}

function playQueue(songs, index) {
  state.queue = songs;
  state.index = index;
  const audio = $("audio");
  const s = songs[index];
  audio.src = streamUrl(s.id);
  audio.play();
  $("now-title").textContent = s.title;
  $("now-artist").textContent = s.artist || "";
  $("now-cover").src = coverUrl(s.coverArt || s.albumId || s.id);
}

function fmtTime(sec) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

$("nav-library").onclick = () => { state.view = "library"; render(); };
$("nav-upload").onclick = () => { state.view = "upload"; render(); };
$("nav-signup").onclick = () => { window.location.href = "/signup.html"; };
$("who").onclick = () => { state.view = "login"; render(); };
$("audio").addEventListener("ended", () => {
  if (state.index < state.queue.length - 1) playQueue(state.queue, state.index + 1);
});
$("audio").addEventListener("timeupdate", () => {
  const a = $("audio");
  if (a.duration) $("seek").value = String((a.currentTime / a.duration) * 1000);
});
$("seek").addEventListener("input", () => {
  const a = $("audio");
  if (a.duration) a.currentTime = (Number($("seek").value) / 1000) * a.duration;
});
$("prev").onclick = () => { if (state.index > 0) playQueue(state.queue, state.index - 1); };
$("next").onclick = () => { if (state.index < state.queue.length - 1) playQueue(state.queue, state.index + 1); };
$("play").onclick = () => {
  const a = $("audio");
  if (a.paused) a.play();
  else a.pause();
};

if (state.u && state.p) {
  rest("ping").then(loadAlbums).catch(() => { state.view = "login"; render(); });
} else {
  render();
}
