// 1) Crie um projeto em https://supabase.com/
// 2) Preencha SUPABASE_URL e SUPABASE_ANON_KEY abaixo.
// 3) NUNCA coloque a chave service_role neste arquivo.
// 4) Execute setup.sql no SQL Editor do Supabase.
const SUPABASE_URL = "COLE_AQUI_A_URL_DO_PROJETO";
const SUPABASE_ANON_KEY = "COLE_AQUI_A_CHAVE_PUBLICA_ANON_OU_PUBLISHABLE";
const BUCKET = "request-proofs";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("COLE_AQUI") && !SUPABASE_ANON_KEY.includes("COLE_AQUI");
const client = configured && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = id => document.getElementById(id);
let currentRequests = [];

function showPage(page) {
  $("visitorPage").classList.toggle("hidden", page !== "visitor");
  $("adminPage").classList.toggle("hidden", page !== "admin");
  if (page === "admin" && !client) $("adminMessage").textContent = "Configure o Supabase no arquivo app.js para ativar o painel.";
}
$("proof").addEventListener("change", () => {
  const file = $("proof").files[0], preview = $("preview");
  if (!file) { preview.classList.add("hidden"); preview.removeAttribute("src"); return; }
  if (!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size > 5*1024*1024) {
    $("formMessage").textContent = "Escolha PNG, JPG ou WebP com até 5 MB.";
    $("proof").value = ""; preview.classList.add("hidden"); return;
  }
  preview.src = URL.createObjectURL(file); preview.classList.remove("hidden");
});


// Prévia do avatar público: usa o nome informado, sem pedir senha nem login Roblox.
let avatarTimer = null;
let lastAvatarNickname = "";
$("nickname").addEventListener("input", () => {
  clearTimeout(avatarTimer);
  const nickname = $("nickname").value.trim();
  $("avatarError").textContent = "";
  if (!nickname) {
    $("avatarPreview").classList.add("hidden");
    lastAvatarNickname = "";
    return;
  }
  avatarTimer = setTimeout(() => lookupRobloxAvatar(nickname), 650);
});
async function lookupRobloxAvatar(nickname) {
  if (nickname !== $("nickname").value.trim()) return;
  $("avatarPreview").classList.remove("hidden");
  $("avatarName").textContent = nickname;
  $("avatarStatus").textContent = "Buscando perfil público do Roblox…";
  $("avatarImage").removeAttribute("src");
  try {
    const response = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({usernames:[nickname], excludeBannedUsers:true})
    });
    if (!response.ok) throw new Error("lookup");
    const body = await response.json();
    const user = body.data && body.data[0];
    if (!user) {
      $("avatarStatus").textContent = "Não encontramos esse nome. Confira a escrita.";
      $("avatarImage").removeAttribute("src");
      return;
    }
    const thumbResponse = await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" +
      encodeURIComponent(user.id) + "&size=150x150&format=Png&isCircular=false");
    if (!thumbResponse.ok) throw new Error("thumbnail");
    const thumb = await thumbResponse.json();
    const imageUrl = thumb.data && thumb.data[0] && thumb.data[0].imageUrl;
    if (!imageUrl) throw new Error("no image");
    $("avatarImage").src = imageUrl;
    $("avatarName").textContent = user.name + (user.displayName && user.displayName !== user.name ? " · " + user.displayName : "");
    $("avatarStatus").textContent = "Perfil público encontrado. Confira se é a pessoa certa.";
    lastAvatarNickname = user.name;
  } catch (_) {
    $("avatarStatus").textContent = "Não foi possível carregar o avatar agora. Você ainda pode enviar o pedido.";
    $("avatarError").textContent = "A prévia depende da conexão com os serviços públicos do Roblox e pode falhar temporariamente.";
  }
}

