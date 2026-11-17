import { useState, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { api } from './api';
import type { User } from './types';
export const time=(date:string)=>new Date(date).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
export function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const element=useRef<HTMLElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const node=element.current!;
    const focusable=()=>Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, [tabindex="0"]'));
    (node.querySelector<HTMLElement>('input')||focusable()[0]||node).focus();
    function trap(event:KeyboardEvent){if(event.key==='Tab'){const list=focusable(),first=list[0],last=list[list.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}
    node.addEventListener('keydown',trap);return()=>{node.removeEventListener('keydown',trap);previous?.focus();};
  },[]);
  return <div className="modal-backdrop" onClick={onClose}><section ref={element} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="modal small" onClick={event=>event.stopPropagation()}><div className="modal-head"><h3>{title}</h3><button className="close-btn" aria-label="Закрыть" onClick={onClose}>✕</button></div>{children}</section></div>;
}
export function Avatar({user,online=false}:{user:User;online?:boolean}) {
  return <div className="avatar round" aria-label={online?'В сети':'Не в сети'}>{user.displayName.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}{online&&<span className="status-dot status-online"/>}</div>;
}
export function Auth({onLogin}:{onLogin:(user:User)=>void}) {
  const [register,setRegister]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    const data=Object.fromEntries(new FormData(event.currentTarget));
    try{onLogin(await api<User>(`/auth/${register?'register':'login'}`,data));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="login-screen"><div className="auth-card"><div className="brand"><div className="brand-badge">✦</div><span>Nebula Messenger</span></div><h1>{register?'Создать профиль':'С возвращением'}</h1><p>Ваши люди. Ваши разговоры.<br/>Общение в реальном времени.</p><form className="form-grid" onSubmit={submit}>{register&&<div className="field"><label htmlFor="name">Имя</label><input id="name" name="displayName" required maxLength={60} autoComplete="name" placeholder="Как к вам обращаться?"/></div>}<div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="you@example.com"/></div><div className="field"><label htmlFor="password">Пароль · от 10 символов</label><input id="password" name="password" type="password" required minLength={10} maxLength={72} autoComplete={register?'new-password':'current-password'}/></div>{error&&<p role="alert" className="error">{error}</p>}<button className="primary-btn" disabled={busy}>{busy?'Подождите…':register?'Зарегистрироваться':'Войти'}</button><button type="button" className="ghost-btn" onClick={()=>{setRegister(!register);setError('');}}>{register?'Уже есть аккаунт? Войти':'Создать аккаунт'}</button></form></div></section>;
}
