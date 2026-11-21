
const STORAGE_KEY = "my-schedule-events-v1";
const TOKEN_KEY = "my-schedule-api-token-v1";
const DELETED_KEY = "my-schedule-deleted-v1";

const API_BASE = "https://my-schedule-push.sonjaenam4261.workers.dev";

const CATEGORIES = {
  work:{label:"仕事",color:"#4285f4"},
  personal:{label:"プライベート",color:"#8b5cf6"},
  family:{label:"家族",color:"#ec4899"},
  health:{label:"健康",color:"#16a085"},
  other:{label:"その他",color:"#f59e0b"}
};

const $ = id => document.getElementById(id);

let events = loadEvents();
let viewDate = new Date();
let selectedDate = dateKey(new Date());
let toastTimer;
let cloudToken = localStorage.getItem(TOKEN_KEY) || "";

function dateKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function parseDate(s){
  const [y,m,d]=s.split("-").map(Number);
  return new Date(y,m-1,d);
}

function loadEvents(){
  try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}
  catch{return []}
}

function loadDeletedIds(){
  try{return JSON.parse(localStorage.getItem(DELETED_KEY)||"[]")}
  catch{return []}
}

function saveDeletedIds(ids){
  localStorage.setItem(DELETED_KEY,JSON.stringify(ids));
}

function save(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(events));
  render();
}

function uid(){
  return crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random();
}

function toast(msg){
  const el=$("toast");
  el.textContent=msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove("show"),2300);
}

// ------------------------------
// Cloudflare API
// ------------------------------

function setCloudStatus(message){
  const el=$("cloudStatus");
  if(el)el.textContent=message;
}

async function cloudRequest(path,options={}){
  const headers={
    ...(options.headers||{})
  };

  if(cloudToken){
    headers.Authorization=`Bearer ${cloudToken}`;
  }

  if(options.body){
    headers["Content-Type"]="application/json";
  }

  const res=await fetch(API_BASE+path,{
    ...options,
    headers
  });

  let data={};
  try{data=await res.json()}catch{}

  if(!res.ok){
    throw new Error(data.error||`HTTP ${res.status}`);
  }

  return data;
}

function convertCloudEvent(row){
  return {
    id:row.id,
    title:row.title,
    date:row.event_date || row.start_at?.slice(0,10) || "",
    time:row.event_time ?? row.start_at?.slice(11,16) ?? "",
    category:row.category || "other",
    repeat:row.repeat_type || "none",
    reminder:row.reminder ?? "none",
    notes:row.memo || "",
    done:Number(row.is_done)===1
  };
}

async function syncAllCloud(){
  if(!cloudToken){
    setCloudStatus("クラウド未接続");
    return;
  }

  setCloudStatus("クラウドと同期中...");

  // 1. Cloudflareから既存データを取得
  const result=await cloudRequest("/api/events");
  const remoteEvents=(result.events||[]).map(convertCloudEvent);

  // 2. オフライン中に削除した予定をクラウドからも削除
  const deletedIds=loadDeletedIds();

  for(const id of deletedIds){
    await cloudRequest(
      "/api/events?id="+encodeURIComponent(id),
      {method:"DELETE"}
    );
  }

  // 3. クラウドの予定をベースにして、ローカルの予定を優先して統合
  const deletedSet=new Set(deletedIds);
  const merged=new Map();

  remoteEvents.forEach(ev=>{
    if(!deletedSet.has(ev.id)){
      merged.set(ev.id,ev);
    }
  });

  events.forEach(ev=>{
    if(!deletedSet.has(ev.id)){
      merged.set(ev.id,ev);
    }
  });

  events=[...merged.values()];

  // 4. ローカルにも保存
  localStorage.setItem(STORAGE_KEY,JSON.stringify(events));
  render();

  // 5. 統合した予定をクラウドに保存
  for(const ev of events){
    await cloudRequest("/api/events",{
      method:"POST",
      body:JSON.stringify(ev)
    });
  }

  // 6. 同期成功後に削除履歴をクリア
  saveDeletedIds([]);

  setCloudStatus(`同期完了（${events.length}件）`);
}

