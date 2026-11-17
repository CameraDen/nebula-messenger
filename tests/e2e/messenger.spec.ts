import { test, expect, type Page } from '@playwright/test';
async function register(page:Page,name:string,email:string){await page.goto('/');await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();await page.getByLabel('Имя',{exact:true}).fill(name);await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль · от 10 символов').fill('browser-password-123');await page.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();await expect(page.getByRole('heading',{name:'Диалоги',exact:true})).toBeVisible();}
test('two browsers exchange, reload, reconnect and use mobile navigation',async({browser})=>{
  const alice=await browser.newContext({viewport:{width:1440,height:900}}),bob=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const a=await alice.newPage(),b=await bob.newPage();const errors:string[]=[];a.on('pageerror',e=>errors.push(e.message));b.on('pageerror',e=>errors.push(e.message));
  const tag=Date.now();await register(a,'Алиса',`alice-${tag}@example.com`);await register(b,'Борис',`bob-${tag}@example.com`);
  expect(await a.evaluate(()=>isSecureContext)).toBe(false);
  await a.getByRole('button',{name:'Найти человека',exact:true}).first().click();await a.getByLabel('Поиск по имени или email').fill(`bob-${tag}@example.com`);await a.getByRole('button',{name:/Борис/}).click();
  await a.getByLabel('Сообщение',{exact:true}).fill('Привет из первого браузера!');await a.getByRole('button',{name:'Отправить',exact:true}).click();
  await b.getByRole('button',{name:/Алиса/}).click();await expect(b.getByRole('log').getByText('Привет из первого браузера!',{exact:true})).toBeVisible();
  await b.getByLabel('Сообщение',{exact:true}).fill('Ответ с телефона');await expect(a.getByText('Борис печатает…',{exact:true})).toBeVisible();await b.getByRole('button',{name:'Отправить',exact:true}).click();await expect(a.getByRole('log').getByText('Ответ с телефона',{exact:true})).toBeVisible();
  await a.reload();await a.getByRole('button',{name:/Борис/}).click();await expect(a.getByRole('log').getByText('Ответ с телефона',{exact:true})).toBeVisible();
  await bob.setOffline(true);await a.getByLabel('Сообщение',{exact:true}).fill('Пока вы были офлайн');await a.getByRole('button',{name:'Отправить',exact:true}).click();await bob.setOffline(false);await expect(b.getByRole('log').getByText('Пока вы были офлайн',{exact:true})).toBeVisible({timeout:20000});
  await a.getByLabel('Сообщение',{exact:true}).fill('<img src=x onerror=alert(1)>');await a.getByRole('button',{name:'Отправить',exact:true}).click();await expect(b.getByRole('log').getByText('<img src=x onerror=alert(1)>',{exact:true})).toBeVisible();expect(await b.getByRole('log').locator('img').count()).toBe(0);
  expect(await b.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await a.screenshot({path:'artifacts/desktop.png',fullPage:true});await b.screenshot({path:'artifacts/mobile.png',fullPage:true});
  await b.getByRole('button',{name:'Назад к диалогам',exact:true}).click();await expect(b.getByRole('heading',{name:'Диалоги',exact:true})).toBeVisible();
  expect(errors).toEqual([]);await alice.close();await bob.close();
});
