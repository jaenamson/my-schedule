const STORAGE_KEY = "my-schedule-events-v1";
const CATEGORIES = {
  work:{label:"업무",color:"#4285f4"}, personal:{label:"개인",color:"#8b5cf6"},
  family:{label:"가족",color:"#ec4899"}, health:{label:"건강",color:"#16a085"},
  other:{label:"기타",color:"#f59e0b"}
};
const $ = id => document.getElementById(id);
let events = loadEvents();
let viewDate = new Date();
let selectedDate = dateKey(new Date());
let toastTimer;

function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function parseDate(s){const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)}
function loadEvents(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}catch{return []}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(events));render()}
function uid(){return crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random()}
function toast(msg){const el=$("toast");el.textContent=msg;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2300)}
function occurrenceDates(ev,from,to){
  const start=parseDate(ev.date), out=[];
  if(ev.repeat==="none"){if(start>=from&&start<=to)out.push(dateKey(start));return out}
  let cur=new Date(Math.max(start.getTime(),from.getTime()));cur.setHours(0,0,0,0);
  // Start from the requested range and test recurrence against the original date.
  for(let i=0;i<500 && cur<=to;i++,cur.setDate(cur.getDate()+1)){
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
  const target=parseDate(day), from=new Date(target);from.setDate(from.getDate()-370);
  return events.filter(e=>occurrenceDates(e,from,target).includes(day))
    .sort((a,b)=>(a.time||"").localeCompare(b.time||""));
}
function render(){
  renderCalendar();renderAgenda();renderToday();
}
function renderCalendar(){
  const y=viewDate.getFullYear(),m=viewDate.getMonth();
  $("monthTitle").textContent=`${y}년 ${m+1}월`;
  const first=new Date(y,m,1), start=new Date(y,m,1-first.getDay());
  const today=dateKey(new Date()), grid=$("calendarGrid");grid.innerHTML="";
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const key=dateKey(d);
    const btn=document.createElement("button");btn.className="calendar-day";
    if(d.getMonth()!==m)btn.classList.add("muted");
    if(key===today)btn.classList.add("today");
    if(key===selectedDate)btn.classList.add("selected");
    const num=document.createElement("span");num.className="day-num";num.textContent=d.getDate();btn.append(num);
    const dots=document.createElement("span");dots.className="dots";
    const dayEvents=eventsOn(key);
    [...new Set(dayEvents.map(e=>e.category))].slice(0,3).forEach(cat=>{
      const dot=document.createElement("i");dot.className="dot";dot.style.background=CATEGORIES[cat]?.color||"#999";dots.append(dot);
    });
    btn.append(dots);btn.addEventListener("click",()=>{selectedDate=key;viewDate=new Date(d);render()});grid.append(btn);
  }
}
function makeEventRow(ev,day){
  const row=document.createElement("div");row.className="event-row";
  const bar=document.createElement("span");bar.className="event-color";bar.style.background=CATEGORIES[ev.category]?.color||"#999";row.append(bar);
  const main=document.createElement("div");main.className="event-main";
  const name=document.createElement("div");name.className="event-name";name.textContent=ev.title;if(ev.done)name.style.textDecoration="line-through";
  const meta=document.createElement("div");meta.className="event-meta";
  const cat=CATEGORIES[ev.category]?.label||"기타";
  meta.textContent=`${ev.time||"시간 미정"} · ${cat}${ev.repeat!=="none"?" · 반복":""}${ev.notes?" · 메모 있음":""}`;
  main.append(name,meta);row.append(main);
  const actions=document.createElement("div");actions.className="event-actions";
  const check=document.createElement("input");check.type="checkbox";check.className="done-check";check.checked=!!ev.done;check.setAttribute("aria-label","완료");
  check.addEventListener("change",()=>{const original=events.find(x=>x.id===ev.id);if(original){original.done=check.checked;localStorage.setItem(STORAGE_KEY,JSON.stringify(events));render()}});
  const edit=document.createElement("button");edit.className="event-edit";edit.textContent="⋯";edit.setAttribute("aria-label","수정");edit.addEventListener("click",()=>openEditor(ev));
  actions.append(check,edit);row.append(actions);return row;
}
function renderAgenda(){
  $("selectedDateLabel").textContent=parseDate(selectedDate).toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"short"});
  const list=$("agendaList");list.innerHTML="";const items=eventsOn(selectedDate);
  if(!items.length){list.innerHTML='<div class="empty">이 날짜에는 등록된 일정이 없습니다.</div>';return}
  items.forEach(e=>list.append(makeEventRow(e,selectedDate)));
}
function renderToday(){
  const today=dateKey(new Date());$("todayLabel").textContent=new Date().toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"long"});
  const items=eventsOn(today);$("todayCount").textContent=`${items.length}개 일정`;
  const list=$("todayList");list.innerHTML="";
  if(!items.length){list.innerHTML='<div class="empty">오늘은 등록된 일정이 없습니다.</div>';return}
  items.slice(0,4).forEach(e=>list.append(makeEventRow(e,today)));
}
function openEditor(ev=null){
  $("eventForm").reset();$("eventId").value=ev?.id||"";
  $("dialogTitle").textContent=ev?"일정 수정":"일정 추가";
  $("eventTitle").value=ev?.title||"";$("eventDate").value=ev?.date||selectedDate;
  $("eventTime").value=ev?.time||"";$("eventCategory").value=ev?.category||"work";
  $("eventRepeat").value=ev?.repeat||"none";$("eventReminder").value=ev?.reminder??"none";
  $("eventNotes").value=ev?.notes||"";
  $("deleteBtn").classList.toggle("hidden",!ev);
  $("eventDialog").showModal();
}
function saveEvent(e){
  e.preventDefault();
  const id=$("eventId").value;
  const item={id:id||uid(),title:$("eventTitle").value.trim(),date:$("eventDate").value,time:$("eventTime").value,
    category:$("eventCategory").value,repeat:$("eventRepeat").value,reminder:$("eventReminder").value,
    notes:$("eventNotes").value.trim(),done:id?(events.find(x=>x.id===id)?.done||false):false};
  if(!item.title||!item.date)return;
  if(id){events=events.map(x=>x.id===id?item:x)}else events.push(item);
  selectedDate=item.date;viewDate=parseDate(item.date);$("eventDialog").close();save();toast("일정을 저장했어요.");
}
function exportData(){
  const blob=new Blob([JSON.stringify({app:"My Schedule",version:1,exportedAt:new Date().toISOString(),events},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`my-schedule-${dateKey(new Date())}.json`;a.click();URL.revokeObjectURL(url);toast("백업 파일을 만들었어요.");
}
function importData(file){
  const reader=new FileReader();reader.onload=()=>{
    try{const data=JSON.parse(reader.result);const incoming=Array.isArray(data)?data:data.events;
      if(!Array.isArray(incoming)||!incoming.every(x=>x.title&&x.date))throw Error();
      if(!confirm(`백업의 일정 ${incoming.length}개를 가져올까요? 기존 일정은 유지하고 ID가 같은 항목은 덮어씁니다.`))return;
      const map=new Map(events.map(x=>[x.id,x]));incoming.forEach(x=>map.set(x.id||uid(),{...x,id:x.id||uid()}));events=[...map.values()];save();toast("복원이 완료됐어요.");
    }catch{alert("올바른 My Schedule 백업 파일이 아닙니다.");}
  };reader.readAsText(file);
}
function checkReminders(){
  if(!("Notification"in window)||Notification.permission!=="granted")return;
  const now=new Date(),today=dateKey(now);
  events.forEach(ev=>{
    if(!ev.time||ev.reminder==="none")return;
    const daysBack=ev.repeat==="none"?0:370;
    const from=new Date(now);from.setDate(from.getDate()-daysBack);
    const occurrence=occurrenceDates(ev,from,new Date(now.getFullYear(),now.getMonth(),now.getDate()+1));
    occurrence.forEach(day=>{
      const [h,m]=ev.time.split(":").map(Number);const due=parseDate(day);due.setHours(h,m,0,0);
      due.setMinutes(due.getMinutes()-Number(ev.reminder));
      const key=`${ev.id}|${day}|${ev.reminder}`;
      if(due<=now&&now-due<60000&&!sessionStorage.getItem(key)){
        new Notification(ev.title,{body:`${ev.time} 일정${ev.notes?" · "+ev.notes:""}`,icon:"./icon-192.png"});sessionStorage.setItem(key,"1");
      }
    });
  });
}
$("prevMonth").onclick=()=>{viewDate.setMonth(viewDate.getMonth()-1);renderCalendar()};
$("nextMonth").onclick=()=>{viewDate.setMonth(viewDate.getMonth()+1);renderCalendar()};
$("addBtn").onclick=()=>openEditor();$("navAdd").onclick=()=>openEditor();
$("navToday").onclick=()=>{selectedDate=dateKey(new Date());viewDate=new Date();render()};
$("navCalendar").onclick=()=>{document.querySelector(".calendar").scrollIntoView({behavior:"smooth"})};
$("closeDialog").onclick=$("cancelBtn").onclick=()=>$("eventDialog").close();
$("eventForm").addEventListener("submit",saveEvent);
$("deleteBtn").onclick=()=>{const id=$("eventId").value;if(id&&confirm("이 일정을 삭제할까요?")){events=events.filter(x=>x.id!==id);$("eventDialog").close();save();toast("삭제했어요.")}};
$("exportBtn").onclick=exportData;$("importBtn").onclick=()=>$("importFile").click();
$("importFile").onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);e.target.value=""};
$("settingsBtn").onclick=()=>$("settingsDialog").showModal();
$("closeSettings").onclick=()=>$("settingsDialog").close();
$("enableNotifications").onclick=async()=>{
  if(!("Notification"in window)){alert("이 브라우저는 알림을 지원하지 않습니다.");return}
  const p=await Notification.requestPermission();$("notificationStatus").textContent=p==="granted"?"알림 권한이 허용됐습니다. 앱이 열려 있을 때 알림을 확인합니다.":"알림 권한이 허용되지 않았습니다.";
};
$("installHelp").onclick=()=>alert("Safari에서 이 앱을 연 다음 공유 버튼을 누르고 '홈 화면에 추가'를 선택하세요.");
if("serviceWorker"in navigator && location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(()=>{});
render();checkReminders();setInterval(checkReminders,15000);
