import { credentialsReady, hrFromJob, jobKeywords, mailErrors } from "./mail.js";

const state = {
  mail: { from: "", to: "", appPassword: "", job: "", resume: "" },
  mailEdit: false,
  mailNotice: null,
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("jobes", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(key) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction("kv", "readonly").objectStore("kv").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function idbSet(key, value) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function toast(message, duration = 2800) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), duration);
}

function mailMatchText() {
  const to = hrFromJob(state.mail.job, state.mail.from);
  const words = jobKeywords(state.mail.job);
  if (!String(state.mail.job || "").trim()) return "Paste a job description. The HR address in it is who receives the resume.";
  if (!to) return "No HR email in that job description yet.";
  return `HR: ${to}. Keywords added to the resume: ${words.length ? words.join(", ") : "none found"}.`;
}

function showMailSent(mail) {
  state.mailNotice = { ok: true, to: mail.to.trim(), from: mail.from.trim() };
  const message = `Resume PDF sent to ${state.mailNotice.to} from ${state.mailNotice.from}.`;
  toast(message, 6000);
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try { new Notification("Mail sent", { body: message }); } catch { /* the banner still shows */ }
  }
  render();
}

function render() {
  const mail = state.mail;
  const saved = credentialsReady(mail) && !state.mailEdit;
  const sent = state.mailNotice?.ok ? `Resume PDF sent to ${esc(state.mailNotice.to)} from ${esc(state.mailNotice.from)}.` : "";
  document.getElementById("view").innerHTML = `<section>
    <p class="note">jobes.ai</p>
    <h1>Send resume to HR</h1>
    <p class="note">Save your email and app password once, with your latest resume. After that, paste a job description. jobes.ai adds the role's keywords to the resume, makes a PDF, and sends it to the HR address in that description.</p>
    <p class="note sent" data-mail-notice ${sent ? "" : "hidden"}>${sent}</p>
    <form id="hr-mail">
      ${saved ? `<p class="note">Using ${esc(mail.from)}. The resume is saved.</p>
        <div class="actions"><button class="ghost" type="button" data-act="edit-mail">Change email or resume</button></div>` : `<label>Your email (From)
          <input data-mail="from" type="email" autocomplete="email" value="${esc(mail.from)}" placeholder="you@gmail.com" required>
        </label>
        <label>App password
          <input data-mail="appPassword" type="password" autocomplete="off" value="${esc(mail.appPassword)}" placeholder="16-character app password" required>
        </label>
        <label>Latest resume
          <textarea data-mail="resume" placeholder="Paste your resume. A new upload replaces it." required>${esc(mail.resume)}</textarea>
        </label>
        <div class="actions">
          <button class="ghost" type="button" data-act="resume-file">Upload resume text</button>
          <button class="ghost" type="button" data-act="save-mail">Save once</button>
        </div>`}
      <label>Job description
        <textarea data-mail="job" placeholder="Paste the job description, including the HR email." required>${esc(mail.job)}</textarea>
      </label>
      <p class="note" data-job-match>${esc(mailMatchText())}</p>
      <div class="actions"><button class="solid" type="submit">Send PDF resume</button></div>
    </form>
    <p class="note">Use an app password from Gmail, Outlook, Yahoo, or iCloud, not your normal login password. It stays in this browser. On this computer, run <code>node server/mail.mjs</code> and leave that window open before you send.</p>
  </section>`;
}

async function saveMailOnce() {
  if (!credentialsReady(state.mail)) {
    toast("Add your email, app password, and resume.");
    return;
  }
  await idbSet("mail", { ...state.mail, to: "" });
  state.mailEdit = false;
  toast("Saved. Next time, paste a job description.");
  render();
}

async function sendHrMail(event) {
  event.preventDefault();
  const mail = state.mail;
  const errors = mailErrors(mail);
  mail.to = hrFromJob(mail.job, mail.from);
  if (errors.length) {
    toast(errors.includes("to")
      ? "The job description needs an HR email address."
      : "Save your email, app password, and resume once, then paste a job description.");
    state.mailEdit = !credentialsReady(mail);
    render();
    return;
  }
  await idbSet("mail", { ...mail });
  state.mailEdit = false;
  if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  const button = event.target.querySelector("button[type='submit']");
  if (button) button.disabled = true;
  try {
    const response = await fetch("http://127.0.0.1:8787/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mail),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.ok) {
      showMailSent(mail);
      return;
    }
    const reason = String(data?.error || "Mail could not be sent.").replaceAll(mail.appPassword, "");
    toast(reason);
  } catch {
    toast("Start the mail sender first: node server/mail.mjs");
  } finally {
    if (button) button.disabled = false;
  }
}

function bind() {
  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    if (button.dataset.act === "edit-mail") {
      state.mailEdit = true;
      render();
    }
    if (button.dataset.act === "resume-file") document.getElementById("resume-file").click();
    if (button.dataset.act === "save-mail") saveMailOnce();
  });
  document.body.addEventListener("submit", (event) => {
    if (event.target.id === "hr-mail") sendHrMail(event);
  });
  document.body.addEventListener("input", (event) => {
    if (!event.target.dataset.mail) return;
    state.mail[event.target.dataset.mail] = event.target.value;
    if (event.target.dataset.mail === "job") {
      const match = document.querySelector("[data-job-match]");
      if (match) match.textContent = mailMatchText();
    }
  });
  document.getElementById("resume-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = await file.text();
    if (!text.trim()) {
      toast("That file has no resume text.");
      return;
    }
    state.mail.resume = text;
    state.mailEdit = true;
    render();
    toast("Resume loaded. Save it once.");
  });
}

const saved = await idbGet("mail");
if (saved) {
  state.mail = {
    from: saved.from || "",
    to: "",
    appPassword: saved.appPassword || "",
    job: saved.job || "",
    resume: saved.resume || "",
  };
}
bind();
render();