async function loginAndSync(){
  const password=$("cloudPassword").value;

  if(!password){
    alert("パスワードを入力してください。");
    return;
  }

  const button=$("connectCloud");
  button.disabled=true;
  setCloudStatus("ログイン中...");

  try{
    // パスワードでログイン
    const result=await cloudRequest("/auth",{
      method:"POST",
      body:JSON.stringify({password})
    });

    cloudToken=result.token;
    localStorage.setItem(TOKEN_KEY,cloudToken);

    $("cloudPassword").value="";

    // ログイン後に初回同期
    await syncAllCloud();

    toast("クラウド同期が完了しました。");

  }catch(error){
    console.error("Cloud login/sync error:",error);
    setCloudStatus("エラー: "+error.message);
    alert("クラウド接続に失敗しました。\n"+error.message);

  }finally{
    button.disabled=false;
  }
}

async function syncEventToCloud(ev){
  if(!cloudToken)return;

  try{
    await cloudRequest("/api/events",{
      method:"POST",
      body:JSON.stringify(ev)
    });

    setCloudStatus("クラウド保存完了");

  }catch(error){
    console.error("Cloud save error:",error);
    setCloudStatus("ローカル保存済み・クラウド未同期");
  }
}

async function deleteEventFromCloud(id){
  const deletedIds=loadDeletedIds();

  if(!deletedIds.includes(id)){
    deletedIds.push(id);
    saveDeletedIds(deletedIds);
  }

  if(!cloudToken)return;

  try{
    await cloudRequest(
      "/api/events?id="+encodeURIComponent(id),
      {method:"DELETE"}
    );

    saveDeletedIds(loadDeletedIds().filter(x=>x!==id));
    setCloudStatus("クラウド削除完了");

  }catch(error){
    console.error("Cloud delete error:",error);
    setCloudStatus("削除済み・クラウド未同期");
  }
}

// ------------------------------
// Calendar
// ------------------------------

function occurrenceDates(ev,from,to){
  const start=parseDate(ev.date),out=[];

  if(ev.repeat==="none"){
    if(start>=from&&start<=to)out.push(dateKey(start));
    return out;
  }

  let cur=new Date(Math.max(start.getTime(),from.getTime()));
  cur.setHours(0,0,0,0);

  for(let i=0;i<500&&cur<=to;i++,cur.setDate(cur.getDate()+1)){
    if(cur<start)continue;

    let match=false;
    if(ev.repeat==="daily")match=true;
    if(ev.repeat==="weekly")match=cur.getDay()===start.getDay();
    if(ev.repeat==="monthly")match=cur.getDate()===start.getDate();
    if(ev.repeat==="yearly")match=cur.getMonth()===start.getMonth()&&cur.getDate()===start.getDate();

    if(match)out.push(dateKey(cur));
  }

  return out;
}

function eventsOn(day){
  const target=parseDate(day);
  const from=new Date(target);
  from.setDate(from.getDate()-370);

  return events.filter(e=>occurrenceDates(e,from,target).includes(day))
    .sort((a,b)=>(a.time||"").localeCompare(b.time||""));
}

function render(){
  renderCalendar();
  renderAgenda();
  renderToday();
}

function renderCalendar(){
  const y=viewDate.getFullYear(),m=viewDate.getMonth();
  $("monthTitle").textContent=`${y}年${m+1}月`;

  const first=new Date(y,m,1);
  const start=new Date(y,m,1-first.getDay());
  const today=dateKey(new Date());
  const grid=$("calendarGrid");

  grid.innerHTML="";

  for(let i=0;i<42;i++){
    const d=new Date(start);
    d.setDate(start.getDate()+i);
    const key=dateKey(d);

    const btn=document.createElement("button");
    btn.className="calendar-day";

    if(d.getMonth()!==m)btn.classList.add("muted");
    if(key===today)btn.classList.add("today");
    if(key===selectedDate)btn.classList.add("selected");

    const num=document.createElement("span");
    num.className="day-num";
    num.textContent=d.getDate();
    btn.append(num);

    const dots=document.createElement("span");
    dots.className="dots";

    const dayEvents=eventsOn(key);

    [...new Set(dayEvents.map(e=>e.category))].slice(0,3).forEach(cat=>{
      const dot=document.createElement("i");
      dot.className="dot";
      dot.style.background=CATEGORIES[cat]?.color||"#999";
      dots.append(dot);
    });

    btn.append(dots);

    btn.addEventListener("click",()=>{
      selectedDate=key;
      viewDate=new Date(d);
      render();
    });

    grid.append(btn);
  }
}