$("requestForm").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("formMessage"), btn = $("submitBtn");
  if (!client) { msg.textContent = "O site ainda não está conectado ao banco de dados. Configure o Supabase conforme o LEIA-ME.txt."; return; }
  const file = $("proof").files[0];
  if (!file || file.size > 5*1024*1024 || !["image/png","image/jpeg","image/webp"].includes(file.type)) {
    msg.textContent = "Selecione uma imagem PNG, JPG ou WebP de até 5 MB."; return;
  }
  const nickname = $("nickname").value.trim();
  if (!nickname || nickname.length > 40) { msg.textContent = "Confira o nick do Roblox."; return; }
  btn.disabled = true; msg.textContent = "Enviando pedido com segurança…";
  try {
    const id = crypto.randomUUID();
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${id}.${ext}`;
    const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, {contentType:file.type, upsert:false});
    if (uploadError) throw uploadError;
    const { error: insertError } = await client.from("robux_requests").insert({
      id, nickname, amount:Number(new FormData($("requestForm")).get("amount")),
      campaign_url:$("campaign").value.trim() || null, proof_path:path, status:"pending"
    });
    if (insertError) throw insertError;
    msg.textContent = "Solicitação enviada! Guarde este código para referência: " + id.slice(0,8).toUpperCase();
    $("requestForm").reset(); $("preview").classList.add("hidden");
  } catch (err) {
    console.error(err); msg.textContent = "Não foi possível enviar. Confira a configuração do Supabase e tente novamente.";
  } finally { btn.disabled = false; }
});

$("adminLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!client) { $("adminMessage").textContent = "Configure o Supabase primeiro."; return; }
  $("adminMessage").textContent = "Entrando…";
  const {error} = await client.auth.signInWithPassword({email:$("adminEmail").value.trim(),password:$("adminPassword").value});
  if (error) { $("adminMessage").textContent = "Não foi possível entrar. Confira o e-mail/senha e se o usuário administrador foi criado no Supabase."; return; }
  $("adminMessage").textContent = "Login realizado.";
  $("adminDashboard").classList.remove("hidden"); await loadRequests();
});
$("logoutBtn").addEventListener("click", async () => {
  if (client) await client.auth.signOut();
  $("adminDashboard").classList.add("hidden"); $("adminMessage").textContent = "Você saiu do painel.";
});
$("refreshBtn").addEventListener("click", loadRequests);
$("statusFilter").addEventListener("change", renderRequests);

async function loadRequests() {
  if (!client) return;
  $("requestList").textContent = "Carregando…";
  const {data,error} = await client.from("robux_requests").select("*").order("created_at",{ascending:false}).limit(300);
  if (error) { $("requestList").textContent = "Erro ao carregar. Confira as políticas do banco."; return; }
  currentRequests = data || [];
  $("totalCount").textContent = currentRequests.length;
  $("pendingCount").textContent = currentRequests.filter(x=>x.status==="pending").length;
  $("approvedCount").textContent = currentRequests.filter(x=>x.status==="approved").length;
  $("rejectedCount").textContent = currentRequests.filter(x=>x.status==="rejected").length;
  renderRequests();
}
async function renderRequests() {
  const list = $("requestList"), filter = $("statusFilter").value;
  const items = currentRequests.filter(x=>filter==="all" || x.status===filter);
  list.replaceChildren();
  if (!items.length) { list.textContent = "Nenhum pedido neste filtro."; return; }
  for (const r of items) {
    const card = document.createElement("article"); card.className="request";
    const heading = document.createElement("h3"); heading.textContent = `${r.nickname} — ${Number(r.amount).toLocaleString("pt-BR")} Robux`; card.appendChild(heading);
    const info = document.createElement("p"); info.className="muted"; info.textContent = `Recebido: ${new Date(r.created_at).toLocaleString("pt-BR")} · Status: ${r.status}`; card.appendChild(info);
    if (r.campaign_url) { const a=document.createElement("a"); a.href=r.campaign_url; a.target="_blank"; a.rel="noopener noreferrer"; a.textContent="Abrir link informado"; card.appendChild(a); }
    const {data: signed, error:signedError} = await client.storage.from(BUCKET).createSignedUrl(r.proof_path,60*5);
    if (!signedError && signed?.signedUrl) { const img=document.createElement("img"); img.src=signed.signedUrl; img.alt="Comprovante enviado"; card.appendChild(img); }
    const select=document.createElement("select"); for(const [value,label] of [["pending","Pendente"],["approved","Aprovado"],["rejected","Recusado"]]){const op=document.createElement("option");op.value=value;op.textContent=label;op.selected=r.status===value;select.appendChild(op);}
    const save=document.createElement("button"); save.textContent="Salvar status"; save.style.marginTop="10px";
    save.addEventListener("click",async()=>{save.disabled=true;const {error}=await client.from("robux_requests").update({status:select.value,updated_at:new Date().toISOString()}).eq("id",r.id);save.disabled=false;if(error){alert("Não foi possível atualizar o status. Confira a política RLS.");return;}await loadRequests();});
    card.appendChild(select); card.appendChild(save); list.appendChild(card);
  }
}
if (client) client.auth.getSession().then(({data})=>{if(data.session){$("adminDashboard").classList.remove("hidden");loadRequests();}});
