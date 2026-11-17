export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
export async function api<T>(path:string,body?:unknown):Promise<T> {
  const response=await fetch(`/api${path}`,{credentials:'include',...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok)throw new ApiError(response.status,data.error||'Ошибка запроса');
  return data;
}
