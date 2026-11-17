import React,{ useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError } from './api';
import { Auth, Avatar, Dialog, time } from './components';
import { connect, emit } from './realtime';
import { createMessageId } from './message-id';
import type { User, Conversation, Message, Page } from './types';
import './prototype.css';
import './styles.css';

function App(){
  const [user,setUser]=useState<User|null>(null),[checking,setChecking]=useState(true),[startupError,setStartupError]=useState('');
  async function check(){setChecking(true);setStartupError('');try{setUser(await api<User>('/auth/me'));}catch(e){if(!(e instanceof ApiError&&e.status===401))setStartupError('Сервер недоступен. Проверьте соединение.');}finally{setChecking(false);}}
  useEffect(()=>{void check();},[]);
  if(checking)return <div className="empty">Подключаем Nebula…</div>;
  if(startupError)return <div className="empty" role="alert">{startupError}<button className="primary-btn" onClick={()=>void check()}>Повторить</button></div>;
  return user?<Messenger user={user} onLogout={()=>setUser(null)}/>:<Auth onLogin={setUser}/>;
}
function Messenger({user,onLogout}:{user:User;onLogout:()=>void}) {
  const [socket]=useState(connect),[connected,setConnected]=useState(false),[chats,setChats]=useState<Conversation[]>([]),[selected,setSelected]=useState<string|null>(null),[messages,setMessages]=useState<Message[]>([]),[cursor,setCursor]=useState<number|null>(null),[loading,setLoading]=useState(false),[chatsLoading,setChatsLoading]=useState(true),[error,setError]=useState(''),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[online,setOnline]=useState<string[]>([]),[typing,setTyping]=useState(false),[query,setQuery]=useState(''),[people,setPeople]=useState(false),[search,setSearch]=useState(''),[results,setResults]=useState<User[]>([]),[searching,setSearching]=useState(false),[profile,setProfile]=useState(false),[failed,setFailed]=useState<{conversationId:string;body:string;clientMessageId:string}|null>(null),[newMessages,setNewMessages]=useState(false);
  const current=useRef(selected);current.current=selected;
  const loaded=useRef(messages);loaded.current=messages;
  const viewport=useRef<HTMLDivElement>(null),nearBottom=useRef(true),scrollNext=useRef(false),requestVersion=useRef(0),typingTimer=useRef<ReturnType<typeof setTimeout>|null>(null),lastTyped=useRef(0),historyBusy=useRef(false);
  const chat=chats.find(c=>c.id===selected),peer=chat?.members.find(m=>m.user.id!==user.id)?.user;
  function fail(e:unknown){if(e instanceof ApiError&&e.status===401){onLogout();return;}setError((e as Error).message||'Не удалось подключиться');}
  async function refreshChats(){try{setChats(await api<Conversation[]>('/conversations'));}catch(e){fail(e);}finally{setChatsLoading(false);}}
  async function history(id:string,reset:boolean){
    const version=++requestVersion.current;setLoading(true);
    try {
      if(!reset&&loaded.current.length){
        let after=loaded.current[loaded.current.length-1].id;
        do {
          const page=await api<{messages:Message[];nextAfter:number|null}>(`/conversations/${id}/messages?after=${after}&limit=100`);
          if(current.current!==id||version!==requestVersion.current)return;
          setMessages(previous=>merge([...previous,...page.messages]));
          if(nearBottom.current)scrollNext.current=true;else if(page.messages.length)setNewMessages(true);
          if(page.nextAfter===null)break;after=page.nextAfter;
        }while(true);
        return;
      }
      const page=await api<Page>(`/conversations/${id}/messages?limit=50`);
      if(current.current!==id||version!==requestVersion.current)return;
      if(reset){setMessages(previous=>merge([...previous,...page.messages]));setCursor(page.nextCursor);scrollNext.current=true;nearBottom.current=true;}
      else {setMessages(previous=>merge([...previous,...page.messages]));setCursor(old=>old??page.nextCursor);if(nearBottom.current)scrollNext.current=true;}
    } catch(e){fail(e);}finally{if(version===requestVersion.current)setLoading(false);}
  }
  useEffect(()=>{
    const incoming=(message:Message)=>{
      void refreshChats();
      if(message.conversationId!==current.current)return;
      setMessages(old=>merge([...old,message]));
      if(nearBottom.current)scrollNext.current=true;else setNewMessages(true);
    };
    const ready=()=>{setConnected(true);setError('');void refreshChats();if(current.current){void history(current.current,false);void emit<{online:string[]}>(socket,'conversation:join',{conversationId:current.current}).then(data=>setOnline(old=>[...new Set([...old,...data.online])])).catch(fail);}};
    socket.on('connect',ready).on('disconnect',()=>setConnected(false)).on('connect_error',(e)=>{setConnected(false);setError(e.message==='Требуется вход'?'Сессия недоступна. Войдите снова.':'Не удалось подключиться. Повторяем…');if(e.message==='Требуется вход')onLogout();}).on('message:new',incoming).on('conversation:update',()=>void refreshChats()).on('presence:snapshot',setOnline).on('presence:update',({userId,online}:{userId:string;online:boolean})=>setOnline(old=>online?[...new Set([...old,userId])]:old.filter(id=>id!==userId))).on('typing:update',({conversationId,active}:{conversationId:string;active:boolean})=>{
      if(conversationId!==current.current)return;setTyping(active);if(typingTimer.current)clearTimeout(typingTimer.current);if(active)typingTimer.current=setTimeout(()=>setTyping(false),3000);
    });
    socket.connect();void refreshChats();
    return ()=>{socket.removeAllListeners();socket.disconnect();if(typingTimer.current)clearTimeout(typingTimer.current);};
  },[]);
  useEffect(()=>{
    setMessages([]);setCursor(null);setDraft('');setTyping(false);setNewMessages(false);nearBottom.current=true;
    if(!selected)return;
    void history(selected,true);
    if(socket.connected)void emit<{online:string[]}>(socket,'conversation:join',{conversationId:selected}).then(data=>setOnline(old=>[...new Set([...old,...data.online])])).catch(fail);
    return ()=>{if(socket.connected){socket.emit('typing:stop',{conversationId:selected});socket.emit('conversation:leave',{conversationId:selected});}};
  },[selected]);
  useLayoutEffect(()=>{if(scrollNext.current&&viewport.current){viewport.current.scrollTop=viewport.current.scrollHeight;scrollNext.current=false;}},[messages]);
  useEffect(()=>{
    if(!people)return;
    let active=true;setSearching(true);setResults([]);
    const timer=setTimeout(()=>{api<User[]>(`/users?search=${encodeURIComponent(search)}`).then(data=>{if(active)setResults(data);}).catch(e=>{if(active)fail(e);}).finally(()=>{if(active)setSearching(false);});},250);
    return ()=>{active=false;clearTimeout(timer);};
  },[search,people]);
  useEffect(()=>{if(!people&&!profile)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setPeople(false);setProfile(false);}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[people,profile]);
  async function older(){
    if(!selected||!cursor||historyBusy.current)return;historyBusy.current=true;setLoading(true);
    const id=selected,before=viewport.current?.scrollHeight||0,top=viewport.current?.scrollTop||0;
    try{const page=await api<Page>(`/conversations/${id}/messages?cursor=${cursor}&limit=50`);if(current.current!==id)return;setMessages(old=>merge([...page.messages,...old]));setCursor(page.nextCursor);requestAnimationFrame(()=>{if(viewport.current&&current.current===id)viewport.current.scrollTop=top+viewport.current.scrollHeight-before;});}catch(e){fail(e);}finally{historyBusy.current=false;setLoading(false);}
  }
  async function start(person:User){try{const c=await api<Conversation>('/conversations',{userId:person.id});setChats(old=>[c,...old.filter(x=>x.id!==c.id)]);setSelected(c.id);setPeople(false);setSearch('');}catch(e){fail(e);}}
  async function send(retry=false){
    if(sending||!connected||!selected)return;
    const payload=retry?failed:{conversationId:selected,body:draft.trim(),clientMessageId:createMessageId()};
    if(!payload?.body)return;
    setSending(true);setError('');
    try{const message=await emit<Message>(socket,'message:send',payload);if(current.current===payload.conversationId){setMessages(old=>merge([...old,message]));setDraft(old=>!retry||old.trim()===payload.body?'':old);if(nearBottom.current)scrollNext.current=true;else setNewMessages(true);}setFailed(null);socket.emit('typing:stop',{conversationId:payload.conversationId});}
    catch(e){setFailed(payload);fail(e);}finally{setSending(false);}
  }
  async function logout(){try{await api('/auth/logout',{});onLogout();}catch(e){fail(e);}}
  return <div className={`app ${selected?'has-chat':''}`}>
    <header className="topbar"><div className="brand"><div className="brand-badge">✦</div><span>Nebula</span></div><div className="top-search"><span className="search-icon">⌕</span><input aria-label="Поиск диалогов" placeholder="Поиск по имени собеседника…" value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="profile-short profile-button" onClick={()=>setProfile(true)}><div className="meta"><strong>{user.displayName}</strong><small>{connected?'в сети':'подключение…'}</small></div><Avatar user={user} online={connected}/></button></header>
    <div className="workspace"><nav className="rail" aria-label="Навигация"><button className="icon-btn active" title="Чаты" onClick={()=>setSelected(null)}>💬</button><button className="icon-btn" title="Люди" onClick={()=>setPeople(true)}>👥</button><button className="icon-btn" title="Мой профиль" onClick={()=>setProfile(true)}>▦</button><div className="rail-spacer"/><button className="icon-btn" title="Выйти" onClick={()=>void logout()}>↪</button></nav>
    <aside className="sidebar"><div className="sidebar-head"><div className="sidebar-head-row"><div><h2>Диалоги</h2><div className="sub">Недавние — выше</div></div><button className="mini-btn" aria-label="Найти человека" onClick={()=>setPeople(true)}>＋</button></div><input className="mobile-search" aria-label="Поиск диалогов на телефоне" placeholder="Поиск диалогов" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="chat-list">{chatsLoading?<p className="empty-small">Загрузка диалогов…</p>:chats.length===0?<div className="empty-small"><div className="empty-symbol">✦</div><h3>Начните разговор</h3><p>Найдите человека по имени или email и отправьте первое сообщение.</p><button className="primary-btn" onClick={()=>setPeople(true)}>Найти человека</button></div>:chats.filter(c=>c.members.some(m=>m.user.id!==user.id&&m.user.displayName.toLowerCase().includes(query.toLowerCase()))).map(c=>{const p=c.members.find(m=>m.user.id!==user.id)!.user;return <button key={c.id} className={`chat-item ${selected===c.id?'active':''}`} onClick={()=>setSelected(c.id)}><Avatar user={p} online={online.includes(p.id)}/><div className="chat-preview"><h4>{p.displayName}</h4><p>{c.messages[0]?.body||'Пока нет сообщений'}</p></div><time>{c.messages[0]?time(c.messages[0].createdAt):''}</time></button>;})}</div><div className="sidebar-footer">{connected?'● Соединение установлено':'◌ Восстанавливаем соединение…'}</div></aside>
    <main className="chat">{error&&<div className="notice error" role="alert">{error}<button className="ghost-btn" onClick={()=>{setError('');void refreshChats();if(selected)void history(selected,false);}}>Повторить загрузку</button><button className="ghost-btn" aria-label="Закрыть ошибку" onClick={()=>setError('')}>×</button></div>}{!connected&&<div className="notice" role="status">Нет соединения. История обновится после подключения.</div>}
    {peer?<><div className="chat-head"><div className="chat-contact"><button className="ghost-btn back" aria-label="Назад к диалогам" onClick={()=>setSelected(null)}>←</button><Avatar user={peer} online={online.includes(peer.id)}/><div><h3>{peer.displayName}</h3><p>{online.includes(peer.id)?'в сети':'не в сети'}</p></div></div><span className="muted chat-caption">Личный диалог</span></div><div ref={viewport} className="messages" role="log" aria-label="Сообщения" aria-live="polite" onScroll={()=>{const v=viewport.current;if(v){nearBottom.current=v.scrollHeight-v.scrollTop-v.clientHeight<90;if(nearBottom.current)setNewMessages(false);}}}>{cursor&&<button className="ghost-btn older" disabled={loading} onClick={()=>void older()}>Загрузить предыдущие</button>}{loading&&<div className="muted">Загрузка истории…</div>}{!loading&&messages.length===0&&<div className="empty-small"><div className="empty-symbol">✧</div><h3>Здесь начинается разговор</h3><p>Напишите {peer.displayName} первое сообщение.</p></div>}{messages.map(m=><div key={m.id} className={`message ${m.senderId===user.id?'sent':''}`}>{m.senderId!==user.id&&<Avatar user={peer}/>}<div className="bubble"><div className="message-body">{m.body}</div><div className="time" title="Сохранено на сервере">{time(m.createdAt)}</div></div></div>)}</div>{newMessages&&<button className="ghost-btn new-messages" onClick={()=>{if(viewport.current)viewport.current.scrollTop=viewport.current.scrollHeight;setNewMessages(false);}}>Новые сообщения ↓</button>}<div className="typing" role="status">{typing?`${peer.displayName} печатает…`:''}</div>{failed&&<div className="notice error">Сообщение не подтверждено: {failed.body.slice(0,60)}<button className="ghost-btn" disabled={sending||!connected} onClick={()=>void send(true)}>Повторить отправку</button></div>}<form className="composer" onSubmit={e=>{e.preventDefault();void send();}}><div className="composer-inner"><textarea aria-label="Сообщение" maxLength={4000} value={draft} disabled={sending} onChange={e=>{setDraft(e.target.value);if(connected&&Date.now()-lastTyped.current>1500){lastTyped.current=Date.now();socket.emit('typing:start',{conversationId:selected});}if(!e.target.value)socket.emit('typing:stop',{conversationId:selected});}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}} placeholder="Напишите сообщение…"/><button className="primary-btn send-btn" disabled={!draft.trim()||sending||!connected||!!failed}>{sending?'Отправка…':'Отправить'}</button></div><div className="sub">Enter — отправить · Shift + Enter — новая строка</div></form></>:<div className="empty"><div className="empty-symbol">✦</div><h2>Место для ваших разговоров</h2><p>Выберите диалог или найдите человека,<br/>чтобы начать общение.</p><button className="primary-btn" onClick={()=>setPeople(true)}>＋ Новый диалог</button></div>}</main>
    <aside className="rightbar"><div className="tabs"><div className="tab active">Профиль</div><div className="tab">Nebula</div></div><div className="right-content"><div className="profile-card"><div className="profile-large"><Avatar user={peer||user} online={peer?online.includes(peer.id):connected}/><div><h3>{(peer||user).displayName}</h3><p>{(peer||user).email}</p></div></div></div><div className="profile-card about"><h3>Ближе, даже на расстоянии</h3><p>Личная переписка, которая остаётся с вами. История сохраняется на сервере.</p><span className="muted">✦ Nebula Messenger</span></div></div></aside></div>
    {people&&<Dialog title="Люди и контакты" onClose={()=>setPeople(false)}><div className="settings-body"><div className="field"><label htmlFor="people-search">Поиск по имени или email</label><input id="people-search" autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Введите имя или email"/></div><p className="muted">{searching?'Ищем…':!search.trim()?'Введите имя зарегистрированного пользователя.':results.length?'Выберите человека для личного диалога.':'Никого не найдено.'}</p>{results.map(p=><button className="person-card" key={p.id} onClick={()=>void start(p)}><Avatar user={p}/><div><h4>{p.displayName}</h4><small>{p.email}</small></div></button>)}</div></Dialog>}
    {profile&&<Dialog title="Мой профиль" onClose={()=>setProfile(false)}><div className="settings-body"><div className="profile-large"><Avatar user={user} online={connected}/><div><h3>{user.displayName}</h3><p>{user.email}</p></div></div><p className="muted">Статус определяется подключением к серверу.</p><button className="danger-btn" onClick={()=>void logout()}>Выйти из аккаунта</button></div></Dialog>}
  </div>;
}
function merge(messages:Message[]){return [...new Map(messages.map(m=>[m.id,m])).values()].sort((a,b)=>a.id-b.id);}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