function makeEventRow(ev,day){
  const row=document.createElement("div");
  row.className="event-row";

  const bar=document.createElement("span");
  bar.className="event-color";
  bar.style.background=CATEGORIES[ev.category]?.color||"#999";
  row.append(bar);

  const main=document.createElement("div");
  main.className="event-main";

  const name=document.createElement("div");
  name.className="event-name";
  name.textContent=ev.title;
  if(ev.done)name.style.textDecoration="line-through";

  const meta=document.createElement("div");
  meta.className="event-meta";

  const cat=CATEGORIES[ev.category]?.label||"その他";

  meta.textContent=`${ev.time||"時間未定"} · ${cat}${ev.repeat!=="none"?" · 繰り返し":""}${ev.notes?" · メモあり":""}`;

  main.append(name,meta);
  row.append(main);

  const actions=document.createElement("div");
  actions.className="event-actions";

  const check=document.createElement("input");
  check.type="checkbox";
  check.className="done-check";
  check.checked=!!ev.done;
  check.setAttribute("aria-label","完了");

  check.addEventListener("change",()=>{
    const original=events.find(x=>x.id===ev.id);

    if(original){
      original.done=check.checked;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(events));
      render();
      syncEventToCloud(original);
    }
  });

  const edit=document.createElement("button");
  edit.className="event-edit";
  edit.textContent="⋯";
  edit.setAttribute("aria-label","編集");
  edit.addEventListener("click",()=>openEditor(ev));

  actions.append(check,edit);
  row.append(actions);

  return row;
}

function renderAgenda(){
  $("selectedDateLabel").textContent=parseDate(selectedDate).toLocaleDateString("ja-JP",{
    month:"long",day:"numeric",weekday:"short"
  });

  const list=$("agendaList");
  list.innerHTML="";

  const items=eventsOn(selectedDate);

  if(!items.length){
    list.innerHTML='<div class="empty">この日の予定はありません。</div>';
    return;
  }

  items.forEach(e=>list.append(makeEventRow(e,selectedDate)));
}

function renderToday(){
  const today=dateKey(new Date());

  $("todayLabel").textContent=new Date().toLocaleDateString("ja-JP",{
    month:"long",day:"numeric",weekday:"long"
  });

  const items=eventsOn(today);
  $("todayCount").textContent=`${items.length}件の予定`;

  const list=$("todayList");
  list.innerHTML="";

  if(!items.length){
    list.innerHTML='<div class="empty">今日は予定がありません。</div>';
    return;
  }

  items.slice(0,4).forEach(e=>list.append(makeEventRow(e,today)));
}

// ------------------------------
// Event editor
// ------------------------------

function openEditor(ev=null){
  $("eventForm").reset();
  $("eventId").value=ev?.id||"";

  $("dialogTitle").textContent=ev?"予定を編集":"予定を追加";
  $("eventTitle").value=ev?.title||"";
  $("eventDate").value=ev?.date||selectedDate;
  $("eventTime").value=ev?.time||"";
  $("eventCategory").value=ev?.category||"work";
  $("eventRepeat").value=ev?.repeat||"none";
  $("eventReminder").value=ev?.reminder??"none";
  $("eventNotes").value=ev?.notes||"";

  $("deleteBtn").classList.toggle("hidden",!ev);
  $("eventDialog").showModal();
}

function saveEvent(e){
  e.preventDefault();

  const id=$("eventId").value;

  const item={
    id:id||uid(),
    title:$("eventTitle").value.trim(),
    date:$("eventDate").value,
    time:$("eventTime").value,
    category:$("eventCategory").value,
    repeat:$("eventRepeat").value,
    reminder:$("eventReminder").value,
    notes:$("eventNotes").value.trim(),
    done:id?(events.find(x=>x.id===id)?.done||false):false
  };

  if(!item.title||!item.date)return;

  if(id){
    events=events.map(x=>x.id===id?item:x);
  }else{
    events.push(item);
  }

  selectedDate=item.date;
  viewDate=parseDate(item.date);
  $("eventDialog").close();

  save();
  syncEventToCloud(item);

  toast("予定を保存しました。");
}

// ------------------------------
// Backup / Restore
// ------------------------------

function exportData(){
  const blob=new Blob([
    JSON.stringify({
      app:"My Schedule",
      version:1,
      exportedAt:new Date().toISOString(),
      events
    },null,2)
  ],{type:"application/json"});

  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");

  a.href=url;
  a.download=`my-schedule-${dateKey(new Date())}.json`;
  a.click();

  URL.revokeObjectURL(url);
  toast("バックアップを作成しました。");
}

function importData(file){
  const reader=new FileReader();

  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      const incoming=Array.isArray(data)?data:data.events;

      if(!Array.isArray(incoming)||!incoming.every(x=>x.title&&x.date)){
        throw Error();
      }

      if(!confirm(`バックアップ内の予定${incoming.length}件を読み込みますか？既存の予定は保持し、同じIDの項目は上書きします。`)){
        return;
      }

      const map=new Map(events.map(x=>[x.id,x]));

      incoming.forEach(x=>{
        const id=x.id||uid();
        map.set(id,{...x,id});
      });

      events=[...map.values()];
      save();

      if(cloudToken){
        syncAllCloud().catch(error=>{
          console.error(error);
          setCloudStatus("復元済み・クラウド未同期");
        });
      }

      toast("復元が完了しました。");

    }catch{
      alert("My Scheduleのバックアップファイルとして読み込めません。");
    }
  };

  reader.readAsText(file);
}

// ------------------------------
// Notifications
// ------------------------------

function checkReminders(){
  if(!("Notification"in window)||Notification.permission!=="granted")return;

  const now=new Date();

  events.forEach(ev=>{
    if(!ev.time||ev.reminder==="none")return;

    const daysBack=ev.repeat==="none"?0:370;
    const from=new Date(now);
    from.setDate(from.getDate()-daysBack);

    const occurrence=occurrenceDates(
      ev,
      from,
      new Date(now.getFullYear(),now.getMonth(),now.getDate()+1)
    );

    occurrence.forEach(day=>{
      const [h,m]=ev.time.split(":").map(Number);
      const due=parseDate(day);

      due.setHours(h,m,0,0);
      due.setMinutes(due.getMinutes()-Number(ev.reminder));

      const key=`${ev.id}|${day}|${ev.reminder}`;

      if(due<=now&&now-due<60000&&!sessionStorage.getItem(key)){
        new Notification(ev.title,{
          body:`${ev.time}の予定${ev.notes?" · "+ev.notes:""}`,
          icon:"./icon-192.png"
        });

        sessionStorage.setItem(key,"1");
      }
    });
  });
}

// ------------------------------
// UI events
// ------------------------------

$("prevMonth").onclick=()=>{
  viewDate.setMonth(viewDate.getMonth()-1);
  renderCalendar();
};

$("nextMonth").onclick=()=>{
  viewDate.setMonth(viewDate.getMonth()+1);
  renderCalendar();
};

$("addBtn").onclick=()=>openEditor();
$("navAdd").onclick=()=>openEditor();

$("navToday").onclick=()=>{
  selectedDate=dateKey(new Date());
  viewDate=new Date();
  render();
};

$("navCalendar").onclick=()=>{
  document.querySelector(".calendar").scrollIntoView({behavior:"smooth"});
};

$("closeDialog").onclick=$("cancelBtn").onclick=()=>{
  $("eventDialog").close();
};

$("eventForm").addEventListener("submit",saveEvent);

$("deleteBtn").onclick=()=>{
  const id=$("eventId").value;

  if(id&&confirm("この予定を削除しますか？")){
    events=events.filter(x=>x.id!==id);
    $("eventDialog").close();

    save();
    deleteEventFromCloud(id);

    toast("削除しました。");
  }
};

$("exportBtn").onclick=exportData;
$("importBtn").onclick=()=>$("importFile").click();

$("importFile").onchange=e=>{
  if(e.target.files[0])importData(e.target.files[0]);
  e.target.value="";
};

$("settingsBtn").onclick=()=>{
  $("settingsDialog").showModal();
};

$("closeSettings").onclick=()=>{
  $("settingsDialog").close();
};

$("enableNotifications").onclick=async()=>{
  if(!("Notification"in window)){
    alert("このブラウザは通知に対応していません。");
    return;
  }

  const p=await Notification.requestPermission();

  $("notificationStatus").textContent=p==="granted"
    ?"通知が許可されました。アプリを開いている間に通知を確認できます。"
    :"通知が許可されていません。";
};

$("installHelp").onclick=()=>{
  alert("Safariでこのアプリを開き、共有ボタンから「ホーム画面に追加」を選択してください。");
};

// Cloud login / logout
$("connectCloud").onclick=loginAndSync;

$("disconnectCloud").onclick=()=>{
  cloudToken="";
  localStorage.removeItem(TOKEN_KEY);
  setCloudStatus("クラウド未接続");
  toast("ログアウトしました。");
};

// ------------------------------
// Start
// ------------------------------

if(cloudToken){
  setCloudStatus("ログイン情報あり（同期可能）");
}

if("serviceWorker"in navigator&&location.protocol.startsWith("http")){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

render();
checkReminders();
setInterval(checkReminders,15000);
